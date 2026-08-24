/**
 * Display helpers for lease type badges.
 *
 * master_leases.lease_type is a human-maintained field (Lease Management only).
 * railcars.lease_type is car-level VCF data and is separate.
 */

/** First row of a 1:1 embed; PostgREST sometimes returns an array. */
export function asOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function clean(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

/** Net / full service / modified — commercial MLA types. */
export function isCommercialLeaseType(raw: string): boolean {
  const n = raw.toLowerCase().replace(/[_-]+/g, " ");
  return (
    n.includes("net") ||
    n.includes("full service") ||
    n.includes("fullservice") ||
    n.includes("modified")
  );
}

/**
 * Car-level badge: prefer the car's own VCF type when set; otherwise the MLA
 * type the car is assigned under (stored master_leases.lease_type — never computed).
 */
export function resolveLeaseType(carType?: unknown, mlaType?: unknown): string | null {
  const car = clean(carType);
  if (car) return car;
  return clean(mlaType);
}

export function leaseTypeFromAssignment(assignment: any, fallbackMla?: unknown): string | null {
  const rider = asOne(assignment?.rider);
  const mla = asOne(rider?.master_lease);
  return resolveLeaseType(assignment?.lease_type ?? null, mla?.lease_type ?? fallbackMla);
}

/** Allowed values for human-edited master_leases.lease_type. */
export const LEASE_TYPE_OPTIONS = [
  "Net Lease",
  "Full Service Lease",
  "Modified Lease",
] as const;
