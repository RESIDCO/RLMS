/**
 * Pencil editor — per-field Data File header edits with required reason + audit.
 * After Approved → Adjustment path (MG1).
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import {
  getCorrectionEditorPayload,
  saveInternalCorrection,
  type CorrectionHeader,
} from "./gap-lifecycle-06";
import type { EstimateLineInput } from "./estimates";

/** Format-1 / estimate header keys shown on the Data File header block. */
export const DATA_FILE_HEADER_FIELDS: Array<{
  key: string;
  label: string;
  group: string;
}> = [
  { key: "billingParty", label: "Billing Road / Billing Party", group: "Parties" },
  { key: "billedParty", label: "Billed Party", group: "Parties" },
  { key: "repairingParty", label: "Shop / Repairing Party", group: "Parties" },
  { key: "detailSource", label: "Source Code", group: "Invoice" },
  { key: "invoiceNumber", label: "Invoice Number", group: "Invoice" },
  { key: "accountDateYymm", label: "Account Date (YYMM)", group: "Invoice" },
  { key: "currency", label: "Currency", group: "Invoice" },
  { key: "documentReference", label: "Document Reference", group: "Invoice" },
  { key: "repairingPartyInvoice", label: "Shop Invoice Number", group: "Invoice" },
  { key: "carInitial", label: "Car Initial", group: "Car" },
  { key: "carNumber", label: "Car Number", group: "Car" },
  { key: "kindOfCar", label: "Kind of Car", group: "Car" },
  { key: "loadEmpty", label: "Load / Empty", group: "Car" },
  { key: "repairDateYymmdd", label: "Repair Date (YYMMDD)", group: "Dates / Location" },
  { key: "splc", label: "SPLC", group: "Dates / Location" },
  { key: "expandedSplc", label: "Expanded SPLC", group: "Dates / Location" },
  { key: "facilityType", label: "Facility Type", group: "Dates / Location" },
  { key: "locationOnCar", label: "Location on Car", group: "Dates / Location" },
  { key: "defectCardParty", label: "Defect Card / JIC Party", group: "DDCT" },
  { key: "defectCardDate", label: "Defect Card / JIC Date", group: "DDCT" },
  { key: "aarComponentId", label: "AAR Component ID", group: "DDCT" },
  { key: "ddctIncidentId", label: "DDCT Incident ID", group: "DDCT" },
  { key: "shopMark", label: "Shop Mark", group: "Notes" },
  { key: "notes", label: "Notes", group: "Notes" },
];

const HEADER_KEY_SET = new Set(DATA_FILE_HEADER_FIELDS.map((f) => f.key));

/** Build header object from a Format-1 parsed fields map (snake or already camel). */
export function headerFromAarFields(
  fields: Record<string, string | number | null | undefined>,
): CorrectionHeader {
  const g = (snake: string, camel: string) => {
    const v = fields[camel] ?? fields[snake];
    if (v == null) return null;
    const s = String(v).trim();
    return s.length ? s : null;
  };
  return {
    billingParty: g("billing_party", "billingParty"),
    billedParty: g("billed_party", "billedParty"),
    accountDateYymm: g("account_date_yymm", "accountDateYymm"),
    invoiceNumber: g("invoice_number", "invoiceNumber"),
    currency: g("currency", "currency"),
    detailSource: g("detail_source", "detailSource"),
    documentReference: g("document_reference", "documentReference"),
    carInitial: g("car_initial", "carInitial"),
    carNumber: g("car_number", "carNumber"),
    kindOfCar: g("kind_of_car", "kindOfCar"),
    loadEmpty: g("load_empty", "loadEmpty"),
    repairDateYymmdd: g("repair_date_yymmdd", "repairDateYymmdd"),
    splc: g("splc", "splc"),
    repairingParty: g("repairing_party", "repairingParty"),
    repairingPartyInvoice: g("repairing_party_invoice", "repairingPartyInvoice"),
    facilityType: g("facility_type", "facilityType"),
    locationOnCar: g("location_on_car", "locationOnCar"),
    defectCardParty: g("defect_card_party", "defectCardParty"),
    defectCardDate: g("defect_card_date", "defectCardDate"),
    aarComponentId: g("aar_component_id", "aarComponentId"),
    ddctIncidentId: g("ddct_incident_id", "ddctIncidentId"),
    expandedSplc: g("expanded_splc", "expandedSplc"),
    shopMark: g("repairing_party", "shopMark") ?? g("billing_party", "billingParty"),
    notes: g("notes", "notes"),
  };
}

export async function listHeaderEdits(opts: {
  estimateId: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT * FROM repair.estimate_header_edits
     WHERE estimate_id = $1 AND tenant_id = $2
     ORDER BY edited_at DESC`,
    [opts.estimateId, tenantId],
  );
  return rows;
}

/**
 * Pencil-edit one header field. Reason required. Audited old→new.
 * Post-Approved uses Adjustment path via internal correction revision.
 */
export async function editHeaderField(opts: {
  estimateId: string;
  fieldKey: string;
  newValue: string;
  reason: string;
  actor: string;
  actorRole?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const fieldKey = opts.fieldKey.trim();
  const reason = (opts.reason ?? "").trim();
  if (!HEADER_KEY_SET.has(fieldKey)) {
    return { ok: false as const, status: 400, error: `Unknown header field: ${fieldKey}` };
  }
  if (!reason) {
    return { ok: false as const, status: 400, error: "Edit reason is required" };
  }

  const payload = await getCorrectionEditorPayload({
    estimateId: opts.estimateId,
    tenantId,
  });
  if (!payload.ok) {
    return { ok: false as const, status: payload.status, error: payload.error };
  }

  const header: CorrectionHeader = { ...(payload.header as CorrectionHeader) };
  const oldValue =
    header[fieldKey] == null || header[fieldKey] === ""
      ? null
      : String(header[fieldKey]);
  const newValue = opts.newValue.trim();
  if ((oldValue ?? "") === newValue) {
    return { ok: false as const, status: 400, error: "Value unchanged" };
  }
  header[fieldKey] = newValue || null;

  const lines: EstimateLineInput[] = (payload.lines as Array<Record<string, unknown>>).map(
    (l, i) => ({
      lineNo: Number(l.line_no ?? i + 1),
      aarJobCode: l.aar_job_code != null ? String(l.aar_job_code) : undefined,
      qualifier: l.qualifier != null ? String(l.qualifier) : undefined,
      whyMade: l.why_made != null ? String(l.why_made) : undefined,
      conditionCode: l.condition_code != null ? String(l.condition_code) : undefined,
      respCode: l.resp_code != null ? String(l.resp_code) : undefined,
      labor: Number(l.labor ?? 0),
      material: Number(l.material ?? 0),
      total: Number(l.total ?? Number(l.labor ?? 0) + Number(l.material ?? 0)),
      repairCategory: l.repair_category != null ? String(l.repair_category) : null,
      subCategory: l.sub_category != null ? String(l.sub_category) : null,
      aarComponentId: l.aar_component_id != null ? String(l.aar_component_id) : null,
      ddctIncidentId: l.ddct_incident_id != null ? String(l.ddct_incident_id) : null,
      rawLine: l.raw_line != null ? String(l.raw_line) : undefined,
    }),
  );
  if (!lines.length) {
    return {
      ok: false as const,
      status: 409,
      error: "No lines on estimate — cannot audit header edit without a revision",
    };
  }

  const saved = await saveInternalCorrection({
    estimateId: opts.estimateId,
    actor: opts.actor,
    actorRole: opts.actorRole ?? "reviewer",
    reason: `Header ${fieldKey}: ${reason}`,
    header,
    lines,
    asAdjustment: payload.needsAdjustment,
    tenantId,
  });
  if (!saved.ok) {
    return { ok: false as const, status: saved.status, error: saved.error };
  }

  const { rows: editRows } = await q(
    `INSERT INTO repair.estimate_header_edits
       (tenant_id, estimate_id, field_key, old_value, new_value, reason, actor, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     RETURNING *`,
    [tenantId, opts.estimateId, fieldKey, oldValue, newValue || null, reason, opts.actor],
  );

  await writeAudit({
    tenantId,
    entity: "estimate_header",
    entityId: opts.estimateId,
    action: "HEADER_FIELD_EDIT",
    before: { fieldKey, oldValue },
    after: {
      fieldKey,
      newValue: newValue || null,
      reason,
      adjustment: payload.needsAdjustment,
    },
    actor: opts.actor,
    via: "UI",
  });

  return {
    ok: true as const,
    edit: editRows[0],
    header,
    revision: saved.revision,
    needsAdjustment: payload.needsAdjustment,
  };
}
