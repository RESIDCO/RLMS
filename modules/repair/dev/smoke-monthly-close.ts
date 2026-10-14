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
import { uploadEstimate, approveEstimate, submitForApproval } from "../services/estimates";
import { enterPodErd } from "../services/pod";
import { setCompletedDate } from "../services/completion";
import { submitShopInvoice } from "../services/invoices";
import { relayDispo } from "../services/dispo";
import { closeEvent, maybeMarkReadyToClose } from "../services/close";
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
  const { rows: shopRows } = await q(
    `SELECT id, reporting_mark FROM repair.shops
     WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [DEFAULT_TENANT_ID],
  );
  if (!shopRows[0]) throw new Error("No shop seeded");
  const shopId = String(shopRows[0].id);

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
  const est = await uploadEstimate({
    rawToken: token,
    actorName: "shop",
    actorEmail: "shop@smoke.invalid",
    via: "event_link",
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
  if (!est.ok) throw new Error(est.error);
  const estimateId = String(est.estimate.id);
  const revisionId = String(est.revision.id);

  // If AAR sample uploaded, force at least one line to stay resp 6 (sample already has many)
  if (sampleBytes) {
    const parsed = parseAarFile(sampleBytes);
    const resp6 = parsed.lines.filter((l) => l.respCode === "6").length;
    if (resp6 < 1) throw new Error("sample fixture missing resp 6 lines");
  }

  await submitForApproval({ estimateId, actor: "reviewer@smoke" });
  const appr = await approveEstimate({ estimateId, actor: "reviewer@smoke" });
  if (!appr.ok) throw new Error(appr.error);

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
  });
  if (!inv.ok) throw new Error(inv.error);

  const dispo = await relayDispo({
    eventId,
    direction: "to_shop",
    instructions: "Release empty",
    actor: "fleet@smoke",
  });
  if (!dispo.ok) throw new Error(dispo.error);

  const rtc = await maybeMarkReadyToClose({ eventId, actor: opts.actor });
  if (!rtc.ok) throw new Error(rtc.error);
  const closed = await closeEvent({
    eventId,
    actor: "reviewer@smoke",
    actorRole: "reviewer",
  });
  if (!closed.ok) throw new Error(closed.error);

  return { eventId, estimateId, revisionId, shopToken: token, total };
}

async function main() {
  // Fixture: detail-only sample validates as extract (not full CRIP)
  const sample = validateCripBytes(readFileSync(samplePath));
  if (!sample.warnings.includes("detail_only_extract")) {
    throw new Error("expected detail_only_extract warning on OFOX2609 sample");
  }
  if (!sample.ok) throw new Error(`sample validation errors: ${sample.errors.join("; ")}`);

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

  const fileBytes = readFileSync(close.localPath!);
  const revalidate = validateCripBytes(fileBytes);
  if (!revalidate.ok || !revalidate.isCompleteCrip) {
    throw new Error(`revalidate failed: ${revalidate.errors.join("; ")}`);
  }
  // Cols 2-5 billing party
  const first = fileBytes.toString("latin1").slice(0, 500);
  if (first.slice(1, 5).trim() !== "OFOX") {
    throw new Error(`billing party cols 2-5 expected OFOX, got ${JSON.stringify(first.slice(1, 5))}`);
  }

  const { rows: locked } = await q(
    `SELECT COUNT(*)::int AS n FROM repair.events
     WHERE id = ANY($1::uuid[]) AND billing_locked_at IS NOT NULL`,
    [[a.eventId, b.eventId]],
  );
  if (Number(locked[0].n) !== 2) throw new Error("events not billing-locked");

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

  console.log(
    JSON.stringify(
      {
        ok: true,
        sampleDetailOnly: sample.detailCount,
        approveViaLink: viaLink.status,
        replyConfirm: confirmed.approval.status,
        closeRunId: close.closeRun?.id,
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
