/**
 * Pencil editor — per-field Data File header edits with lock / edit+audit / free.
 * After Approved → Adjustment path (MG1).
 * Location on car is per-line (pos 109–111), not a header field.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import {
  getCorrectionEditorPayload,
  saveInternalCorrection,
  type CorrectionHeader,
} from "./gap-lifecycle-06";
import type { EstimateLineInput } from "./estimates";

export type HeaderEditMode = "LOCK" | "EDIT_AUDIT" | "FREE";

/** Format-1 / estimate header keys shown on the Data File header block. */
export const DATA_FILE_HEADER_FIELDS: Array<{
  key: string;
  label: string;
  group: string;
  mode: HeaderEditMode;
  lockWhy?: string;
}> = [
  // LOCK — wrong key → void + shop resubmit
  {
    key: "recordFormat",
    label: "Record Format",
    group: "Identity",
    mode: "LOCK",
    lockWhy: "Record format is locked. Wrong key → void and shop resubmit (audited).",
  },
  {
    key: "billingParty",
    label: "Billing / Invoicing Party Mark",
    group: "Parties",
    mode: "LOCK",
    lockWhy:
      "Billing/invoicing party mark is locked. Wrong key → void and shop resubmit (audited).",
  },
  {
    key: "billedParty",
    label: "Billed Party",
    group: "Parties",
    mode: "LOCK",
    lockWhy: "Billed party is locked. Wrong key → void and shop resubmit (audited).",
  },
  {
    key: "repairingParty",
    label: "Repairing Party / Shop Mark",
    group: "Parties",
    mode: "LOCK",
    lockWhy:
      "Repairing party / shop mark comes from shop master and is locked. Wrong key → void and shop resubmit (audited).",
  },
  {
    key: "shopMark",
    label: "Shop Mark",
    group: "Parties",
    mode: "LOCK",
    lockWhy:
      "Shop mark comes from shop master (not billing party). Locked. Wrong key → void and shop resubmit (audited).",
  },
  {
    key: "carInitial",
    label: "Car Initial",
    group: "Car",
    mode: "LOCK",
    lockWhy:
      "Car initial is locked. Wrong car → void this estimate and have the shop resubmit under the correct car (audited).",
  },
  {
    key: "carNumber",
    label: "Car Number",
    group: "Car",
    mode: "LOCK",
    lockWhy:
      "Car number is locked. Wrong car → void this estimate and have the shop resubmit under the correct car (audited).",
  },
  {
    key: "invoiceNumber",
    label: "Invoice Number",
    group: "Invoice",
    mode: "LOCK",
    lockWhy: "Invoice number is locked. Wrong key → void and shop resubmit (audited).",
  },
  {
    key: "accountDateYymm",
    label: "Account Date (YYMM)",
    group: "Invoice",
    mode: "LOCK",
    lockWhy: "Account date is locked. Wrong key → void and shop resubmit (audited).",
  },
  {
    key: "repairingPartyInvoice",
    label: "Shop Invoice Number",
    group: "Invoice",
    mode: "LOCK",
    lockWhy: "Shop invoice number is locked. Wrong key → void and shop resubmit (audited).",
  },
  {
    key: "estimateId",
    label: "Estimate ID",
    group: "Identity",
    mode: "LOCK",
    lockWhy: "Estimate ID is system-assigned and locked.",
  },
  {
    key: "revisionNo",
    label: "Revision No.",
    group: "Identity",
    mode: "LOCK",
    lockWhy: "Revision number is system-assigned and locked.",
  },
  {
    key: "boLink",
    label: "BO Link",
    group: "Identity",
    mode: "LOCK",
    lockWhy: "Bad Order link is locked.",
  },
  {
    key: "entitySnapshot",
    label: "Entity Snapshot",
    group: "Identity",
    mode: "LOCK",
    lockWhy: "Entity snapshot is locked.",
  },
  {
    key: "railincDateStamps",
    label: "Railinc Date Stamps",
    group: "Identity",
    mode: "LOCK",
    lockWhy: "Railinc date stamps are locked.",
  },
  {
    key: "resubmittedIndicator",
    label: "Resubmitted Indicator",
    group: "Identity",
    mode: "LOCK",
    lockWhy: "Resubmitted indicator is locked.",
  },
  {
    key: "originalInvoiceNumber",
    label: "Original Invoice No.",
    group: "Invoice",
    mode: "LOCK",
    lockWhy: "Original invoice number is locked. Wrong key → void and shop resubmit (audited).",
  },
  {
    key: "originalAccountDate",
    label: "Original Account Date",
    group: "Invoice",
    mode: "LOCK",
    lockWhy: "Original account date is locked. Wrong key → void and shop resubmit (audited).",
  },
  {
    key: "machinePriceable",
    label: "Machine-Priceable Flag",
    group: "Invoice",
    mode: "LOCK",
    lockWhy: "Machine-priceable flag is locked.",
  },
  {
    key: "currency",
    label: "Price-List Currency",
    group: "Invoice",
    mode: "LOCK",
    lockWhy: "Price-list currency is locked. Wrong key → void and shop resubmit (audited).",
  },

  // EDIT WITH REASON + AUDIT (Adjustment after approval)
  {
    key: "billingRoadOverride",
    label: "Billing Road Override",
    group: "Parties",
    mode: "EDIT_AUDIT",
  },
  {
    key: "detailSource",
    label: "Source Code",
    group: "Invoice",
    mode: "EDIT_AUDIT",
  },
  {
    key: "documentReference",
    label: "Document Ref / Counter Billing Authority",
    group: "Invoice",
    mode: "EDIT_AUDIT",
  },
  {
    key: "kindOfCar",
    label: "Kind of Car",
    group: "Car",
    mode: "EDIT_AUDIT",
  },
  {
    key: "loadEmpty",
    label: "Load / Empty",
    group: "Car",
    mode: "EDIT_AUDIT",
  },
  {
    key: "repairDateYymmdd",
    label: "Repair Date (YYMMDD)",
    group: "Dates / Location",
    mode: "EDIT_AUDIT",
  },
  {
    key: "outboundDate",
    label: "Outbound Date",
    group: "Dates / Location",
    mode: "EDIT_AUDIT",
  },
  {
    key: "completedDate",
    label: "Completed Date",
    group: "Dates / Location",
    mode: "EDIT_AUDIT",
  },
  {
    key: "splc",
    label: "SPLC",
    group: "Dates / Location",
    mode: "EDIT_AUDIT",
  },
  {
    key: "expandedSplc",
    label: "Expanded SPLC",
    group: "Dates / Location",
    mode: "EDIT_AUDIT",
  },
  {
    key: "facilityType",
    label: "Facility Type",
    group: "Dates / Location",
    mode: "EDIT_AUDIT",
  },
  {
    key: "defectCardParty",
    label: "Defect Card / JIC Party",
    group: "DDCT",
    mode: "EDIT_AUDIT",
  },
  {
    key: "defectCardDate",
    label: "Defect Card / JIC Date",
    group: "DDCT",
    mode: "EDIT_AUDIT",
  },
  {
    key: "ddctIncidentId",
    label: "DDCT Incident ID",
    group: "DDCT",
    mode: "EDIT_AUDIT",
  },
  {
    key: "aarComponentId",
    label: "AAR Component ID",
    group: "DDCT",
    mode: "EDIT_AUDIT",
  },

  // FREE — notes / remarks / user area (Format 6 contacts stay FREE; BP contact required elsewhere)
  {
    key: "notes",
    label: "Notes",
    group: "Notes",
    mode: "FREE",
  },
  {
    key: "internalRemarks",
    label: "Internal Remarks",
    group: "Notes",
    mode: "FREE",
  },
  {
    key: "userArea",
    label: "100-Byte User Area",
    group: "Notes",
    mode: "FREE",
  },
  {
    key: "format6Contacts",
    label: "Format 6 Contacts",
    group: "Notes",
    mode: "FREE",
  },
];

const HEADER_KEY_SET = new Set(DATA_FILE_HEADER_FIELDS.map((f) => f.key));
const FIELD_BY_KEY = new Map(DATA_FILE_HEADER_FIELDS.map((f) => [f.key, f]));

export function headerFieldMode(fieldKey: string): HeaderEditMode | null {
  return FIELD_BY_KEY.get(fieldKey)?.mode ?? null;
}

export function headerFieldLockWhy(fieldKey: string): string | null {
  const f = FIELD_BY_KEY.get(fieldKey);
  if (!f || f.mode !== "LOCK") return null;
  return f.lockWhy ?? `${f.label} is locked.`;
}

/** Build header object from a Format-1 parsed fields map (snake or already camel). */
export function headerFromAarFields(
  fields: Record<string, string | number | null | undefined>,
  opts?: { shopMarkFromMaster?: string | null },
): CorrectionHeader {
  const g = (snake: string, camel: string) => {
    const v = fields[camel] ?? fields[snake];
    if (v == null) return null;
    const s = String(v).trim();
    return s.length ? s : null;
  };
  const shopFromMaster = (opts?.shopMarkFromMaster ?? "").trim() || null;
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
    // Location on car is per-line only (pos 109–111) — not stored on header
    defectCardParty: g("defect_card_party", "defectCardParty"),
    defectCardDate: g("defect_card_date", "defectCardDate"),
    aarComponentId: g("aar_component_id", "aarComponentId"),
    ddctIncidentId: g("ddct_incident_id", "ddctIncidentId"),
    expandedSplc: g("expanded_splc", "expandedSplc"),
    // Shop mark from shop master only — never fall back to billing party
    shopMark: shopFromMaster ?? g("repairing_party", "shopMark") ?? g("repairing_party", "repairingParty"),
    notes: g("notes", "notes"),
    internalRemarks: g("internal_remarks", "internalRemarks"),
    userArea: g("user_area", "userArea"),
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
 * Pencil-edit one header field.
 * LOCK → 409. EDIT_AUDIT / FREE require reason (FREE still audited for trail).
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
  // Location on car moved to per-line — reject if client still sends it
  if (fieldKey === "locationOnCar") {
    return {
      ok: false as const,
      status: 409,
      error:
        "Location on car is a per-line field (positions 109–111), not a header field.",
    };
  }
  if (!HEADER_KEY_SET.has(fieldKey)) {
    return { ok: false as const, status: 400, error: `Unknown header field: ${fieldKey}` };
  }
  const mode = headerFieldMode(fieldKey);
  if (mode === "LOCK") {
    return {
      ok: false as const,
      status: 409,
      error: headerFieldLockWhy(fieldKey) ?? "This header field is locked.",
    };
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
  // Ensure shop mark stays from shop master when present on payload
  if (payload.shopMarkFromMaster) {
    header.shopMark = String(payload.shopMarkFromMaster);
  }
  const oldValue =
    header[fieldKey] == null || header[fieldKey] === ""
      ? null
      : String(header[fieldKey]);
  const newValue = opts.newValue.trim();
  if ((oldValue ?? "") === newValue) {
    return { ok: false as const, status: 400, error: "Value unchanged" };
  }
  // Never allow editing shopMark away from master via free-form — already LOCK
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
      mode,
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
