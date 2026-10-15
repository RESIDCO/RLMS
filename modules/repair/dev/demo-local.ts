/**
 * Local end-to-end Phase 1 demo (one command: npm run repair:demo:local).
 *
 * Fresh local Postgres → repair migrations → seed OFOX 528313 + sample 500-byte
 * → walk BO → estimate load (MULTI_CAR warning) → revision → approval → Resp 6
 * lessee approve-by-link → completion + dispo → shop CRB invoice + pre-pay audit
 * → Ready to Close → close → monthly close → CRIPYYMM export.
 *
 * Prints each step, status, links, and dev-adapter emails. Writes export + step
 * log under modules/repair/dev/demo-output/ (override with REPAIR_DEMO_OUT).
 *
 * Requires: DATABASE_URL pointing at local Postgres.
 * Migrate runs via node-pg inside TypeScript (no shell `$DATABASE_URL`, no psql).
 * Windows: see docs/repair/PHASE1_DEMO_WINDOWS.md
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createBadOrder } from "../services/bo";
import { issueEventLink } from "../services/event-links";
import { shopAccept, shopOnHand } from "../services/shop-actions";
import { shopArrivalDate } from "../services/bo-lifecycle";
import {
  submitForApproval,
  approveEstimate,
  listRevisions,
} from "../services/estimates";
import {
  loadEstimateAar,
  decideEstimateLoadWarnings,
} from "../services/estimate-load";
import {
  sendLesseeApprovalRequest,
  approveViaLesseeLink,
} from "../services/lessee-approval";
import { enterPodErd } from "../services/pod";
import { setCompletedDate } from "../services/completion";
import { relayDispo } from "../services/dispo";
import {
  submitShopCrbInvoice,
  decideInvoiceReview,
  listPrepayChecks,
} from "../services/inbound-invoice-audit";
import { maybeMarkReadyToClose, closeEvent } from "../services/close";
import { runMonthlyClose } from "../services/monthly-close";
import { upsertContact } from "../services/contacts";
import { upsertBilledPartyMapping } from "../services/billed-party-map";
import { voidEstimate } from "../services/bo-lifecycle";
import { restoreVoidedEstimate } from "../services/gap-lifecycle-06";
import { parseAarFile } from "../services/aar-parser";
import { migrateLocal } from "./migrate-local";
import { assertDemoTotals, sourceFileTotals } from "./demo-totals";
import { assertAtMostTwoDecimals, formatCentsAsDollars } from "../services/money";
import {
  getEmailProvider,
  setEmailProvider,
  type EmailProvider,
  type OutboundEmail,
  type EmailSendResult,
} from "../providers/email";
import { DEFAULT_TENANT_ID, q } from "../db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePath = join(__dirname, "reference/Sample_Shop_500byte_OFOX2609.txt");
const outDir =
  process.env.REPAIR_DEMO_OUT?.trim() ||
  join(__dirname, "demo-output");

type StepRecord = {
  step: number;
  name: string;
  status: string;
  details: Record<string, unknown>;
  at: string;
};

const steps: StepRecord[] = [];
const capturedEmails: Array<OutboundEmail & { id: string }> = [];

class CaptureEmailProvider implements EmailProvider {
  constructor(private inner: EmailProvider) {}
  async send(message: OutboundEmail): Promise<EmailSendResult> {
    const result = await this.inner.send(message);
    capturedEmails.push({ ...message, id: result.providerMessageId });
    return result;
  }
}

function banner(msg: string) {
  console.log("\n" + "=".repeat(72));
  console.log(msg);
  console.log("=".repeat(72));
}

function logStep(
  step: number,
  name: string,
  status: string,
  details: Record<string, unknown> = {},
) {
  const rec: StepRecord = {
    step,
    name,
    status,
    details,
    at: new Date().toISOString(),
  };
  steps.push(rec);
  console.log(`\n[${step}] ${name}`);
  console.log(`    status: ${status}`);
  for (const [k, v] of Object.entries(details)) {
    const rendered =
      typeof v === "string" ? v : JSON.stringify(v, null, 2).replace(/\n/g, "\n    ");
    console.log(`    ${k}: ${rendered}`);
  }
}

function recentEmails(sinceCount: number) {
  return capturedEmails.slice(sinceCount).map((e) => ({
    id: e.id,
    type: e.type,
    to: e.to,
    subject: e.subject,
    bodyPreview: e.bodyText.slice(0, 240),
  }));
}

async function seedOfox528313() {
  await q(
    `INSERT INTO public.railcars (id, car_number, car_initial, reporting_marks, active, assignment_label, lessee_name)
     VALUES (528313, '528313', 'OFOX', 'OFOX', true, 'DEMO-OFOX', 'Demo Lessee')
     ON CONFLICT (id) DO UPDATE
       SET car_initial = 'OFOX', car_number = '528313', active = true,
           assignment_label = 'DEMO-OFOX', lessee_name = 'Demo Lessee'`,
  );
  await q(
    `INSERT INTO public.v_valid_export_rows_data
       (export_src, export_id, car_initial, car_number, active, rider, assignment, assignment_id, lessee, start_date, end_date)
     SELECT 1, 528313, 'OFOX', '528313', 1, 'R-OFOX', 'DEMO-OFOX', 'A-OFOX', 'Demo Lessee', '2026-01-01', NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM public.v_valid_export_rows_data
       WHERE car_initial = 'OFOX' AND car_number = '528313'
     )`,
  );
}

async function apaShopId(): Promise<string> {
  const { ensureDemoShop } = await import("../services/shops");
  return ensureDemoShop({
    mark: "APA",
    legalName: "Apache Railway Shop",
    city: "Snowflake",
    state: "AZ",
    splc: "859370",
    actor: "demo:local",
  });
}

/** Build a two-car Format-1 file to trigger MULTI_CAR WARNING. */
function multiCarFile(sample: Buffer): Buffer {
  const parsed = parseAarFile(sample);
  const detail = parsed.lines.find((l) => l.recordFormat === "1");
  if (!detail) throw new Error("sample missing Format 1 detail");
  const line1 =
    detail.rawLine.slice(0, 47) + "OFOX" + "528313" + detail.rawLine.slice(57);
  const line2 =
    detail.rawLine.slice(0, 47) + "ARSX" + "100001" + detail.rawLine.slice(57);
  return Buffer.from([line1, line2].join("\r\n"), "latin1");
}

async function runMigrate() {
  banner("Migrate (local stubs + repair schema via node-pg)");
  await migrateLocal();
}

async function resetRepairSchema() {
  if (process.env.REPAIR_DEMO_RESET === "0") {
    console.log("REPAIR_DEMO_RESET=0 — skipping DROP SCHEMA repair");
    return;
  }
  banner("Reset repair schema (local only)");
  await q(`DROP SCHEMA IF EXISTS repair CASCADE`);
  console.log("Dropped schema repair (if present)");
}

async function main() {
  if (!process.env.DATABASE_URL && !process.env.REPAIR_DATABASE_URL) {
    throw new Error(
      "Set DATABASE_URL (e.g. postgresql://repairdev:repairdev@127.0.0.1:5432/rlms_repair_dev)",
    );
  }
  process.env.REPAIR_LOCAL_DB = process.env.REPAIR_LOCAL_DB ?? "1";

  mkdirSync(outDir, { recursive: true });
  if (existsSync(join(outDir, "step-log.json"))) {
    rmSync(join(outDir, "step-log.json"), { force: true });
  }

  setEmailProvider(new CaptureEmailProvider(getEmailProvider()));

  banner("RLMS Repair Phase 1 — local demo");
  console.log(`Output folder: ${outDir}`);
  console.log(`DATABASE_URL host: ${(process.env.DATABASE_URL ?? "").replace(/:[^:@/]+@/, ":***@")}`);

  // Need a live connection before DROP; migrate recreates everything.
  await resetRepairSchema();
  // After DROP, pool still works; migrate recreates public stubs + repair.
  await runMigrate();

  const sampleBytes = readFileSync(samplePath);
  const sourceTotals = sourceFileTotals(sampleBytes);
  await seedOfox528313();
  const shopId = await apaShopId();

  await q(
    `UPDATE repair.tenants
     SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
       'carOwnerMark', 'OFOX',
       'crbPaymentTermsDays', 30,
       'crbTaxpayerId', ''
     )
     WHERE id = $1`,
    [DEFAULT_TENANT_ID],
  );

  await upsertContact({
    partyType: "lessee",
    partyRef: "LSEE",
    name: "Demo Lessee Co",
    email: "lessee@demo.local",
    actor: "demo",
  });
  await upsertContact({
    partyType: "other",
    partyRef: "REV",
    name: "Demo Reviewer",
    email: "reviewer@demo.local",
    actor: "demo",
  });
  await upsertContact({
    partyType: "shop",
    partyRef: "APA",
    name: "APA Shop Contact",
    email: "shop@demo.local",
    actor: "demo",
  });
  // Seed module user_roles so "reviewers" / "owner_users" notify roles resolve
  await q(
    `INSERT INTO repair.users (id, tenant_id, email, display_name, created_by)
     VALUES
       ('00000000-0000-4000-8000-0000000000a1', $1, 'reviewer@demo.local', 'Demo Reviewer', 'demo'),
       ('00000000-0000-4000-8000-0000000000a2', $1, 'owner@demo.local', 'Demo Owner', 'demo')
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
    [DEFAULT_TENANT_ID],
  ).catch(async () => {
    await q(
      `INSERT INTO repair.users (tenant_id, email, display_name, created_by)
       SELECT $1, x.email, x.name, 'demo'
       FROM (VALUES
         ('reviewer@demo.local', 'Demo Reviewer'),
         ('owner@demo.local', 'Demo Owner')
       ) AS x(email, name)
       WHERE NOT EXISTS (
         SELECT 1 FROM repair.users u WHERE u.tenant_id = $1 AND lower(u.email) = lower(x.email)
       )`,
      [DEFAULT_TENANT_ID],
    );
  });
  await q(
    `INSERT INTO repair.user_roles (tenant_id, user_id, role, created_by)
     SELECT $1, u.id, r.role, 'demo'
     FROM repair.users u
     CROSS JOIN (VALUES ('reviewer'), ('fleet_manager')) AS r(role)
     WHERE u.tenant_id = $1 AND lower(u.email) = 'reviewer@demo.local'
       AND NOT EXISTS (
         SELECT 1 FROM repair.user_roles ur
         WHERE ur.user_id = u.id AND ur.role = r.role AND ur.deleted_at IS NULL
       )`,
    [DEFAULT_TENANT_ID],
  ).catch(() => undefined);

  const map = await upsertBilledPartyMapping({
    carMark: "OFOX",
    carNumber: "528313",
    leaseRider: "R-OFOX",
    partyRole: "LESSEE",
    billedPartyMark: "LSEE",
    actor: "demo",
  });
  if (!map.ok) throw new Error(map.error);

  let emailMark = capturedEmails.length;

  // ── 1. Bad Order ───────────────────────────────────────────────────
  const bo = await createBadOrder({
    carMark: "OFOX",
    carNumber: "528313",
    shopId,
    actor: "admin@demo.local",
    shoppingReason: "Phase1 demo",
    boCity: "Houston",
    boState: "TX",
    source: "INTERNAL",
  });
  if (!bo.ok) throw new Error(bo.error);
  const eventId = String(bo.event.id);
  const shopLink = await issueEventLink({
    eventId,
    scope: "SHOP",
    actor: "admin@demo.local",
  });
  const shopToken = shopLink.token;
  const shopUrlPath = `/repair/e/${shopToken}`;
  logStep(1, "Bad Order created", "BO_CREATED", {
    eventId,
    car: "OFOX 528313",
    shop: "APA",
    shopLink: shopUrlPath,
    who: "admin (authenticated)",
    notifications: recentEmails(emailMark),
    note: "BO_CREATED notify uses contact bank / rules when recipients exist",
  });
  emailMark = capturedEmails.length;

  // Companion BO so multi-car load can attach both cars
  const bo2 = await createBadOrder({
    carMark: "ARSX",
    carNumber: "100001",
    shopId,
    actor: "admin@demo.local",
    shoppingReason: "Phase1 demo companion",
  });
  if (!bo2.ok) throw new Error(bo2.error);

  const acc = await shopAccept(shopToken, "shop@demo.local");
  if (!acc.ok) throw new Error(acc.error);
  const oh = await shopOnHand(shopToken, "shop@demo.local");
  if (!oh.ok) throw new Error(oh.error);
  const arrival = await shopArrivalDate(shopToken, "shop@demo.local", "2026-10-01");
  if (!arrival.ok) throw new Error(arrival.error);

  // ── 2. Estimate load with WARNING (MULTI_CAR) ──────────────────────
  const multi = multiCarFile(sampleBytes);
  const load1 = await loadEstimateAar({
    bytes: multi,
    filename: "demo-multi-car.dat",
    source: "UI",
    actor: "reviewer@demo.local",
  });
  if (!load1.ok || !load1.pendingWarnings) {
    throw new Error(
      `expected PENDING_WARNINGS MULTI_CAR, got ${JSON.stringify(load1)}`,
    );
  }
  logStep(2, "Estimate load — warnings pending", "PENDING_WARNINGS", {
    loadRunId: load1.loadRunId,
    warnings: load1.warnings,
    who: "reviewer (UI load, no preferred event)",
    notifications: recentEmails(emailMark),
  });
  emailMark = capturedEmails.length;

  const accepted = await decideEstimateLoadWarnings({
    loadRunId: load1.loadRunId,
    decision: "ACCEPT_WARNINGS",
    actor: "reviewer@demo.local",
    reason: "Demo: accept MULTI_CAR and load both cars",
  });
  if (!accepted.ok) throw new Error(JSON.stringify(accepted));
  const ofoxApplied = (
    "applied" in accepted ? accepted.applied ?? [] : []
  ).find(
    (a) =>
      String((a as { carMark?: string }).carMark) === "OFOX" &&
      String((a as { carNumber?: string }).carNumber) === "528313",
  ) as
    | { estimateId?: string; revisionId?: string; loadKind?: string; total?: number }
    | undefined;
  if (!ofoxApplied?.estimateId) {
    throw new Error(`OFOX 528313 not in applied cars: ${JSON.stringify(accepted)}`);
  }
  let estimateId = String(ofoxApplied.estimateId);
  logStep(3, "Warnings accepted — estimates loaded", "LOADED", {
    estimateId,
    loadKind: ofoxApplied.loadKind,
    total: ofoxApplied.total,
    appliedCount: "applied" in accepted ? accepted.applied?.length : 0,
    who: "reviewer",
  });

  // ── 3. Revision (single-car OFOX sample before approval) ───────────
  // Note: loadEstimateAar maps any email actor → shop_link for transitions;
  // Queued→AWAITING_APPROVAL is not allowed for shop_link. Pre-approval
  // revision is applied as UI/system actor. Post-approval shop re-upload
  // becomes Adjustment (see smoke-estimate-lifecycle) — shops still re-upload
  // via link after Approved.
  const revLoad = await loadEstimateAar({
    bytes: sampleBytes,
    filename: "Sample_Shop_500byte_OFOX2609.txt",
    source: "UI",
    eventId,
    actor: "demo-reviewer",
    actorName: "Demo Reviewer",
    comment: "Demo revision — single-car OFOX2609 sample (full totals)",
  });
  if (!revLoad.ok) throw new Error(JSON.stringify(revLoad));
  if (revLoad.pendingWarnings) {
    throw new Error("revision load unexpectedly pending warnings");
  }
  const revApplied = revLoad.applied?.[0] as
    | { estimateId?: string; revisionId?: string; loadKind?: string; total?: number }
    | undefined;
  if (revApplied?.estimateId) estimateId = String(revApplied.estimateId);
  const revs = await listRevisions(estimateId);
  assertAtMostTwoDecimals("step[4] revision total", revApplied?.total);
  logStep(4, "Revision uploaded (UI / pre-approval)", String(revApplied?.loadKind ?? "Revision"), {
    estimateId,
    revisionId: revApplied?.revisionId,
    revCount: revs.length,
    total: revApplied?.total,
    shopLink: shopUrlPath,
    who: "reviewer (UI). Shop re-upload post-Approved → Adjustment.",
    reviewUi: `/repair/estimates/${estimateId}`,
  });

  // ── 4. Submit + approve ────────────────────────────────────────────
  emailMark = capturedEmails.length;
  const { rows: estStatus } = await q(
    `SELECT s.code FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1`,
    [estimateId],
  );
  const beforeSubmit = String(estStatus[0]?.code ?? "");
  // Revision load may already have moved Queued → AWAITING_APPROVAL
  if (beforeSubmit === "QUEUED") {
    const sub = await submitForApproval({
      estimateId,
      actor: "reviewer@demo.local",
    });
    if (!sub.ok) throw new Error(sub.error);
  } else if (beforeSubmit !== "AWAITING_APPROVAL") {
    throw new Error(`Unexpected estimate status before approve: ${beforeSubmit}`);
  }
  const appr = await approveEstimate({
    estimateId,
    actor: "reviewer@demo.local",
  });
  if (!appr.ok) throw new Error(appr.error);
  const { rows: totRows } = await q(
    `SELECT id, rev_no, total FROM repair.estimate_revisions
     WHERE estimate_id = $1 ORDER BY rev_no DESC LIMIT 1`,
    [estimateId],
  );
  const revisionId = String(totRows[0].id);
  const estimateTotal = Number(totRows[0].total);
  assertAtMostTwoDecimals("step[5] approved estimate total", estimateTotal);
  logStep(5, "Estimate approved", "APPROVED", {
    estimateId,
    revisionId,
    revNo: totRows[0].rev_no,
    total: estimateTotal,
    who: "reviewer",
    reviewUi: `/repair/estimates/${estimateId}`,
    notifications: recentEmails(emailMark),
  });
  emailMark = capturedEmails.length;

  // ── 5. Resp 6 lessee approve-by-link ───────────────────────────────
  const sent = await sendLesseeApprovalRequest({
    eventId,
    estimateId,
    revisionId,
    lesseeEmail: "lessee@demo.local",
    actor: "reviewer@demo.local",
    note: "Phase 1 demo Resp 6 approval",
  });
  if (!sent.ok) throw new Error(sent.error);
  const lesseeUrlPath = sent.lesseeUrlPath ?? `/repair/lessee/${sent.token}`;
  logStep(6, "Resp 6 lessee email sent", "LESSEE_APPROVAL_SENT", {
    approvalId: sent.approval?.id,
    lesseeLink: lesseeUrlPath,
    recipients: sent.recipients,
    shopExcluded: true,
    attachments: sent.attachments,
    who: "reviewer → lessee (never shop)",
    notificationRule: "RESP6_LESSEE_EMAIL",
    emails: recentEmails(emailMark),
  });
  emailMark = capturedEmails.length;

  const viaLink = await approveViaLesseeLink({
    rawToken: sent.token,
    decision: "APPROVE",
  });
  if (!viaLink.ok) throw new Error(viaLink.error);
  logStep(7, "Lessee approved via link", "APPROVED", {
    channel: viaLink.channel,
    lesseeLink: lesseeUrlPath,
    who: "lessee via link (no login)",
    notificationRule: "LESSEE_DECISION_RECEIVED",
    emails: recentEmails(emailMark),
  });
  emailMark = capturedEmails.length;

  // ── 6. Completion + dispo ──────────────────────────────────────────
  const pod = await enterPodErd({
    rawToken: shopToken,
    kind: "POD",
    dateValue: "2026-10-20",
    enteredBy: "shop@demo.local",
  });
  if (!pod.ok) throw new Error(pod.error);
  const done = await setCompletedDate({
    rawToken: shopToken,
    completedAt: "2026-10-21",
    actor: "shop@demo.local",
  });
  if (!done.ok) throw new Error(done.error);
  const dispo = await relayDispo({
    eventId,
    direction: "to_shop",
    instructions: "Release empty to Houston",
    actor: "fleet@demo.local",
  });
  if (!dispo.ok) throw new Error(dispo.error);
  logStep(8, "Completion + POD + dispo", "COMPLETE + dispo on file", {
    pod: "2026-10-20",
    completedAt: "2026-10-21",
    dispo: "to_shop: Release empty to Houston",
    who: "shop (POD/complete via link); fleet/admin (dispo)",
    notificationRules: ["EVENT_COMPLETE", "DISPO"],
    emails: recentEmails(emailMark),
  });
  emailMark = capturedEmails.length;

  // ── 7. Shop CRB invoice + pre-pay audit ────────────────────────────
  const intake = await submitShopCrbInvoice({
    rawToken: shopToken,
    bytes: sampleBytes,
    filename: "Sample_Shop_500byte_OFOX2609.txt",
    mime: "text/plain",
    actorEmail: "shop@demo.local",
  });
  if (!intake.ok) throw new Error(intake.error);
  const invoiceId = String(intake.invoice.id);
  const checks = await listPrepayChecks(invoiceId);
  logStep(9, "Shop CRB invoice ingested", String(intake.reviewStatus), {
    invoiceId,
    matchStatus: intake.matchStatus,
    totalCents: intake.totalCents,
    invoiceNo: intake.invoice.invoice_no,
    invoiceNoBlank: intake.invoiceNoBlank,
    who: "shop via link (POST …/invoice-aar)",
    notificationRule: "INVOICE_PREPAY_REVIEW",
    prepayChecks: checks.map((c) => ({
      code: c.check_code,
      result: c.result,
    })),
    emails: recentEmails(emailMark),
  });
  emailMark = capturedEmails.length;

  const decision = await decideInvoiceReview({
    invoiceId,
    decision: "APPROVED_FOR_ACH",
    actor: "reviewer@demo.local",
  });
  if (!decision.ok) throw new Error(JSON.stringify(decision));
  logStep(10, "Pre-pay audit passed (APPROVED_FOR_ACH)", "APPROVED", {
    invoiceId,
    who: "reviewer",
    note: "ACH payment itself is outside RLMS; match_status stamped APPROVED",
  });

  // ── 8. Ready to Close → close ──────────────────────────────────────
  emailMark = capturedEmails.length;
  const rtc = await maybeMarkReadyToClose({
    eventId,
    actor: "system",
  });
  if (!rtc.ok) throw new Error(rtc.error);
  const { rows: evStat } = await q(
    `SELECT s.code FROM repair.events e
     JOIN repair.statuses s ON s.id = e.status_id WHERE e.id = $1`,
    [eventId],
  );
  const rtcCode = String(evStat[0]?.code ?? "");
  if (rtcCode !== "READY_TO_CLOSE") {
    throw new Error(`Expected READY_TO_CLOSE, found ${rtcCode} (${JSON.stringify(rtc)})`);
  }
  logStep(11, "Ready to Close", "READY_TO_CLOSE", {
    transitioned: rtc.transitioned,
    reason: "reason" in rtc ? rtc.reason : "invoice APPROVED + dispo (may already be RTC)",
    who: "system (MATCHED/APPROVED invoice + dispo)",
    notificationRule: "READY_TO_CLOSE",
    emails: recentEmails(emailMark),
  });
  emailMark = capturedEmails.length;

  const closed = await closeEvent({
    eventId,
    actor: "reviewer@demo.local",
    actorRole: "reviewer",
  });
  if (!closed.ok) throw new Error(closed.error);
  logStep(12, "Event closed (one-click)", "CLOSED", {
    eventId,
    who: "reviewer",
    notificationRule: "EVENT_CLOSED",
    emails: recentEmails(emailMark),
  });
  emailMark = capturedEmails.length;

  // ── 9. Monthly close + CRIPYYMM ────────────────────────────────────
  const accountMonth =
    process.env.REPAIR_DEMO_ACCOUNT_MONTH?.trim() ||
    (() => {
      const d = new Date();
      return `${String(d.getUTCFullYear()).slice(-2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    })();

  const close = await runMonthlyClose({
    accountMonth,
    actor: "reviewer@demo.local",
    exportDir: outDir,
  });
  if (!close.ok) throw new Error(close.error ?? JSON.stringify(close));
  logStep(13, "Monthly close + CRB export", "close_run complete", {
    accountMonth: close.accountMonth,
    filename: close.filename,
    localPath: close.localPath,
    billingParty: close.billingParty,
    eventCount: close.eventCount,
    invoiceCount: close.invoiceCount,
    laborCents: close.laborCents,
    materialCents: close.materialCents,
    validationOk: close.validation?.ok,
    who: "reviewer / billing",
    note: "Rebuttal invoices created in repair.rebuttal_invoices; no FTP",
  });

  // Totals smoke: approved = full source; CRIP = Resp 6/3 only (Resp 7 Never Rebill gap).
  const checked = await assertDemoTotals({
    estimateId,
    estimateTotalDollars: estimateTotal,
    source: sourceTotals,
    exportLaborCents: Number(close.laborCents ?? 0),
    exportMaterialCents: Number(close.materialCents ?? 0),
  });

  // Smoke: no revision labor/material/total has more than 2 decimal places.
  const { rows: moneyRows } = await q(
    `SELECT rev_no, labor, material, total
     FROM repair.estimate_revisions
     WHERE estimate_id = $1
     ORDER BY rev_no`,
    [estimateId],
  );
  for (const row of moneyRows) {
    assertAtMostTwoDecimals(`rev ${row.rev_no} labor`, row.labor);
    assertAtMostTwoDecimals(`rev ${row.rev_no} material`, row.material);
    assertAtMostTwoDecimals(`rev ${row.rev_no} total`, row.total);
  }
  const { rows: lineMoneyRows } = await q(
    `SELECT el.line_no, el.labor, el.material, el.total
     FROM repair.estimate_lines el
     JOIN repair.estimate_revisions r ON r.id = el.revision_id
     WHERE r.estimate_id = $1`,
    [estimateId],
  );
  for (const row of lineMoneyRows) {
    assertAtMostTwoDecimals(`line ${row.line_no} labor`, row.labor);
    assertAtMostTwoDecimals(`line ${row.line_no} material`, row.material);
    assertAtMostTwoDecimals(`line ${row.line_no} total`, row.total);
  }

  logStep(13.5, "Totals check (source / approved / export)", "ok", {
    sourceFileTotalCents: sourceTotals.allTotal,
    sourceFileTotalDollars: formatCentsAsDollars(sourceTotals.allTotal),
    approvedEstimateCents: checked.approvedCents,
    exportRebillableCents: checked.exportTotalCents,
    exportRebillableDollars: formatCentsAsDollars(checked.exportTotalCents),
    neverRebillResp7Cents: sourceTotals.neverRebillTotal,
    neverRebillResp7Dollars: formatCentsAsDollars(sourceTotals.neverRebillTotal),
    neverRebillLines: sourceTotals.neverRebillLines,
    moneyTwoDecimalsOk: true,
    note:
      "Export equals approved Resp 6/3 lines and source Resp 6/3. Full source " +
      "includes Resp 7 Never Rebill (excluded from CRIP by design). " +
      "All revision/line totals asserted ≤ 2 decimal places (integer cents).",
  });

  // ── 10. Retention demo (void + restore on companion) ───────────────
  const { rows: companionEst } = await q(
    `SELECT est.id FROM repair.estimates est
     JOIN repair.events e ON e.id = est.event_id
     WHERE e.id = $1 AND est.deleted_at IS NULL LIMIT 1`,
    [String(bo2.event.id)],
  );
  if (companionEst[0]) {
    const voidId = String(companionEst[0].id);
    const voided = await voidEstimate({
      estimateId: voidId,
      actor: "admin@demo.local",
      reason: "Demo void — retention never hard-deletes",
    });
    if (!voided.ok) throw new Error(voided.error);
    const restored = await restoreVoidedEstimate({
      estimateId: voidId,
      actor: "admin@demo.local",
      reason: "Demo restore",
    });
    if (!restored.ok) throw new Error(restored.error);
    logStep(14, "Retention: VOIDED + admin restore", "restored", {
      estimateId: voidId,
      who: "admin",
      note: "Shop link locked while VOIDED; nothing hard-deleted",
    });
  }

  // Persist artifacts
  const stepLogPath = join(outDir, "step-log.json");
  const summary = {
    tipHint: "Requires tip b29d0a5+ (integer cents money + migrate via node-pg)",
    car: "OFOX 528313",
    sampleFile: "modules/repair/dev/reference/Sample_Shop_500byte_OFOX2609.txt",
    eventId,
    estimateId,
    revisionId,
    invoiceId,
    shopLink: shopUrlPath,
    lesseeLink: lesseeUrlPath,
    reviewUi: `/repair/estimates/${estimateId}`,
    accountMonth,
    cripFilename: close.filename,
    cripPath: close.localPath,
    emails: capturedEmails.map((e) => ({
      id: e.id,
      type: e.type,
      to: e.to,
      subject: e.subject,
    })),
    steps,
  };
  writeFileSync(stepLogPath, JSON.stringify(summary, null, 2));

  banner("Demo complete");
  console.log(`Step log: ${stepLogPath}`);
  if (close.localPath) console.log(`CRIP export: ${close.localPath}`);
  console.log(`Emails captured (dev adapter): ${capturedEmails.length}`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        eventId,
        estimateId,
        shopLink: shopUrlPath,
        lesseeLink: lesseeUrlPath,
        cripFilename: close.filename,
        outDir,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("\nDemo failed:", err);
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, "step-log.json"),
      JSON.stringify({ ok: false, error: String(err), steps, emails: capturedEmails }, null, 2),
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});
