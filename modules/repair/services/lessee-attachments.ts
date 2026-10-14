/**
 * Lessee email attachments:
 * - Pass through the shop’s original estimate files as-is.
 * - Always include the matching 500-byte file (shop upload or regenerated from raw lines).
 * - Generate a PDF only when the shop did not send one.
 * - Reviewer-selected docs/photos when documentIds provided.
 * Shop is never copied on the outbound email (handled by caller).
 */

import { jsPDF } from "jspdf";
import autoTableImport from "jspdf-autotable";
import { DEFAULT_TENANT_ID, q } from "../db";

const autoTable =
  typeof autoTableImport === "function"
    ? autoTableImport
    : (autoTableImport as { default: typeof autoTableImport }).default;
import { getStorageProvider } from "../providers/storage";
import type { OutboundEmail } from "../providers/email";
import { formatCentsAsDollars, formatCentsAsMoney } from "./money";
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

function isPdf(doc: DocRow): boolean {
  const mime = (doc.mime ?? "").toLowerCase();
  const name = filenameOf(doc).toLowerCase();
  return mime.includes("pdf") || name.endsWith(".pdf");
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

  // Only shop estimate originals / photos — never invoices or generated_* 
  let docs = rows.filter((d) => SHOP_ORIGINAL_KINDS.has(d.kind));
  if (opts.revisionId) {
    const forRev = docs.filter(
      (d) => d.revision_id == null || String(d.revision_id) === opts.revisionId,
    );
    if (forRev.length) docs = forRev;
  }
  if (opts.documentIds?.length) {
    const allow = new Set(opts.documentIds);
    // Always keep aar_500byte even if not in reviewer selection
    docs = docs.filter((d) => allow.has(d.id) || d.kind === "aar_500byte");
  }
  return docs;
}

async function ensureMatching500Byte(opts: {
  tenantId: string;
  eventId: string;
  revisionId: string;
  actor: string;
  carLabel: string;
  existing: DocRow[];
}): Promise<DocRow | null> {
  const existingAar = opts.existing.find(
    (d) => d.kind === "aar_500byte" || isAar500(d),
  );
  if (existingAar) return existingAar;

  const { rows: lines } = await q(
    `SELECT raw_line FROM repair.estimate_lines
     WHERE revision_id = $1 AND raw_line IS NOT NULL AND length(raw_line) = 500
     ORDER BY line_no ASC`,
    [opts.revisionId],
  );
  if (!lines.length) return null;

  const body = lines.map((l) => String(l.raw_line) + "\r\n").join("");
  const bytes = Buffer.from(body, "latin1");
  const filename = `estimate-${opts.carLabel.replace(/\s+/g, "_")}-500byte.txt`;
  const stored = await getStorageProvider().put({
    tenantId: opts.tenantId,
    kind: "aar_500byte",
    filename,
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
      filename,
      opts.actor,
    ],
  );
  return rows[0] ?? null;
}

async function generateEstimatePdf(opts: {
  tenantId: string;
  eventId: string;
  revisionId: string;
  actor: string;
  carLabel: string;
  estimateId?: string;
  lesseeOnly?: boolean;
}): Promise<{ doc: DocRow; lesseeTotalCents: number }> {
  let lesseeTotalCents = 0;
  let bodyRows: string[][] = [];

  if (opts.lesseeOnly && opts.estimateId) {
    const totals = await computeLesseeTotals({
      estimateId: opts.estimateId,
      revisionId: opts.revisionId,
      tenantId: opts.tenantId,
    });
    if (totals.ok) {
      lesseeTotalCents = totals.bundle.totalCents;
      bodyRows = totals.bundle.lines.map((l) => [
        String(l.display_line_no ?? l.line_no),
        l.location_on_car ?? "",
        l.quantity ?? "",
        l.condition_code ?? "",
        l.aar_job_code ?? "",
        l.qualifier ?? "",
        l.why_made ?? "",
        l.removed_job_code ?? "",
        l.removed_qualifier ?? "",
        "6",
        (l.description ?? "").slice(0, 40),
        formatCentsAsDollars(l.labor_cents),
        formatCentsAsDollars(l.material_cents),
        formatCentsAsDollars(l.amount_cents),
        l.aar_component_id ?? "",
      ]);
    }
  } else {
    const { rows: lines } = await q(
      `SELECT line_no, aar_job_code, qualifier, why_made, resp_code,
              labor_cents, material_cents, labor, material, total, repair_category,
              location_on_car, quantity, condition_code, removed_job_code,
              removed_qualifier, description, aar_component_id
       FROM repair.estimate_lines
       WHERE revision_id = $1
       ORDER BY line_no ASC`,
      [opts.revisionId],
    );
    const filtered = opts.lesseeOnly
      ? lines.filter((l) => String(l.resp_code ?? "") === "6")
      : lines;
    for (const l of filtered) {
      const labor =
        l.labor_cents != null
          ? Math.trunc(Number(l.labor_cents))
          : Math.round(Number(l.labor ?? 0) * 100);
      const material =
        l.material_cents != null
          ? Math.trunc(Number(l.material_cents))
          : Math.round(Number(l.material ?? 0) * 100);
      const amount = labor + material;
      if (String(l.resp_code ?? "") === "6") lesseeTotalCents += amount;
      bodyRows.push([
        String(l.line_no),
        String(l.location_on_car ?? ""),
        String(l.quantity ?? ""),
        String(l.condition_code ?? ""),
        String(l.aar_job_code ?? ""),
        String(l.qualifier ?? ""),
        String(l.why_made ?? ""),
        String(l.removed_job_code ?? ""),
        String(l.removed_qualifier ?? ""),
        String(l.resp_code ?? ""),
        String(l.description ?? l.repair_category ?? "").slice(0, 40),
        formatCentsAsDollars(labor),
        formatCentsAsDollars(material),
        formatCentsAsDollars(amount),
        String(l.aar_component_id ?? ""),
      ]);
    }
  }

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFontSize(14);
  doc.text("Repair estimate — lessee responsibility (Resp 6)", 40, 40);
  doc.setFontSize(10);
  doc.text(`Car: ${opts.carLabel}`, 40, 58);
  doc.text(`Lessee total: ${formatCentsAsMoney(lesseeTotalCents)}`, 40, 72);
  // Machine-readable marker for cent reconciliation (also embedded in content stream)
  doc.text(`LESSEE_TOTAL_CENTS:${lesseeTotalCents}`, 40, 84);

  autoTable(doc, {
    startY: 96,
    head: [[
      "Item", "Loc", "Qty", "C", "AJOB", "QA", "WM", "RJOB", "QR", "R",
      "Description", "Labor", "Mat", "Amount", "CID",
    ]],
    body: bodyRows,
    styles: { fontSize: 7 },
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
  return { doc: rows[0], lesseeTotalCents };
}

export type ResolvedLesseeAttachments = {
  documentIds: string[];
  emailAttachments: NonNullable<OutboundEmail["attachments"]>;
  usedGeneratedPdf: boolean;
  shopOriginalCount: number;
  included500Byte: boolean;
  /** Resp 6 total cents used in PDF / reconciliation */
  lesseeTotalCents: number;
};

/**
 * Build lessee email attachments:
 * shop originals + matching 500-byte; PDF only if shop sent none.
 * When lesseeOnly, PDF contains Resp 6 lines only with cent-reconciled total.
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
}): Promise<ResolvedLesseeAttachments> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const shopDocs = await listShopOriginalDocuments({
    eventId: opts.eventId,
    revisionId: opts.revisionId,
    tenantId,
    documentIds: opts.documentIds,
  });

  const aarDoc = await ensureMatching500Byte({
    tenantId,
    eventId: opts.eventId,
    revisionId: opts.revisionId,
    actor: opts.actor,
    carLabel: opts.carLabel,
    existing: shopDocs,
  });

  const docs = [...shopDocs];
  if (aarDoc && !docs.some((d) => d.id === aarDoc.id)) {
    docs.push(aarDoc);
  }

  let lesseeTotalCents = 0;
  if (opts.estimateId) {
    const t = await computeLesseeTotals({
      estimateId: opts.estimateId,
      revisionId: opts.revisionId,
      tenantId,
    });
    if (t.ok) lesseeTotalCents = t.bundle.totalCents;
  } else {
    const { rows } = await q(
      `SELECT labor_cents, material_cents, labor, material FROM repair.estimate_lines
       WHERE revision_id = $1 AND resp_code = '6'`,
      [opts.revisionId],
    );
    for (const l of rows) {
      lesseeTotalCents +=
        (l.labor_cents != null
          ? Math.trunc(Number(l.labor_cents))
          : Math.round(Number(l.labor ?? 0) * 100)) +
        (l.material_cents != null
          ? Math.trunc(Number(l.material_cents))
          : Math.round(Number(l.material ?? 0) * 100));
    }
  }

  const attachments: NonNullable<OutboundEmail["attachments"]> = docs.map((d) => ({
    filename: filenameOf(d),
    contentType: d.mime || "application/octet-stream",
    storageKey: d.storage_key,
    size: Number(d.size),
  }));

  let usedGeneratedPdf = false;
  const ids = docs.map((d) => d.id);

  // Always generate a lessee PDF for cent-reconciled preview when lesseeOnly,
  // or when shop sent no PDF.
  const needGenerated = opts.lesseeOnly || !docs.some(isPdf);
  if (needGenerated) {
    const pdf = await generateEstimatePdf({
      tenantId,
      eventId: opts.eventId,
      revisionId: opts.revisionId,
      actor: opts.actor,
      carLabel: opts.carLabel,
      estimateId: opts.estimateId,
      lesseeOnly: opts.lesseeOnly !== false,
    });
    lesseeTotalCents = pdf.lesseeTotalCents || lesseeTotalCents;
    ids.push(pdf.doc.id);
    attachments.push({
      filename: filenameOf(pdf.doc),
      contentType: "application/pdf",
      storageKey: pdf.doc.storage_key,
      size: Number(pdf.doc.size),
    });
    usedGeneratedPdf = true;
  }

  return {
    documentIds: ids,
    emailAttachments: attachments,
    usedGeneratedPdf,
    shopOriginalCount: shopDocs.length,
    included500Byte: Boolean(aarDoc),
    lesseeTotalCents,
  };
}