/**
 * Rider columns that importers must never write.
 * riders.account_manager is deprecated (unused) but still named here so a
 * stale payload cannot write it.
 */
export const RIDER_IMPORT_NEVER_WRITE = [
  "account_manager",
  "status_tag",
  "owner_entity",
] as const;

/**
 * Railcar columns that importers must never write.
 * One-time loads (and later manual edits) are the only writers.
 */
export const RAILCAR_IMPORT_NEVER_WRITE = ["equipment_type_code"] as const;

/**
 * Account columns that importers must never write.
 * Account Management is the only writer of accounts.account_manager.
 * Master Car List may insert accounts (name only) via ensureAccountForLessee.
 */
export const ACCOUNT_IMPORT_NEVER_WRITE = ["account_manager"] as const;

/**
 * Only these rider columns may be filled by Financial Data Refresh fill-if-blank.
 * Adding a field here is a deliberate allow — account_manager is not on this list
 * and is also named in RIDER_IMPORT_NEVER_WRITE so it cannot sneak in.
 */
export const RIDER_FINANCIAL_FILL_BLANK_FIELDS = ["monthly_rent_per_car"] as const;

/**
 * Rider columns written by lease-date governance (Asset Report first, V_Valid fallback).
 * Does not write effective_date — that field is already populated on nearly all riders.
 */
export const RIDER_LEASE_GOVERNANCE_FIELDS = [
  "expiration_date",
  "expiration_source",
  "expiration_snapshot_month",
] as const;

/**
 * Only these rider columns may be patched by VCF post-commit expiration sync.
 * @deprecated Prefer RIDER_LEASE_GOVERNANCE_FIELDS via governLeaseDates.
 */
export const RIDER_VCF_EXPIRATION_SYNC_FIELDS = ["expiration_date", "effective_date"] as const;

type NeverWrite = (typeof RIDER_IMPORT_NEVER_WRITE)[number];

function isNeverWrite(key: string): key is NeverWrite {
  return (RIDER_IMPORT_NEVER_WRITE as readonly string[]).includes(key);
}

/** Throws if a railcar insert/update payload includes a never-write column. */
export function assertRailcarImporterPatch(patch: Record<string, unknown>): void {
  for (const key of Object.keys(patch)) {
    if ((RAILCAR_IMPORT_NEVER_WRITE as readonly string[]).includes(key)) {
      throw new Error(
        `Importer refused to write railcars.${key} — one-time loaded fields cannot be written by importers.`,
      );
    }
  }
}

/** Throws if a rider insert/update payload includes a never-write column. */
export function assertRiderImporterPatch(patch: Record<string, unknown>): void {
  for (const key of Object.keys(patch)) {
    if (isNeverWrite(key)) {
      throw new Error(
        `Importer refused to write riders.${key} — Account Management / unused rider columns cannot be written by importers.`,
      );
    }
  }
}

/** Throws if an accounts insert/update payload includes a never-write column. */
export function assertAccountImporterPatch(patch: Record<string, unknown>): void {
  for (const key of Object.keys(patch)) {
    if ((ACCOUNT_IMPORT_NEVER_WRITE as readonly string[]).includes(key)) {
      throw new Error(
        `Importer refused to write accounts.${key} — Account Management is the only writer.`,
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

export function riderLeaseGovernancePayload(
  patch: Partial<Record<(typeof RIDER_LEASE_GOVERNANCE_FIELDS)[number], string | null>>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
    if (!(RIDER_LEASE_GOVERNANCE_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`Lease governance does not allow riders.${String(key)}`);
    }
    const v = patch[key];
    if (v !== undefined) out[key] = v;
  }
  assertRiderImporterPatch(out);
  return out;
}
