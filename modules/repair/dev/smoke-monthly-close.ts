/**
 * Smoke: Resp 6 approve-by-link, reply+reviewer confirm, monthly close, CRB validation.
 * Requires DATABASE_URL + migrated repair schema (incl. monthly_close migration).
 *
 * Run: npm run repair:smoke-monthly-close
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createBadOrder } from "../services/bo";
import { issueEventLink } from "../services/event-links";
import { shopAccept, shopOnHand } from "../services/shop-actions";
import { enterPodErd } from "../services/pod";
import { setCompletedDate } from "../services/completion";
import { acceptShopInvoice, submitShopInvoice } from "../services/invoices";
import { relayDispo } from "../services/dispo";
import { closeEvent, maybeMarkReadyToClose } from "../services/close";
import {
  ensureInvoiceOtpOff,
  sampleAarInvoiceFile,
  uploadSubmitAndApprove,
} from "./smoke-shared-setup";
import {
  sendLesseeApprovalRequest,
  approveViaLesseeLink,
  ingestLesseeReply,
  confirmLesseeReply,
  getLesseeViewForToken,
} from "../services/lessee-approval";
import { upsertContact, addAdhocEmails } from "../services/contacts";
import { runMonthlyClose } from "../services/monthly-close";
import { validateCripBytes } from "../services/crb-validate";
import { parseAarFile } from "../services/aar-parser";
import {
  getCarOwnerMark,
  resolveInboundShopMarks,
  softDeleteBilledPartyMapping,
  upsertBilledPartyMapping,
  listBilledPartyMappings,
} from "../services/billed-party-map";
import { DEFAULT_TENANT_ID, q } from "../db";

const samplePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "reference/Sample_Shop_500byte_OFOX2609.txt",
);

async function seedClosedEventWithResp6(opts: {
  carNumber: string;
  actor: string;
  withShopAar?: boolean;
}) {
  const { ensureDemoShop } = await import("../services/shops");
  const shopId = await ensureDemoShop({
    mark: "APA",
    legalName: "Apache Railway Shop",
    city: "Snowflake",
    state: "AZ",
    splc: "859370",
    actor: opts.actor,
  });
  await ensureInvoiceOtpOff(shopId);

  // Local VCF stub only seeds ARSX 100001 — reuse it for every smoke event.
  const bo = await createBadOrder({
    carMark: "ARSX",
    carNumber: "100001",
    rule: "RULE_1",
    source: "INTERNAL",
    actor: opts.actor,
    shopId,
  });
  if (!bo.ok) throw new Error(bo.error);
  const eventId = String(bo.event.id);

  const link = await issueEventLink({ eventId, scope: "SHOP", actor: opts.actor });
  const token = link.token;
  const acc = await shopAccept(token, "shop@smoke.invalid");
  if (!acc.ok) throw new Error(acc.error);
  const oh = await shopOnHand(token, "shop@smoke.invalid");
  if (!oh.ok) throw new Error(oh.error);

  const sampleBytes = opts.withShopAar ? readFileSync(samplePath) : undefined;
  const { estimateId, revisionId: uploadedRev } = await uploadSubmitAndApprove({
    eventId,
    rawToken: token,
    file: sampleBytes
      ? {
          filename: "Sample_Shop_500byte_OFOX2609.txt",
          mime: "text/plain",
          bytes: sampleBytes,
        }
      : undefined,
    lines: sampleBytes
      ? undefined
      : [
          {
            lineNo: 1,
            aarJobCode: "4800",
            labor: 100,
            material: 25,
            total: 125,
            respCode: "6",
            laborCents: 10000,
            materialCents: 2500,
            rawLine: null,
          },
          {
            lineNo: 2,
            aarJobCode: "4204",
            labor: 50,
            material: 10,
            total: 60,
            respCode: "1",
            laborCents: 5000,
            materialCents: 1000,
            rawLine: null,
          },
        ],
  });

  // If AAR sample uploaded, force at least one line to stay resp 6 (sample already has many)
  if (sampleBytes) {
    const parsed = parseAarFile(sampleBytes);
    const resp6 = parsed.lines.filter((l) => l.respCode === "6").length;
    if (resp6 < 1) throw new Error("sample fixture missing resp 6 lines");
  }

  let revisionId = uploadedRev;
  if (!revisionId) {
    const { rows: revRows } = await q(
      `SELECT id FROM repair.estimate_revisions
       WHERE estimate_id = $1 ORDER BY rev_no DESC LIMIT 1`,
      [estimateId],
    );
    revisionId = String(revRows[0]?.id ?? "");
  }
  if (!revisionId) throw new Error("missing revision after approve");

  await enterPodErd({
    rawToken: token,
    kind: "POD",
    dateValue: "2026-10-20",
    enteredBy: "shop@smoke.invalid",
  });
  const done = await setCompletedDate({
    rawToken: token,
    completedAt: "2026-10-21",
    actor: "shop@smoke.invalid",
  });
  if (!done.ok) throw new Error(done.error);

  // Invoice total must match approved final estimate total
  const { rows: tot } = await q(
    `SELECT total FROM repair.estimate_revisions
     WHERE estimate_id = $1 ORDER BY rev_no DESC LIMIT 1`,
    [estimateId],
  );
  const total = Number(tot[0].total);
  const inv = await submitShopInvoice({
    rawToken: token,
    invoiceNo: `INV-${opts.carNumber}`,
    total,
    actorEmail: "shop@smoke.invalid",
    file: {
      filename: "inv.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("%PDF-1.4 smoke"),
    },
    aarFile: sampleAarInvoiceFile(`inv-${opts.carNumber}.dat`),
  });
  if (!inv.ok) throw new Error(inv.error);

  // §G r4 / §H: close requires an accepted invoice
  const accepted = await acceptShopInvoice({
    invoiceId: String(inv.invoice.id),
    actor: "reviewer@smoke",
    note: "smoke monthly accept",
  });
  if (!accepted.ok) throw new Error(accepted.error);

  const dispo = await relayDispo({
    eventId,
    direction: "to_shop",
    instructions: "Release empty",
    actor: "fleet@smoke",
  });
  if (!dispo.ok) throw new Error(dispo.error);

  const rtc = await maybeMarkReadyToClose({ eventId, actor: opts.actor });
  if (!rtc.ok) throw new Error(rtc.error);
  const { rows: stRows } = await q(
    `SELECT s.code FROM repair.events e
     JOIN repair.statuses s ON s.id = e.status_id WHERE e.id = $1`,
    [eventId],
  );
  if (String(stRows[0]?.code) !== "CLOSED") {
    const closed = await closeEvent({
      eventId,
      actor: "reviewer@smoke",
      actorRole: "reviewer",
    });
    if (!closed.ok) throw new Error(closed.error);
  }

  return { eventId, estimateId, revisionId, shopToken: token, total };
}

async function main() {
  // Fixture: detail-only sample validates as extract (not full CRIP)
  const sampleBytes = readFileSync(samplePath);
  const sample = validateCripBytes(sampleBytes);
  if (!sample.warnings.includes("detail_only_extract")) {
    throw new Error("expected detail_only_extract warning on OFOX2609 sample");
  }
  if (!sample.ok) throw new Error(`sample validation errors: ${sample.errors.join("; ")}`);

  // Q14 inbound: shop file billing=shop mark, billed=car owner
  const sampleLine = sampleBytes.toString("latin1").split(/\r?\n/).find((l) => l.length === 500);
  if (!sampleLine) throw new Error("sample line missing");
  const inbound = resolveInboundShopMarks(sampleLine);
  if (!inbound || inbound.billingParty !== "APA" || inbound.billedParty !== "OFOX") {
    throw new Error(
      `inbound marks expected APA/OFOX, got ${JSON.stringify(inbound)}`,
    );
  }

  // Ensure fleet car-owner mark is configured (tenant setting — not hard-coded in app logic)
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
  // Prior smoke runs leave billing period 2610 closed — reopen for isolation
  await q(
    `UPDATE repair.billing_periods
     SET status = 'open', closed_at = NULL, closed_by = NULL
     WHERE tenant_id = $1 AND account_month = '2610'`,
    [DEFAULT_TENANT_ID],
  );
  // Lock leftover unlocked CLOSED events so collectRebillEvents only sees
  // the events this smoke seeds (otherwise missing-map checks are polluted).
  await q(
    `UPDATE repair.events e
     SET billing_locked_at = coalesce(e.billing_locked_at, now())
     FROM repair.statuses s
     WHERE e.status_id = s.id
       AND e.tenant_id = $1
       AND e.deleted_at IS NULL
       AND e.billing_locked_at IS NULL
       AND s.code = 'CLOSED'`,
    [DEFAULT_TENANT_ID],
  );
  const owner = await getCarOwnerMark();
  if (!owner.ok) throw new Error(owner.error);

  // Ensure billed-party mapping exists (Q15)
  const maps = await listBilledPartyMappings({ partyRole: "LESSEE" });
  let mappingId = maps.find(
    (m) =>
      String(m.car_mark).toUpperCase() === "ARSX" && String(m.car_number) === "100001",
  )?.id;
  if (!mappingId) {
    const created = await upsertBilledPartyMapping({
      carMark: "ARSX",
      carNumber: "100001",
      leaseRider: "R1",
      partyRole: "LESSEE",
      billedPartyMark: "LSEE",
      actor: "smoke-mc",
    });
    if (!created.ok) throw new Error(created.error);
    mappingId = String(created.mapping.id);
  }

  await upsertContact({
    partyType: "lessee",
    partyRef: "LSEE",
    name: "Smoke Lessee Co",
    email: "lessee@smoke.invalid",
    actor: "smoke-mc",
  });

  // ── Event A: approve via link ──────────────────────────────────────
  const a = await seedClosedEventWithResp6({
    carNumber: "200001",
    actor: "smoke-mc",
    withShopAar: false,
  });
  await addAdhocEmails({
    eventId: a.eventId,
    emails: ["adhoc-lessee@smoke.invalid"],
    notificationType: "RESP6_LESSEE_EMAIL",
    actor: "smoke-mc",
  });

  const sentA = await sendLesseeApprovalRequest({
    eventId: a.eventId,
    estimateId: a.estimateId,
    revisionId: a.revisionId,
    actor: "reviewer@smoke",
  });
  if (!sentA.ok) throw new Error(sentA.error);
  if (!sentA.recipients.every((e) => !e.includes("shop@"))) {
    throw new Error("shop leaked into Resp 6 recipients");
  }
  if (!sentA.attachments.included500Byte && !sentA.attachments.usedGeneratedPdf) {
    // 500-byte may be absent if no raw lines — generated PDF covers estimate; still require attempt
  }
  // Manual lines had no raw_line → ensureMatching500Byte returns null; PDF generated
  if (!sentA.attachments.usedGeneratedPdf) {
    throw new Error("expected generated PDF when shop sent no PDF");
  }

  const view = await getLesseeViewForToken(sentA.token);
  if (!view) throw new Error("lessee view missing");
  if (!(view.lines as Array<{ resp_code?: string }>).every((l) => String(l.resp_code) === "6")) {
    throw new Error("lessee view must show Resp 6 lines only");
  }

  const viaLink = await approveViaLesseeLink({
    rawToken: sentA.token,
    decision: "APPROVE",
    respondentName: "Smoke Lessee",
    respondentEmail: "lessee@smoke.invalid",
  });
  if (!viaLink.ok) throw new Error(viaLink.error);
  if (viaLink.channel !== "url") throw new Error("expected url channel");

  const { rows: decA } = await q(
    `SELECT * FROM repair.lessee_approval_decisions WHERE approval_id = $1`,
    [sentA.approval.id],
  );
  if (!decA[0] || decA[0].decision !== "APPROVED" || decA[0].channel !== "url") {
    throw new Error("append-only decision row missing for link approve");
  }

  // ── Event B: email reply + reviewer confirm ────────────────────────
  const b = await seedClosedEventWithResp6({
    carNumber: "200002",
    actor: "smoke-mc",
    withShopAar: true,
  });
  const sentB = await sendLesseeApprovalRequest({
    eventId: b.eventId,
    estimateId: b.estimateId,
    revisionId: b.revisionId,
    lesseeEmail: "lessee@smoke.invalid",
    actor: "reviewer@smoke",
  });
  if (!sentB.ok) throw new Error(sentB.error);
  if (!sentB.attachments.included500Byte) {
    throw new Error("expected matching 500-byte attachment from shop AAR upload");
  }

  const reply = await ingestLesseeReply({
    approvalId: String(sentB.approval.id),
    bodyText: "APPROVE — looks good",
    actor: "lessee@smoke.invalid",
  });
  if (!reply.ok) throw new Error(reply.error);
  if (reply.approval.status !== "REPLY_RECEIVED") {
    throw new Error("expected REPLY_RECEIVED");
  }

  const confirmed = await confirmLesseeReply({
    approvalId: String(sentB.approval.id),
    accept: true,
    decision: "APPROVE",
    actor: "reviewer@smoke",
  });
  if (!confirmed.ok) throw new Error(confirmed.error);
  if (confirmed.channel !== "email_reply") throw new Error("expected email_reply channel");

  // ── Missing mapping blocks export (Q15) ────────────────────────────
  // Soft-delete every active LESSEE mapping that could resolve ARSX 100001
  // (car key and that car's lease_rider fallback — prior runs may leave extras).
  const { rows: riderRows } = await q(
    `SELECT lease_rider FROM repair.cars_ref
     WHERE upper(car_mark)='ARSX' AND car_number='100001' LIMIT 1`,
  ).catch(() => ({ rows: [] as Array<{ lease_rider?: string }> }));
  const leaseRider = riderRows[0]?.lease_rider
    ? String(riderRows[0].lease_rider)
    : null;
  const activeMaps = await listBilledPartyMappings({
    partyRole: "LESSEE",
    includeInactive: false,
  });
  for (const m of activeMaps) {
    const carHit =
      String(m.car_mark ?? "").toUpperCase() === "ARSX" &&
      String(m.car_number ?? "") === "100001";
    const riderHit =
      leaseRider != null &&
      String(m.lease_rider ?? "") === leaseRider &&
      (m.car_mark == null || m.car_number == null);
    if (carHit || riderHit || String(m.id) === String(mappingId)) {
      const deactivated = await softDeleteBilledPartyMapping({
        id: String(m.id),
        actor: "smoke-mc",
        reason: "smoke missing-mark check",
      });
      if (!deactivated.ok) throw new Error(deactivated.error);
    }
  }
  const blocked = await runMonthlyClose({
    accountMonth: "2610",
    actor: "reviewer@smoke",
    exportDir: join(dirname(fileURLToPath(import.meta.url)), "exports"),
  });
  if (blocked.ok || blocked.status !== 422 || !("missing" in blocked)) {
    throw new Error(
      `expected export blocked when billed-party mapping missing: ${JSON.stringify(blocked)}`,
    );
  }

  // Restore mapping
  const restored = await upsertBilledPartyMapping({
    carMark: "ARSX",
    carNumber: "100001",
    leaseRider: "R1",
    partyRole: "LESSEE",
    billedPartyMark: "LSEE",
    actor: "smoke-mc",
  });
  if (!restored.ok) throw new Error(restored.error);

  // ── Monthly close + CRIP validation ────────────────────────────────
  const close = await runMonthlyClose({
    accountMonth: "2610",
    actor: "reviewer@smoke",
    exportDir: join(dirname(fileURLToPath(import.meta.url)), "exports"),
  });
  if (!close.ok) throw new Error(close.error ?? "close failed");
  if (!close.validation?.ok) {
    throw new Error(`CRIP validation failed: ${close.validation?.errors.join("; ")}`);
  }
  if (!close.filename?.startsWith("CRIP2610")) {
    throw new Error(`unexpected filename ${close.filename}`);
  }
  if (close.billingParty !== owner.mark) {
    throw new Error(
      `outbound billing party ${close.billingParty} != tenant carOwnerMark ${owner.mark}`,
    );
  }
  if (close.accountMonth !== "2610") {
    throw new Error("close run must stamp account month 2610");
  }

  const fileBytes = readFileSync(close.localPath!);
  const revalidate = validateCripBytes(fileBytes);
  if (!revalidate.ok || !revalidate.isCompleteCrip) {
    throw new Error(`revalidate failed: ${revalidate.errors.join("; ")}`);
  }
  // Cols 2-5 = car owner (outbound); cols 6-9 = mapped lessee
  const first = fileBytes.toString("latin1").slice(0, 500);
  if (first.slice(1, 5).trim() !== owner.mark.trim()) {
    throw new Error(
      `billing party cols 2-5 expected ${owner.mark}, got ${JSON.stringify(first.slice(1, 5))}`,
    );
  }
  if (first.slice(5, 9).trim() !== "LSEE") {
    throw new Error(
      `billed party cols 6-9 expected LSEE from mapping, got ${JSON.stringify(first.slice(5, 9))}`,
    );
  }

  const { rows: locked } = await q(
    `SELECT COUNT(*)::int AS n FROM repair.events
     WHERE id = ANY($1::uuid[]) AND billing_locked_at IS NOT NULL`,
    [[a.eventId, b.eventId]],
  );
  if (Number(locked[0].n) !== 2) throw new Error("events not billing-locked");

  const { rows: stamped } = await q(
    `SELECT COUNT(*)::int AS n FROM repair.billing_lines
     WHERE account_month = '2610' AND close_run_id = $1`,
    [close.closeRun?.id],
  );
  if (Number(stamped[0].n) < 1) {
    throw new Error("billing_lines must carry close-run account_month (Q17)");
  }

  const { rows: runs } = await q(
    `SELECT COUNT(*)::int AS n FROM repair.close_runs WHERE account_month = '2610'`,
  );
  if (Number(runs[0].n) < 1) throw new Error("close_run missing");

  // Append-only: UPDATE close_runs must fail
  let appendOnlyOk = false;
  try {
    await q(`UPDATE repair.close_runs SET notes = 'x' WHERE account_month = '2610'`);
  } catch {
    appendOnlyOk = true;
  }
  if (!appendOnlyOk) throw new Error("close_runs should be append-only");

  // Mapping history append-only
  const { rows: hist } = await q(
    `SELECT COUNT(*)::int AS n FROM repair.billed_party_mapping_history`,
  );
  if (Number(hist[0].n) < 1) throw new Error("expected mapping history rows");

  console.log(
    JSON.stringify(
      {
        ok: true,
        sampleDetailOnly: sample.detailCount,
        inboundMarks: inbound,
        carOwnerMark: owner.mark,
        approveViaLink: viaLink.status,
        replyConfirm: confirmed.approval.status,
        blockedMissingMapping: true,
        closeRunId: close.closeRun?.id,
        accountMonth: close.accountMonth,
        billingParty: close.billingParty,
        filename: close.filename,
        localPath: close.localPath,
        invoiceCount: close.invoiceCount,
        eventCount: close.eventCount,
        laborCents: close.laborCents,
        materialCents: close.materialCents,
        validationOk: revalidate.ok,
        recipientsA: sentA.recipients,
        included500ByteB: sentB.attachments.included500Byte,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
