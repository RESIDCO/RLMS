/**
 * Fleet source of truth for car age is `railcars.build_year` (Master Car List /
 * Fleet Registry / import). `railcars.built_year` is the older DV-calculator
 * column — still written on import so UMLER/DV lookups keep working, but fleet
 * UI and age KPIs must not treat it as a second independent field.
 */
export function carBuildYear(car: {
  build_year?: number | string | null;
  built_year?: number | string | null;
}): number | null {
  const raw = car.build_year ?? car.built_year;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const year = Math.trunc(n);
  if (year < 1800 || year > 2100) return null;
  return year;
}

export type Turning50Tile = { year: number; count: number };

export type Turning50Summary = {
  tiles: Turning50Tile[];
  unknown_count: number;
  known_count: number;
  operating_count: number;
};

/** Fleet-age year from `build_year` only — not the DV `built_year` fallback. */
export function fleetBuildYear(car: { build_year?: number | string | null }): number | null {
  const raw = car.build_year;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const year = Math.trunc(n);
  if (year < 1800 || year > 2100) return null;
  return year;
}

/** Count active cars whose build_year + 50 equals this year … this year + horizon. */
export function turning50ByYear(
  cars: Array<{ build_year?: number | string | null; built_year?: number | string | null }>,
  fromYear = new Date().getFullYear(),
  horizon = 3
): Turning50Summary {
  const years = Array.from({ length: horizon + 1 }, (_, i) => fromYear + i);
  const counts = new Map<number, number>(years.map((y) => [y, 0]));
  let unknown = 0;
  for (const c of cars) {
    const built = fleetBuildYear(c);
    if (built == null) {
      unknown += 1;
      continue;
    }
    const turn = built + 50;
    if (counts.has(turn)) counts.set(turn, (counts.get(turn) ?? 0) + 1);
  }
  return {
    tiles: years.map((year) => ({ year, count: counts.get(year) ?? 0 })),
    unknown_count: unknown,
    known_count: cars.length - unknown,
    operating_count: cars.length,
  };
}
