/** Turn empty date-input strings into null so Postgres date columns accept the write. */
export function nullifyEmptyDateStrings<T extends Record<string, unknown>>(
  obj: T,
  dateKeys: (keyof T)[],
): T {
  for (const key of dateKeys) {
    if (obj[key] === "") {
      (obj as Record<string, unknown>)[key as string] = null;
    }
  }
  return obj;
}

export const MASTER_LEASE_DATE_KEYS = ["effective_date"] as const;
export const RIDER_DATE_KEYS = ["effective_date", "expiration_date"] as const;
export const RAILCAR_DATE_KEYS = [
  "acquisition_date",
  "build_date",
  "lease_start_date",
  "lease_end_date",
  "lease_expiry",
  "estimated_lease_expiry",
] as const;
