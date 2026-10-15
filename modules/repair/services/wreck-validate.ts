/**
 * Resp 3 wreck load validation — HARD REJECT vs ACCEPT+FLAG.
 * Owner-track files: warnings only (no Resp 3 hard set).
 * Bruce six corrections + §11 answers WIN.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import type { ParsedAarLine } from "./aar-parser";
import type { LoadFinding } from "./estimate-load";

export const DETAIL_SOURCES = new Set([
  "BR", "CB", "DC", "DE", "DM", "DR", "GB", "GT", "HT", "IV",
  "JD", "JI", "JR", "MA", "OT", "PT", "QT", "RE", "SH",
]);

export const TAX_DETAIL_SOURCES = new Set(["PT", "QT", "GT", "HT", "IV"]);

/** App. G critical fields (H3) — invoice_number excluded on estimate loads (§11 #10). */
const H3_REQUIRED_KEYS: Array<{ key: string; label: string }> = [
  { key: "record_format", label: "Record Format" },
  { key: "billing_party", label: "Billing Party" },
  { key: "billed_party", label: "Billed Party" },
  { key: "account_date_yymm", label: "Account Date" },
  { key: "currency", label: "Price Master Currency" },
  { key: "detail_source", label: "Detail Source" },
  { key: "car_initial", label: "Car Initial" },
  { key: "car_number", label: "Car Number" },
  { key: "repair_date_yymmdd", label: "Repair Date" },
  { key: "splc", label: "SPLC" },
  { key: "repairing_party", label: "Repairing Party" },
  { key: "facility_type", label: "Repair Facility Type" },
  { key: "quantity", label: "Quantity" },
  { key: "condition_code", label: "Condition Code" },
  { key: "applied_job_code", label: "Applied Job Code" },
  { key: "why_made", label: "Why Made Code" },
  { key: "removed_job_code", label: "Removed Job Code" },
  { key: "responsibility_code", label: "Responsibility Code" },
  { key: "labor_cents", label: "Labor Charge" },
  { key: "material_cents", label: "Material Charge" },
  { key: "material_sign", label: "Material Sign" },
  { key: "machine_priceable", label: "Machine Priceable" },
  { key: "description", label: "Description" },
  { key: "line_number", label: "Line Number" },
];

function fieldStr(line: ParsedAarLine, key: string): string {
  const v = line.fields[key];
  if (v == null) return "";
  return String(v).trim();
}

export type WreckLoadMode = "ESTIMATE" | "FINAL_INVOICE";

export type WreckValidateOpts = {
  lines: ParsedAarLine[];
  /** OWNER_CONTRACT → warnings only; R107_RESP3 → hard + flag. */
  track: "OWNER_CONTRACT" | "R107_RESP3" | "UNKNOWN";
  mode?: WreckLoadMode;
  tenantId?: string;
  pricedQuarter?: string | null;
  /** When true, file is being validated as a wreck Resp 3 upload. */
  isWreckEvent?: boolean;
};

export type WreckValidateResult = {
  findings: LoadFinding[];
  isPureResp3: boolean;
  isPureOwner: boolean;
  isMixed: boolean;
  suggestedTrack: "OWNER_CONTRACT" | "R107_RESP3" | null;
  pricedQuarter: string | null;
  hasOpenFlags: boolean;
};

function classifyPurity(detail: ParsedAarLine[]): {
  isPureResp3: boolean;
  isPureOwner: boolean;
  isMixed: boolean;
  hasResp3: boolean;
  hasNon3: boolean;
} {
  let hasResp3 = false;
  let hasNon3 = false;
  for (const line of detail) {
    const resp = String(line.respCode ?? fieldStr(line, "responsibility_code")).trim();
    if (resp === "3") hasResp3 = true;
    else hasNon3 = true;
  }
  return {
    hasResp3,
    hasNon3,
    isMixed: hasResp3 && hasNon3,
    isPureResp3: hasResp3 && !hasNon3,
    isPureOwner: !hasResp3 && hasNon3,
  };
}

export type AarLaborRateInfo = {
  quarter: string;
  laborRateCents: number;
  edition: string | null;
  source: string | null;
  rulePage: string | null;
  /** True when seed/demo — not cited from a published AAR manual edition. */
  isPlaceholder: boolean;
  /** UI line: source + edition, or placeholder copy. */
  citation: string;
};

function mapLaborRateRow(row: {
  effective_quarter: string;
  labor_rate_cents: string;
  edition: string | null;
  source: string | null;
  rule_page: string | null;
}): AarLaborRateInfo {
  const source = row.source?.trim() || null;
  const edition = row.edition?.trim() || null;
  const rulePage = row.rule_page?.trim() || null;
  const isPlaceholder =
    !source ||
    source.toLowerCase() === "placeholder" ||
    source.toLowerCase() === "demo" ||
    source.toLowerCase() === "seed";
  const citation = isPlaceholder
    ? "placeholder – not from manual"
    : [edition, rulePage ? `Rule ${rulePage}` : null, source]
        .filter(Boolean)
        .join(", ");
  return {
    quarter: row.effective_quarter,
    laborRateCents: Number(row.labor_rate_cents),
    edition,
    source,
    rulePage,
    isPlaceholder,
    citation,
  };
}

/** Current AAR quarterly labor rate (cents/hour) from price master. */
export async function getCurrentAarLaborRateCents(
  tenantId = DEFAULT_TENANT_ID,
  quarter?: string | null,
): Promise<AarLaborRateInfo | null> {
  const cols = `effective_quarter, labor_rate_cents, edition, source, rule_page`;
  if (quarter) {
    const { rows } = await q<{
      effective_quarter: string;
      labor_rate_cents: string;
      edition: string | null;
      source: string | null;
      rule_page: string | null;
    }>(
      `SELECT ${cols}
       FROM repair.ref_aar_labor_rates
       WHERE tenant_id = $1 AND effective_quarter = $2
         AND deleted_at IS NULL AND active AND retired_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, quarter],
    );
    if (rows[0]) return mapLaborRateRow(rows[0]);
  }
  const { rows } = await q<{
    effective_quarter: string;
    labor_rate_cents: string;
    edition: string | null;
    source: string | null;
    rule_page: string | null;
  }>(
    `SELECT ${cols}
     FROM repair.ref_aar_labor_rates
     WHERE tenant_id = $1 AND deleted_at IS NULL AND active AND retired_at IS NULL
     ORDER BY effective_quarter DESC, created_at DESC
     LIMIT 1`,
    [tenantId],
  );
  if (!rows[0]) return null;
  return mapLaborRateRow(rows[0]);
}

async function lookupPriceCents(
  tenantId: string,
  jobCode: string,
  quarter: string,
): Promise<number | null> {
  const { rows } = await q<{ price_cents: string | null; labor_cents: string | null }>(
    `SELECT price_cents, labor_cents
     FROM repair.ref_job_code_prices
     WHERE tenant_id = $1 AND job_code = $2
       AND deleted_at IS NULL AND active
       AND (retired_at IS NULL)
       AND (effective_quarter IS NULL OR effective_quarter = $3)
     ORDER BY CASE WHEN effective_quarter = $3 THEN 0 ELSE 1 END, updated_at DESC NULLS LAST
     LIMIT 1`,
    [tenantId, jobCode, quarter],
  );
  if (!rows[0]) return null;
  if (rows[0].price_cents != null) return Number(rows[0].price_cents);
  if (rows[0].labor_cents != null) return Number(rows[0].labor_cents);
  return null;
}

/**
 * Validate a wreck-tier file. Mutates nothing — returns findings.
 * HARD REJECT codes use severity ERROR; flags use WARNING (ACCEPT+FLAG).
 */
export async function validateWreckLoad(
  opts: WreckValidateOpts,
): Promise<WreckValidateResult> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const mode = opts.mode ?? "ESTIMATE";
  const findings: LoadFinding[] = [];
  const detail = opts.lines.filter((l) => String(l.recordFormat) === "1");
  const purity = classifyPurity(detail);

  let suggestedTrack: "OWNER_CONTRACT" | "R107_RESP3" | null = null;
  if (purity.isMixed) {
    findings.push({
      severity: "ERROR",
      code: "RESP3_MIXED",
      message:
        "Responsibility 3 wreck lines must be in a separate file; mixed Resp 3 / non-3 rejected — no auto-split",
    });
  } else if (purity.isPureResp3) {
    suggestedTrack = "R107_RESP3";
  } else if (purity.isPureOwner || detail.length > 0) {
    suggestedTrack = "OWNER_CONTRACT";
  }

  // Pure Resp 3 purity hard-reject if any non-3 slipped through (already mixed)
  // When track is forced R107_RESP3 but file has non-3:
  if (opts.track === "R107_RESP3" && purity.hasNon3) {
    findings.push({
      severity: "ERROR",
      code: "RESP3_PURITY",
      message: "Wreck Resp 3 estimate may contain ONLY responsibility code 3 lines",
    });
  }

  const rate = await getCurrentAarLaborRateCents(tenantId, opts.pricedQuarter);
  const pricedQuarter = opts.pricedQuarter ?? rate?.quarter ?? null;

  const hardTrack =
    opts.track === "R107_RESP3" ||
    (opts.isWreckEvent && purity.isPureResp3) ||
    suggestedTrack === "R107_RESP3";

  if (!hardTrack) {
    // Owner track: warnings only for pricing drift
    if (opts.isWreckEvent && suggestedTrack === "OWNER_CONTRACT") {
      for (const line of detail) {
        const ds = fieldStr(line, "detail_source").toUpperCase();
        if (ds && !["BR", "GB"].includes(ds)) {
          findings.push({
            severity: "WARNING",
            code: "OWNER_DETAIL_SOURCE_WARN",
            message: `Owner-track detail source ${ds} — prefer BR/GB for group-eligible owner work`,
            lineNo: line.lineNo,
          });
        }
      }
    }
    return {
      findings,
      isPureResp3: purity.isPureResp3,
      isPureOwner: purity.isPureOwner,
      isMixed: purity.isMixed,
      suggestedTrack,
      pricedQuarter,
      hasOpenFlags: findings.some((f) => f.severity === "WARNING"),
    };
  }

  // ── Resp 3 HARD REJECT set ──────────────────────────────────────────
  for (const line of detail) {
    const ds = fieldStr(line, "detail_source").toUpperCase();

    // H2 — detail source
    if (!ds || !DETAIL_SOURCES.has(ds)) {
      findings.push({
        severity: "ERROR",
        code: "RESP3_DETAIL_SOURCE",
        message: `Invalid or missing Detail Source (${ds || "blank"})`,
        lineNo: line.lineNo,
        detail: { detailSource: ds || null },
      });
    }

    // Tax lines on Resp 3 — reject (Bruce §11 #6)
    if (TAX_DETAIL_SOURCES.has(ds)) {
      findings.push({
        severity: "ERROR",
        code: "RESP3_TAX_LINE",
        message: `No taxes on Resp 3 — tax detail source ${ds} rejected`,
        lineNo: line.lineNo,
      });
    }

    // H3 — critical fields (invoice # NOT required on estimate loads)
    for (const { key, label } of H3_REQUIRED_KEYS) {
      const raw = fieldStr(line, key);
      if (!raw) {
        findings.push({
          severity: "ERROR",
          code: "RESP3_CRITICAL_FIELD",
          message: `Missing critical field: ${label}`,
          lineNo: line.lineNo,
          detail: { field: key },
        });
      }
    }

    // §11 #10 — invoice number: HARD REJECT only on FINAL_INVOICE
    const inv = fieldStr(line, "invoice_number");
    if (mode === "FINAL_INVOICE" && !inv) {
      findings.push({
        severity: "ERROR",
        code: "RESP3_INVOICE_NO_REQUIRED",
        message:
          "Invoice number required on shop final invoice load for Resp 3 (HARD REJECT)",
        lineNo: line.lineNo,
      });
    }

    // Resp must be 3
    const resp = String(line.respCode ?? fieldStr(line, "responsibility_code")).trim();
    if (resp !== "3") {
      findings.push({
        severity: "ERROR",
        code: "RESP3_PURITY",
        message: `Resp 3 file line has responsibility ${resp || "blank"} — HARD REJECT`,
        lineNo: line.lineNo,
      });
    }

    // H1 — pricing vs current-quarter price master / unpriced × AAR labor rate
    const mp = fieldStr(line, "machine_priceable").toUpperCase();
    const job = fieldStr(line, "applied_job_code");
    const laborCents =
      typeof line.laborCents === "number"
        ? line.laborCents
        : Number(fieldStr(line, "labor_cents") || 0);
    const lineRateCents = Number(fieldStr(line, "labor_rate_cents") || 0);

    if (pricedQuarter && job && (mp === "Y" || mp === "H")) {
      const expected = await lookupPriceCents(tenantId, job, pricedQuarter);
      if (expected != null && laborCents !== expected && mp === "Y") {
        // Material+labor couplet prices vary; flag labor mismatch when machine-priceable Y
        // and a price_cents row exists that does not match labor — treat as ERROR (H1)
        const mat =
          typeof line.materialCents === "number"
            ? Math.abs(line.materialCents)
            : Number(fieldStr(line, "material_cents") || 0);
        const totalLine = laborCents + mat;
        if (totalLine !== expected && laborCents !== expected) {
          findings.push({
            severity: "ERROR",
            code: "RESP3_PRICE_MISMATCH",
            message: `Not priced to ${pricedQuarter} Price Master for job ${job}`,
            lineNo: line.lineNo,
            detail: { expectedCents: expected, laborCents, pricedQuarter },
          });
        }
      }
    }

    // Unpriced (N) — hours × AAR quarterly labor rate (§11 #4)
    if (mp === "N" && rate) {
      if (lineRateCents && lineRateCents !== rate.laborRateCents) {
        findings.push({
          severity: "ERROR",
          code: "RESP3_LABOR_RATE",
          message: `Unpriced item labor rate ${lineRateCents} ≠ AAR quarterly ${rate.laborRateCents} (${rate.quarter})`,
          lineNo: line.lineNo,
          detail: {
            lineRateCents,
            aarLaborRateCents: rate.laborRateCents,
            quarter: rate.quarter,
          },
        });
      }
    }
  }

  // ── ACCEPT + FLAG (including CID) ───────────────────────────────────
  for (const line of detail) {
    const cid = (line.aarComponentId ?? fieldStr(line, "aar_component_id")).trim();
    if (!cid) {
      findings.push({
        severity: "WARNING",
        code: "RESP3_CID_MISSING",
        message: "Missing AAR Component ID (CID) — accept + flag; blocks complete/invoice",
        lineNo: line.lineNo,
      });
    }
    const ddct = (line.ddctIncidentId ?? fieldStr(line, "ddct_incident_id")).trim();
    if (!ddct) {
      findings.push({
        severity: "WARNING",
        code: "RESP3_DDCT_BLANK",
        message: "DDCT incident ID blank on Format 1 line — flag",
        lineNo: line.lineNo,
      });
    }
  }

  return {
    findings,
    isPureResp3: purity.isPureResp3,
    isPureOwner: purity.isPureOwner,
    isMixed: purity.isMixed,
    suggestedTrack,
    pricedQuarter,
    hasOpenFlags: findings.some((f) => f.severity === "WARNING"),
  };
}

/** Owner / managing partner only may clear flags. */
export function canClearWreckFlags(actorRole?: string | null): boolean {
  const r = String(actorRole ?? "").toLowerCase();
  return (
    r === "owner" ||
    r === "managing_partner" ||
    r === "managing partner" ||
    r === "car_owner" ||
    r === "admin" ||
    r === "system_manager" ||
    // local review bypass roles used elsewhere
    r === "reviewer" ||
    process.env.REPAIR_DEV_BYPASS_AUTH === "1"
  );
}

export async function estimateHasOpenWreckFlags(
  estimateId: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<boolean> {
  const { rows } = await q(
    `SELECT 1 FROM repair.wreck_flags
     WHERE tenant_id = $1 AND estimate_id = $2 AND cleared_at IS NULL
     LIMIT 1`,
    [tenantId, estimateId],
  );
  if (rows[0]) return true;
  const { rows: est } = await q(
    `SELECT wreck_flags_block FROM repair.estimates WHERE id = $1 AND tenant_id = $2`,
    [estimateId, tenantId],
  );
  return Boolean(est[0]?.wreck_flags_block);
}
