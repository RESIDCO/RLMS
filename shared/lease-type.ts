/**
 * Derive rider/MLA lease type from underlying railcars.lease_type.
 * master_leases.lease_type is not SoT (was hardcoded "Net Lease" on backfill).
 */
export type LeaseTypeBreakdown = { type: string; count: number };

export type DerivedLeaseType = {
  /** Single agreed value, "Mixed", or null when no cars have a type. */
  label: string | null;
  mixed: boolean;
  breakdown: LeaseTypeBreakdown[];
  carCount: number;
  /** True when derived from inactive cars only (dead rider/MLA fallback). */
  fromInactive: boolean;
};

function clean(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

/** Canonicalize known VCF casing/spelling variants so Idle≠IDLE does not look "Mixed". */
export function normalizeLeaseTypeLabel(raw: unknown): string | null {
  const s = clean(raw);
  if (!s) return null;
  const key = s.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (key === "idle") return "IDLE";
  if (key === "net lease" || key === "net") return "Net Lease";
  if (key === "full service lease" || key === "full service" || key === "fullservice") {
    return "Full Service Lease";
  }
  if (key === "modified lease" || key === "modified") return "Modified Lease";
  if (key === "railcar lease") return "Railcar Lease";
  if (/^net\s*\(?\s*sold\s*\)?$/.test(key)) return "NET (Sold)";
  return s;
}

/**
 * Aggregate lease types from car rows.
 * Prefer active cars; if none have a type (or no active cars), fall back to inactive.
 */
export function deriveLeaseTypeFromCars(
  cars: Array<{ lease_type?: unknown; active?: boolean | null }>
): DerivedLeaseType {
  const active = cars.filter((c) => c.active === true);
  const inactive = cars.filter((c) => c.active !== true);

  const tryPool = (pool: typeof cars, fromInactive: boolean): DerivedLeaseType | null => {
    const counts = new Map<string, number>();
    let typed = 0;
    for (const c of pool) {
      const t = normalizeLeaseTypeLabel(c.lease_type);
      if (!t) continue;
      typed += 1;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    if (typed === 0) return null;
    const breakdown = [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
    const mixed = breakdown.length > 1;
    return {
      label: mixed ? "Mixed" : breakdown[0].type,
      mixed,
      breakdown,
      carCount: pool.length,
      fromInactive,
    };
  };

  return (
    tryPool(active, false) ??
    tryPool(inactive, true) ?? {
      label: null,
      mixed: false,
      breakdown: [],
      carCount: cars.length,
      fromInactive: active.length === 0 && inactive.length > 0,
    }
  );
}

/**
 * Car badge: prefer the car's own type. Do not fall back to a stale MLA
 * "Net Lease" default — only use mlaType when the car has no type of its own.
 */
export function resolveLeaseType(carType?: unknown, mlaType?: unknown): string | null {
  const car = clean(carType);
  if (car) return car;
  const mla = clean(mlaType);
  if (mla && mla.toLowerCase() !== "mixed") return mla;
  return null;
}

/** First row of a 1:1 embed; PostgREST sometimes returns an array. */
export function asOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

/** Net / full service / modified — the commercial types Bruce looks for. */
export function isCommercialLeaseType(raw: string): boolean {
  const n = raw.toLowerCase().replace(/[_-]+/g, " ");
  return (
    n.includes("net") ||
    n.includes("full service") ||
    n.includes("fullservice") ||
    n.includes("modified")
  );
}

export function leaseTypeFromAssignment(assignment: any, fallbackMla?: unknown): string | null {
  return resolveLeaseType(assignment?.lease_type ?? null, fallbackMla);
}

export const LEASE_TYPE_OPTIONS = [
  "Net Lease",
  "Full Service Lease",
  "Modified Lease",
  "Railcar Lease",
] as const;

/** Stored column sentinel for mixed MLAs (live display still recomputes). */
export const MIXED_LEASE_TYPE = "Mixed";

/** Majority type for storage when mixed; otherwise the single value or Mixed sentinel. */
export function storedLeaseTypeFromDerived(d: DerivedLeaseType): string | null {
  if (!d.label) return null;
  if (d.mixed) return MIXED_LEASE_TYPE;
  return d.label;
}
