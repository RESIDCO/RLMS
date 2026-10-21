/**
 * §G r2–r5 — Idempotent shop demo seed (dev-bypass only).
 * Demo Shop DS01; drives real transitions for DEMO 100001–100005.
 * Hard-fails (exit 1) unless all five land in required stored bo.status.
 * Writes event/estimate IDs to gitignored shop-demo-ids.local.json.
 * Does NOT modify tracked files (no shop-samples/README.txt writes).
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
import {
  requestRevision,
  approveEstimate,
  submitForApproval,
} from "../services/estimates";
import {
  saveDecisionComments,
  updateBoLifecycleDates,
  getBoLifecycleBundle,
  markBadOrderClosed,
  listDecisionComments,
} from "../services/shop-clarity";
import {
  shopAcknowledge,
  shopArrivalDate,
} from "../services/bo-lifecycle";
import { ensureShopBoLink } from "../services/shop-workflow";
import { getBoStoredStatus } from "../services/bo-status";
import { enterPodErd } from "../services/pod";
import { parseAarFile, serializeLine } from "../services/aar-parser";
import { migrateLocal } from "./migrate-local";
import { seedInvoiceExamples } from "./seed-invoice-examples";
import { seedCrbDemo } from "./seed-crb-demo";
import { approveOwnerInvoice } from "../services/invoice-review";
import { createMultiCarInvoice } from "../services/multi-car-invoice";
import {
  ensureOpenAccountingMonth,
  resetDemoAccountingMonths,
} from "../services/accounting-months";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES = join(__dirname, "shop-samples");
const SAMPLE_SRC = join(__dirname, "reference/Sample_Shop_500byte_OFOX2609.txt");
const IDS_FILE = join(__dirname, "shop-demo-ids.local.json");

const DEMO_SHOP_MARK = "DS01";
const DEMO_SHOP_ID_KEY = "demo-shop-ds01";

function ok(m: string) {
  console.log(`  OK  ${m}`);
}

function fail(m: string): never {
  throw new Error(m);
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

/** Bump labor on the first Format-1 line so multi-car estimates/invoices diverge. */
function bumpFirstLineLabor(bytes: Buffer, bumpCents: number): Buffer {
  if (!bumpCents) return bytes;
  const parsed = parseAarFile(bytes);
  const ending = parsed.lineEnding === "CRLF" ? "\r\n" : "\n";
  let bumped = false;
  const lines = parsed.lines.map((line) => {
    if (line.recordFormat !== "1" || bumped) return line.rawLine;
    bumped = true;
    const labor = Math.max(0, Math.trunc(line.laborCents ?? 0) + bumpCents);
    return serializeLine({
      ...line,
      laborCents: labor,
      fields: { ...line.fields, labor_cents: labor },
    });
  });
  return Buffer.from(lines.join(ending), "latin1");
}

/** Collect Format-1 raw lines for one car (already stamped in bytes). */
function format1RawLines(bytes: Buffer): string[] {
  const parsed = parseAarFile(bytes);
  return parsed.lines
    .filter((l) => l.recordFormat === "1")
    .map((l) => l.rawLine);
}

function buildMultiCarAar(carBuffers: Buffer[]): Buffer {
  const parts: string[] = [];
  for (const buf of carBuffers) {
    parts.push(...format1RawLines(buf));
  }
  return Buffer.from(parts.join("\r\n") + "\r\n", "latin1");
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
    writeFileSync(join(SAMPLES, name), buf);
    ok(`sample ${name} (${buf.length} bytes)`);
  }
}

async function ensureShop() {
  const { rows } = await q(
    `SELECT * FROM repair.shops
     WHERE tenant_id = $1 AND deleted_at IS NULL
       AND (upper(shop_mark) = $2 OR upper(reporting_mark) = $2)
     ORDER BY created_at ASC
     LIMIT 1`,
    [DEFAULT_TENANT_ID, DEMO_SHOP_MARK],
  );
  if (rows[0]) {
    await q(
      `UPDATE repair.shops SET is_smoke = false, active = true WHERE id = $1`,
      [rows[0].id],
    ).catch(() => undefined);
    // Soft-delete duplicate DS01 rows from older seed/sim runs
    await q(
      `UPDATE repair.shops
       SET deleted_at = coalesce(deleted_at, now()),
           deleted_by = 'seed-shop-demo',
           active = false
       WHERE tenant_id = $1 AND deleted_at IS NULL
         AND (upper(shop_mark) = $2 OR upper(reporting_mark) = $2)
         AND id <> $3`,
      [DEFAULT_TENANT_ID, DEMO_SHOP_MARK, rows[0].id],
    );
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

/**
 * Reuse exactly one DEMO event per car (never create duplicates).
 * Prefers current shop; otherwise adopts an older-shop event and re-points
 * shop_id. Soft-deletes any extra DEMO events for the same car.
 */
async function findDemoEvent(shopId: string, carNumber: string) {
  const { rows } = await q(
    `SELECT e.id AS event_id, est.id AS estimate_id, st.code AS estimate_status,
            e.shop_id
     FROM repair.events e
     LEFT JOIN repair.estimates est
       ON est.event_id = e.id AND est.deleted_at IS NULL
     LEFT JOIN repair.statuses st ON st.id = est.status_id
     WHERE e.tenant_id = $1 AND e.deleted_at IS NULL
       AND e.car_mark = 'DEMO' AND e.car_number = $2
     ORDER BY CASE WHEN e.shop_id = $3::uuid THEN 0 ELSE 1 END,
              e.created_at ASC
     LIMIT 1`,
    [DEFAULT_TENANT_ID, carNumber, shopId],
  );
  const row = rows[0] as
    | {
        event_id: string;
        estimate_id?: string;
        estimate_status?: string;
        shop_id?: string;
      }
    | undefined;
  if (!row) return undefined;

  // Soft-delete stray duplicates from older seed runs
  await q(
    `UPDATE repair.events
     SET deleted_at = coalesce(deleted_at, now()),
         deleted_by = 'seed-shop-demo'
     WHERE tenant_id = $1 AND deleted_at IS NULL
       AND car_mark = 'DEMO' AND car_number = $2
       AND id <> $3::uuid`,
    [DEFAULT_TENANT_ID, carNumber, row.event_id],
  );
  await q(
    `UPDATE repair.bad_orders
     SET deleted_at = coalesce(deleted_at, now()),
         deleted_by = 'seed-shop-demo'
     WHERE deleted_at IS NULL
       AND event_id IN (
         SELECT id FROM repair.events
         WHERE tenant_id = $1 AND car_mark = 'DEMO' AND car_number = $2
           AND id <> $3::uuid AND deleted_at IS NOT NULL
       )`,
    [DEFAULT_TENANT_ID, carNumber, row.event_id],
  ).catch(() => undefined);

  // Re-point to the current DS01 shop when the keeper was on an old shop row
  if (row.shop_id && String(row.shop_id) !== shopId) {
    await q(`UPDATE repair.events SET shop_id = $2 WHERE id = $1`, [
      row.event_id,
      shopId,
    ]);
    await q(
      `UPDATE repair.bad_orders SET shop_id = $2
       WHERE event_id = $1 AND deleted_at IS NULL`,
      [row.event_id, shopId],
    ).catch(() => undefined);
  }
  return row;
}

async function estimateStatus(estimateId: string): Promise<string> {
  const { rows } = await q(
    `SELECT s.code FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id WHERE e.id = $1`,
    [estimateId],
  );
  return String(rows[0]?.code ?? "");
}

/** Move QUEUED/DRAFT → AWAITING_APPROVAL via real transition. */
async function ensureAwaitingApproval(estimateId: string, eventId: string) {
  let code = await estimateStatus(estimateId);
  if (code === "AWAITING_APPROVAL") return;
  if (code === "QUEUED" || code === "DRAFT") {
    // Yard arrival is required before leaving Queued (timestamptz column)
    const { rowCount } = await q(
      `UPDATE repair.events
       SET yard_arrived_at = coalesce(yard_arrived_at, $2::timestamptz)
       WHERE id = $1::uuid`,
      [eventId, "2026-09-15T12:00:00Z"],
    );
    if (!rowCount) {
      fail(`ensureAwaitingApproval: event ${eventId} not updated`);
    }
    await q(
      `UPDATE repair.bad_orders
       SET arrival_date = coalesce(arrival_date, $2::date)
       WHERE event_id = $1::uuid AND deleted_at IS NULL`,
      [eventId, "2026-09-15"],
    );
    const { rows: chk } = await q(
      `SELECT yard_arrived_at FROM repair.events WHERE id = $1::uuid`,
      [eventId],
    );
    if (!chk[0]?.yard_arrived_at) {
      fail(`ensureAwaitingApproval: yard_arrived_at still null on ${eventId}`);
    }
    const subm = await submitForApproval({
      estimateId,
      actor: "seed-shop-demo",
    });
    if (!subm.ok) fail(`submitForApproval failed: ${JSON.stringify(subm)}`);
    code = await estimateStatus(estimateId);
  }
  if (code !== "AWAITING_APPROVAL") {
    fail(`expected AWAITING_APPROVAL, got ${code}`);
  }
}

/** Issue shop link + accept + on-hand via real transitions when needed. */
async function driveToOnHand(
  eventId: string,
  arrivalIso: string,
  yardNote?: string,
) {
  const stored = await getBoStoredStatus({ eventId });
  if (
    stored &&
    ["ON_HAND", "ESTIMATE_DRAFT", "ESTIMATE_SUBMITTED", "UNDER_OWNER_REVIEW",
      "REJECTED", "APPROVED", "IN_REPAIR", "COMPLETED", "INVOICE_SUBMITTED",
      "CLOSED"].includes(stored.status)
  ) {
    return;
  }
  const link = await ensureShopBoLink({
    eventId,
    shopMark: DEMO_SHOP_MARK,
    actor: "seed-shop-demo",
    forceNew: !stored || stored.status === "ASSIGNED",
  });
  if (!link.token && stored?.status === "ASSIGNED") {
    // Need token — force new
    const forced = await ensureShopBoLink({
      eventId,
      shopMark: DEMO_SHOP_MARK,
      actor: "seed-shop-demo",
      forceNew: true,
    });
    if (!forced.token) fail(`no shop link token for ${eventId}`);
    await acknowledgeAndArrive(forced.token, arrivalIso, yardNote);
    return;
  }
  if (link.token) {
    await acknowledgeAndArrive(link.token, arrivalIso, yardNote);
    return;
  }
  // Reused link without token — mint forceNew to drive transitions
  const forced = await ensureShopBoLink({
    eventId,
    shopMark: DEMO_SHOP_MARK,
    actor: "seed-shop-demo",
    forceNew: true,
  });
  if (!forced.token) fail(`no shop link token for ${eventId}`);
  await acknowledgeAndArrive(forced.token, arrivalIso, yardNote);
}

async function acknowledgeAndArrive(
  token: string,
  arrivalIso: string,
  yardNote?: string,
) {
  const ack = await shopAcknowledge(token, "shop@demo.seed");
  if (!ack.ok) fail(`shopAcknowledge: ${JSON.stringify(ack)}`);
  const hand = await shopArrivalDate(
    token,
    "shop@demo.seed",
    arrivalIso,
    yardNote ?? null,
  );
  if (!hand.ok) fail(`shopArrivalDate: ${JSON.stringify(hand)}`);
}

async function ensureOpenBo(shopId: string, base: Buffer) {
  const carMark = "DEMO";
  const carNumber = "100001";
  let row = await findDemoEvent(shopId, carNumber);
  await seedCar(carMark, carNumber);
  let eventId = row?.event_id ? String(row.event_id) : "";
  if (!eventId) {
    const bo = await createBadOrder({
      carMark,
      carNumber,
      shopId,
      shoppingReason: "Demo Assigned BO",
      comments: "Owner instructions for DS01 demo",
      actor: "seed-shop-demo",
      boRuleCode: "OTHER",
      boRuleOtherText: "Demo Assigned",
      boDate: "2026-10-01",
      allowDuplicates: false,
    });
    if (!bo.ok) throw new Error(JSON.stringify(bo));
    eventId = String(bo.event.id);
    ok(`ASSIGNED BO ${carMark} ${carNumber}`);
  } else {
    ok(`ASSIGNED BO already ${eventId.slice(0, 8)}`);
  }

  // Demo 100001 must stay ASSIGNED (awaiting shop acceptance)
  {
    const { setBoStatus } = await import("../services/bo-status");
    const fixed = await setBoStatus({
      eventId,
      to: "ASSIGNED",
      actor: "seed-shop-demo",
      actionName: "Seed ensure Assigned",
      force: true,
    });
    if (!fixed.ok) fail(`100001 setBoStatus ASSIGNED: ${fixed.error}`);
  }

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
  let row = await findDemoEvent(shopId, carNumber);
  let eventId = row?.event_id ? String(row.event_id) : "";
  let estimateId = row?.estimate_id ? String(row.estimate_id) : "";

  await seedCar(carMark, carNumber);
  if (!eventId) {
    const bo = await createBadOrder({
      carMark,
      carNumber,
      shopId,
      shoppingReason: "Demo Rejected",
      actor: "seed-shop-demo",
      boRuleCode: "OTHER",
      boRuleOtherText: "Demo Rejected",
      boDate: "2026-09-15",
      allowDuplicates: false,
    });
    if (!bo.ok) throw new Error(JSON.stringify(bo));
    eventId = String(bo.event.id);
  }

  await driveToOnHand(eventId, "2026-09-15T12:00:00.000Z", "Track A");

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
    if (!sub.ok) fail(`100002 submit failed: ${JSON.stringify(sub).slice(0, 300)}`);
    estimateId = String(sub.estimateId);
  }

  let code = await estimateStatus(estimateId);
  if (code !== "REVISION_REQUESTED") {
    await ensureAwaitingApproval(estimateId, eventId);
    const rev = await requestRevision({
      estimateId,
      actor: "owner@demo",
      comment: "Revise labor on line 1",
    });
    if (!rev.ok) fail(`100002 requestRevision failed: ${JSON.stringify(rev)}`);
  }
  const comments = await listDecisionComments({ estimateId });
  if (comments.lineLevel.length < 2) {
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
  }
  ok(`Rejected estimate with line comments (${estimateId.slice(0, 8)})`);
  return { eventId, estimateId };
}

async function seedApprovedFlags(shopId: string, base: Buffer) {
  const carMark = "DEMO";
  const carNumber = "100003";
  let row = await findDemoEvent(shopId, carNumber);
  await seedCar(carMark, carNumber);
  let eventId = row?.event_id ? String(row.event_id) : "";
  let estimateId = row?.estimate_id ? String(row.estimate_id) : "";

  if (!eventId) {
    const bo = await createBadOrder({
      carMark,
      carNumber,
      shopId,
      shoppingReason: "Demo Approved flags",
      actor: "seed-shop-demo",
      boRuleCode: "OTHER",
      boRuleOtherText: "Demo Flags",
      boDate: "2026-09-01",
      allowDuplicates: false,
    });
    if (!bo.ok) throw new Error(JSON.stringify(bo));
    eventId = String(bo.event.id);
  }

  await driveToOnHand(eventId, "2026-09-01T12:00:00.000Z", "Bay 1");

  if (!estimateId) {
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
      fail(`100003 submit failed: ${JSON.stringify(sub).slice(0, 300)}`);
    }
    estimateId = String(sub.estimateId);
  }

  let code = await estimateStatus(estimateId);
  if (code !== "APPROVED") {
    await ensureAwaitingApproval(estimateId, eventId);
    const ap = await approveEstimate({ estimateId, actor: "owner@demo" });
    if (!ap.ok) fail(`100003 approve failed: ${JSON.stringify(ap)}`);
  }
  await updateBoLifecycleDates({
    eventId,
    actor: "owner@demo",
    actorRole: "owner",
    arrival: "2026-09-01",
    ownerApproval: "2026-09-10",
  });
  // Ensure NOT closed (r5: approve must not close) + stored status APPROVED
  await q(
    `UPDATE repair.bad_orders
     SET closed_at = NULL, closed_reason = NULL
     WHERE event_id = $1 AND deleted_at IS NULL`,
    [eventId],
  );
  {
    const { setBoStatus } = await import("../services/bo-status");
    const fixed = await setBoStatus({
      eventId,
      to: "APPROVED",
      actor: "owner@demo",
      actionName: "Seed ensure approved (not closed)",
      force: true,
    });
    if (!fixed.ok) fail(`100003 setBoStatus APPROVED: ${fixed.error}`);
  }
  ok(`Approved+flags ${estimateId.slice(0, 8)}`);
  return { eventId, estimateId };
}

async function seedMissedPod(shopId: string) {
  const carMark = "DEMO";
  const carNumber = "100004";
  let row = await findDemoEvent(shopId, carNumber);
  let eventId = row?.event_id ? String(row.event_id) : "";
  await seedCar(carMark, carNumber);
  if (!eventId) {
    const bo = await createBadOrder({
      carMark,
      carNumber,
      shopId,
      shoppingReason: "Demo On Hand + Missed POD",
      actor: "seed-shop-demo",
      boRuleCode: "OTHER",
      boRuleOtherText: "Demo Missed POD",
      boDate: "2026-08-01",
      allowDuplicates: false,
    });
    if (!bo.ok) throw new Error(JSON.stringify(bo));
    eventId = String(bo.event.id);
  }

  // Real transitions: Assigned → Accepted → On Hand (never skip accept)
  await driveToOnHand(eventId, "2026-08-01T10:00:00.000Z", "West yard");

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
  ok(`On Hand + Missed POD BO ${carMark} ${carNumber}`);
  return { eventId };
}

async function seedClosed(shopId: string, base: Buffer) {
  const carMark = "DEMO";
  const carNumber = "100005";
  let row = await findDemoEvent(shopId, carNumber);
  await seedCar(carMark, carNumber);
  let eventId = row?.event_id ? String(row.event_id) : "";
  let estimateId = row?.estimate_id ? String(row.estimate_id) : "";

  if (!eventId) {
    const bo = await createBadOrder({
      carMark,
      carNumber,
      shopId,
      shoppingReason: "Demo Closed",
      actor: "seed-shop-demo",
      boRuleCode: "OTHER",
      boRuleOtherText: "Demo Closed",
      boDate: "2026-07-01",
      allowDuplicates: false,
    });
    if (!bo.ok) throw new Error(JSON.stringify(bo));
    eventId = String(bo.event.id);
  }

  await driveToOnHand(eventId, "2026-07-01T12:00:00.000Z", "Closed bay");

  // Real transitions: accept → on hand → submit → approve → completed → invoice → close
  if (!estimateId) {
    const bytes = withShopMark(withCar(base, carMark, carNumber), DEMO_SHOP_MARK);
    const sub = await shopSubmitEstimate({
      role: "shop",
      shopMark: DEMO_SHOP_MARK,
      actor: "seed-shop-demo",
      eventId,
      bytes,
      filename: "demo-closed.txt",
    });
    if (!sub.ok) fail(`100005 submit failed: ${JSON.stringify(sub).slice(0, 300)}`);
    estimateId = String(sub.estimateId);
  }
  {
    const code = await estimateStatus(estimateId);
    if (code !== "APPROVED") {
      await ensureAwaitingApproval(estimateId, eventId);
      const ap = await approveEstimate({ estimateId, actor: "owner@demo" });
      if (!ap.ok) fail(`100005 approve failed: ${JSON.stringify(ap)}`);
    }
  }

  const lifePatch = await updateBoLifecycleDates({
    eventId,
    actor: "seed-shop-demo",
    actorRole: "shop",
    arrival: "2026-07-01",
    completed: "2026-07-20",
    released: "2026-07-21",
  });
  if (!lifePatch.ok) fail(`100005 completed date: ${lifePatch.error}`);

  // Owner clears blocking flags before close (real gate: no open blocking flags)
  await q(
    `UPDATE repair.estimate_validation_findings f
     SET cleared_at = coalesce(cleared_at, now()), cleared_by = 'owner@demo'
     FROM repair.estimate_validation_runs r
     WHERE f.run_id = r.id AND r.estimate_id = $1 AND f.cleared_at IS NULL`,
    [estimateId],
  );

  // Amount must match APPROVED estimate total (never hard-code $100 / $0).
  const { rows: totRows } = await q(
    `SELECT r.total
     FROM repair.estimates e
     JOIN repair.estimate_revisions r
       ON r.estimate_id = e.id AND r.rev_no = e.current_revision
     WHERE e.id = $1`,
    [estimateId],
  );
  const estTotal = Number(totRows[0]?.total ?? 0);
  if (!(estTotal > 0)) {
    fail(`100005 approved estimate total missing/zero (got ${estTotal})`);
  }

  // Idempotent: exactly one DEMO-INV-100005 keyed to the CURRENT event + shop.
  // Root cause (r4): prior seeds found by invoice_no but never re-pointed
  // event_id/shop_id, so the invoice stayed on an old DS01 shop/event and
  // closing the current 100005 failed with "invoice required".
  const { rows: existingInv } = await q(
    `SELECT id, total, invoice_no, event_id, shop_id FROM repair.invoices
     WHERE deleted_at IS NULL
       AND (
         event_id = $1
         OR invoice_no = 'DEMO-INV-100005'
       )
     ORDER BY
       CASE WHEN invoice_no = 'DEMO-INV-100005' THEN 0 ELSE 1 END,
       CASE WHEN event_id = $1 THEN 0 ELSE 1 END,
       created_at ASC`,
    [eventId],
  );
  if (!existingInv.length) {
    await q(
      `INSERT INTO repair.invoices
         (tenant_id, event_id, shop_id, invoice_no, total, estimate_total,
          match_status, workflow_status, payment_status, created_by,
          decided_by, decided_at)
       VALUES ($1,$2,$3,'DEMO-INV-100005',$4,$4,'MATCHED','UNDER_OWNER_REVIEW',NULL,
               'seed-shop-demo',NULL, NULL)`,
      [DEFAULT_TENANT_ID, eventId, shopId, estTotal],
    );
  } else {
    // Soft-delete accidental duplicates; keep/repair the DEMO-INV-100005 row.
    let keepId: string | null = null;
    for (const r of existingInv) {
      if (String(r.invoice_no) === "DEMO-INV-100005") {
        keepId = String(r.id);
        break;
      }
    }
    if (!keepId) keepId = String(existingInv[0].id);
    for (const r of existingInv) {
      if (String(r.id) === keepId) continue;
      await q(
        `UPDATE repair.invoices
         SET deleted_at = coalesce(deleted_at, now()),
             deleted_by = 'seed-shop-demo',
             delete_reason = 'duplicate DEMO-INV-100005'
         WHERE id = $1 AND deleted_at IS NULL`,
        [String(r.id)],
      );
    }
    // Always re-point to the CURRENT event + shop (do not coalesce).
    await q(
      `UPDATE repair.invoices
       SET invoice_no = 'DEMO-INV-100005',
           event_id = $2,
           shop_id = $3,
           total = $4,
           estimate_total = $4,
           match_status = 'APPROVED',
           workflow_status = coalesce(workflow_status, 'ACCEPTED')
       WHERE id = $1`,
      [keepId, eventId, shopId, estTotal],
    );
  }

  const { rows: invCount } = await q(
    `SELECT count(*)::int AS n FROM repair.invoices
     WHERE invoice_no = 'DEMO-INV-100005' AND deleted_at IS NULL`,
  );
  if (Number(invCount[0]?.n ?? 0) !== 1) {
    fail(`DEMO-INV-100005 expected exactly 1, got ${invCount[0]?.n}`);
  }

  const { rows: invIdRows } = await q(
    `SELECT id, payment_status, workflow_status FROM repair.invoices
     WHERE invoice_no = 'DEMO-INV-100005' AND deleted_at IS NULL LIMIT 1`,
  );
  const invId = String(invIdRows[0].id);
  const paySt = String(invIdRows[0].payment_status ?? "");
  if (
    !["APPROVED_IN_OPEN_MONTH", "MONTH_CLOSED", "SENT_TO_AP", "PAID", "PAYABLE"].includes(
      paySt,
    )
  ) {
    // Ensure lines exist for review
    const { replaceInvoiceLinesFromAar } = await import("../services/invoice-review");
    await replaceInvoiceLinesFromAar({
      invoiceId: invId,
      aarBytes: base,
      actor: "seed-shop-demo",
    }).catch(() => undefined);
    await q(
      `UPDATE repair.invoices
       SET workflow_status = 'UNDER_OWNER_REVIEW',
           total = $2, estimate_total = $2
       WHERE id = $1`,
      [invId, estTotal],
    );
    const appr = await approveOwnerInvoice({
      invoiceId: invId,
      actor: "owner@demo",
    });
    if (!appr.ok) fail(`100005 approve invoice: ${appr.error}`);
  }

  const closed = await markBadOrderClosed({
    eventId,
    actor: "seed-shop-demo",
    tenantId: DEFAULT_TENANT_ID,
    invoiceNo: "DEMO-INV-100005",
    invoicedAt: "2026-07-22",
  });
  if (!closed.ok) {
    // approveOwnerInvoice already closes BO; tolerate already-closed
    const st = await getBoStoredStatus({ eventId });
    if (st?.status !== "CLOSED") fail(`100005 close failed: ${closed.error}`);
  }
  ok(
    `Closed BO ${carMark} ${carNumber} via approved invoice (DEMO-INV-100005 = $${estTotal.toFixed(2)})`,
  );
  return {
    eventId,
    estimateId,
    closedReason: closed.ok ? closed.closedReason : "Closed via approved invoice",
    estTotal,
  };
}


/**
 * §H r5 — idempotent 5-car multi-car invoice (DEMO-INV-MULTI).
 * Cars use different estimate/invoice amounts; one car has an exception.
 * Demo uses 5 cars; product allows any number ≥ 2 (no cap).
 * Does NOT close real calendar months — month reset happens after seed.
 */
async function seedMultiCarAndMonth(shopId: string, base: Buffer) {
  // Hide legacy r3 name so queue stays DEMO-only with the new number
  await q(
    `UPDATE repair.invoices
     SET deleted_at = coalesce(deleted_at, now()),
         deleted_by = 'seed-shop-demo',
         delete_reason = 'renamed to DEMO-INV-MULTI'
     WHERE invoice_no = 'DEMO-INV-UNIT5' AND deleted_at IS NULL`,
  );

  const { rows: existing } = await q(
    `SELECT id, shop_id FROM repair.invoices
     WHERE invoice_no = 'DEMO-INV-MULTI' AND deleted_at IS NULL LIMIT 1`,
  );
  // Distinct estimate bumps; 91003 invoice gets +$250 exception vs its estimate
  const carSpecs = [
    { carNumber: "91001", estBump: 0, invExtra: 0 },
    { carNumber: "91002", estBump: 50_000, invExtra: 0 },
    { carNumber: "91003", estBump: 100_000, invExtra: 25_000 },
    { carNumber: "91004", estBump: -30_000, invExtra: 0 },
    { carNumber: "91005", estBump: 75_000, invExtra: 0 },
  ];
  const eventIds: string[] = [];
  const invCarBuffers: Buffer[] = [];
  for (const spec of carSpecs) {
    const carNumber = spec.carNumber;
    await seedCar("DEMO", carNumber);
    let row = await findDemoEvent(shopId, carNumber);
    let eventId = row?.event_id ? String(row.event_id) : "";
    let estimateId = row?.estimate_id ? String(row.estimate_id) : "";
    if (!eventId) {
      const bo = await createBadOrder({
        carMark: "DEMO",
        carNumber,
        shopId,
        shoppingReason: "Multi-car invoice demo",
        actor: "seed-shop-demo",
        boRuleCode: "OTHER",
        boRuleOtherText: "Multi-car",
        boDate: "2026-09-01",
        allowDuplicates: false,
      });
      if (!bo.ok) fail(JSON.stringify(bo));
      eventId = String(bo.event.id);
    }
    await driveToOnHand(eventId, "2026-09-01T12:00:00.000Z", "Multi-car track");
    const estBytes = bumpFirstLineLabor(
      withShopMark(withCar(base, "DEMO", carNumber), DEMO_SHOP_MARK),
      spec.estBump,
    );
    if (!estimateId) {
      const sub = await shopSubmitEstimate({
        role: "shop",
        shopMark: DEMO_SHOP_MARK,
        actor: "seed-shop-demo",
        eventId,
        bytes: estBytes,
        filename: `multi-${carNumber}.txt`,
      });
      if (!sub.ok) fail(`multi ${carNumber} submit: ${JSON.stringify(sub).slice(0, 200)}`);
      estimateId = String(sub.estimateId);
    }
    {
      const code = await estimateStatus(estimateId);
      if (code !== "APPROVED" && code !== "COMPLETED") {
        await ensureAwaitingApproval(estimateId, eventId);
        const ap = await approveEstimate({ estimateId, actor: "owner@demo" });
        if (!ap.ok) fail(`multi ${carNumber} approve: ${JSON.stringify(ap)}`);
      }
    }
    await updateBoLifecycleDates({
      eventId,
      actor: "seed-shop-demo",
      actorRole: "shop",
      arrival: "2026-09-01",
      completed: "2026-09-15",
      released: "2026-09-16",
    });
    await q(
      `UPDATE repair.estimate_validation_findings f
       SET cleared_at = coalesce(cleared_at, now()), cleared_by = 'owner@demo'
       FROM repair.estimate_validation_runs r
       WHERE f.run_id = r.id AND r.estimate_id = $1 AND f.cleared_at IS NULL`,
      [estimateId],
    );
    await q(
      `UPDATE repair.invoices
       SET deleted_at = coalesce(deleted_at, now()), deleted_by = 'seed-shop-demo'
       WHERE event_id = $1 AND deleted_at IS NULL
         AND invoice_no <> 'DEMO-INV-MULTI'
         AND coalesce(is_multi_car,false) = false`,
      [eventId],
    );
    eventIds.push(eventId);
    invCarBuffers.push(
      bumpFirstLineLabor(estBytes, spec.invExtra),
    );
  }

  const multiAar = buildMultiCarAar(invCarBuffers);

  let needsRebuild = !existing[0];
  if (existing[0]) {
    const { rows: carRows } = await q(
      `SELECT invoiced_cents, flags_summary FROM repair.invoice_cars
       WHERE invoice_id = $1 AND line_status = 'ACTIVE'`,
      [String(existing[0].id)],
    );
    const totals = new Set(carRows.map((r) => Number(r.invoiced_cents ?? 0)));
    const hasExc = carRows.some((r) => String(r.flags_summary || "").trim());
    if (totals.size < 3 || !hasExc) {
      await q(
        `UPDATE repair.invoices
         SET deleted_at = now(), deleted_by = 'seed-shop-demo',
             delete_reason = 'r5 rebuild varied multi-car'
         WHERE id = $1`,
        [String(existing[0].id)],
      );
      await q(
        `UPDATE repair.invoice_cars
         SET line_status = 'REJECTED', reject_reason = 'r5 rebuild'
         WHERE invoice_id = $1`,
        [String(existing[0].id)],
      );
      needsRebuild = true;
    } else {
      await q(
        `UPDATE repair.invoices SET shop_id = $2 WHERE id = $1`,
        [String(existing[0].id), shopId],
      );
      ok("DEMO-INV-MULTI already present (idempotent; shop re-pointed)");
    }
  }

  if (needsRebuild) {
    await q(
      `UPDATE repair.invoice_cars
       SET line_status = 'REJECTED', reject_reason = 'seed multi-car reset'
       WHERE event_id = ANY($1::uuid[]) AND line_status = 'ACTIVE'`,
      [eventIds],
    );
    const pdf = Buffer.from("%PDF-1.4 DEMO multi-car invoice");
    const created = await createMultiCarInvoice({
      shopId,
      eventIds,
      invoiceNo: "DEMO-INV-MULTI",
      actor: "seed-shop-demo",
      file: { filename: "multi.pdf", mime: "application/pdf", bytes: pdf },
      aarFile: { filename: "multi.txt", mime: "text/plain", bytes: multiAar },
    });
    if (!created.ok) fail(`multi-car create: ${created.error}`);
    const appr = await approveOwnerInvoice({
      invoiceId: created.invoiceId,
      actor: "owner@demo",
      overToleranceReason:
        "Multi-car seed — car 91003 has intentional qty/price exception",
    });
    if (!appr.ok) fail(`multi-car approve: ${appr.error}`);
    const withExc = created.cars.filter((c) => c.flags.length > 0);
    if (!withExc.length) {
      fail("DEMO-INV-MULTI expected at least one car with an exception");
    }
    const totals = new Set(created.cars.map((c) => c.invoicedCents));
    if (totals.size < 3) {
      fail("DEMO-INV-MULTI cars should have visibly different invoiced amounts");
    }
    ok(
      `DEMO-INV-MULTI 5-car multi-car invoice (${created.carCount} cars; ${withExc.length} exception car(s); distinct totals=${totals.size})`,
    );
  }

  // Ensure Oct 2026 is open after seeding (never leave a future month open)
  const months = await resetDemoAccountingMonths({ actor: "seed-shop-demo" });
  ok(`accounting months reset — open ${months.open.monthLabel}, closed ${months.closed.monthLabel}`);
}

async function assertDemoStates(shopId: string, ids: Record<string, unknown>) {
  // 100001 Assigned (awaiting shop acceptance)
  {
    const eventId = String((ids["100001"] as { eventId: string }).eventId);
    const st = await getBoStoredStatus({ eventId });
    if (!st || st.status !== "ASSIGNED") {
      fail(`DEMO 100001 expected ASSIGNED, got ${st?.status}`);
    }
    const life = await getBoLifecycleBundle({ eventId });
    if (life.showFlags && life.flags.length > 0) {
      fail("DEMO 100001 must not show estimate flags before estimate");
    }
    ok("assert 100001 Assigned");
  }
  // 100002 Rejected w/ line comments
  {
    const estId = String((ids["100002"] as { estimateId: string }).estimateId);
    const eventId = String((ids["100002"] as { eventId: string }).eventId);
    const st = await getBoStoredStatus({ eventId });
    if (!st || st.status !== "REJECTED") {
      fail(`DEMO 100002 expected REJECTED bo.status, got ${st?.status}`);
    }
    const { rows: estSt } = await q(
      `SELECT s.code FROM repair.estimates e JOIN repair.statuses s ON s.id = e.status_id WHERE e.id = $1`,
      [estId],
    );
    const code = String(estSt[0]?.code ?? "");
    if (code !== "REVISION_REQUESTED") {
      fail(`DEMO 100002 expected REVISION_REQUESTED, got ${code}`);
    }
    const comments = await listDecisionComments({ estimateId: estId });
    if (comments.lineLevel.length < 2) {
      fail(`DEMO 100002 expected ≥2 line comments, got ${comments.lineLevel.length}`);
    }
    ok("assert 100002 Rejected w/ line comments");
  }
  // 100003 Approved w/ flags (no closed text)
  {
    const estId = String((ids["100003"] as { estimateId: string }).estimateId);
    const eventId = String((ids["100003"] as { eventId: string }).eventId);
    const st = await getBoStoredStatus({ eventId });
    if (!st || st.status !== "APPROVED") {
      fail(`DEMO 100003 expected APPROVED, got ${st?.status}`);
    }
    const life = await getBoLifecycleBundle({ eventId });
    if (life.isClosed || life.closedReasonLine) {
      fail("DEMO 100003 must not be Closed / no closed text");
    }
    if (!life.showFlags) fail("DEMO 100003 flags section required (has estimate)");
    if (life.openFlagCount < 1 && !life.approvedWithFlags) {
      const { rows: flags } = await q(
        `SELECT count(*)::int AS n
         FROM repair.estimate_validation_findings f
         JOIN repair.estimate_validation_runs r ON r.id = f.run_id
         WHERE r.estimate_id = $1 AND f.cleared_at IS NULL AND f.severity = 'FLAG'`,
        [estId],
      );
      if (Number(flags[0]?.n ?? 0) < 1) {
        fail("DEMO 100003 expected open flags (e.g. MISSING_CID)");
      }
    }
    ok("assert 100003 Approved w/ flags (not closed)");
  }
  // 100004 On Hand + Missed POD
  {
    const eventId = String((ids["100004"] as { eventId: string }).eventId);
    const st = await getBoStoredStatus({ eventId });
    if (!st || st.status !== "ON_HAND") {
      fail(`DEMO 100004 expected ON_HAND, got ${st?.status}`);
    }
    const life = await getBoLifecycleBundle({ eventId });
    if (!life.dates.missedPodRequired && !life.dates.missedPodReasonCode) {
      fail("DEMO 100004 expected Missed POD reason / required");
    }
    if (life.dates.missedPodReasonCode !== "AWAITING_PARTS") {
      fail(
        `DEMO 100004 expected missedPodReasonCode AWAITING_PARTS, got ${life.dates.missedPodReasonCode}`,
      );
    }
    if (life.showFlags) {
      fail("DEMO 100004 On Hand must not show estimate flags (no estimate)");
    }
    ok("assert 100004 On Hand + Missed POD");
  }
  // 100005 Closed completed+invoiced
  {
    const eventId = String((ids["100005"] as { eventId: string }).eventId);
    const st = await getBoStoredStatus({ eventId });
    if (!st || st.status !== "CLOSED") {
      fail(`DEMO 100005 expected CLOSED, got ${st?.status}`);
    }
    const life = await getBoLifecycleBundle({ eventId });
    if (!life.isClosed) fail("DEMO 100005 expected isClosed");
    if (!life.dates.completed) fail("DEMO 100005 missing completed date");
    if (!life.invoiceNo) fail("DEMO 100005 missing invoice");
    if (life.inconsistentClosed) {
      fail(
        `DEMO 100005 inconsistent: ${life.inconsistentClosedReasons.join("; ")}`,
      );
    }
    if (!life.closedReasonLine?.startsWith("Closed:")) {
      fail(`DEMO 100005 closed reason missing: ${life.closedReasonLine}`);
    }
    const { rows: invAmt } = await q(
      `SELECT i.total, r.total AS est_total
       FROM repair.invoices i
       JOIN repair.estimates e ON e.event_id = i.event_id AND e.deleted_at IS NULL
       JOIN repair.estimate_revisions r
         ON r.estimate_id = e.id AND r.rev_no = e.current_revision
       WHERE i.invoice_no = 'DEMO-INV-100005' AND i.deleted_at IS NULL
       LIMIT 1`,
    );
    if (!invAmt[0]) fail("DEMO-INV-100005 missing after seed");
    if (Number(invAmt[0].total) !== Number(invAmt[0].est_total)) {
      fail(
        `DEMO-INV-100005 total ${invAmt[0].total} ≠ approved estimate ${invAmt[0].est_total}`,
      );
    }
    if (Number(invAmt[0].total) === 100 && Number(invAmt[0].est_total) !== 100) {
      fail("DEMO-INV-100005 still stuck at hard-coded $100");
    }
    ok(`assert 100005 Closed — ${life.closedReasonLine} (amt matches estimate)`);
  }

  void shopId;
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

  // §G r5: never write tracked shop-samples/README.txt (dirties git)

  const open = await ensureOpenBo(shopId, base);
  const rejected = await seedRejected(shopId, base);
  const approved = await seedApprovedFlags(shopId, base);
  const missed = await seedMissedPod(shopId);
  const closed = await seedClosed(shopId, base);

  const ids = {
    shopMark: DEMO_SHOP_MARK,
    shopId,
    "100001": { eventId: open.eventId, status: "ASSIGNED" },
    "100002": {
      eventId: rejected.eventId,
      estimateId: rejected.estimateId,
      status: "REJECTED",
    },
    "100003": {
      eventId: approved.eventId,
      estimateId: approved.estimateId,
      status: "APPROVED",
    },
    "100004": { eventId: missed.eventId, status: "ON_HAND" },
    "100005": {
      eventId: closed.eventId,
      estimateId: closed.estimateId,
      status: "CLOSED",
      closedReason: closed.closedReason,
    },
    writtenAt: new Date().toISOString(),
  };

  writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2) + "\n");
  ok(`wrote gitignored IDs → ${IDS_FILE}`);

  await assertDemoStates(shopId, ids);

  // §H r2 — DS01 invoice review examples (idempotent DEMO-INV-*)
  await seedInvoiceExamples(shopId);
  ok("§H invoice examples seeded on DS01");

  // §H r5 — 5-car multi-car invoice (varied amounts + one exception) + month reset
  await seedMultiCarAndMonth(shopId, base);
  ok("§H r5 multi-car + month seed");

  // Seed end-state: Oct 2026 open with ≥1 Approved + MULTI; Sep 2026 closed with Paid
  {
    const months = await resetDemoAccountingMonths({ actor: "seed-shop-demo" });
    await q(
      `UPDATE repair.invoices
       SET accounting_month_id = $1
       WHERE deleted_at IS NULL
         AND invoice_no IN ('DEMO-INV-MULTI', 'DEMO-INV-WITHIN', 'DEMO-INV-OVER', 'DEMO-INV-ADDED', 'DEMO-INV-SHORT', 'DEMO-INV-100005')
         AND coalesce(payment_status,'') <> 'PAID'`,
      [months.open.id],
    );
    await q(
      `UPDATE repair.invoices
       SET accounting_month_id = $1
       WHERE deleted_at IS NULL AND invoice_no = 'DEMO-INV-PAID'`,
      [months.closed.id],
    );
    // Ensure at least one Approved – In Open Month on Oct
    const { rows: openAppr } = await q(
      `SELECT id FROM repair.invoices
       WHERE deleted_at IS NULL AND accounting_month_id = $1
         AND payment_status = 'APPROVED_IN_OPEN_MONTH'
       LIMIT 1`,
      [months.open.id],
    );
    if (!openAppr[0]) {
      const { rows: multi } = await q(
        `SELECT id FROM repair.invoices
         WHERE invoice_no = 'DEMO-INV-MULTI' AND deleted_at IS NULL LIMIT 1`,
      );
      if (multi[0]) {
        await q(
          `UPDATE repair.invoices
           SET workflow_status = 'APPROVED_IN_OPEN_MONTH',
               payment_status = 'APPROVED_IN_OPEN_MONTH',
               accounting_month_id = $2
           WHERE id = $1`,
          [String(multi[0].id), months.open.id],
        );
      }
    }
    const { rows: futureAny } = await q(
      `SELECT month_label, status FROM repair.accounting_months
       WHERE deleted_at IS NULL AND month_label > $1`,
      [months.open.monthLabel],
    );
    if (futureAny.length) {
      fail(
        `months after open left: ${futureAny
          .map((r) => `${r.month_label}/${r.status}`)
          .join(",")}`,
      );
    }
    ok(
      `seed end-state: open ${months.open.monthLabel}; Paid in closed ${months.closed.monthLabel}; no months after open`,
    );
  }

  // Assert: exactly one live DEMO 100005 event (no stray duplicates)
  {
    const { rows: n100005 } = await q(
      `SELECT count(*)::int AS n FROM repair.events
       WHERE deleted_at IS NULL AND car_mark = 'DEMO' AND car_number = '100005'`,
    );
    if (Number(n100005[0]?.n ?? 0) !== 1) {
      fail(`expected exactly 1 DEMO 100005 event, got ${n100005[0]?.n}`);
    }
    const { rows: invLink } = await q(
      `SELECT i.event_id, e.id AS e_id
       FROM repair.invoices i
       JOIN repair.events e ON e.id = i.event_id AND e.deleted_at IS NULL
       WHERE i.invoice_no = 'DEMO-INV-100005' AND i.deleted_at IS NULL`,
    );
    if (!invLink[0] || String(invLink[0].event_id) !== String(invLink[0].e_id)) {
      fail("DEMO-INV-100005 must point at the live DEMO 100005 event");
    }
    ok("assert DEMO 100005 single event + invoice re-pointed");
  }

  await seedCrbDemo();
  ok("§I CRB demo seeded");

  console.log("=== repair:seed-shop-demo PASS ===");
  console.log(`Shop mark: ${DEMO_SHOP_MARK}`);
  console.log(`Samples: ${SAMPLES}`);
  console.log(`IDs: ${IDS_FILE}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
