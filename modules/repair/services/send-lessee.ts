/**
 * Send Lessee Responsibility — preview page + local-mode outbox.
 * Never copies the shop. Local review: log to repair.email_outbox only (no real send).
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { getStorageProvider } from "../providers/storage";
import { resolveRecipients } from "./notifications";
import {
  listShopOriginalDocuments,
  resolveLesseeAttachments,
  type DocRow,
} from "./lessee-attachments";
import { sendLesseeApprovalRequest } from "./lessee-approval";
import { formatCentsAsMoney, formatCentsWithCommas } from "./money";
import { DATA_FILE_HEADER_FIELDS } from "./header-edits";

const LOCAL_MODE =
  process.env.REPAIR_LOCAL_DB === "1" ||
  process.env.REPAIR_LOCAL_REVIEW === "1" ||
  process.env.VITE_REPAIR_LOCAL_REVIEW === "1" ||
  process.env.NODE_ENV !== "production";

function isLocalMode() {
  return LOCAL_MODE;
}

export async function buildSendLesseePreview(opts: {
  estimateId: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows: est } = await q(
    `SELECT e.*, ev.car_mark, ev.car_number, ev.shop_id,
            s.name AS shop_name, s.shop_mark, s.reporting_mark
     FROM repair.estimates e
     JOIN repair.events ev ON ev.id = e.event_id
     LEFT JOIN repair.shops s ON s.id = ev.shop_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [opts.estimateId, tenantId],
  );
  if (!est[0]) {
    return { ok: false as const, status: 404, error: "Estimate not found" };
  }
  const estimate = est[0];
  const { rows: revRows } = await q(
    `SELECT * FROM repair.estimate_revisions
     WHERE estimate_id = $1 AND rev_no = $2`,
    [opts.estimateId, estimate.current_revision],
  );
  const revision = revRows[0];
  if (!revision) {
    return { ok: false as const, status: 404, error: "No current revision" };
  }

  const { rows: lines } = await q(
    `SELECT id, line_no, aar_job_code, qualifier, why_made, condition_code,
            resp_code, labor, material, total, labor_cents, material_cents,
            repair_category, description, raw_line
     FROM repair.estimate_lines
     WHERE revision_id = $1
     ORDER BY line_no ASC`,
    [revision.id],
  );

  const lesseeLines = lines.filter((l) => String(l.resp_code ?? "") === "6");
  let laborCents = 0;
  let materialCents = 0;
  for (const l of lesseeLines) {
    laborCents +=
      l.labor_cents != null
        ? Math.trunc(Number(l.labor_cents))
        : Math.round(Number(l.labor ?? 0) * 100);
    materialCents +=
      l.material_cents != null
        ? Math.trunc(Number(l.material_cents))
        : Math.round(Number(l.material ?? 0) * 100);
  }
  const totalCents = laborCents + materialCents;

  const gallery = await listShopOriginalDocuments({
    eventId: String(estimate.event_id),
    revisionId: String(revision.id),
    tenantId,
  });

  const recipients = await resolveRecipients({
    tenantId,
    eventId: String(estimate.event_id),
    type: "RESP6_LESSEE_EMAIL",
  });

  const carLabel = `${estimate.car_mark} ${estimate.car_number}`.trim();
  const defaultSubject = `Estimate approval requested — ${carLabel}`;
  const defaultBody = [
    `Please review and approve the Resp 6 (lessee) portion of the repair estimate for ${carLabel}.`,
    `Amount presented: ${formatCentsAsMoney(totalCents)}`,
    "",
    "Primary action: open the login-free lessee link included when this is sent.",
    "You may also reply with APPROVE or REJECT (subject to reviewer confirmation).",
    "",
    "Do not forward to the repair shop.",
  ].join("\n");

  const header =
    revision.header && typeof revision.header === "object"
      ? (revision.header as Record<string, unknown>)
      : {};

  const history = await listSendLesseeHistory({
    estimateId: opts.estimateId,
    tenantId,
  });

  return {
    ok: true as const,
    localMode: isLocalMode(),
    estimateId: opts.estimateId,
    eventId: String(estimate.event_id),
    revisionId: String(revision.id),
    carLabel,
    shopDisplay:
      estimate.shop_name ||
      estimate.shop_mark ||
      estimate.reporting_mark ||
      "",
    amountCents: totalCents,
    amountMoney: formatCentsAsMoney(totalCents),
    amountDisplay: formatCentsWithCommas(totalCents),
    recipients: recipients.to,
    excludedShop: recipients.excludedShop,
    subject: defaultSubject,
    body: defaultBody,
    header,
    headerFields: DATA_FILE_HEADER_FIELDS,
    lesseeLines: lesseeLines.map((l) => ({
      ...l,
      labor_money: formatCentsAsMoney(
        l.labor_cents != null
          ? Math.trunc(Number(l.labor_cents))
          : Math.round(Number(l.labor ?? 0) * 100),
      ),
      material_money: formatCentsAsMoney(
        l.material_cents != null
          ? Math.trunc(Number(l.material_cents))
          : Math.round(Number(l.material ?? 0) * 100),
      ),
      amount_money: formatCentsAsMoney(
        (l.labor_cents != null
          ? Math.trunc(Number(l.labor_cents))
          : Math.round(Number(l.labor ?? 0) * 100)) +
          (l.material_cents != null
            ? Math.trunc(Number(l.material_cents))
            : Math.round(Number(l.material ?? 0) * 100)),
      ),
    })),
    gallery: gallery.map((d: DocRow) => ({
      id: d.id,
      kind: d.kind,
      filename: d.original_filename || d.storage_key.split("/").pop() || d.kind,
      mime: d.mime,
      size: Number(d.size ?? 0),
      isPdf:
        (d.mime ?? "").toLowerCase().includes("pdf") ||
        (d.original_filename ?? "").toLowerCase().endsWith(".pdf"),
      isDataFile:
        d.kind === "aar_500byte" ||
        (d.original_filename ?? "").toLowerCase().endsWith(".txt") ||
        (d.original_filename ?? "").toLowerCase().endsWith(".dat"),
    })),
    alwaysInclude: {
      estimatePdf: true,
      dataFile500: true,
    },
    history: history.rows,
  };
}

export async function listSendLesseeHistory(opts: {
  estimateId: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT id, recipients, subject, attachment_bytes, status, local_mode,
            provider_message_id, note, created_by, created_at, attachments
     FROM repair.email_outbox
     WHERE estimate_id = $1 AND tenant_id = $2
       AND notification_type = 'RESP6_LESSEE_EMAIL'
     ORDER BY created_at DESC
     LIMIT 50`,
    [opts.estimateId, tenantId],
  );
  return { rows };
}

export async function previewAttachmentContent(opts: {
  estimateId: string;
  documentId?: string;
  kind?: "pdf" | "data";
  actor: string;
  tenantId?: string;
}) {
  const preview = await buildSendLesseePreview({
    estimateId: opts.estimateId,
    tenantId: opts.tenantId,
  });
  if (!preview.ok) return preview;

  if (opts.documentId) {
    const { rows } = await q<DocRow>(
      `SELECT id, kind, storage_key, mime, size, original_filename, revision_id
       FROM repair.documents WHERE id = $1 AND deleted_at IS NULL`,
      [opts.documentId],
    );
    if (!rows[0]) {
      return { ok: false as const, status: 404, error: "Document not found" };
    }
    const stored = await getStorageProvider().get(rows[0].storage_key);
    const bytes = stored.bytes;
    const mime = rows[0].mime || "application/octet-stream";
    const isText =
      mime.includes("text") ||
      rows[0].kind === "aar_500byte" ||
      (rows[0].original_filename ?? "").match(/\.(txt|dat)$/i);
    return {
      ok: true as const,
      documentId: rows[0].id,
      filename: rows[0].original_filename || rows[0].kind,
      mime,
      size: bytes.length,
      textPreview: isText
        ? bytes.toString("latin1").slice(0, 2000)
        : null,
      base64: isText ? null : bytes.toString("base64").slice(0, 200_000),
    };
  }

  // Build generated PDF / 500-byte without committing send
  const resolved = await resolveLesseeAttachments({
    eventId: preview.eventId,
    revisionId: preview.revisionId,
    tenantId: opts.tenantId,
    actor: opts.actor,
    carLabel: preview.carLabel,
  });
  const wantPdf = opts.kind === "pdf" || !opts.kind;
  const target = resolved.emailAttachments.find((a) =>
    wantPdf && opts.kind === "pdf"
      ? (a.contentType ?? "").includes("pdf") ||
        (a.filename ?? "").toLowerCase().endsWith(".pdf")
      : opts.kind === "data"
        ? (a.filename ?? "").match(/\.(txt|dat)$/i) ||
          (a.contentType ?? "").includes("text")
        : true,
  );
  if (!target?.storageKey) {
    return {
      ok: false as const,
      status: 404,
      error: "Preview attachment not available",
    };
  }
  const stored = await getStorageProvider().get(target.storageKey);
  const bytes = stored.bytes;
  const isText =
    (target.contentType ?? "").includes("text") ||
    (target.filename ?? "").match(/\.(txt|dat)$/i);
  return {
    ok: true as const,
    filename: target.filename,
    mime: target.contentType,
    size: bytes.length,
    textPreview: isText ? bytes.toString("latin1").slice(0, 2000) : null,
    base64: isText ? null : bytes.toString("base64").slice(0, 200_000),
    usedGeneratedPdf: resolved.usedGeneratedPdf,
    included500Byte: resolved.included500Byte,
  };
}

export async function sendLesseeFromPreview(opts: {
  estimateId: string;
  recipients: string[];
  subject: string;
  body: string;
  documentIds?: string[];
  includePdf?: boolean;
  includeDataFile?: boolean;
  note?: string;
  actor: string;
  confirm: boolean;
  tenantId?: string;
}) {
  if (!opts.confirm) {
    return {
      ok: false as const,
      status: 400,
      error: "Final confirm required before send",
    };
  }
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const recipients = [...new Set(opts.recipients.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!recipients.length) {
    return { ok: false as const, status: 400, error: "At least one recipient required" };
  }
  const subject = opts.subject.trim();
  const body = opts.body.trim();
  if (!subject || !body) {
    return { ok: false as const, status: 400, error: "Subject and body required" };
  }

  const preview = await buildSendLesseePreview({
    estimateId: opts.estimateId,
    tenantId,
  });
  if (!preview.ok) return preview;

  const localMode = isLocalMode();

  // Resolve attachments (PDF + 500-byte + gallery picks)
  const resolved = await resolveLesseeAttachments({
    eventId: preview.eventId,
    revisionId: preview.revisionId,
    tenantId,
    documentIds: opts.documentIds,
    actor: opts.actor,
    carLabel: preview.carLabel,
  });

  const attachmentBytes = resolved.emailAttachments.reduce(
    (s, a) => s + Number(a.size ?? 0),
    0,
  );

  const sent = await sendLesseeApprovalRequest({
    eventId: preview.eventId,
    estimateId: opts.estimateId,
    revisionId: preview.revisionId,
    lesseeEmail: recipients[0],
    extraTo: recipients.slice(1),
    documentIds: resolved.documentIds,
    actor: opts.actor,
    note: opts.note,
    subject,
    bodyText: body,
    tenantId,
  });
  if (!sent.ok) return sent;

  const { rows: outbox } = await q(
    `INSERT INTO repair.email_outbox
       (tenant_id, event_id, estimate_id, revision_id, notification_type,
        recipients, cc, subject, body_text, attachments, attachment_bytes,
        status, local_mode, provider_message_id, note, created_by)
     VALUES ($1,$2,$3,$4,'RESP6_LESSEE_EMAIL',$5::jsonb,'[]'::jsonb,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      tenantId,
      preview.eventId,
      opts.estimateId,
      preview.revisionId,
      JSON.stringify(recipients),
      subject,
      body,
      JSON.stringify(resolved.emailAttachments),
      attachmentBytes,
      localMode ? "logged" : sent.email?.status ?? "logged",
      localMode,
      sent.email?.providerMessageId ?? null,
      opts.note ?? null,
      opts.actor,
    ],
  );

  await writeAudit({
    tenantId,
    entity: "email_outbox",
    entityId: outbox[0].id,
    action: localMode ? "LESSEE_EMAIL_LOGGED_LOCAL" : "LESSEE_EMAIL_SENT",
    after: {
      recipients,
      subject,
      attachmentBytes,
      documentIds: resolved.documentIds,
      usedGeneratedPdf: resolved.usedGeneratedPdf,
      included500Byte: resolved.included500Byte,
      localMode,
      approvalId: sent.approval?.id,
    },
    actor: opts.actor,
    via: "UI",
  });

  return {
    ok: true as const,
    localMode,
    message: localMode
      ? "Logged (not sent – local mode)"
      : "Sent",
    outbox: outbox[0],
    approval: sent.approval,
    lesseeUrlPath: sent.lesseeUrlPath,
    recipients,
    attachmentBytes,
    attachments: {
      usedGeneratedPdf: resolved.usedGeneratedPdf,
      included500Byte: resolved.included500Byte,
      documentIds: resolved.documentIds,
      count: resolved.emailAttachments.length,
    },
  };
}
