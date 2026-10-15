/**
 * Code hover help from licensed AAR ref tables (+ RESIDCO internal 8000-series).
 * Qualifier / removed_qualifier: multi-path a–e (job-dependent; no qualifier-only fallback).
 */
import { DEFAULT_TENANT_ID, q } from "../db";

export type RefLookupKind =
  | "job"
  | "qualifier"
  | "removed_qualifier"
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
  /** When multiple chart rows match, each labeled line. */
  descriptions?: string[];
  category?: string | null;
  sub_category?: string | null;
  source?: string | null;
  rule_page?: string | null;
  effective_quarter?: string | null;
  edition?: string | null;
  fromTable: string;
  /** false when row is soft-retired (still resolves for old estimates). */
  active?: boolean;
  retired?: boolean;
  warning?: string;
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
      active?: boolean | null;
    }>(qy.sql, qy.params);
    const r = rows[0];
    if (r) {
      const active = r.active == null ? true : Boolean(r.active);
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
        active,
        retired: !active,
        warning: active
          ? undefined
          : "Retired code — shown for historical estimates; do not use on new lines",
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

function normalizeQualifier(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase();
}

function isBlankOrZeroQualifier(q: string): boolean {
  return q === "" || q === "00" || q === "0" || q === "0 ";
}

function isLettersOnly(q: string): boolean {
  return /^[A-Z]+$/.test(q);
}

function isNumericQualifier(q: string): boolean {
  return /^\d+$/.test(q);
}

function isResidcoInternalJob(job: string): boolean {
  const n = Number(job);
  return Number.isFinite(n) && n >= 8000 && n < 9000;
}

async function validQualifiersForJob(
  tenantId: string,
  jobCode: string,
): Promise<string[]> {
  const { rows } = await q<{ qualifier: string }>(
    `SELECT qualifier FROM repair.ref_qualifiers
     WHERE tenant_id = $1 AND job_code = $2 AND deleted_at IS NULL
     ORDER BY qualifier`,
    [tenantId, jobCode],
  );
  if (rows.length) return rows.map((r) => String(r.qualifier));
  const { rows: jobRows } = await q<{ price_list_qualifier: string | null }>(
    `SELECT price_list_qualifier FROM repair.ref_job_codes
     WHERE tenant_id = $1 AND job_code = $2 AND deleted_at IS NULL LIMIT 1`,
    [tenantId, jobCode],
  );
  const pl = jobRows[0]?.price_list_qualifier?.trim();
  return pl ? pl.split(/[|,]/).map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * Qualifier / removed_qualifier multi-path lookup.
 * `code` = job code (applied or removed); `qualifier` = the qualifier value.
 */
export async function lookupQualifier(opts: {
  kind: "qualifier" | "removed_qualifier";
  jobCode: string;
  qualifier: string | null | undefined;
  tenantId?: string;
}): Promise<RefLookupHit> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const jobCode = (opts.jobCode ?? "").trim();
  const qual = normalizeQualifier(opts.qualifier);
  const displayCode = jobCode ? `${jobCode}|${qual || "00"}` : qual || "00";

  // a. blank / "00" → No qualifier
  if (isBlankOrZeroQualifier(qual)) {
    return {
      kind: opts.kind,
      code: displayCode,
      found: true,
      description: "No qualifier",
      fromTable: "synthetic",
    };
  }

  // b. job + qualifier in ref_qualifiers
  if (jobCode) {
    const { rows } = await q<{
      description: string | null;
      category: string | null;
      sub_category: string | null;
      source: string | null;
      rule_page: string | null;
      effective_quarter: string | null;
      edition: string | null;
      active: boolean;
    }>(
      `SELECT description, category, sub_category, source, rule_page, effective_quarter, edition, active
       FROM repair.ref_qualifiers
       WHERE tenant_id = $1 AND job_code = $2 AND UPPER(qualifier) = $3
         AND deleted_at IS NULL
       ORDER BY active DESC
       LIMIT 1`,
      [tenantId, jobCode, qual],
    );
    if (rows[0]) {
      const active = Boolean(rows[0].active);
      return {
        kind: opts.kind,
        code: displayCode,
        found: true,
        description: rows[0].description?.trim() || qual,
        category: rows[0].category,
        sub_category: rows[0].sub_category,
        source: rows[0].source,
        rule_page: rows[0].rule_page,
        effective_quarter: rows[0].effective_quarter,
        edition: rows[0].edition,
        fromTable: "repair.ref_qualifiers",
        active,
        retired: !active,
        warning: active
          ? undefined
          : "Retired code — shown for historical estimates; do not use on new lines",
      };
    }
  }

  // Resolve job's price-list qualifier (VZ → car part)
  let priceListQual: string | null = null;
  let jobRule: string | null = null;
  if (jobCode) {
    const { rows: jobRows } = await q<{
      price_list_qualifier: string | null;
      rule: string | null;
    }>(
      `SELECT price_list_qualifier, rule FROM repair.ref_job_codes
       WHERE tenant_id = $1 AND job_code = $2 AND deleted_at IS NULL LIMIT 1`,
      [tenantId, jobCode],
    );
    priceListQual = jobRows[0]?.price_list_qualifier?.trim().toUpperCase() ?? null;
    jobRule = jobRows[0]?.rule != null ? String(jobRows[0].rule).trim() : null;
  }

  // c. letters-only, or job's price-list qualifier is VZ → generic car part
  if (isLettersOnly(qual) || priceListQual === "VZ") {
    const { rows } = await q<{
      description: string | null;
      category: string | null;
      sub_category: string | null;
      source: string | null;
      rule_page: string | null;
      effective_quarter: string | null;
      edition: string | null;
    }>(
      `SELECT description, category, sub_category, source, rule_page, effective_quarter, edition, active
       FROM repair.ref_qualifier_generic
       WHERE tenant_id = $1 AND UPPER(qualifier) = $2
         AND deleted_at IS NULL
       ORDER BY active DESC
       LIMIT 1`,
      [tenantId, qual],
    );
    if (rows[0]) {
      const desc = rows[0].description?.trim() || qual;
      const active = Boolean((rows[0] as { active?: boolean }).active ?? true);
      return {
        kind: opts.kind,
        code: displayCode,
        found: true,
        description: `Car part: ${desc}`,
        category: rows[0].category,
        sub_category: rows[0].sub_category,
        source: rows[0].source,
        rule_page: rows[0].rule_page,
        effective_quarter: rows[0].effective_quarter,
        edition: rows[0].edition,
        fromTable: "repair.ref_qualifier_generic",
        active,
        retired: !active,
        warning: active
          ? undefined
          : "Retired code — shown for historical estimates; do not use on new lines",
      };
    }
    // Also try legacy car_part_codes
    const car = await firstHit(opts.kind, displayCode, [
      {
        table: "repair.ref_car_part_codes",
        sql: `SELECT description, category, sub_category, source, rule_page, effective_quarter, edition, active
              FROM repair.ref_car_part_codes
              WHERE tenant_id=$1 AND UPPER(code)=$2 AND deleted_at IS NULL ORDER BY active DESC LIMIT 1`,
        params: [tenantId, qual],
      },
    ]);
    if (car.found) {
      return {
        ...car,
        description: `Car part: ${car.description}`,
      };
    }
  }

  // d. numeric → job's rule → every matching chart row
  if (isNumericQualifier(qual) && jobRule) {
    const { rows } = await q<{
      chart_group: string | null;
      description: string | null;
      chart_title: string | null;
      source: string | null;
      rule_page: string | null;
      effective_quarter: string | null;
      edition: string | null;
      job_codes_using_chart: string | null;
    }>(
      `SELECT chart_group, description, chart_title, source, rule_page,
              effective_quarter, edition, job_codes_using_chart
       FROM repair.ref_qualifier_charts
       WHERE tenant_id = $1 AND rule = $2 AND UPPER(qualifier) = $3
         AND deleted_at IS NULL
       ORDER BY chart_group NULLS FIRST, chart_title NULLS FIRST`,
      [tenantId, jobRule, qual],
    );
    const matched = rows.filter((r) => {
      const jobs = (r.job_codes_using_chart ?? "").trim();
      if (!jobs || !jobCode) return true;
      const set = new Set(
        jobs.split("|").map((s) => s.trim()).filter(Boolean),
      );
      return set.has(jobCode);
    });
    // If job-filtered empty but rows exist for the rule, still show all candidates
    // (brief: list multiple, e.g. 1144/01 — rule may have several charts)
    const use = matched.length ? matched : rows;
    if (use.length) {
      const lines = use.map((r) => {
        const group = (r.chart_group ?? "").trim() || "?";
        const desc = r.description?.trim() || qual;
        return `Chart / Group ${group}: ${desc}`;
      });
      return {
        kind: opts.kind,
        code: displayCode,
        found: true,
        description: lines.join("; "),
        descriptions: lines,
        source: use[0]?.source ?? null,
        rule_page: use[0]?.rule_page ?? null,
        effective_quarter: use[0]?.effective_quarter ?? null,
        edition: use[0]?.edition ?? null,
        fromTable: "repair.ref_qualifier_charts",
      };
    }
  }

  // e. otherwise — list valid qualifiers for this job (no qualifier-only fallback)
  const valid = jobCode ? await validQualifiersForJob(tenantId, jobCode) : [];
  const validNote = valid.length
    ? `valid for this job: ${valid.join(", ")}`
    : "valid for this job: (none listed)";
  return {
    kind: opts.kind,
    code: displayCode,
    found: false,
    description: `${NOT_FOUND} (${validNote})`,
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
  const qual = (opts.qualifier ?? "").trim();

  if (opts.kind === "qualifier" || opts.kind === "removed_qualifier") {
    // Prefer explicit job (code) + qualifier param.
    // Legacy: code alone was the qualifier — treat as no job (path e / letters).
    if (qual) {
      return lookupQualifier({
        kind: opts.kind,
        jobCode: code,
        qualifier: qual,
        tenantId,
      });
    }
    // code is the qualifier value, no job context
    return lookupQualifier({
      kind: opts.kind,
      jobCode: "",
      qualifier: code,
      tenantId,
    });
  }

  if (!code) {
    return {
      kind: opts.kind,
      code: "",
      found: false,
      description: NOT_FOUND,
      fromTable: "none",
    };
  }

  switch (opts.kind) {
    case "job": {
      // 8000-series = RESIDCO internal (Repair_Categories.xlsx)
      if (isResidcoInternalJob(code)) {
        const hit = await firstHit(opts.kind, code, [
          {
            table: "repair.ref_repair_categories",
            sql: `SELECT description, category, sub_category,
                         COALESCE(source, 'Repair_Categories.xlsx') AS source,
                         rule_page, effective_quarter, edition
                  FROM repair.ref_repair_categories
                  WHERE tenant_id=$1 AND job_code=$2
                    AND (qualifier IS NULL OR qualifier='')
                    AND deleted_at IS NULL ORDER BY active DESC LIMIT 1`,
            params: [tenantId, code],
          },
          {
            table: "repair.repair_categories",
            sql: `SELECT description, category, sub_category,
                         'Repair_Categories.xlsx'::text AS source,
                         NULL::text AS rule_page,
                         NULL::text AS effective_quarter, NULL::text AS edition
                  FROM repair.repair_categories
                  WHERE tenant_id=$1 AND job_code=$2
                    AND (qualifier IS NULL OR qualifier='')
                    AND deleted_at IS NULL ORDER BY active DESC LIMIT 1`,
            params: [tenantId, code],
          },
        ]);
        if (hit.found) {
          return {
            ...hit,
            source: hit.source || "Repair_Categories.xlsx",
            description: hit.description,
          };
        }
      }
      return firstHit(opts.kind, code, [
        {
          table: "repair.ref_job_codes",
          sql: `SELECT description, category, sub_category, source, rule_page, effective_quarter, edition, active
                FROM repair.ref_job_codes
                WHERE tenant_id=$1 AND job_code=$2 AND deleted_at IS NULL ORDER BY active DESC LIMIT 1`,
          params: [tenantId, code],
        },
        {
          table: "repair.repair_categories",
          sql: `SELECT description, category, sub_category, NULL::text AS source, NULL::text AS rule_page,
                       NULL::text AS effective_quarter, NULL::text AS edition
                FROM repair.repair_categories
                WHERE tenant_id=$1 AND job_code=$2
                  AND (qualifier IS NULL OR qualifier='')
                  AND deleted_at IS NULL ORDER BY active DESC LIMIT 1`,
          params: [tenantId, code],
        },
      ]);
    }
    case "why_made":
      return firstHit(opts.kind, code, [
        {
          table: "repair.ref_why_made",
          sql: `SELECT description, NULL::text AS category, NULL::text AS sub_category,
                       source, rule_page, effective_quarter, edition, active
                FROM repair.ref_why_made
                WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL ORDER BY active DESC LIMIT 1`,
          params: [tenantId, code],
        },
        {
          table: "repair.why_made_codes",
          sql: `SELECT description, NULL::text AS category, NULL::text AS sub_category,
                       NULL::text AS source, NULL::text AS rule_page,
                       NULL::text AS effective_quarter, NULL::text AS edition, active
                FROM repair.why_made_codes
                WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL ORDER BY active DESC LIMIT 1`,
          params: [tenantId, code],
        },
      ]);
    case "location":
      return firstHit(opts.kind, code, [
        {
          table: "repair.ref_location_codes",
          sql: `SELECT description, NULL::text AS category, NULL::text AS sub_category,
                       source, rule_page, effective_quarter, edition, active
                FROM repair.ref_location_codes
                WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL ORDER BY active DESC LIMIT 1`,
          params: [tenantId, code],
        },
      ]);
    case "condition":
      return firstHit(opts.kind, code, [
        {
          table: "repair.ref_condition_codes",
          sql: `SELECT description, NULL::text AS category, NULL::text AS sub_category,
                       source, rule_page, effective_quarter, edition, active
                FROM repair.ref_condition_codes
                WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL ORDER BY active DESC LIMIT 1`,
          params: [tenantId, code],
        },
      ]);
    case "responsibility":
      return firstHit(opts.kind, code, [
        {
          table: "repair.ref_responsibility_codes",
          sql: `SELECT description, NULL::text AS category, NULL::text AS sub_category,
                       source, rule_page, effective_quarter, edition, active
                FROM repair.ref_responsibility_codes
                WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL ORDER BY active DESC LIMIT 1`,
          params: [tenantId, code],
        },
        {
          table: "repair.responsibility_codes",
          sql: `SELECT COALESCE(description, display_name) AS description,
                       NULL::text AS category, NULL::text AS sub_category,
                       NULL::text AS source, NULL::text AS rule_page,
                       NULL::text AS effective_quarter, NULL::text AS edition
                FROM repair.responsibility_codes
                WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL ORDER BY active DESC LIMIT 1`,
          params: [tenantId, code],
        },
      ]);
    case "car_part":
      return firstHit(opts.kind, code, [
        {
          table: "repair.ref_qualifier_generic",
          sql: `SELECT description, category, sub_category, source, rule_page, effective_quarter, edition
                FROM repair.ref_qualifier_generic
                WHERE tenant_id=$1 AND UPPER(qualifier)=UPPER($2)
                  AND deleted_at IS NULL ORDER BY active DESC LIMIT 1`,
          params: [tenantId, code],
        },
        {
          table: "repair.ref_car_part_codes",
          sql: `SELECT description, category, sub_category, source, rule_page, effective_quarter, edition, active
                FROM repair.ref_car_part_codes
                WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL ORDER BY active DESC LIMIT 1`,
          params: [tenantId, code],
        },
      ]);
    case "category": {
      const combo = qual ? `${code}|${qual}` : code;
      return firstHit(opts.kind, combo, [
        {
          table: "repair.ref_repair_categories",
          sql: `SELECT description, category, sub_category, source, rule_page, effective_quarter, edition, active
                FROM repair.ref_repair_categories
                WHERE tenant_id=$1 AND combo_key=$2 AND deleted_at IS NULL ORDER BY active DESC LIMIT 1`,
          params: [tenantId, combo],
        },
        {
          table: "repair.repair_categories",
          sql: `SELECT description, category, sub_category, NULL::text AS source, NULL::text AS rule_page,
                       NULL::text AS effective_quarter, NULL::text AS edition
                FROM repair.repair_categories
                WHERE tenant_id=$1 AND combo_key=$2 AND deleted_at IS NULL ORDER BY active DESC LIMIT 1`,
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
    "ref_qualifier_generic",
    "ref_qualifier_charts",
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
