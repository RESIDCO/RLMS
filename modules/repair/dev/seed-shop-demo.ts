/**
 * §G r2 — Idempotent shop demo seed (dev-bypass only).
 * Demo Shop DS01; OPEN BO with arrival+POD; sample 500-byte files;
 * statuses: Rejected w/ line comments, Approved w/ flags, Missed POD, Closed.
 *
 * Run: npm run repair:seed-shop-demo
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { DEFAULT_TENANT_ID, q } from "../db";
import { createShop } from "../services/shops";
import { createBadOrder } from "../services/bo";
import { shopSubmitEstimate } from "../services/shop-portal";
import { requestRevision, approveEstimate, submitForApproval } from "../services/estimates";
import {
  saveDecisionComments,
  updateBoLifecycleDates,
} from "../services/shop-clarity";
import { enterPodErd } from "../services/pod";
import { parseAarFile } from "../services/aar-parser";
import { migrateLocal } from "./migrate-local";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../..");
const SAMPLES = join(__dirname, "shop-samples");
const SAMPLE_SRC = join(__dirname, "reference/Sample_Shop_500byte_OFOX2609.txt");

const DEMO_SHOP_MARK = "DS01";
const DEMO_SHOP_ID_KEY = "demo-shop-ds01";

function ok(m: string) {
  console.log(`  OK  ${m}`);
}

async function seedCar(mark: string, number: string) {
  await q(
    `INSERT INTO public.railcars (id, car_number, car_initial, reporting_marks, active, entity, lessee_name)
     SELECT GREATEST((SELECT COALESCE(MAX(id),0) FROM public.railcars), 70000) + 1,
            $1, $2, $2, true, 'Main', 'HIDDEN LESSEE'
     WHERE NOT EXISTS (
       SELECT 1 FROM public.railcars WHERE car_initial = $2 AND car_number = $1
     )`,
    [number, mark],
  );
  await q(
    `INSERT INTO public.v_valid_export_rows_data
       (export_src, export_id, car_initial, car_number, active, rider, assignment, assignment_id, lessee, start_date, end_date)
     SELECT 1, 70001, $2, $1, 1, 'R1', 'DEMO-G', 'AG1', 'HIDDEN LESSEE', '2026-01-01', NULL
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

/** Set repairing party (cols 72-75) to shop mark. */
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

function blankCid(bytes: Buffer): Buffer {
  const parsed = parseAarFile(bytes);
  const ending = parsed.lineEnding === "CRLF" ? "\r\n" : "\n";
  const out = parsed.lines.map((line) => {
    if (line.recordFormat !== "1") return line.rawLine;
    return line.rawLine.slice(0, 326) + "              " + line.rawLine.slice(340);
  });
  return Buffer.from(out.join(ending), "latin1");
}

function ensureSamples(base: Buffer) {
  mkdirSync(SAMPLES, { recursive: true });
  const shopBase = withShopMark(base, DEMO_SHOP_MARK);
  const files: Array<[string, Buffer]> = [
    ["good.txt", shopBase],
    ["flagged-missing-cid.txt", blankCid(shopBase)],
    [
      "hard-reject-bad-source.txt",
      (() => {
        const p = parseAarFile(shopBase);
        const ending = p.lineEnding === "CRLF" ? "\r\n" : "\n";
        let n = 0;
        const lines = p.lines.map((line) => {
          if (line.recordFormat !== "1") return line.rawLine;
          if (n++ !== 0) return line.rawLine;
          return line.rawLine.slice(0, 30) + "XX" + line.rawLine.slice(32);
        });
        return Buffer.from(lines.join(ending), "latin1");
      })(),
    ],
  ];
  for (const [name, buf] of files) {
    const path = join(SAMPLES, name);
    writeFileSync(path, buf);
    ok(`sample ${name} (${buf.length} bytes)`);
  }
}

async function ensureShop() {
  const { rows } = await q(
    `SELECT * FROM repair.shops
     WHERE tenant_id = $1 AND deleted_at IS NULL
       AND (upper(shop_mark) = $2 OR upper(reporting_mark) = $2)
     LIMIT 1`,
    [DEFAULT_TENANT_ID, DEMO_SHOP_MARK],
  );
  if (rows[0]) {
    ok(`shop ${DEMO_SHOP_MARK} exists (${rows[0].id})`);
    return rows[0];
  }
  const created = await createShop({
    legalName: "Demo Shop DS01",
    city: "Toledo",
    state: "OH",
    splc: "382000",
    shopMark: DEMO_SHOP_MARK,
    actor: "seed-shop-demo",
  });
  if (!created.ok) throw new Error(created.error);
  ok(`created shop ${DEMO_SHOP_MARK}`);
  return created.shop;
}

async function ensureOpenBo(shopId: string, base: Buffer) {
  const carMark = "DEMO";
  const carNumber = "100001";
  const { rows: existing } = await q(
    `SELECT e.id FROM repair.events e
     WHERE e.tenant_id = $1 AND e.deleted_at IS NULL
       AND e.car_mark = $2 AND e.car_number = $3 AND e.shop_id = $4
     LIMIT 1`,
    [DEFAULT_TENANT_ID, carMark, carNumber, shopId],
  );
  let eventId = existing[0]?.id ? String(existing[0].id) : "";
  await seedCar(carMark, carNumber);
  if (!eventId) {
    const bo = await createBadOrder({
      carMark,
      carNumber,
      shopId,
      shoppingReason: "Demo OPEN BO",
      comments: "Owner instructions for DS01 demo",
      arrivalDate: "2026-10-01",
      actor: "seed-shop-demo",
      boRuleCode: "OTHER",
      boRuleOtherText: "Demo OPEN",
      boDate: "2026-10-01",
      allowDuplicates: true,
    });
    if (!bo.ok) throw new Error(JSON.stringify(bo));
    eventId = String(bo.event.id);
    ok(`OPEN BO ${carMark} ${carNumber}`);
  } else {
    ok(`OPEN BO already ${eventId.slice(0, 8)}`);
  }

  await updateBoLifecycleDates({
    eventId,
    actor: "seed-shop-demo",
    actorRole: "owner",
    arrival: "2026-10-01",
    inspected: "2026-10-02",
  });
  await enterPodErd({
    eventId,
    kind: "POD",
    dateValue: "2026-10-20",
    enteredBy: "seed-shop-demo",
    reason: "Initial POD",
    via: "seed",
  }).catch(() => undefined);

  return {
    eventId,
    carMark,
    carNumber,
    bytes: withShopMark(withCar(base, carMark, carNumber), DEMO_SHOP_MARK),
  };
}

async function seedRejected(shopId: string, base: Buffer) {
  const carMark = "DEMO";
  const carNumber = "100002";
  const { rows: existing } = await q(
    `SELECT e.id, est.id AS estimate_id
     FROM repair.events e
     LEFT JOIN repair.estimates est ON est.event_id = e.id AND est.deleted_at IS NULL
     WHERE e.car_mark = $1 AND e.car_number = $2 AND e.shop_id = $3
       AND e.deleted_at IS NULL
     LIMIT 1`,
    [carMark, carNumber, shopId],
  );
  let eventId = existing[0]?.id ? String(existing[0].id) : "";
  let estimateId = existing[0]?.estimate_id
    ? String(existing[0].estimate_id)
    : "";

  await seedCar(carMark, carNumber);
  if (!eventId) {
    const bo = await createBadOrder({
      carMark,
      carNumber,
      shopId,
      shoppingReason: "Demo Rejected",
      actor: "seed-shop-demo",
      arrivalDate: "2026-09-15",
      boRuleCode: "OTHER",
      boRuleOtherText: "Demo Rejected",
      boDate: "2026-09-15",
      allowDuplicates: true,
    });
    if (!bo.ok) throw new Error(JSON.stringify(bo));
    eventId = String(bo.event.id);
  }

  if (!estimateId) {
    const bytes = withShopMark(withCar(base, carMark, carNumber), DEMO_SHOP_MARK);
    const sub = await shopSubmitEstimate({
      role: "shop",
      shopMark: DEMO_SHOP_MARK,
      actor: "seed-shop-demo",
      eventId,
      bytes,
      filename: "demo-rejected.txt",
    });
    if (!sub.ok) throw new Error(JSON.stringify(sub).slice(0, 300));
    estimateId = String(sub.estimateId);
    const { rows: st } = await q(
      `SELECT s.code FROM repair.estimates e JOIN repair.statuses s ON s.id = e.status_id WHERE e.id = $1`,
      [estimateId],
    );
    if (st[0]?.code === "QUEUED") {
      await submitForApproval({ estimateId, actor: "seed-shop-demo" });
    }
    await requestRevision({
      estimateId,
      actor: "owner@demo",
      comment: "Revise labor on line 1",
    });
    await saveDecisionComments({
      eventId,
      estimateId,
      kind: "REJECT",
      estimateComment: "Please address flagged lines",
      lineComments: [
        { lineNo: 1, jobCode: "1001", body: "Quantity looks high — confirm" },
        { lineNo: 2, body: "Add CID" },
      ],
      author: "owner@demo",
    });
    ok(`Rejected estimate with line comments (${estimateId.slice(0, 8)})`);
  } else {
    ok(`Rejected demo already seeded`);
  }
  return { eventId, estimateId };
}

async function seedApprovedFlags(shopId: string, base: Buffer) {
  const carMark = "DEMO";
  const carNumber = "100003";
  const { rows: existing } = await q(
    `SELECT e.id FROM repair.events e
     WHERE e.car_mark = $1 AND e.car_number = $2 AND e.shop_id = $3
       AND e.deleted_at IS NULL LIMIT 1`,
    [carMark, carNumber, shopId],
  );
  if (existing[0]) {
    ok("Approved+flags demo already seeded");
    return;
  }
  await seedCar(carMark, carNumber);
  const bo = await createBadOrder({
    carMark,
    carNumber,
    shopId,
    shoppingReason: "Demo Approved flags",
    actor: "seed-shop-demo",
    arrivalDate: "2026-09-01",
    boRuleCode: "OTHER",
    boRuleOtherText: "Demo Flags",
    boDate: "2026-09-01",
    allowDuplicates: true,
  });
  if (!bo.ok) throw new Error(JSON.stringify(bo));
  const eventId = String(bo.event.id);
  const bytes = blankCid(
    withShopMark(withCar(base, carMark, carNumber), DEMO_SHOP_MARK),
  );
  const sub = await shopSubmitEstimate({
    role: "shop",
    shopMark: DEMO_SHOP_MARK,
    actor: "seed-shop-demo",
    eventId,
    bytes,
    filename: "demo-flagged.txt",
  });
  if (!sub.ok) {
    ok(`Approved+flags submit soft-fail: ${JSON.stringify(sub).slice(0, 120)}`);
    return;
  }
  const estimateId = String(sub.estimateId);
  const { rows: st } = await q(
    `SELECT s.code FROM repair.estimates e JOIN repair.statuses s ON s.id = e.status_id WHERE e.id = $1`,
    [estimateId],
  );
  if (st[0]?.code === "QUEUED") {
    await submitForApproval({ estimateId, actor: "seed-shop-demo" });
  }
  const ap = await approveEstimate({ estimateId, actor: "owner@demo" });
  await updateBoLifecycleDates({
    eventId,
    actor: "owner@demo",
    actorRole: "owner",
    arrival: "2026-09-01",
    ownerApproval: "2026-09-10",
  });
  ok(
    `Approved+flags ${estimateId.slice(0, 8)} (${ap.ok ? "approved" : ap.error})`,
  );
}

async function seedMissedPod(shopId: string) {
  const carMark = "DEMO";
  const carNumber = "100004";
  const { rows: existing } = await q(
    `SELECT e.id FROM repair.events e
     WHERE e.car_mark = $1 AND e.car_number = $2 AND e.shop_id = $3
       AND e.deleted_at IS NULL LIMIT 1`,
    [carMark, carNumber, shopId],
  );
  let eventId = existing[0]?.id ? String(existing[0].id) : "";
  await seedCar(carMark, carNumber);
  if (!eventId) {
    const bo = await createBadOrder({
      carMark,
      carNumber,
      shopId,
      shoppingReason: "Demo Missed POD",
      actor: "seed-shop-demo",
      arrivalDate: "2026-08-01",
      boRuleCode: "OTHER",
      boRuleOtherText: "Demo Missed POD",
      boDate: "2026-08-01",
      allowDuplicates: true,
    });
    if (!bo.ok) throw new Error(JSON.stringify(bo));
    eventId = String(bo.event.id);
  }
  await enterPodErd({
    eventId,
    kind: "POD",
    dateValue: "2026-08-15",
    enteredBy: "seed-shop-demo",
    reason: "Past POD for missed demo",
    via: "seed",
  }).catch(() => undefined);
  await updateBoLifecycleDates({
    eventId,
    actor: "seed-shop-demo",
    actorRole: "shop",
    missedPodReasonCode: "AWAITING_PARTS",
    missedPodReasonNote: "Axle on order",
  });
  ok(`Missed POD BO ${carMark} ${carNumber}`);
}

async function seedClosed(shopId: string, base: Buffer) {
  const carMark = "DEMO";
  const carNumber = "100005";
  const { rows: existing } = await q(
    `SELECT e.id FROM repair.events e
     WHERE e.car_mark = $1 AND e.car_number = $2 AND e.shop_id = $3
       AND e.deleted_at IS NULL LIMIT 1`,
    [carMark, carNumber, shopId],
  );
  if (existing[0]) {
    ok("Closed demo already seeded");
    return;
  }
  await seedCar(carMark, carNumber);
  const bo = await createBadOrder({
    carMark,
    carNumber,
    shopId,
    shoppingReason: "Demo Closed",
    actor: "seed-shop-demo",
    arrivalDate: "2026-07-01",
    boRuleCode: "OTHER",
    boRuleOtherText: "Demo Closed",
    boDate: "2026-07-01",
    allowDuplicates: true,
  });
  if (!bo.ok) throw new Error(JSON.stringify(bo));
  const eventId = String(bo.event.id);
  await q(
    `UPDATE repair.bad_orders
     SET completed_date = '2026-07-20',
         released_at = '2026-07-21',
         closed_at = now(),
         closed_reason = 'Invoiced 2026-07-22 — demo close'
     WHERE event_id = $1 AND deleted_at IS NULL`,
    [eventId],
  );
  // Ensure an invoice row so timeline sees Closed
  await q(
    `INSERT INTO repair.invoices
       (tenant_id, event_id, shop_id, invoice_no, total, match_status, created_by)
     SELECT $1, $2, $3, 'DEMO-INV-100005', 100.00, 'APPROVED', 'seed-shop-demo'
     WHERE NOT EXISTS (
       SELECT 1 FROM repair.invoices WHERE event_id = $2 AND deleted_at IS NULL
     )`,
    [DEFAULT_TENANT_ID, eventId, shopId],
  ).catch(() => undefined);
  ok(`Closed BO ${carMark} ${carNumber}`);
}

async function main() {
  console.log("=== repair:seed-shop-demo ===");
  process.env.REPAIR_LOCAL_DB = process.env.REPAIR_LOCAL_DB ?? "1";
  process.env.REPAIR_DEV_BYPASS_AUTH = process.env.REPAIR_DEV_BYPASS_AUTH ?? "1";
  if (!process.env.DATABASE_URL && !process.env.REPAIR_DATABASE_URL) {
    process.env.DATABASE_URL =
      "postgresql://repairdev:repairdev@127.0.0.1:5432/rlms_repair_dev";
  }

  await migrateLocal();
  ok("migrate-local");

  if (!existsSync(SAMPLE_SRC)) {
    throw new Error(`Missing sample ${SAMPLE_SRC}`);
  }
  const base = readFileSync(SAMPLE_SRC);
  ensureSamples(base);

  const shop = await ensureShop();
  const shopId = String(shop.id);

  writeFileSync(
    join(SAMPLES, "README.txt"),
    `Demo Shop ${DEMO_SHOP_MARK} samples\nshopId=${shopId}\nkey=${DEMO_SHOP_ID_KEY}\n`,
  );

  await ensureOpenBo(shopId, base);
  await seedRejected(shopId, base);
  await seedApprovedFlags(shopId, base);
  await seedMissedPod(shopId);
  await seedClosed(shopId, base);

  console.log("=== repair:seed-shop-demo PASS ===");
  console.log(`Shop mark: ${DEMO_SHOP_MARK}`);
  console.log(`Samples: ${SAMPLES}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
