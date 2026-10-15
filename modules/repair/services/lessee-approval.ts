/**
 * Resp 6 lessee estimate approval.
 * - Login-free link is primary (included in every lessee email).
 * - Email reply is secondary; requires reviewer confirmation.
 * - Shop is never copied on lessee emails.
 * - Recipients from contact bank + ad hoc via notification rules.
 */

import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { issueEventLink, revokeLesseeLinksForEstimate } from "./event-links";
import { getEmailProvider } from "../providers/email";
import { getInboundEmailProvider } from "../providers/inbound-email";
import { resolveLesseeAttachments } from "./lessee-attachments";
import { notify, resolveRecipients } from "./notifications";
import { computeLesseeTotals } from "./lessee-totals";
import { formatCentsAsMoney } from "./money";
import {
  computeLinkExpiresAt,
  computeResponseDueAt,
  formatDueEt,
  loadLesseeWindowConfig,
} from "./lessee-window";

/** Re-export ET formatter for decide responses / owner panel. */
export { formatDueEt };

/** Owner-facing status labels (brief §F). */
export type LesseeOwnerStatus =
  | "Sent"
  | "Viewed"
  | "Accepted"
  | "Rejected"
  | "Overdue"
  | "None";

async function resp6AmountCents(revisionId: string): Promise<number> {
  const { rows } = await q(
    `SELECT COALESCE(SUM(
       COALESCE(labor_cents, ROUND(labor * 100)::bigint) +
       COALESCE(material_cents, ROUND(material * 100)::bigint)
     ), 0) AS cents
     FROM repair.estimate_lines
     WHERE revision_id = $1 AND resp_code = '6'`,
    [revisionId],
  );
  return Number(rows[0]?.cents ?? 0);
}

async function writeLesseeRevision(opts: {
  tenantId: string;
  estimateId: string;
  action: string;
  actor: string;
  actorEmail?: string;
  comment?: string;
  amountCents: number;
}) {
  const { rows: est } = await q(
    `SELECT * FROM repair.estimates WHERE id = $1 AND tenant_id = $2`,
    [opts.estimateId, opts.tenantId],
  );
  if (!est[0]) return;
  const last = await q(
    `SELECT * FROM repair.estimate_revisions
     WHERE estimate_id = $1 ORDER BY rev_no DESC LIMIT 1`,
    [opts.estimateId],
  );
  const prev = last.rows[0];
  const revNo = Number(est[0].current_revision) + 1;
  const dollars = opts.amountCents / 100;
  await q(
    `INSERT INTO repair.estimate_revisions
       (tenant_id, estimate_id, rev_no, action, actor_name, actor_email,
        labor, material, total, new_status, old_status, comment, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$5)`,
    [
      opts.tenantId,
      opts.estimateId,
      revNo,
      opts.action,
      opts.actor,
      opts.actorEmail ?? opts.actor,
      prev?.labor ?? dollars,
      prev?.material ?? 0,
      prev?.total ?? dollars,
      prev?.new_status ?? null,
      opts.comment ?? null,
    ],
  );
  await q(`UPDATE repair.estimates SET current_revision = $1 WHERE id = $2`, [
    revNo,
    opts.estimateId,
  ]);
}

async function insertDecision(opts: {
  tenantId: string;
  approvalId: string;
  eventId: string;
  revisionId: string;
  lesseeEmail: string;
  decision: "APPROVED" | "REJECTED" | "UNDO";
  channel: "url" | "email_reply" | "manual";
  amountPresentedCents: number | null;
  comment?: string;
  inboundEmailId?: string;
  confirmedByReviewer?: string;
  confirmedAt?: string | null;
  actor: string;
  respondentName?: string;
  respondentEmail?: string;
  respondentIp?: string;
  sendVersion?: number | null;
  proofDocumentId?: string | null;
  manualMethod?: string | null;
  manualReceivedAt?: string | null;
  recordedBy?: string | null;
}) {
  const { rows } = await q(
    `INSERT INTO repair.lessee_approval_decisions
       (tenant_id, approval_id, event_id, revision_id, lessee_email, decision,
        channel, amount_presented_cents, comment, inbound_email_id,
        confirmed_by_reviewer, confirmed_at, created_by,
        respondent_name, respondent_email, respondent_ip, send_version,
        proof_document_id, manual_method, manual_received_at, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING *`,
    [
      opts.tenantId,
      opts.approvalId,
      opts.eventId,
      opts.revisionId,
      opts.lesseeEmail,
      opts.decision,
      opts.channel,
      opts.amountPresentedCents,
      opts.comment ?? null,
      opts.inboundEmailId ?? null,
      opts.confirmedByReviewer ?? null,
      opts.confirmedAt ?? null,
      opts.actor,
      opts.respondentName ?? null,
      opts.respondentEmail ?? null,
      opts.respondentIp ?? null,
      opts.sendVersion ?? null,
      opts.proofDocumentId ?? null,
      opts.manualMethod ?? null,
      opts.manualReceivedAt ?? null,
      opts.recordedBy ?? null,
    ],
  );
  return rows[0];
}

const MANUAL_APPROVED_STATUSES = new Set([
  "APPROVED_MANUAL",
  "MANUAL_APPROVED",
]);
const MANUAL_REJECTED_STATUSES = new Set([
  "REJECTED_MANUAL",
  "MANUAL_REJECTED",
]);
const DECIDED_STATUSES = new Set([
  "APPROVED_VIA_LINK",
  "REJECTED_VIA_LINK",
  "REPLY_CONFIRMED",
  "REPLY_REJECTED",
  "APPROVED_MANUAL",
  "REJECTED_MANUAL",
  "MANUAL_APPROVED",
  "MANUAL_REJECTED",
]);
const OPEN_SEND_STATUSES = new Set([
  "PENDING",
  "VIEWED",
  "OVERDUE",
  "REPLY_RECEIVED",
]);

export const LESSEE_LINK_CLOSED_MSG = "A response was already recorded";

/** Owner badge label distinguishing manual accept/reject. */
export function ownerStatusBadgeLabel(opts: {
  ownerStatus: LesseeOwnerStatus;
  status?: string | null;
  respondentName?: string | null;
  decidedAtEt?: string | null;
}): string {
  const st = String(opts.status ?? "");
  const name = (opts.respondentName ?? "").trim();
  const when = (opts.decidedAtEt ?? "").trim();
  if (MANUAL_APPROVED_STATUSES.has(st) || (opts.ownerStatus === "Accepted" && st.includes("MANUAL"))) {
    const base = "Accepted (manual)";
    if (name && when) return `${base} – ${name}, ${when}`;
    if (name) return `${base} – ${name}`;
    if (when) return `${base} – ${when}`;
    return base;
  }
  if (MANUAL_REJECTED_STATUSES.has(st) || (opts.ownerStatus === "Rejected" && st.includes("MANUAL"))) {
    const base = "Rejected (manual)";
    if (name && when) return `${base} – ${name}, ${when}`;
    if (name) return `${base} – ${name}`;
    if (when) return `${base} – ${when}`;
    return base;
  }
  return opts.ownerStatus;
}

export function mapApprovalToOwnerStatus(row: {
  status?: string | null;
  viewed_at?: string | null;
  response_due_at?: string | null;
  decision?: string | null;
  overdue_flagged_at?: string | null;
}): LesseeOwnerStatus {
  const st = String(row.status ?? "");
  if (
    st === "APPROVED_VIA_LINK" ||
    st === "REPLY_CONFIRMED" ||
    MANUAL_APPROVED_STATUSES.has(st)
  ) {
    return "Accepted";
  }
  if (
    st === "REJECTED_VIA_LINK" ||
    st === "REPLY_REJECTED" ||
    MANUAL_REJECTED_STATUSES.has(st)
  ) {
    return "Rejected";
  }
  if (st === "SUPERSEDED" || st === "EXPIRED" || !st) return "None";

  const pastDue =
    !!row.response_due_at &&
    new Date(String(row.response_due_at)).getTime() < Date.now();
  if (st === "OVERDUE" || row.overdue_flagged_at || pastDue) {
    return "Overdue";
  }
  if (st === "VIEWED" || row.viewed_at) return "Viewed";
  if (st === "PENDING" || st === "REPLY_RECEIVED") return "Sent";
  return "None";
}

export async function sendLesseeApprovalRequest(opts: {
  eventId: string;
  estimateId: string;
  revisionId: string;
  /** Optional explicit recipient; otherwise contact bank + ad hoc via rules */
  lesseeEmail?: string;
  extraTo?: string[];
  /** Optional reviewer pick; defaults to all shop originals for the revision/event */
  documentIds?: string[];
  actor: string;
  tenantId?: string;
  /** Optional note shown in email body */
  note?: string;
  /** Override subject / body from Send Lessee preview page */
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  /** Customary CC: owner reviewer + shop contact (shop still never in To) */
  cc?: string[];
  replyTo?: string;
  fromEmail?: string;
  /** Cent-reconciled amount from Send page (preferred over recomputing) */
  amountPresentedCents?: number;
  /** Skip re-resolve when caller already built attachments */
  skipAttachmentsResolve?: boolean;
  preResolvedAttachments?: Awaited<ReturnType<typeof resolveLesseeAttachments>>;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;

  const { rows: est } = await q(
    `SELECT e.*, ev.car_mark, ev.car_number
     FROM repair.estimates e
     JOIN repair.events ev ON ev.id = e.event_id
     WHERE e.id = $1 AND e.event_id = $2 AND e.tenant_id = $3 AND e.deleted_at IS NULL`,
    [opts.estimateId, opts.eventId, tenantId],
  );
  if (!est[0]) return { ok: false as const, status: 404, error: "Estimate not found" };

  const carLabel = `${est[0].car_mark} ${est[0].car_number}`.trim();
  const amountCents =
    opts.amountPresentedCents != null
      ? Math.trunc(opts.amountPresentedCents)
      : await resp6AmountCents(opts.revisionId);

  const resolved =
    opts.skipAttachmentsResolve && opts.preResolvedAttachments
      ? opts.preResolvedAttachments
      : await resolveLesseeAttachments({
          eventId: opts.eventId,
          revisionId: opts.revisionId,
          tenantId,
          documentIds: opts.documentIds,
          actor: opts.actor,
          carLabel,
          estimateId: opts.estimateId,
          lesseeOnly: true,
        });

  // Resend / new send invalidates prior lessee tokens for this estimate
  await revokeLesseeLinksForEstimate({
    estimateId: opts.estimateId,
    actor: opts.actor,
    tenantId,
  });

  // Mark prior open approvals SUPERSEDED (newer send voids older links)
  await q(
    `UPDATE repair.lessee_approvals
     SET status = 'SUPERSEDED'
     WHERE estimate_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       AND status IN ('PENDING', 'VIEWED', 'OVERDUE', 'REPLY_RECEIVED')`,
    [opts.estimateId, tenantId],
  );
  // Clear estimate overdue flag on fresh send (new window starts)
  await q(
    `UPDATE repair.estimates
     SET lessee_response_overdue = false, lessee_response_overdue_at = NULL
     WHERE id = $1 AND tenant_id = $2`,
    [opts.estimateId, tenantId],
  );

  const entityCode =
    est[0].entity_code != null ? String(est[0].entity_code) : null;
  const windowCfg = await loadLesseeWindowConfig({ tenantId, entityCode });
  const sentAt = new Date();
  const responseDueAt = computeResponseDueAt(
    sentAt,
    windowCfg.businessDays,
    windowCfg.minHours,
    windowCfg.holidays,
  );
  const linkExpiresAt = computeLinkExpiresAt(responseDueAt);

  const { rows: verRows } = await q(
    `SELECT COALESCE(MAX(send_version), 0) + 1 AS next
     FROM repair.lessee_approvals WHERE estimate_id = $1`,
    [opts.estimateId],
  );
  const sendVersion = Number(verRows[0]?.next ?? 1);

  const issued = await issueEventLink({
    eventId: opts.eventId,
    scope: "LESSEE",
    partyRef: opts.lesseeEmail?.trim().toLowerCase() || "lessee",
    actor: opts.actor,
    tenantId,
    expiresAt: linkExpiresAt.toISOString(),
    estimateId: opts.estimateId,
    revisionId: opts.revisionId,
    grantedDocumentIds: resolved.documentIds,
  });

  const linkPath = `/repair/lessee/${issued.token}`;
  const recipients = await resolveRecipients({
    tenantId,
    eventId: opts.eventId,
    type: "RESP6_LESSEE_EMAIL",
    extraTo: [
      ...(opts.extraTo ?? []),
      ...(opts.lesseeEmail ? [opts.lesseeEmail] : []),
    ],
  });

  // Shop may appear on CC (customary email) but must never be in To
  if (!recipients.excludedShop) {
    return { ok: false as const, status: 500, error: "Resp 6 must exclude shop from To" };
  }
  if (recipients.to.length === 0) {
    return {
      ok: false as const,
      status: 400,
      error:
        "No lessee recipients. Add lessee contacts, event ad hoc emails, or pass lesseeEmail.",
    };
  }

  const attachNote = resolved.usedGeneratedPdf
    ? `Attachments: ${resolved.pdfFilename ?? "Resp6.pdf"}; ${resolved.dataFilename ?? "Resp6Byte500.txt"}; selected photos/docs.`
    : "Attachments: shop original file(s) (pass-through), matching 500-byte data file, and reviewer-selected docs/photos.";
  const bodyText = [
    `Please review and approve the Resp 6 (lessee) portion of the repair estimate for ${carLabel}.`,
    `Amount presented: ${formatCentsAsMoney(amountCents)}`,
    "",
    `Primary action (login-free link): open ${linkPath}`,
    "You may also reply to this email with APPROVE or REJECT (subject to reviewer confirmation).",
    "",
    attachNote,
    opts.note ? `\nNote from reviewer: ${opts.note}` : "",
    "",
    "Do not forward to the repair shop.",
  ]
    .filter(Boolean)
    .join("\n");

  const subject =
    (opts.subject ?? "").trim() || `Responsibility Items ${carLabel}`;
  let finalBody = (opts.bodyText ?? "").trim() || bodyText;
  // Ensure approve link is present in overridden bodies
  if (opts.bodyText && !finalBody.includes(linkPath)) {
    finalBody = `${finalBody}\n\nReview / Approve: ${linkPath}`;
  }
  const cc = [...new Set((opts.cc ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))]
    .filter((e) => !recipients.to.includes(e));
  const replyTo =
    opts.replyTo?.trim() || `lessee-reply+${issued.link.id}@repair.local`;
  const send = await getEmailProvider().send({
    tenantId,
    eventId: opts.eventId,
    type: "RESP6_LESSEE_EMAIL",
    to: recipients.to,
    cc,
    subject,
    bodyText: finalBody,
    bodyHtml: opts.bodyHtml,
    replyTo,
    attachments: resolved.emailAttachments,
  });

  // Log via notifications_log as well (canonical)
  await q(
    `INSERT INTO repair.notifications_log
       (tenant_id, event_id, notification_type, recipients, subject, body_snapshot,
        attachments, provider_message_id, status, created_by)
     VALUES ($1,$2,'RESP6_LESSEE_EMAIL',$3::jsonb,$4,$5,$6::jsonb,$7,$8,$9)`,
    [
      tenantId,
      opts.eventId,
      JSON.stringify(recipients.to),
      subject,
      finalBody,
      JSON.stringify(resolved.emailAttachments ?? []),
      send.providerMessageId,
      send.status,
      opts.actor,
    ],
  );

  const primaryEmail = opts.lesseeEmail?.trim().toLowerCase() || recipients.to[0];
  const { rows } = await q(
    `INSERT INTO repair.lessee_approvals
       (tenant_id, event_id, estimate_id, revision_id, lessee_email, status,
        channel, amount_presented_cents, amount_presented, document_ids,
        outbound_email_id, link_id, created_by,
        response_due_at, response_window_business_days, link_expires_at,
        send_version, entity_code)
     VALUES ($1,$2,$3,$4,$5,'PENDING','url',$6,$7,$8,$9,$10,$11,
             $12,$13,$14,$15,$16)
     RETURNING *`,
    [
      tenantId,
      opts.eventId,
      opts.estimateId,
      opts.revisionId,
      primaryEmail,
      amountCents,
      amountCents / 100,
      resolved.documentIds,
      send.providerMessageId,
      issued.link.id,
      opts.actor,
      responseDueAt.toISOString(),
      windowCfg.businessDays,
      linkExpiresAt.toISOString(),
      sendVersion,
      entityCode,
    ],
  );

  await writeLesseeRevision({
    tenantId,
    estimateId: opts.estimateId,
    action: `Responsibility 6 Email Sent for $${(amountCents / 100).toFixed(2)}`,
    actor: opts.actor,
    amountCents,
  });

  await writeAudit({
    tenantId,
    entity: "lessee_approval",
    entityId: rows[0].id,
    action: "LESSEE_APPROVAL_SENT",
    after: {
      recipients: recipients.to,
      linkId: issued.link.id,
      documentCount: resolved.documentIds.length,
      shopOriginalCount: resolved.shopOriginalCount,
      usedGeneratedPdf: resolved.usedGeneratedPdf,
      included500Byte: resolved.included500Byte,
      amountPresentedCents: amountCents,
      emailStatus: send.status,
      excludedShop: true,
    },
    actor: opts.actor,
    via: "UI",
  });

  return {
    ok: true as const,
    approval: rows[0],
    token: issued.token,
    lesseeUrlPath: linkPath,
    recipients: recipients.to,
    email: send,
    responseDueAt: responseDueAt.toISOString(),
    linkExpiresAt: linkExpiresAt.toISOString(),
    sendVersion,
    attachments: {
      shopOriginalCount: resolved.shopOriginalCount,
      usedGeneratedPdf: resolved.usedGeneratedPdf,
      included500Byte: resolved.included500Byte,
      documentIds: resolved.documentIds,
    },
  };
}

export async function approveViaLesseeLink(opts: {
  rawToken: string;
  decision: "APPROVE" | "REJECT";
  comment?: string;
  respondentName?: string;
  respondentEmail?: string;
  respondentIp?: string;
}) {
  const { resolveActiveLink } = await import("./event-links");
  const resolved = await resolveActiveLink(opts.rawToken, "LESSEE");
  if (!resolved) {
    return { ok: false as const, status: 401, error: "Invalid, expired, or superseded link" };
  }
  const { rows } = await q(
    `SELECT * FROM repair.lessee_approvals
     WHERE link_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [resolved.link.id],
  );
  const approval = rows[0];
  if (!approval) {
    return { ok: false as const, status: 404, error: "No pending lessee approval" };
  }
  if (approval.status === "SUPERSEDED") {
    return { ok: false as const, status: 410, error: "This link was superseded by a newer send" };
  }
  if (!OPEN_SEND_STATUSES.has(String(approval.status))) {
    const closed =
      String(approval.link_closed_message ?? "").trim() ||
      LESSEE_LINK_CLOSED_MSG;
    return {
      ok: false as const,
      status: 409,
      error: DECIDED_STATUSES.has(String(approval.status))
        ? closed
        : `Already ${approval.status} — link is read-only`,
    };
  }

  const name = (opts.respondentName ?? "").trim();
  const email = (opts.respondentEmail ?? "").trim().toLowerCase();
  if (!name || !email.includes("@")) {
    return {
      ok: false as const,
      status: 400,
      error: "Name and email are required",
    };
  }

  const decision = opts.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const comment = (opts.comment ?? "").trim();
  if (decision === "REJECTED" && !comment) {
    return {
      ok: false as const,
      status: 400,
      error: "Reject requires a comment",
    };
  }

  const status = decision === "APPROVED" ? "APPROVED_VIA_LINK" : "REJECTED_VIA_LINK";

  const { rows: updated } = await q(
    `UPDATE repair.lessee_approvals
     SET status = $2, decision = $3, channel = 'url', decided_at = now(),
         comment = COALESCE($4, comment),
         respondent_name = $5, respondent_email = $6, respondent_ip = $7
     WHERE id = $1
     RETURNING *`,
    [
      approval.id,
      status,
      decision,
      comment || null,
      name,
      email,
      opts.respondentIp ?? null,
    ],
  );

  // Clear overdue flag on response (decision recorded; never auto-approved)
  await q(
    `UPDATE repair.estimates
     SET lessee_response_overdue = false
     WHERE id = $1`,
    [approval.estimate_id],
  );

  await insertDecision({
    tenantId: approval.tenant_id,
    approvalId: approval.id,
    eventId: approval.event_id,
    revisionId: approval.revision_id,
    lesseeEmail: email || approval.lessee_email,
    decision,
    channel: "url",
    amountPresentedCents: approval.amount_presented_cents
      ? Number(approval.amount_presented_cents)
      : null,
    comment: comment || undefined,
    actor: email || approval.lessee_email,
    respondentName: name,
    respondentEmail: email,
    respondentIp: opts.respondentIp,
    sendVersion: approval.send_version != null ? Number(approval.send_version) : null,
  });

  await writeLesseeRevision({
    tenantId: approval.tenant_id,
    estimateId: approval.estimate_id,
    action:
      decision === "APPROVED"
        ? "Responsibility 6 Accepted via link"
        : "Responsibility 6 Rejected via link",
    actor: name,
    actorEmail: email,
    amountCents: Number(approval.amount_presented_cents ?? 0),
    comment: comment || undefined,
  });

  await writeAudit({
    tenantId: approval.tenant_id,
    entity: "lessee_approval",
    entityId: approval.id,
    action:
      decision === "APPROVED" ? "LESSEE_ACCEPT_VIA_LINK" : "LESSEE_REJECT_VIA_LINK",
    after: {
      respondentName: name,
      respondentEmail: email,
      respondentIp: opts.respondentIp ?? null,
      sendVersion: approval.send_version,
      decidedAt: updated[0]?.decided_at,
    },
    actor: email,
    via: "event_link",
  });

  await notify({
    tenantId: approval.tenant_id,
    eventId: approval.event_id,
    type: "LESSEE_DECISION_RECEIVED",
    bodyText: `Lessee ${decision === "APPROVED" ? "accepted" : "rejected"} Resp 6 via link (send #${approval.send_version ?? "?"}).`,
    actor: email,
    forceExclude: ["shop", "shop_contact"],
  });

  return {
    ok: true as const,
    status,
    approval: updated[0],
    decision,
    channel: "url" as const,
    readOnly: true,
    decidedAtEt: formatDueEt(updated[0]?.decided_at),
    respondentName: name,
    respondentEmail: email,
    sendVersion:
      approval.send_version != null ? Number(approval.send_version) : null,
  };
}

/** Dev inbound: record reply; does NOT finalize until reviewer confirms. */
export async function ingestLesseeReply(opts: {
  approvalId: string;
  bodyText: string;
  actor?: string;
}) {
  const inbound = getInboundEmailProvider();
  const recorded = await inbound.ingest({
    from: "lessee@unknown",
    to: `lessee-reply+${opts.approvalId}@repair.local`,
    subject: "Re: Estimate approval",
    raw: opts.bodyText,
    receivedAt: new Date().toISOString(),
  });

  const decisionHint =
    recorded.parsed.proposedDecision === "APPROVED"
      ? "APPROVE"
      : recorded.parsed.proposedDecision === "REJECTED"
        ? "REJECT"
        : "UNKNOWN";

  const { rows } = await q(
    `UPDATE repair.lessee_approvals
     SET status = 'REPLY_RECEIVED', reply_inbound_id = $2, channel = 'email_reply'
     WHERE id = $1 AND status IN ('PENDING', 'REPLY_RECEIVED')
     RETURNING *`,
    [opts.approvalId, recorded.id],
  );
  if (!rows[0]) {
    return { ok: false as const, status: 404, error: "Pending approval not found" };
  }

  await notify({
    tenantId: rows[0].tenant_id,
    eventId: rows[0].event_id,
    type: "LESSEE_DECISION_RECEIVED",
    bodyText: `Lessee email reply recorded (hint: ${decisionHint}). Confirm in review UI before it takes effect.`,
    actor: opts.actor ?? rows[0].lessee_email,
    forceExclude: ["shop", "shop_contact"],
  });

  await writeAudit({
    tenantId: rows[0].tenant_id,
    entity: "lessee_approval",
    entityId: rows[0].id,
    action: "LESSEE_REPLY_RECEIVED",
    after: { decisionHint, inboundId: recorded.id },
    actor: opts.actor ?? rows[0].lessee_email,
    via: "inbound_email",
  });
  return {
    ok: true as const,
    approval: rows[0],
    decisionHint,
    note: "Reply recorded; reviewer confirmation required before finalizing.",
  };
}

export async function confirmLesseeReply(opts: {
  approvalId: string;
  accept: boolean;
  /** Final decision when accepting a reply (defaults to parsed APPROVE) */
  decision?: "APPROVE" | "REJECT";
  actor: string;
  comment?: string;
}) {
  const { rows: pending } = await q(
    `SELECT * FROM repair.lessee_approvals
     WHERE id = $1 AND status = 'REPLY_RECEIVED' AND deleted_at IS NULL`,
    [opts.approvalId],
  );
  if (!pending[0]) {
    return {
      ok: false as const,
      status: 409,
      error: "Approval not awaiting reply confirmation",
    };
  }
  const approval = pending[0];
  const decision: "APPROVED" | "REJECTED" = !opts.accept
    ? "REJECTED"
    : opts.decision === "REJECT"
      ? "REJECTED"
      : "APPROVED";
  const status = opts.accept
    ? decision === "APPROVED"
      ? "REPLY_CONFIRMED"
      : "REPLY_REJECTED"
    : "REPLY_REJECTED";

  const { rows } = await q(
    `UPDATE repair.lessee_approvals
     SET status = $2,
         decision = $3,
         channel = 'email_reply',
         reviewer_confirmed_by = $4,
         reviewer_confirmed_at = now(),
         decided_at = now(),
         comment = COALESCE($5, comment)
     WHERE id = $1
     RETURNING *`,
    [opts.approvalId, status, decision, opts.actor, opts.comment ?? null],
  );

  await insertDecision({
    tenantId: approval.tenant_id,
    approvalId: approval.id,
    eventId: approval.event_id,
    revisionId: approval.revision_id,
    lesseeEmail: approval.lessee_email,
    decision,
    channel: "email_reply",
    amountPresentedCents: approval.amount_presented_cents
      ? Number(approval.amount_presented_cents)
      : null,
    comment: opts.comment,
    inboundEmailId: approval.reply_inbound_id,
    confirmedByReviewer: opts.actor,
    confirmedAt: new Date().toISOString(),
    actor: opts.actor,
  });

  await writeLesseeRevision({
    tenantId: approval.tenant_id,
    estimateId: approval.estimate_id,
    action:
      decision === "APPROVED"
        ? "Responsibility 6 Approved via email reply (reviewer confirmed)"
        : "Responsibility 6 Rejected via email reply (reviewer confirmed)",
    actor: opts.actor,
    amountCents: Number(approval.amount_presented_cents ?? 0),
    comment: opts.comment,
  });

  await writeAudit({
    tenantId: rows[0].tenant_id,
    entity: "lessee_approval",
    entityId: rows[0].id,
    action: opts.accept
      ? "LESSEE_REPLY_CONFIRMED"
      : "LESSEE_REPLY_REJECTED_BY_REVIEWER",
    after: { decision },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, approval: rows[0], decision, channel: "email_reply" as const };
}

/**
 * Lessee login-free view — ONLY what the email included:
 * scoped estimate + revision, Resp 6 lines (BRC columns), totals, granted attachments.
 * No owner lines, resp 7/internal, other lessees, comments, or app nav.
 * After respond: still readable (read-only). Superseded / expired → null.
 */
export async function getLesseeViewForToken(rawToken: string) {
  const { resolveActiveLink } = await import("./event-links");
  const { DATA_FILE_HEADER_FIELDS } = await import("./header-edits");
  const { brcAttachmentBaseName } = await import("./brc-pdf");
  const resolved = await resolveActiveLink(rawToken, "LESSEE");
  if (!resolved) return null;

  const link = resolved.link as {
    id: string;
    estimate_id?: string | null;
    revision_id?: string | null;
    granted_document_ids?: string[];
    party_ref?: string | null;
    expires_at?: string | null;
  };

  const { rows: appr } = await q(
    `SELECT * FROM repair.lessee_approvals
     WHERE link_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [link.id],
  );
  let approval = appr[0];
  if (approval && String(approval.status) === "SUPERSEDED") {
    return null;
  }

  const estimateId = String(
    link.estimate_id ?? approval?.estimate_id ?? "",
  );
  const revisionId = String(
    link.revision_id ?? approval?.revision_id ?? "",
  );
  if (!estimateId || !revisionId) {
    return null;
  }

  // Token must still match current approval revision (new revision invalidates)
  if (approval && String(approval.revision_id) !== revisionId) {
    return null;
  }

  // Mark Viewed on first open (never auto-approve)
  if (
    approval &&
    ["PENDING", "OVERDUE"].includes(String(approval.status)) &&
    !approval.viewed_at
  ) {
    const { rows: viewed } = await q(
      `UPDATE repair.lessee_approvals
       SET viewed_at = COALESCE(viewed_at, now()),
           status = CASE
             WHEN status = 'PENDING' THEN 'VIEWED'
             ELSE status
           END
       WHERE id = $1
       RETURNING *`,
      [approval.id],
    );
    approval = viewed[0] ?? approval;
    await writeAudit({
      tenantId: approval.tenant_id,
      entity: "lessee_approval",
      entityId: approval.id,
      action: "LESSEE_LINK_VIEWED",
      after: { sendVersion: approval.send_version },
      actor: approval.lessee_email,
      via: "event_link",
    });
  }

  // Soft overdue check on view (flag only — never auto-approve)
  if (approval) {
    await flagLesseeOverdueIfNeeded({
      estimateId,
      tenantId: approval.tenant_id,
    });
    const { rows: refreshed } = await q(
      `SELECT * FROM repair.lessee_approvals WHERE id = $1`,
      [approval.id],
    );
    approval = refreshed[0] ?? approval;
  }

  const totals = await computeLesseeTotals({
    estimateId,
    revisionId,
  });
  if (!totals.ok) return null;
  const bundle = totals.bundle;

  if (bundle.eventId !== String(resolved.event.id)) {
    return null;
  }

  const { rows: shopMeta } = await q(
    `SELECT s.name AS shop_name, s.city, s.state, s.shop_mark,
            e.entity_code, e.car_mark, e.car_number
     FROM repair.events e
     LEFT JOIN repair.shops s ON s.id = e.shop_id AND s.deleted_at IS NULL
     WHERE e.id = $1`,
    [resolved.event.id],
  );
  const shop = shopMeta[0] ?? {};
  const shopCityState = [shop.city, shop.state].filter(Boolean).join(", ");
  const shopDisplay = [shop.shop_name, shopCityState].filter(Boolean).join(" – ");

  const grantedIds: string[] = Array.isArray(link.granted_document_ids)
    ? link.granted_document_ids.map(String)
    : approval?.document_ids
      ? (approval.document_ids as string[]).map(String)
      : [];

  let documents: unknown[] = [];
  if (grantedIds.length) {
    const { rows: docs } = await q(
      `SELECT id, kind, original_filename, mime, size, uploaded_at, category_code
       FROM repair.documents
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
       ORDER BY uploaded_at ASC`,
      [grantedIds],
    );
    documents = docs;
  }

  const headerPublic: Record<string, unknown> = {
    carInitial: bundle.header.carInitial ?? resolved.event.car_mark,
    carNumber: bundle.header.carNumber ?? resolved.event.car_number,
    shopMark: bundle.header.shopMark,
    repairingParty: bundle.header.repairingParty,
    repairDateYymmdd: bundle.header.repairDateYymmdd,
    outboundDate: bundle.header.outboundDate,
    completedDate: bundle.header.completedDate,
    splc: bundle.header.splc,
    facilityType: bundle.header.facilityType,
    kindOfCar: bundle.header.kindOfCar,
    loadEmpty: bundle.header.loadEmpty,
    boLink: bundle.header.boLink,
  };

  const headerFields = DATA_FILE_HEADER_FIELDS.filter((f) =>
    Object.prototype.hasOwnProperty.call(headerPublic, f.key),
  );

  const amountPresentedDollars = bundle.totalCents / 100;
  const decided =
    approval && DECIDED_STATUSES.has(String(approval.status));
  const canDecide = !decided;
  const closedMessage = decided
    ? String(approval?.link_closed_message ?? LESSEE_LINK_CLOSED_MSG)
    : null;
  const ownerStatus = approval
    ? mapApprovalToOwnerStatus(approval)
    : ("None" as LesseeOwnerStatus);

  const estimateNo = estimateId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const carInitial = String(
    headerPublic.carInitial ?? resolved.event.car_mark ?? "",
  );
  const carNumber = String(
    headerPublic.carNumber ?? resolved.event.car_number ?? "",
  );
  const base = brcAttachmentBaseName(carInitial, carNumber, estimateNo);

  // BRC header block for lessee page (replaces 500-byte Data File header)
  let brcHeader: Record<string, unknown> | null = null;
  try {
    const { loadBrcDocument } = await import("./brc-pdf");
    const brc = await loadBrcDocument({
      estimateId,
      audience: "lessee",
      revisionId,
      tenantId: approval?.tenant_id ?? DEFAULT_TENANT_ID,
    });
    if (brc.ok) {
      brcHeader = { ...brc.doc.header };
    }
  } catch {
    brcHeader = null;
  }

  return {
    link: {
      id: link.id,
      scope: "LESSEE",
      estimate_id: estimateId,
      revision_id: revisionId,
      expires_at:
        approval?.link_expires_at ??
        link.expires_at ??
        (resolved.link as { expires_at?: string }).expires_at ??
        null,
      party_ref: link.party_ref ?? null,
    },
    event: {
      id: resolved.event.id,
      car_mark: resolved.event.car_mark,
      car_number: resolved.event.car_number,
    },
    estimate: { id: estimateId },
    revisionId,
    workspaceTitle: "RESIDCO",
    shopDisplay,
    shopName: shop.shop_name ? String(shop.shop_name) : null,
    shopCityState: shopCityState || null,
    /** Resp 6 only — BRC columns via enrichLineFromRaw in lessee-totals */
    lines: bundle.lines.map((l) => ({
      ...l,
      labor: l.labor_cents / 100,
      material: l.material_cents / 100,
      total: l.amount_cents / 100,
      total_cents: l.amount_cents,
      labor_cents_label: String(l.labor_cents),
      material_cents_label: String(l.material_cents),
      amount_cents_label: String(l.amount_cents),
    })),
    allLines: undefined,
    header: headerPublic,
    headerFields,
    documents,
    documentsViewerPath: `/repair/lessee/${rawToken}/documents`,
    downloads: {
      pdf: {
        filename: `${base}_Resp6.pdf`,
        url: `/api/repair/lessee/${rawToken}/downloads/resp6-pdf`,
      },
      data500: {
        filename: `${base}_Resp6Byte500.txt`,
        url: `/api/repair/lessee/${rawToken}/downloads/resp6-data`,
      },
    },
    ownRespCodes: ["6"],
    amountPresented: amountPresentedDollars,
    amountPresentedCents: bundle.totalCents,
    amountMoney: bundle.amountMoney,
    /** BRC header fields for 4-col lessee block (not 500-byte Data File). */
    brcHeader,
    approval: approval
      ? {
          id: approval.id,
          status: approval.status,
          ownerStatus,
          decision: approval.decision ?? null,
          comment: approval.comment ?? null,
          responseDueAt: approval.response_due_at ?? null,
          responseDueAtEt: formatDueEt(approval.response_due_at),
          viewedAt: approval.viewed_at ?? null,
          decidedAt: approval.decided_at ?? null,
          decidedAtEt: formatDueEt(approval.decided_at),
          sendVersion: approval.send_version != null
            ? Number(approval.send_version)
            : null,
          revisionId: approval.revision_id ?? revisionId,
          respondentName: approval.respondent_name ?? null,
          respondentEmail: approval.respondent_email ?? null,
        }
      : null,
    readOnly: true,
    canDecide,
    closedMessage,
    canPencilEdit: false,
    hideAppNav: true,
    note: "",
  };
}

/** Lessee may fetch only granted attachments for their token. */
export async function getLesseeAttachmentForToken(opts: {
  rawToken: string;
  documentId: string;
}) {
  const view = await getLesseeViewForToken(opts.rawToken);
  if (!view) {
    return { ok: false as const, status: 401, error: "Invalid or expired lessee link" };
  }
  const granted = new Set(
    ((view.documents as Array<{ id: string }>) ?? []).map((d) => String(d.id)),
  );
  if (!granted.has(opts.documentId)) {
    return {
      ok: false as const,
      status: 403,
      error: "Attachment not granted on this lessee link",
    };
  }
  const { rows } = await q(
    `SELECT id, kind, storage_key, mime, size, original_filename
     FROM repair.documents WHERE id = $1 AND deleted_at IS NULL`,
    [opts.documentId],
  );
  if (!rows[0]) {
    return { ok: false as const, status: 404, error: "Document not found" };
  }
  const { getStorageProvider } = await import("../providers/storage");
  const stored = await getStorageProvider().get(rows[0].storage_key);
  return {
    ok: true as const,
    document: rows[0],
    bytes: stored.bytes,
  };
}

/** Guard: lessee token cannot read other estimates. */
export async function assertLesseeTokenEstimateAccess(opts: {
  rawToken: string;
  estimateId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const view = await getLesseeViewForToken(opts.rawToken);
  if (!view) {
    return { ok: false, status: 401, error: "Invalid or expired lessee link" };
  }
  if (String(view.estimate?.id) !== opts.estimateId) {
    return {
      ok: false,
      status: 403,
      error: "This lessee link cannot access other estimates",
    };
  }
  return { ok: true };
}

/**
 * When response window passes: flag "Lessee response overdue" on estimate +
 * approval. Never auto-approves.
 */
export async function flagLesseeOverdueIfNeeded(opts: {
  estimateId: string;
  tenantId?: string;
}): Promise<{ flagged: boolean; approvalId?: string }> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT * FROM repair.lessee_approvals
     WHERE estimate_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       AND status IN ('PENDING', 'VIEWED', 'OVERDUE', 'REPLY_RECEIVED')
       AND response_due_at IS NOT NULL
       AND response_due_at < now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [opts.estimateId, tenantId],
  );
  if (!rows[0]) return { flagged: false };
  const a = rows[0];
  if (!a.overdue_flagged_at || a.status !== "OVERDUE") {
    await q(
      `UPDATE repair.lessee_approvals
       SET status = CASE
             WHEN status IN ('PENDING', 'VIEWED') THEN 'OVERDUE'
             ELSE status
           END,
           overdue_flagged_at = COALESCE(overdue_flagged_at, now())
       WHERE id = $1`,
      [a.id],
    );
    await q(
      `UPDATE repair.estimates
       SET lessee_response_overdue = true,
           lessee_response_overdue_at = COALESCE(lessee_response_overdue_at, now())
       WHERE id = $1 AND tenant_id = $2`,
      [opts.estimateId, tenantId],
    );
    await writeAudit({
      tenantId,
      entity: "lessee_approval",
      entityId: a.id,
      action: "LESSEE_RESPONSE_OVERDUE",
      after: {
        responseDueAt: a.response_due_at,
        note: "Flag only — never auto-approve",
      },
      actor: "system",
      via: "job",
    });
  }
  return { flagged: true, approvalId: a.id };
}

/** Owner Estimate Review: current lessee status + response history. */
export async function getOwnerLesseePanel(opts: {
  estimateId: string;
  tenantId?: string;
  actorRole?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  await flagLesseeOverdueIfNeeded(opts);
  const { canRecordManualLessee, canUndoManualLessee } = await import(
    "./documents-viewer"
  );

  const { rows: approvals } = await q(
    `SELECT *
     FROM repair.lessee_approvals
     WHERE estimate_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     ORDER BY COALESCE(send_version, 0) DESC, created_at DESC`,
    [opts.estimateId, tenantId],
  );
  /**
   * Root-cause fix (owner stale / wrong send):
   * Prefer the latest non-SUPERSEDED/EXPIRED send — not merely created_at DESC,
   * which could surface a voided row ahead of the live send/revision decision.
   */
  const current =
    approvals.find(
      (a) =>
        !["SUPERSEDED", "EXPIRED"].includes(String(a.status ?? "")),
    ) ??
    approvals[0] ??
    null;
  const ownerStatus = current
    ? mapApprovalToOwnerStatus(current)
    : ("None" as LesseeOwnerStatus);
  const badge = current
    ? ownerStatusBadgeLabel({
        ownerStatus,
        status: current.status,
        respondentName: current.respondent_name,
        decidedAtEt: formatDueEt(current.decided_at ?? current.manual_received_at),
      })
    : ownerStatus;

  const { rows: history } = await q(
    `SELECT d.*, a.send_version, a.revision_id,
            doc.original_filename AS proof_filename,
            doc.id AS proof_doc_id
     FROM repair.lessee_approval_decisions d
     JOIN repair.lessee_approvals a ON a.id = d.approval_id
     LEFT JOIN repair.documents doc
       ON doc.id = COALESCE(d.proof_document_id, a.proof_document_id)
      AND doc.deleted_at IS NULL
     WHERE a.estimate_id = $1 AND a.tenant_id = $2
     ORDER BY d.decided_at DESC, d.created_at DESC`,
    [opts.estimateId, tenantId],
  );

  const { rows: est } = await q(
    `SELECT lessee_response_overdue, lessee_response_overdue_at
     FROM repair.estimates WHERE id = $1 AND tenant_id = $2`,
    [opts.estimateId, tenantId],
  );

  const openForManual =
    !!current && OPEN_SEND_STATUSES.has(String(current.status));
  const isManualDecided =
    !!current &&
    (MANUAL_APPROVED_STATUSES.has(String(current.status)) ||
      MANUAL_REJECTED_STATUSES.has(String(current.status)));

  return {
    ownerStatus,
    badge,
    overdue: Boolean(est[0]?.lessee_response_overdue) || ownerStatus === "Overdue",
    overdueAt: est[0]?.lessee_response_overdue_at ?? null,
    /** Tip for clients: always revalidate; do not cache this panel. */
    cacheControl: "no-store",
    canRecordManual:
      canRecordManualLessee(opts.actorRole) && openForManual,
    canUndoManual: canUndoManualLessee(opts.actorRole) && isManualDecided,
    current: current
      ? {
          id: current.id,
          status: current.status,
          ownerStatus,
          badge,
          responseDueAt: current.response_due_at ?? null,
          responseDueAtEt: formatDueEt(current.response_due_at),
          viewedAt: current.viewed_at ?? null,
          decidedAt: current.decided_at ?? null,
          decidedAtEt: formatDueEt(
            current.decided_at ?? current.manual_received_at,
          ),
          sendVersion:
            current.send_version != null ? Number(current.send_version) : null,
          revisionId: current.revision_id ?? null,
          amountPresentedCents: current.amount_presented_cents
            ? Number(current.amount_presented_cents)
            : null,
          decision: current.decision ?? null,
          comment: current.comment ?? null,
          respondentName: current.respondent_name ?? null,
          respondentEmail: current.respondent_email ?? null,
          lesseeEmail: current.lessee_email,
          manualMethod: current.manual_method ?? null,
          manualReceivedAt: current.manual_received_at ?? null,
          manualReceivedAtEt: formatDueEt(current.manual_received_at),
          manualRecordedBy: current.manual_recorded_by ?? null,
          proofDocumentId: current.proof_document_id
            ? String(current.proof_document_id)
            : null,
          isManual:
            MANUAL_APPROVED_STATUSES.has(String(current.status)) ||
            MANUAL_REJECTED_STATUSES.has(String(current.status)),
        }
      : null,
    sends: approvals.map((a) => ({
      id: a.id,
      status: a.status,
      ownerStatus: mapApprovalToOwnerStatus(a),
      badge: ownerStatusBadgeLabel({
        ownerStatus: mapApprovalToOwnerStatus(a),
        status: a.status,
        respondentName: a.respondent_name,
        decidedAtEt: formatDueEt(a.decided_at ?? a.manual_received_at),
      }),
      sendVersion: a.send_version != null ? Number(a.send_version) : null,
      revisionId: a.revision_id ?? null,
      createdAt: a.created_at,
      responseDueAt: a.response_due_at,
      responseDueAtEt: formatDueEt(a.response_due_at),
      decidedAt: a.decided_at,
      decidedAtEt: formatDueEt(a.decided_at),
      viewedAt: a.viewed_at,
      respondentName: a.respondent_name ?? null,
      respondentEmail: a.respondent_email ?? null,
    })),
    history: history.map((h) => ({
      id: h.id,
      decision: h.decision,
      channel: h.channel,
      decidedAt: h.decided_at,
      decidedAtEt: formatDueEt(h.decided_at),
      comment: h.comment,
      respondentName: h.respondent_name,
      respondentEmail: h.respondent_email,
      respondentIp: h.respondent_ip,
      sendVersion: h.send_version != null ? Number(h.send_version) : null,
      revisionId: h.revision_id ?? null,
      confirmedByReviewer: h.confirmed_by_reviewer,
      recordedBy: h.recorded_by ?? h.confirmed_by_reviewer ?? null,
      manualMethod: h.manual_method ?? null,
      proofDocumentId: h.proof_doc_id ? String(h.proof_doc_id) : null,
      proofFilename: h.proof_filename ?? null,
    })),
  };
}

/**
 * Owner / managing partner records Accept/Reject off-link against the
 * current Sent/Viewed/Overdue send (exact revision lines + total).
 * Closes the lessee link; clears overdue; optional proof (.msg/.eml/PDF).
 */
export async function recordManualLesseeDecision(opts: {
  estimateId: string;
  decision: "APPROVE" | "REJECT";
  note: string;
  actor: string;
  actorRole?: string;
  lesseeName?: string;
  lesseeEmail?: string;
  method?: "email" | "phone" | "other" | string;
  receivedAt?: string | Date | null;
  proof?: {
    filename: string;
    mime: string;
    bytes: Buffer;
  } | null;
  tenantId?: string;
}) {
  const { canRecordManualLessee } = await import("./documents-viewer");
  if (!canRecordManualLessee(opts.actorRole)) {
    return {
      ok: false as const,
      status: 403,
      error: "Owner or managing partner only",
    };
  }

  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const note = opts.note.trim();
  if (!note) {
    return {
      ok: false as const,
      status: 400,
      error: "Note is required for manual recording",
    };
  }
  const lesseeName = (opts.lesseeName ?? "").trim();
  const lesseeEmail = (opts.lesseeEmail ?? "").trim().toLowerCase();
  if (!lesseeName || !lesseeEmail.includes("@")) {
    return {
      ok: false as const,
      status: 400,
      error: "Lessee contact name and email are required",
    };
  }
  const methodRaw = String(opts.method ?? "other").trim().toLowerCase();
  const method =
    methodRaw === "email" || methodRaw === "phone" ? methodRaw : "other";

  let receivedAt: Date;
  if (opts.receivedAt) {
    receivedAt =
      opts.receivedAt instanceof Date
        ? opts.receivedAt
        : new Date(String(opts.receivedAt));
    if (Number.isNaN(receivedAt.getTime())) {
      return {
        ok: false as const,
        status: 400,
        error: "Invalid date/time received",
      };
    }
  } else {
    receivedAt = new Date();
  }

  if (opts.proof) {
    const name = opts.proof.filename.toLowerCase();
    const okExt =
      name.endsWith(".msg") ||
      name.endsWith(".eml") ||
      name.endsWith(".pdf") ||
      opts.proof.mime === "application/pdf" ||
      opts.proof.mime === "message/rfc822" ||
      opts.proof.mime === "application/vnd.ms-outlook";
    if (!okExt) {
      return {
        ok: false as const,
        status: 400,
        error: "Proof attachment must be .msg, .eml, or PDF",
      };
    }
  }

  const decision = opts.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const status =
    decision === "APPROVED" ? "APPROVED_MANUAL" : "REJECTED_MANUAL";

  // Prefer live non-SUPERSEDED open send (Sent / Viewed / Overdue)
  const { rows: open } = await q(
    `SELECT * FROM repair.lessee_approvals
     WHERE estimate_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       AND status IN ('PENDING', 'VIEWED', 'OVERDUE', 'REPLY_RECEIVED')
     ORDER BY COALESCE(send_version, 0) DESC, created_at DESC
     LIMIT 1`,
    [opts.estimateId, tenantId],
  );
  if (!open[0]) {
    return {
      ok: false as const,
      status: 409,
      error:
        "No open lessee send (Sent, Viewed, or Overdue) to record against",
    };
  }
  let approval = open[0];

  // Snapshot exact lines + total for this send's revision
  const amountCents =
    approval.amount_presented_cents != null
      ? Number(approval.amount_presented_cents)
      : await resp6AmountCents(String(approval.revision_id));

  let proofDocumentId: string | null = null;
  if (opts.proof) {
    const { uploadEventDocument } = await import("./estimates");
    const { setDocumentOwnerOnly } = await import("./documents-viewer");
    const uploaded = await uploadEventDocument({
      eventId: String(approval.event_id),
      tenantId,
      kind: "lessee_approval",
      categoryCode: "lessee_approval",
      comment: `Lessee response proof (send #${approval.send_version ?? "?"}) — recorded by ${opts.actor}`,
      actorEmail: opts.actor,
      file: opts.proof,
    });
    if (!uploaded.ok) {
      return {
        ok: false as const,
        status: uploaded.status,
        error: uploaded.error,
      };
    }
    proofDocumentId = String(uploaded.document.id);
    await setDocumentOwnerOnly({
      documentId: proofDocumentId,
      ownerOnly: true,
      actor: opts.actor,
      actorRole: opts.actorRole ?? "owner",
      tenantId,
    });
  }

  const { rows: updated } = await q(
    `UPDATE repair.lessee_approvals
     SET status = $2,
         decision = $3,
         channel = 'manual',
         decided_at = $4,
         comment = $5,
         manual_note = $5,
         manual_recorded_by = $6,
         manual_method = $7,
         manual_received_at = $4,
         respondent_name = $8,
         respondent_email = $9,
         lessee_email = $9,
         proof_document_id = COALESCE($10, proof_document_id),
         link_closed_message = $11,
         amount_presented_cents = $12,
         amount_presented = $13,
         manual_undone_at = NULL,
         manual_undo_reason = NULL,
         manual_undo_by = NULL
     WHERE id = $1
     RETURNING *`,
    [
      approval.id,
      status,
      decision,
      receivedAt.toISOString(),
      note,
      opts.actor,
      method,
      lesseeName,
      lesseeEmail,
      proofDocumentId,
      LESSEE_LINK_CLOSED_MSG,
      amountCents,
      amountCents / 100,
    ],
  );
  approval = updated[0];

  // Clear overdue flag on recorded response
  await q(
    `UPDATE repair.estimates
     SET lessee_response_overdue = false,
         lessee_response_overdue_at = NULL
     WHERE id = $1`,
    [opts.estimateId],
  );

  await insertDecision({
    tenantId,
    approvalId: approval.id,
    eventId: approval.event_id,
    revisionId: approval.revision_id,
    lesseeEmail,
    decision,
    channel: "manual",
    amountPresentedCents: amountCents,
    comment: note,
    confirmedByReviewer: opts.actor,
    confirmedAt: receivedAt.toISOString(),
    actor: opts.actor,
    respondentName: lesseeName,
    respondentEmail: lesseeEmail,
    sendVersion:
      approval.send_version != null ? Number(approval.send_version) : null,
    proofDocumentId,
    manualMethod: method,
    manualReceivedAt: receivedAt.toISOString(),
    recordedBy: opts.actor,
  });

  await writeLesseeRevision({
    tenantId,
    estimateId: opts.estimateId,
    action:
      decision === "APPROVED"
        ? "Responsibility 6 Accepted (manual)"
        : "Responsibility 6 Rejected (manual)",
    actor: opts.actor,
    amountCents,
    comment: `recorded by ${opts.actor}: ${note}`,
  });

  await writeAudit({
    tenantId,
    entity: "lessee_approval",
    entityId: approval.id,
    action: "LESSEE_MANUAL_DECISION",
    after: {
      decision,
      status,
      note,
      method,
      receivedAt: receivedAt.toISOString(),
      lesseeName,
      lesseeEmail,
      proofDocumentId,
      amountPresentedCents: amountCents,
      sendVersion: approval.send_version,
      recordedBy: opts.actor,
      linkClosedMessage: LESSEE_LINK_CLOSED_MSG,
    },
    actor: opts.actor,
    via: "UI",
  });

  return {
    ok: true as const,
    approval,
    decision,
    status,
    channel: "manual" as const,
    proofDocumentId,
    badge: ownerStatusBadgeLabel({
      ownerStatus: decision === "APPROVED" ? "Accepted" : "Rejected",
      status,
      respondentName: lesseeName,
      decidedAtEt: formatDueEt(receivedAt),
    }),
    closedMessage: LESSEE_LINK_CLOSED_MSG,
  };
}

/**
 * Owner-only undo of a manual lessee decision. Reopens the send (Sent).
 * Never deletes history — appends an UNDO decision row.
 */
export async function undoManualLesseeDecision(opts: {
  estimateId: string;
  reason: string;
  actor: string;
  actorRole?: string;
  tenantId?: string;
}) {
  const { canUndoManualLessee } = await import("./documents-viewer");
  if (!canUndoManualLessee(opts.actorRole)) {
    return {
      ok: false as const,
      status: 403,
      error: "Owner only",
    };
  }
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const reason = opts.reason.trim();
  if (!reason) {
    return {
      ok: false as const,
      status: 400,
      error: "Undo reason is required",
    };
  }

  const { rows } = await q(
    `SELECT * FROM repair.lessee_approvals
     WHERE estimate_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       AND status IN (
         'APPROVED_MANUAL', 'REJECTED_MANUAL',
         'MANUAL_APPROVED', 'MANUAL_REJECTED'
       )
     ORDER BY COALESCE(send_version, 0) DESC, created_at DESC
     LIMIT 1`,
    [opts.estimateId, tenantId],
  );
  if (!rows[0]) {
    return {
      ok: false as const,
      status: 409,
      error: "No manual lessee decision to undo",
    };
  }
  const approval = rows[0];
  const priorStatus = String(approval.status);
  // Brief/smoke: undo restores Sent (PENDING). Bump due if past so
  // flagLesseeOverdueIfNeeded does not immediately re-stamp Overdue.
  const reopenStatus = "PENDING";
  const cfg = await loadLesseeWindowConfig({
    tenantId,
    entityCode: approval.entity_code ? String(approval.entity_code) : null,
  });
  const newDue = computeResponseDueAt(
    new Date(),
    cfg.businessDays,
    cfg.minHours,
    cfg.holidays,
  );
  const newLinkExp = computeLinkExpiresAt(newDue);

  const { rows: updated } = await q(
    `UPDATE repair.lessee_approvals
     SET status = $2,
         decision = NULL,
         channel = COALESCE(channel, 'url'),
         decided_at = NULL,
         comment = NULL,
         link_closed_message = NULL,
         overdue_flagged_at = NULL,
         response_due_at = $5,
         link_expires_at = $6,
         manual_undone_at = now(),
         manual_undo_reason = $3,
         manual_undo_by = $4
     WHERE id = $1
     RETURNING *`,
    [
      approval.id,
      reopenStatus,
      reason,
      opts.actor,
      newDue.toISOString(),
      newLinkExp.toISOString(),
    ],
  );

  await q(
    `UPDATE repair.estimates
     SET lessee_response_overdue = false,
         lessee_response_overdue_at = NULL
     WHERE id = $1`,
    [opts.estimateId],
  );

  if (approval.link_id) {
    await q(
      `UPDATE repair.event_links
       SET expires_at = $2, revoked_at = NULL, revoked_by = NULL
       WHERE id = $1`,
      [approval.link_id, newLinkExp.toISOString()],
    );
  }

  await insertDecision({
    tenantId,
    approvalId: approval.id,
    eventId: approval.event_id,
    revisionId: approval.revision_id,
    lesseeEmail: approval.lessee_email,
    decision: "UNDO",
    channel: "manual",
    amountPresentedCents: approval.amount_presented_cents
      ? Number(approval.amount_presented_cents)
      : null,
    comment: reason,
    actor: opts.actor,
    respondentName: approval.respondent_name ?? undefined,
    respondentEmail: approval.respondent_email ?? undefined,
    sendVersion:
      approval.send_version != null ? Number(approval.send_version) : null,
    proofDocumentId: approval.proof_document_id
      ? String(approval.proof_document_id)
      : null,
    recordedBy: opts.actor,
  });

  await writeLesseeRevision({
    tenantId,
    estimateId: opts.estimateId,
    action: "Responsibility 6 manual decision undone",
    actor: opts.actor,
    amountCents: Number(approval.amount_presented_cents ?? 0),
    comment: `undo by ${opts.actor}: ${reason}`,
  });

  await writeAudit({
    tenantId,
    entity: "lessee_approval",
    entityId: approval.id,
    action: "LESSEE_MANUAL_UNDO",
    after: {
      priorStatus,
      reopenStatus,
      reason,
      undoneBy: opts.actor,
      responseDueAt: newDue.toISOString(),
    },
    actor: opts.actor,
    via: "UI",
  });

  return {
    ok: true as const,
    approval: updated[0],
    reopenStatus,
    ownerStatus: mapApprovalToOwnerStatus(updated[0]),
  };
}

/** Lessee download of Resp6 PDF / 500-byte for this send only. */
export async function getLesseeDownloadForToken(opts: {
  rawToken: string;
  kind: "resp6-pdf" | "resp6-data";
}) {
  const view = await getLesseeViewForToken(opts.rawToken);
  if (!view) {
    return { ok: false as const, status: 401, error: "Invalid or expired lessee link" };
  }
  const { resolveLesseeAttachments } = await import("./lessee-attachments");
  const resolved = await resolveLesseeAttachments({
    eventId: String(view.event.id),
    revisionId: String(view.revisionId),
    estimateId: String(view.estimate.id),
    tenantId: DEFAULT_TENANT_ID,
    actor: "lessee-link",
    carLabel: `${view.event.car_mark} ${view.event.car_number}`.trim(),
    documentIds: (view.documents as Array<{ id: string }>).map((d) => d.id),
    lesseeOnly: true,
  });
  if (opts.kind === "resp6-pdf") {
    if (!resolved.pdfBytes) {
      return { ok: false as const, status: 404, error: "Resp6 PDF not available" };
    }
    return {
      ok: true as const,
      filename: resolved.pdfFilename || view.downloads.pdf.filename,
      mime: "application/pdf",
      bytes: resolved.pdfBytes,
    };
  }
  if (!resolved.dataBytes) {
    return { ok: false as const, status: 404, error: "Resp6 data file not available" };
  }
  return {
    ok: true as const,
    filename: resolved.dataFilename || view.downloads.data500.filename,
    mime: "text/plain",
    bytes: resolved.dataBytes,
  };
}
