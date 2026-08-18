/** First row of a 1:1 embed; PostgREST sometimes returns an array. */
export function asOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function cleanLeaseType(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s ? s : null;
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

/**
 * Car-level type from the master car list, else the MLA type the car is assigned under.
 * If one of them is Net / Full Service / Modified, that wins over a generic "Railcar Lease".
 */
export function resolveLeaseType(carType?: unknown, mlaType?: unknown): string | null {
  const car = cleanLeaseType(carType);
  const mla = cleanLeaseType(mlaType);
  if (car && isCommercialLeaseType(car)) return car;
  if (mla && isCommercialLeaseType(mla)) return mla;
  return car ?? mla;
}

export function leaseTypeFromAssignment(assignment: any, fallbackMla?: unknown): string | null {
  const rider = asOne(assignment?.rider);
  const mla = asOne(rider?.master_lease);
  return resolveLeaseType(assignment?.lease_type ?? null, mla?.lease_type ?? fallbackMla);
}

export const LEASE_TYPE_OPTIONS = [
  "Net Lease",
  "Full Service Lease",
  "Modified Lease",
  "Railcar Lease",
] as const;
