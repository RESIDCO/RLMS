import { AD_HOC_LEASE_NUMBER } from "@shared/ol-identity";
import { resolveWillCreate } from "@shared/move-plan";
import { ensureAccountForLessee } from "./accounts";
import { recordChange, withChangeGroupResult } from "./change-log";
import { fetchAllRows } from "./fetch-all";
import { matchRiderByCompactLabel } from "./ol-identity";
import { supabaseAdmin } from "./supabase";

export type ResolvedRider = {
  id: number;
  rider_name: string;
  created: boolean;
  change_group: string | null;
};

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

async function findRider(raw: string): Promise<{ id: number; rider_name: string } | null> {
  const riders = await fetchAllRows((from, to) =>
    supabaseAdmin
      .from("riders")
      .select("id, rider_name, schedule_number, master_lease_id")
      .order("id", { ascending: true })
      .range(from, to),
  );
  const asId = Number(raw);
  const match =
    (Number.isFinite(asId) && asId > 0 ? riders.find((r: { id: number }) => r.id === asId) : undefined) ??
    matchRiderByCompactLabel(riders as { rider_name?: string | null; schedule_number?: string | null; id: number }[], raw);
  if (!match) return null;
  return { id: Number(match.id), rider_name: String(match.rider_name ?? raw) };
}

async function createAdHocRider(raw: string, actor: string): Promise<ResolvedRider> {
  return withChangeGroupResult(actor, async () => {
    const accountId = await ensureAccountForLessee("Ad Hoc / Free-text OL");
    let { data: mla } = await supabaseAdmin
      .from("master_leases")
      .select("id")
      .eq("lease_number", AD_HOC_LEASE_NUMBER)
      .maybeSingle();
    if (!mla) {
      const lease = {
        lease_number: AD_HOC_LEASE_NUMBER,
        lessor: "RESIDCO",
        lessee: "Ad Hoc / Free-text OL",
        account_id: accountId,
      };
      const { data: created, error } = await supabaseAdmin
        .from("master_leases")
        .insert(lease)
        .select("id")
        .single();
      if (error) throw error;
      await recordChange({
        table: "master_leases",
        pk: Number(created.id),
        before: {},
        after: lease,
        action: "insert",
        entity_type: "master_lease",
        entity_id: Number(created.id),
        railcar_id: null,
        actor,
      });
      mla = created;
    }

    const rider = {
      master_lease_id: mla!.id,
      rider_name: raw,
      schedule_number: raw,
    };
    const { data: inserted, error: riderErr } = await supabaseAdmin
      .from("riders")
      .insert(rider)
      .select("id, rider_name")
      .single();
    if (riderErr) throw riderErr;
    await recordChange({
      table: "riders",
      pk: Number(inserted.id),
      before: {},
      after: rider,
      action: "insert",
      entity_type: "rider",
      entity_id: Number(inserted.id),
      railcar_id: null,
      rider_id: Number(inserted.id),
      actor,
    });
    return { id: Number(inserted.id), rider_name: String(inserted.rider_name), created: true as const };
  });
}

/**
 * Match an existing rider. Creating an Ad Hoc lease happens only when
 * `create` is exactly true, and that insert is change-captured.
 */
export async function resolveRiderLabel(
  rawLabel: string,
  body: { create?: unknown } | null | undefined,
  actor: string,
): Promise<ResolvedRider> {
  const raw = String(rawLabel ?? "").trim();
  if (!raw) throw httpError(400, "label is required");
  const existing = await findRider(raw);
  if (existing) return { ...existing, created: false, change_group: null };
  if (!resolveWillCreate(body)) {
    throw httpError(404, "No existing rider matches that label");
  }
  const created = await createAdHocRider(raw, actor);
  return created;
}
