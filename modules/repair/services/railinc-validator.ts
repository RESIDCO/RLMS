/**
 * §G Railinc-style validation — interface + local stub.
 *
 * Live Railinc CRBDX / edit-chart calls are NOT made here.
 * Swap `getRailincValidator()` to a LiveRailincValidator later when credentials exist.
 *
 * Severity model (OWNER_UI_SPEC §G / brief):
 *   HARD_REJECT → file not loaded
 *   FLAG (accept+flag) → loaded; Issues? visible; owner/MP clear only
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import {
  parseAarFile,
  signedMaterialCents,
  type ParsedAarLine,
} from "./aar-parser";
import { requireVcfCar } from "./vcf";
import {
  DETAIL_SOURCES,
  getCurrentAarLaborRateCents,
} from "./wreck-validate";

export type ValidationSeverity = "HARD_REJECT" | "FLAG";

export type ValidationFinding = {
  code: string;
  message: string;
  severity: ValidationSeverity;
  refLink?: string | null;
  lineNo?: number;
  fieldKey?: string;
  detail?: Record<string, unknown>;
};

export type ValidateMode = "ESTIMATE" | "FINAL_INVOICE";

export type ValidateInput = {
  bytes?: Buffer;
  lines?: ParsedAarLine[];
  mode?: ValidateMode;
  tenantId?: string;
  /** Skip live VCF when pre-checked (tests). */
  skipVcf?: boolean;
  /** Known cars already verified in VCF. */
  vcfOkCars?: Set<string>;
};

export type ValidateResult = {
  ok: boolean;
  outcome: "ACCEPTED" | "ACCEPTED_WITH_FLAGS" | "HARD_REJECT";
  findings: ValidationFinding[];
  hardRejects: ValidationFinding[];
  flags: ValidationFinding[];
  laborCents: number;
  materialCents: number;
  totalCents: number;
  pricedQuarter: string | null;
  validator: string;
  parsedLines: ParsedAarLine[];
};

export interface RailincValidator {
  readonly name: string;
  validate(input: ValidateInput): Promise<ValidateResult>;
}

const REF = {
  hard: "docs/repair/OWNER_UI_G_SHOP.md#hard-reject",
  flag: "docs/repair/OWNER_UI_G_SHOP.md#accept-flag",
} as const;

function fieldStr(line: ParsedAarLine, key: string): string {
  const v = line.fields[key];
  if (v == null) return "";
  return String(v).trim();
}

function carKey(mark: string, number: string): string {
  return `${mark.trim().toUpperCase()}|${String(number).trim().replace(/^0+(?=\d)/, "")}`;
}

async function lookupJobPriceCents(
  tenantId: string,
  jobCode: string,
  quarter: string | null,
): Promise<number | null> {
  if (!jobCode) return null;
  if (quarter) {
    const { rows } = await q<{ price_cents: string }>(
      `SELECT price_cents::text
       FROM repair.ref_job_code_prices
       WHERE tenant_id = $1 AND job_code = $2
         AND (effective_quarter = $3 OR effective_quarter IS NULL)
         AND deleted_at IS NULL
       ORDER BY CASE WHEN effective_quarter = $3 THEN 0 ELSE 1 END
       LIMIT 1`,
      [tenantId, jobCode, quarter],
    ).catch(() => ({ rows: [] as Array<{ price_cents: string }> }));
    if (rows[0]) return Number(rows[0].price_cents);
  }
  const { rows } = await q<{ price_cents: string }>(
    `SELECT price_cents::text
     FROM repair.ref_job_code_prices
     WHERE tenant_id = $1 AND job_code = $2 AND deleted_at IS NULL
     ORDER BY effective_quarter DESC NULLS LAST
     LIMIT 1`,
    [tenantId, jobCode],
  ).catch(() => ({ rows: [] as Array<{ price_cents: string }> }));
  return rows[0] ? Number(rows[0].price_cents) : null;
}

async function qualifierKnown(
  tenantId: string,
  qualifier: string,
  jobCode: string | null,
): Promise<boolean> {
  if (!qualifier) return true;
  const { rows } = await q(
    `SELECT 1 FROM repair.ref_qualifiers
     WHERE tenant_id = $1 AND qualifier = $2 AND deleted_at IS NULL
       AND (job_code IS NULL OR job_code = '' OR job_code = $3)
     LIMIT 1`,
    [tenantId, qualifier, jobCode ?? ""],
  ).catch(() => ({ rows: [] as unknown[] }));
  if (rows[0]) return true;
  // Empty ref table → do not flag (no catalog loaded yet)
  const { rows: anyQ } = await q(
    `SELECT 1 FROM repair.ref_qualifiers WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [tenantId],
  ).catch(() => ({ rows: [] as unknown[] }));
  return !anyQ[0];
}

function accountQuarter(yymm: string): string | null {
  const m = String(yymm ?? "").trim();
  if (!/^\d{4}$/.test(m)) return null;
  const yy = Number(m.slice(0, 2));
  const mm = Number(m.slice(2, 4));
  if (mm < 1 || mm > 12) return null;
  const year = 2000 + yy;
  const qtr = Math.ceil(mm / 3);
  return `${year}Q${qtr}`;
}

/**
 * Local stub implementing published hard-reject / flag rules.
 * No network I/O. Ready for LiveRailincValidator swap.
 */
export class StubRailincValidator implements RailincValidator {
  readonly name = "stub";

  async validate(input: ValidateInput): Promise<ValidateResult> {
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
    const mode: ValidateMode = input.mode ?? "ESTIMATE";
    const findings: ValidationFinding[] = [];
    let lines: ParsedAarLine[] = input.lines ?? [];

    if (!input.lines && input.bytes) {
      try {
        const parsed = parseAarFile(input.bytes);
        lines = parsed.lines;
      } catch (err) {
        findings.push({
          code: "UNPARSEABLE",
          message: err instanceof Error ? err.message : "Failed to parse 500-byte file",
          severity: "HARD_REJECT",
          refLink: REF.hard,
        });
        return finalize(findings, [], this.name, null);
      }
    }

    if (!lines.length && !input.bytes) {
      findings.push({
        code: "UNPARSEABLE",
        message: "Empty file / no lines",
        severity: "HARD_REJECT",
        refLink: REF.hard,
      });
      return finalize(findings, [], this.name, null);
    }

    for (const line of lines) {
      if (line.rawLine.length !== 500) {
        findings.push({
          code: "UNPARSEABLE",
          message: `Line ${line.lineNo}: expected 500 chars, got ${line.rawLine.length}`,
          severity: "HARD_REJECT",
          refLink: REF.hard,
          lineNo: line.lineNo,
        });
      }
    }

    const detail = lines.filter((l) => l.recordFormat === "1");
    if (detail.length === 0) {
      findings.push({
        code: "UNPARSEABLE",
        message: "File has no Format 1 detail lines",
        severity: "HARD_REJECT",
        refLink: REF.hard,
      });
    }

    // Mixed wreck
    let has3 = false;
    let hasNon3 = false;
    for (const line of detail) {
      const resp = String(line.respCode ?? fieldStr(line, "responsibility_code")).trim();
      if (resp === "3") has3 = true;
      else hasNon3 = true;
    }
    if (has3 && hasNon3) {
      findings.push({
        code: "MIXED_WRECK",
        message: "Responsibility 3 wreck lines must be in a separate file; mixed Resp 3 / non-3 rejected",
        severity: "HARD_REJECT",
        refLink: REF.hard,
      });
    }

    const rate = await getCurrentAarLaborRateCents(tenantId);
    const pricedQuarter = rate?.quarter ?? null;

    const vcfCache = input.vcfOkCars ?? new Set<string>();

    for (const line of detail) {
      const ds = fieldStr(line, "detail_source").toUpperCase();
      if (!ds || !DETAIL_SOURCES.has(ds)) {
        findings.push({
          code: "BAD_SOURCE_CODE",
          message: `Invalid or missing Detail Source (${ds || "blank"})`,
          severity: "HARD_REJECT",
          refLink: REF.hard,
          lineNo: line.lineNo,
          fieldKey: "detail_source",
          detail: { detailSource: ds || null },
        });
      }

      const carInitial = fieldStr(line, "car_initial");
      const carNumber = fieldStr(line, "car_number");
      const billing = fieldStr(line, "billing_party");
      const shopMark =
        fieldStr(line, "repairing_party") || fieldStr(line, "shop_mark");

      if (!carInitial || !carNumber) {
        findings.push({
          code: "MISSING_CRITICAL_HEADER",
          message: "Missing critical header: car initial/number",
          severity: "HARD_REJECT",
          refLink: REF.hard,
          lineNo: line.lineNo,
          fieldKey: "car_initial",
        });
      }
      if (!billing) {
        findings.push({
          code: "MISSING_CRITICAL_HEADER",
          message: "Missing critical header: billing party",
          severity: "HARD_REJECT",
          refLink: REF.hard,
          lineNo: line.lineNo,
          fieldKey: "billing_party",
        });
      }
      if (!shopMark) {
        findings.push({
          code: "MISSING_CRITICAL_HEADER",
          message: "Missing critical header: shop mark (repairing party)",
          severity: "HARD_REJECT",
          refLink: REF.hard,
          lineNo: line.lineNo,
          fieldKey: "repairing_party",
        });
      }

      // VCF
      if (carInitial && carNumber && !input.skipVcf) {
        const key = carKey(carInitial, carNumber);
        if (!vcfCache.has(key)) {
          const vcf = await requireVcfCar(carInitial, carNumber);
          if (!vcf.ok) {
            findings.push({
              code: "CAR_NOT_IN_VCF",
              message: `Car ${carInitial} ${carNumber} not in VCF`,
              severity: "HARD_REJECT",
              refLink: REF.hard,
              lineNo: line.lineNo,
              detail: { carInitial, carNumber },
            });
          } else {
            vcfCache.add(key);
          }
        }
      }

      const acct = fieldStr(line, "account_date_yymm");
      const acctQ = accountQuarter(acct) ?? pricedQuarter;
      const job = fieldStr(line, "applied_job_code") || String(line.appliedJobCode ?? "");
      const mp = fieldStr(line, "machine_priceable").toUpperCase();
      const laborCents =
        typeof line.laborCents === "number"
          ? line.laborCents
          : Number(fieldStr(line, "labor_cents") || 0);
      const matCents = Math.abs(signedMaterialCents(line));
      const qty = Number(fieldStr(line, "quantity") || 0);

      // Job pricing not current for account-date quarter (HARD when machine-priceable Y)
      if (job && mp === "Y" && acctQ) {
        const expected = await lookupJobPriceCents(tenantId, job, acctQ);
        if (expected != null) {
          const lineTotal = laborCents + matCents;
          if (laborCents !== expected && lineTotal !== expected) {
            findings.push({
              code: "PRICE_NOT_CURRENT",
              message: `Job ${job} pricing not current for ${acctQ} (expected ${expected}¢)`,
              severity: "HARD_REJECT",
              refLink: REF.hard,
              lineNo: line.lineNo,
              fieldKey: "labor_cents",
              detail: { expectedCents: expected, laborCents, acctQ },
            });
          }
        }
      }

      // Flags
      const cid = (line.aarComponentId ?? fieldStr(line, "aar_component_id")).trim();
      if (!cid) {
        findings.push({
          code: "MISSING_CID",
          message: "Missing AAR Component ID (CID) — blocks completed date / invoicing",
          severity: "FLAG",
          refLink: REF.flag,
          lineNo: line.lineNo,
          fieldKey: "aar_component_id",
        });
      }

      const qual =
        fieldStr(line, "applied_qualifier") ||
        String(line.appliedQualifier ?? "").trim();
      if (qual && !(await qualifierKnown(tenantId, qual, job || null))) {
        findings.push({
          code: "UNKNOWN_QUALIFIER",
          message: `Unknown qualifier/code ${qual}`,
          severity: "FLAG",
          refLink: REF.flag,
          lineNo: line.lineNo,
          fieldKey: "applied_qualifier",
          detail: { qualifier: qual },
        });
      }

      // Qty / price off table (flag when qty blank or price drifts for non-Y)
      if (!qty || qty <= 0) {
        findings.push({
          code: "QTY_PRICE_OFF_TABLE",
          message: "Quantity missing or zero",
          severity: "FLAG",
          refLink: REF.flag,
          lineNo: line.lineNo,
          fieldKey: "quantity",
        });
      } else if (job && mp !== "Y") {
        const expected = await lookupJobPriceCents(tenantId, job, acctQ);
        if (expected != null && laborCents > 0 && laborCents !== expected) {
          findings.push({
            code: "QTY_PRICE_OFF_TABLE",
            message: `Price off table for job ${job} (file ${laborCents}¢ vs table ${expected}¢)`,
            severity: "FLAG",
            refLink: REF.flag,
            lineNo: line.lineNo,
            detail: { expectedCents: expected, laborCents },
          });
        }
      }

      const inv = fieldStr(line, "invoice_number");
      if (!inv) {
        findings.push({
          code: "MISSING_INVOICE_NO",
          message:
            mode === "FINAL_INVOICE"
              ? "Invoice number required on final invoice (HARD REJECT)"
              : "Missing invoice number (flag on estimate; hard on final invoice)",
          severity: mode === "FINAL_INVOICE" ? "HARD_REJECT" : "FLAG",
          refLink: mode === "FINAL_INVOICE" ? REF.hard : REF.flag,
          lineNo: line.lineNo,
          fieldKey: "invoice_number",
        });
      }

      // Unpriced at quarterly labor rate
      if (mp === "N" && rate) {
        const lineRate = Number(fieldStr(line, "labor_rate_cents") || 0);
        if (!lineRate) {
          findings.push({
            code: "UNPRICED_LABOR_RATE",
            message: `Unpriced item missing labor rate; expected AAR quarterly ${rate.laborRateCents}¢ (${rate.quarter})`,
            severity: "FLAG",
            refLink: REF.flag,
            lineNo: line.lineNo,
            fieldKey: "labor_rate_cents",
          });
        } else if (lineRate !== rate.laborRateCents) {
          findings.push({
            code: "UNPRICED_LABOR_RATE",
            message: `Unpriced labor rate ${lineRate} ≠ AAR quarterly ${rate.laborRateCents} (${rate.quarter})`,
            severity: "FLAG",
            refLink: REF.flag,
            lineNo: line.lineNo,
            detail: { lineRate, aar: rate.laborRateCents, quarter: rate.quarter },
          });
        }
      }
    }

    return finalize(findings, lines, this.name, pricedQuarter);
  }
}

function finalize(
  findings: ValidationFinding[],
  lines: ParsedAarLine[],
  validator: string,
  pricedQuarter: string | null,
): ValidateResult {
  const hardRejects = findings.filter((f) => f.severity === "HARD_REJECT");
  const flags = findings.filter((f) => f.severity === "FLAG");
  const detail = lines.filter((l) => l.recordFormat === "1");
  const laborCents = detail.reduce((s, l) => s + (l.laborCents ?? 0), 0);
  const materialCents = detail.reduce((s, l) => s + signedMaterialCents(l), 0);
  const outcome =
    hardRejects.length > 0
      ? "HARD_REJECT"
      : flags.length > 0
        ? "ACCEPTED_WITH_FLAGS"
        : "ACCEPTED";
  return {
    ok: hardRejects.length === 0,
    outcome,
    findings,
    hardRejects,
    flags,
    laborCents,
    materialCents,
    totalCents: laborCents + materialCents,
    pricedQuarter,
    validator,
    parsedLines: lines,
  };
}

/** Factory — stub today; set REPAIR_RAILINC_VALIDATOR=live later for a real client. */
export function getRailincValidator(): RailincValidator {
  const kind = String(process.env.REPAIR_RAILINC_VALIDATOR ?? "stub").toLowerCase();
  if (kind === "live") {
    // Placeholder: refuse live until wired — never call Railinc silently.
    throw new Error(
      "Live Railinc validator not configured. Use stub (default) or implement LiveRailincValidator.",
    );
  }
  return new StubRailincValidator();
}

export async function listValidationRules(tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT code, message, severity, ref_link, applies_to, active, sort_order
     FROM repair.validation_rules
     WHERE tenant_id = $1 AND deleted_at IS NULL
     ORDER BY sort_order ASC, code ASC`,
    [tenantId],
  );
  return rows;
}

export async function persistValidationRun(opts: {
  tenantId?: string;
  estimateId: string;
  revisionId?: string | null;
  loadRunId?: string | null;
  mode?: ValidateMode;
  result: ValidateResult;
  actor: string;
}): Promise<{ runId: string }> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `INSERT INTO repair.estimate_validation_runs
       (tenant_id, estimate_id, revision_id, load_run_id, mode, validator, outcome,
        hard_reject_count, flag_count, labor_cents, material_cents, total_cents,
        priced_quarter, actor, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
     RETURNING id`,
    [
      tenantId,
      opts.estimateId,
      opts.revisionId ?? null,
      opts.loadRunId ?? null,
      opts.mode ?? "ESTIMATE",
      opts.result.validator,
      opts.result.outcome,
      opts.result.hardRejects.length,
      opts.result.flags.length,
      opts.result.laborCents,
      opts.result.materialCents,
      opts.result.totalCents,
      opts.result.pricedQuarter,
      opts.actor,
    ],
  );
  const runId = String(rows[0].id);
  for (const f of opts.result.findings) {
    await q(
      `INSERT INTO repair.estimate_validation_findings
         (tenant_id, run_id, rule_code, severity, message, ref_link, line_no, field_key, detail, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [
        tenantId,
        runId,
        f.code,
        f.severity,
        f.message,
        f.refLink ?? null,
        f.lineNo ?? null,
        f.fieldKey ?? null,
        JSON.stringify(f.detail ?? {}),
        opts.actor,
      ],
    );
  }
  return { runId };
}

export async function getValidationForRevision(opts: {
  estimateId: string;
  revisionId?: string | null;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows: runs } = await q(
    `SELECT * FROM repair.estimate_validation_runs
     WHERE tenant_id = $1 AND estimate_id = $2
       AND ($3::uuid IS NULL OR revision_id = $3)
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, opts.estimateId, opts.revisionId ?? null],
  );
  if (!runs[0]) return null;
  const { rows: findings } = await q(
    `SELECT * FROM repair.estimate_validation_findings
     WHERE run_id = $1
     ORDER BY CASE severity WHEN 'HARD_REJECT' THEN 0 ELSE 1 END, line_no NULLS LAST, created_at`,
    [runs[0].id],
  );
  return { run: runs[0], findings };
}

/** Owner / managing partner may clear FLAG findings. */
export function canClearValidationFlags(actorRole?: string | null): boolean {
  const r = String(actorRole ?? "").toLowerCase();
  return (
    r === "owner" ||
    r === "managing_partner" ||
    r === "managing partner" ||
    r === "car_owner" ||
    r === "admin" ||
    r === "system_manager" ||
    r === "reviewer" ||
    r === "dev-bypass" ||
    process.env.REPAIR_DEV_BYPASS_AUTH === "1"
  );
}
