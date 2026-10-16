/**
 * §H Owner invoice review + shop payment (export files only — no real ACH).
 * Side-by-side estimate vs invoice lines; Approve / Reject / Short-pay;
 * payment batch CSV; BO Closed only when invoice Approved (Payable+).
 * Defaults: tolerance $0 + 0%, net 30 from approval, generic CSV.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import {
  dollarsToCents,
  formatCentsAsDollars,
  lineTotalCents,
  lineLaborCents,
  lineMaterialCents,
} from "./money";
import { parseAarFile } from "./aar-parser";
import { getContentLinesForEstimate } from "./estimate-review";

/** Local CSV outbox (gitignored under modules/repair/dev/exports/). */
export const PAYMENT_CSV_OUTBOX_DIR = join(
  process.cwd(),
  "modules/repair/dev/exports/payment-outbox",
);

/**
 * Payment batch CSV columns (generic AP placeholder — no accounting API):
 * batch_no, invoice_no, shop_mark, car, amount_dollars (2dp, no $),
 * amount_cents, due_date (ISO YYYY-MM-DD), short_pay_cents, currency
 */

export const DEFAULT_TOLERANCE_CENTS = 0;
export const DEFAULT_TOLERANCE_PCT_BP = 0; // basis points
export const DEFAULT_PAYMENT_TERMS_DAYS = 30;

export type InvoicePaymentStatus =
  | "PAYABLE"
  | "IN_BATCH"
  | "EXPORTED"
  | "PAID"
  | "SHORT_PAID";

export type EntityTolerance = {
  entityCode: string;
  toleranceCents: number;
  tolerancePctBp: number;
  paymentTermsDays: number;
};

export type LineDiffKind =
  | "MATCH"
  | "ADDED"
  | "REMOVED"
  | "QTY_PRICE_CHANGED"
  | "NOT_ON_APPROVED_ESTIMATE";

export type MatchableLine = {
  lineNo: number;
  jobCode: string;
  location?: string | null;
  qualifier?: string | null;
  qty: number | null;
  laborCents: number;
  materialCents: number;
  totalCents: number;
  respCode: string | null;
};

export type MatchedLine = {
  lineNo: number | null;
  jobCode: string;
  kind: LineDiffKind;
  estimate?: MatchableLine;
  invoice?: MatchableLine & {
    shortPayCents?: number | null;
    shortPayReason?: string | null;
  };
};

function normKeyPart(v: string | null | undefined): string {
  return (v ?? "").trim().toUpperCase();
}

/** Job + location + qualifier fingerprint for fallback matching. */
export function lineMatchFingerprint(line: {
  jobCode?: string | null;
  location?: string | null;
  qualifier?: string | null;
}): string {
  return [
    normKeyPart(line.jobCode),
    normKeyPart(line.location),
    normKeyPart(line.qualifier),
  ].join("|");
}

/** ISO YYYY-MM-DD; never weekday-only slices from Date.toString(). */
export function toIsoDateOnly(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

export type ValidationFinding = {
  code: string;
  severity: "HARD_REJECT" | "FLAG" | "INFO";
  message: string;
  lineNo?: number | null;
};

/** Max of $ and % tolerance (basis points of estimate). Within → Approve enabled. */
export function withinTolerance(opts: {
  invoiceCents: number;
  estimateCents: number;
  toleranceCents: number;
  tolerancePctBp: number;
}): { within: boolean; deltaCents: number; allowedCents: number; pctDeltaBp: number } {
  const deltaCents = opts.invoiceCents - opts.estimateCents;
  const absDelta = Math.abs(deltaCents);
  const pctAllowed =
    opts.estimateCents === 0
      ? 0
      : Math.trunc((Math.abs(opts.estimateCents) * Math.max(0, opts.tolerancePctBp)) / 10000);
  const allowedCents = Math.max(Math.max(0, opts.toleranceCents), pctAllowed);
  const pctDeltaBp =
    opts.estimateCents === 0
      ? absDelta === 0
        ? 0
        : 10000
      : Math.round((absDelta * 10000) / Math.abs(opts.estimateCents));
  return {
    within: absDelta <= allowedCents,
    deltaCents,
    allowedCents,
    pctDeltaBp,
  };
}

export async function getEntityTolerance(opts: {
  entityCode?: string | null;
  tenantId?: string;
}): Promise<EntityTolerance> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const code = (opts.entityCode ?? "*").trim() || "*";
  const { rows } = await q(
    `SELECT entity_code, tolerance_cents, tolerance_pct_bp, payment_terms_days
     FROM repair.entity_invoice_settings
     WHERE tenant_id = $1 AND deleted_at IS NULL
       AND entity_code = ANY($2::text[])
     ORDER BY CASE WHEN entity_code = $3 THEN 0 ELSE 1 END
     LIMIT 1`,
    [tenantId, [code, "*"], code],
  ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  if (!rows[0]) {
    return {
      entityCode: "*",
      toleranceCents: DEFAULT_TOLERANCE_CENTS,
      tolerancePctBp: DEFAULT_TOLERANCE_PCT_BP,
      paymentTermsDays: DEFAULT_PAYMENT_TERMS_DAYS,
    };
  }
  return {
    entityCode: String(rows[0].entity_code),
    toleranceCents: Number(rows[0].tolerance_cents ?? 0),
    tolerancePctBp: Number(rows[0].tolerance_pct_bp ?? 0),
    paymentTermsDays: Number(rows[0].payment_terms_days ?? DEFAULT_PAYMENT_TERMS_DAYS),
  };
}

/**
 * Match invoice lines to the APPROVED estimate revision only.
 * 1) Same line number (primary)
 * 2) Else first unused estimate line with same job + location + qualifier
 * Identical invoice vs approved → every row MATCH (0 LINE_ADDED / LINE_REMOVED).
 */
export function matchInvoiceToEstimateLines(opts: {
  estimateLines: Array<MatchableLine>;
  invoiceLines: Array<
    MatchableLine & {
      shortPayCents?: number | null;
      shortPayReason?: string | null;
    }
  >;
}): MatchedLine[] {
  const estSlots = opts.estimateLines.map((e, idx) => ({
    e,
    idx,
    used: false,
  }));
  const out: MatchedLine[] = [];

  for (const inv of opts.invoiceLines) {
    let hit = estSlots.find((s) => !s.used && s.e.lineNo === inv.lineNo);
    if (!hit) {
      const fp = lineMatchFingerprint(inv);
      if (normKeyPart(inv.jobCode)) {
        hit = estSlots.find(
          (s) => !s.used && lineMatchFingerprint(s.e) === fp,
        );
      }
    }
    if (!hit) {
      out.push({
        lineNo: inv.lineNo,
        jobCode: inv.jobCode,
        kind: "ADDED",
        invoice: inv,
      });
      continue;
    }
    hit.used = true;
    const est = hit.e;
    const qtyChanged =
      inv.qty != null && est.qty != null && Number(inv.qty) !== Number(est.qty);
    const priceChanged =
      inv.laborCents !== est.laborCents ||
      inv.materialCents !== est.materialCents ||
      inv.totalCents !== est.totalCents;
    out.push({
      lineNo: inv.lineNo,
      jobCode: inv.jobCode || est.jobCode,
      kind: qtyChanged || priceChanged ? "QTY_PRICE_CHANGED" : "MATCH",
      estimate: est,
      invoice: inv,
    });
  }

  for (const s of estSlots) {
    if (s.used) continue;
    out.push({
      lineNo: s.e.lineNo,
      jobCode: s.e.jobCode,
      kind: "REMOVED",
      estimate: s.e,
    });
  }

  out.sort((a, b) => (a.lineNo ?? 0) - (b.lineNo ?? 0));
  return out;
}

export function reconcileLineTotalsCents(
  lines: Array<{ totalCents: number }>,
  headerCents: number,
): { ok: boolean; linesSum: number; headerCents: number; delta: number } {
  const linesSum = lines.reduce((s, l) => s + Math.trunc(l.totalCents), 0);
  const delta = linesSum - Math.trunc(headerCents);
  return { ok: delta === 0, linesSum, headerCents: Math.trunc(headerCents), delta };
}

export async function validateInvoiceForReview(opts: {
  invoiceNo: string;
  invoiceCents: number;
  estimateCents: number;
  matched: MatchedLine[];
  cidUncleared: boolean;
  accountDateYymm?: string | null;
  pricingFindings?: ValidationFinding[];
}): Promise<{ hardRejects: ValidationFinding[]; flags: ValidationFinding[] }> {
  const hardRejects: ValidationFinding[] = [];
  const flags: ValidationFinding[] = [];
  if (!opts.invoiceNo.trim()) {
    hardRejects.push({
      code: "MISSING_INVOICE_NO",
      severity: "HARD_REJECT",
      message: "Invoice number required",
    });
  }
  if (opts.cidUncleared) {
    hardRejects.push({
      code: "CID_FLAGS_OPEN",
      severity: "HARD_REJECT",
      message: "CID flags must be cleared before invoice approval",
    });
  }
  const invLines = opts.matched
    .filter((m) => m.invoice)
    .map((m) => ({ totalCents: m.invoice!.totalCents }));
  if (invLines.length) {
    const rec = reconcileLineTotalsCents(invLines, opts.invoiceCents);
    if (!rec.ok) {
      hardRejects.push({
        code: "TOTALS_NOT_RECONCILE",
        severity: "HARD_REJECT",
        message: `Invoice line totals ${rec.linesSum}¢ ≠ header ${rec.headerCents}¢ (Δ ${rec.delta}¢)`,
      });
    }
  }
  for (const m of opts.matched) {
    if (m.kind === "ADDED") {
      flags.push({
        code: "LINE_ADDED",
        severity: "FLAG",
        message: `Line ${m.lineNo}: ${m.jobCode || "(no job)"} not on approved estimate`,
        lineNo: m.lineNo,
      });
    } else if (m.kind === "REMOVED") {
      flags.push({
        code: "LINE_REMOVED",
        severity: "FLAG",
        message: `Estimate line ${m.lineNo} (${m.jobCode}) missing from invoice`,
        lineNo: m.lineNo,
      });
    } else if (m.kind === "QTY_PRICE_CHANGED") {
      flags.push({
        code: "LINE_CHANGED",
        severity: "FLAG",
        message: `Line ${m.lineNo}: qty/price differs from approved estimate`,
        lineNo: m.lineNo,
      });
    }
  }
  for (const f of opts.pricingFindings ?? []) {
    if (f.severity === "HARD_REJECT") hardRejects.push(f);
    else flags.push(f);
  }
  return { hardRejects, flags };
}

function qtyOf(line: Record<string, unknown>): number | null {
  const qv = line.quantity ?? line.qty;
  if (qv == null || qv === "") return null;
  const n = Number(qv);
  return Number.isFinite(n) ? n : null;
}

function locationFromRaw(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw);
  if (s.length < 110) return null;
  const loc = s.slice(108, 110).trim();
  return loc || null;
}

export async function loadApprovedEstimateLines(opts: {
  eventId: string;
  tenantId?: string;
}): Promise<{
  estimateId: string | null;
  revisionId: string | null;
  totalCents: number;
  lines: MatchableLine[];
}> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  // APPROVED / COMPLETED estimate only — content lines from that estimate's
  // latest content-bearing revision (status-only approve rev may have 0 lines).
  const { rows } = await q(
    `SELECT e.id AS estimate_id, r.id AS revision_id, r.total
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     JOIN repair.estimate_revisions r
       ON r.estimate_id = e.id AND r.rev_no = e.current_revision
     WHERE e.event_id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL
       AND s.code IN ('APPROVED','COMPLETED')
     ORDER BY e.created_at ASC
     LIMIT 1`,
    [opts.eventId, tenantId],
  );
  if (!rows[0]) {
    return { estimateId: null, revisionId: null, totalCents: 0, lines: [] };
  }
  const estimateId = String(rows[0].estimate_id);
  const content = await getContentLinesForEstimate(estimateId, tenantId);
  const lines = content.lines.map((l) => {
    const labor = lineLaborCents(l);
    const mat = lineMaterialCents(l);
    const tot = lineTotalCents(l);
    const locStored =
      l.location_on_car != null ? String(l.location_on_car).trim() : "";
    return {
      lineNo: Number(l.line_no ?? 0),
      jobCode: String(l.aar_job_code ?? "").trim(),
      location: locStored || locationFromRaw(l.raw_line),
      qualifier:
        l.qualifier != null && String(l.qualifier).trim()
          ? String(l.qualifier).trim()
          : null,
      qty: qtyOf(l),
      laborCents: labor,
      materialCents: mat,
      totalCents: tot || labor + mat,
      respCode: l.resp_code != null ? String(l.resp_code) : null,
    };
  });
  return {
    estimateId,
    revisionId: content.revision?.id != null
      ? String(content.revision.id)
      : String(rows[0].revision_id),
    totalCents: dollarsToCents(rows[0].total),
    lines,
  };
}

export async function loadInvoiceLines(invoiceId: string, tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT line_no, aar_job_code, qualifier, location_on_car, quantity,
            labor_cents, material_cents, total_cents, resp_code,
            short_pay_cents, short_pay_reason, raw_line
     FROM repair.invoice_lines
     WHERE invoice_id = $1 AND tenant_id = $2
     ORDER BY line_no ASC`,
    [invoiceId, tenantId],
  );
  return rows.map((r) => {
    const locStored =
      r.location_on_car != null ? String(r.location_on_car).trim() : "";
    return {
      lineNo: Number(r.line_no),
      jobCode: String(r.aar_job_code ?? "").trim(),
      location: locStored || locationFromRaw(r.raw_line),
      qualifier:
        r.qualifier != null && String(r.qualifier).trim()
          ? String(r.qualifier).trim()
          : null,
      qty: r.quantity != null ? Number(r.quantity) : null,
      laborCents: Number(r.labor_cents ?? 0),
      materialCents: Number(r.material_cents ?? 0),
      totalCents: Number(r.total_cents ?? 0),
      respCode: r.resp_code != null ? String(r.resp_code) : null,
      shortPayCents: r.short_pay_cents != null ? Number(r.short_pay_cents) : null,
      shortPayReason: r.short_pay_reason != null ? String(r.short_pay_reason) : null,
    };
  });
}

/** Persist invoice lines from 500-byte AAR (idempotent replace). */
export async function replaceInvoiceLinesFromAar(opts: {
  invoiceId: string;
  aarBytes: Buffer;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const parsed = parseAarFile(opts.aarBytes);
  await q(`DELETE FROM repair.invoice_lines WHERE invoice_id = $1`, [opts.invoiceId]);
  let lineNo = 0;
  for (const pl of parsed.lines) {
    if (pl.recordFormat !== "1") continue;
    lineNo += 1;
    const labor = Math.trunc(pl.laborCents ?? 0);
    const mat = Math.trunc(Math.abs(pl.materialCents ?? 0));
    const qtyRaw = pl.fields?.quantity;
    const qty =
      qtyRaw != null && qtyRaw !== "" && Number.isFinite(Number(qtyRaw))
        ? Number(qtyRaw)
        : null;
    const locRaw = pl.fields?.location_on_car;
    const location =
      locRaw != null && String(locRaw).trim()
        ? String(locRaw).trim()
        : locationFromRaw(pl.rawLine);
    await q(
      `INSERT INTO repair.invoice_lines
         (tenant_id, invoice_id, line_no, aar_job_code, qualifier, location_on_car,
          why_made, resp_code, quantity, labor_cents, material_cents, total_cents,
          raw_line, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        tenantId,
        opts.invoiceId,
        lineNo,
        pl.appliedJobCode,
        pl.appliedQualifier,
        location,
        pl.whyMade,
        pl.respCode,
        qty,
        labor,
        mat,
        labor + mat,
        pl.rawLine,
        opts.actor,
      ],
    );
  }
  return lineNo;
}

/** Seed/helper: insert synthetic invoice lines (no AAR). */
export async function replaceInvoiceLinesManual(opts: {
  invoiceId: string;
  actor: string;
  tenantId?: string;
  lines: Array<{
    lineNo: number;
    jobCode: string;
    location?: string | null;
    qualifier?: string | null;
    qty?: number | null;
    laborCents: number;
    materialCents?: number;
    respCode?: string | null;
  }>;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  await q(`DELETE FROM repair.invoice_lines WHERE invoice_id = $1`, [opts.invoiceId]);
  for (const l of opts.lines) {
    const mat = Math.trunc(l.materialCents ?? 0);
    const labor = Math.trunc(l.laborCents);
    await q(
      `INSERT INTO repair.invoice_lines
         (tenant_id, invoice_id, line_no, aar_job_code, qualifier, location_on_car,
          resp_code, quantity, labor_cents, material_cents, total_cents, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        tenantId,
        opts.invoiceId,
        l.lineNo,
        l.jobCode,
        l.qualifier ?? null,
        l.location ?? null,
        l.respCode ?? null,
        l.qty ?? null,
        labor,
        mat,
        labor + mat,
        opts.actor,
      ],
    );
  }
}

export function respSplitTotals(matched: MatchedLine[]): {
  ownerCents: number;
  lessee6Cents: number;
  road3Cents: number;
  otherCents: number;
} {
  let ownerCents = 0;
  let lessee6Cents = 0;
  let road3Cents = 0;
  let otherCents = 0;
  for (const m of matched) {
    const cents = m.invoice?.totalCents ?? m.estimate?.totalCents ?? 0;
    const resp = String(m.invoice?.respCode ?? m.estimate?.respCode ?? "").trim();
    if (resp === "6") lessee6Cents += cents;
    else if (resp === "3") road3Cents += cents;
    else if (resp === "1" || resp === "" || resp === "2") ownerCents += cents;
    else otherCents += cents;
  }
  return { ownerCents, lessee6Cents, road3Cents, otherCents };
}

export async function listOwnerInvoiceQueue(opts: {
  tenantId?: string;
  shopId?: string | null;
  status?: string | null;
  minAgeDays?: number | null;
  overEstimateOnly?: boolean;
  limit?: number;
} = {}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const { rows } = await q(
    `SELECT i.id, i.invoice_no, i.invoice_date, i.total, i.estimate_total,
            i.workflow_status, i.payment_status, i.match_status, i.mismatch_flagged,
            i.created_at, i.decided_at, i.due_date, i.paid_at, i.paid_ref,
            i.short_pay_cents, i.approved_amount_cents, i.flags_summary,
            i.entity_code, i.shop_id,
            e.car_mark, e.car_number, e.id AS event_id,
            sh.name AS shop_name, sh.shop_mark, sh.reporting_mark,
            ROUND(COALESCE(i.total,0) * 100)::bigint AS invoice_cents,
            ROUND(COALESCE(i.estimate_total, i.approved_estimate_cents::numeric / 100, 0) * 100)::bigint
              AS estimate_cents,
            (CURRENT_DATE - COALESCE(i.invoice_date, i.created_at::date))::int AS age_days
     FROM repair.invoices i
     JOIN repair.events e ON e.id = i.event_id
     LEFT JOIN repair.shops sh ON sh.id = i.shop_id
     WHERE i.tenant_id = $1 AND i.deleted_at IS NULL
       AND ($2::uuid IS NULL OR i.shop_id = $2)
       AND (
         $3::text IS NULL
         OR i.workflow_status = $3
         OR i.payment_status = $3
       )
     ORDER BY i.created_at DESC
     LIMIT $4`,
    [tenantId, opts.shopId ?? null, opts.status?.trim() || null, limit],
  );

  const tolCache = new Map<string, EntityTolerance>();
  const out = [];
  for (const r of rows) {
    const invC = Number(r.invoice_cents ?? dollarsToCents(r.total));
    const estC = Number(r.estimate_cents ?? dollarsToCents(r.estimate_total));
    const entityCode = r.entity_code != null ? String(r.entity_code) : "*";
    if (!tolCache.has(entityCode)) {
      tolCache.set(entityCode, await getEntityTolerance({ entityCode, tenantId }));
    }
    const tol = tolCache.get(entityCode)!;
    const delta = invC - estC;
    const pct =
      estC === 0 ? (delta === 0 ? 0 : 100) : Math.round((Math.abs(delta) * 10000) / Math.abs(estC)) / 100;
    const age = Number(r.age_days ?? 0);
    if (opts.minAgeDays != null && age < opts.minAgeDays) continue;
    if (opts.overEstimateOnly && delta <= 0) continue;
    out.push({
      id: String(r.id),
      eventId: String(r.event_id),
      carMark: String(r.car_mark),
      carNumber: String(r.car_number),
      shopId: r.shop_id ? String(r.shop_id) : null,
      shopMark: String(r.shop_mark || r.reporting_mark || ""),
      shopName: r.shop_name ? String(r.shop_name) : null,
      invoiceNo: String(r.invoice_no),
      invoiceDate:
        toIsoDateOnly(r.invoice_date) ??
        toIsoDateOnly(r.created_at) ??
        "",
      invoiceCents: invC,
      estimateCents: estC,
      differenceCents: delta,
      differencePct: pct,
      workflowStatus: r.workflow_status ? String(r.workflow_status) : null,
      paymentStatus: r.payment_status ? String(r.payment_status) : null,
      flags: r.flags_summary ? String(r.flags_summary) : r.mismatch_flagged ? "MISMATCH" : "",
      ageDays: age,
      dueDate: toIsoDateOnly(r.due_date),
      paidAt: toIsoDateOnly(r.paid_at),
      paidRef: r.paid_ref ? String(r.paid_ref) : null,
      shortPayCents: r.short_pay_cents != null ? Number(r.short_pay_cents) : null,
      approvedAmountCents:
        r.approved_amount_cents != null ? Number(r.approved_amount_cents) : null,
      tolerance: tol,
    });
  }
  return out;
}

export async function getInvoiceReviewBundle(opts: {
  invoiceId: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT i.*, e.car_mark, e.car_number, e.id AS event_id, e.entity_code AS event_entity,
            sh.name AS shop_name, sh.shop_mark, sh.reporting_mark
     FROM repair.invoices i
     JOIN repair.events e ON e.id = i.event_id
     LEFT JOIN repair.shops sh ON sh.id = i.shop_id
     WHERE i.id = $1 AND i.tenant_id = $2 AND i.deleted_at IS NULL`,
    [opts.invoiceId, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Invoice not found" };
  const inv = rows[0];
  const eventId = String(inv.event_id);
  const estimate = await loadApprovedEstimateLines({ eventId, tenantId });
  // Never synthesize a phantom header line — that falsely yields 1 LINE_ADDED
  // + N LINE_REMOVED when totals match an APPROVED estimate with real lines.
  const invoiceLines = await loadInvoiceLines(opts.invoiceId, tenantId);
  const matched = matchInvoiceToEstimateLines({
    estimateLines: estimate.lines,
    invoiceLines,
  });
  const entityCode =
    (inv.entity_code != null ? String(inv.entity_code) : null) ||
    (inv.event_entity != null ? String(inv.event_entity) : null) ||
    "*";
  const tolerance = await getEntityTolerance({ entityCode, tenantId });
  const invoiceCents = dollarsToCents(inv.total);
  const estimateCents = estimate.totalCents || dollarsToCents(inv.estimate_total);
  const tolCheck = withinTolerance({
    invoiceCents,
    estimateCents,
    toleranceCents: tolerance.toleranceCents,
    tolerancePctBp: tolerance.tolerancePctBp,
  });

  // CID uncleared on linked estimate?
  let cidUncleared = false;
  if (estimate.estimateId) {
    const { rows: cidRows } = await q(
      `SELECT count(*)::int AS n
       FROM repair.estimate_validation_findings f
       JOIN repair.estimate_validation_runs r ON r.id = f.run_id
       WHERE r.estimate_id = $1 AND f.cleared_at IS NULL
         AND (f.code ILIKE '%CID%' OR f.message ILIKE '%CID%' OR f.code = 'MISSING_CID')`,
      [estimate.estimateId],
    ).catch(() => ({ rows: [{ n: 0 }] }));
    cidUncleared = Number(cidRows[0]?.n ?? 0) > 0;
  }

  const validation = await validateInvoiceForReview({
    invoiceNo: String(inv.invoice_no ?? ""),
    invoiceCents,
    estimateCents,
    matched,
    cidUncleared,
  });

  const split = respSplitTotals(matched);
  const canApprove =
    validation.hardRejects.length === 0 &&
    (tolCheck.within || Boolean(inv.over_tolerance_reason));

  return {
    ok: true as const,
    invoice: {
      id: String(inv.id),
      invoiceNo: String(inv.invoice_no),
      invoiceDate:
        toIsoDateOnly(inv.invoice_date) ??
        toIsoDateOnly(inv.created_at) ??
        "",
      totalCents: invoiceCents,
      estimateCents,
      workflowStatus: inv.workflow_status ? String(inv.workflow_status) : null,
      paymentStatus: inv.payment_status ? String(inv.payment_status) : null,
      dueDate: toIsoDateOnly(inv.due_date),
      paidAt: toIsoDateOnly(inv.paid_at),
      paidRef: inv.paid_ref ? String(inv.paid_ref) : null,
      shortPayCents: inv.short_pay_cents != null ? Number(inv.short_pay_cents) : null,
      overToleranceReason: inv.over_tolerance_reason
        ? String(inv.over_tolerance_reason)
        : null,
      rebillStatus: inv.rebill_status ? String(inv.rebill_status) : null,
      ownerNote: inv.owner_decision_note ? String(inv.owner_decision_note) : null,
    },
    car: { mark: String(inv.car_mark), number: String(inv.car_number) },
    shop: {
      id: inv.shop_id ? String(inv.shop_id) : null,
      mark: String(inv.shop_mark || inv.reporting_mark || ""),
      name: inv.shop_name ? String(inv.shop_name) : null,
    },
    eventId,
    estimateId: estimate.estimateId,
    matched,
    validation,
    tolerance,
    tolCheck,
    canApprove: validation.hardRejects.length === 0 && tolCheck.within,
    canApproveWithReason: validation.hardRejects.length === 0 && !tolCheck.within,
    approveEnabled: canApprove || (validation.hardRejects.length === 0 && tolCheck.within),
    respSplit: split,
    displays: {
      invoiceTotal: formatCentsAsDollars(invoiceCents),
      estimateTotal: formatCentsAsDollars(estimateCents),
      delta: formatCentsAsDollars(tolCheck.deltaCents),
    },
  };
}

async function closeBoAfterInvoiceApprove(opts: {
  eventId: string;
  invoiceNo: string;
  actor: string;
  tenantId: string;
}) {
  const { markBadOrderClosed } = await import("./shop-clarity");
  const closed = await markBadOrderClosed({
    eventId: opts.eventId,
    actor: opts.actor,
    invoiceNo: opts.invoiceNo,
    invoicedAt: new Date().toISOString().slice(0, 10),
  });
  if (!closed.ok) {
    // Still try setBoStatus CLOSED if close requirements partially met
    const { setBoStatus } = await import("./bo-status");
    await setBoStatus({
      eventId: opts.eventId,
      to: "CLOSED",
      actor: opts.actor,
      actionName: "Invoice approved → Closed",
      tenantId: opts.tenantId,
      force: true,
    }).catch(() => undefined);
  }
  return closed;
}

/** Approve → Payable (or Short-paid). Closes BO. Queues rebill when Resp 6/3. */
export async function approveOwnerInvoice(opts: {
  invoiceId: string;
  actor: string;
  overToleranceReason?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const bundle = await getInvoiceReviewBundle({
    invoiceId: opts.invoiceId,
    tenantId,
  });
  if (!bundle.ok) return bundle;

  if (bundle.validation.hardRejects.length) {
    return {
      ok: false as const,
      status: 422,
      error: bundle.validation.hardRejects.map((f) => f.message).join("; "),
      hardRejects: bundle.validation.hardRejects,
    };
  }
  if (!bundle.tolCheck.within) {
    const reason = (opts.overToleranceReason ?? "").trim();
    if (!reason) {
      return {
        ok: false as const,
        status: 409,
        error:
          "Invoice over tolerance — owner/MP approval reason required",
        tolCheck: bundle.tolCheck,
      };
    }
  }

  const terms = bundle.tolerance.paymentTermsDays || DEFAULT_PAYMENT_TERMS_DAYS;
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + terms);
  const dueDate = due.toISOString().slice(0, 10);
  const approvedCents = bundle.invoice.totalCents;
  const split = bundle.respSplit;
  const rebill =
    split.lessee6Cents > 0 || split.road3Cents > 0 ? "REBILL_PENDING" : "NONE";

  const { rows } = await q(
    `UPDATE repair.invoices
     SET workflow_status = 'PAYABLE',
         payment_status = 'PAYABLE',
         decided_by = $1, decided_at = now(),
         approved_by = coalesce(approved_by, $1),
         approved_at = coalesce(approved_at, now()),
         match_status = CASE
           WHEN match_status = 'MISMATCH' THEN match_status ELSE 'APPROVED' END,
         due_date = $4::date,
         approved_amount_cents = $5,
         over_tolerance_reason = $6,
         rebill_status = $7,
         flags_summary = $8
     WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
       AND coalesce(workflow_status,'') IN (
         'UNDER_OWNER_REVIEW','INVOICE_SUBMITTED','ACCEPTED',''
       )
     RETURNING *`,
    [
      opts.actor,
      opts.invoiceId,
      tenantId,
      dueDate,
      approvedCents,
      opts.overToleranceReason?.trim() || null,
      rebill,
      bundle.validation.flags.map((f) => f.code).join(",") || null,
    ],
  );
  if (!rows[0]) {
    return {
      ok: false as const,
      status: 409,
      error: "Invoice not in reviewable state",
    };
  }

  await writeAudit({
    tenantId,
    entity: "invoice",
    entityId: opts.invoiceId,
    action: "INVOICE_APPROVED_PAYABLE",
    after: {
      workflow_status: "PAYABLE",
      payment_status: "PAYABLE",
      due_date: dueDate,
      approved_amount_cents: approvedCents,
      over_tolerance_reason: opts.overToleranceReason ?? null,
      rebill_status: rebill,
      resp_split: split,
    },
    actor: opts.actor,
    via: "UI",
  });

  await closeBoAfterInvoiceApprove({
    eventId: bundle.eventId,
    invoiceNo: bundle.invoice.invoiceNo,
    actor: opts.actor,
    tenantId,
  });

  return {
    ok: true as const,
    invoice: rows[0],
    dueDate,
    paymentStatus: "PAYABLE" as const,
    rebillStatus: rebill,
    respSplit: split,
  };
}

export async function rejectOwnerInvoice(opts: {
  invoiceId: string;
  actor: string;
  note: string;
  lineComments?: Array<{ lineNo: number; text: string }>;
  tenantId?: string;
}) {
  const note = (opts.note ?? "").trim();
  if (!note) {
    return { ok: false as const, status: 400, error: "Reject reason required" };
  }
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.invoices
     SET workflow_status = 'REJECTED',
         payment_status = NULL,
         decided_by = $1, decided_at = now(),
         owner_decision_note = $4
     WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
     RETURNING *`,
    [opts.actor, opts.invoiceId, tenantId, note],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Invoice not found" };
  const eventId = String(rows[0].event_id);
  for (const lc of opts.lineComments ?? []) {
    const text = (lc.text ?? "").trim();
    if (!text) continue;
    await q(
      `INSERT INTO repair.comments
         (tenant_id, event_id, body, author, created_by, subject, issue)
       VALUES ($1,$2,$3,$4,$4,$5,$6)`,
      [
        tenantId,
        eventId,
        text,
        opts.actor,
        `Invoice line ${lc.lineNo}`,
        "invoice_line_comment",
      ],
    ).catch(() => undefined);
  }
  // BO stays Invoice Submitted for shop resubmit
  const { setBoStatus } = await import("./bo-status");
  await setBoStatus({
    eventId,
    to: "INVOICE_SUBMITTED",
    actor: opts.actor,
    actionName: "Invoice rejected — back to shop",
    tenantId,
    force: true,
  }).catch(() => undefined);

  await writeAudit({
    tenantId,
    entity: "invoice",
    entityId: opts.invoiceId,
    action: "INVOICE_REJECTED",
    after: { note, lineComments: opts.lineComments ?? [] },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, invoice: rows[0] };
}

/** Short-pay: approve lesser amount with per-line reasons → SHORT_PAID / Payable path. */
export async function shortPayOwnerInvoice(opts: {
  invoiceId: string;
  actor: string;
  reason: string;
  lineShortPays: Array<{ lineNo: number; amountCents: number; reason: string }>;
  tenantId?: string;
}) {
  const reason = (opts.reason ?? "").trim();
  if (!reason) {
    return { ok: false as const, status: 400, error: "Short-pay reason required" };
  }
  if (!opts.lineShortPays?.length) {
    return { ok: false as const, status: 400, error: "At least one line short-pay required" };
  }
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const bundle = await getInvoiceReviewBundle({
    invoiceId: opts.invoiceId,
    tenantId,
  });
  if (!bundle.ok) return bundle;
  if (bundle.validation.hardRejects.some((f) => f.code === "MISSING_INVOICE_NO")) {
    return {
      ok: false as const,
      status: 422,
      error: "Invoice number required",
    };
  }

  let approvedCents = 0;
  for (const sp of opts.lineShortPays) {
    const amt = Math.trunc(sp.amountCents);
    if (amt < 0) {
      return { ok: false as const, status: 400, error: `Line ${sp.lineNo}: amount must be ≥ 0` };
    }
    if (!(sp.reason ?? "").trim()) {
      return {
        ok: false as const,
        status: 400,
        error: `Line ${sp.lineNo}: short-pay reason required`,
      };
    }
    approvedCents += amt;
    await q(
      `UPDATE repair.invoice_lines
       SET short_pay_cents = $1, short_pay_reason = $2
       WHERE invoice_id = $3 AND line_no = $4 AND tenant_id = $5`,
      [amt, sp.reason.trim(), opts.invoiceId, sp.lineNo, tenantId],
    );
  }

  const terms = bundle.tolerance.paymentTermsDays || DEFAULT_PAYMENT_TERMS_DAYS;
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + terms);
  const dueDate = due.toISOString().slice(0, 10);
  const shortPayCents = bundle.invoice.totalCents - approvedCents;

  const { rows } = await q(
    `UPDATE repair.invoices
     SET workflow_status = 'SHORT_PAID',
         payment_status = 'SHORT_PAID',
         decided_by = $1, decided_at = now(),
         approved_by = coalesce(approved_by, $1),
         approved_at = coalesce(approved_at, now()),
         due_date = $4::date,
         approved_amount_cents = $5,
         short_pay_cents = $6,
         short_pay_reason = $7,
         match_status = 'APPROVED',
         rebill_status = CASE
           WHEN coalesce(rebill_status,'NONE') = 'NONE' THEN 'NONE'
           ELSE rebill_status END
     WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
     RETURNING *`,
    [
      opts.actor,
      opts.invoiceId,
      tenantId,
      dueDate,
      approvedCents,
      shortPayCents,
      reason,
    ],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Invoice not found" };

  // Short-paid is still an approval for close gate
  await q(
    `UPDATE repair.invoices SET payment_status = 'PAYABLE', workflow_status = 'PAYABLE'
     WHERE id = $1`,
    [opts.invoiceId],
  );
  // Keep short_pay markers; payment_status Payable with short_pay_cents set
  await q(
    `UPDATE repair.invoices
     SET short_pay_cents = $2, short_pay_reason = $3,
         approved_amount_cents = $4,
         payment_status = 'PAYABLE', workflow_status = 'PAYABLE'
     WHERE id = $1`,
    [opts.invoiceId, shortPayCents, reason, approvedCents],
  );

  await writeAudit({
    tenantId,
    entity: "invoice",
    entityId: opts.invoiceId,
    action: "INVOICE_SHORT_PAID",
    after: {
      approved_amount_cents: approvedCents,
      short_pay_cents: shortPayCents,
      reason,
      lines: opts.lineShortPays,
    },
    actor: opts.actor,
    via: "UI",
  });

  await closeBoAfterInvoiceApprove({
    eventId: bundle.eventId,
    invoiceNo: bundle.invoice.invoiceNo,
    actor: opts.actor,
    tenantId,
  });

  return {
    ok: true as const,
    approvedAmountCents: approvedCents,
    shortPayCents,
    dueDate,
    paymentStatus: "PAYABLE" as const,
  };
}

export async function createPaymentBatch(opts: {
  invoiceIds: string[];
  actor: string;
  note?: string;
  tenantId?: string;
}) {
  if (!opts.invoiceIds?.length) {
    return { ok: false as const, status: 400, error: "Select at least one payable invoice" };
  }
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const batchNo = `PB-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now().toString(36).toUpperCase()}`;
  const { rows: batchRows } = await q(
    `INSERT INTO repair.payment_batches
       (tenant_id, batch_no, status, note, created_by)
     VALUES ($1,$2,'OPEN',$3,$4)
     RETURNING *`,
    [tenantId, batchNo, opts.note?.trim() || null, opts.actor],
  );
  const batchId = String(batchRows[0].id);
  const { rows: updated } = await q(
    `UPDATE repair.invoices
     SET payment_status = 'IN_BATCH',
         workflow_status = 'IN_BATCH',
         payment_batch_id = $1
     WHERE id = ANY($2::uuid[]) AND tenant_id = $3 AND deleted_at IS NULL
       AND payment_status IN ('PAYABLE','SHORT_PAID')
     RETURNING id`,
    [batchId, opts.invoiceIds, tenantId],
  );
  if (!updated.length) {
    await q(`UPDATE repair.payment_batches SET deleted_at = now(), deleted_by = $2 WHERE id = $1`, [
      batchId,
      opts.actor,
    ]);
    return {
      ok: false as const,
      status: 409,
      error: "No payable invoices updated (already batched or not payable)",
    };
  }
  await writeAudit({
    tenantId,
    entity: "payment_batch",
    entityId: batchId,
    action: "PAYMENT_BATCH_CREATED",
    after: { batch_no: batchNo, invoice_ids: updated.map((r) => String(r.id)) },
    actor: opts.actor,
    via: "UI",
  });
  return {
    ok: true as const,
    batch: batchRows[0],
    invoiceCount: updated.length,
  };
}

/** Generic CSV AP layout (documented placeholder — no accounting API). */
export function buildPaymentBatchCsv(
  rows: Array<{
    batchNo: string;
    invoiceNo: string;
    shopMark: string;
    carMark: string;
    carNumber: string;
    amountCents: number;
    dueDate: string | null;
    shortPayCents: number | null;
  }>,
): string {
  const header = [
    "batch_no",
    "invoice_no",
    "shop_mark",
    "car",
    "amount_dollars",
    "amount_cents",
    "due_date",
    "short_pay_cents",
    "currency",
  ].join(",");
  const lines = rows.map((r) => {
    const dueIso = toIsoDateOnly(r.dueDate) ?? "";
    return [
      r.batchNo,
      r.invoiceNo,
      r.shopMark,
      `${r.carMark} ${r.carNumber}`,
      // money: exactly 2 decimals, no $ sign
      formatCentsAsDollars(r.amountCents),
      String(r.amountCents),
      dueIso,
      r.shortPayCents != null ? String(r.shortPayCents) : "",
      "USD",
    ]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(",");
  });
  return [header, ...lines].join("\n") + "\n";
}

export function writePaymentCsvToOutbox(opts: {
  batchNo: string;
  csv: string;
}): string {
  mkdirSync(PAYMENT_CSV_OUTBOX_DIR, { recursive: true });
  const safe = opts.batchNo.replace(/[^A-Za-z0-9._-]+/g, "_");
  const filePath = join(PAYMENT_CSV_OUTBOX_DIR, `${safe}.csv`);
  writeFileSync(filePath, opts.csv, "utf8");
  return filePath;
}

export async function exportPaymentBatch(opts: {
  batchId: string;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows: batches } = await q(
    `SELECT * FROM repair.payment_batches
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [opts.batchId, tenantId],
  );
  if (!batches[0]) return { ok: false as const, status: 404, error: "Batch not found" };
  const batchNo = String(batches[0].batch_no);
  const { rows: invs } = await q(
    `SELECT i.invoice_no, i.approved_amount_cents, i.total,
            i.due_date::text AS due_date,
            i.short_pay_cents, e.car_mark, e.car_number,
            sh.shop_mark, sh.reporting_mark
     FROM repair.invoices i
     JOIN repair.events e ON e.id = i.event_id
     LEFT JOIN repair.shops sh ON sh.id = i.shop_id
     WHERE i.payment_batch_id = $1 AND i.deleted_at IS NULL`,
    [opts.batchId],
  );
  const csv = buildPaymentBatchCsv(
    invs.map((r) => ({
      batchNo,
      invoiceNo: String(r.invoice_no),
      shopMark: String(r.shop_mark || r.reporting_mark || ""),
      carMark: String(r.car_mark),
      carNumber: String(r.car_number),
      amountCents:
        r.approved_amount_cents != null
          ? Number(r.approved_amount_cents)
          : dollarsToCents(r.total),
      dueDate: toIsoDateOnly(r.due_date),
      shortPayCents: r.short_pay_cents != null ? Number(r.short_pay_cents) : null,
    })),
  );
  const outboxPath = writePaymentCsvToOutbox({ batchNo, csv });
  await q(
    `UPDATE repair.payment_batches
     SET status = 'EXPORTED', export_csv = $1, exported_at = now(),
         exported_by = $2, outbox_path = $4
     WHERE id = $3`,
    [csv, opts.actor, opts.batchId, outboxPath],
  );
  await q(
    `UPDATE repair.invoices
     SET payment_status = 'EXPORTED', workflow_status = 'EXPORTED'
     WHERE payment_batch_id = $1 AND deleted_at IS NULL`,
    [opts.batchId],
  );
  await writeAudit({
    tenantId,
    entity: "payment_batch",
    entityId: opts.batchId,
    action: "PAYMENT_BATCH_EXPORTED",
    after: { batch_no: batchNo, rows: invs.length, outbox_path: outboxPath },
    actor: opts.actor,
    via: "UI",
  });
  return {
    ok: true as const,
    csv,
    batchNo,
    rowCount: invs.length,
    outboxPath,
  };
}

/** Fetch one payment batch with member invoices (history drill-in). */
export async function getPaymentBatchDetail(opts: {
  batchId: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows: batches } = await q(
    `SELECT * FROM repair.payment_batches
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [opts.batchId, tenantId],
  );
  if (!batches[0]) return { ok: false as const, status: 404, error: "Batch not found" };
  const { rows: invs } = await q(
    `SELECT i.id, i.invoice_no, i.payment_status, i.workflow_status,
            i.approved_amount_cents, i.total, i.due_date::text AS due_date,
            i.paid_at::text AS paid_at, i.paid_ref, i.short_pay_cents,
            e.car_mark, e.car_number,
            sh.shop_mark, sh.reporting_mark, sh.name AS shop_name
     FROM repair.invoices i
     JOIN repair.events e ON e.id = i.event_id
     LEFT JOIN repair.shops sh ON sh.id = i.shop_id
     WHERE i.payment_batch_id = $1 AND i.deleted_at IS NULL
     ORDER BY i.invoice_no ASC`,
    [opts.batchId],
  );
  return {
    ok: true as const,
    batch: batches[0],
    invoices: invs.map((r) => ({
      id: String(r.id),
      invoiceNo: String(r.invoice_no),
      paymentStatus: r.payment_status ? String(r.payment_status) : null,
      workflowStatus: r.workflow_status ? String(r.workflow_status) : null,
      amountCents:
        r.approved_amount_cents != null
          ? Number(r.approved_amount_cents)
          : dollarsToCents(r.total),
      dueDate: toIsoDateOnly(r.due_date),
      paidAt: toIsoDateOnly(r.paid_at),
      paidRef: r.paid_ref ? String(r.paid_ref) : null,
      shortPayCents: r.short_pay_cents != null ? Number(r.short_pay_cents) : null,
      carMark: String(r.car_mark),
      carNumber: String(r.car_number),
      shopMark: String(r.shop_mark || r.reporting_mark || ""),
      shopName: r.shop_name ? String(r.shop_name) : null,
    })),
  };
}

export async function recordInvoicePaid(opts: {
  invoiceId: string;
  actor: string;
  paidAt: string;
  paidRef: string;
  paidMethod?: string;
  tenantId?: string;
}) {
  const paidAt = (opts.paidAt ?? "").trim().slice(0, 10);
  const paidRef = (opts.paidRef ?? "").trim();
  if (!paidAt || !paidRef) {
    return { ok: false as const, status: 400, error: "paidAt and paidRef required" };
  }
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.invoices
     SET payment_status = 'PAID',
         workflow_status = 'PAID',
         paid_at = $3::date,
         paid_ref = $4,
         paid_method = $5
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       AND payment_status IN ('PAYABLE','IN_BATCH','EXPORTED','SHORT_PAID')
     RETURNING *`,
    [
      opts.invoiceId,
      tenantId,
      paidAt,
      paidRef,
      opts.paidMethod?.trim() || null,
    ],
  );
  if (!rows[0]) {
    return {
      ok: false as const,
      status: 409,
      error: "Invoice not found or not in a payable/exported state",
    };
  }
  await writeAudit({
    tenantId,
    entity: "invoice",
    entityId: opts.invoiceId,
    action: "INVOICE_PAID",
    after: {
      paid_at: paidAt,
      paid_ref: paidRef,
      method: opts.paidMethod ?? null,
    },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, invoice: rows[0] };
}

/** Shop view: own invoices only — status + paid date/ref. */
export async function listShopInvoicePayments(opts: {
  shopId: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT i.id, i.invoice_no, i.workflow_status, i.payment_status,
            i.due_date::text AS due_date, i.paid_at::text AS paid_at,
            i.paid_ref, i.short_pay_cents,
            i.approved_amount_cents, i.total, i.created_at,
            e.car_mark, e.car_number
     FROM repair.invoices i
     JOIN repair.events e ON e.id = i.event_id
     WHERE i.tenant_id = $1 AND i.shop_id = $2 AND i.deleted_at IS NULL
     ORDER BY i.created_at DESC
     LIMIT 200`,
    [tenantId, opts.shopId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    invoiceNo: String(r.invoice_no),
    carMark: String(r.car_mark),
    carNumber: String(r.car_number),
    workflowStatus: r.workflow_status ? String(r.workflow_status) : null,
    paymentStatus: r.payment_status ? String(r.payment_status) : null,
    dueDate: toIsoDateOnly(r.due_date),
    paidAt: toIsoDateOnly(r.paid_at),
    paidRef: r.paid_ref ? String(r.paid_ref) : null,
    shortPayCents: r.short_pay_cents != null ? Number(r.short_pay_cents) : null,
    amountCents:
      r.approved_amount_cents != null
        ? Number(r.approved_amount_cents)
        : dollarsToCents(r.total),
  }));
}

export async function listPaymentBatches(tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT b.*,
            (SELECT count(*)::int FROM repair.invoices i
             WHERE i.payment_batch_id = b.id AND i.deleted_at IS NULL) AS invoice_count
     FROM repair.payment_batches b
     WHERE b.tenant_id = $1 AND b.deleted_at IS NULL
     ORDER BY b.created_at DESC
     LIMIT 50`,
    [tenantId],
  );
  return rows;
}
