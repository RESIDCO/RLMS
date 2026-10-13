import { DEFAULT_TENANT_ID, q } from "../db";

export type CategoryHit = {
  category: string | null;
  sub_category: string | null;
  description: string | null;
};

/** Lookup category by job code + qualifier (combo), falling back to job code alone. */
export async function lookupRepairCategory(opts: {
  tenantId?: string;
  jobCode: string | null | undefined;
  qualifier?: string | null;
}): Promise<CategoryHit | null> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const job = (opts.jobCode ?? "").trim();
  if (!job) return null;
  const qual = (opts.qualifier ?? "").trim();
  const combo = qual ? `${job}|${qual}` : job;

  const exact = await q<CategoryHit>(
    `SELECT category, sub_category, description
     FROM repair.repair_categories
     WHERE tenant_id = $1 AND combo_key = $2 AND deleted_at IS NULL AND active
     LIMIT 1`,
    [tenantId, combo],
  );
  if (exact.rows[0]) return exact.rows[0];

  if (qual) {
    const byJob = await q<CategoryHit>(
      `SELECT category, sub_category, description
       FROM repair.repair_categories
       WHERE tenant_id = $1 AND job_code = $2
         AND (qualifier IS NULL OR qualifier = '')
         AND deleted_at IS NULL AND active
       LIMIT 1`,
      [tenantId, job],
    );
    if (byJob.rows[0]) return byJob.rows[0];
  }
  return null;
}

export async function listResponsibilityCodes(tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT code, display_name, description, is_public_aar, sort_order
     FROM repair.responsibility_codes
     WHERE tenant_id = $1 AND deleted_at IS NULL AND active
     ORDER BY sort_order ASC`,
    [tenantId],
  );
  return rows;
}
