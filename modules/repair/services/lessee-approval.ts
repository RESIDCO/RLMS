/**
 * Resp 6 lessee estimate approval.
 * - Login-free link is primary (included in every lessee email).
 * - Email reply is secondary; requires reviewer confirmation.
 * - Shop is never copied on lessee emails.
 */

import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { issueEventLink } from "./event-links";
import { getEmailProvider } from "../providers/email";
import { getInboundEmailProvider } from "../providers/inbound-email";

export async function sendLesseeApprovalRequest(opts: {
  eventId: string;
  estimateId: string;
  revisionId: string;
  lesseeEmail: string;
  documentIds?: string[];
  actor: string;
  tenantId?: string;
  /** Optional note shown in email body */
  note?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const email = opts.lesseeEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false as const, status: 400, error: "Valid lesseeEmail required" };
  }

  const { rows: est } = await q(
    `SELECT e.*, ev.car_mark, ev.car_number
     FROM repair.estimates e
     JOIN repair.events ev ON ev.id = e.event_id
     WHERE e.id = $1 AND e.event_id = $2 AND e.tenant_id = $3 AND e.deleted_at IS NULL`,
    [opts.estimateId, opts.eventId, tenantId],
  );
  if (!est[0]) return { ok: false as const, status: 404, error: "Estimate not found" };

  const issued = await issueEventLink({
    eventId: opts.eventId,
    scope: "LESSEE",
    partyRef: email,
    actor: opts.actor,
    tenantId,
  });

  const linkPath = `/repair/lessee/${issued.token}`;
  const subject = `Estimate approval requested — ${est[0].car_mark} ${est[0].car_number}`;
  const bodyText = [
    `Please review and approve the repair estimate for ${est[0].car_mark} ${est[0].car_number}.`,
    "",
    `Primary action (login-free link): open ${linkPath}`,
    "You may also reply to this email with APPROVE or REJECT (subject to reviewer confirmation).",
    "",
    "Attachments: estimate PDF + matching 500-byte detail file (when present).",
    opts.note ? `\nNote from reviewer: ${opts.note}` : "",
    "",
    "Do not forward to the repair shop.",
  ]
    .filter(Boolean)
    .join("\n");

  const send = await getEmailProvider().send({
    tenantId,
    eventId: opts.eventId,
    type: "LESSEE_ESTIMATE_APPROVAL",
    to: [email],
    // Shop never copied
    cc: [],
    subject,
    bodyText,
    replyTo: `lessee-reply+${issued.link.id}@repair.local`,
    attachments: (opts.documentIds ?? []).map((id) => ({
      filename: id,
      contentType: "application/octet-stream",
      storageKey: id,
    })),
  });

  const { rows } = await q(
    `INSERT INTO repair.lessee_approvals
       (tenant_id, event_id, estimate_id, revision_id, lessee_email, status,
        document_ids, outbound_email_id, link_id, created_by)
     VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8,$9)
     RETURNING *`,
    [
      tenantId,
      opts.eventId,
      opts.estimateId,
      opts.revisionId,
      email,
      opts.documentIds ?? [],
      send.providerMessageId,
      issued.link.id,
      opts.actor,
    ],
  );

  await writeAudit({
    tenantId,
    entity: "lessee_approval",
    entityId: rows[0].id,
    action: "LESSEE_APPROVAL_SENT",
    after: {
      lesseeEmail: email,
      linkId: issued.link.id,
      documentCount: opts.documentIds?.length ?? 0,
      emailStatus: send.status,
    },
    actor: opts.actor,
    via: "UI",
  });

  return {
    ok: true as const,
    approval: rows[0],
    token: issued.token,
    lesseeUrlPath: linkPath,
    email: send,
  };
}

export async function approveViaLesseeLink(opts: {
  rawToken: string;
  decision: "APPROVE" | "REJECT";
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
  if (opts.decision !== "APPROVE") {
    await q(
      `UPDATE repair.lessee_approvals
       SET status = 'EXPIRED', decided_at = now()
       WHERE id = $1`,
      [approval.id],
    );
    await writeAudit({
      tenantId: approval.tenant_id,
      entity: "lessee_approval",
      entityId: approval.id,
      action: "LESSEE_REJECT_VIA_LINK",
      actor: approval.lessee_email,
      via: "event_link",
    });
    return { ok: true as const, status: "REJECTED_VIA_LINK" };
  }

  const { rows: updated } = await q(
    `UPDATE repair.lessee_approvals
     SET status = 'APPROVED_VIA_LINK', decided_at = now()
     WHERE id = $1
     RETURNING *`,
    [approval.id],
  );
  await writeAudit({
    tenantId: approval.tenant_id,
    entity: "lessee_approval",
    entityId: approval.id,
    action: "LESSEE_APPROVE_VIA_LINK",
    actor: approval.lessee_email,
    via: "event_link",
  });
  return { ok: true as const, approval: updated[0] };
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

  const decision =
    recorded.parsed.proposedDecision === "APPROVED"
      ? "APPROVE"
      : recorded.parsed.proposedDecision === "REJECTED"
        ? "REJECT"
        : "UNKNOWN";

  const { rows } = await q(
    `UPDATE repair.lessee_approvals
     SET status = 'REPLY_RECEIVED', reply_inbound_id = $2
     WHERE id = $1 AND status = 'PENDING'
     RETURNING *`,
    [opts.approvalId, recorded.id],
  );
  if (!rows[0]) {
    return { ok: false as const, status: 404, error: "Pending approval not found" };
  }
  await writeAudit({
    tenantId: rows[0].tenant_id,
    entity: "lessee_approval",
    entityId: rows[0].id,
    action: "LESSEE_REPLY_RECEIVED",
    after: { decisionHint: decision },
    actor: opts.actor ?? rows[0].lessee_email,
    via: "inbound_email",
  });
  return {
    ok: true as const,
    approval: rows[0],
    decisionHint: decision,
    note: "Reply recorded; reviewer confirmation required before finalizing.",
  };
}

export async function confirmLesseeReply(opts: {
  approvalId: string;
  accept: boolean;
  actor: string;
}) {
  const status = opts.accept ? "REPLY_CONFIRMED" : "REPLY_REJECTED";
  const { rows } = await q(
    `UPDATE repair.lessee_approvals
     SET status = $2,
         reviewer_confirmed_by = $3,
         reviewer_confirmed_at = now(),
         decided_at = now()
     WHERE id = $1 AND status = 'REPLY_RECEIVED' AND deleted_at IS NULL
     RETURNING *`,
    [opts.approvalId, status, opts.actor],
  );
  if (!rows[0]) {
    return { ok: false as const, status: 409, error: "Approval not awaiting reply confirmation" };
  }
  await writeAudit({
    tenantId: rows[0].tenant_id,
    entity: "lessee_approval",
    entityId: rows[0].id,
    action: opts.accept ? "LESSEE_REPLY_CONFIRMED" : "LESSEE_REPLY_REJECTED_BY_REVIEWER",
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, approval: rows[0] };
}
