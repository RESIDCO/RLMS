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
import { parseAarFile } from "../services/aar-parser";
import { migrateLocal } from "./migrate-local";

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
     LIMIT 1`,
    [DEFAULT_TENANT_ID, DEMO_SHOP_MARK],
  );
  if (rows[0]) {
    await q(
      `UPDATE repair.shops SET is_smoke = false WHERE id = $1`,
      [rows[0].id],
    ).catch(() => undefined);
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

async function findDemoEvent(shopId: string, carNumber: string) {
  const { rows } = await q(
    `SELECT e.id AS event_id, est.id AS estimate_id, st.code AS estimate_status
     FROM repair.events e
     LEFT JOIN repair.estimates est
       ON est.event_id = e.id AND est.deleted_at IS NULL
     LEFT JOIN repair.statuses st ON st.id = est.status_id
     WHERE e.tenant_id = $1 AND e.deleted_at IS NULL
       AND e.car_mark = 'DEMO' AND e.car_number = $2 AND e.shop_id = $3
     ORDER BY e.created_at DESC LIMIT 1`,
    [DEFAULT_TENANT_ID, carNumber, shopId],
  );
  return rows[0] as
    | { event_id: string; estimate_id?: string; estimate_status?: string }
    | undefined;
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
      allowDuplicates: true,
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
      allowDuplicates: true,
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
      allowDuplicates: true,
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
      allowDuplicates: true,
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
      allowDuplicates: true,
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

  await q(
    `INSERT INTO repair.invoices
       (tenant_id, event_id, shop_id, invoice_no, total, match_status,
        workflow_status, created_by, decided_by, decided_at)
     SELECT $1, $2, $3, 'DEMO-INV-100005', 100.00, 'APPROVED',
            'ACCEPTED', 'seed-shop-demo', 'seed-shop-demo', now()
     WHERE NOT EXISTS (
       SELECT 1 FROM repair.invoices WHERE event_id = $2 AND deleted_at IS NULL
     )`,
    [DEFAULT_TENANT_ID, eventId, shopId],
  );

  const closed = await markBadOrderClosed({
    eventId,
    actor: "seed-shop-demo",
    tenantId: DEFAULT_TENANT_ID,
    invoiceNo: "DEMO-INV-100005",
    invoicedAt: "2026-07-22",
  });
  if (!closed.ok) fail(`100005 close failed: ${closed.error}`);
  ok(`Closed BO ${carMark} ${carNumber} — ${closed.closedReason}`);
  return { eventId, estimateId, closedReason: closed.closedReason };
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
    ok(`assert 100005 Closed — ${life.closedReasonLine}`);
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

  console.log("=== repair:seed-shop-demo PASS ===");
  console.log(`Shop mark: ${DEMO_SHOP_MARK}`);
  console.log(`Samples: ${SAMPLES}`);
  console.log(`IDs: ${IDS_FILE}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
