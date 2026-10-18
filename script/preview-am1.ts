/**
 * Read-only AM-1 checker. Selects only. Does not apply the migration, does
 * not create crm_prospect_dedup, and does not write.
 *
 *   npx tsx script/preview-am1.ts
 *
 * Function-body diff (no database): npx tsx script/diff-crm-prospect-dedup.ts
 *
 * Undo md5s, when a database URL is configured, are printed from this query
 * and must be unchanged by AM-1:
 *   select p.proname, md5(pg_get_functiondef(p.oid))
 *   from pg_proc p
 *   where p.pronamespace = 'public'::regnamespace
 *     and p.proname in ('rlms_apply_jsonb_patch','rlms_undo_change_group','crm_prospect_dedup');
 */
import { createHash } from "node:crypto";
import { tierFromBriefingTrack } from "../shared/account-mgmt";
import { fetchAllRows } from "../server/fetch-all";
import { supabaseAdmin } from "../server/supabase";

async function main() {
  const parties = await fetchAllRows<{ entity_id: number; kind: string; label: string }>((from, to) =>
    supabaseAdmin.from("v_crm_party_search").select("entity_id, kind, label").eq("entity", "account").order("entity_id").range(from, to),
  );
  const seen = new Set<number>();
  const counts = { client: 0, former: 0, prospect: 0 };
  for (const row of parties) {
    const id = Number(row.entity_id);
    if (seen.has(id)) continue;
    seen.add(id);
    if (row.kind === "client" || row.kind === "former" || row.kind === "prospect") counts[row.kind] += 1;
  }

  const accounts = await fetchAllRows<{ id: number; name: string; account_manager: string | null }>((from, to) =>
    supabaseAdmin.from("accounts").select("id, name, account_manager").order("id").range(from, to),
  );
  const transitions = await fetchAllRows<{
    account_id: number;
    status: string | null;
    to_account_manager: string | null;
  }>((from, to) =>
    supabaseAdmin.from("account_transition_records").select("account_id, status, to_account_manager").order("account_id").range(from, to),
  );
  const handoff = new Map(transitions.map((row) => [Number(row.account_id), row]));
  const byOwner = new Map<string, number>();
  const unowned: { id: number; name: string }[] = [];
  const accountName = new Map(accounts.map((row) => [Number(row.id), row.name]));
  for (const id of seen) {
    const account = accounts.find((row) => Number(row.id) === id);
    const transition = handoff.get(id);
    const incoming = transition?.status === "open" ? String(transition.to_account_manager ?? "").trim() : "";
    const official = String(account?.account_manager ?? "").trim();
    const effective = incoming || official;
    const key = effective || "(unowned)";
    byOwner.set(key, (byOwner.get(key) ?? 0) + 1);
    const kind = parties.find((row) => Number(row.entity_id) === id)?.kind;
    if (kind === "client" && !effective) unowned.push({ id, name: accountName.get(id) ?? "" });
  }

  const forms = await fetchAllRows<{ id: number; record_id: number; tier_track: string | null; completed_at: string | null }>((from, to) =>
    supabaseAdmin
      .from("account_transition_briefing_forms")
      .select("id, record_id, tier_track, completed_at")
      .eq("status", "completed")
      .order("id")
      .range(from, to),
  );
  const records = await fetchAllRows<{ id: number; account_id: number }>((from, to) =>
    supabaseAdmin.from("account_transition_records").select("id, account_id").order("id").range(from, to),
  );
  const accountByRecord = new Map(records.map((row) => [Number(row.id), Number(row.account_id)]));
  const latest = new Map<number, { id: number; at: string; track: string | null }>();
  for (const form of forms) {
    const accountId = accountByRecord.get(Number(form.record_id));
    if (accountId == null) continue;
    const at = form.completed_at ?? "";
    const prev = latest.get(accountId);
    if (!prev || at > prev.at || (at === prev.at && form.id > prev.id)) {
      latest.set(accountId, { id: form.id, at, track: form.tier_track });
    }
  }
  const tierCounts: Record<string, number> = { track_1: 0, track_2: 0, track_3: 0, unmapped: 0 };
  for (const form of latest.values()) {
    const tier = tierFromBriefingTrack(form.track);
    tierCounts[tier ?? "unmapped"] += 1;
  }

  const financial = await fetchAllRows<{ rider_id: string; snapshot_month: string; monthly_rent_total: number | null }>((from, to) =>
    supabaseAdmin.from("rider_financial_summary").select("rider_id, snapshot_month, monthly_rent_total").order("id").range(from, to),
  );
  let snapshot = "";
  for (const row of financial) {
    const month = String(row.snapshot_month ?? "").slice(0, 10);
    if (month > snapshot) snapshot = month;
  }
  let rent = 0;
  const ridersInSnap = new Set<string>();
  for (const row of financial) {
    if (String(row.snapshot_month ?? "").slice(0, 10) !== snapshot) continue;
    rent += Number(row.monthly_rent_total ?? 0);
    ridersInSnap.add(String(row.rider_id));
  }

  const rollup = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabaseAdmin.from("v_lease_lessee_rollup").select("*").order("master_lease_id").range(from, to),
  );
  const rollupHash = createHash("sha256").update(JSON.stringify(rollup)).digest("hex");

  console.log(JSON.stringify({
    note: "Read-only. No migration applied. Dedup body diff is script/diff-crm-prospect-dedup.ts (not executed on the database).",
    md5_query: "Run the pg_get_functiondef md5 query in the header before and after AM-1. Both undo md5s must be unchanged.",
    segments: counts,
    effective_owner_counts: Object.fromEntries([...byOwner.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    unowned_clients: unowned.sort((a, b) => a.name.localeCompare(b.name)),
    tier_dry_run: tierCounts,
    rent_roll: {
      snapshot_month: snapshot,
      summed_monthly_rent_total: rent,
      riders_in_snapshot: ridersInSnap.size,
      note: "Sum of every rider_financial_summary row for the latest snapshot, including separate former_deal slices. Placeholder exclusion is applied by v_account_rent_roll after the migration.",
    },
    v_lease_lessee_rollup_sha256: rollupHash,
    v_lease_lessee_rollup_rows: rollup.length,
  }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
