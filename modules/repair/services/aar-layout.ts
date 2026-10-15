/**
 * Versioned 500-byte layout table.
 * Parser reads positions from here (or DB) — never hard-coded slices in call sites.
 */

export type LayoutField = {
  field_key: string;
  record_format: string;
  col_start: number; // 1-based
  length: number;
  data_type: "A/N" | "N" | "A" | "cents" | "raw";
  required: boolean;
  preserve_raw: boolean;
  notes?: string | null;
};

export type LayoutVersion = {
  version: string;
  fields: LayoutField[];
};

/** CRB Appendix G Format 1 — mirrors migration seed CRB-AppG-2024 */
export const LAYOUT_CRB_APPG_2024: LayoutVersion = {
  version: "CRB-AppG-2024",
  fields: [
    { field_key: "record_format", record_format: "1", col_start: 1, length: 1, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "billing_party", record_format: "1", col_start: 2, length: 4, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "billed_party", record_format: "1", col_start: 6, length: 4, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "account_date_yymm", record_format: "1", col_start: 10, length: 4, data_type: "N", required: true, preserve_raw: false },
    { field_key: "invoice_number", record_format: "1", col_start: 14, length: 16, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "currency", record_format: "1", col_start: 30, length: 1, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "detail_source", record_format: "1", col_start: 31, length: 2, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "document_reference", record_format: "1", col_start: 33, length: 15, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "car_initial", record_format: "1", col_start: 48, length: 4, data_type: "A", required: true, preserve_raw: false },
    { field_key: "car_number", record_format: "1", col_start: 52, length: 6, data_type: "N", required: true, preserve_raw: false },
    { field_key: "kind_of_car", record_format: "1", col_start: 58, length: 1, data_type: "A", required: false, preserve_raw: false },
    { field_key: "load_empty", record_format: "1", col_start: 59, length: 1, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "repair_date_yymmdd", record_format: "1", col_start: 60, length: 6, data_type: "N", required: true, preserve_raw: false },
    { field_key: "splc", record_format: "1", col_start: 66, length: 6, data_type: "N", required: true, preserve_raw: false },
    { field_key: "repairing_party", record_format: "1", col_start: 72, length: 4, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "repairing_party_invoice", record_format: "1", col_start: 76, length: 16, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "repairing_party_doc_ref", record_format: "1", col_start: 92, length: 15, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "facility_type", record_format: "1", col_start: 107, length: 2, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "location_on_car", record_format: "1", col_start: 109, length: 2, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "reserved_111", record_format: "1", col_start: 111, length: 1, data_type: "A/N", required: false, preserve_raw: true },
    { field_key: "reserved_112", record_format: "1", col_start: 112, length: 1, data_type: "N", required: false, preserve_raw: true },
    { field_key: "quantity", record_format: "1", col_start: 113, length: 4, data_type: "N", required: true, preserve_raw: false },
    { field_key: "condition_code", record_format: "1", col_start: 117, length: 1, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "reserved_118", record_format: "1", col_start: 118, length: 2, data_type: "N", required: false, preserve_raw: true },
    { field_key: "applied_job_code", record_format: "1", col_start: 120, length: 4, data_type: "N", required: true, preserve_raw: false },
    { field_key: "applied_qualifier", record_format: "1", col_start: 124, length: 3, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "why_made", record_format: "1", col_start: 127, length: 2, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "reserved_129", record_format: "1", col_start: 129, length: 2, data_type: "N", required: false, preserve_raw: true },
    { field_key: "removed_job_code", record_format: "1", col_start: 131, length: 4, data_type: "N", required: true, preserve_raw: false },
    { field_key: "removed_qualifier", record_format: "1", col_start: 135, length: 3, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "responsibility_code", record_format: "1", col_start: 138, length: 1, data_type: "N", required: true, preserve_raw: false },
    { field_key: "defect_card_party", record_format: "1", col_start: 139, length: 4, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "defect_card_date", record_format: "1", col_start: 143, length: 6, data_type: "N", required: false, preserve_raw: false },
    { field_key: "labor_cents", record_format: "1", col_start: 149, length: 7, data_type: "cents", required: true, preserve_raw: false },
    { field_key: "material_cents", record_format: "1", col_start: 156, length: 8, data_type: "cents", required: true, preserve_raw: false },
    { field_key: "material_sign", record_format: "1", col_start: 164, length: 1, data_type: "A", required: true, preserve_raw: false },
    { field_key: "machine_priceable", record_format: "1", col_start: 165, length: 1, data_type: "A", required: true, preserve_raw: false },
    { field_key: "wrong_repair", record_format: "1", col_start: 166, length: 1, data_type: "A", required: false, preserve_raw: false },
    { field_key: "description", record_format: "1", col_start: 167, length: 50, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "labor_rate_cents", record_format: "1", col_start: 217, length: 5, data_type: "cents", required: false, preserve_raw: false },
    { field_key: "expanded_splc", record_format: "1", col_start: 222, length: 9, data_type: "N", required: false, preserve_raw: false },
    { field_key: "span_231_288", record_format: "1", col_start: 231, length: 58, data_type: "raw", required: false, preserve_raw: true },
    { field_key: "line_number", record_format: "1", col_start: 289, length: 5, data_type: "N", required: true, preserve_raw: false },
    { field_key: "railinc_inbound_stamp", record_format: "1", col_start: 294, length: 6, data_type: "N", required: false, preserve_raw: true },
    { field_key: "railinc_outbound_stamp", record_format: "1", col_start: 300, length: 6, data_type: "N", required: false, preserve_raw: true },
    { field_key: "resubmitted_indicator", record_format: "1", col_start: 306, length: 1, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "original_invoice", record_format: "1", col_start: 307, length: 16, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "original_account_date", record_format: "1", col_start: 323, length: 4, data_type: "N", required: false, preserve_raw: false },
    { field_key: "aar_component_id", record_format: "1", col_start: 327, length: 14, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "ddct_incident_id", record_format: "1", col_start: 341, length: 12, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "reserved_353", record_format: "1", col_start: 353, length: 48, data_type: "raw", required: false, preserve_raw: true },
    { field_key: "free_user_area", record_format: "1", col_start: 401, length: 100, data_type: "raw", required: false, preserve_raw: true },
    // Format 6 — Contact (BP mandatory)
    { field_key: "record_format", record_format: "6", col_start: 1, length: 1, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "billing_party", record_format: "6", col_start: 2, length: 4, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "billed_party", record_format: "6", col_start: 6, length: 4, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "account_date_yymm", record_format: "6", col_start: 10, length: 4, data_type: "N", required: true, preserve_raw: false },
    { field_key: "invoice_number", record_format: "6", col_start: 14, length: 16, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "currency", record_format: "6", col_start: 30, length: 1, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "contact_type", record_format: "6", col_start: 31, length: 2, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "company_name", record_format: "6", col_start: 33, length: 50, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "contact_name", record_format: "6", col_start: 83, length: 35, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "title", record_format: "6", col_start: 118, length: 35, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "phone", record_format: "6", col_start: 153, length: 25, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "fax", record_format: "6", col_start: 178, length: 25, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "email", record_format: "6", col_start: 203, length: 60, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "address1", record_format: "6", col_start: 263, length: 45, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "address2", record_format: "6", col_start: 308, length: 45, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "address3", record_format: "6", col_start: 353, length: 45, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "address4", record_format: "6", col_start: 398, length: 45, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "city", record_format: "6", col_start: 443, length: 35, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "state", record_format: "6", col_start: 478, length: 2, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "country", record_format: "6", col_start: 480, length: 2, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "zip", record_format: "6", col_start: 482, length: 10, data_type: "A/N", required: false, preserve_raw: false },
    // Format 8 — Invoice subtotal / total (ZZ)
    { field_key: "record_format", record_format: "8", col_start: 1, length: 1, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "billing_party", record_format: "8", col_start: 2, length: 4, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "billed_party", record_format: "8", col_start: 6, length: 4, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "account_date_yymm", record_format: "8", col_start: 10, length: 4, data_type: "N", required: true, preserve_raw: false },
    { field_key: "invoice_number", record_format: "8", col_start: 14, length: 16, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "currency", record_format: "8", col_start: 30, length: 1, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "detail_source", record_format: "8", col_start: 31, length: 2, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "record_count", record_format: "8", col_start: 33, length: 7, data_type: "N", required: true, preserve_raw: false },
    { field_key: "labor_cents", record_format: "8", col_start: 40, length: 10, data_type: "cents", required: true, preserve_raw: false },
    { field_key: "material_cents", record_format: "8", col_start: 50, length: 16, data_type: "cents", required: true, preserve_raw: false },
    { field_key: "material_sign", record_format: "8", col_start: 66, length: 1, data_type: "A", required: true, preserve_raw: false },
    { field_key: "invoice_date", record_format: "8", col_start: 67, length: 6, data_type: "N", required: false, preserve_raw: false },
    { field_key: "taxpayer_id", record_format: "8", col_start: 73, length: 15, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "payment_terms", record_format: "8", col_start: 88, length: 2, data_type: "A/N", required: false, preserve_raw: false },
    { field_key: "payment_due_date", record_format: "8", col_start: 90, length: 6, data_type: "N", required: false, preserve_raw: false },
    // Format 9 — File control
    { field_key: "record_format", record_format: "9", col_start: 1, length: 1, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "billing_party", record_format: "9", col_start: 2, length: 4, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "billed_party", record_format: "9", col_start: 6, length: 4, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "account_date_yymm", record_format: "9", col_start: 10, length: 4, data_type: "N", required: true, preserve_raw: false },
    { field_key: "invoice_number", record_format: "9", col_start: 14, length: 16, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "currency", record_format: "9", col_start: 30, length: 1, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "detail_source", record_format: "9", col_start: 31, length: 2, data_type: "A/N", required: true, preserve_raw: false },
    { field_key: "record_count", record_format: "9", col_start: 33, length: 7, data_type: "N", required: true, preserve_raw: false },
    { field_key: "labor_cents", record_format: "9", col_start: 40, length: 10, data_type: "cents", required: true, preserve_raw: false },
    { field_key: "material_cents", record_format: "9", col_start: 50, length: 16, data_type: "cents", required: true, preserve_raw: false },
    { field_key: "material_sign", record_format: "9", col_start: 66, length: 1, data_type: "A", required: true, preserve_raw: false },
  ],
};

export function getBundledLayout(version = "CRB-AppG-2024"): LayoutVersion {
  if (version === LAYOUT_CRB_APPG_2024.version) return LAYOUT_CRB_APPG_2024;
  throw new Error(`Unknown bundled layout version: ${version}`);
}
