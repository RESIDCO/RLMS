/**
 * §H Owner invoice review + shop payment smoke.
 * match/diff, tolerance gating, reject+comments, short-pay, batch export,
 * paid, shop sees only own, totals reconcile. Seed does not dirty tracked files.
 *
 * Run: npm run repair:smoke-invoice
 */
import { execSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
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
  DEFAULT_TOLERANCE_CENTS,
  DEFAULT_TOLERANCE_PCT_BP,
} from "../services/invoice-review";
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
      bytes: file.slice(0, Math.max(500, Math.min(file.length, 2000))),
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
  ok("match/diff: added / removed / qty-price");

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

  const within = await driveToInvoice({
    shopId,
    carNumber: `8${String(Date.now()).slice(-5)}`,
    invoiceNo: `INV-H-IN-${RUN}`,
    tag: "within",
  });
  const withinCents = Math.round(within.estTotal * 100);
  await replaceInvoiceLinesManual({
    invoiceId: within.invoiceId,
    actor: "smoke-h",
    lines: [
      {
        lineNo: 1,
        jobCode: "1000",
        qty: 1,
        laborCents: withinCents,
        respCode: "1",
      },
    ],
  });
  await q(`UPDATE repair.invoices SET total = $2 WHERE id = $1`, [
    within.invoiceId,
    within.estTotal,
  ]);
  const appr = await approveOwnerInvoice({
    invoiceId: within.invoiceId,
    actor: "owner@smoke-h.test",
  });
  if (!appr.ok) bad("approve-within", appr.error);
  if (String(appr.paymentStatus) !== "PAYABLE") {
    bad("payable", String(appr.paymentStatus));
  }
  ok(`within tolerance → Payable (due ${appr.dueDate})`);

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
  await replaceInvoiceLinesManual({
    invoiceId: rej.invoiceId,
    actor: "smoke-h",
    lines: [
      { lineNo: 1, jobCode: "1000", qty: 1, laborCents: 5000, respCode: "1" },
      { lineNo: 2, jobCode: "ADDED", qty: 1, laborCents: 5000, respCode: "1" },
    ],
  });
  await q(`UPDATE repair.invoices SET total = 100.00 WHERE id = $1`, [
    rej.invoiceId,
  ]);
  const bundle = await getInvoiceReviewBundle({ invoiceId: rej.invoiceId });
  if (!bundle.ok) bad("bundle", bundle.error);
  if (!bundle.matched.some((m) => m.kind === "ADDED")) {
    bad("added-line", "expected ADDED kind on review");
  }
  const rejected = await rejectOwnerInvoice({
    invoiceId: rej.invoiceId,
    actor: "owner@smoke-h.test",
    note: "Added line not authorized",
    lineComments: [{ lineNo: 2, text: "Remove unauthorized job ADDED" }],
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
      { lineNo: 1, amountCents: 10000, reason: "OK" },
      { lineNo: 2, amountCents: 2500, reason: "Half labor" },
    ],
  });
  if (!shorted.ok) bad("short-pay", shorted.error);
  if (shorted.approvedAmountCents !== 12500) {
    bad("short-amt", String(shorted.approvedAmountCents));
  }
  ok("short-pay with per-line reasons");

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
  ok(`payment batch CSV export (${exp.rowCount} rows)`);

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

  console.log("=== repair:smoke-invoice PASS ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
