/**
 * Refresh riders.expiration_date (and optional effective_date) from authoritative
 * railcars lease fields. Match riders by rider_name / schedule_number ↔ rider_external_id.
 *
 * This keeps Lease Management from showing decade-stale expirations without treating
 * the riders table as source of truth for Dashboard KPIs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "./fetch-all";
import {
  aggregateOlEndDate,
  carLeaseEndDate,
  carOlCode,
} from "@shared/lease-authority";

export type RiderExpirationSyncResult = {
  ridersScanned: number;
  ridersUpdated: number;
  olsWithKnownEnd: number;
};

export async function syncRiderExpirationsFromCars(
  supabase: SupabaseClient
): Promise<RiderExpirationSyncResult> {
  const [cars, riders] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("railcars")
        .select(
          "id, active, rider_external_id, assignment_label, lease_end_date, lease_expiry, lease_start_date"
        )
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("riders")
        .select("id, rider_name, schedule_number, expiration_date, effective_date")
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  const endsByOl = new Map<string, string[]>();
  const startsByOl = new Map<string, string[]>();
  for (const c of cars as any[]) {
    if (c.active !== true) continue;
    const ol = carOlCode(c);
    if (!ol) continue;
    const key = ol.toUpperCase();
    const end = carLeaseEndDate(c);
    if (end) {
      const list = endsByOl.get(key) ?? [];
      list.push(end);
      endsByOl.set(key, list);
    }
    const start = String(c.lease_start_date ?? "").trim().slice(0, 10);
    if (start) {
      const list = startsByOl.get(key) ?? [];
      list.push(start);
      startsByOl.set(key, list);
    }
  }

  let ridersUpdated = 0;
  let olsWithKnownEnd = 0;
  for (const r of riders as any[]) {
    const keys = [
      String(r.rider_name ?? "").trim().toUpperCase(),
      String(r.schedule_number ?? "").trim().toUpperCase(),
    ].filter(Boolean);
    let ends: string[] = [];
    let starts: string[] = [];
    for (const k of keys) {
      if (endsByOl.has(k)) ends = ends.concat(endsByOl.get(k)!);
      if (startsByOl.has(k)) starts = starts.concat(startsByOl.get(k)!);
    }
    const nextExp = aggregateOlEndDate(ends);
    if (nextExp) olsWithKnownEnd += 1;
    // Earliest start among matched cars (optional cache)
    let nextEff: string | null = null;
    for (const s of starts) {
      if (!nextEff || s < nextEff) nextEff = s;
    }

    const prevExp = r.expiration_date ? String(r.expiration_date).slice(0, 10) : null;
    const prevEff = r.effective_date ? String(r.effective_date).slice(0, 10) : null;
    if (prevExp === nextExp && (nextEff == null || prevEff === nextEff)) continue;

    const patch: Record<string, string | null> = { expiration_date: nextExp };
    if (nextEff) patch.effective_date = nextEff;
    const { error } = await supabase.from("riders").update(patch).eq("id", r.id);
    if (error) throw error;
    ridersUpdated += 1;
  }

  return {
    ridersScanned: riders.length,
    ridersUpdated,
    olsWithKnownEnd,
  };
}
