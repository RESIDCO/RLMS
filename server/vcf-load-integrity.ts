import type { SupabaseClient } from "@supabase/supabase-js";

export type VcfIntegrityCheck = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
  warning?: boolean;
};

export type VcfWatchFingerprint = {
  id: number;
  car_initial: string | null;
  car_number: string | null;
  active: boolean | null;
  status: string | null;
  active_status: string | null;
  active_source: string | null;
  rider_external_id: string | null;
};

function fp(row: VcfWatchFingerprint): string {
  return [
    row.id,
    row.car_initial ?? "",
    row.car_number ?? "",
    row.active === true ? "1" : "0",
    row.status ?? "",
    row.active_status ?? "",
    row.active_source ?? "",
    row.rider_external_id ?? "",
  ].join("|");
}

export async function countOpenPeriodStats(db: SupabaseClient): Promise<{
  activeMultiOpen: number;
  activeNoOpen: number;
}> {
  const { data, error } = await db.rpc("vcf_open_period_stats");
  if (!error && data) {
    const row = Array.isArray(data) ? data[0] : data;
    if (row && (row.active_multi_open != null || row.active_no_open != null)) {
      return {
        activeMultiOpen: Number(row.active_multi_open ?? 0),
        activeNoOpen: Number(row.active_no_open ?? 0),
      };
    }
  }
  const cars = await pageAll<{ id: number; active: boolean | null }>(db, "railcars", "id, active");
  const open = await pageAll<{ railcar_id: number }>(
    db,
    "assignment_history",
    "railcar_id",
    (q) => q.is("end_date", null)
  );
  const openCount = new Map<number, number>();
  for (const r of open) {
    const id = Number(r.railcar_id);
    openCount.set(id, (openCount.get(id) ?? 0) + 1);
  }
  let activeMultiOpen = 0;
  let activeNoOpen = 0;
  for (const c of cars) {
    if (c.active !== true) continue;
    const n = openCount.get(Number(c.id)) ?? 0;
    if (n > 1) activeMultiOpen += 1;
    if (n === 0) activeNoOpen += 1;
  }
  return { activeMultiOpen, activeNoOpen };
}

/** Prefer SQL for the two fleet totals. */
export async function countFleet(db: SupabaseClient): Promise<{ cars: number; active: number; mismatch: number }> {
  const cars = await db.from("railcars").select("id", { count: "exact", head: true });
  if (cars.error) throw cars.error;
  const active = await db.from("railcars").select("id", { count: "exact", head: true }).eq("active", true);
  if (active.error) throw active.error;
  const mismatch = await db.from("v_railcar_active_status_mismatch").select("id", { count: "exact", head: true });
  const mismatchCount = mismatch.error ? -1 : mismatch.count ?? 0;
  return {
    cars: cars.count ?? 0,
    active: active.count ?? 0,
    mismatch: mismatchCount,
  };
}

export async function fetchWatchCars(db: SupabaseClient): Promise<VcfWatchFingerprint[]> {
  const byId = await db
    .from("railcars")
    .select("id, car_initial, car_number, active, status, active_status, active_source, rider_external_id")
    .in("id", [23602, 23603]);
  if (byId.error) throw byId.error;
  const byTest = await db
    .from("railcars")
    .select("id, car_initial, car_number, active, status, active_status, active_source, rider_external_id")
    .eq("car_initial", "TEST")
    .in("car_number", ["999011", "999012"]);
  if (byTest.error) throw byTest.error;
  const map = new Map<number, VcfWatchFingerprint>();
  for (const r of [...(byId.data ?? []), ...(byTest.data ?? [])]) {
    map.set(Number(r.id), r as VcfWatchFingerprint);
  }
  return [...map.values()].sort((a, b) => a.id - b.id);
}

export function watchUnchanged(
  before: VcfWatchFingerprint[],
  after: VcfWatchFingerprint[]
): { pass: boolean; detail: string } {
  const a = new Map(before.map((r) => [r.id, fp(r)]));
  const b = new Map(after.map((r) => [r.id, fp(r)]));
  const ids = [23602, 23603, ...before.filter((r) => String(r.car_initial).toUpperCase() === "TEST").map((r) => r.id)];
  const unique = [...new Set(ids)];
  const changed: string[] = [];
  for (const id of unique) {
    if ((a.get(id) ?? "") !== (b.get(id) ?? "")) {
      const row = after.find((r) => r.id === id) ?? before.find((r) => r.id === id);
      changed.push(`${row?.car_initial ?? "?"} ${row?.car_number ?? id}`);
    }
  }
  const labels = after.map((r) => `${r.car_initial} ${r.car_number} (id ${r.id})`).join(", ");
  if (changed.length) {
    return { pass: false, detail: `Changed: ${changed.join(", ")}. Watched: ${labels}` };
  }
  return { pass: true, detail: `Unchanged: ${labels || "TEST 999011/999012, ids 23602/23603"}` };
}

async function pageAll<T>(
  db: SupabaseClient,
  table: string,
  cols: string,
  filter?: (q: any) => any
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    let q = db.from(table).select(cols).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < 1000) break;
    from += 1000;
  }
  return out;
}

export function buildVcfIntegrityChecks(args: {
  reviewProjectedTotal: number;
  reviewProjectedActive: number;
  fleetAfter: { cars: number; active: number; mismatch: number };
  openBefore: { activeMultiOpen: number; activeNoOpen: number };
  openAfter: { activeMultiOpen: number; activeNoOpen: number };
  watch: { pass: boolean; detail: string };
}): VcfIntegrityCheck[] {
  const { reviewProjectedTotal, reviewProjectedActive, fleetAfter, openBefore, openAfter, watch } = args;
  return [
    {
      id: "total_cars",
      label: "Total cars equals the review",
      pass: fleetAfter.cars === reviewProjectedTotal,
      detail: `After load ${fleetAfter.cars.toLocaleString()} · review ${reviewProjectedTotal.toLocaleString()}`,
    },
    {
      id: "active_cars",
      label: "Active cars equals the review",
      pass: fleetAfter.active === reviewProjectedActive,
      detail: `After load ${fleetAfter.active.toLocaleString()} · review ${reviewProjectedActive.toLocaleString()}`,
    },
    {
      id: "active_status_mismatch",
      label: "v_railcar_active_status_mismatch is 0",
      pass: fleetAfter.mismatch === 0,
      detail:
        fleetAfter.mismatch < 0
          ? "View missing or unreadable"
          : `${fleetAfter.mismatch} mismatch row${fleetAfter.mismatch === 1 ? "" : "s"}`,
    },
    {
      id: "not_in_file_unchanged",
      label: "Cars not in file unchanged (TEST 999011/999012, 23602/23603)",
      pass: watch.pass,
      detail: watch.detail,
    },
    {
      id: "multi_open",
      label: "Active cars with more than one open period did not increase from 66",
      pass: openAfter.activeMultiOpen <= 66 && openAfter.activeMultiOpen <= openBefore.activeMultiOpen,
      detail: `Before ${openBefore.activeMultiOpen} · after ${openAfter.activeMultiOpen} · cap 66`,
    },
    {
      id: "no_open",
      label: "Active cars with no open period did not increase from 27",
      pass: openAfter.activeNoOpen <= 27 && openAfter.activeNoOpen <= openBefore.activeNoOpen,
      detail: `Before ${openBefore.activeNoOpen} · after ${openAfter.activeNoOpen} · cap 27`,
    },
  ];
}
