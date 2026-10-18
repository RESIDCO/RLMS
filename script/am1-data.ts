/**
 * AM-1 owner and tier seed. Dry-run by default.
 *   npx tsx script/am1-data.ts [--apply] [--part owners|tiers|all]
 * --part defaults to owners. Tier seeding needs --part tiers (or --part all).
 *
 * --apply requires AM1_APPLY_OK=bruce and is run only after the migration
 * and after Bruce signs off the 12-row preview. Each part is one change group
 * through updateAccount (withChangeGroup / recordChange).
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withChangeGroup } from "../server/change-log";
import { updateAccount } from "../server/accounts";
import { fetchAllRows } from "../server/fetch-all";
import { supabaseAdmin } from "../server/supabase";
import {
  AM1_OWNER_ASSIGNMENTS,
  AM1_STAY_UNOWNED,
  assertAm1ApplyAllowed,
  ownerSignoffTable,
  parseAm1Part,
  planOwnerAssignments,
  planTierRow,
  plannedWrites,
  previewCsvRows,
  toCsv,
  writesForPart,
  type OwnerLive,
  type TierLive,
} from "./am1-plan";

const ACTOR = "am1-data";
const stay = new Set<number>(AM1_STAY_UNOWNED.map((row) => row.account_id));

async function loadOwners(): Promise<Map<number, OwnerLive>> {
  const ids = AM1_OWNER_ASSIGNMENTS.map((row) => row.account_id);
  const { data, error } = await supabaseAdmin
    .from("v_account_owner_effective")
    .select("account_id, owner_of_record, handoff_status, to_account_manager")
    .in("account_id", ids);
  if (error) throw error;
  const map = new Map<number, OwnerLive>();
  for (const row of data ?? []) {
    map.set(Number(row.account_id), {
      current_owner: row.owner_of_record ?? null,
      handoff_status: row.handoff_status ?? null,
      to_account_manager: row.to_account_manager ?? null,
    });
  }
  return map;
}

async function loadTiers(): Promise<TierLive[]> {
  const [forms, records, parties, accounts] = await Promise.all([
    fetchAllRows<{ id: number; record_id: number; tier_track: string | null; completed_at: string | null; status: string }>((from, to) =>
      supabaseAdmin
        .from("account_transition_briefing_forms")
        .select("id, record_id, tier_track, completed_at, status")
        .eq("status", "completed")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<{ id: number; account_id: number }>((from, to) =>
      supabaseAdmin.from("account_transition_records").select("id, account_id").order("id", { ascending: true }).range(from, to),
    ),
    fetchAllRows<{ entity_id: number; kind: string }>((from, to) =>
      supabaseAdmin.from("v_crm_party_search").select("entity_id, kind").eq("entity", "account").order("entity_id", { ascending: true }).range(from, to),
    ),
    fetchAllRows<{ id: number; name: string; tier: string | null }>((from, to) =>
      supabaseAdmin.from("accounts").select("id, name, tier").order("id", { ascending: true }).range(from, to),
    ),
  ]);
  const accountByRecord = new Map(records.map((row) => [Number(row.id), Number(row.account_id)]));
  const latest = new Map<number, { id: number; completed_at: string; track: string | null }>();
  for (const form of forms) {
    const accountId = accountByRecord.get(Number(form.record_id));
    if (accountId == null || stay.has(accountId)) continue;
    const completed = form.completed_at ?? "";
    const prev = latest.get(accountId);
    if (!prev || completed > prev.completed_at || (completed === prev.completed_at && form.id > prev.id)) {
      latest.set(accountId, { id: Number(form.id), completed_at: completed, track: form.tier_track });
    }
  }
  const kindByAccount = new Map<number, TierLive["segment"]>();
  for (const party of parties) {
    const id = Number(party.entity_id);
    if (kindByAccount.has(id)) continue;
    const kind = party.kind === "client" || party.kind === "former" || party.kind === "prospect" ? party.kind : "other";
    kindByAccount.set(id, kind);
  }
  const nameByAccount = new Map(accounts.map((row) => [Number(row.id), row]));
  const rows: TierLive[] = [];
  for (const [accountId, form] of latest) {
    const account = nameByAccount.get(accountId);
    rows.push({
      account_id: accountId,
      name: account?.name ?? `Account ${accountId}`,
      current_tier: account?.tier ?? null,
      briefing_track: form.track,
      segment: kindByAccount.get(accountId) ?? "other",
    });
  }
  return rows;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const part = parseAm1Part(process.argv);
  const owners = planOwnerAssignments(await loadOwners());
  const tiers = (await loadTiers()).map(planTierRow);
  console.log("Owner assignment preview — all 12 lessee rows (current blank, new BH/FF) for sign-off");
  console.log(ownerSignoffTable(owners));
  console.log("");
  const tierSets = tiers.filter((row) => row.action === "set");
  const unmapped = tiers.filter((row) => row.action === "unmapped");
  console.log(`Tier seed: ${tierSets.length} to set, ${tiers.filter((row) => row.action === "skip").length} skipped, ${unmapped.length} unmapped`);
  for (const row of unmapped) console.log(`  unmapped ${row.account_id} ${row.name} [${row.segment}]`);
  const csvPath = join(dirname(fileURLToPath(import.meta.url)), "am1-data-preview.csv");
  writeFileSync(csvPath, toCsv(previewCsvRows(owners, tiers)));
  console.log(`Wrote ${csvPath}`);
  console.log(part === "owners" && !process.argv.includes("--part")
    ? "Part: owners (default). Pass --part tiers to seed tiers, or --part all for both."
    : `Part: ${part}`);
  if (!apply) {
    console.log("Dry-run. No database writes. Re-run with --apply only after Bruce signs off, and only with AM1_APPLY_OK=bruce.");
    return;
  }
  assertAm1ApplyAllowed(true, process.env);
  const writes = writesForPart(plannedWrites(owners, tiers), part);
  for (const group of ["owners", "tiers"] as const) {
    const rows = writes.filter((row) => row.group === group);
    if (!rows.length) continue;
    const changeGroup = await withChangeGroup(ACTOR, async (groupId) => {
      for (const row of rows) {
        if (stay.has(row.account_id)) throw new Error(`Refusing to write protected account ${row.account_id}`);
        await updateAccount(row.account_id, row.patch, ACTOR);
      }
      return groupId;
    });
    console.log(`${group} change_group ${changeGroup} (${rows.length} rows)`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
