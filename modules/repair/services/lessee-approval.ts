/**
 * Resp 6 lessee estimate approval.
 * - Login-free link is primary (included in every lessee email).
 * - Email reply is secondary; requires reviewer confirmation.
 * - Shop is never copied on lessee emails.
 * - Recipients from contact bank + ad hoc via notification rules.
 */

import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { issueEventLink } from "./event-links";
import { getEmailProvider } from "../providers/email";
import { getInboundEmailProvider } from "../providers/inbound-email";
import { resolveLesseeAttachments } from "./lessee-attachments";
import { notify, resolveRecipients } from "./notifications";

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
  decision: "APPROVED" | "REJECTED";
  channel: "url" | "email_reply";
  amountPresentedCents: number | null;
  comment?: string;
  inboundEmailId?: string;
  confirmedByReviewer?: string;
  confirmedAt?: string | null;
  actor: string;
}) {
  const { rows } = await q(
    `INSERT INTO repair.lessee_approval_decisions
       (tenant_id, approval_id, event_id, revision_id, lessee_email, decision,
        channel, amount_presented_cents, comment, inbound_email_id,
        confirmed_by_reviewer, confirmed_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
    ],
  );
  return rows[0];
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
  const amountCents = await resp6AmountCents(opts.revisionId);

  const resolved = await resolveLesseeAttachments({
    eventId: opts.eventId,
    revisionId: opts.revisionId,
    tenantId,
    documentIds: opts.documentIds,
    actor: opts.actor,
    carLabel,
  });

  const issued = await issueEventLink({
    eventId: opts.eventId,
    scope: "LESSEE",
    partyRef: opts.lesseeEmail?.trim().toLowerCase() || "lessee",
    actor: opts.actor,
    tenantId,
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

  if (!recipients.excludedShop) {
    return { ok: false as const, status: 500, error: "Resp 6 must exclude shop" };
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
    ? "Attachments: shop original file(s) when present; matching 500-byte data file; a generated estimate PDF was added because the shop did not send a PDF."
    : "Attachments: shop original file(s) (pass-through), matching 500-byte data file, and reviewer-selected docs/photos.";
  const bodyText = [
    `Please review and approve the Resp 6 (lessee) portion of the repair estimate for ${carLabel}.`,
    `Amount presented: $${(amountCents / 100).toFixed(2)}`,
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

  const subject = `Estimate approval requested — ${carLabel}`;
  const send = await getEmailProvider().send({
    tenantId,
    eventId: opts.eventId,
    type: "RESP6_LESSEE_EMAIL",
    to: recipients.to,
    // Shop never copied
    cc: [],
    subject,
    bodyText,
    replyTo: `lessee-reply+${issued.link.id}@repair.local`,
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
      bodyText,
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
        outbound_email_id, link_id, created_by)
     VALUES ($1,$2,$3,$4,$5,'PENDING','url',$6,$7,$8,$9,$10,$11)
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
}) {
  const { resolveActiveLink } = await import("./event-links");
  const resolved = await resolveActiveLink(opts.rawToken, "LESSEE");
  if (!resolved) {
    return { ok: false as const, status: 401, error: "Invalid or revoked link" };
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
  if (approval.status !== "PENDING" && approval.status !== "REPLY_RECEIVED") {
    return { ok: false as const, status: 409, error: `Already ${approval.status}` };
  }

  const decision = opts.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const status = decision === "APPROVED" ? "APPROVED_VIA_LINK" : "REJECTED_VIA_LINK";

  const { rows: updated } = await q(
    `UPDATE repair.lessee_approvals
     SET status = $2, decision = $3, channel = 'url', decided_at = now(),
         comment = COALESCE($4, comment)
     WHERE id = $1
     RETURNING *`,
    [approval.id, status, decision, opts.comment ?? null],
  );

  await insertDecision({
    tenantId: approval.tenant_id,
    approvalId: approval.id,
    eventId: approval.event_id,
    revisionId: approval.revision_id,
    lesseeEmail: approval.lessee_email,
    decision,
    channel: "url",
    amountPresentedCents: approval.amount_presented_cents
      ? Number(approval.amount_presented_cents)
      : null,
    comment: opts.comment,
    actor: approval.lessee_email,
  });

  await writeLesseeRevision({
    tenantId: approval.tenant_id,
    estimateId: approval.estimate_id,
    action:
      decision === "APPROVED"
        ? "Responsibility 6 Approved via link"
        : "Responsibility 6 Rejected via link",
    actor: approval.lessee_email,
    actorEmail: approval.lessee_email,
    amountCents: Number(approval.amount_presented_cents ?? 0),
    comment: opts.comment,
  });

  await writeAudit({
    tenantId: approval.tenant_id,
    entity: "lessee_approval",
    entityId: approval.id,
    action:
      decision === "APPROVED" ? "LESSEE_APPROVE_VIA_LINK" : "LESSEE_REJECT_VIA_LINK",
    actor: approval.lessee_email,
    via: "event_link",
  });

  return {
    ok: true as const,
    status,
    approval: updated[0],
    decision,
    channel: "url" as const,
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

/** Lessee-portion lines (Resp 6) for the login-free page. */
export async function getLesseeViewForToken(rawToken: string) {
  const { resolveActiveLink } = await import("./event-links");
  const { listEstimatesForEvent, listRevisions, getRevisionLines } = await import(
    "./estimates"
  );
  const { getCorrectionEditorPayload } = await import("./gap-lifecycle-06");
  const { DATA_FILE_HEADER_FIELDS } = await import("./header-edits");
  const { listEventDocuments } = await import("./ops-grid");
  const resolved = await resolveActiveLink(rawToken, "LESSEE");
  if (!resolved) return null;

  const estimates = await listEstimatesForEvent(String(resolved.event.id));
  const estimate = estimates[0];
  let revisions: unknown[] = [];
  let lines: unknown[] = [];
  let allLines: unknown[] = [];
  let amountPresented = 0;
  let header: Record<string, unknown> = {};
  let documents: unknown[] = [];
  const ownRespCodes = new Set(["6"]);
  if (estimate) {
    revisions = await listRevisions(estimate.id);
    const { rows: appr } = await q(
      `SELECT * FROM repair.lessee_approvals
       WHERE link_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [resolved.link.id],
    );
    const revisionId =
      appr[0]?.revision_id ??
      (revisions[revisions.length - 1] as { id?: string } | undefined)?.id;
    if (revisionId) {
      allLines = await getRevisionLines(String(revisionId));
      // Own-responsibility lines (Resp 6) — approve/dispute scope + smoke contract
      lines = allLines.filter((l) => ownRespCodes.has(String(l.resp_code)));
      amountPresented = (lines as Array<{ total?: number }>).reduce(
        (s, l) => s + Number(l.total ?? 0),
        0,
      );
    }
    const editor = await getCorrectionEditorPayload({ estimateId: String(estimate.id) });
    if (editor.ok) {
      header = (editor.header as Record<string, unknown>) ?? {};
    } else {
      const latest = revisions[revisions.length - 1] as { header?: Record<string, unknown> };
      header = latest?.header ?? {};
    }
    documents = await listEventDocuments({ eventId: String(resolved.event.id) });
  }
  return {
    link: resolved.link,
    event: resolved.event,
    estimate,
    revisions,
    lines,
    allLines,
    header,
    headerFields: DATA_FILE_HEADER_FIELDS,
    documents,
    ownRespCodes: Array.from(ownRespCodes),
    amountPresented,
    /** Hide pencil / admin — lessee may only approve/dispute own responsibility lines */
    readOnly: true,
    canPencilEdit: false,
    note:
      "Same estimate layout as internal review (header, lines, totals, attachments). " +
      "Read-only except approve/dispute on your responsibility lines (Resp 6). " +
      "Approve via this link (primary). Email reply requires reviewer confirmation.",
  };
}
