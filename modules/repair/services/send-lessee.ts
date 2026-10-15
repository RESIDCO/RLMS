/**
 * Send Lessee Responsibility — customary email preview + local-mode outbox.
 * Local review: log to repair.email_outbox + write .eml (never real send).
 * Blocks send when lessee total is $0 or preview/PDF/data/email cents disagree.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { getStorageProvider } from "../providers/storage";
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
import {
  extractBrcTotalCents,
  displayCarNumber,
} from "./brc-pdf";
import {
  buildLesseeResponsibilityEmail,
  writeLesseeEmailEml,
} from "./lessee-email";

const LOCAL_MODE =
  process.env.REPAIR_LOCAL_DB === "1" ||
  process.env.REPAIR_LOCAL_REVIEW === "1" ||
  process.env.VITE_REPAIR_LOCAL_REVIEW === "1" ||
  process.env.NODE_ENV !== "production";

function isLocalMode() {
  return LOCAL_MODE;
}

/** Sum cents embedded in a generated BRC / lessee PDF text layer. */
export function extractPdfLesseeTotalCents(pdfBytes: Buffer): number | null {
  return extractBrcTotalCents(pdfBytes);
}

async function assertNotWreckEstimate(estimateId: string, tenantId: string) {
  const { rows } = await q(
    `SELECT e.id, e.is_wreck, est.wreck_track_type, we.id AS wreck_event_id
     FROM repair.estimates est
     JOIN repair.events e ON e.id = est.event_id
     LEFT JOIN repair.wreck_events we ON we.event_id = e.id AND we.deleted_at IS NULL
     WHERE est.id = $1 AND est.tenant_id = $2 AND est.deleted_at IS NULL`,
    [estimateId, tenantId],
  );
  if (!rows[0]) {
    return { ok: false as const, status: 404, error: "Estimate not found" };
  }
  if (rows[0].is_wreck || rows[0].wreck_event_id || rows[0].wreck_track_type === "R107_RESP3") {
    return {
      ok: false as const,
      status: 403,
      error:
        "Wreck estimates are excluded from Send Lessee entirely (Bruce §11 #9) — no lessee rebill on wreck",
    };
  }
  return { ok: true as const };
}

export async function buildSendLesseePreview(opts: {
  estimateId: string;
  tenantId?: string;
  taxCents?: number;
  actor?: string;
  actorEmail?: string;
  actorFullName?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const wreckGate = await assertNotWreckEstimate(opts.estimateId, tenantId);
  if (!wreckGate.ok) return { ok: false as const, error: wreckGate.error };

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

  const { rows: shopMeta } = await q(
    `SELECT s.name AS shop_name, s.city, s.state, s.shop_mark,
            e.entity_code, ev.car_mark, ev.car_number
     FROM repair.estimates e
     JOIN repair.events ev ON ev.id = e.event_id
     LEFT JOIN repair.shops s ON s.id = ev.shop_id
     WHERE e.id = $1`,
    [opts.estimateId],
  );
  const shop = shopMeta[0] ?? {};
  const carInitial =
    String(bundle.header.carInitial ?? shop.car_mark ?? "").trim() ||
    bundle.carLabel.split(/\s+/)[0] ||
    "";
  const carNumber =
    String(bundle.header.carNumber ?? shop.car_number ?? "").trim() ||
    bundle.carLabel.split(/\s+/).slice(1).join("") ||
    "";
  const shopCityState = [shop.city, shop.state].filter(Boolean).join(", ");
  const estimateNo = opts.estimateId.replace(/-/g, "").slice(0, 8).toUpperCase();

  const actor = opts.actor || opts.actorEmail || "owner";
  const draft = await buildLesseeResponsibilityEmail({
    estimateId: opts.estimateId,
    eventId: bundle.eventId,
    carInitial,
    carNumber,
    shopName: String(shop.shop_name || bundle.shopDisplay || ""),
    shopCityState,
    amountCents: bundle.totalCents,
    actor,
    actorEmail: opts.actorEmail || (actor.includes("@") ? actor : undefined),
    actorFullName: opts.actorFullName || actor,
    entityCode: shop.entity_code != null ? String(shop.entity_code) : null,
    estimateNo,
    approveUrlPath: null,
    tenantId,
    extraTo: undefined,
  });

  // Ensure at least demo recipients surface when contact bank empty
  const recipients =
    draft.to.length > 0
      ? draft.to
      : [];

  const history = await listSendLesseeHistory({
    estimateId: opts.estimateId,
    tenantId,
  });

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
  const attachmentNames = draft.attachmentNames;

  return {
    ok: true as const,
    localMode: isLocalMode(),
    estimateId: opts.estimateId,
    eventId: bundle.eventId,
    revisionId: bundle.revisionId,
    carLabel: bundle.carLabel,
    carInitial,
    carNumber,
    carNumberDisplay: displayCarNumber(carNumber),
    shopDisplay: bundle.shopDisplay,
    amountCents: bundle.totalCents,
    amountMoney: bundle.amountMoney,
    amountDisplay: bundle.amountDisplay,
    laborCents: bundle.laborCents,
    materialCents: bundle.materialCents,
    linesTotalCents: bundle.linesTotalCents,
    taxCents: bundle.taxCents,
    recipients,
    cc: draft.cc,
    from: draft.from,
    fromName: draft.fromName,
    replyTo: draft.replyTo,
    excludedShopFromTo: true,
    subject: draft.subject,
    body: draft.bodyText,
    bodyHtml: draft.bodyHtml,
    emailTable: draft.table,
    attachmentNames,
    responseHours: draft.responseHours,
    responseBusinessDays: draft.responseBusinessDays,
    responseWindowPhrase: draft.responseWindowPhrase,
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
      pdfName: attachmentNames.pdf,
      dataName: attachmentNames.data500,
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
    `SELECT id, recipients, cc, subject, attachment_bytes, status, local_mode,
            provider_message_id, note, created_by, created_at, attachments, eml_path
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
    actor: opts.actor,
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
    carInitial: preview.carInitial,
    carNumber: preview.carNumber,
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
  actorEmail?: string;
  actorFullName?: string;
  confirm: boolean;
  tenantId?: string;
  taxCents?: number;
  cc?: string[];
}) {
  if (!opts.confirm) {
    return {
      ok: false as const,
      status: 400,
      error: "Final confirm required before send",
    };
  }
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const wreckGate = await assertNotWreckEstimate(opts.estimateId, tenantId);
  if (!wreckGate.ok) {
    return { ok: false as const, status: 409, error: wreckGate.error };
  }
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
    actor: opts.actor,
    actorEmail: opts.actorEmail,
    actorFullName: opts.actorFullName,
  });
  if (!preview.ok) return preview;

  const resolved = await resolveLesseeAttachments({
    eventId: preview.eventId,
    revisionId: preview.revisionId,
    tenantId,
    documentIds: opts.documentIds,
    actor: opts.actor,
    carLabel: preview.carLabel,
    estimateId: opts.estimateId,
    lesseeOnly: true,
    carInitial: preview.carInitial,
    carNumber: preview.carNumber,
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

  const cc = [
    ...new Set(
      (opts.cc ?? preview.cc ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean),
    ),
  ].filter((e) => !recipients.includes(e));

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
    bodyHtml: preview.bodyHtml,
    cc,
    replyTo: preview.replyTo ?? undefined,
    fromEmail: preview.from,
    tenantId,
    amountPresentedCents: preview.amountCents,
    skipAttachmentsResolve: true,
    preResolvedAttachments: resolved,
  });
  if (!sent.ok) return sent;

  let emlPath: string | null = null;
  if (localMode) {
    const attBytes: Array<{
      filename: string;
      contentType: string;
      bytes: Buffer;
    }> = [];
    if (resolved.pdfBytes) {
      attBytes.push({
        filename: resolved.pdfFilename,
        contentType: "application/pdf",
        bytes: resolved.pdfBytes,
      });
    }
    if (resolved.dataBytes) {
      attBytes.push({
        filename: resolved.dataFilename,
        contentType: "text/plain",
        bytes: resolved.dataBytes,
      });
    }
    for (const a of resolved.emailAttachments) {
      if (
        a.filename === resolved.pdfFilename ||
        a.filename === resolved.dataFilename
      ) {
        continue;
      }
      if (!a.storageKey) continue;
      try {
        const stored = await getStorageProvider().get(a.storageKey);
        attBytes.push({
          filename: a.filename || "attachment",
          contentType: a.contentType || "application/octet-stream",
          bytes: stored.bytes,
        });
      } catch {
        /* skip missing */
      }
    }
    const draft = {
      subject,
      from: preview.from,
      fromName: preview.fromName,
      to: recipients,
      cc,
      replyTo: preview.replyTo,
      bodyText: body,
      bodyHtml: preview.bodyHtml,
      table: preview.emailTable,
      attachmentNames: preview.attachmentNames,
      responseHours: preview.responseHours,
      responseBusinessDays: preview.responseBusinessDays,
      responseWindowPhrase: preview.responseWindowPhrase,
      approveUrlPath: sent.lesseeUrlPath ?? null,
      carLabel: preview.carLabel,
      shopDisplay: preview.shopDisplay,
    };
    const written = await writeLesseeEmailEml({
      draft,
      attachments: attBytes,
      tenantId,
    });
    emlPath = written.relPath;
  }

  const { rows: outbox } = await q(
    `INSERT INTO repair.email_outbox
       (tenant_id, event_id, estimate_id, revision_id, notification_type,
        recipients, cc, subject, body_text, body_html, attachments, attachment_bytes,
        status, local_mode, provider_message_id, note, created_by, eml_path)
     VALUES ($1,$2,$3,$4,'RESP6_LESSEE_EMAIL',$5::jsonb,$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      tenantId,
      preview.eventId,
      opts.estimateId,
      preview.revisionId,
      JSON.stringify(recipients),
      JSON.stringify(cc),
      subject,
      body,
      preview.bodyHtml,
      JSON.stringify(resolved.emailAttachments),
      attachmentBytes,
      localMode ? "logged" : sent.email?.status ?? "logged",
      localMode,
      sent.email?.providerMessageId ?? null,
      opts.note ?? null,
      opts.actor,
      emlPath,
    ],
  );

  await writeAudit({
    tenantId,
    entity: "email_outbox",
    entityId: outbox[0].id,
    action: localMode ? "LESSEE_EMAIL_LOGGED_LOCAL" : "LESSEE_EMAIL_SENT",
    after: {
      recipients,
      cc,
      subject,
      attachmentBytes,
      documentIds: resolved.documentIds,
      usedGeneratedPdf: resolved.usedGeneratedPdf,
      included500Byte: resolved.included500Byte,
      pdfFilename: resolved.pdfFilename,
      dataFilename: resolved.dataFilename,
      localMode,
      emlPath,
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
    emlPath,
    approval: sent.approval,
    lesseeUrlPath: sent.lesseeUrlPath,
    recipients,
    cc,
    attachmentBytes,
    amountCents: preview.amountCents,
    attachments: {
      usedGeneratedPdf: resolved.usedGeneratedPdf,
      included500Byte: resolved.included500Byte,
      documentIds: resolved.documentIds,
      count: resolved.emailAttachments.length,
      pdfFilename: resolved.pdfFilename,
      dataFilename: resolved.dataFilename,
    },
  };
}
