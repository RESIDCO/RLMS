import { accountManagerByAccountIds } from "./accounts";
import { supabaseAdmin } from "./supabase";
import { asOne } from "@shared/lease-type";
import {
  assignmentLabelFromOl,
  canonicalLesseeFromOl,
  compactOlKey,
  isAdHocLeaseNumber,
  isSoldOl,
  type OlIdentity,
} from "@shared/ol-identity";

export type { OlIdentity };

export function matchRiderByCompactLabel<T extends { rider_name?: string | null; schedule_number?: string | null }>(
  riders: T[],
  raw: string,
): T | undefined {
  const key = compactOlKey(raw);
  if (!key) return undefined;
  const upper = raw.trim().toUpperCase();
  const matches = riders.filter(
    (r) => compactOlKey(r.rider_name) === key || compactOlKey(r.schedule_number) === key,
  );
  if (!matches.length) return undefined;
  return (
    matches.find((r) => String(r.rider_name ?? "").trim().toUpperCase() === upper) ??
    matches.find((r) => String(r.schedule_number ?? "").trim().toUpperCase() === upper) ??
    matches[0]
  );
}

async function carLesseeCountsForRider(riderId: number): Promise<Array<{ lessee: string; n: number }>> {
  const { data, error } = await supabaseAdmin
    .from("railcar_assignments")
    .select("railcar_id, railcars!inner(lessee_name)")
    .eq("rider_id", riderId);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const car = asOne((row as any).railcars);
    const lessee = String(car?.lessee_name ?? "").trim();
    if (!lessee) continue;
    counts.set(lessee, (counts.get(lessee) ?? 0) + 1);
  }
  return [...counts.entries()].map(([lessee, n]) => ({ lessee, n }));
}

export async function loadOlIdentity(riderId: number): Promise<OlIdentity | null> {
  const { data, error } = await supabaseAdmin
    .from("riders")
    .select(
      "id, rider_name, schedule_number, expiration_date, lease_status, owner_entity, entity, sold_to, master_lease_id, master_lease:master_leases(id, lease_number, lessee, lease_type, account_id, sold_to)",
    )
    .eq("id", riderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const mla = asOne((data as any).master_lease);
  const is_sold = isSoldOl(data.rider_name) || isSoldOl(data.schedule_number);
  const is_adhoc = isAdHocLeaseNumber(mla?.lease_number);
  const counts = is_sold || is_adhoc ? [] : await carLesseeCountsForRider(riderId);
  const picked = canonicalLesseeFromOl({
    isSold: is_sold,
    isAdHoc: is_adhoc,
    masterLessee: mla?.lessee ?? null,
    carLesseeCounts: counts,
  });
  const accountId = Number(mla?.account_id);
  const amMap =
    Number.isFinite(accountId) && accountId > 0
      ? await accountManagerByAccountIds([accountId])
      : new Map<number, string | null>();
  const sold_to = String(data.sold_to ?? mla?.sold_to ?? "").trim() || null;

  return {
    rider_id: data.id,
    rider_name: data.rider_name,
    schedule_number: data.schedule_number ?? null,
    is_sold,
    is_adhoc,
    canonical_lessee: picked.lessee,
    lessee_source: picked.source,
    master_lease_number: mla?.lease_number ?? null,
    lease_type: mla?.lease_type ?? null,
    expiration_date: data.expiration_date ?? null,
    lease_status: data.lease_status ?? null,
    account_manager: (Number.isFinite(accountId) ? amMap.get(accountId) : null) ?? null,
    owner_entity: data.owner_entity ?? null,
    entity: data.entity ?? null,
    sold_to,
    suggested_lessee: is_sold ? sold_to : null,
  };
}

export function railcarIdentityPatch(identity: OlIdentity, lessee: string | null): Record<string, string | null> {
  const ol = String(identity.schedule_number || identity.rider_name || "").trim() || null;
  const patch: Record<string, string | null> = {
    lessee_name: lessee,
    rider_external_id: ol,
    assignment_label: assignmentLabelFromOl(lessee, ol),
  };
  if (!identity.is_sold && !identity.is_adhoc && identity.lease_type) {
    patch.lease_type = identity.lease_type;
  }
  return patch;
}
