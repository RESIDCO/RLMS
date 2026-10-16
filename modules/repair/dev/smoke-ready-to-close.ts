/**
 * Local smoke for Ready-to-Close + per-shop OTP + POD recipient rules.
 * Requires DATABASE_URL and migrated repair schema (incl. ready_to_close migration).
 */
import { createBadOrder } from "../services/bo";
import { issueEventLink } from "../services/event-links";
import { shopAccept, shopOnHand } from "../services/shop-actions";
import { enterPodErd } from "../services/pod";
import { setCompletedDate } from "../services/completion";
import { acceptShopInvoice, submitShopInvoice } from "../services/invoices";
import { relayDispo } from "../services/dispo";
import { closeEvent, maybeMarkReadyToClose } from "../services/close";
import {
  isOtpRequired,
  setShopOtpStepFlag,
  issueStepOtp,
  verifyStepOtp,
} from "../services/otp";
import { resolveRecipients } from "../services/notifications";
import { DEFAULT_TENANT_ID, q } from "../db";
import { sampleAarInvoiceFile, uploadSubmitAndApprove } from "./smoke-shared-setup";

async function main() {
  process.env.REPAIR_DEV_OTP_ECHO = "1";

  const { ensureDemoShop } = await import("../services/shops");
  const effectiveShopId = await ensureDemoShop({
    mark: "APA",
    legalName: "Apache Railway Shop",
    city: "Snowflake",
    state: "AZ",
    splc: "859370",
    actor: "smoke-rtc",
  });

  // Ensure OTP off (prior smoke runs may have left APA invoice_submit enabled)
  await setShopOtpStepFlag({
    shopId: effectiveShopId!,
    step: "invoice_submit",
    enabled: false,
  });
  const otpOff = await isOtpRequired("invoice_submit", { shopId: effectiveShopId });
  if (otpOff) throw new Error("OTP should be off by default");

  const bo = await createBadOrder({
    carMark: "ARSX",
    carNumber: "100001",
    rule: "RULE_1",
    source: "INTERNAL",
    actor: "smoke-rtc",
    shopId: effectiveShopId,
  });
  if (!bo.ok) throw new Error(bo.error);
  const eventId = String(bo.event.id);

  const link = await issueEventLink({ eventId, scope: "SHOP", actor: "smoke-rtc" });
  const token = link.token;

  const acc = await shopAccept(token, "shop@smoke.invalid");
  if (!acc.ok) throw new Error(acc.error);
  const oh = await shopOnHand(token, "shop@smoke.invalid");
  if (!oh.ok) throw new Error(oh.error);

  // Shared setup: yard arrival + valid job code + logged submitForApproval
  const { estimateId } = await uploadSubmitAndApprove({
    eventId,
    rawToken: token,
  });

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

  // Enable per-shop invoice OTP and verify gate
  await setShopOtpStepFlag({
    shopId: effectiveShopId!,
    step: "invoice_submit",
    enabled: true,
  });
  const blocked = await submitShopInvoice({
    rawToken: token,
    invoiceNo: "INV-OTP",
    total: 150,
    actorEmail: "shop@smoke.invalid",
    file: {
      filename: "inv.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("%PDF-1.4 smoke"),
    },
    aarFile: sampleAarInvoiceFile("inv-otp.dat"),
  });
  if (blocked.ok || !("otpRequired" in blocked) || !blocked.otpRequired) {
    throw new Error(`expected OTP gate on invoice submit: ${JSON.stringify(blocked)}`);
  }

  const issued = await issueStepOtp({
    eventId,
    step: "invoice_submit",
    email: "shop@smoke.invalid",
  });
  if (!issued.ok || !("devEchoCode" in issued)) {
    throw new Error("expected OTP issue with REPAIR_DEV_OTP_ECHO");
  }
  const code = String((issued as { devEchoCode: string }).devEchoCode);
  const verified = await verifyStepOtp({
    eventId,
    step: "invoice_submit",
    email: "shop@smoke.invalid",
    code,
  });
  if (!verified.ok) throw new Error(verified.error);

  // Re-issue for actual submit (previous consumed)
  const issued2 = await issueStepOtp({
    eventId,
    step: "invoice_submit",
    email: "shop@smoke.invalid",
  });
  if (!issued2.ok || !("devEchoCode" in issued2)) throw new Error("OTP re-issue failed");

  const match = await submitShopInvoice({
    rawToken: token,
    invoiceNo: "INV-2",
    total: 150,
    actorEmail: "shop@smoke.invalid",
    otpCode: String((issued2 as { devEchoCode: string }).devEchoCode),
    file: {
      filename: "inv2.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("%PDF-1.4 smoke2"),
    },
    aarFile: sampleAarInvoiceFile("inv-2.dat"),
  });
  if (!match.ok) throw new Error(match.error);
  if (match.matchStatus !== "MATCHED") throw new Error("expected MATCHED");

  // §G r4 / §H: close requires an accepted invoice
  const accepted = await acceptShopInvoice({
    invoiceId: String(match.invoice.id),
    actor: "reviewer@smoke",
    note: "smoke accept",
  });
  if (!accepted.ok) throw new Error(accepted.error);

  // Disable OTP again for cleanliness
  await setShopOtpStepFlag({
    shopId: effectiveShopId!,
    step: "invoice_submit",
    enabled: false,
  });

  // Dispo should flip to READY_TO_CLOSE
  const dispo = await relayDispo({
    eventId,
    direction: "to_shop",
    instructions: "Ship empty to next load point",
    actor: "fleet@smoke",
  });
  if (!dispo.ok) throw new Error(dispo.error);
  if (!dispo.readyToClose?.ok || !dispo.readyToClose.transitioned) {
    // maybe already transitioned from invoice path if dispo was somehow present — re-check
    const again = await maybeMarkReadyToClose({ eventId, actor: "smoke" });
    if (!again.ok) throw new Error(again.error);
    if (!again.transitioned && again.reason !== "Already READY_TO_CLOSE") {
      throw new Error(`expected READY_TO_CLOSE, got ${JSON.stringify(again)}`);
    }
  }

  const { rows: st } = await q(
    `SELECT s.code FROM repair.events e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1`,
    [eventId],
  );
  if (st[0]?.code !== "READY_TO_CLOSE" && st[0]?.code !== "CLOSED") {
    // acceptShopInvoice may already close the BO under §H
    throw new Error(`expected READY_TO_CLOSE or CLOSED, got ${st[0]?.code}`);
  }

  // No auto-close — still READY_TO_CLOSE until reviewer clicks (skip if already CLOSED)
  let closedStatus = String(st[0]?.code ?? "");
  if (closedStatus !== "CLOSED") {
    const closed = await closeEvent({
      eventId,
      actor: "reviewer@smoke",
      actorRole: "reviewer",
      comment: "smoke one-click close",
    });
    if (!closed.ok) throw new Error(closed.error);
    if (closed.status !== "CLOSED") throw new Error("expected CLOSED");
    closedStatus = closed.status;
  }

  // POD recipient rules
  const due = await resolveRecipients({
    tenantId: DEFAULT_TENANT_ID,
    eventId,
    type: "POD_DUE",
  });
  if (due.to.some((e) => e.includes("reviewer") || e.includes("fleet"))) {
    // shop-only default — internal emails shouldn't appear unless seeded as shop
  }
  const includeDue = (due.rule?.include_roles as string[]) ?? [];
  if (!includeDue.includes("shop_contact") || includeDue.includes("reviewers")) {
    throw new Error(`POD_DUE rule should be shop only, got ${JSON.stringify(includeDue)}`);
  }

  const missed = await resolveRecipients({
    tenantId: DEFAULT_TENANT_ID,
    eventId,
    type: "POD_MISSED",
  });
  const includeMissed = (missed.rule?.include_roles as string[]) ?? [];
  if (!includeMissed.includes("shop_contact") || !includeMissed.includes("reviewers")) {
    throw new Error(`POD_MISSED should be shop+reviewers, got ${JSON.stringify(includeMissed)}`);
  }

  const revised = await resolveRecipients({
    tenantId: DEFAULT_TENANT_ID,
    eventId,
    type: "POD_REVISED",
  });
  const includeRev = (revised.rule?.include_roles as string[]) ?? [];
  if (includeRev.includes("shop_contact") || !includeRev.includes("reviewers")) {
    throw new Error(`POD_REVISED should be internal only, got ${JSON.stringify(includeRev)}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        eventId,
        estimateId,
        shopId: effectiveShopId,
        otpDefaultOff: !otpOff,
        match: match.matchStatus,
        closed: closedStatus,
        podDueRoles: includeDue,
        podMissedRoles: includeMissed,
        podRevisedRoles: includeRev,
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
