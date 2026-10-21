/**
 * Straight-line value and the scrap floor for Deal Calculator v2.
 * Pure. The AAR cap is 50 years for every car, regardless of build date.
 */

export const AAR_CAP_YEARS = 50;
export const STORAGE_DAYS_PER_MONTH = 30.4;
export const DEFAULT_SCRAP_PER_GROSS_TON = 348;
export const DEFAULT_DISMANTLE_HAUL_PER_CAR = 1500;
export const GROSS_TON_LB = 2240;

export const CAR_TYPE_CLASSES = [
  "covered_hopper",
  "gondola",
  "boxcar",
  "gs_tank",
  "pressure_tank",
  "other",
] as const;
export type CarTypeClass = (typeof CAR_TYPE_CLASSES)[number];

export const DEPRECIATION_BASES = ["replacement", "historical"] as const;
export type DepreciationBasis = (typeof DEPRECIATION_BASES)[number];

export const USEFUL_LIFE_BY_CLASS: Record<CarTypeClass, number> = {
  covered_hopper: 45,
  gondola: 45,
  boxcar: 40,
  gs_tank: 40,
  pressure_tank: 45,
  other: 40,
};

export type YmdParts = { y: number; m: number; d: number };

export function isCarTypeClass(value: unknown): value is CarTypeClass {
  return typeof value === "string" && (CAR_TYPE_CLASSES as readonly string[]).includes(value);
}

export function isDepreciationBasis(value: unknown): value is DepreciationBasis {
  return value === "replacement" || value === "historical";
}

export function isTankClass(carClass: CarTypeClass | null | undefined): boolean {
  return carClass === "gs_tank" || carClass === "pressure_tank";
}

export function lifeDefaultForClass(carClass: CarTypeClass): number {
  return USEFUL_LIFE_BY_CLASS[carClass];
}

/** Entries above 50 are clamped. The cap applies to every car. */
export function clampUsefulLife(years: number): { life: number; clamped: boolean } {
  if (!Number.isFinite(years)) return { life: AAR_CAP_YEARS, clamped: false };
  if (years > AAR_CAP_YEARS) return { life: AAR_CAP_YEARS, clamped: true };
  return { life: years, clamped: false };
}

/**
 * Infer the class that drives life defaults and tank cleaning.
 * AAR mechanical letters: A/B box, C covered hopper, E/G gondola, T tank.
 */
export function inferCarTypeClass(carType: string | null | undefined, aarCode: string | null | undefined): CarTypeClass {
  const text = `${carType ?? ""} ${aarCode ?? ""}`.toLowerCase();
  const letter = (aarCode ?? "").trim().charAt(0).toUpperCase();
  const pressure = /pressure|dot[-\s]?11[245]|t[78]\d|112j|105j/.test(text) || letter === "P";
  const tank = /tank/.test(text) || letter === "T";
  if (tank && pressure) return "pressure_tank";
  if (tank) return "gs_tank";
  if (/covered|hopper/.test(text) || letter === "C" || letter === "H" || letter === "K") return "covered_hopper";
  if (/gondola/.test(text) || letter === "E" || letter === "G") return "gondola";
  if (/box/.test(text) || letter === "A" || letter === "B") return "boxcar";
  return "other";
}

export function classLabel(carClass: CarTypeClass): string {
  switch (carClass) {
    case "covered_hopper":
      return "Covered hopper";
    case "gondola":
      return "Gondola";
    case "boxcar":
      return "Boxcar";
    case "gs_tank":
      return "General-service tank";
    case "pressure_tank":
      return "Pressure tank";
    case "other":
      return "Other";
    default: {
      const neverClass: never = carClass;
      return neverClass;
    }
  }
}

/** Age in years as months/12, with a day fraction so 49.9 and 50.0 can be told apart. */
export function ageYears(build: YmdParts | null, on: YmdParts): number | null {
  if (!build) return null;
  const months = (on.y - build.y) * 12 + (on.m - build.m) + (on.d - build.d) / 30;
  return months / 12;
}

export function addYearsYmd(date: YmdParts, years: number): YmdParts {
  const y = date.y + years;
  const dim = new Date(Date.UTC(y, date.m, 0)).getUTCDate();
  return { y, m: date.m, d: Math.min(date.d, dim) };
}

export function aarLimitDate(build: YmdParts | null): YmdParts | null {
  if (!build) return null;
  return addYearsYmd(build, AAR_CAP_YEARS);
}

export function scrapFloorPerCar(input: {
  tareLb: number | null;
  scrapPerGrossTon: number;
  dismantleHaulPerCar: number;
  tankCleaningPerCar: number | null;
  isTank: boolean;
}): number | null {
  if (input.tareLb == null || !Number.isFinite(input.tareLb)) return null;
  const cleaning = input.isTank ? input.tankCleaningPerCar ?? 0 : 0;
  const gross = (input.tareLb / GROSS_TON_LB) * input.scrapPerGrossTon - input.dismantleHaulPerCar - cleaning;
  return Math.max(0, gross);
}

/** Remaining-life fraction. Null when age or the cost is missing. */
export function straightLineValue(cost: number | null, age: number | null, lifeYears: number): number | null {
  if (cost == null || !Number.isFinite(cost) || age == null || !Number.isFinite(age)) return null;
  const life = lifeYears > 0 ? lifeYears : 0;
  if (life <= 0) return Math.max(0, 0);
  return cost * Math.max(0, 1 - age / life);
}

export type BasisResolution = {
  basis: DepreciationBasis | null;
  badge: string | null;
  active: boolean;
  cost: number | null;
};

/**
 * Explicit basis wins. Otherwise a cost on the scenario picks Replacement
 * when OEC is blank and Historical when OEC is filled. No choice and no cost
 * leaves depreciation off, so old scenarios do not move.
 */
export function resolveDepreciationBasis(input: {
  explicit: DepreciationBasis | null;
  newCarCost: number | null;
  newCarCostSource: string;
  oec: number | null;
}): BasisResolution {
  const hasCost = input.newCarCost != null || input.oec != null;
  if (input.explicit == null && !hasCost) {
    return { basis: null, badge: null, active: false, cost: null };
  }
  const basis: DepreciationBasis = input.explicit ?? (input.oec != null ? "historical" : "replacement");
  if (basis === "historical") {
    return { basis, badge: "Historical OEC", active: true, cost: input.oec };
  }
  const manual = input.newCarCostSource === "user";
  return {
    basis,
    badge: manual ? "Replacement (manual)" : "Replacement (assumption-set default)",
    active: true,
    cost: input.newCarCost,
  };
}

/** max(SL, floor). A null term is ignored. Null when both are null. At or past the AAR cap, the floor wins. */
export function valueAtAge(input: {
  age: number | null;
  lifeYears: number;
  cost: number | null;
  floor: number | null;
  depreciationActive: boolean;
}): number | null {
  const pastCap = input.age != null && input.age >= AAR_CAP_YEARS;
  if (pastCap) return input.floor;
  const sl = input.depreciationActive ? straightLineValue(input.cost, input.age, input.lifeYears) : null;
  if (sl == null && input.floor == null) return null;
  if (sl == null) return input.floor;
  if (input.floor == null) return sl;
  return Math.max(sl, input.floor);
}

export function formatValueOrDash(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}
