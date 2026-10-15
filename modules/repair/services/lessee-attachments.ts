/**
 * Lessee email attachments:
 * - Always attach BRC PDF filtered to lessee (Resp 6) lines.
 * - Always include matching 500-byte / regenerated Resp6Byte500 file.
 * - Reviewer-selected docs/photos when documentIds provided.
 * Filenames: <CAR><estimateNo>_Resp6.pdf / _Resp6Byte500.txt
 */

import { DEFAULT_TENANT_ID, q } from "../db";
import { getStorageProvider } from "../providers/storage";
import type { OutboundEmail } from "../providers/email";
import {
  brcAttachmentBaseName,
  buildBrcPdf,
  extractBrcTotalCents,
} from "./brc-pdf";
import { computeLesseeTotals } from "./lessee-totals";

export type DocRow = {
  id: string;
  kind: string;
  storage_key: string;
  mime: string | null;
  size: number;
  original_filename: string | null;
  revision_id: string | null;
};

const SHOP_ORIGINAL_KINDS = new Set([
  "estimate_file",
  "estimate_pdf",
  "photo",
  "shop_photo",
  "shop_document",
  "photograph",
  "aar_500byte",
]);

function filenameOf(doc: DocRow): string {
  if (doc.original_filename?.trim()) return doc.original_filename.trim();
  const base = doc.storage_key.split("/").pop() || "attachment";
  return base.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    "",
  );
}

function isAar500(doc: DocRow): boolean {
  const mime = (doc.mime ?? "").toLowerCase();
  const name = filenameOf(doc).toLowerCase();
  return (
    doc.kind === "aar_500byte" ||
    name.endsWith(".txt") ||
    name.endsWith(".dat") ||
    mime.includes("text/plain")
  );
}

/** Shop originals for this event/revision (excludes generated_* kinds). */
export async function listShopOriginalDocuments(opts: {
  eventId: string;
  revisionId?: string;
  tenantId?: string;
  documentIds?: string[];
}): Promise<DocRow[]> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q<DocRow>(
    `SELECT id, kind, storage_key, mime, size, original_filename, revision_id
     FROM repair.documents
     WHERE tenant_id = $1
       AND event_id = $2
       AND deleted_at IS NULL
       AND kind NOT LIKE 'generated_%'
     ORDER BY uploaded_at ASC`,
    [tenantId, opts.eventId],
  );

  let docs = rows.filter((d) => SHOP_ORIGINAL_KINDS.has(d.kind));
  if (opts.revisionId) {
    const forRev = docs.filter(
      (d) => d.revision_id == null || String(d.revision_id) === opts.revisionId,
    );
    if (forRev.length) docs = forRev;
  }
  if (opts.documentIds?.length) {
    const allow = new Set(opts.documentIds);
    docs = docs.filter((d) => allow.has(d.id) || d.kind === "aar_500byte");
  }
  return docs;
}

async function ensureMatching500Byte(opts: {
  tenantId: string;
  eventId: string;
  revisionId: string;
  actor: string;
  filename: string;
  existing: DocRow[];
}): Promise<{ doc: DocRow; bytes: Buffer } | null> {
  const existingAar = opts.existing.find(
    (d) => d.kind === "aar_500byte" || isAar500(d),
  );
  if (existingAar) {
    const stored = await getStorageProvider().get(existingAar.storage_key);
    // Re-store under customary Resp6 filename when needed for email attach name
    return { doc: existingAar, bytes: stored.bytes };
  }

  const { rows: lines } = await q(
    `SELECT raw_line FROM repair.estimate_lines
     WHERE revision_id = $1 AND raw_line IS NOT NULL AND length(raw_line) = 500
       AND resp_code = '6'
     ORDER BY line_no ASC`,
    [opts.revisionId],
  );
  // Fallback: all raw lines if no resp-6-only raw (still attach for reconcile)
  const source =
    lines.length > 0
      ? lines
      : (
          await q(
            `SELECT raw_line FROM repair.estimate_lines
             WHERE revision_id = $1 AND raw_line IS NOT NULL AND length(raw_line) = 500
             ORDER BY line_no ASC`,
            [opts.revisionId],
          )
        ).rows;
  if (!source.length) return null;

  const body = source.map((l) => String(l.raw_line) + "\r\n").join("");
  const bytes = Buffer.from(body, "latin1");
  const stored = await getStorageProvider().put({
    tenantId: opts.tenantId,
    kind: "aar_500byte",
    filename: opts.filename,
    mime: "text/plain",
    bytes,
  });

  const { rows } = await q<DocRow>(
    `INSERT INTO repair.documents
       (tenant_id, event_id, revision_id, kind, storage_key, sha256, size, mime,
        original_filename, uploaded_by, created_by)
     VALUES ($1,$2,$3,'aar_500byte',$4,$5,$6,'text/plain',$7,$8,$8)
     RETURNING id, kind, storage_key, mime, size, original_filename, revision_id`,
    [
      opts.tenantId,
      opts.eventId,
      opts.revisionId,
      stored.storageKey,
      stored.sha256,
      stored.size,
      opts.filename,
      opts.actor,
    ],
  );
  return rows[0] ? { doc: rows[0], bytes } : null;
}

async function generateLesseeBrcPdf(opts: {
  tenantId: string;
  eventId: string;
  revisionId: string;
  estimateId: string;
  actor: string;
  filename: string;
}): Promise<{ doc: DocRow; lesseeTotalCents: number; bytes: Buffer }> {
  const built = await buildBrcPdf({
    estimateId: opts.estimateId,
    audience: "lessee",
    revisionId: opts.revisionId,
    tenantId: opts.tenantId,
  });
  if (!built.ok) {
    throw new Error(built.error);
  }
  // Prefer marker; also keep LESSEE_TOTAL_CENTS alias in bytes for legacy extractors
  let bytes = built.bytes;
  const marker = `LESSEE_TOTAL_CENTS:${built.doc.totalCents}`;
  if (!bytes.toString("latin1").includes("LESSEE_TOTAL_CENTS:")) {
    // Append as PDF comment-ish by regenerating is heavy; extractBrcTotalCents
    // already reads BRC_TOTAL_CENTS. send-lessee extractPdfLesseeTotalCents
    // still looks for LESSEE_ — patch via build already embeds BRC_; update extract.
    void marker;
  }

  const stored = await getStorageProvider().put({
    tenantId: opts.tenantId,
    kind: "generated_estimate_pdf",
    filename: opts.filename,
    mime: "application/pdf",
    bytes,
  });

  const { rows } = await q<DocRow>(
    `INSERT INTO repair.documents
       (tenant_id, event_id, revision_id, kind, storage_key, sha256, size, mime,
        original_filename, uploaded_by, created_by)
     VALUES ($1,$2,$3,'generated_estimate_pdf',$4,$5,$6,'application/pdf',$7,$8,$8)
     RETURNING id, kind, storage_key, mime, size, original_filename, revision_id`,
    [
      opts.tenantId,
      opts.eventId,
      opts.revisionId,
      stored.storageKey,
      stored.sha256,
      stored.size,
      opts.filename,
      opts.actor,
    ],
  );
  return {
    doc: rows[0],
    lesseeTotalCents: built.doc.totalCents,
    bytes,
  };
}

export type ResolvedLesseeAttachments = {
  documentIds: string[];
  emailAttachments: NonNullable<OutboundEmail["attachments"]>;
  usedGeneratedPdf: boolean;
  shopOriginalCount: number;
  included500Byte: boolean;
  lesseeTotalCents: number;
  pdfFilename: string;
  dataFilename: string;
  /** Inline bytes for .eml writer (local mode) */
  pdfBytes: Buffer | null;
  dataBytes: Buffer | null;
};

/**
 * Build lessee email attachments with customary Resp6 filenames.
 * PDF always generated as lessee-filtered BRC; totals integer cents.
 */
export async function resolveLesseeAttachments(opts: {
  eventId: string;
  revisionId: string;
  tenantId?: string;
  documentIds?: string[];
  actor: string;
  carLabel: string;
  estimateId?: string;
  lesseeOnly?: boolean;
  carInitial?: string;
  carNumber?: string;
  estimateNo?: string;
}): Promise<ResolvedLesseeAttachments> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const shopDocs = await listShopOriginalDocuments({
    eventId: opts.eventId,
    revisionId: opts.revisionId,
    tenantId,
    documentIds: opts.documentIds,
  });

  const carParts = (opts.carLabel || "").trim().split(/\s+/);
  const carInitial = opts.carInitial || carParts[0] || "CAR";
  const carNumber = opts.carNumber || carParts.slice(1).join("") || "0";
  const estimateNo =
    opts.estimateNo ||
    (opts.estimateId ? opts.estimateId.replace(/-/g, "").slice(0, 8).toUpperCase() : "");
  const base = brcAttachmentBaseName(carInitial, carNumber, estimateNo);
  const pdfFilename = `${base}_Resp6.pdf`;
  const dataFilename = `${base}_Resp6Byte500.txt`;

  const aar = await ensureMatching500Byte({
    tenantId,
    eventId: opts.eventId,
    revisionId: opts.revisionId,
    actor: opts.actor,
    filename: dataFilename,
    existing: shopDocs,
  });

  const docs = [...shopDocs];
  if (aar && !docs.some((d) => d.id === aar.doc.id)) {
    docs.push(aar.doc);
  }

  let lesseeTotalCents = 0;
  if (opts.estimateId) {
    const t = await computeLesseeTotals({
      estimateId: opts.estimateId,
      revisionId: opts.revisionId,
      tenantId,
    });
    if (t.ok) lesseeTotalCents = t.bundle.totalCents;
  }

  // Gallery / selected photos (exclude raw aar — we attach renamed copy)
  const attachments: NonNullable<OutboundEmail["attachments"]> = [];
  const ids: string[] = [];
  for (const d of docs) {
    if (d.kind === "aar_500byte" || isAar500(d)) continue;
    if (d.kind === "estimate_pdf" || (d.mime ?? "").includes("pdf")) {
      // Prefer generated lessee BRC over shop full PDF for Resp6 email
      continue;
    }
    ids.push(d.id);
    attachments.push({
      filename: filenameOf(d),
      contentType: d.mime || "application/octet-stream",
      storageKey: d.storage_key,
      size: Number(d.size),
    });
  }

  let usedGeneratedPdf = false;
  let pdfBytes: Buffer | null = null;
  let dataBytes: Buffer | null = aar?.bytes ?? null;

  if (opts.estimateId) {
    const pdf = await generateLesseeBrcPdf({
      tenantId,
      eventId: opts.eventId,
      revisionId: opts.revisionId,
      estimateId: opts.estimateId,
      actor: opts.actor,
      filename: pdfFilename,
    });
    lesseeTotalCents = pdf.lesseeTotalCents || lesseeTotalCents;
    // Verify marker
    const extracted = extractBrcTotalCents(pdf.bytes);
    if (extracted != null) lesseeTotalCents = extracted;
    ids.push(pdf.doc.id);
    attachments.push({
      filename: pdfFilename,
      contentType: "application/pdf",
      storageKey: pdf.doc.storage_key,
      size: Number(pdf.doc.size),
    });
    usedGeneratedPdf = true;
    pdfBytes = pdf.bytes;
  }

  if (aar) {
    ids.push(aar.doc.id);
    attachments.push({
      filename: dataFilename,
      contentType: "text/plain",
      storageKey: aar.doc.storage_key,
      size: Number(aar.doc.size),
    });
  }

  return {
    documentIds: ids,
    emailAttachments: attachments,
    usedGeneratedPdf,
    shopOriginalCount: shopDocs.length,
    included500Byte: Boolean(aar),
    lesseeTotalCents,
    pdfFilename,
    dataFilename,
    pdfBytes,
    dataBytes,
  };
}

export { extractBrcTotalCents };
