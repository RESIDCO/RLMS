/**
 * Start-from-previous-BO template helpers.
 * Pure form mapping (for client + smoke) and document-ref linking (same storage_key).
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { listEventDocuments } from "./ops-grid";

/** Grid row fields used when filling New Bad Order from a previous BO. */
export type TemplateSourceRow = {
  shop_id?: string | null;
  shop_display?: string | null;
  bo_rule_code?: string | null;
  bo_rule_other_text?: string | null;
  bad_order_reason?: string | null;
  reporting_road?: string | null;
  dc_road?: string | null;
  stcc?: string | null;
  dest_city?: string | null;
  dest_state?: string | null;
  routing?: string | null;
  last_contents?: string | null;
  car_load?: string | null;
  cleaned?: boolean | null;
  travel_on_own_wheels?: boolean | null;
  bo_city?: string | null;
  bo_state?: string | null;
  comments?: string | null;
  is_wreck?: boolean | null;
  wreck_estimate?: boolean | null;
  multi_car_group_id?: string | null;
  car_mark?: string | null;
  car_number?: string | null;
  bo_date?: string | null;
  event_id?: string | null;
};

/** Subset of New BO form fields produced by template fill. */
export type TemplateFormFields = {
  carMark: string;
  carNumber: string;
  multiCar: boolean;
  multiCarList: string;
  reportingRoad: string;
  dcRoad: string;
  stcc: string;
  destCity: string;
  destState: string;
  routing: string;
  arrivalDate: string;
  boRuleCode: string;
  boRuleOtherText: string;
  lastContents: string;
  carLoad: "EMPTY" | "LOADED";
  cleaned: boolean;
  travelOnOwnWheels: boolean;
  boDate: string;
  boCity: string;
  boState: string;
  incidentDate: string;
  ddctIncidentId: string;
  ddctEventId: string;
  comments: string;
  shopId: string;
  isWreck: boolean;
  wreckEstimate: boolean;
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

/**
 * Map a history/grid row into New BO form fields.
 * Filled: shop, reason + keyed detail, roads, STCC, routing, dest, last contents,
 * car load/cleaned/wheels, comments, B/O city/ST, wreck flags.
 * Left blank: car number(s), B/O date→today, arrival, incident date/ID, DDCT Event ID.
 */
export function formFieldsFromTemplateRow(
  row: TemplateSourceRow,
  opts?: { today?: string },
): TemplateFormFields {
  return {
    carMark: "",
    carNumber: "",
    multiCar: Boolean(row.multi_car_group_id),
    multiCarList: "",
    reportingRoad: str(row.reporting_road),
    dcRoad: str(row.dc_road),
    stcc: str(row.stcc),
    destCity: str(row.dest_city),
    destState: str(row.dest_state),
    routing: str(row.routing),
    arrivalDate: "",
    boRuleCode: str(row.bo_rule_code) || "RULE_1",
    boRuleOtherText: str(row.bo_rule_other_text),
    lastContents: str(row.last_contents),
    carLoad: row.car_load === "LOADED" ? "LOADED" : "EMPTY",
    cleaned: Boolean(row.cleaned),
    travelOnOwnWheels: Boolean(row.travel_on_own_wheels),
    boDate: opts?.today ?? todayIso(),
    boCity: str(row.bo_city),
    boState: str(row.bo_state),
    incidentDate: "",
    ddctIncidentId: "",
    ddctEventId: "",
    comments: str(row.comments),
    shopId: str(row.shop_id),
    isWreck: Boolean(row.is_wreck),
    wreckEstimate: Boolean(row.wreck_estimate),
  };
}

/** Assert template fill contract — used by smoke. */
export function assertTemplateFormContract(fields: TemplateFormFields): string[] {
  const errors: string[] = [];
  if (!fields.shopId) errors.push("shopId must be filled");
  if (!fields.boRuleCode) errors.push("boRuleCode must be filled");
  if (fields.carMark !== "") errors.push("carMark must stay blank");
  if (fields.carNumber !== "") errors.push("carNumber must stay blank");
  if (fields.multiCarList !== "") errors.push("multiCarList must stay blank");
  if (fields.arrivalDate !== "") errors.push("arrivalDate must stay blank");
  if (fields.incidentDate !== "") errors.push("incidentDate must stay blank");
  if (fields.ddctIncidentId !== "") errors.push("ddctIncidentId must stay blank");
  if (fields.ddctEventId !== "") errors.push("ddctEventId must stay blank");
  return errors;
}

export type LinkedDocRef = {
  sourceDocumentId: string;
  originalFilename: string;
  kind: string;
  categoryCode: string;
  comment: string | null;
  mime: string | null;
  size: number;
  storageKey: string;
  sha256: string;
};

/** List active document refs on a source BO event (for template staging). */
export async function listTemplateDocumentRefs(opts: {
  eventId: string;
  tenantId?: string;
}): Promise<LinkedDocRef[]> {
  const docs = await listEventDocuments({
    eventId: opts.eventId,
    tenantId: opts.tenantId,
  });
  return docs
    .filter(
      (d) =>
        !d.deleted_at &&
        String(d.lifecycle_status ?? "ACTIVE").toUpperCase() !== "VOIDED",
    )
    .map((d) => ({
      sourceDocumentId: String(d.id),
      originalFilename: String(d.original_filename ?? d.kind ?? d.id),
      kind: String(d.kind ?? "other"),
      categoryCode: String(d.category_code ?? d.kind ?? "other"),
      comment: d.comment != null ? String(d.comment) : null,
      mime: d.mime != null ? String(d.mime) : null,
      size: Number(d.size ?? 0),
      storageKey: String(d.storage_key),
      sha256: String(d.sha256 ?? ""),
    }));
}

/**
 * Link existing stored files to a new BO event by copying document rows
 * (same storage_key / sha256 — no file bytes copied). Untick/remove on the
 * new BO only soft-deletes the new row.
 */
export async function linkEventDocumentRefs(opts: {
  eventId: string;
  sourceDocumentIds: string[];
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const ids = [...new Set(opts.sourceDocumentIds.map(String).filter(Boolean))];
  if (!ids.length) {
    return { ok: true as const, documents: [] as Record<string, unknown>[] };
  }

  const { rows: eventRows } = await q(
    `SELECT id FROM repair.events
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [opts.eventId, tenantId],
  );
  if (!eventRows[0]) {
    return { ok: false as const, status: 404, error: "Event not found" };
  }

  const { rows: sources } = await q(
    `SELECT id, kind, category_code, comment, storage_key, sha256, size, mime,
            original_filename, is_shared
     FROM repair.documents
     WHERE tenant_id = $1
       AND id = ANY($2::uuid[])
       AND deleted_at IS NULL
       AND COALESCE(lifecycle_status, 'ACTIVE') <> 'VOIDED'`,
    [tenantId, ids],
  );
  if (sources.length !== ids.length) {
    return {
      ok: false as const,
      status: 404,
      error: "One or more source documents not found",
    };
  }

  const created: Record<string, unknown>[] = [];
  for (const src of sources) {
    const { rows } = await q(
      `INSERT INTO repair.documents
         (tenant_id, event_id, kind, category_code, comment, storage_key, sha256,
          size, mime, uploaded_by, created_by, original_filename, is_shared,
          lifecycle_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,'ACTIVE')
       RETURNING *`,
      [
        tenantId,
        opts.eventId,
        String(src.kind ?? "other"),
        src.category_code != null ? String(src.category_code) : null,
        src.comment != null ? String(src.comment) : null,
        String(src.storage_key),
        String(src.sha256 ?? ""),
        Number(src.size ?? 0),
        src.mime != null ? String(src.mime) : null,
        opts.actor,
        src.original_filename != null ? String(src.original_filename) : null,
        Boolean(src.is_shared),
      ],
    );
    const doc = rows[0];
    created.push(doc);
    await writeAudit({
      tenantId,
      entity: "document",
      entityId: String(doc.id),
      action: "DOCUMENT_LINKED_FROM_TEMPLATE",
      after: {
        sourceDocumentId: String(src.id),
        eventId: opts.eventId,
        storageKey: String(src.storage_key),
        copiedBytes: false,
      },
      actor: opts.actor,
      via: "UI",
    });
  }

  return { ok: true as const, documents: created };
}
