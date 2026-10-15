/**
 * OWNER_UI §E Document Viewer — list / ACL / preview / zip / checklist.
 * Integer cents elsewhere; documents are files (no money). Append-only VOIDED.
 */
import { createHash } from "crypto";
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { getStorageProvider } from "../providers/storage";
import { parseAarFile } from "./aar-parser";
import { canManageAttachments } from "./gap-lifecycle-06";

export const DOC_CATEGORY_GROUPS: Array<{
  code: string;
  label: string;
  match: (kind: string, category: string) => boolean;
}> = [
  {
    code: "photograph",
    label: "Photos",
    match: (k, c) =>
      ["photograph", "photo", "shop_photo"].includes(c) ||
      ["photograph", "photo", "shop_photo"].includes(k) ||
      /\.(jpe?g|png|gif|bmp|webp)$/i.test(k),
  },
  {
    code: "estimate_pdf",
    label: "Estimate PDF",
    match: (k, c) =>
      ["estimate_pdf", "generated_estimate_pdf", "estimate"].includes(c) ||
      ["estimate_pdf", "generated_estimate_pdf", "estimate_file"].includes(k),
  },
  {
    code: "aar_500byte",
    label: "Data files (500-byte)",
    match: (k, c) =>
      ["aar_500byte", "data_file"].includes(c) ||
      ["aar_500byte", "data_file"].includes(k) ||
      /\.(500|dat|txt)$/i.test(k),
  },
  {
    code: "invoice",
    label: "Invoice",
    match: (k, c) => c === "invoice" || k === "invoice",
  },
  {
    code: "sds",
    label: "SDS",
    match: (k, c) => c === "sds" || k === "sds",
  },
  {
    code: "scope_of_work",
    label: "Scope of work",
    match: (k, c) =>
      c === "scope_of_work" || k === "scope_of_work" || c === "scope",
  },
  {
    code: "jic",
    label: "JIC",
    match: (k, c) => c === "jic" || k === "jic",
  },
  {
    code: "ddct",
    label: "DDCT",
    match: (k, c) => c === "ddct" || k === "ddct",
  },
  {
    code: "other",
    label: "Other",
    match: () => true,
  },
];

export type ViewerRole = "owner" | "system_manager" | "admin" | "reviewer" | "shop" | "lessee" | "dev-bypass" | string;

export type ViewerDoc = Record<string, unknown> & {
  id: string;
  kind: string;
  category_code?: string | null;
  original_filename?: string | null;
  mime?: string | null;
  size?: number;
  uploaded_at?: string;
  uploaded_by?: string | null;
  uploaded_role?: string | null;
  lifecycle_status?: string | null;
  deleted_at?: string | null;
  owner_only?: boolean;
  source_tag?: string | null;
  source_event_id?: string | null;
  source_document_id?: string | null;
  doc_revision?: number;
  comment?: string | null;
  jic_photo?: boolean;
  revision_id?: string | null;
};

function normalizeRole(role?: string | null): string {
  return String(role ?? "reviewer").trim().toLowerCase();
}

export function isOwnerRole(role?: string | null): boolean {
  const r = normalizeRole(role);
  return (
    r === "owner" ||
    r === "system_manager" ||
    r === "admin" ||
    r === "reviewer" ||
    r === "dev-bypass"
  );
}

export function isShopRole(role?: string | null): boolean {
  return normalizeRole(role) === "shop";
}

export function isLesseeRole(role?: string | null): boolean {
  return normalizeRole(role) === "lessee";
}

export function categorizeDoc(doc: ViewerDoc): string {
  const kind = String(doc.kind ?? "").toLowerCase();
  const cat = String(doc.category_code ?? "").toLowerCase();
  const name = String(doc.original_filename ?? "").toLowerCase();
  for (const g of DOC_CATEGORY_GROUPS) {
    if (g.code === "other") continue;
    if (g.match(kind, cat) || g.match(name, cat)) return g.code;
  }
  return "other";
}

export function categoryLabel(code: string): string {
  return DOC_CATEGORY_GROUPS.find((g) => g.code === code)?.label ?? code;
}

/** Preview kind for the right pane. */
export function previewKindFor(doc: ViewerDoc): "image" | "pdf" | "aar500" | "office" | "other" {
  const mime = String(doc.mime ?? "").toLowerCase();
  const name = String(doc.original_filename ?? doc.kind ?? "").toLowerCase();
  const cat = categorizeDoc(doc);
  if (
    cat === "aar_500byte" ||
    name.endsWith(".500") ||
    name.endsWith(".dat") ||
    (name.endsWith(".txt") && (cat === "aar_500byte" || doc.kind === "aar_500byte"))
  ) {
    return "aar500";
  }
  if (mime.startsWith("image/") || /\.(jpe?g|png|gif|bmp|webp)$/i.test(name)) {
    return "image";
  }
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (
    mime.includes("officedocument") ||
    mime.includes("msword") ||
    mime.includes("ms-excel") ||
    /\.(docx?|xlsx?|pptx?)$/i.test(name)
  ) {
    return "office";
  }
  return "other";
}

export async function resolveViewerScope(opts: {
  estimateId?: string;
  eventId?: string;
  wreckEventId?: string;
  tenantId?: string;
}): Promise<
  | {
      ok: true;
      eventId: string;
      estimateId: string | null;
      wreckEventId: string | null;
      carLabel: string;
      reason: string | null;
      estimateIdDisplay: string | null;
      statusName: string | null;
      boLifecycleStatus: string | null;
      badOrderId: string | null;
      recordType: "estimate" | "bad_order" | "wreck";
      requiresSds: boolean;
      isWreck: boolean;
    }
  | { ok: false; status: number; error: string }
> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;

  if (opts.wreckEventId) {
    const { rows } = await q(
      `SELECT w.id AS wreck_id, w.event_id,
              e.car_mark, e.car_number, e.is_wreck, e.bo_rule_code,
              br.description AS reason, COALESCE(br.requires_sds, false) AS requires_sds,
              bo.id AS bad_order_id, bo.lifecycle_status AS bo_lifecycle_status,
              bo.shopping_reason
       FROM repair.wreck_events w
       JOIN repair.events e ON e.id = w.event_id
       LEFT JOIN repair.bo_rules br
         ON br.tenant_id = e.tenant_id AND br.code = e.bo_rule_code AND br.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT id, shopping_reason, lifecycle_status FROM repair.bad_orders
         WHERE event_id = e.id AND deleted_at IS NULL
         ORDER BY received_at DESC LIMIT 1
       ) bo ON true
       WHERE w.id = $1 AND w.tenant_id = $2 AND w.deleted_at IS NULL`,
      [opts.wreckEventId, tenantId],
    );
    if (!rows[0]) return { ok: false, status: 404, error: "Wreck event not found" };
    const r = rows[0];
    return {
      ok: true,
      eventId: String(r.event_id),
      estimateId: null,
      wreckEventId: String(r.wreck_id),
      carLabel: `${r.car_mark ?? ""} ${r.car_number ?? ""}`.trim(),
      reason:
        r.reason != null
          ? String(r.reason)
          : r.shopping_reason != null
            ? String(r.shopping_reason)
            : null,
      estimateIdDisplay: null,
      statusName: null,
      boLifecycleStatus:
        r.bo_lifecycle_status != null ? String(r.bo_lifecycle_status) : null,
      badOrderId: r.bad_order_id != null ? String(r.bad_order_id) : null,
      recordType: "wreck",
      requiresSds: Boolean(r.requires_sds),
      isWreck: true,
    };
  }

  if (opts.estimateId) {
    const { rows } = await q(
      `SELECT e.id AS estimate_id, e.event_id, e.current_revision, e.current_header,
              ev.car_mark, ev.car_number, ev.is_wreck, ev.bo_rule_code,
              s.display_name AS status_name,
              br.description AS reason, COALESCE(br.requires_sds, false) AS requires_sds,
              bo.id AS bad_order_id, bo.lifecycle_status AS bo_lifecycle_status,
              bo.shopping_reason
       FROM repair.estimates e
       JOIN repair.events ev ON ev.id = e.event_id
       LEFT JOIN repair.statuses s ON s.id = e.status_id
       LEFT JOIN repair.bo_rules br
         ON br.tenant_id = ev.tenant_id AND br.code = ev.bo_rule_code AND br.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT id, shopping_reason, lifecycle_status FROM repair.bad_orders
         WHERE event_id = e.event_id AND deleted_at IS NULL
         ORDER BY received_at DESC LIMIT 1
       ) bo ON true
       WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
      [opts.estimateId, tenantId],
    );
    if (!rows[0]) return { ok: false, status: 404, error: "Estimate not found" };
    const r = rows[0];
    const header = (r.current_header ?? {}) as Record<string, unknown>;
    const carInitial = String(
      header.carInitial ?? header.car_initial ?? r.car_mark ?? "",
    ).trim();
    const carNumber = String(
      header.carNumber ?? header.car_number ?? r.car_number ?? "",
    ).trim();
    const docRef = String(
      header.documentReference ?? header.document_reference ?? "",
    ).trim();
    const estimateIdDisplay =
      docRef ||
      `${carInitial}${carNumber.padStart(6, "0")}${String(
        header.repairDateYymmdd ?? header.repair_date_yymmdd ?? "",
      ).trim()}`.trim() ||
      String(r.estimate_id).slice(0, 8);
    return {
      ok: true,
      eventId: String(r.event_id),
      estimateId: String(r.estimate_id),
      wreckEventId: null,
      carLabel: `${carInitial || r.car_mark || ""} ${carNumber || r.car_number || ""}`.trim(),
      reason:
        r.reason != null
          ? String(r.reason)
          : r.shopping_reason != null
            ? String(r.shopping_reason)
            : null,
      estimateIdDisplay,
      statusName: r.status_name != null ? String(r.status_name) : null,
      boLifecycleStatus:
        r.bo_lifecycle_status != null ? String(r.bo_lifecycle_status) : null,
      badOrderId: r.bad_order_id != null ? String(r.bad_order_id) : null,
      recordType: "estimate",
      requiresSds: Boolean(r.requires_sds),
      isWreck: Boolean(r.is_wreck),
    };
  }

  if (opts.eventId) {
    const { rows } = await q(
      `SELECT ev.id AS event_id, ev.car_mark, ev.car_number, ev.is_wreck, ev.bo_rule_code,
              br.description AS reason, COALESCE(br.requires_sds, false) AS requires_sds,
              bo.id AS bad_order_id, bo.lifecycle_status AS bo_lifecycle_status,
              bo.shopping_reason
       FROM repair.events ev
       LEFT JOIN repair.bo_rules br
         ON br.tenant_id = ev.tenant_id AND br.code = ev.bo_rule_code AND br.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT id, shopping_reason, lifecycle_status FROM repair.bad_orders
         WHERE event_id = ev.id AND deleted_at IS NULL
         ORDER BY received_at DESC LIMIT 1
       ) bo ON true
       WHERE ev.id = $1 AND ev.tenant_id = $2 AND ev.deleted_at IS NULL`,
      [opts.eventId, tenantId],
    );
    if (!rows[0]) return { ok: false, status: 404, error: "Event not found" };
    const r = rows[0];
    return {
      ok: true,
      eventId: String(r.event_id),
      estimateId: null,
      wreckEventId: null,
      carLabel: `${r.car_mark ?? ""} ${r.car_number ?? ""}`.trim(),
      reason:
        r.reason != null
          ? String(r.reason)
          : r.shopping_reason != null
            ? String(r.shopping_reason)
            : null,
      estimateIdDisplay: null,
      statusName: null,
      boLifecycleStatus:
        r.bo_lifecycle_status != null ? String(r.bo_lifecycle_status) : null,
      badOrderId: r.bad_order_id != null ? String(r.bad_order_id) : null,
      recordType: "bad_order",
      requiresSds: Boolean(r.requires_sds),
      isWreck: Boolean(r.is_wreck),
    };
  }

  return {
    ok: false,
    status: 400,
    error: "estimateId, eventId, or wreckEventId required",
  };
}

function applyRoleFilter(
  docs: ViewerDoc[],
  opts: {
    actorRole?: string;
    showVoided?: boolean;
    grantedDocumentIds?: string[];
  },
): ViewerDoc[] {
  const role = normalizeRole(opts.actorRole);
  let out = docs;

  if (isLesseeRole(role)) {
    const allow = new Set((opts.grantedDocumentIds ?? []).map(String));
    out = out.filter(
      (d) =>
        allow.has(String(d.id)) &&
        !d.owner_only &&
        !d.deleted_at &&
        String(d.lifecycle_status ?? "ACTIVE").toUpperCase() !== "VOIDED",
    );
    return out;
  }

  if (isShopRole(role)) {
    out = out.filter(
      (d) =>
        !d.owner_only &&
        !d.deleted_at &&
        String(d.lifecycle_status ?? "ACTIVE").toUpperCase() !== "VOIDED",
    );
    return out;
  }

  // Owner / system manager / reviewer
  if (!opts.showVoided) {
    out = out.filter(
      (d) =>
        !d.deleted_at &&
        String(d.lifecycle_status ?? "ACTIVE").toUpperCase() !== "VOIDED",
    );
  }
  return out;
}

export async function listViewerDocuments(opts: {
  estimateId?: string;
  eventId?: string;
  wreckEventId?: string;
  actorRole?: string;
  showVoided?: boolean;
  grantedDocumentIds?: string[];
  categoryCode?: string;
  revisionId?: string;
  uploaderRole?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  tenantId?: string;
}) {
  const scope = await resolveViewerScope(opts);
  if (!scope.ok) return scope;

  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q<ViewerDoc>(
    `SELECT d.*,
            se.car_mark AS source_car_mark,
            se.car_number AS source_car_number,
            se.created_at AS source_event_created_at
     FROM repair.documents d
     LEFT JOIN repair.events se ON se.id = d.source_event_id
     WHERE d.event_id = $1 AND d.tenant_id = $2
     ORDER BY d.uploaded_at DESC NULLS LAST, d.created_at DESC`,
    [scope.eventId, tenantId],
  );

  // Enrich source_tag when linked but tag empty
  const enriched = rows.map((d) => {
    let source_tag = d.source_tag != null ? String(d.source_tag) : null;
    if (!source_tag && d.source_event_id) {
      const car = `${d.source_car_mark ?? ""} ${d.source_car_number ?? ""}`.trim();
      const when = d.source_event_created_at
        ? new Date(String(d.source_event_created_at)).toISOString().slice(0, 10)
        : "";
      source_tag = `From BO ${car}${when ? ` ${when}` : ""}`.trim();
    }
    return { ...d, source_tag, group: categorizeDoc(d) };
  });

  let filtered = applyRoleFilter(enriched, opts);

  if (opts.categoryCode) {
    const code = opts.categoryCode.toLowerCase();
    filtered = filtered.filter((d) => categorizeDoc(d) === code || String(d.category_code ?? "").toLowerCase() === code);
  }
  if (opts.revisionId) {
    filtered = filtered.filter(
      (d) => d.revision_id == null || String(d.revision_id) === opts.revisionId,
    );
  }
  if (opts.uploaderRole) {
    const ur = opts.uploaderRole.toLowerCase();
    filtered = filtered.filter(
      (d) => String(d.uploaded_role ?? "").toLowerCase() === ur,
    );
  }
  if (opts.dateFrom) {
    const from = new Date(opts.dateFrom).getTime();
    filtered = filtered.filter((d) => {
      const t = new Date(String(d.uploaded_at ?? d.created_at ?? 0)).getTime();
      return !Number.isNaN(from) && t >= from;
    });
  }
  if (opts.dateTo) {
    const to = new Date(opts.dateTo).getTime();
    filtered = filtered.filter((d) => {
      const t = new Date(String(d.uploaded_at ?? d.created_at ?? 0)).getTime();
      return !Number.isNaN(to) && t <= to + 86_400_000;
    });
  }
  if (opts.search?.trim()) {
    const qstr = opts.search.trim().toLowerCase();
    filtered = filtered.filter((d) =>
      String(d.original_filename ?? d.kind ?? "")
        .toLowerCase()
        .includes(qstr),
    );
  }

  const byCategory: Record<string, typeof filtered> = {};
  for (const g of DOC_CATEGORY_GROUPS) byCategory[g.code] = [];
  for (const d of filtered) {
    const code = categorizeDoc(d);
    (byCategory[code] ??= []).push(d);
  }

  const checklist = await buildRequiredDocsChecklist({
    eventId: scope.eventId,
    docs: filtered,
    requiresSds: scope.requiresSds,
    isWreck: scope.isWreck,
    tenantId,
  });

  return {
    ok: true as const,
    scope,
    documents: filtered,
    byCategory,
    categories: DOC_CATEGORY_GROUPS.map((g) => ({
      code: g.code,
      label: g.label,
      count: (byCategory[g.code] ?? []).length,
    })),
    checklist,
    permissions: {
      role: normalizeRole(opts.actorRole),
      canAdd: isOwnerRole(opts.actorRole) || isShopRole(opts.actorRole),
      canRemove: canManageAttachments(opts.actorRole),
      canRecategorize: canManageAttachments(opts.actorRole),
      canVoid: canManageAttachments(opts.actorRole),
      canRestore: canManageAttachments(opts.actorRole),
      canShowVoided: isOwnerRole(opts.actorRole),
      canZip: true,
      canAttachSendLessee: isOwnerRole(opts.actorRole),
    },
  };
}

export async function assertDocumentAccess(opts: {
  documentId: string;
  actorRole?: string;
  grantedDocumentIds?: string[];
  tenantId?: string;
}): Promise<
  | { ok: true; document: ViewerDoc }
  | { ok: false; status: number; error: string }
> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q<ViewerDoc>(
    `SELECT * FROM repair.documents WHERE id = $1 AND tenant_id = $2`,
    [opts.documentId, tenantId],
  );
  if (!rows[0]) return { ok: false, status: 404, error: "Document not found" };
  const doc = rows[0];
  const role = normalizeRole(opts.actorRole);
  const voided =
    Boolean(doc.deleted_at) ||
    String(doc.lifecycle_status ?? "ACTIVE").toUpperCase() === "VOIDED";

  if (isLesseeRole(role)) {
    const allow = new Set((opts.grantedDocumentIds ?? []).map(String));
    if (doc.owner_only || voided || !allow.has(String(doc.id))) {
      return { ok: false, status: 403, error: "Attachment not granted on this lessee link" };
    }
    return { ok: true, document: doc };
  }

  if (isShopRole(role)) {
    if (doc.owner_only || voided) {
      return {
        ok: false,
        status: 403,
        error: "Shop cannot access owner-only or voided documents",
      };
    }
    return { ok: true, document: doc };
  }

  // Owner may view voided
  return { ok: true, document: doc };
}

export async function getDocumentContent(opts: {
  documentId: string;
  actorRole?: string;
  grantedDocumentIds?: string[];
  actor?: string;
  audit?: boolean;
  tenantId?: string;
}) {
  const access = await assertDocumentAccess(opts);
  if (!access.ok) return access;
  const stored = await getStorageProvider().get(String(access.document.storage_key));
  if (opts.audit !== false) {
    await auditDownload({
      documentIds: [opts.documentId],
      eventId: access.document.event_id != null ? String(access.document.event_id) : null,
      mode: "single",
      actor: opts.actor ?? "user",
      actorRole: opts.actorRole,
      tenantId: opts.tenantId,
    });
  }
  return {
    ok: true as const,
    document: access.document,
    bytes: stored.bytes,
  };
}

export async function decodeAar500Preview(opts: {
  documentId: string;
  actorRole?: string;
  grantedDocumentIds?: string[];
  tenantId?: string;
}) {
  const content = await getDocumentContent({ ...opts, audit: false });
  if (!content.ok) return content;
  try {
    const parsed = parseAarFile(content.bytes);
    return {
      ok: true as const,
      previewKind: "aar500" as const,
      layoutVersion: parsed.layoutVersion,
      flags: parsed.flags,
      lineCount: parsed.lines.length,
      lines: parsed.lines.map((l) => ({
        lineNo: l.lineNo,
        recordFormat: l.recordFormat,
        fields: l.fields,
        laborCents: l.laborCents,
        materialCents: l.materialCents,
        respCode: l.respCode,
        rawLine: l.rawLine,
      })),
      rawText: content.bytes.toString("latin1"),
    };
  } catch (err) {
    return {
      ok: true as const,
      previewKind: "aar500" as const,
      decodeError: err instanceof Error ? err.message : String(err),
      rawText: content.bytes.toString("latin1"),
      lines: [] as unknown[],
    };
  }
}

/** Minimal ZIP (store-only) — no external zip dependency. */
export function buildZipStore(
  files: Array<{ filename: string; bytes: Buffer }>,
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.filename.replace(/\\/g, "/"), "utf8");
    const data = f.bytes;
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centralParts.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
  }
  return ~c;
}

export async function zipViewerDocuments(opts: {
  documentIds: string[];
  eventId?: string;
  estimateId?: string;
  actorRole?: string;
  grantedDocumentIds?: string[];
  actor: string;
  tenantId?: string;
}) {
  const ids = [...new Set(opts.documentIds.map(String).filter(Boolean))];
  if (!ids.length) {
    return { ok: false as const, status: 400, error: "documentIds required" };
  }

  const files: Array<{ filename: string; bytes: Buffer; id: string }> = [];
  const usedNames = new Set<string>();
  for (const id of ids) {
    const content = await getDocumentContent({
      documentId: id,
      actorRole: opts.actorRole,
      grantedDocumentIds: opts.grantedDocumentIds,
      actor: opts.actor,
      audit: false,
      tenantId: opts.tenantId,
    });
    if (!content.ok) return content;
    let filename = String(
      content.document.original_filename || content.document.kind || id,
    ).replace(/[\\/]/g, "_");
    if (usedNames.has(filename)) {
      const stem = filename.replace(/(\.[^.]+)?$/, "");
      const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
      filename = `${stem}-${id.slice(0, 8)}${ext}`;
    }
    usedNames.add(filename);
    files.push({ filename, bytes: content.bytes, id });
  }

  const zipBytes = buildZipStore(files.map((f) => ({ filename: f.filename, bytes: f.bytes })));
  await auditDownload({
    documentIds: ids,
    eventId: opts.eventId ?? null,
    estimateId: opts.estimateId ?? null,
    mode: "zip",
    actor: opts.actor,
    actorRole: opts.actorRole,
    tenantId: opts.tenantId,
  });

  return {
    ok: true as const,
    filename: `attachments-${ids.length}.zip`,
    bytes: zipBytes,
    count: files.length,
    sha256: createHash("sha256").update(zipBytes).digest("hex"),
  };
}

/** Owner-only: mark docs as selected for next Send Lessee (session staging via audit). */
export async function attachDocumentsToSendLessee(opts: {
  estimateId: string;
  documentIds: string[];
  actor: string;
  actorRole?: string;
  tenantId?: string;
}) {
  if (!isOwnerRole(opts.actorRole)) {
    return {
      ok: false as const,
      status: 403,
      error: "Only owner can attach documents to Send Lessee",
    };
  }
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const ids = [...new Set(opts.documentIds.map(String).filter(Boolean))];
  if (!ids.length) {
    return { ok: false as const, status: 400, error: "documentIds required" };
  }

  const { rows: est } = await q(
    `SELECT id, event_id FROM repair.estimates
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [opts.estimateId, tenantId],
  );
  if (!est[0]) return { ok: false as const, status: 404, error: "Estimate not found" };

  // Reject owner_only docs
  const { rows: docs } = await q(
    `SELECT id, owner_only FROM repair.documents
     WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
       AND COALESCE(lifecycle_status,'ACTIVE') <> 'VOIDED'`,
    [tenantId, ids],
  );
  if (docs.length !== ids.length) {
    return { ok: false as const, status: 404, error: "One or more documents not found" };
  }
  if (docs.some((d) => d.owner_only)) {
    return {
      ok: false as const,
      status: 403,
      error: "Owner-only documents cannot be attached to Send Lessee",
    };
  }

  await writeAudit({
    tenantId,
    entity: "estimate",
    entityId: opts.estimateId,
    action: "DOCUMENTS_ATTACH_SEND_LESSEE",
    after: { documentIds: ids, eventId: est[0].event_id },
    actor: opts.actor,
    via: "UI",
  });
  await auditDownload({
    documentIds: ids,
    eventId: String(est[0].event_id),
    estimateId: opts.estimateId,
    mode: "send_lessee_attach",
    actor: opts.actor,
    actorRole: opts.actorRole,
    tenantId,
  });

  return {
    ok: true as const,
    estimateId: opts.estimateId,
    documentIds: ids,
    sendLesseePath: `/#/repair/estimates/${opts.estimateId}/send-lessee?docs=${ids.join(",")}`,
  };
}

export type ChecklistItem = {
  key: string;
  label: string;
  required: boolean;
  present: boolean;
  count: number;
  min?: number;
  max?: number;
  missing: boolean;
};

export async function buildRequiredDocsChecklist(opts: {
  eventId: string;
  docs: ViewerDoc[];
  requiresSds: boolean;
  isWreck: boolean;
  tenantId?: string;
}): Promise<{ items: ChecklistItem[]; missingCount: number }> {
  const active = opts.docs.filter(
    (d) =>
      !d.deleted_at &&
      String(d.lifecycle_status ?? "ACTIVE").toUpperCase() !== "VOIDED",
  );
  const items: ChecklistItem[] = [];

  if (opts.isWreck) {
    const jicPhotos = active.filter(
      (d) => d.jic_photo || categorizeDoc(d) === "jic" || categorizeDoc(d) === "photograph",
    );
    // Prefer explicit jic_photo flag when present
    const flagged = active.filter((d) => d.jic_photo);
    const count = flagged.length || jicPhotos.filter((d) => categorizeDoc(d) === "photograph" || d.jic_photo).length;
    const present = count >= 4;
    items.push({
      key: "wreck_jic_photos",
      label: "JIC photos (4–10)",
      required: true,
      present,
      count,
      min: 4,
      max: 10,
      missing: !present,
    });
    if (count > 10) {
      items[items.length - 1].missing = true;
      items[items.length - 1].present = false;
    }
  }

  if (opts.requiresSds) {
    const sdsCount = active.filter((d) => categorizeDoc(d) === "sds").length;
    items.push({
      key: "sds",
      label: "SDS (required by Bad Order reason)",
      required: true,
      present: sdsCount >= 1,
      count: sdsCount,
      min: 1,
      missing: sdsCount < 1,
    });
  }

  return {
    items,
    missingCount: items.filter((i) => i.missing).length,
  };
}

async function auditDownload(opts: {
  documentIds: string[];
  eventId?: string | null;
  estimateId?: string | null;
  mode: string;
  actor: string;
  actorRole?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  await q(
    `INSERT INTO repair.document_download_audit
       (tenant_id, document_ids, event_id, estimate_id, mode, actor, actor_role)
     VALUES ($1,$2::uuid[],$3,$4,$5,$6,$7)`,
    [
      tenantId,
      opts.documentIds,
      opts.eventId ?? null,
      opts.estimateId ?? null,
      opts.mode,
      opts.actor,
      opts.actorRole ?? null,
    ],
  );
  await writeAudit({
    tenantId,
    entity: "document",
    entityId: opts.documentIds[0] ?? opts.eventId ?? "bulk",
    action: "DOCUMENT_DOWNLOAD",
    after: {
      mode: opts.mode,
      documentIds: opts.documentIds,
      eventId: opts.eventId,
      estimateId: opts.estimateId,
    },
    actor: opts.actor,
    via: "UI",
  });
}

/** Mark a document owner-only (DV / settlement). */
export async function setDocumentOwnerOnly(opts: {
  documentId: string;
  ownerOnly: boolean;
  actor: string;
  actorRole?: string;
  tenantId?: string;
}) {
  if (!isOwnerRole(opts.actorRole)) {
    return { ok: false as const, status: 403, error: "Owner only" };
  }
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.documents SET owner_only = $1
     WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
     RETURNING *`,
    [opts.ownerOnly, opts.documentId, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Document not found" };
  await writeAudit({
    tenantId,
    entity: "document",
    entityId: opts.documentId,
    action: opts.ownerOnly ? "DOCUMENT_MARK_OWNER_ONLY" : "DOCUMENT_CLEAR_OWNER_ONLY",
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, document: rows[0] };
}
