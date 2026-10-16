/**
 * Local smoke for POD / complete / invoice / dispo / contacts slice.
 * Requires DATABASE_URL and migrated repair schema.
 */
import { createBadOrder } from "../services/bo";
import { issueEventLink } from "../services/event-links";
import { shopAccept, shopOnHand } from "../services/shop-actions";
import { enterPodErd, runPodReminders } from "../services/pod";
import { setCompletedDate, rollbackCompletedDate } from "../services/completion";
import { submitShopInvoice } from "../services/invoices";
import { relayDispo } from "../services/dispo";
import { upsertContact, addAdhocEmails } from "../services/contacts";
import { resolveRecipients } from "../services/notifications";
import { DEFAULT_TENANT_ID } from "../db";
import { sampleAarInvoiceFile, uploadSubmitAndApprove } from "./smoke-shared-setup";

async function main() {
  const bo = await createBadOrder({
    carMark: "ARSX",
    carNumber: "100001",
    rule: "RULE_1",
    source: "INTERNAL",
    actor: "smoke",
  });
  if (!bo.ok) throw new Error(bo.error);
  const eventId = String(bo.event.id);

  const link = await issueEventLink({
    eventId,
    scope: "SHOP",
    actor: "smoke",
  });
  const token = link.token;

  await shopAccept(token, "shop@smoke.invalid");
  await shopOnHand(token, "shop@smoke.invalid");

  // Shared setup: yard arrival + valid job code + logged submitForApproval
  const { estimateId } = await uploadSubmitAndApprove({
    eventId,
    rawToken: token,
  });

  const pod = await enterPodErd({
    rawToken: token,
    kind: "POD",
    dateValue: "2026-10-20",
    enteredBy: "shop@smoke.invalid",
  });
  if (!pod.ok) throw new Error(pod.error);

  const done = await setCompletedDate({
    rawToken: token,
    completedAt: "2026-10-21",
    actor: "shop@smoke.invalid",
  });
  if (!done.ok) throw new Error(done.error);
  if (!done.estimate.locked) throw new Error("expected locked");

  const aarFile = sampleAarInvoiceFile("inv-1.dat");
  const mismatch = await submitShopInvoice({
    rawToken: token,
    invoiceNo: "INV-1",
    total: 999,
    actorEmail: "shop@smoke.invalid",
    file: {
      filename: "inv.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("%PDF-1.4 smoke"),
    },
    aarFile,
  });
  if (!mismatch.ok) throw new Error(mismatch.error);
  if (mismatch.matchStatus !== "MISMATCH" || !mismatch.mismatchFlagged) {
    throw new Error("expected mismatch flag");
  }

  const match = await submitShopInvoice({
    rawToken: token,
    invoiceNo: "INV-2",
    total: 150,
    actorEmail: "shop@smoke.invalid",
    file: {
      filename: "inv2.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("%PDF-1.4 smoke2"),
    },
    aarFile: sampleAarInvoiceFile("inv-2.dat"),
  });
  if (!match.ok) throw new Error(match.error);
  if (match.matchStatus !== "MATCHED") throw new Error("expected MATCHED");

  const dispo = await relayDispo({
    eventId,
    direction: "to_shop",
    instructions: "Ship empty to next load point",
    actor: "fleet@smoke",
  });
  if (!dispo.ok) throw new Error(dispo.error);

  await upsertContact({
    partyType: "lessee",
    name: "Smoke Lessee",
    email: "lessee@smoke.invalid",
    actor: "smoke",
  });
  await addAdhocEmails({
    eventId,
    emails: ["adhoc@smoke.invalid"],
    actor: "smoke",
  });

  const resp6 = await resolveRecipients({
    tenantId: DEFAULT_TENANT_ID,
    eventId,
    type: "RESP6_LESSEE_EMAIL",
    extraTo: ["lessee2@smoke.invalid"],
  });
  if (!resp6.excludedShop) throw new Error("Resp6 must exclude shop");
  if (resp6.to.some((e) => e.includes("shop@"))) {
    throw new Error("shop email leaked into Resp6 recipients");
  }

  const rb = await rollbackCompletedDate({
    estimateId,
    actor: "reviewer@smoke",
    actorRole: "reviewer",
    comment: "smoke rollback",
  });
  if (!rb.ok) throw new Error(rb.error);
  if (rb.estimate.locked) throw new Error("expected unlocked after rollback");

  const reminders = await runPodReminders();
  console.log(
    JSON.stringify(
      {
        ok: true,
        eventId,
        estimateId,
        podRevised: pod.revised,
        mismatch: mismatch.matchStatus,
        match: match.matchStatus,
        resp6To: resp6.to,
        remindersFired: reminders.fired.length,
        rollbackStatus: rb.estimate.status_id ? "ok" : "?",
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
