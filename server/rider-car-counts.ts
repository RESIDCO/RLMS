import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./fetch-all";

/** Count assigned cars per rider.id — paginated so PostgREST's 1000-row cap cannot zero out badges. */
export async function countCarsByRiderId(): Promise<Map<number, number>> {
  const rows = await fetchAllRows<{ rider_id: number | null }>((from, to) =>
    supabaseAdmin
      .from("railcar_assignments")
      .select("rider_id")
      .order("id", { ascending: true })
      .range(from, to),
  );
  const counts = new Map<number, number>();
  for (const row of rows) {
    const id = Number(row.rider_id);
    if (!Number.isFinite(id) || id <= 0) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Count active fleet cars per rider.id (railcars.active === true).
 * Used to derive inactive OLs/MLAs on Lease Management.
 */
export async function countActiveCarsByRiderId(): Promise<Map<number, number>> {
  const rows = await fetchAllRows<{ rider_id: number | null }>((from, to) =>
    supabaseAdmin
      .from("railcar_assignments")
      .select("rider_id, railcars!inner(id, active)")
      .eq("railcars.active", true)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const counts = new Map<number, number>();
  for (const row of rows) {
    const id = Number(row.rider_id);
    if (!Number.isFinite(id) || id <= 0) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
