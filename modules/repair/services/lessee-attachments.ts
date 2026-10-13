/**
 * Lessee email attachments:
 * - Pass through the shop’s original files when they exist (exact bytes/mime).
 * - Generate a PDF only when the shop did not send one.
 * Shop is never copied on the outbound email (handled by caller).
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { DEFAULT_TENANT_ID, q } from "../db";
import { getStorageProvider } from "../providers/storage";
import type { OutboundEmail } from "../providers/email";

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
  "aar_500byte",
]);

function filenameOf(doc: DocRow): string {
  if (doc.original_filename?.trim()) return doc.original_filename.trim();
  const base = doc.storage_key.split("/").pop() || "attachment";
  // strip leading uuid-
  return base.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    "",
  );
}

function isPdf(doc: DocRow): boolean {
  const mime = (doc.mime ?? "").toLowerCase();
  const name = filenameOf(doc).toLowerCase();
  return mime.includes("pdf") || name.endsWith(".pdf");
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

  let docs = rows.filter((d) => SHOP_ORIGINAL_KINDS.has(d.kind) || !d.kind.startsWith("generated_"));
  if (opts.revisionId) {
    const forRev = docs.filter(
      (d) => d.revision_id == null || String(d.revision_id) === opts.revisionId,
    );
    if (forRev.length) docs = forRev;
  }
  if (opts.documentIds?.length) {
    const allow = new Set(opts.documentIds);
    docs = docs.filter((d) => allow.has(d.id));
  }
  return docs;
}

async function generateEstimatePdf(opts: {
  tenantId: string;
  eventId: string;
  revisionId: string;
  actor: string;
  carLabel: string;
}): Promise<DocRow> {
  const { rows: lines } = await q(
    `SELECT line_no, aar_job_code, qualifier, why_made, resp_code,
            labor, material, total, repair_category
     FROM repair.estimate_lines
     WHERE revision_id = $1
     ORDER BY line_no ASC`,
    [opts.revisionId],
  );

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFontSize(14);
  doc.text("Repair estimate (generated — shop did not attach a PDF)", 40, 40);
  doc.setFontSize(10);
  doc.text(`Car: ${opts.carLabel}`, 40, 58);
  doc.text(`Generated for lessee review — pass-through preferred when shop PDF exists.`, 40, 72);

  autoTable(doc, {
    startY: 90,
    head: [["Line", "Resp", "Job", "Qual", "Why", "Category", "Labor", "Mat", "Total"]],
    body: lines.map((l) => [
      String(l.line_no),
      String(l.resp_code ?? ""),
      String(l.aar_job_code ?? ""),
      String(l.qualifier ?? ""),
      String(l.why_made ?? ""),
      String(l.repair_category ?? ""),
      Number(l.labor).toFixed(2),
      Number(l.material).toFixed(2),
      Number(l.total).toFixed(2),
    ]),
    styles: { fontSize: 8 },
  });

  const bytes = Buffer.from(doc.output("arraybuffer"));
  const stored = await getStorageProvider().put({
    tenantId: opts.tenantId,
    kind: "generated_estimate_pdf",
    filename: `estimate-${opts.carLabel.replace(/\s+/g, "_")}.pdf`,
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
      `estimate-${opts.carLabel.replace(/\s+/g, "_")}.pdf`,
      opts.actor,
    ],
  );
  return rows[0];
}

export type ResolvedLesseeAttachments = {
  documentIds: string[];
  emailAttachments: NonNullable<OutboundEmail["attachments"]>;
  usedGeneratedPdf: boolean;
  shopOriginalCount: number;
};

/**
 * Build lessee email attachments: shop originals first; PDF only if shop sent none.
 */
export async function resolveLesseeAttachments(opts: {
  eventId: string;
  revisionId: string;
  tenantId?: string;
  documentIds?: string[];
  actor: string;
  carLabel: string;
}): Promise<ResolvedLesseeAttachments> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const shopDocs = await listShopOriginalDocuments({
    eventId: opts.eventId,
    revisionId: opts.revisionId,
    tenantId,
    documentIds: opts.documentIds,
  });

  const attachments: NonNullable<OutboundEmail["attachments"]> = shopDocs.map((d) => ({
    filename: filenameOf(d),
    contentType: d.mime || "application/octet-stream",
    storageKey: d.storage_key,
    size: Number(d.size),
  }));

  let usedGeneratedPdf = false;
  const ids = shopDocs.map((d) => d.id);

  if (!shopDocs.some(isPdf)) {
    const pdf = await generateEstimatePdf({
      tenantId,
      eventId: opts.eventId,
      revisionId: opts.revisionId,
      actor: opts.actor,
      carLabel: opts.carLabel,
    });
    ids.push(pdf.id);
    attachments.push({
      filename: filenameOf(pdf),
      contentType: "application/pdf",
      storageKey: pdf.storage_key,
      size: Number(pdf.size),
    });
    usedGeneratedPdf = true;
  }

  return {
    documentIds: ids,
    emailAttachments: attachments,
    usedGeneratedPdf,
    shopOriginalCount: shopDocs.length,
  };
}
