/**
 * Inbound shop 500-byte invoice intake + CRB pre-pay audit.
 *
 * Channels: event-link upload (OTP if shop-enabled) or DevInboundEmailProvider.
 * Parse/validate → store original immutably → automated checks → human review
 * (APPROVED_FOR_ACH outside system, or REJECTED with reason).
 * Detail-only extracts (no Format 8/9): totals computed from Format 1 lines.
 *
 * Q18: blank invoice_no accepted; synthetic key = shop mark + car + event + submit date;
 *      WARN; reviewer may enter the real number.
 * Q19: (a) billing party + invoice_no any period = hard block;
 *      (b) same car + total + overlapping job codes within 12 months = WARN.
 * Q20: MISMATCH cannot APPROVED_FOR_ACH; fix via shop revision or approved
 *      Adjustment then re-audit; no override.
 */

import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { resolveActiveLink } from "./event-links";
import { requireVcfCar } from "./vcf";
import { getStorageProvider } from "../providers/storage";
import { notify } from "./notifications";
import { isOtpRequired, verifyStepOtp } from "./otp";
import { parseAarFile, signedMaterialCents, type ParsedAarLine } from "./aar-parser";
import { validateCripBytes } from "./crb-validate";
import { getCarOwnerMark, resolveInboundShopMarks } from "./billed-party-map";
import { maybeMarkReadyToClose } from "./close";
import { dollarsToCents, formatCentsAsDollars } from "./money";

export type PrepayCheckCode =
  | "LINE_LENGTH"
  | "RECORD_ORDER"
  | "DETAIL_TOTALS"
  | "BILLING_PARTY"
  | "BILLED_PARTY"
  | "VCF_CAR"
  | "TOTAL_MATCH"
  | "RESP_CODE"
  | "JOB_CODE"
  | "BLANK_INVOICE_NO"
  | "DUPLICATE"
  | "DUPLICATE_SCOPE";

export type PrepayCheckResult = "PASS" | "FAIL" | "WARN";

export type PrepayCheck = {
  checkCode: PrepayCheckCode;
  result: PrepayCheckResult;
  detail: Record<string, unknown>;
};

async function approvedFinalEstimate(eventId: string, tenantId: string) {
  const { rows } = await q(
    `SELECT e.id AS estimate_id, r.id AS revision_id, r.total,
            r.labor, r.material
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     JOIN repair.estimate_revisions r
       ON r.estimate_id = e.id AND r.rev_no = e.current_revision
     WHERE e.event_id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL
       AND s.code IN ('APPROVED','COMPLETED')
     ORDER BY e.created_at ASC
     LIMIT 1`,
    [eventId, tenantId],
  );
  if (!rows[0]) return null;

  // Approval/submit transitions create revision rows without lines; content
  // lives on the latest revision that actually has estimate_lines.
  const linesRev = await q(
    `SELECT r.id
     FROM repair.estimate_revisions r
     WHERE r.estimate_id = $1
       AND EXISTS (
         SELECT 1 FROM repair.estimate_lines el WHERE el.revision_id = r.id
       )
     ORDER BY r.rev_no DESC
     LIMIT 1`,
    [rows[0].estimate_id],
  );

  return {
    estimateId: String(rows[0].estimate_id),
    revisionId: String(linesRev.rows[0]?.id ?? rows[0].revision_id),
    total: Number(rows[0].total),
  };
}

async function estimateLineFingerprints(revisionId: string) {
  const { rows } = await q(
    `SELECT line_no, aar_job_code, resp_code
     FROM repair.estimate_lines
     WHERE revision_id = $1
     ORDER BY line_no ASC`,
    [revisionId],
  );
  const jobCodes = new Set(
    rows.map((r) => String(r.aar_job_code ?? "").trim()).filter(Boolean),
  );
  const byJob = new Map<string, Set<string>>();
  for (const r of rows) {
    const job = String(r.aar_job_code ?? "").trim();
    if (!job) continue;
    const set = byJob.get(job) ?? new Set<string>();
    set.add(String(r.resp_code ?? "").trim());
    byJob.set(job, set);
  }
  return { jobCodes, byJob, rows };
}

/** Submit date stamp YYYYMMDD (UTC) for blank-invoice synthetic keys (Q18). */
function submitDateStamp(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Q18: prefer file invoice_number / repairing_party_invoice; if blank, accept and
 * synthesize shopMark-carMarkcarNumber-eventId-YYYYMMDD for storage / dup keying.
 */
export function resolveInvoiceNumber(opts: {
  lines: ParsedAarLine[];
  shopMark: string | null;
  carMark: string;
  carNumber: string;
  eventId: string;
  submittedAt?: Date;
}): {
  invoiceNo: string;
  blank: boolean;
  source: "FILE" | "SYNTHETIC";
  fileInvoiceNo: string | null;
} {
  for (const line of opts.lines) {
    const inv = String(line.fields.invoice_number ?? "").trim();
    if (inv) {
      return { invoiceNo: inv, blank: false, source: "FILE", fileInvoiceNo: inv };
    }
    const rpi = String(line.fields.repairing_party_invoice ?? "").trim();
    if (rpi) {
      return { invoiceNo: rpi, blank: false, source: "FILE", fileInvoiceNo: rpi };
    }
  }
  const shop =
    (opts.shopMark ?? "").trim().toUpperCase() ||
    String(
      opts.lines.find((l) => l.recordFormat === "1")?.fields.billing_party ?? "",
    )
      .trim()
      .toUpperCase() ||
    "SHOP";
  const carMark = opts.carMark.trim().toUpperCase();
  const carNumber = opts.carNumber.trim().replace(/\s+/g, "") || "0";
  const stamp = submitDateStamp(opts.submittedAt);
  const synthetic = `${shop}-${carMark}${carNumber}-${opts.eventId}-${stamp}`;
  return {
    invoiceNo: synthetic,
    blank: true,
    source: "SYNTHETIC",
    fileInvoiceNo: null,
  };
}

function jobCodesFromLines(lines: ParsedAarLine[]): string[] {
  const set = new Set<string>();
  for (const line of lines) {
    if (line.recordFormat !== "1") continue;
    const job = (line.appliedJobCode ?? "").trim();
    if (job) set.add(job);
  }
  return [...set].sort();
}

/** Q19(a): same billing party + invoice_no any period → hard block. */
export async function findHardDuplicateInvoice(opts: {
  tenantId: string;
  billingParty: string;
  invoiceNo: string;
  excludeInvoiceId?: string;
}) {
  const billing = opts.billingParty.trim().toUpperCase();
  if (!billing || !opts.invoiceNo.trim()) return [];
  const { rows } = await q(
    `SELECT id, event_id, invoice_no, billing_party, review_status, match_status, created_at
     FROM repair.invoices
     WHERE tenant_id = $1
       AND deleted_at IS NULL
       AND COALESCE(review_status, '') <> 'REJECTED'
       AND upper(trim(billing_party)) = $2
       AND invoice_no = $3
       AND ($4::uuid IS NULL OR id <> $4)
     ORDER BY created_at ASC
     LIMIT 10`,
    [opts.tenantId, billing, opts.invoiceNo.trim(), opts.excludeInvoiceId ?? null],
  );
  return rows;
}

function carFromLines(lines: ParsedAarLine[]): { mark: string; number: string } | null {
  const d = lines.find((l) => l.recordFormat === "1");
  if (!d) return null;
  const mark = String(d.fields.car_initial ?? "").trim().toUpperCase();
  const number = String(d.fields.car_number ?? "").trim().replace(/^0+/, "") || "0";
  // Keep zero-padded 6-digit form when present
  const rawNum = String(d.fields.car_number ?? "").trim();
  return { mark, number: rawNum || number };
}

function centsFromDetailLines(lines: ParsedAarLine[]): {
  laborCents: number;
  materialCents: number;
  totalCents: number;
} {
  let laborCents = 0;
  let materialCents = 0;
  for (const line of lines) {
    if (line.recordFormat !== "1") continue;
    laborCents += line.laborCents ?? 0;
    materialCents += signedMaterialCents(line);
  }
  return {
    laborCents,
    materialCents,
    totalCents: laborCents + materialCents,
  };
}

function buildParseChecks(
  bytes: Buffer,
  lines: ParsedAarLine[],
  crip: ReturnType<typeof validateCripBytes>,
): PrepayCheck[] {
  const checks: PrepayCheck[] = [];

  const badLens = lines
    .map((l, i) => ({ n: i + 1, len: l.rawLine.length }))
    .filter((x) => x.len !== 500);
  checks.push({
    checkCode: "LINE_LENGTH",
    result: badLens.length === 0 ? "PASS" : "FAIL",
    detail: {
      lineCount: lines.length,
      badLines: badLens.slice(0, 20),
      byteLength: bytes.length,
    },
  });

  const detailOnly =
    crip.warnings.includes("detail_only_extract") || !crip.isCompleteCrip;
  checks.push({
    checkCode: "RECORD_ORDER",
    result: detailOnly
      ? crip.errors.some((e) => e.includes("incomplete CRIP"))
        ? "WARN"
        : "PASS"
      : crip.ok
        ? "PASS"
        : "FAIL",
    detail: {
      isCompleteCrip: crip.isCompleteCrip,
      detailOnly,
      errors: crip.errors,
      warnings: crip.warnings,
    },
  });

  const computed = centsFromDetailLines(lines);
  if (detailOnly) {
    checks.push({
      checkCode: "DETAIL_TOTALS",
      result: "PASS",
      detail: {
        mode: "computed_from_detail",
        ...computed,
        totalDollars: formatCentsAsDollars(computed.totalCents),
        note: "No Format 8/9 — invoice total derived from Format 1 labor+material",
      },
    });
  } else {
    const ties =
      crip.laborCents === computed.laborCents &&
      crip.materialCents === computed.materialCents &&
      crip.ok;
    checks.push({
      checkCode: "DETAIL_TOTALS",
      result: ties ? "PASS" : "FAIL",
      detail: {
        mode: "format_8_9",
        computed,
        fileLaborCents: crip.laborCents,
        fileMaterialCents: crip.materialCents,
        errors: crip.errors,
      },
    });
  }

  return checks;
}

async function buildBusinessChecks(opts: {
  tenantId: string;
  eventId: string;
  shopId: string | null;
  shopMark: string | null;
  eventCarMark: string;
  eventCarNumber: string;
  lines: ParsedAarLine[];
  totalCents: number;
  estimateTotal: number | null;
  revisionId: string | null;
  fileSha256: string;
  invoiceNo: string;
  invoiceNoBlank: boolean;
  invoiceNoSource: "FILE" | "SYNTHETIC" | "REVIEWER";
  jobCodes: string[];
  excludeInvoiceId?: string;
  /** When true, skip Q19(a) FAIL — intake already hard-blocked. */
  hardDuplicateBlocked?: boolean;
  hardDuplicateIds?: string[];
}): Promise<PrepayCheck[]> {
  const checks: PrepayCheck[] = [];
  const first = opts.lines.find((l) => l.recordFormat === "1");
  const marks = first ? resolveInboundShopMarks(first.rawLine) : null;

  const billing = marks?.billingParty ?? "";
  const billed = marks?.billedParty ?? "";
  const shopMark = (opts.shopMark ?? "").trim().toUpperCase();
  checks.push({
    checkCode: "BILLING_PARTY",
    result: shopMark && billing === shopMark ? "PASS" : "FAIL",
    detail: {
      expectedShopMark: shopMark || null,
      billingParty: billing || null,
      rule: "inbound billing party (cols 2-5) must equal contract shop mark",
    },
  });

  const owner = await getCarOwnerMark(opts.tenantId);
  const ownerMark = owner.ok ? owner.mark : "";
  checks.push({
    checkCode: "BILLED_PARTY",
    result: owner.ok && billed === ownerMark ? "PASS" : "FAIL",
    detail: {
      expectedCarOwnerMark: ownerMark || null,
      billedParty: billed || null,
      ownerError: owner.ok ? null : owner.error,
      rule: "inbound billed party (cols 6-9) must equal car owner mark",
    },
  });

  const car = carFromLines(opts.lines);
  const carMark = car?.mark ?? "";
  const carNumber = car?.number ?? "";
  const vcf = carMark
    ? await requireVcfCar(carMark, carNumber)
    : { ok: false as const, reason: "No car on Format 1 lines", carMark: "", carNumber: "" };
  const eventCarOk =
    carMark === opts.eventCarMark.trim().toUpperCase() &&
    carNumber.replace(/^0+/, "") === opts.eventCarNumber.replace(/^0+/, "");
  checks.push({
    checkCode: "VCF_CAR",
    result: vcf.ok && eventCarOk ? "PASS" : "FAIL",
    detail: {
      fileCar: car,
      eventCar: { mark: opts.eventCarMark, number: opts.eventCarNumber },
      vcfOk: vcf.ok,
      vcfReason: vcf.ok ? null : "reason" in vcf ? vcf.reason : null,
      matchesEvent: eventCarOk,
    },
  });

  const estimateCents =
    opts.estimateTotal == null ? null : dollarsToCents(opts.estimateTotal);
  const totalMatch =
    estimateCents != null && estimateCents === opts.totalCents;
  checks.push({
    checkCode: "TOTAL_MATCH",
    result: estimateCents == null ? "FAIL" : totalMatch ? "PASS" : "FAIL",
    detail: {
      invoiceTotalCents: opts.totalCents,
      invoiceTotal: formatCentsAsDollars(opts.totalCents),
      estimateTotalCents: estimateCents,
      estimateTotal:
        estimateCents == null ? null : formatCentsAsDollars(estimateCents),
    },
  });

  if (opts.revisionId) {
    const fp = await estimateLineFingerprints(opts.revisionId);
    const detailLines = opts.lines.filter((l) => l.recordFormat === "1");
    const missingJobs: string[] = [];
    const respMismatches: Array<{
      jobCode: string;
      invoiceResp: string | null;
      estimateResps: string[];
    }> = [];
    for (const line of detailLines) {
      const job = (line.appliedJobCode ?? "").trim();
      if (!job) continue;
      if (!fp.jobCodes.has(job)) {
        if (!missingJobs.includes(job)) missingJobs.push(job);
      } else {
        const estResps = [...(fp.byJob.get(job) ?? new Set())];
        const invResp = (line.respCode ?? "").trim();
        if (estResps.length && invResp && !estResps.includes(invResp)) {
          respMismatches.push({
            jobCode: job,
            invoiceResp: invResp,
            estimateResps: estResps,
          });
        }
      }
    }
    checks.push({
      checkCode: "JOB_CODE",
      result: missingJobs.length === 0 ? "PASS" : "FAIL",
      detail: { missingJobCodes: missingJobs.slice(0, 50), count: missingJobs.length },
    });
    checks.push({
      checkCode: "RESP_CODE",
      result: respMismatches.length === 0 ? "PASS" : "FAIL",
      detail: {
        mismatches: respMismatches.slice(0, 50),
        count: respMismatches.length,
      },
    });
  } else {
    checks.push({
      checkCode: "JOB_CODE",
      result: "FAIL",
      detail: { error: "No approved estimate revision to compare job codes" },
    });
    checks.push({
      checkCode: "RESP_CODE",
      result: "FAIL",
      detail: { error: "No approved estimate revision to compare resp codes" },
    });
  }

  // Q18: blank invoice_number accepted with synthetic key + WARN for reviewer
  checks.push({
    checkCode: "BLANK_INVOICE_NO",
    result: opts.invoiceNoBlank ? "WARN" : "PASS",
    detail: {
      blank: opts.invoiceNoBlank,
      invoiceNo: opts.invoiceNo,
      source: opts.invoiceNoSource,
      rule: "Blank invoice_no accepted; keyed on shop mark + car + event + submit date; reviewer may enter the real number",
    },
  });

  // Q19(a): billing party + invoice_no any period = hard block (FAIL when recorded)
  const hardDups =
    opts.hardDuplicateIds && opts.hardDuplicateIds.length
      ? opts.hardDuplicateIds
      : (
          await findHardDuplicateInvoice({
            tenantId: opts.tenantId,
            billingParty: billing,
            invoiceNo: opts.invoiceNo,
            excludeInvoiceId: opts.excludeInvoiceId,
          })
        ).map((r) => String(r.id));
  checks.push({
    checkCode: "DUPLICATE",
    result: hardDups.length > 0 ? "FAIL" : "PASS",
    detail: {
      scope: "billing_party_invoice_no_any_period",
      hardBlock: true,
      billingParty: billing || null,
      invoiceNo: opts.invoiceNo,
      conflictingInvoiceIds: hardDups,
      note: "Same billing party + invoice_no any period is a hard block (Q19a)",
    },
  });

  // Q19(b): same car + same total + overlapping job codes within 12 months = WARN
  const jobCodes = opts.jobCodes.length
    ? opts.jobCodes
    : jobCodesFromLines(opts.lines);
  let softDupIds: string[] = [];
  let overlappingJobs: string[] = [];
  if (carMark && opts.totalCents != null && jobCodes.length > 0) {
    const { rows: softRows } = await q(
      `SELECT id, invoice_no, event_id, total_cents, job_codes, created_at
       FROM repair.invoices
       WHERE tenant_id = $1
         AND deleted_at IS NULL
         AND COALESCE(review_status, '') <> 'REJECTED'
         AND upper(trim(car_mark)) = $2
         AND regexp_replace(coalesce(car_number, ''), '^0+', '') =
             regexp_replace($3, '^0+', '')
         AND total_cents = $4
         AND created_at >= (now() - interval '12 months')
         AND ($5::uuid IS NULL OR id <> $5)
         AND job_codes && $6::text[]
       ORDER BY created_at DESC
       LIMIT 20`,
      [
        opts.tenantId,
        carMark,
        carNumber,
        opts.totalCents,
        opts.excludeInvoiceId ?? null,
        jobCodes,
      ],
    );
    softDupIds = softRows.map((r) => String(r.id));
    const priorJobs = new Set<string>();
    for (const r of softRows) {
      for (const j of (r.job_codes as string[] | null) ?? []) priorJobs.add(j);
    }
    overlappingJobs = jobCodes.filter((j) => priorJobs.has(j));
  }
  checks.push({
    checkCode: "DUPLICATE_SCOPE",
    result: softDupIds.length > 0 ? "WARN" : "PASS",
    detail: {
      scope: "car_total_overlapping_jobs_12_months",
      hardBlock: false,
      carMark,
      carNumber,
      totalCents: opts.totalCents,
      jobCodes,
      overlappingJobs,
      conflictingInvoiceIds: softDupIds,
      note: "Same car + same total + overlapping job codes within 12 months — warning for reviewer (Q19b)",
    },
  });

  return checks;
}

async function persistChecks(opts: {
  tenantId: string;
  invoiceId: string;
  eventId: string;
  checks: PrepayCheck[];
  actor: string;
}) {
  for (const c of opts.checks) {
    await q(
      `INSERT INTO repair.invoice_prepay_checks
         (tenant_id, invoice_id, event_id, check_code, result, detail, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        opts.tenantId,
        opts.invoiceId,
        opts.eventId,
        c.checkCode,
        c.result,
        JSON.stringify(c.detail),
        opts.actor,
      ],
    );
  }
  await writeAudit({
    tenantId: opts.tenantId,
    entity: "invoice",
    entityId: opts.invoiceId,
    action: "INVOICE_PREPAY_CHECKS",
    after: {
      checks: opts.checks.map((c) => ({
        checkCode: c.checkCode,
        result: c.result,
      })),
    },
    actor: opts.actor,
    via: "prepay_audit",
  });
}

export async function listPrepayChecks(invoiceId: string, tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT * FROM repair.invoice_prepay_checks
     WHERE invoice_id = $1 AND tenant_id = $2
     ORDER BY created_at ASC`,
    [invoiceId, tenantId],
  );
  return rows;
}

export async function listInvoiceReviewQueue(tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT i.*, e.car_mark AS event_car_mark, e.car_number AS event_car_number
     FROM repair.invoices i
     JOIN repair.events e ON e.id = i.event_id
     WHERE i.tenant_id = $1 AND i.deleted_at IS NULL
       AND i.review_status = 'PENDING_REVIEW'
     ORDER BY i.created_at ASC`,
    [tenantId],
  );
  return rows;
}

/**
 * Re-compare invoice total to the current approved final estimate (Q20).
 * Appends a new TOTAL_MATCH check; updates match_status. No ACH override.
 */
export async function reauditInvoiceTotals(opts: {
  invoiceId: string;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT * FROM repair.invoices
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [opts.invoiceId, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Invoice not found" };
  const inv = rows[0];
  const approved = await approvedFinalEstimate(String(inv.event_id), tenantId);
  const estimateTotal = approved?.total ?? null;
  const estimateCents =
    estimateTotal == null ? null : dollarsToCents(estimateTotal);
  const totalCents =
    inv.total_cents != null
      ? Number(inv.total_cents)
      : dollarsToCents(inv.total);
  const matched = estimateCents != null && estimateCents === totalCents;
  const matchStatus = matched ? "MATCHED" : "MISMATCH";

  const check: PrepayCheck = {
    checkCode: "TOTAL_MATCH",
    result: estimateCents == null ? "FAIL" : matched ? "PASS" : "FAIL",
    detail: {
      reaudit: true,
      invoiceTotalCents: totalCents,
      invoiceTotal: formatCentsAsDollars(totalCents),
      estimateTotalCents: estimateCents,
      estimateTotal:
        estimateCents == null ? null : formatCentsAsDollars(estimateCents),
      rule: "Invoice total must equal approved final estimate (Q20)",
    },
  };
  await persistChecks({
    tenantId,
    invoiceId: opts.invoiceId,
    eventId: String(inv.event_id),
    checks: [check],
    actor: opts.actor,
  });

  const { rows: updated } = await q(
    `UPDATE repair.invoices
     SET match_status = $1,
         mismatch_flagged = $2,
         estimate_total = $3
     WHERE id = $4 AND tenant_id = $5
     RETURNING *`,
    [matchStatus, !matched, estimateTotal, opts.invoiceId, tenantId],
  );

  await writeAudit({
    tenantId,
    entity: "invoice",
    entityId: opts.invoiceId,
    action: "INVOICE_PREPAY_REAUDIT",
    after: { matchStatus, estimateTotal, totalCents },
    actor: opts.actor,
    via: "UI",
  });

  return {
    ok: true as const,
    invoice: updated[0],
    matchStatus,
    check,
  };
}

/**
 * Q18: reviewer enters the real invoice number when the shop file left it blank.
 * Re-checks Q19(a) hard duplicate against the new number.
 */
export async function setInvoiceNumberByReviewer(opts: {
  invoiceId: string;
  invoiceNo: string;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const invoiceNo = opts.invoiceNo.trim();
  if (!invoiceNo) {
    return { ok: false as const, status: 400, error: "invoiceNo required" };
  }

  const { rows } = await q(
    `SELECT * FROM repair.invoices
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [opts.invoiceId, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Invoice not found" };
  const inv = rows[0];
  if (inv.review_status === "APPROVED_FOR_ACH") {
    return {
      ok: false as const,
      status: 409,
      error: "Cannot change invoice_no after APPROVED_FOR_ACH",
    };
  }
  if (!inv.invoice_no_blank && inv.invoice_no_source !== "SYNTHETIC") {
    return {
      ok: false as const,
      status: 409,
      error: "Invoice number was present on the shop file; blank-entry path not applicable",
    };
  }

  const billing = String(inv.billing_party ?? "").trim().toUpperCase();
  const dups = await findHardDuplicateInvoice({
    tenantId,
    billingParty: billing,
    invoiceNo,
    excludeInvoiceId: opts.invoiceId,
  });
  if (dups.length > 0) {
    return {
      ok: false as const,
      status: 422,
      error: `Hard block: billing party ${billing} already has invoice_no ${invoiceNo}`,
      conflictingInvoiceIds: dups.map((r) => String(r.id)),
    };
  }

  const { rows: updated } = await q(
    `UPDATE repair.invoices
     SET invoice_no = $1,
         invoice_no_blank = false,
         invoice_no_source = 'REVIEWER',
         invoice_no_entered_by = $2,
         invoice_no_entered_at = now()
     WHERE id = $3 AND tenant_id = $4
     RETURNING *`,
    [invoiceNo, opts.actor, opts.invoiceId, tenantId],
  );

  await writeAudit({
    tenantId,
    entity: "invoice",
    entityId: opts.invoiceId,
    action: "INVOICE_NO_ENTERED",
    before: {
      invoice_no: inv.invoice_no,
      invoice_no_blank: inv.invoice_no_blank,
      invoice_no_source: inv.invoice_no_source,
    },
    after: {
      invoice_no: invoiceNo,
      invoice_no_blank: false,
      invoice_no_source: "REVIEWER",
    },
    actor: opts.actor,
    via: "UI",
  });

  return { ok: true as const, invoice: updated[0] };
}

export async function decideInvoiceReview(opts: {
  invoiceId: string;
  decision: "APPROVED_FOR_ACH" | "REJECTED";
  reason?: string;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (opts.decision === "REJECTED" && !opts.reason?.trim()) {
    return { ok: false as const, status: 400, error: "reason required when rejecting" };
  }

  const { rows } = await q(
    `SELECT * FROM repair.invoices
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [opts.invoiceId, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Invoice not found" };
  const inv = rows[0];
  if (inv.review_status !== "PENDING_REVIEW") {
    return {
      ok: false as const,
      status: 409,
      error: `Invoice review_status is ${inv.review_status ?? "null"}, expected PENDING_REVIEW`,
    };
  }

  // Q20: MISMATCH cannot APPROVED_FOR_ACH — re-audit against current approved estimate; no override
  if (opts.decision === "APPROVED_FOR_ACH") {
    const reaudit = await reauditInvoiceTotals({
      invoiceId: opts.invoiceId,
      actor: opts.actor,
      tenantId,
    });
    if (!reaudit.ok) return reaudit;
    if (reaudit.matchStatus !== "MATCHED") {
      return {
        ok: false as const,
        status: 409,
        error:
          "MISMATCH cannot APPROVED_FOR_ACH. Invoice total must equal the approved final estimate. Fix via shop revision or an approved Adjustment, then re-audit. No override.",
        matchStatus: reaudit.matchStatus,
        check: reaudit.check,
      };
    }
  }

  // ACH only after MATCHED; stamp APPROVED so Ready-to-Close treats it as paid-cleared
  const matchStatus =
    opts.decision === "APPROVED_FOR_ACH" ? "APPROVED" : inv.match_status;

  const { rows: updated } = await q(
    `UPDATE repair.invoices
     SET review_status = $1,
         match_status = $2,
         approved_by = CASE WHEN $1 = 'APPROVED_FOR_ACH' THEN $3 ELSE approved_by END,
         approved_at = CASE WHEN $1 = 'APPROVED_FOR_ACH' THEN now() ELSE approved_at END
     WHERE id = $4 AND tenant_id = $5
     RETURNING *`,
    [opts.decision, matchStatus, opts.actor, opts.invoiceId, tenantId],
  );

  const { rows: decisionRows } = await q(
    `INSERT INTO repair.invoice_review_decisions
       (tenant_id, invoice_id, event_id, decision, reason, decided_by, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$6)
     RETURNING *`,
    [
      tenantId,
      opts.invoiceId,
      inv.event_id,
      opts.decision,
      opts.reason?.trim() ?? null,
      opts.actor,
    ],
  );

  await writeAudit({
    tenantId,
    entity: "invoice",
    entityId: opts.invoiceId,
    action:
      opts.decision === "APPROVED_FOR_ACH"
        ? "INVOICE_APPROVED_FOR_ACH"
        : "INVOICE_REJECTED",
    after: {
      decision: opts.decision,
      reason: opts.reason?.trim() ?? null,
      note:
        opts.decision === "APPROVED_FOR_ACH"
          ? "ACH payment is processed outside RLMS"
          : null,
    },
    actor: opts.actor,
    via: "UI",
  });

  if (opts.decision === "REJECTED") {
    await notify({
      tenantId,
      eventId: String(inv.event_id),
      type: "INVOICE_REJECTED_TO_SHOP",
      subject: `Invoice rejected — ${inv.car_mark ?? ""} ${inv.car_number ?? ""}`.trim(),
      bodyText: [
        `Invoice ${inv.invoice_no} was rejected.`,
        `Reason: ${opts.reason?.trim()}`,
        "Please correct and resubmit via the event link or inbound email.",
      ].join("\n"),
      actor: opts.actor,
    });
  }

  let readyToClose: Awaited<ReturnType<typeof maybeMarkReadyToClose>> | null = null;
  if (opts.decision === "APPROVED_FOR_ACH") {
    readyToClose = await maybeMarkReadyToClose({
      eventId: String(inv.event_id),
      tenantId,
      actor: opts.actor,
    });
  }

  return {
    ok: true as const,
    invoice: updated[0],
    decision: decisionRows[0],
    readyToClose,
  };
}

type IntakeBase = {
  bytes: Buffer;
  filename: string;
  mime?: string;
  actorEmail: string;
  otpCode?: string;
  inboundEmailId?: string;
};

/**
 * Shop event-link upload of a 500-byte AAR/CRB invoice file.
 */
export async function submitShopCrbInvoice(
  opts: IntakeBase & { rawToken: string },
) {
  const resolved = await resolveActiveLink(opts.rawToken, "SHOP");
  if (!resolved) {
    return { ok: false as const, status: 401, error: "Invalid or revoked link" };
  }
  return ingestCrbInvoiceForEvent({
    ...opts,
    event: resolved.event,
    channel: "SHOP_LINK",
    via: "event_link",
  });
}

/**
 * Dev inbound-email adapter path: paste JSON with attachment + event token.
 */
export async function ingestCrbInvoiceFromInboundEmail(opts: IntakeBase & {
  eventToken?: string;
  eventId?: string;
  tenantId?: string;
}) {
  if (opts.eventToken) {
    const resolved = await resolveActiveLink(opts.eventToken, "SHOP");
    if (!resolved) {
      return { ok: false as const, status: 401, error: "Invalid or revoked event token" };
    }
    return ingestCrbInvoiceForEvent({
      ...opts,
      event: resolved.event,
      channel: "INBOUND_EMAIL",
      via: "inbound_email",
    });
  }
  if (opts.eventId) {
    const { rows } = await q(
      `SELECT e.*, s.reporting_mark AS shop_reporting_mark
       FROM repair.events e
       LEFT JOIN repair.shops s ON s.id = e.shop_id
       WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
      [opts.eventId, opts.tenantId ?? DEFAULT_TENANT_ID],
    );
    if (!rows[0]) return { ok: false as const, status: 404, error: "Event not found" };
    return ingestCrbInvoiceForEvent({
      ...opts,
      event: rows[0],
      channel: "INBOUND_EMAIL",
      via: "inbound_email",
    });
  }
  return {
    ok: false as const,
    status: 400,
    error: "eventToken or eventId required for inbound invoice email",
  };
}

async function ingestCrbInvoiceForEvent(opts: IntakeBase & {
  event: Record<string, unknown>;
  channel: "SHOP_LINK" | "INBOUND_EMAIL";
  via: string;
}) {
  const event = opts.event;
  const tenantId = String(event.tenant_id ?? DEFAULT_TENANT_ID);
  const eventId = String(event.id);
  const shopId = event.shop_id ? String(event.shop_id) : null;

  if (!opts.bytes?.length) {
    return { ok: false as const, status: 400, error: "500-byte invoice file required" };
  }

  // OTP on shop-link channel when enabled for the shop
  if (opts.channel === "SHOP_LINK") {
    const otpNeeded = await isOtpRequired("invoice_submit", {
      shopId,
      eventId,
      tenantId,
    });
    if (otpNeeded) {
      if (!opts.otpCode) {
        return {
          ok: false as const,
          status: 403,
          error: "One-time code required for invoice submit (request OTP first)",
          otpRequired: true as const,
        };
      }
      const verified = await verifyStepOtp({
        eventId,
        step: "invoice_submit",
        email: opts.actorEmail,
        code: opts.otpCode,
        tenantId,
      });
      if (!verified.ok) {
        return { ok: false as const, status: verified.status, error: verified.error };
      }
    }
  }

  let parsed;
  try {
    parsed = parseAarFile(opts.bytes);
  } catch (err) {
    return {
      ok: false as const,
      status: 400,
      error: err instanceof Error ? err.message : "AAR parse failed",
    };
  }

  const car = carFromLines(parsed.lines);
  if (!car) {
    return { ok: false as const, status: 400, error: "No Format 1 detail lines in file" };
  }

  // Hard reject: car not in fleet / VCF
  const vcf = await requireVcfCar(car.mark, car.number);
  if (!vcf.ok) {
    await writeAudit({
      tenantId,
      entity: "invoice",
      entityId: null,
      action: "INVOICE_INTAKE_REJECTED",
      after: {
        reason: vcf.reason,
        car,
        channel: opts.channel,
        sha256: parsed.sha256,
      },
      actor: opts.actorEmail,
      via: opts.via,
    });
    return {
      ok: false as const,
      status: 422,
      error: vcf.reason,
      carMark: car.mark,
      carNumber: car.number,
    };
  }

  // Soft preference: file car should match event car (still allow review if different? hard reject)
  const eventMark = String(event.car_mark ?? "").trim().toUpperCase();
  const eventNum = String(event.car_number ?? "").trim();
  if (
    car.mark !== eventMark ||
    car.number.replace(/^0+/, "") !== eventNum.replace(/^0+/, "")
  ) {
    return {
      ok: false as const,
      status: 422,
      error: `Invoice car ${car.mark} ${car.number} does not match event car ${eventMark} ${eventNum}`,
      carMark: car.mark,
      carNumber: car.number,
    };
  }

  const crip = validateCripBytes(opts.bytes);
  const computed = centsFromDetailLines(parsed.lines);
  const detailOnly =
    crip.warnings.includes("detail_only_extract") || !crip.isCompleteCrip;
  const totalCents = detailOnly
    ? computed.totalCents
    : crip.laborCents + crip.materialCents || computed.totalCents;
  const invoiceTotal = totalCents / 100;

  let shopMark: string | null = null;
  if (shopId) {
    const { rows: shops } = await q(
      `SELECT reporting_mark FROM repair.shops WHERE id = $1`,
      [shopId],
    );
    shopMark = shops[0] ? String(shops[0].reporting_mark).trim().toUpperCase() : null;
  } else if (event.shop_reporting_mark) {
    shopMark = String(event.shop_reporting_mark).trim().toUpperCase();
  }

  const first = parsed.lines.find((l) => l.recordFormat === "1");
  const marks = first ? resolveInboundShopMarks(first.rawLine) : null;
  const billingParty = (marks?.billingParty ?? shopMark ?? "").trim().toUpperCase();

  const resolvedNo = resolveInvoiceNumber({
    lines: parsed.lines,
    shopMark: shopMark ?? billingParty,
    carMark: car.mark,
    carNumber: car.number,
    eventId,
  });
  const invoiceNo = resolvedNo.invoiceNo;
  const jobCodes = jobCodesFromLines(parsed.lines);

  // Wreck Resp 3 final invoice: blank invoice # → HARD REJECT (§11 #10).
  // Also block when open wreck flags remain.
  {
    const { rows: wreckRows } = await q(
      `SELECT we.id AS wreck_event_id, e.is_wreck,
              est.id AS estimate_id, est.wreck_flags_block, est.wreck_track_type
       FROM repair.events e
       LEFT JOIN repair.wreck_events we ON we.event_id = e.id AND we.deleted_at IS NULL
       LEFT JOIN repair.estimates est ON est.event_id = e.id AND est.deleted_at IS NULL
         AND (est.wreck_track_type = 'R107_RESP3' OR est.id IN (
           SELECT estimate_id FROM repair.event_tracks
           WHERE event_id = e.id AND track_type = 'R107_RESP3' AND deleted_at IS NULL
         ))
       WHERE e.id = $1 AND e.deleted_at IS NULL
       LIMIT 1`,
      [eventId],
    );
    const wr = wreckRows[0];
    const isWreckResp3 =
      wr &&
      (wr.is_wreck || wr.wreck_event_id) &&
      (wr.wreck_track_type === "R107_RESP3" || wr.estimate_id);
    if (isWreckResp3 && resolvedNo.blank) {
      return {
        ok: false as const,
        status: 422,
        error:
          "Resp 3 wreck final invoice requires invoice number — HARD REJECT (estimate loads may omit it)",
        code: "RESP3_INVOICE_NO_REQUIRED",
      };
    }
    if (wr?.wreck_flags_block) {
      return {
        ok: false as const,
        status: 409,
        error:
          "Cannot invoice while Resp 3 wreck flags remain open — car owner / managing partner must clear flags first",
        wreckFlagsBlock: true as const,
      };
    }
  }

  // Q19(a): same billing party + invoice_no any period = hard block (before insert)
  const hardDups = await findHardDuplicateInvoice({
    tenantId,
    billingParty,
    invoiceNo,
  });
  if (hardDups.length > 0) {
    await writeAudit({
      tenantId,
      entity: "invoice",
      entityId: null,
      action: "INVOICE_INTAKE_HARD_DUP",
      after: {
        billingParty,
        invoiceNo,
        blank: resolvedNo.blank,
        conflictingInvoiceIds: hardDups.map((r) => String(r.id)),
        channel: opts.channel,
        sha256: parsed.sha256,
      },
      actor: opts.actorEmail,
      via: opts.via,
    });
    return {
      ok: false as const,
      status: 422,
      error: `Hard block: billing party ${billingParty || "(blank)"} already has invoice_no ${invoiceNo}`,
      conflictingInvoiceIds: hardDups.map((r) => String(r.id)),
      invoiceNo,
      billingParty: billingParty || null,
    };
  }

  const approved = await approvedFinalEstimate(eventId, tenantId);
  const estimateTotal = approved?.total ?? null;
  const matched =
    estimateTotal != null && dollarsToCents(estimateTotal) === totalCents;
  const matchStatus = matched ? "MATCHED" : "MISMATCH";

  const stored = await getStorageProvider().put({
    tenantId,
    kind: "invoice_aar",
    filename: opts.filename,
    mime: opts.mime || "text/plain",
    bytes: opts.bytes,
  });

  const { rows: docs } = await q(
    `INSERT INTO repair.documents
       (tenant_id, event_id, kind, storage_key, sha256, size, mime,
        uploaded_by, created_by, original_filename)
     VALUES ($1,$2,'invoice',$3,$4,$5,$6,$7,$7,$8)
     RETURNING *`,
    [
      tenantId,
      eventId,
      stored.storageKey,
      stored.sha256,
      stored.size,
      stored.mime,
      opts.actorEmail,
      opts.filename,
    ],
  );

  const { rows } = await q(
    `INSERT INTO repair.invoices
       (tenant_id, event_id, shop_id, invoice_no, total, estimate_total,
        document_id, match_status, mismatch_flagged, submitted_by_email, created_by,
        intake_channel, file_sha256, billing_party, billed_party,
        car_mark, car_number, total_cents, detail_only, review_status, inbound_email_id,
        invoice_no_blank, invoice_no_source, job_codes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,
             $11,$12,$13,$14,$15,$16,$17,$18,'PENDING_REVIEW',$19,
             $20,$21,$22)
     RETURNING *`,
    [
      tenantId,
      eventId,
      shopId,
      invoiceNo,
      invoiceTotal,
      estimateTotal,
      docs[0].id,
      matchStatus,
      !matched,
      opts.actorEmail,
      opts.channel,
      parsed.sha256,
      marks?.billingParty ?? null,
      marks?.billedParty ?? null,
      car.mark,
      car.number,
      totalCents,
      detailOnly,
      opts.inboundEmailId ?? null,
      resolvedNo.blank,
      resolvedNo.source,
      jobCodes,
    ],
  );

  const invoiceId = String(rows[0].id);

  const parseChecks = buildParseChecks(opts.bytes, parsed.lines, crip);
  const bizChecks = await buildBusinessChecks({
    tenantId,
    eventId,
    shopId,
    shopMark,
    eventCarMark: eventMark,
    eventCarNumber: eventNum,
    lines: parsed.lines,
    totalCents,
    estimateTotal,
    revisionId: approved?.revisionId ?? null,
    fileSha256: parsed.sha256,
    invoiceNo,
    invoiceNoBlank: resolvedNo.blank,
    invoiceNoSource: resolvedNo.source,
    jobCodes,
    excludeInvoiceId: invoiceId,
  });
  const checks = [...parseChecks, ...bizChecks];
  await persistChecks({
    tenantId,
    invoiceId,
    eventId,
    checks,
    actor: opts.actorEmail,
  });

  await writeAudit({
    tenantId,
    entity: "invoice",
    entityId: invoiceId,
    action: "INVOICE_CRB_INTAKE",
    after: {
      invoiceNo,
      invoiceNoBlank: resolvedNo.blank,
      invoiceNoSource: resolvedNo.source,
      totalCents,
      matchStatus,
      detailOnly,
      channel: opts.channel,
      sha256: parsed.sha256,
      documentId: docs[0].id,
      jobCodes,
    },
    actor: opts.actorEmail,
    via: opts.via,
  });

  const failCount = checks.filter((c) => c.result === "FAIL").length;
  const warnCount = checks.filter((c) => c.result === "WARN").length;
  await notify({
    tenantId,
    eventId,
    type: "INVOICE_PREPAY_REVIEW",
    subject: `Shop invoice pre-pay review — ${car.mark} ${car.number}`,
    bodyText: [
      `Invoice ${invoiceNo} ingested via ${opts.channel}`,
      resolvedNo.blank
        ? "Blank invoice_no on file — synthetic key used; reviewer should enter the real number."
        : null,
      `Total: ${formatCentsAsDollars(totalCents)} (detail_only=${detailOnly})`,
      `Match vs estimate: ${matchStatus}`,
      `Automated checks: ${checks.length} (${failCount} FAIL, ${warnCount} WARN)`,
      "Reviewer: approve for ACH only when MATCHED (outside RLMS) or reject with reason.",
    ]
      .filter(Boolean)
      .join("\n"),
    actor: opts.actorEmail,
  });

  return {
    ok: true as const,
    invoice: rows[0],
    document: docs[0],
    matchStatus,
    reviewStatus: "PENDING_REVIEW" as const,
    detailOnly,
    totalCents,
    invoiceNoBlank: resolvedNo.blank,
    invoiceNoSource: resolvedNo.source,
    checks,
    failCount,
    warnCount,
    otpUsed: opts.channel === "SHOP_LINK",
  };
}
