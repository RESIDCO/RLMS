/**
 * Code hover help from licensed AAR ref tables (+ non-licensed seed fallbacks).
 * Unknown → "Not in reference table".
 */
import { DEFAULT_TENANT_ID, q } from "../db";

export type RefLookupKind =
  | "job"
  | "qualifier"
  | "why_made"
  | "location"
  | "condition"
  | "responsibility"
  | "car_part"
  | "category";

export type RefLookupHit = {
  kind: RefLookupKind;
  code: string;
  found: boolean;
  description: string;
  category?: string | null;
  sub_category?: string | null;
  source?: string | null;
  rule_page?: string | null;
  effective_quarter?: string | null;
  edition?: string | null;
  fromTable: string;
};

const NOT_FOUND = "Not in reference table";

async function firstHit(
  kind: RefLookupKind,
  code: string,
  queries: Array<{ sql: string; params: unknown[]; table: string }>,
): Promise<RefLookupHit> {
  for (const qy of queries) {
    const { rows } = await q<{
      description: string | null;
      category?: string | null;
      sub_category?: string | null;
      source?: string | null;
      rule_page?: string | null;
      effective_quarter?: string | null;
      edition?: string | null;
    }>(qy.sql, qy.params);
    const r = rows[0];
    if (r) {
      return {
        kind,
        code,
        found: true,
        description: r.description?.trim() || code,
        category: r.category ?? null,
        sub_category: r.sub_category ?? null,
        source: r.source ?? null,
        rule_page: r.rule_page ?? null,
        effective_quarter: r.effective_quarter ?? null,
        edition: r.edition ?? null,
        fromTable: qy.table,
      };
    }
  }
  return {
    kind,
    code,
    found: false,
    description: NOT_FOUND,
    fromTable: "none",
  };
}

export async function lookupRefCode(opts: {
  kind: RefLookupKind;
  code: string;
  qualifier?: string | null;
  tenantId?: string;
}): Promise<RefLookupHit> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const code = (opts.code ?? "").trim();
  if (!code) {
    return {
      kind: opts.kind,
      code: "",
      found: false,
      description: NOT_FOUND,
      fromTable: "none",
    };
  }
  const qual = (opts.qualifier ?? "").trim();

  switch (opts.kind) {
    case "job":
      return firstHit(opts.kind, code, [
        {
          table: "repair.ref_job_codes",
          sql: `SELECT description, category, sub_category, source, rule_page, effective_quarter, edition
                FROM repair.ref_job_codes
                WHERE tenant_id=$1 AND job_code=$2 AND deleted_at IS NULL AND active LIMIT 1`,
          params: [tenantId, code],
        },
        {
          table: "repair.repair_categories",
          sql: `SELECT description, category, sub_category, NULL::text AS source, NULL::text AS rule_page,
                       NULL::text AS effective_quarter, NULL::text AS edition
                FROM repair.repair_categories
                WHERE tenant_id=$1 AND job_code=$2
                  AND (qualifier IS NULL OR qualifier='')
                  AND deleted_at IS NULL AND active LIMIT 1`,
          params: [tenantId, code],
        },
      ]);
    case "qualifier": {
      const queries: Array<{ sql: string; params: unknown[]; table: string }> = [];
      if (qual) {
        // When caller passes job as code and qualifier separately via opts — prefer job+qual
        queries.push({
          table: "repair.ref_qualifiers",
          sql: `SELECT description, category, sub_category, source, rule_page, effective_quarter, edition
                FROM repair.ref_qualifiers
                WHERE tenant_id=$1 AND job_code=$2 AND qualifier=$3
                  AND deleted_at IS NULL AND active LIMIT 1`,
          params: [tenantId, code, qual],
        });
      }
      queries.push({
        table: "repair.ref_qualifiers",
        sql: `SELECT description, category, sub_category, source, rule_page, effective_quarter, edition
              FROM repair.ref_qualifiers
              WHERE tenant_id=$1 AND qualifier=$2 AND deleted_at IS NULL AND active LIMIT 1`,
        params: [tenantId, code],
      });
      // Also allow lookup where `code` is the qualifier alone
      return firstHit(opts.kind, qual ? `${code}|${qual}` : code, queries);
    }
    case "why_made":
      return firstHit(opts.kind, code, [
        {
          table: "repair.ref_why_made",
          sql: `SELECT description, NULL::text AS category, NULL::text AS sub_category,
                       source, rule_page, effective_quarter, edition
                FROM repair.ref_why_made
                WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL AND active LIMIT 1`,
          params: [tenantId, code],
        },
        {
          table: "repair.why_made_codes",
          sql: `SELECT description, NULL::text AS category, NULL::text AS sub_category,
                       NULL::text AS source, NULL::text AS rule_page,
                       NULL::text AS effective_quarter, NULL::text AS edition
                FROM repair.why_made_codes
                WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL AND active LIMIT 1`,
          params: [tenantId, code],
        },
      ]);
    case "location":
      return firstHit(opts.kind, code, [
        {
          table: "repair.ref_location_codes",
          sql: `SELECT description, NULL::text AS category, NULL::text AS sub_category,
                       source, rule_page, effective_quarter, edition
                FROM repair.ref_location_codes
                WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL AND active LIMIT 1`,
          params: [tenantId, code],
        },
      ]);
    case "condition":
      return firstHit(opts.kind, code, [
        {
          table: "repair.ref_condition_codes",
          sql: `SELECT description, NULL::text AS category, NULL::text AS sub_category,
                       source, rule_page, effective_quarter, edition
                FROM repair.ref_condition_codes
                WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL AND active LIMIT 1`,
          params: [tenantId, code],
        },
      ]);
    case "responsibility":
      return firstHit(opts.kind, code, [
        {
          table: "repair.ref_responsibility_codes",
          sql: `SELECT description, NULL::text AS category, NULL::text AS sub_category,
                       source, rule_page, effective_quarter, edition
                FROM repair.ref_responsibility_codes
                WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL AND active LIMIT 1`,
          params: [tenantId, code],
        },
        {
          table: "repair.responsibility_codes",
          sql: `SELECT COALESCE(description, display_name) AS description,
                       NULL::text AS category, NULL::text AS sub_category,
                       NULL::text AS source, NULL::text AS rule_page,
                       NULL::text AS effective_quarter, NULL::text AS edition
                FROM repair.responsibility_codes
                WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL AND active LIMIT 1`,
          params: [tenantId, code],
        },
      ]);
    case "car_part":
      return firstHit(opts.kind, code, [
        {
          table: "repair.ref_car_part_codes",
          sql: `SELECT description, category, sub_category, source, rule_page, effective_quarter, edition
                FROM repair.ref_car_part_codes
                WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL AND active LIMIT 1`,
          params: [tenantId, code],
        },
      ]);
    case "category": {
      const combo = qual ? `${code}|${qual}` : code;
      return firstHit(opts.kind, combo, [
        {
          table: "repair.ref_repair_categories",
          sql: `SELECT description, category, sub_category, source, rule_page, effective_quarter, edition
                FROM repair.ref_repair_categories
                WHERE tenant_id=$1 AND combo_key=$2 AND deleted_at IS NULL AND active LIMIT 1`,
          params: [tenantId, combo],
        },
        {
          table: "repair.repair_categories",
          sql: `SELECT description, category, sub_category, NULL::text AS source, NULL::text AS rule_page,
                       NULL::text AS effective_quarter, NULL::text AS edition
                FROM repair.repair_categories
                WHERE tenant_id=$1 AND combo_key=$2 AND deleted_at IS NULL AND active LIMIT 1`,
          params: [tenantId, combo],
        },
      ]);
    }
    default:
      return {
        kind: opts.kind,
        code,
        found: false,
        description: NOT_FOUND,
        fromTable: "none",
      };
  }
}

export async function getRefDataCounts(tenantId = DEFAULT_TENANT_ID) {
  const tables = [
    "ref_job_codes",
    "ref_qualifiers",
    "ref_why_made",
    "ref_condition_codes",
    "ref_location_codes",
    "ref_responsibility_codes",
    "ref_car_part_codes",
    "ref_repair_categories",
    "ref_job_code_prices",
    "component_id_rules",
  ] as const;
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const { rows } = await q<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM repair.${t}
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId],
    );
    counts[t] = Number(rows[0]?.n ?? 0);
  }
  return counts;
}
