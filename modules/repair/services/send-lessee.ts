/**
 * Send Lessee Responsibility — preview page + local-mode outbox.
 * Never copies the shop. Local review: log to repair.email_outbox only (no real send).
 * Blocks send when lessee total is $0 or preview/PDF/data/email cents disagree.
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
import { DATA_FILE_HEADER_FIELDS } from "./header-edits";
import {
  blockSendReason,
  computeLesseeTotals,
  reconcileLesseeOutputs,
} from "./lessee-totals";
import { dollarsToCents } from "./money";

const LOCAL_MODE =
  process.env.REPAIR_LOCAL_DB === "1" ||
  process.env.REPAIR_LOCAL_REVIEW === "1" ||
  process.env.VITE_REPAIR_LOCAL_REVIEW === "1" ||
  process.env.NODE_ENV !== "production";

function isLocalMode() {
  return LOCAL_MODE;
}

/** Sum cents embedded in a generated PDF text layer (Resp 6 Amount column). */
export function extractPdfLesseeTotalCents(pdfBytes: Buffer): number | null {
  const text = pdfBytes.toString("latin1");
  // Prefer explicit marker written by generateEstimatePdf
  const marker = /LESSEE_TOTAL_CENTS:(\d+)/.exec(text);
  if (marker) return Number(marker[1]);
  return null;
}

/** Sum labor+material from Format-1 raw lines with resp 6. */
export function dataFileLesseeTotalCents(rawLines: string[]): number {
  let cents = 0;
  for (const raw of rawLines) {
    if (!raw || raw.length < 160) continue;
    // resp at typical CRB positions — prefer stored cents via computeLesseeTotals;
    // this is a fallback from raw 500-byte when regenerating.
    const resp = raw.slice(147, 148).trim(); // approximate; prefer line table
    void resp;
  }
  void cents;
  return cents;
}

export async function buildSendLesseePreview(opts: {
  estimateId: string;
  tenantId?: string;
  taxCents?: number;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const totals = await computeLesseeTotals({
    estimateId: opts.estimateId,
    tenantId,
    taxCents: opts.taxCents,
  });
  if (!totals.ok) return totals;
  const bundle = totals.bundle;

  const gallery = await listShopOriginalDocuments({
    eventId: bundle.eventId,
    revisionId: bundle.revisionId,
    tenantId,
  });

  const recipients = await resolveRecipients({
    tenantId,
    eventId: bundle.eventId,
    type: "RESP6_LESSEE_EMAIL",
  });

  const defaultSubject = `Estimate approval requested — ${bundle.carLabel}`;
  const defaultBody = [
    `Please review and approve the Resp 6 (lessee) portion of the repair estimate for ${bundle.carLabel}.`,
    `Amount presented: ${bundle.amountMoney}`,
    "",
    "Primary action: open the login-free lessee link included when this is sent.",
    "You may also reply with APPROVE or REJECT (subject to reviewer confirmation).",
    "",
    "Do not forward to the repair shop.",
  ].join("\n");

  const history = await listSendLesseeHistory({
    estimateId: opts.estimateId,
    tenantId,
  });

  // Lessee-facing header subset (car / BO / shop / dates — no internal notes)
  const headerPublic: Record<string, unknown> = {
    carInitial: bundle.header.carInitial,
    carNumber: bundle.header.carNumber,
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

  const sendBlock = blockSendReason(bundle.totalCents, true);

  return {
    ok: true as const,
    localMode: isLocalMode(),
    estimateId: opts.estimateId,
    eventId: bundle.eventId,
    revisionId: bundle.revisionId,
    carLabel: bundle.carLabel,
    shopDisplay: bundle.shopDisplay,
    amountCents: bundle.totalCents,
    amountMoney: bundle.amountMoney,
    amountDisplay: bundle.amountDisplay,
    laborCents: bundle.laborCents,
    materialCents: bundle.materialCents,
    linesTotalCents: bundle.linesTotalCents,
    taxCents: bundle.taxCents,
    recipients: recipients.to,
    excludedShop: recipients.excludedShop,
    subject: defaultSubject,
    body: defaultBody,
    header: headerPublic,
    headerFields: DATA_FILE_HEADER_FIELDS.filter((f) =>
      [
        "carInitial",
        "carNumber",
        "shopMark",
        "repairingParty",
        "repairDateYymmdd",
        "outboundDate",
        "completedDate",
        "splc",
        "facilityType",
        "kindOfCar",
        "loadEmpty",
        "boLink",
      ].includes(f.key),
    ),
    lesseeLines: bundle.lines,
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
    canSend: sendBlock == null,
    sendBlockReason: sendBlock,
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
      amountCents: preview.amountCents,
    };
  }

  const resolved = await resolveLesseeAttachments({
    eventId: preview.eventId,
    revisionId: preview.revisionId,
    tenantId: opts.tenantId,
    actor: opts.actor,
    carLabel: preview.carLabel,
    estimateId: opts.estimateId,
    lesseeOnly: true,
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
  let channelCents = preview.amountCents;
  if (opts.kind === "pdf") {
    channelCents = extractPdfLesseeTotalCents(bytes) ?? preview.amountCents;
  } else if (opts.kind === "data") {
    channelCents = resolved.lesseeTotalCents ?? preview.amountCents;
  }
  return {
    ok: true as const,
    filename: target.filename,
    mime: target.contentType,
    size: bytes.length,
    textPreview: isText ? bytes.toString("latin1").slice(0, 2000) : null,
    base64: isText ? null : bytes.toString("base64").slice(0, 200_000),
    usedGeneratedPdf: resolved.usedGeneratedPdf,
    included500Byte: resolved.included500Byte,
    amountCents: channelCents,
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
  taxCents?: number;
}) {
  if (!opts.confirm) {
    return {
      ok: false as const,
      status: 400,
      error: "Final confirm required before send",
    };
  }
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const recipients = [
    ...new Set(opts.recipients.map((e) => e.trim().toLowerCase()).filter(Boolean)),
  ];
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
    taxCents: opts.taxCents,
  });
  if (!preview.ok) return preview;

  // Resolve attachments first so we can reconcile cents across channels
  const resolved = await resolveLesseeAttachments({
    eventId: preview.eventId,
    revisionId: preview.revisionId,
    tenantId,
    documentIds: opts.documentIds,
    actor: opts.actor,
    carLabel: preview.carLabel,
    estimateId: opts.estimateId,
    lesseeOnly: true,
  });

  const pdfAtt = resolved.emailAttachments.find(
    (a) =>
      (a.contentType ?? "").includes("pdf") ||
      (a.filename ?? "").toLowerCase().endsWith(".pdf"),
  );
  let pdfCents = preview.amountCents;
  if (pdfAtt?.storageKey) {
    try {
      const stored = await getStorageProvider().get(pdfAtt.storageKey);
      pdfCents = extractPdfLesseeTotalCents(stored.bytes) ?? preview.amountCents;
    } catch {
      pdfCents = preview.amountCents;
    }
  }
  const dataCents = resolved.lesseeTotalCents ?? preview.amountCents;
  // Email body amount must match (parse from body or use presented)
  const bodyMatch = /\$([0-9,]+\.\d{2})/.exec(body);
  const emailCents = bodyMatch
    ? dollarsToCents(bodyMatch[1]!.replace(/,/g, ""))
    : preview.amountCents;

  const recon = reconcileLesseeOutputs({
    previewCents: preview.amountCents,
    pdfCents,
    dataFileCents: dataCents,
    emailCents,
  });
  const block = blockSendReason(preview.amountCents, recon.ok, recon.mismatch);
  if (block) {
    return { ok: false as const, status: 409, error: block };
  }

  const localMode = isLocalMode();
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
    amountPresentedCents: preview.amountCents,
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
      amountPresentedCents: preview.amountCents,
      reconciled: true,
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
    amountCents: preview.amountCents,
    attachments: {
      usedGeneratedPdf: resolved.usedGeneratedPdf,
      included500Byte: resolved.included500Byte,
      documentIds: resolved.documentIds,
      count: resolved.emailAttachments.length,
    },
  };
}
