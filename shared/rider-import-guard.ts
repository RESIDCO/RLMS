/**
 * Rider columns that importers must never write.
 * Lease Management (Edit Rider) is the only writer of these fields.
 */
export const RIDER_IMPORT_NEVER_WRITE = ["account_manager"] as const;

/**
 * Only these rider columns may be filled by Financial Data Refresh fill-if-blank.
 * Adding a field here is a deliberate allow — account_manager is not on this list
 * and is also named in RIDER_IMPORT_NEVER_WRITE so it cannot sneak in.
 */
export const RIDER_FINANCIAL_FILL_BLANK_FIELDS = ["monthly_rent_per_car"] as const;

/**
 * Only these rider columns may be patched by VCF post-commit expiration sync.
 */
export const RIDER_VCF_EXPIRATION_SYNC_FIELDS = ["expiration_date", "effective_date"] as const;

type NeverWrite = (typeof RIDER_IMPORT_NEVER_WRITE)[number];

function isNeverWrite(key: string): key is NeverWrite {
  return (RIDER_IMPORT_NEVER_WRITE as readonly string[]).includes(key);
}

/** Throws if a rider insert/update payload includes a never-write column. */
export function assertRiderImporterPatch(patch: Record<string, unknown>): void {
  for (const key of Object.keys(patch)) {
    if (isNeverWrite(key)) {
      throw new Error(
        `Importer refused to write riders.${key} — Lease Management is the only writer.`,
      );
    }
  }
}

export function riderFinancialFillBlankPayload(
  field: (typeof RIDER_FINANCIAL_FILL_BLANK_FIELDS)[number],
  value: unknown,
): Record<string, unknown> {
  if (!(RIDER_FINANCIAL_FILL_BLANK_FIELDS as readonly string[]).includes(field)) {
    throw new Error(`Financial fill-blank does not allow riders.${field}`);
  }
  const payload = { [field]: value };
  assertRiderImporterPatch(payload);
  return payload;
}

export function riderVcfExpirationSyncPayload(
  patch: Partial<Record<(typeof RIDER_VCF_EXPIRATION_SYNC_FIELDS)[number], string | null>>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
    if (!(RIDER_VCF_EXPIRATION_SYNC_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`VCF expiration sync does not allow riders.${String(key)}`);
    }
    const v = patch[key];
    if (v !== undefined) out[key] = v;
  }
  assertRiderImporterPatch(out);
  return out;
}
