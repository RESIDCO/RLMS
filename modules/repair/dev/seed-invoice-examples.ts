/**
 * §H r2 — Idempotent DS01 invoice review examples (DEMO-INV-* only).
 * Within (ready to approve), over (awaiting reason), added line, short-pay, paid.
 * Safe to re-run; never creates INV-H-* / smoke numbers.
 *
 * Run: npm run repair:seed-invoice-examples
 * Also invoked from repair:seed-shop-demo.
 */
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { q } from "../db";
import { createShop } from "../services/shops";
import { createBadOrder } from "../services/bo";
import { shopAcknowledge, shopArrivalDate } from "../services/bo-lifecycle";
import { ensureShopBoLink } from "../services/shop-workflow";
import { shopSubmitEstimate } from "../services/shop-portal";
import { approveEstimate } from "../services/estimates";
import { updateBoLifecycleDates } from "../services/shop-clarity";
import { submitShopInvoice } from "../services/invoices";
import { parseAarFile } from "../services/aar-parser";
import {
  loadApprovedEstimateLines,
  replaceInvoiceLinesManual,
  approveOwnerInvoice,
  shortPayOwnerInvoice,
  recordInvoicePaid,
  getInvoiceReviewBundle,
} from "../services/invoice-review";
import { migrateLocal } from "./migrate-local";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(__dirname, "reference/Sample_Shop_500byte_OFOX2609.txt");
const DEMO_SHOP_MARK = "DS01";
const MARK = "DEMO";

function ok(m: string) {
  console.log(`  OK  ${m}`);
}
function fail(m: string): never {
  throw new Error(m);
}

async function seedCar(mark: string, number: string) {
  await q(
    `INSERT INTO public.railcars (id, car_number, car_initial, reporting_marks, active, entity, lessee_name)
     SELECT GREATEST((SELECT COALESCE(MAX(id),0) FROM public.railcars), 71000) + 1,
            $1, $2, $2, true, 'Main', 'HIDDEN'
     WHERE NOT EXISTS (
       SELECT 1 FROM public.railcars WHERE car_initial = $2 AND car_number = $1
     )`,
    [number, mark],
  );
  await q(
    `INSERT INTO public.v_valid_export_rows_data
       (export_src, export_id, car_initial, car_number, active, rider, assignment, assignment_id, lessee, start_date, end_date)
     SELECT 1, 71001, $2, $1, 1, 'R1', 'DEMO-H', 'AH1', 'HIDDEN', '2026-01-01', NULL
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
     WHERE deleted_at IS NULL AND (shop_mark = $1 OR reporting_mark = $1)
     LIMIT 1`,
    [DEMO_SHOP_MARK],
  );
  if (rows[0]) return String(rows[0].id);
  const ds = await createShop({
    legalName: "Demo Shop DS01",
    city: "Toledo",
    state: "OH",
    splc: "382000",
    shopMark: DEMO_SHOP_MARK,
    actor: "seed-invoice-examples",
  });
  if (!ds.ok) fail(ds.error);
  return String(ds.shop!.id);
}

/** Target shortfall for DEMO-INV-SHORT (§H r3/r4 header short-pay). */
export const DEMO_SHORT_PAY_SHORTFALL_CENTS = 74750; // $747.50

async function findDemoInvoice(invoiceNo: string) {
  const { rows } = await q(
    `SELECT id, event_id, shop_id, workflow_status, payment_status, total,
            short_pay_cents, approved_amount_cents
     FROM repair.invoices
     WHERE invoice_no = $1 AND deleted_at IS NULL
     ORDER BY created_at ASC
     LIMIT 1`,
    [invoiceNo],
  );
  return rows[0] ?? null;
}

async function driveToSubmitted(opts: {
  shopId: string;
  carNumber: string;
  invoiceNo: string;
  totalOverride?: number;
}) {
  const existing = await findDemoInvoice(opts.invoiceNo);
  if (existing) {
    // Re-point to current shop (same root cause as DEMO-INV-100005)
    await q(
      `UPDATE repair.invoices
       SET shop_id = $2
       WHERE id = $1 AND (shop_id IS DISTINCT FROM $2)`,
      [String(existing.id), opts.shopId],
    );
    if (existing.event_id) {
      await q(
        `UPDATE repair.events
         SET shop_id = $2
         WHERE id = $1 AND deleted_at IS NULL AND (shop_id IS DISTINCT FROM $2)`,
        [String(existing.event_id), opts.shopId],
      ).catch(() => undefined);
    }
    return {
      invoiceId: String(existing.id),
      eventId: String(existing.event_id),
      reused: true as const,
    };
  }

  await seedCar(MARK, opts.carNumber);
  const bo = await createBadOrder({
    carMark: MARK,
    carNumber: opts.carNumber,
    shopId: opts.shopId,
    shoppingReason: `§H seed ${opts.invoiceNo}`,
    actor: "seed-invoice-examples",
    boRuleCode: "OTHER",
    boRuleOtherText: opts.invoiceNo,
    boDate: "2026-09-01",
    boCity: "Toledo",
    boState: "OH",
    allowDuplicates: true,
  });
  if (!bo.ok) fail(JSON.stringify(bo));
  const eventId = String(bo.event.id);

  const ensured = await ensureShopBoLink({
    eventId,
    shopMark: DEMO_SHOP_MARK,
    actor: "seed-invoice-examples",
  });
  if (!ensured.ok || !ensured.token) fail("shop link");
  const token = ensured.token;
  const ack = await shopAcknowledge(token, "shop@demo.test");
  if (!ack.ok) fail(ack.error);
  const hand = await shopArrivalDate(
    token,
    "shop@demo.test",
    "2026-09-01T12:00:00.000Z",
  );
  if (!hand.ok) fail(hand.error);

  const base = existsSync(SAMPLE) ? readFileSync(SAMPLE) : Buffer.alloc(500, 0x20);
  let file = withShopMark(withCar(base, MARK, opts.carNumber), DEMO_SHOP_MARK);
  if (file.length < 500) {
    file = Buffer.concat([file, Buffer.alloc(500 - file.length, 0x20)]);
  }

  const sub = await shopSubmitEstimate({
    role: "shop",
    shopMark: DEMO_SHOP_MARK,
    actor: "shop@demo.test",
    eventId,
    bytes: file,
    filename: `${opts.invoiceNo}.dat`,
    forceAcceptFlags: true,
  });
  if (!sub.ok) fail(JSON.stringify(sub).slice(0, 300));
  const estimateId = String(sub.estimateId);

  await q(
    `UPDATE repair.events
     SET yard_arrived_at = coalesce(yard_arrived_at, $2::timestamptz)
     WHERE id = $1`,
    [eventId, "2026-09-01T12:00:00.000Z"],
  );
  const ap = await approveEstimate({ estimateId, actor: "owner@demo" });
  if (!ap.ok) {
    const { rows: st } = await q(
      `SELECT s.code FROM repair.estimates e
       JOIN repair.statuses s ON s.id = e.status_id WHERE e.id = $1`,
      [estimateId],
    );
    if (String(st[0]?.code) !== "APPROVED") fail(ap.error || String(st[0]?.code));
  }

  await updateBoLifecycleDates({
    eventId,
    actor: "shop@demo.test",
    actorRole: "shop",
    completed: "2026-09-10",
  });
  await q(
    `UPDATE repair.estimate_validation_findings f
     SET cleared_at = now(), cleared_by = 'owner@demo'
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
    actorEmail: "shop@demo.test",
    file: {
      filename: `${opts.invoiceNo}.pdf`,
      mime: "application/pdf",
      bytes: Buffer.from(`%PDF-1.4 ${opts.invoiceNo}`),
    },
    aarFile: {
      filename: `${opts.invoiceNo}.dat`,
      mime: "text/plain",
      bytes: file, // full AAR — identical to estimate for 0-diff WITHIN case
    },
  });
  if (!inv.ok) fail(inv.error);
  return {
    invoiceId: String(inv.invoice.id),
    eventId,
    estimateId,
    estTotal,
    reused: false as const,
  };
}

export async function seedInvoiceExamples(shopId?: string) {
  const sid = shopId ?? (await ensureDs01());

  // 1) Within tolerance — unpaid, ready to approve (identical lines → 0 diffs)
  {
    const d = await driveToSubmitted({
      shopId: sid,
      carNumber: "100010",
      invoiceNo: "DEMO-INV-WITHIN",
    });
    const bundle = await getInvoiceReviewBundle({ invoiceId: d.invoiceId });
    if (!bundle.ok) fail(bundle.error);
    const diffs = bundle.matched.filter((m) => m.kind !== "MATCH");
    if (diffs.length) {
      // Re-sync from approved estimate if prior seed left bad lines
      const est = await loadApprovedEstimateLines({ eventId: bundle.eventId });
      await replaceInvoiceLinesManual({
        invoiceId: d.invoiceId,
        actor: "seed-invoice-examples",
        lines: est.lines.map((l) => ({
          lineNo: l.lineNo,
          jobCode: l.jobCode,
          location: l.location,
          qualifier: l.qualifier,
          qty: l.qty,
          laborCents: l.laborCents,
          materialCents: l.materialCents,
          respCode: l.respCode,
        })),
      });
      await q(`UPDATE repair.invoices SET total = $2, estimate_total = $2 WHERE id = $1`, [
        d.invoiceId,
        est.totalCents / 100,
      ]);
    }
    const again = await getInvoiceReviewBundle({ invoiceId: d.invoiceId });
    if (!again.ok) fail(again.error);
    const bad = again.matched.filter((m) => m.kind !== "MATCH");
    if (bad.length) {
      fail(`DEMO-INV-WITHIN expected 0 diffs, got ${bad.map((b) => b.kind).join(",")}`);
    }
    ok(`DEMO-INV-WITHIN ready to approve (${again.matched.length} lines, 0 diffs)`);
  }

  // 2) Over tolerance — awaiting reason
  {
    const d = await driveToSubmitted({
      shopId: sid,
      carNumber: "100011",
      invoiceNo: "DEMO-INV-OVER",
    });
    const est = await loadApprovedEstimateLines({ eventId: d.eventId });
    const overCents = est.totalCents + 5000;
    if (est.lines[0]) {
      await replaceInvoiceLinesManual({
        invoiceId: d.invoiceId,
        actor: "seed-invoice-examples",
        lines: est.lines.map((l, i) =>
          i === 0
            ? {
                lineNo: l.lineNo,
                jobCode: l.jobCode,
                location: l.location,
                qualifier: l.qualifier,
                qty: l.qty,
                laborCents: l.laborCents + 5000,
                materialCents: l.materialCents,
                respCode: l.respCode,
              }
            : {
                lineNo: l.lineNo,
                jobCode: l.jobCode,
                location: l.location,
                qualifier: l.qualifier,
                qty: l.qty,
                laborCents: l.laborCents,
                materialCents: l.materialCents,
                respCode: l.respCode,
              },
        ),
      });
    }
    await q(`UPDATE repair.invoices SET total = $2 WHERE id = $1`, [
      d.invoiceId,
      overCents / 100,
    ]);
    ok("DEMO-INV-OVER awaiting over-tolerance reason");
  }

  // 3) Added line
  {
    const d = await driveToSubmitted({
      shopId: sid,
      carNumber: "100012",
      invoiceNo: "DEMO-INV-ADDED",
    });
    const est = await loadApprovedEstimateLines({ eventId: d.eventId });
    const lines = est.lines.map((l) => ({
      lineNo: l.lineNo,
      jobCode: l.jobCode,
      location: l.location,
      qualifier: l.qualifier,
      qty: l.qty,
      laborCents: l.laborCents,
      materialCents: l.materialCents,
      respCode: l.respCode,
    }));
    const nextNo = (lines[lines.length - 1]?.lineNo ?? 0) + 1;
    lines.push({
      lineNo: nextNo,
      jobCode: "ADDED",
      location: null,
      qualifier: null,
      qty: 1,
      laborCents: 2500,
      materialCents: 0,
      respCode: "1",
    });
    await replaceInvoiceLinesManual({
      invoiceId: d.invoiceId,
      actor: "seed-invoice-examples",
      lines,
    });
    await q(
      `UPDATE repair.invoices SET total = $2 WHERE id = $1`,
      [d.invoiceId, (est.totalCents + 2500) / 100],
    );
    const bundle = await getInvoiceReviewBundle({ invoiceId: d.invoiceId });
    if (!bundle.ok || !bundle.matched.some((m) => m.kind === "ADDED")) {
      fail("DEMO-INV-ADDED expected LINE_ADDED");
    }
    ok("DEMO-INV-ADDED has added line flag");
  }

  // 4) Short-pay — r3/r4: header shortfall = $747.50; net payable = total − that
  {
    const d = await driveToSubmitted({
      shopId: sid,
      carNumber: "100013",
      invoiceNo: "DEMO-INV-SHORT",
    });
    const { rows: st } = await q(
      `SELECT payment_status, short_pay_cents, approved_amount_cents,
              ROUND(COALESCE(total,0) * 100)::bigint AS total_cents
       FROM repair.invoices WHERE id = $1`,
      [d.invoiceId],
    );
    const curShort = st[0]?.short_pay_cents != null ? Number(st[0].short_pay_cents) : null;
    const needsRebuild = curShort !== DEMO_SHORT_PAY_SHORTFALL_CENTS;
    if (needsRebuild) {
      // Deterministic lines so shortfall is exactly $747.50
      const line1 = 100000; // $1,000.00
      const line2 = 149500; // $1,495.00
      const invTotalCents = line1 + line2; // $2,495.00
      await replaceInvoiceLinesManual({
        invoiceId: d.invoiceId,
        actor: "seed-invoice-examples",
        lines: [
          {
            lineNo: 1,
            jobCode: "1000",
            qty: 1,
            laborCents: line1,
            respCode: "1",
          },
          {
            lineNo: 2,
            jobCode: "2000",
            qty: 1,
            laborCents: line2,
            respCode: "6",
          },
        ],
      });
      await q(
        `UPDATE repair.invoices
         SET total = $2,
             estimate_total = $2,
             workflow_status = 'UNDER_OWNER_REVIEW',
             payment_status = NULL,
             short_pay_cents = NULL,
             approved_amount_cents = NULL,
             short_pay_reason = NULL
         WHERE id = $1`,
        [d.invoiceId, invTotalCents / 100],
      );
      const shorted = await shortPayOwnerInvoice({
        invoiceId: d.invoiceId,
        actor: "owner@demo",
        reason: "Labor rate dispute",
        lineShortPays: [
          { lineNo: 1, amountCents: line1, reason: "OK" },
          {
            lineNo: 2,
            amountCents: line2 - DEMO_SHORT_PAY_SHORTFALL_CENTS,
            reason: "Half labor dispute",
          },
        ],
      });
      if (!shorted.ok) fail(shorted.error);
      if (shorted.shortPayCents !== DEMO_SHORT_PAY_SHORTFALL_CENTS) {
        fail(
          `DEMO-INV-SHORT shortfall expected ${DEMO_SHORT_PAY_SHORTFALL_CENTS}, got ${shorted.shortPayCents}`,
        );
      }
      if (shorted.netPayableCents !== invTotalCents - DEMO_SHORT_PAY_SHORTFALL_CENTS) {
        fail(
          `DEMO-INV-SHORT net expected ${invTotalCents - DEMO_SHORT_PAY_SHORTFALL_CENTS}, got ${shorted.netPayableCents}`,
        );
      }
    }
    const { rows: verify } = await q(
      `SELECT short_pay_cents, approved_amount_cents,
              ROUND(COALESCE(total,0) * 100)::bigint AS total_cents
       FROM repair.invoices WHERE id = $1`,
      [d.invoiceId],
    );
    const sp = Number(verify[0]?.short_pay_cents ?? -1);
    const tot = Number(verify[0]?.total_cents ?? 0);
    const net = Number(verify[0]?.approved_amount_cents ?? -1);
    if (sp !== DEMO_SHORT_PAY_SHORTFALL_CENTS) {
      fail(`DEMO-INV-SHORT short_pay_cents=${sp} want ${DEMO_SHORT_PAY_SHORTFALL_CENTS}`);
    }
    if (net !== tot - DEMO_SHORT_PAY_SHORTFALL_CENTS) {
      fail(`DEMO-INV-SHORT net ${net} ≠ total ${tot} − ${DEMO_SHORT_PAY_SHORTFALL_CENTS}`);
    }
    ok(
      `DEMO-INV-SHORT short-pay $${(DEMO_SHORT_PAY_SHORTFALL_CENTS / 100).toFixed(2)} (net = total − shortfall)`,
    );
  }

  // 5) Paid
  {
    const d = await driveToSubmitted({
      shopId: sid,
      carNumber: "100014",
      invoiceNo: "DEMO-INV-PAID",
    });
    const { rows: st } = await q(
      `SELECT payment_status, paid_at FROM repair.invoices WHERE id = $1`,
      [d.invoiceId],
    );
    if (String(st[0]?.payment_status) !== "PAID") {
      const appr = await approveOwnerInvoice({
        invoiceId: d.invoiceId,
        actor: "owner@demo",
      });
      if (!appr.ok) fail(appr.error);
      const { ensureOpenAccountingMonth, closeAccountingMonth } = await import(
        "../services/accounting-months"
      );
      const open = await ensureOpenAccountingMonth({ actor: "owner@demo" });
      const closed = await closeAccountingMonth({
        monthId: open.id,
        actor: "owner@demo",
        confirm: true,
      });
      if (!closed.ok) fail(closed.error);
      const paid = await recordInvoicePaid({
        invoiceId: d.invoiceId,
        actor: "owner@demo",
        paidAt: "2026-10-01",
        paidRef: "CHK-DEMO-PAID",
        paidMethod: "CHECK",
      });
      if (!paid.ok) fail(paid.error);
    }
    ok("DEMO-INV-PAID recorded");
  }

  // Verify each lands (idempotent second pass must not duplicate)
  const expected = [
    "DEMO-INV-WITHIN",
    "DEMO-INV-OVER",
    "DEMO-INV-ADDED",
    "DEMO-INV-SHORT",
    "DEMO-INV-PAID",
  ];
  for (const no of expected) {
    const { rows } = await q(
      `SELECT count(*)::int AS n FROM repair.invoices
       WHERE invoice_no = $1 AND deleted_at IS NULL`,
      [no],
    );
    if (Number(rows[0]?.n) !== 1) {
      fail(`${no} expected exactly 1, got ${rows[0]?.n}`);
    }
  }
  ok("all five DEMO invoice examples present (no duplicates)");
}

async function main() {
  console.log("=== repair:seed-invoice-examples ===");
  process.env.REPAIR_LOCAL_DB = process.env.REPAIR_LOCAL_DB ?? "1";
  process.env.REPAIR_DEV_BYPASS_AUTH = process.env.REPAIR_DEV_BYPASS_AUTH ?? "1";
  if (!process.env.DATABASE_URL && !process.env.REPAIR_DATABASE_URL) {
    process.env.DATABASE_URL =
      "postgresql://repairdev:repairdev@127.0.0.1:5432/rlms_repair_dev";
  }
  await migrateLocal();
  await seedInvoiceExamples();
  console.log("=== repair:seed-invoice-examples PASS ===");
}

const isMain =
  !!process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
