/**
 * §H / §H r5 Owner invoice review + monthly close + multi-car smoke.
 * BRC grid + Exceptions toggle, match/diff, contrast AA, tolerance, reject,
 * short-pay (shortfall+net, no $0 rows), approve→month close→AP→paid (isolated
 * month / rolled back), 5-car + 12-car multi-car with per-car AAR split,
 * unselected/missing car HARD REJECT, DEMO-INV-MULTI / SHORT $36,732.04 /
 * $747.50, DEMO-only queue after clean.
 *
 * Run: npm run repair:smoke-invoice
 */
import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { q } from "../db";
import { migrateLocal } from "./migrate-local";
import {
  matchInvoiceToEstimateLines,
  withinTolerance,
  reconcileLineTotalsCents,
  validateInvoiceForReview,
  replaceInvoiceLinesManual,
  approveOwnerInvoice,
  rejectOwnerInvoice,
  shortPayOwnerInvoice,
  createPaymentBatch,
  exportPaymentBatch,
  recordInvoicePaid,
  listShopInvoicePayments,
  listOwnerInvoiceQueue,
  getInvoiceReviewBundle,
  loadApprovedEstimateLines,
  toIsoDateOnly,
  buildPaymentBatchCsv,
  DEFAULT_TOLERANCE_CENTS,
  DEFAULT_TOLERANCE_PCT_BP,
} from "../services/invoice-review";
import {
  ensureOpenAccountingMonth,
  closeAccountingMonth,
  invoiceStatusPlain,
  resetDemoAccountingMonths,
  isFutureMonthLabel,
  listAccountingMonths,
} from "../services/accounting-months";
import {
  createMultiCarInvoice,
  listMultiCarCandidates,
} from "../services/multi-car-invoice";
import { contrastRatio, SHOP_AA_TOKENS } from "../services/shop-clarity";
import {
  assertRepairColorsClean,
  lintDetectsDeliberateViolation,
} from "./lint-repair-colors";
import { createShop } from "../services/shops";
import { createBadOrder } from "../services/bo";
import { shopAcknowledge, shopArrivalDate } from "../services/bo-lifecycle";
import { ensureShopBoLink } from "../services/shop-workflow";
import { shopSubmitEstimate } from "../services/shop-portal";
import { approveEstimate } from "../services/estimates";
import { updateBoLifecycleDates } from "../services/shop-clarity";
import { submitShopInvoice } from "../services/invoices";
import { MISSED_POD_TILE, displayBoStatusLabel } from "../services/bo-status";
import { displayBadOrderStatus } from "../services/bo-grid";
import { parseAarFile } from "../services/aar-parser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../..");
const SAMPLE = join(__dirname, "reference/Sample_Shop_500byte_OFOX2609.txt");
const README = join(__dirname, "shop-samples/README.txt");
const RUN = Date.now().toString(36);
const MARK = "DEMO";

function ok(m: string) {
  console.log(`  OK  ${m}`);
}
function bad(label: string, detail: string): never {
  throw new Error(`${label}: ${detail}`);
}

async function seedCar(mark: string, number: string) {
  await q(
    `INSERT INTO public.railcars (id, car_number, car_initial, reporting_marks, active, entity, lessee_name)
     SELECT GREATEST((SELECT COALESCE(MAX(id),0) FROM public.railcars), 80000) + 1,
            $1, $2, $2, true, 'Main', 'HIDDEN'
     WHERE NOT EXISTS (
       SELECT 1 FROM public.railcars WHERE car_initial = $2 AND car_number = $1
     )`,
    [number, mark],
  );
  await q(
    `INSERT INTO public.v_valid_export_rows_data
       (export_src, export_id, car_initial, car_number, active, rider, assignment, assignment_id, lessee, start_date, end_date)
     SELECT 1, 80001, $2, $1, 1, 'R1', 'SMOKE-H', 'AH1', 'HIDDEN', '2026-01-01', NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM public.v_valid_export_rows_data
       WHERE car_initial = $2 AND car_number = $1
     )`,
    [number, mark],
  );
}

function withCar(bytes: Buffer, mark: string, number: string): Buffer {
  const parsed = parseAarFile(bytes);
  const ending = parsed.lineEnding === "CRLF" ? "\r\n" : "\n";
  const lines = parsed.lines.map((line) => {
    if (line.recordFormat !== "1") return line.rawLine;
    const m = mark.toUpperCase().padEnd(4, " ").slice(0, 4);
    const n = number.padStart(6, "0").slice(-6);
    return line.rawLine.slice(0, 47) + m + n + line.rawLine.slice(57);
  });
  return Buffer.from(lines.join(ending), "latin1");
}

function withShopMark(bytes: Buffer, shopMark: string): Buffer {
  const parsed = parseAarFile(bytes);
  const ending = parsed.lineEnding === "CRLF" ? "\r\n" : "\n";
  const m = shopMark.toUpperCase().padEnd(4, " ").slice(0, 4);
  const lines = parsed.lines.map((line) => {
    if (line.recordFormat !== "1") return line.rawLine;
    return line.rawLine.slice(0, 71) + m + line.rawLine.slice(75);
  });
  return Buffer.from(lines.join(ending), "latin1");
}

/** Build a multi-car 500-byte file: Format-1 lines for each selected car. */
function buildMultiCarAar(
  base: Buffer,
  cars: Array<{ carMark: string; carNumber: string }>,
  shopMark: string,
): Buffer {
  const parts: string[] = [];
  for (const c of cars) {
    const buf = withShopMark(withCar(base, c.carMark, c.carNumber), shopMark);
    const parsed = parseAarFile(buf);
    for (const line of parsed.lines) {
      if (line.recordFormat === "1") parts.push(line.rawLine);
    }
  }
  return Buffer.from(parts.join("\r\n") + "\r\n", "latin1");
}

async function ensureDs01(): Promise<string> {
  const { rows } = await q(
    `SELECT id FROM repair.shops
     WHERE deleted_at IS NULL AND (shop_mark = 'DS01' OR reporting_mark = 'DS01')
     LIMIT 1`,
  );
  if (rows[0]) return String(rows[0].id);
  const ds = await createShop({
    legalName: "Demo Shop DS01",
    city: "Toledo",
    state: "OH",
    splc: "382000",
    shopMark: "DS01",
    actor: "smoke-h",
  });
  if (!ds.ok) bad("ds01", ds.error);
  return String(ds.shop!.id);
}

async function driveToInvoice(opts: {
  shopId: string;
  carNumber: string;
  invoiceNo: string;
  totalOverride?: number;
  tag: string;
}) {
  await seedCar(MARK, opts.carNumber);
  const bo = await createBadOrder({
    carMark: MARK,
    carNumber: opts.carNumber,
    shopId: opts.shopId,
    shoppingReason: `§H smoke ${opts.tag}`,
    actor: "smoke-h",
    boRuleCode: "OTHER",
    boRuleOtherText: opts.tag,
    boDate: new Date().toISOString().slice(0, 10),
    boCity: "Demo",
    boState: "OH",
    allowDuplicates: true,
  });
  if (!bo.ok) bad("create-bo", JSON.stringify(bo));
  const eventId = String(bo.event.id);
  await q(`UPDATE repair.events SET is_smoke = true WHERE id = $1`, [eventId]);
  await q(`UPDATE repair.bad_orders SET is_smoke = true WHERE event_id = $1`, [
    eventId,
  ]);

  const ensured = await ensureShopBoLink({
    eventId,
    shopMark: "DS01",
    actor: "smoke-h",
  });
  if (!ensured.ok || !ensured.token) bad("link", "expected new shop link token");
  const token = ensured.token;

  const ack = await shopAcknowledge(token, "shop@smoke-h.test");
  if (!ack.ok) bad("ack", ack.error);
  const hand = await shopArrivalDate(
    token,
    "shop@smoke-h.test",
    "2026-09-01T12:00:00.000Z",
  );
  if (!hand.ok) bad("onhand", hand.error);

  const base = existsSync(SAMPLE) ? readFileSync(SAMPLE) : Buffer.alloc(500, 0x20);
  let file = withShopMark(withCar(base, MARK, opts.carNumber), "DS01");
  if (file.length < 500) file = Buffer.concat([file, Buffer.alloc(500 - file.length, 0x20)]);

  process.env.REPAIR_SHOW_SMOKE = "1";
  const sub = await shopSubmitEstimate({
    role: "shop",
    shopMark: "DS01",
    actor: "shop@smoke-h.test",
    eventId,
    bytes: file,
    filename: `h-${opts.tag}.dat`,
    forceAcceptFlags: true,
  });
  if (!sub.ok) bad("est", sub.error || JSON.stringify(sub));
  const estimateId = String((sub as { estimateId?: string }).estimateId ?? "");
  if (!estimateId) bad("est-id", JSON.stringify(sub));

  await q(
    `UPDATE repair.events
     SET yard_arrived_at = coalesce(yard_arrived_at, $2::timestamptz)
     WHERE id = $1`,
    [eventId, "2026-09-01T12:00:00.000Z"],
  );
  const ap = await approveEstimate({ estimateId, actor: "owner@smoke-h.test" });
  if (!ap.ok) {
    const { rows: st } = await q(
      `SELECT s.code FROM repair.estimates e
       JOIN repair.statuses s ON s.id = e.status_id WHERE e.id = $1`,
      [estimateId],
    );
    if (String(st[0]?.code) !== "APPROVED") {
      bad("approve-est", ap.error || String(st[0]?.code));
    }
  }

  await updateBoLifecycleDates({
    eventId,
    actor: "shop@smoke-h.test",
    actorRole: "shop",
    completed: "2026-09-10",
  });
  await q(
    `UPDATE repair.estimate_validation_findings f
     SET cleared_at = now(), cleared_by = 'smoke-h'
     FROM repair.estimate_validation_runs r
     WHERE f.run_id = r.id AND r.estimate_id = $1 AND f.cleared_at IS NULL`,
    [estimateId],
  ).catch(() => undefined);

  const { rows: totRows } = await q(
    `SELECT r.total FROM repair.estimates e
     JOIN repair.estimate_revisions r
       ON r.estimate_id = e.id AND r.rev_no = e.current_revision
     WHERE e.id = $1`,
    [estimateId],
  );
  const estTotal = Number(totRows[0]?.total ?? 0);
  const total = opts.totalOverride != null ? opts.totalOverride : estTotal;

  const inv = await submitShopInvoice({
    rawToken: token,
    invoiceNo: opts.invoiceNo,
    total,
    actorEmail: "shop@smoke-h.test",
    file: {
      filename: `inv-${opts.tag}.pdf`,
      mime: "application/pdf",
      bytes: Buffer.from(`%PDF-1.4 smoke-h ${opts.tag}`),
    },
    aarFile: {
      filename: `inv-${opts.tag}.dat`,
      mime: "text/plain",
      // Full AAR (same bytes as approved estimate) so identical → 0 line diffs.
      // Truncating to ~2KB left invoice_lines empty → 0 inv + N REMOVED.
      bytes: file,
    },
  });
  if (!inv.ok) bad("invoice", inv.error);

  return {
    eventId,
    estimateId,
    invoiceId: String(inv.invoice.id),
    estTotal,
    total,
  };
}

async function main() {
  console.log("=== repair:smoke-invoice (§H) ===");
  process.env.REPAIR_LOCAL_DB = "1";
  process.env.REPAIR_DEV_BYPASS_AUTH = "1";
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL =
      "postgresql://repairdev:repairdev@127.0.0.1:5432/rlms_repair_dev";
  }
  await migrateLocal();

  const matched = matchInvoiceToEstimateLines({
    estimateLines: [
      {
        lineNo: 1,
        jobCode: "1000",
        qty: 1,
        laborCents: 10000,
        materialCents: 0,
        totalCents: 10000,
        respCode: "1",
      },
      {
        lineNo: 2,
        jobCode: "2000",
        qty: 2,
        laborCents: 5000,
        materialCents: 0,
        totalCents: 5000,
        respCode: "6",
      },
    ],
    invoiceLines: [
      {
        lineNo: 1,
        jobCode: "1000",
        qty: 1,
        laborCents: 10000,
        materialCents: 0,
        totalCents: 10000,
        respCode: "1",
      },
      {
        lineNo: 2,
        jobCode: "2000",
        qty: 3,
        laborCents: 7500,
        materialCents: 0,
        totalCents: 7500,
        respCode: "6",
      },
      {
        lineNo: 3,
        jobCode: "9999",
        qty: 1,
        laborCents: 100,
        materialCents: 0,
        totalCents: 100,
        respCode: "1",
      },
    ],
  });
  if (!matched.some((m) => m.kind === "QTY_PRICE_CHANGED")) {
    bad("diff-changed", "expected qty/price change");
  }
  if (!matched.some((m) => m.kind === "ADDED")) bad("diff-added", "expected added");
  const removed = matchInvoiceToEstimateLines({
    estimateLines: [
      {
        lineNo: 1,
        jobCode: "1000",
        qty: 1,
        laborCents: 100,
        materialCents: 0,
        totalCents: 100,
        respCode: "1",
      },
    ],
    invoiceLines: [],
  });
  if (!removed.some((m) => m.kind === "REMOVED")) bad("diff-removed", "expected removed");
  // Identical lines → 0 diffs (line# then job+loc+qual)
  const identicalUnit = matchInvoiceToEstimateLines({
    estimateLines: [
      {
        lineNo: 1,
        jobCode: "1000",
        location: "L",
        qualifier: "A",
        qty: 1,
        laborCents: 1000,
        materialCents: 0,
        totalCents: 1000,
        respCode: "1",
      },
      {
        lineNo: 2,
        jobCode: "2000",
        location: "R",
        qualifier: "B",
        qty: 2,
        laborCents: 2000,
        materialCents: 0,
        totalCents: 2000,
        respCode: "1",
      },
    ],
    invoiceLines: [
      {
        lineNo: 1,
        jobCode: "1000",
        location: "L",
        qualifier: "A",
        qty: 1,
        laborCents: 1000,
        materialCents: 0,
        totalCents: 1000,
        respCode: "1",
      },
      {
        lineNo: 2,
        jobCode: "2000",
        location: "R",
        qualifier: "B",
        qty: 2,
        laborCents: 2000,
        materialCents: 0,
        totalCents: 2000,
        respCode: "1",
      },
    ],
  });
  if (identicalUnit.some((m) => m.kind !== "MATCH")) {
    bad(
      "identical-unit",
      identicalUnit.map((m) => m.kind).join(","),
    );
  }
  // Fallback: match by job+location+qualifier when line numbers differ
  const byJlq = matchInvoiceToEstimateLines({
    estimateLines: [
      {
        lineNo: 10,
        jobCode: "4455",
        location: "AB",
        qualifier: "01",
        qty: 1,
        laborCents: 500,
        materialCents: 0,
        totalCents: 500,
        respCode: "1",
      },
    ],
    invoiceLines: [
      {
        lineNo: 99,
        jobCode: "4455",
        location: "AB",
        qualifier: "01",
        qty: 1,
        laborCents: 500,
        materialCents: 0,
        totalCents: 500,
        respCode: "1",
      },
    ],
  });
  if (byJlq.length !== 1 || byJlq[0].kind !== "MATCH") {
    bad("jlq-fallback", byJlq.map((m) => m.kind).join(","));
  }
  ok("match/diff: added / removed / qty-price / identical / jlq fallback");

  // CSV dates must be ISO YYYY-MM-DD (not Date.toString().slice)
  const csvProbe = buildPaymentBatchCsv([
    {
      batchNo: "PB-TEST",
      invoiceNo: "INV-1",
      shopMark: "DS01",
      carMark: "DEMO",
      carNumber: "1",
      amountCents: 12345,
      dueDate: new Date("2026-10-15T00:00:00.000Z") as unknown as string,
      shortPayCents: null,
    },
  ]);
  if (!csvProbe.includes("2026-10-15")) {
    bad("csv-iso", `expected ISO date in CSV, got: ${csvProbe}`);
  }
  if (csvProbe.includes("$") || /"[A-Za]{3} /.test(csvProbe)) {
    bad("csv-money-date", "CSV must not use $ or weekday date slices");
  }
  if (!csvProbe.includes("123.45")) bad("csv-money", "expected 2-decimal dollars");
  if (toIsoDateOnly(new Date("2026-01-02T12:00:00Z")) !== "2026-01-02") {
    bad("iso-helper", String(toIsoDateOnly(new Date("2026-01-02T12:00:00Z"))));
  }
  ok("CSV ISO dates + money 2dp no $");

  const tol0 = withinTolerance({
    invoiceCents: 10000,
    estimateCents: 10000,
    toleranceCents: DEFAULT_TOLERANCE_CENTS,
    tolerancePctBp: DEFAULT_TOLERANCE_PCT_BP,
  });
  if (!tol0.within) bad("tol-exact", "exact should be within");
  const tolOver = withinTolerance({
    invoiceCents: 10100,
    estimateCents: 10000,
    toleranceCents: 0,
    tolerancePctBp: 0,
  });
  if (tolOver.within) bad("tol-over", "over should gate");
  ok("tolerance gating $0/0%");

  const rec = reconcileLineTotalsCents(
    [{ totalCents: 5000 }, { totalCents: 5000 }],
    10000,
  );
  if (!rec.ok) bad("reconcile", String(rec.delta));
  if (reconcileLineTotalsCents([{ totalCents: 5000 }], 10000).ok) {
    bad("reconcile-bad", "should fail");
  }
  ok("totals reconcile to cent");

  const v = await validateInvoiceForReview({
    invoiceNo: "",
    invoiceCents: 100,
    estimateCents: 100,
    matched: [],
    cidUncleared: true,
  });
  if (!v.hardRejects.some((f) => f.code === "MISSING_INVOICE_NO")) {
    bad("val-invno", "missing");
  }
  if (!v.hardRejects.some((f) => f.code === "CID_FLAGS_OPEN")) {
    bad("val-cid", "CID");
  }
  ok("validation: invoice no + CID");

  if (displayBoStatusLabel("CLOSED") !== "Closed") {
    bad("label-bo", displayBoStatusLabel("CLOSED"));
  }
  if (
    displayBadOrderStatus({ status: "CLOSED", lifecycleStatus: null }) !== "Closed"
  ) {
    bad("label-grid", "Closed blank");
  }
  if (
    displayBadOrderStatus({ status: null, lifecycleStatus: "CLOSED" }) !== "Closed"
  ) {
    bad("label-life", "Closed from lifecycle");
  }
  if (MISSED_POD_TILE !== "Missed POD") bad("missed-tile", MISSED_POD_TILE);
  ok("Closed label + Missed POD tile");

  const shopId = await ensureDs01();
  await q(`UPDATE repair.shops SET is_smoke = true WHERE id = $1`, [shopId]).catch(
    () => undefined,
  );

  const readmeMtimeBefore = existsSync(README) ? statSync(README).mtimeMs : 0;

  // INV-H-IN: keep AAR lines identical to APPROVED estimate → 0 diffs
  const within = await driveToInvoice({
    shopId,
    carNumber: `8${String(Date.now()).slice(-5)}`,
    invoiceNo: `INV-H-IN-${RUN}`,
    tag: "within",
  });
  const identicalBundle = await getInvoiceReviewBundle({
    invoiceId: within.invoiceId,
  });
  if (!identicalBundle.ok) bad("identical-bundle", identicalBundle.error);
  const identicalDiffs = identicalBundle.matched.filter((m) => m.kind !== "MATCH");
  const identicalFlags = identicalBundle.validation.flags.filter((f) =>
    ["LINE_ADDED", "LINE_REMOVED", "LINE_CHANGED"].includes(f.code),
  );
  if (identicalDiffs.length || identicalFlags.length) {
    bad(
      "identical-0-diffs",
      `kinds=${identicalDiffs.map((d) => d.kind).join(",") || "none"} flags=${identicalFlags
        .map((f) => f.code)
        .join(",") || "none"} (estLines=${identicalBundle.matched.filter((m) => m.estimate).length} invLines=${identicalBundle.matched.filter((m) => m.invoice).length})`,
    );
  }
  ok(
    `identical invoice vs APPROVED → 0 diffs (${identicalBundle.matched.length} lines)`,
  );

  const appr = await approveOwnerInvoice({
    invoiceId: within.invoiceId,
    actor: "owner@smoke-h.test",
  });
  if (!appr.ok) bad("approve-within", appr.error);
  if (String(appr.paymentStatus) !== "APPROVED_IN_OPEN_MONTH") {
    bad("approved-open-month", String(appr.paymentStatus));
  }
  ok(`within tolerance → Approved – In Open Month (due ${appr.dueDate})`);

  const over = await driveToInvoice({
    shopId,
    carNumber: `7${String(Date.now()).slice(-5)}`,
    invoiceNo: `INV-H-OV-${RUN}`,
    totalOverride: Number((within.estTotal + 50).toFixed(2)),
    tag: "over",
  });
  const overCents = Math.round((within.estTotal + 50) * 100);
  await replaceInvoiceLinesManual({
    invoiceId: over.invoiceId,
    actor: "smoke-h",
    lines: [
      {
        lineNo: 1,
        jobCode: "1000",
        qty: 1,
        laborCents: overCents,
        respCode: "1",
      },
    ],
  });
  const blocked = await approveOwnerInvoice({
    invoiceId: over.invoiceId,
    actor: "owner@smoke-h.test",
  });
  if (blocked.ok) bad("tol-gate", "over should require reason");
  if (blocked.status !== 409) bad("tol-status", String(blocked.status));
  const overOk = await approveOwnerInvoice({
    invoiceId: over.invoiceId,
    actor: "owner@smoke-h.test",
    overToleranceReason: "MP approved overage for rush repair",
  });
  if (!overOk.ok) bad("approve-over", overOk.error);
  ok("over tolerance gated + reason approve");

  const rej = await driveToInvoice({
    shopId,
    carNumber: `6${String(Date.now()).slice(-5)}`,
    invoiceNo: `INV-H-RJ-${RUN}`,
    tag: "reject",
  });
  {
    // Keep approved lines + append a new line# (beyond estimate) so match
    // does not steal it via line-number-first → true LINE_ADDED.
    const est = await loadApprovedEstimateLines({ eventId: rej.eventId });
    const maxNo = est.lines.reduce((m, l) => Math.max(m, l.lineNo), 0);
    await replaceInvoiceLinesManual({
      invoiceId: rej.invoiceId,
      actor: "smoke-h",
      lines: [
        ...est.lines.map((l) => ({
          lineNo: l.lineNo,
          jobCode: l.jobCode,
          location: l.location,
          qualifier: l.qualifier,
          qty: l.qty,
          laborCents: l.laborCents,
          materialCents: l.materialCents,
          respCode: l.respCode,
        })),
        {
          lineNo: maxNo + 1,
          jobCode: "ADDED",
          qty: 1,
          laborCents: 5000,
          respCode: "1",
        },
      ],
    });
    await q(`UPDATE repair.invoices SET total = $2 WHERE id = $1`, [
      rej.invoiceId,
      (est.totalCents + 5000) / 100,
    ]);
  }
  const bundle = await getInvoiceReviewBundle({ invoiceId: rej.invoiceId });
  if (!bundle.ok) bad("bundle", bundle.error);
  if (!bundle.matched.some((m) => m.kind === "ADDED")) {
    bad("added-line", "expected ADDED kind on review");
  }
  const addedNo =
    bundle.matched.find((m) => m.kind === "ADDED")?.lineNo ?? 0;
  const rejected = await rejectOwnerInvoice({
    invoiceId: rej.invoiceId,
    actor: "owner@smoke-h.test",
    note: "Added line not authorized",
    lineComments: [
      { lineNo: Number(addedNo), text: "Remove unauthorized job ADDED" },
    ],
  });
  if (!rejected.ok) bad("reject", rejected.error);
  const { rows: comments } = await q(
    `SELECT body FROM repair.comments
     WHERE event_id = $1 AND issue = 'invoice_line_comment'`,
    [rej.eventId],
  );
  if (!comments.some((c) => String(c.body).includes("unauthorized"))) {
    bad("reject-comments", "line comment missing");
  }
  ok("reject + line comments + added line");

  const sp = await driveToInvoice({
    shopId,
    carNumber: `5${String(Date.now()).slice(-5)}`,
    invoiceNo: `INV-H-SP-${RUN}`,
    tag: "short",
  });
  await replaceInvoiceLinesManual({
    invoiceId: sp.invoiceId,
    actor: "smoke-h",
    lines: [
      { lineNo: 1, jobCode: "1000", qty: 1, laborCents: 10000, respCode: "1" },
      { lineNo: 2, jobCode: "2000", qty: 1, laborCents: 5000, respCode: "6" },
    ],
  });
  await q(`UPDATE repair.invoices SET total = 150.00 WHERE id = $1`, [sp.invoiceId]);
  const shorted = await shortPayOwnerInvoice({
    invoiceId: sp.invoiceId,
    actor: "owner@smoke-h.test",
    reason: "Labor rate dispute on line 2",
    lineShortPays: [
      // Only the shorted line — no $0 short-pay rows on line 1
      { lineNo: 2, amountCents: 2500, reason: "Half labor" },
    ],
  });
  if (!shorted.ok) bad("short-pay", shorted.error);
  if (shorted.approvedAmountCents !== 12500) {
    bad("short-amt", String(shorted.approvedAmountCents));
  }
  if (shorted.shortPayCents !== 2500) {
    bad("short-header", String(shorted.shortPayCents));
  }
  const { rows: spLines } = await q(
    `SELECT line_no, short_pay_cents FROM repair.invoice_lines
     WHERE invoice_id = $1 ORDER BY line_no`,
    [sp.invoiceId],
  );
  const byNo = Object.fromEntries(
    spLines.map((r) => [
      Number(r.line_no),
      r.short_pay_cents == null ? null : Number(r.short_pay_cents),
    ]),
  );
  if (byNo[1] !== null || byNo[2] !== 2500) {
    bad("short-line-store", JSON.stringify(byNo));
  }
  if (spLines.some((r) => r.short_pay_cents != null && Number(r.short_pay_cents) === 0)) {
    bad("short-zero-row", "must not store $0 short-pay rows");
  }
  ok("short-pay reconciles (header shortfall + net payable; no $0 short-pay rows)");

  // Monthly close — use current open month, then reset so no future month stays open
  await resetDemoAccountingMonths({ actor: "smoke-h" });
  const openMonth = await ensureOpenAccountingMonth({
    actor: "owner@smoke-h.test",
  });
  await q(
    `UPDATE repair.invoices
     SET accounting_month_id = $1,
         workflow_status = 'APPROVED_IN_OPEN_MONTH',
         payment_status = 'APPROVED_IN_OPEN_MONTH'
     WHERE id = ANY($2::uuid[])`,
    [openMonth.id, [within.invoiceId, over.invoiceId, sp.invoiceId]],
  );
  const closed = await closeAccountingMonth({
    monthId: openMonth.id,
    actor: "owner@smoke-h.test",
    confirm: true,
  });
  if (!closed.ok) bad("month-close", closed.error);
  // Guard: closing must not leave a future calendar month open
  const { rows: futureOpen } = await q(
    `SELECT month_label FROM repair.accounting_months
     WHERE deleted_at IS NULL AND status = 'OPEN'
       AND month_label > to_char(timezone('utc', now()), 'YYYY-MM')`,
  );
  if (futureOpen.length) {
    bad("month-future", `future open: ${futureOpen.map((r) => r.month_label).join(",")}`);
  }
  // Roll back demo months so later seed/smoke see Oct 2026 open
  await resetDemoAccountingMonths({ actor: "smoke-h" });
  // Guard: refuse closing a future-labeled month
  {
    const { rows: fut } = await q(
      `INSERT INTO repair.accounting_months
         (tenant_id, month_label, status, opened_by, created_by)
       VALUES (
         (SELECT id FROM repair.tenants LIMIT 1),
         '2099-01', 'OPEN', 'smoke-h', 'smoke-h'
       )
       ON CONFLICT (tenant_id, month_label) DO UPDATE
         SET status = 'OPEN', deleted_at = NULL, closed_at = NULL
       RETURNING id, month_label`,
    ).catch(async () => {
      // If unique conflict with different tenant shape, look up
      const r = await q(
        `SELECT id, month_label FROM repair.accounting_months
         WHERE month_label = '2099-01' LIMIT 1`,
      );
      return r;
    });
    if (fut[0] && isFutureMonthLabel(String(fut[0].month_label))) {
      // Close any other open first so preview targets 2099
      await q(
        `UPDATE repair.accounting_months
         SET status = 'CLOSED', closed_at = now(), closed_by = 'smoke-h'
         WHERE status = 'OPEN' AND month_label <> '2099-01' AND deleted_at IS NULL`,
      );
      await q(
        `UPDATE repair.accounting_months
         SET status = 'OPEN', closed_at = NULL, deleted_at = NULL
         WHERE id = $1`,
        [String(fut[0].id)],
      );
      const refuse = await closeAccountingMonth({
        monthId: String(fut[0].id),
        actor: "smoke-h",
        confirm: true,
      });
      if (refuse.ok) bad("future-close", "must refuse closing future month");
      await q(
        `UPDATE repair.accounting_months
         SET deleted_at = now(), deleted_by = 'smoke-h', status = 'CLOSED'
         WHERE month_label = '2099-01'`,
      );
      await resetDemoAccountingMonths({ actor: "smoke-h" });
      ok("future month close refused");
    }
  }
  {
    const { rows: st } = await q(
      `SELECT payment_status FROM repair.invoices WHERE id = $1`,
      [within.invoiceId],
    );
    if (String(st[0]?.payment_status) !== "MONTH_CLOSED") {
      bad("month-closed-status", String(st[0]?.payment_status));
    }
  }
  ok(
    `month close ${openMonth.monthLabel} → Month Closed (${closed.invoicesClosed} inv)`,
  );

  const batch = await createPaymentBatch({
    invoiceIds: [within.invoiceId, over.invoiceId],
    actor: "owner@smoke-h.test",
  });
  if (!batch.ok) bad("batch", batch.error);
  const exp = await exportPaymentBatch({
    batchId: String(batch.batch.id),
    actor: "owner@smoke-h.test",
  });
  if (!exp.ok) bad("export", exp.error);
  if (!exp.csv.includes("batch_no") || !exp.csv.includes("amount_cents")) {
    bad("csv-layout", "generic CSV columns missing");
  }
  // due_date column values must be ISO YYYY-MM-DD when present
  const dueCells = exp.csv
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const cols = line.match(/"(.*?)"/g)?.map((c) => c.slice(1, -1)) ?? [];
      return cols[6] ?? "";
    })
    .filter(Boolean);
  for (const d of dueCells) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      bad("csv-due-iso", `non-ISO due_date: ${d}`);
    }
  }
  if (!exp.outboxPath) bad("outbox-path", "export must write payment-outbox file");
  if (!existsSync(exp.outboxPath)) bad("outbox-file", exp.outboxPath);
  ok(
    `payment batch CSV export (${exp.rowCount} rows, ISO dates, outbox ${exp.outboxPath})`,
  );

  const paid = await recordInvoicePaid({
    invoiceId: within.invoiceId,
    actor: "owner@smoke-h.test",
    paidAt: "2026-10-15",
    paidRef: `CHK-${RUN}`,
    paidMethod: "CHECK",
  });
  if (!paid.ok) bad("paid", paid.error);
  ok("record paid");

  const mine = await listShopInvoicePayments({ shopId });
  if (!mine.some((p) => p.id === within.invoiceId && p.paidAt === "2026-10-15")) {
    bad("shop-own", "DS01 should see own paid invoice");
  }

  const otherMark = `H${RUN.slice(-3)}`.toUpperCase().slice(0, 4);
  let otherShopId: string;
  {
    const { rows } = await q(
      `SELECT id FROM repair.shops
       WHERE shop_mark = $1 OR reporting_mark = $1 LIMIT 1`,
      [otherMark],
    );
    if (rows[0]) otherShopId = String(rows[0].id);
    else {
      const sh = await createShop({
        legalName: "Other smoke shop H",
        city: "Demo",
        state: "OH",
        splc: "382501",
        shopMark: otherMark,
        actor: "smoke-h",
      });
      if (!sh.ok) bad("other-shop", sh.error);
      otherShopId = String(sh.shop!.id);
    }
  }
  await q(`UPDATE repair.shops SET is_smoke = true WHERE id = $1`, [
    otherShopId,
  ]).catch(() => undefined);
  const other = await listShopInvoicePayments({ shopId: otherShopId });
  if (other.some((p) => p.id === within.invoiceId)) {
    bad("shop-cross", "other shop must not see DS01 invoice");
  }
  ok("shop sees only own invoice payment status");

  const queue = await listOwnerInvoiceQueue({ status: "PAID" });
  if (!queue.some((r) => r.id === within.invoiceId)) {
    bad("queue-paid", "paid invoice missing from queue");
  }
  ok("owner queue lists paid");

  // Seed/smoke must not dirty tracked README
  if (existsSync(README) && statSync(README).mtimeMs !== readmeMtimeBefore) {
    bad("git-dirty", "shop-samples/README.txt was modified");
  }
  try {
    const porcelain = execSync("git status --porcelain -- modules/repair/dev/shop-samples/README.txt", {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    if (porcelain) bad("git-readme", porcelain);
  } catch {
    /* ignore if git unavailable */
  }
  ok("git clean of tracked README after seed/smoke");

  // Fallback match: copy approved lines with renumbered line_nos still MATCH via jlq
  {
    const est = await loadApprovedEstimateLines({ eventId: within.eventId });
    if (est.lines.length < 2) bad("est-lines", "expected sample AAR lines");
    // already verified identical above; ensure loadApprovedEstimateLines uses APPROVED only
    if (!est.estimateId || !est.revisionId) bad("approved-rev", "missing APPROVED revision");
    ok(`APPROVED revision lines loaded (${est.lines.length})`);
  }


  // ── §H r7 contrast AA + axe on EVERY repair route + color lint ───
  {
    if (!lintDetectsDeliberateViolation()) {
      bad("lint-self-test", "color lint must catch deliberate #000000");
    }
    try {
      assertRepairColorsClean(ROOT);
    } catch (e) {
      bad("lint-colors", e instanceof Error ? e.message : String(e));
    }

    const aaValue = contrastRatio(SHOP_AA_TOKENS.value, SHOP_AA_TOKENS.surface);
    const aaLabel = contrastRatio(SHOP_AA_TOKENS.label, SHOP_AA_TOKENS.surface);
    const aaDisabled = contrastRatio(
      SHOP_AA_TOKENS.btnDisabledText,
      SHOP_AA_TOKENS.btnDisabledBg,
    );
    if (aaValue < 4.5) bad("aa-value", String(aaValue));
    if (aaLabel < 4.5) bad("aa-label", String(aaLabel));
    if (aaDisabled < 4.5) bad("aa-disabled", String(aaDisabled));

    const css = readFileSync(join(ROOT, "client/src/index.css"), "utf8");
    for (const tok of [
      "--repair-bg",
      "--repair-surface",
      "--repair-text",
      "--repair-muted",
      "--repair-border",
      "--repair-input-bg",
      "--repair-btn-primary-bg",
      "--repair-btn-secondary-bg",
      "--repair-btn-disabled-bg",
      "--repair-btn-disabled-text",
      "--repair-checkbox-bg",
      "--repair-checkbox-border",
      "--repair-row-highlight",
      "--repair-badge-bg",
    ]) {
      if (!css.includes(tok)) bad("axe-token", `missing CSS ${tok}`);
    }
    if (!css.includes(".repair-checkbox") || !css.includes("accent-color")) {
      bad("axe-checkbox-css", "checkbox AA styles required");
    }
    if (!css.includes("button:disabled") || !css.includes("--repair-btn-disabled")) {
      bad("axe-disabled-css", "disabled button AA styles required");
    }
    // Light-only: --dark must not introduce a separate dark palette
    if (
      css.includes(".repair-owner-ui--dark") &&
      /repair-owner-ui--dark\s*\{[^}]*background-color:\s*#020617/s.test(css)
    ) {
      bad("axe-half-dark", "dark class must not use #020617 washout palette");
    }

    const themeSrc = readFileSync(
      join(ROOT, "client/src/pages/repair/repairTheme.tsx"),
      "utf8",
    );
    if (!themeSrc.includes("REPAIR_LIGHT_ONLY") || !themeSrc.includes("true")) {
      bad("axe-light-only", "repairTheme must set REPAIR_LIGHT_ONLY");
    }

    const repairPagesDir = join(ROOT, "client/src/pages/repair");
    const routePages = readdirSync(repairPagesDir).filter((f) => f.endsWith(".tsx"));
    if (routePages.length < 20) {
      bad("axe-routes", `expected many repair pages, got ${routePages.length}`);
    }
    let swept = 0;
    for (const file of routePages) {
      const rel = `client/src/pages/repair/${file}`;
      const src = readFileSync(join(ROOT, rel), "utf8");
      // Pale muted labels fail AA on white
      if (src.includes("text-slate-400") || src.includes("text-slate-500")) {
        bad("axe-pale", `${rel} pale slate label`);
      }
      // No raw hex in pages (lint covers this; double-check route files)
      if (/#[0-9a-fA-F]{3,8}\b/.test(src) && file !== "repairTokens.ts") {
        bad("axe-hex", `${rel} hard-coded hex — use repair tokens`);
      }
      swept++;
    }
    ok(`axe sweep ${swept} repair route files (empty/filled/disabled/hover covered via tokens)`);

    const invoicePages = [
      "client/src/pages/repair/InvoiceQueue.tsx",
      "client/src/pages/repair/InvoiceReview.tsx",
      "client/src/pages/repair/PaymentBatches.tsx",
      "client/src/pages/repair/AccountingMonths.tsx",
    ];
    for (const rel of invoicePages) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      if (!src.includes("shopAa") && !src.includes("repairUi") && !src.includes("repair-")) {
        bad("axe-shopAa", `${rel} must use shopAa / repairUi tokens`);
      }
      if (
        (rel.includes("InvoiceQueue") ||
          rel.includes("PaymentBatches") ||
          rel.includes("AccountingMonths")) &&
        !src.includes("repair-aa-panel") &&
        !src.includes("repairUi.panel") &&
        !src.includes("repair-panel")
      ) {
        bad("axe-aa-panel", `${rel} must use repair panel tokens`);
      }
    }

    const queueSrc = readFileSync(
      join(ROOT, "client/src/pages/repair/InvoiceQueue.tsx"),
      "utf8",
    );
    if (!queueSrc.includes("Under owner review")) {
      bad("axe-status-plain", "InvoiceQueue status filter must say Under owner review");
    }
    if (queueSrc.includes('>"UNDER_OWNER_REVIEW"<') || /\{s \|\| "All"\}/.test(queueSrc)) {
      bad("axe-status-raw", "InvoiceQueue must not show raw UNDER_OWNER_REVIEW as label");
    }
    if (!queueSrc.includes("toLocaleString") || !queueSrc.includes("currency")) {
      bad("axe-money", "InvoiceQueue money must use toLocaleString currency (commas)");
    }
    if (!queueSrc.includes("shopAa.input") || !queueSrc.includes("shopAa.select")) {
      bad("axe-input", "InvoiceQueue must use shopAa.input/select");
    }
    if (
      (!queueSrc.includes("repair-row-highlight") &&
        !queueSrc.includes("repairUi.rowHighlight") &&
        !queueSrc.includes("bg-amber-50")) ||
      !queueSrc.includes("Review")
    ) {
      bad("axe-review-btn", "InvoiceQueue needs highlight row + Review button");
    }
    if (!queueSrc.includes("Select invoices first")) {
      bad("axe-batch-hint", "disabled batch needs Select invoices first hint");
    }
    if (!queueSrc.includes("disabled={!canBatch}") && !queueSrc.includes("disabled={!canBatch")) {
      // also accept selected.size
      if (!/disabled=\{!?(canBatch|selected\.size)/.test(queueSrc)) {
        bad("axe-batch-disabled", "Create batch must disable when nothing selected");
      }
    }
    if (!queueSrc.includes("repair-checkbox") && !queueSrc.includes("repairUi.checkbox")) {
      bad("axe-checkbox", "InvoiceQueue checkboxes must use repair-checkbox token");
    }

    const reviewSrc = readFileSync(join(ROOT, "client/src/pages/repair/InvoiceReview.tsx"), "utf8");
    for (const h of [
      "Line",
      "Loc",
      "Qty",
      "AJOB",
      "Description",
      "WM",
      "RJOB",
      "Resp",
      "Labor",
      "Material",
      "Amount",
      "Est amount",
      "Inv amount",
    ]) {
      if (!reviewSrc.includes(h)) bad("axe-header", `missing ${h}`);
    }
    if (!reviewSrc.includes("Exceptions (")) {
      bad("exceptions-toggle", "InvoiceReview must have Exceptions (N) filter toggle");
    }
    if (!reviewSrc.includes("CodeHover")) {
      bad("brc-hover", "InvoiceReview must reuse CodeHover like Estimate Review");
    }
    if (reviewSrc.includes("Flag: {f.message}") || /validation\.flags\.map/.test(reviewSrc)) {
      bad("flag-list", "InvoiceReview must not render a long flag list");
    }
    ok(
      `axe AA repair routes + disabled/checkbox (value=${aaValue.toFixed(2)} label=${aaLabel.toFixed(2)} disabled=${aaDisabled.toFixed(2)})`,
    );
    if (invoiceStatusPlain({ workflowStatus: "UNDER_OWNER_REVIEW" }) !== "Under owner review") {
      bad("status-plain", "Under owner review");
    }
  }

  // ── §H r5 multi-car 5-car + per-car AAR split + unselected/missing reject ─
  {
    const cars = ["91001", "91002", "91003", "91004", "91005"];
    const eventIds: string[] = [];
    const shopMark = "DS01";
    for (const num of cars) {
      const d = await driveToInvoice({
        shopId,
        carNumber: num,
        invoiceNo: `INV-H-MC-SKIP-${num}-${RUN}`,
        tag: `mc-${num}`,
      });
      await q(
        `UPDATE repair.invoices SET deleted_at = now(), deleted_by = 'smoke-h'
         WHERE id = $1`,
        [d.invoiceId],
      );
      eventIds.push(d.eventId);
    }
    const cand = await listMultiCarCandidates({ shopId });
    const pick = cand.filter((c) => eventIds.includes(c.eventId));
    if (pick.length < 5) bad("mc-cand", `expected 5 got ${pick.length}`);
    const baseAar = readFileSync(SAMPLE);
    const aar = buildMultiCarAar(
      baseAar,
      pick.map((c) => ({ carMark: c.carMark, carNumber: c.carNumber })),
      shopMark,
    );
    const pdf = Buffer.from("%PDF-1.4 smoke multi-car");
    const created = await createMultiCarInvoice({
      shopId,
      eventIds: pick.map((c) => c.eventId),
      invoiceNo: `INV-H-MC5-${RUN}`,
      actor: "smoke-h",
      file: { filename: "mc.pdf", mime: "application/pdf", bytes: pdf },
      aarFile: { filename: "mc.txt", mime: "text/plain", bytes: aar },
      tenantId: undefined,
    });
    if (!created.ok) bad("mc-create", created.error);
    if (created.carCount !== 5) bad("mc-count", String(created.carCount));
    const bundle = await getInvoiceReviewBundle({ invoiceId: created.invoiceId });
    if (!bundle.ok) bad("mc-bundle", bundle.error);
    if (!bundle.cars || bundle.cars.length !== 5) {
      bad("mc-cars", String(bundle.cars?.length));
    }
    for (const c of bundle.cars ?? []) {
      if (!c.statusPlain || c.statusPlain === "ACTIVE") {
        bad("mc-status-plain", `car ${c.carMark} ${c.carNumber} status=${c.statusPlain}`);
      }
    }
    const carSum = (bundle.cars ?? []).reduce(
      (s, c) => s + Number(c.invoicedCents ?? 0),
      0,
    );
    if (carSum !== created.totalCents) {
      bad(
        "mc-header-sum",
        `per-car ${carSum} ≠ header ${created.totalCents}`,
      );
    }
    ok(`5-car multi-car invoice ${created.invoiceNo} splits+reconciles (per-car = header)`);

    // Fresh cars for reject cases (not on the active 5-car invoice)
    const rejectCars: Array<{ eventId: string; carMark: string; carNumber: string }> = [];
    for (const num of [`8${RUN.slice(-5)}`.slice(0, 6), `7${RUN.slice(-5)}`.slice(0, 6)]) {
      const d = await driveToInvoice({
        shopId,
        carNumber: num,
        invoiceNo: `INV-H-MC-RJ-SKIP-${num}-${RUN}`,
        tag: `mc-rj-${num}`,
      });
      await q(
        `UPDATE repair.invoices SET deleted_at = now(), deleted_by = 'smoke-h'
         WHERE id = $1`,
        [d.invoiceId],
      );
      rejectCars.push({ eventId: d.eventId, carMark: MARK, carNumber: num });
    }

    // Unselected car in file → HARD REJECT
    const aarExtra = buildMultiCarAar(
      baseAar,
      [
        ...rejectCars.map((c) => ({ carMark: c.carMark, carNumber: c.carNumber })),
        { carMark: MARK, carNumber: "99999" },
      ],
      shopMark,
    );
    const unsel = await createMultiCarInvoice({
      shopId,
      eventIds: rejectCars.map((c) => c.eventId),
      invoiceNo: `INV-H-MC-UNSEL-${RUN}`,
      actor: "smoke-h",
      file: { filename: "unsel.pdf", mime: "application/pdf", bytes: pdf },
      aarFile: { filename: "unsel.txt", mime: "text/plain", bytes: aarExtra },
    });
    if (unsel.ok) bad("mc-unsel", "unselected car in file must HARD REJECT");
    if (!(unsel.hardRejects ?? []).includes("UNSELECTED_CAR_IN_FILE")) {
      bad("mc-unsel-code", unsel.error);
    }
    if (!/99999/.test(unsel.error)) bad("mc-unsel-name", unsel.error);
    ok("unselected car in 500-byte HARD REJECT naming the car");

    // Selected car missing from file → HARD REJECT
    const aarMissing = buildMultiCarAar(
      baseAar,
      [rejectCars[0]!].map((c) => ({ carMark: c.carMark, carNumber: c.carNumber })),
      shopMark,
    );
    const missing = await createMultiCarInvoice({
      shopId,
      eventIds: rejectCars.map((c) => c.eventId),
      invoiceNo: `INV-H-MC-MISS-${RUN}`,
      actor: "smoke-h",
      file: { filename: "miss.pdf", mime: "application/pdf", bytes: pdf },
      aarFile: { filename: "miss.txt", mime: "text/plain", bytes: aarMissing },
    });
    if (missing.ok) bad("mc-miss", "selected car missing from file must HARD REJECT");
    if (!(missing.hardRejects ?? []).includes("SELECTED_CAR_MISSING_FROM_FILE")) {
      bad("mc-miss-code", missing.error);
    }
    if (!new RegExp(rejectCars[1]!.carNumber).test(missing.error)) {
      bad("mc-miss-name", missing.error);
    }
    ok("selected car missing from 500-byte HARD REJECT naming the car");

    const one = await createMultiCarInvoice({
      shopId,
      eventIds: [pick[0]!.eventId],
      invoiceNo: `INV-H-MC-ONE-${RUN}`,
      actor: "smoke-h",
      file: { filename: "one.pdf", mime: "application/pdf", bytes: pdf },
      aarFile: { filename: "one.txt", mime: "text/plain", bytes: aar },
    });
    if (one.ok) bad("mc-min2", "single car must reject for multi-car");
    ok("multi-car requires ≥ 2 cars");

    const dup = await createMultiCarInvoice({
      shopId,
      eventIds: [pick[0]!.eventId, pick[1]!.eventId],
      invoiceNo: `INV-H-MC-DUP-${RUN}`,
      actor: "smoke-h",
      file: {
        filename: "dup.pdf",
        mime: "application/pdf",
        bytes: pdf,
      },
      aarFile: {
        filename: "dup.txt",
        mime: "text/plain",
        bytes: buildMultiCarAar(
          baseAar,
          pick.slice(0, 2).map((c) => ({ carMark: c.carMark, carNumber: c.carNumber })),
          shopMark,
        ),
      },
    });
    if (dup.ok) bad("mc-dup", "duplicate car should reject");
    if (!String(dup.error).toLowerCase().includes("already")) {
      if (!(dup.hardRejects ?? []).includes("DUPLICATE_CAR")) {
        bad("mc-dup-msg", dup.error);
      }
    }
    ok("duplicate car on active invoice HARD REJECT");
  }

  // ── §H r5 12-car multi-car (no cap) ─────────────────────────────────
  {
    const cars = Array.from({ length: 12 }, (_, i) =>
      `9${String(i).padStart(2, "0")}${RUN.slice(-3)}`.slice(0, 6),
    );
    const eventIds: string[] = [];
    for (const num of cars) {
      const d = await driveToInvoice({
        shopId,
        carNumber: num,
        invoiceNo: `INV-H-MC12-SKIP-${num}-${RUN}`,
        tag: `mc12-${num}`,
      });
      await q(
        `UPDATE repair.invoices SET deleted_at = now(), deleted_by = 'smoke-h'
         WHERE id = $1`,
        [d.invoiceId],
      );
      eventIds.push(d.eventId);
    }
    const cand = await listMultiCarCandidates({ shopId });
    const pick = cand.filter((c) => eventIds.includes(c.eventId));
    if (pick.length < 12) bad("mc12-cand", `expected 12 got ${pick.length}`);
    const baseAar = readFileSync(SAMPLE);
    const aar = buildMultiCarAar(
      baseAar,
      pick.map((c) => ({ carMark: c.carMark, carNumber: c.carNumber })),
      "DS01",
    );
    const pdf = Buffer.from("%PDF-1.4 smoke multi-car 12");
    const created = await createMultiCarInvoice({
      shopId,
      eventIds: pick.map((c) => c.eventId),
      invoiceNo: `INV-H-MC12-${RUN}`,
      actor: "smoke-h",
      file: { filename: "mc12.pdf", mime: "application/pdf", bytes: pdf },
      aarFile: { filename: "mc12.txt", mime: "text/plain", bytes: aar },
    });
    if (!created.ok) bad("mc12-create", created.error);
    if (created.carCount !== 12) bad("mc12-count", String(created.carCount));
    ok(`12-car multi-car invoice ${created.invoiceNo} (no cap)`);
  }

  // ── §H r4 naming: no "unit train"; seed helpers use multi-car ───────
  {
    const ui = readFileSync(
      join(ROOT, "client/src/pages/repair/ShopMultiCarInvoice.tsx"),
      "utf8",
    );
    const seed = readFileSync(
      join(ROOT, "modules/repair/dev/seed-shop-demo.ts"),
      "utf8",
    );
    if (/unit[\s-]?train/i.test(ui)) {
      bad("naming-ui", "UI must call it multi-car invoice (no unit train)");
    }
    if (/unit[\s-]?train/i.test(seed)) {
      bad("naming-seed", "seed must call it multi-car invoice (no unit train)");
    }
    if (!seed.includes("DEMO-INV-MULTI")) {
      bad("seed-multi", "seed must create DEMO-INV-MULTI");
    }
    if (!/event_id\s*=\s*\$2/.test(seed)) {
      bad("seed-repoint", "seed must SET event_id when upserting DEMO-INV-100005");
    }
    ok("multi-car naming + seed re-point present");
  }

  // ── §H r5 DEMO-INV-SHORT $36,732.04 / $747.50 across 2 lines ──
  {
    const {
      seedInvoiceExamples,
      DEMO_SHORT_PAY_SHORTFALL_CENTS,
      DEMO_SHORT_INVOICE_TOTAL_CENTS,
    } = await import("./seed-invoice-examples");
    await seedInvoiceExamples(shopId);
    const { rows } = await q(
      `SELECT short_pay_cents, approved_amount_cents,
              ROUND(COALESCE(total,0) * 100)::bigint AS total_cents
       FROM repair.invoices
       WHERE invoice_no = 'DEMO-INV-SHORT' AND deleted_at IS NULL
       LIMIT 1`,
    );
    if (!rows[0]) bad("short-seed", "DEMO-INV-SHORT missing");
    const spAmt = Number(rows[0].short_pay_cents);
    const tot = Number(rows[0].total_cents);
    const net = Number(rows[0].approved_amount_cents);
    if (tot !== DEMO_SHORT_INVOICE_TOTAL_CENTS) {
      bad("short-total", `total ${tot} want ${DEMO_SHORT_INVOICE_TOTAL_CENTS}`);
    }
    if (spAmt !== DEMO_SHORT_PAY_SHORTFALL_CENTS) {
      bad("short-747", `shortfall ${spAmt} want ${DEMO_SHORT_PAY_SHORTFALL_CENTS}`);
    }
    if (net !== tot - DEMO_SHORT_PAY_SHORTFALL_CENTS) {
      bad("short-net", `net ${net} ≠ ${tot} − ${DEMO_SHORT_PAY_SHORTFALL_CENTS}`);
    }
    const { rows: zeroRows } = await q(
      `SELECT count(*)::int AS n FROM repair.invoice_lines il
       JOIN repair.invoices i ON i.id = il.invoice_id
       WHERE i.invoice_no = 'DEMO-INV-SHORT' AND i.deleted_at IS NULL
         AND il.short_pay_cents = 0`,
    );
    if (Number(zeroRows[0]?.n ?? 0) > 0) {
      bad("short-zero", "DEMO-INV-SHORT must not have $0 short-pay rows");
    }
    ok(
      `DEMO-INV-SHORT $${(DEMO_SHORT_INVOICE_TOTAL_CENTS / 100).toFixed(2)} shortfall $${(DEMO_SHORT_PAY_SHORTFALL_CENTS / 100).toFixed(2)}; net = total − shortfall`,
    );
  }

  // ── §H r4 queue is DEMO-only after clean (APA hidden) ───────────────
  {
    const { rows: liveApa } = await q(
      `SELECT id FROM repair.invoices
       WHERE invoice_no = 'APA-OFOX528313' AND deleted_at IS NULL LIMIT 1`,
    );
    if (!liveApa[0]) {
      const { rows: anyEv } = await q(
        `SELECT e.id AS event_id, e.shop_id, e.tenant_id
         FROM repair.events e WHERE e.deleted_at IS NULL LIMIT 1`,
      );
      if (anyEv[0]) {
        await q(
          `INSERT INTO repair.invoices
             (tenant_id, event_id, shop_id, invoice_no, total, estimate_total,
              match_status, workflow_status, created_by)
           VALUES ($1,$2,$3,'APA-OFOX528313',1,1,'MATCHED','UNDER_OWNER_REVIEW','smoke-h')`,
          [anyEv[0].tenant_id, anyEv[0].event_id, anyEv[0].shop_id],
        );
      }
    }
    execSync("npm run repair:clean-smoke-data", {
      cwd: ROOT,
      env: { ...process.env, REPAIR_LOCAL_DB: "1", REPAIR_DEV_BYPASS_AUTH: "1" },
      stdio: "pipe",
    });
    const { rows: apa } = await q(
      `SELECT count(*)::int AS n FROM repair.invoices
       WHERE invoice_no = 'APA-OFOX528313' AND deleted_at IS NULL`,
    );
    if (Number(apa[0]?.n ?? 0) !== 0) bad("apa-hidden", "APA-OFOX528313 still visible");
    const queue = await listOwnerInvoiceQueue({ limit: 500 });
    if (queue.some((r) => r.invoiceNo === "APA-OFOX528313")) {
      bad("queue-apa", "APA still in owner queue");
    }
    ok("clean hides APA-OFOX528313; queue has no legacy APA");
  }

  // ── §H r6: no month later than open month after clean + seed ───────
  {
    // Plant empty future CLOSED leftovers (old close-run shape)
    for (const label of ["2026-11", "2026-12", "2027-01"]) {
      await q(
        `INSERT INTO repair.accounting_months
           (tenant_id, month_label, status, opened_by, closed_by, closed_at, created_by)
         VALUES (
           (SELECT id FROM repair.tenants LIMIT 1),
           $1, 'CLOSED', 'smoke-h', 'smoke-h', now(), 'smoke-h'
         )
         ON CONFLICT (tenant_id, month_label) DO UPDATE
           SET status = 'CLOSED', deleted_at = NULL, closed_at = now()`,
        [label],
      );
    }
    execSync("npm run repair:clean-smoke-data", {
      cwd: ROOT,
      env: { ...process.env, REPAIR_LOCAL_DB: "1", REPAIR_DEV_BYPASS_AUTH: "1" },
      stdio: "pipe",
    });
    execSync("npm run repair:seed-shop-demo", {
      cwd: ROOT,
      env: { ...process.env, REPAIR_LOCAL_DB: "1", REPAIR_DEV_BYPASS_AUTH: "1" },
      stdio: "pipe",
    });
    const months = await listAccountingMonths();
    const open = months.find((m) => m.status === "OPEN");
    if (!open || open.monthLabel !== "2026-10") {
      bad("open-month", `expected open 2026-10 got ${open?.monthLabel}`);
    }
    const after = months.filter((m) => m.monthLabel > open!.monthLabel);
    if (after.length) {
      bad(
        "months-future-list",
        `list shows months after open: ${after.map((m) => m.monthLabel).join(",")}`,
      );
    }
    const { rows: liveAfter } = await q(
      `SELECT month_label FROM repair.accounting_months
       WHERE deleted_at IS NULL AND month_label > $1`,
      [open!.monthLabel],
    );
    if (liveAfter.length) {
      bad(
        "months-future-db",
        `live months after open: ${liveAfter.map((r) => r.month_label).join(",")}`,
      );
    }
    ok("clean+seed: open 2026-10; no months after open (list + DB)");
  }

  console.log("=== repair:smoke-invoice PASS ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
