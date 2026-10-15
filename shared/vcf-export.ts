/**
 * V_Valid Car File monthly export — reconstruct V_VALID_CARS from live RLMS data.
 * One output row per assignment_history period that was in the latest load
 * (or created inside RLMS), plus a fallback row for cars with no history.
 *
 * Read-only. OLD_CAR_* is a best-effort date match against car_number_history
 * (same calendar date as the period start_date), not a guaranteed row-level link.
 */

export const V_VALID_EXPORT_HEADERS = [
  "UPDATE MADE",
  " UPDATE NEEDED NEXT VCF",
  "VALID_CAR_ID",
  "CAR_INITIAL",
  "CAR_NUMBER",
  "CAR_TYPE",
  "ASSIGNMENT_ID",
  "ASSIGNMENT",
  "START_DATE",
  "END_DATE",
  "COMMENT",
  "ACTIVE",
  "CLIENT_ID",
  "GENERAL_DESCRIPTION",
  "Owner",
  "Lessee",
  "Rider",
  "OLD_CAR_INITIAL",
  "OLD_CAR_NUMBER",
  "DOT_CODE",
  "LEASE_TYPE",
  "MANAGED",
  "MANAGED_CATEGORY",
  "COVER_SHEET",
  "LINING_MATERIAL",
  "Entity",
  "MECHANICAL_DESIGNATION",
] as const;

export type VValidExportHeader = (typeof V_VALID_EXPORT_HEADERS)[number];

export type VValidExportCell = string | number | "";

export type VValidExportRow = Record<VValidExportHeader, VValidExportCell>;

/** Dropped-file column widths (Excel). END_DATE and MECHANICAL_DESIGNATION had no stored width. */
export const V_VALID_EXPORT_COLUMN_WIDTHS: number[] = [
  30.66, 26.22, 12.89, 9.89, 9.44, 9.89, 14.0, 34.11, 13.44, 13.44, 26.78, 8.89, 11.0, 19.11, 13.33,
  19.11, 11.66, 11.89, 11.0, 12.66, 10.11, 10.0, 11.55, 13.66, 13.0, 10.89, 13.0,
];

export const EXCEL_NUM_FMT_6 = "000000";
export const EXCEL_NUM_FMT_INT = "0";
export const EXCEL_DATE_FMT = "mm/dd/yyyy";

const NUMERIC6_HEADERS = new Set<VValidExportHeader>([
  "CAR_NUMBER",
  "ASSIGNMENT_ID",
  "CLIENT_ID",
  "OLD_CAR_NUMBER",
]);

export type VValidCarAttrs = {
  id: number;
  car_initial: string | null;
  car_number: string | null;
  car_type: string | null;
  mechanical_designation: string | null;
  general_description: string | null;
  dot_code: string | null;
  lining_material: string | null;
  lease_type: string | null;
  managed: string | null;
  managed_category: string | null;
  entity: string | null;
  legal_owner: string | null;
  legacy_valid_car_id: string | null;
  client_id: string | null;
  cover_sheet: string | null;
  update_made: string | null;
  update_needed_next_vcf: string | null;
  rider_external_id: string | null;
  assignment_label: string | null;
  lessee_name: string | null;
  active: boolean | null;
  acquisition_date: string | null;
};

export type VValidHistoryRow = {
  id: number;
  railcar_id: number;
  rider_external_id: string | null;
  assignment_label: string | null;
  start_date: string | null;
  end_date: string | null;
  active: boolean | null;
  comment: string | null;
  assignment_id_ext: string | null;
  last_seen_load_id?: string | null;
  moved_by?: string | null;
  valid_car_id_ext?: string | number | null;
};

export type VValidRemarkRow = {
  railcar_id: number;
  changed_at: string | null;
  old_car_initial: string | null;
  old_car_number: string | null;
};

const EMPTY = "";

const RIDER_TOKEN_RE = /(?:\s*[-–—]\s*|\s+)x?(?:EA|OL|EX)\d{3,}\s*$/i;
const SOLD_TOKEN_RE = /(?:\s*[-–—]\s*)SOLD\s*$/i;

function cell(v: unknown): string {
  if (v == null) return EMPTY;
  return String(v);
}

export function isTestCarInitial(v: unknown): boolean {
  return String(v ?? "").trim().toUpperCase() === "TEST";
}

/** Car's current Entity. Never abbreviate to RPS. */
export function exportVcfEntity(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return EMPTY;
  if (s.toLowerCase() === "rps") return "Rail Partners Select";
  return s;
}

/** Per-period ACTIVE: true → -1, false → 0. Inactive cars force 0 on every row. */
export function exportVcfActive(
  periodActive: boolean | null | undefined,
  carActive?: boolean | null,
): number | "" {
  if (carActive === false) return 0;
  if (periodActive === true) return -1;
  if (periodActive === false) return 0;
  return EMPTY;
}

/** Pass date values through as YYYY-MM-DD; do not null 1901-01-01. */
export function exportVcfDate(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

export function exportVcfStartDate(
  start: unknown,
  movedBy?: string | null,
): string {
  const iso = exportVcfDate(start);
  if (iso) return iso;
  if (String(movedBy ?? "") === "vcf-import") return "1901-01-01";
  return EMPTY;
}

export function exportVcfEndDate(end: unknown): string {
  const iso = exportVcfDate(end);
  if (iso) return iso;
  return "4000-12-31";
}

export function includeHistoryForExport(
  ah: { last_seen_load_id?: string | null; moved_by?: string | null },
  latestLoadId: string | null,
): boolean {
  if (latestLoadId && ah.last_seen_load_id === latestLoadId) return true;
  if (ah.last_seen_load_id == null && String(ah.moved_by ?? "") !== "vcf-import") return true;
  return false;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Reconstruct Lessee from ASSIGNMENT by stripping this row's Rider id, then any
 * other trailing rider-style token (` - OL1917`, `-EA…`, ` - SOLD`).
 * Leaves a leading "x" prefix in place (wound-down deal marker).
 */
export function lesseeFromAssignmentLabel(
  assignmentLabel: string | null | undefined,
  riderExternalId: string | null | undefined,
): string {
  let s = String(assignmentLabel ?? "").trim();
  if (!s) return EMPTY;
  const rider = String(riderExternalId ?? "").trim();
  if (rider) {
    const rid = escapeRegExp(rider);
    s = s.replace(new RegExp(`(?:\\s*[-\\u2013\\u2014]\\s*|\\s+)${rid}\\s*$`, "i"), "");
    s = s.replace(new RegExp(`${rid}\\s*$`, "i"), "");
  }
  for (let i = 0; i < 8; i += 1) {
    const next = s.replace(RIDER_TOKEN_RE, "").replace(SOLD_TOKEN_RE, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/[\s\u2013\u2014-]+$/g, "").trim();
}

export function remarkCalendarDate(changedAt: string | null | undefined): string {
  return exportVcfDate(changedAt);
}

export function remarkLookupKey(railcarId: number, dateIso: string): string {
  return `${railcarId}|${dateIso}`;
}

export function buildRemarkIndex(
  remarks: VValidRemarkRow[],
): Map<string, { old_car_initial: string; old_car_number: string }> {
  const idx = new Map<string, { old_car_initial: string; old_car_number: string }>();
  for (const r of remarks) {
    const day = remarkCalendarDate(r.changed_at);
    if (!day) continue;
    const key = remarkLookupKey(r.railcar_id, day);
    if (idx.has(key)) continue;
    idx.set(key, {
      old_car_initial: cell(r.old_car_initial),
      old_car_number: cell(r.old_car_number),
    });
  }
  return idx;
}

export function parseExportNumber(v: unknown): number | "" {
  if (v == null || v === "") return EMPTY;
  const s = String(v).trim();
  if (!s) return EMPTY;
  const n = Number(s);
  if (!Number.isFinite(n)) return EMPTY;
  return n;
}

function carFields(
  car: VValidCarAttrs,
  validCarId: unknown,
): Pick<
  VValidExportRow,
  | "CAR_INITIAL"
  | "CAR_NUMBER"
  | "CAR_TYPE"
  | "MECHANICAL_DESIGNATION"
  | "GENERAL_DESCRIPTION"
  | "DOT_CODE"
  | "LINING_MATERIAL"
  | "LEASE_TYPE"
  | "MANAGED"
  | "MANAGED_CATEGORY"
  | "Entity"
  | "Owner"
  | "VALID_CAR_ID"
  | "CLIENT_ID"
  | "COVER_SHEET"
  | "UPDATE MADE"
  | " UPDATE NEEDED NEXT VCF"
> {
  return {
    CAR_INITIAL: cell(car.car_initial),
    CAR_NUMBER: parseExportNumber(car.car_number),
    CAR_TYPE: cell(car.car_type),
    MECHANICAL_DESIGNATION: cell(car.mechanical_designation),
    GENERAL_DESCRIPTION: cell(car.general_description),
    DOT_CODE: cell(car.dot_code),
    LINING_MATERIAL: cell(car.lining_material),
    LEASE_TYPE: cell(car.lease_type),
    MANAGED: cell(car.managed),
    MANAGED_CATEGORY: cell(car.managed_category),
    Entity: exportVcfEntity(car.entity),
    Owner: cell(car.legal_owner),
    VALID_CAR_ID: parseExportNumber(validCarId),
    CLIENT_ID: parseExportNumber(car.client_id),
    COVER_SHEET: cell(car.cover_sheet),
    "UPDATE MADE": cell(car.update_made),
    " UPDATE NEEDED NEXT VCF": cell(car.update_needed_next_vcf),
  };
}

function lookupOldCar(
  idx: Map<string, { old_car_initial: string; old_car_number: string }>,
  railcarId: number,
  startDate: string,
): { OLD_CAR_INITIAL: string; OLD_CAR_NUMBER: number | "" } {
  if (!startDate) return { OLD_CAR_INITIAL: EMPTY, OLD_CAR_NUMBER: EMPTY };
  const hit = idx.get(remarkLookupKey(railcarId, startDate));
  if (!hit) return { OLD_CAR_INITIAL: EMPTY, OLD_CAR_NUMBER: EMPTY };
  return { OLD_CAR_INITIAL: hit.old_car_initial, OLD_CAR_NUMBER: parseExportNumber(hit.old_car_number) };
}

export function historyRowToExport(
  ah: VValidHistoryRow,
  car: VValidCarAttrs,
  remarks: Map<string, { old_car_initial: string; old_car_number: string }>,
): VValidExportRow {
  const start = exportVcfStartDate(ah.start_date, ah.moved_by);
  const old = lookupOldCar(remarks, car.id, start);
  return {
    ...carFields(car, ah.valid_car_id_ext),
    ACTIVE: exportVcfActive(ah.active, car.active),
    START_DATE: start,
    END_DATE: exportVcfEndDate(ah.end_date),
    Rider: cell(ah.rider_external_id),
    ASSIGNMENT: cell(ah.assignment_label),
    ASSIGNMENT_ID: parseExportNumber(ah.assignment_id_ext),
    Lessee: lesseeFromAssignmentLabel(ah.assignment_label, ah.rider_external_id),
    ...old,
    COMMENT: cell(ah.comment),
  };
}

/** Cars with no assignment_history at all — still must appear once. */
export function orphanCarToExport(car: VValidCarAttrs): VValidExportRow {
  return {
    ...carFields(car, car.legacy_valid_car_id),
    ACTIVE: exportVcfActive(car.active, car.active),
    START_DATE: exportVcfDate(car.acquisition_date),
    END_DATE: exportVcfEndDate(null),
    Rider: cell(car.rider_external_id),
    ASSIGNMENT: cell(car.assignment_label),
    ASSIGNMENT_ID: EMPTY,
    Lessee: lesseeFromAssignmentLabel(car.assignment_label, car.rider_external_id) || cell(car.lessee_name),
    OLD_CAR_INITIAL: EMPTY,
    OLD_CAR_NUMBER: EMPTY,
    COMMENT: EMPTY,
  };
}

export function buildVValidExportRows(
  history: VValidHistoryRow[],
  cars: VValidCarAttrs[],
  remarks: VValidRemarkRow[],
  latestLoadId: string | null = null,
): VValidExportRow[] {
  const carById = new Map<number, VValidCarAttrs>();
  for (const c of cars) {
    if (isTestCarInitial(c.car_initial)) continue;
    carById.set(c.id, c);
  }
  const remarkIdx = buildRemarkIndex(remarks);
  const rows: VValidExportRow[] = [];
  const seenCarIds = new Set<number>();

  for (const ah of history) {
    if (!includeHistoryForExport(ah, latestLoadId)) continue;
    const car = carById.get(ah.railcar_id);
    if (!car) continue;
    seenCarIds.add(car.id);
    rows.push(historyRowToExport(ah, car, remarkIdx));
  }

  for (const car of carById.values()) {
    if (seenCarIds.has(car.id)) continue;
    rows.push(orphanCarToExport(car));
  }

  return sortVValidExportRows(rows);
}

export function sortVValidExportRows(rows: VValidExportRow[]): VValidExportRow[] {
  return [...rows].sort((a, b) => {
    const ia = String(a.CAR_INITIAL);
    const ib = String(b.CAR_INITIAL);
    if (ia !== ib) return ia.localeCompare(ib);
    const na = Number(a.CAR_NUMBER);
    const nb = Number(b.CAR_NUMBER);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    const sa = String(a.CAR_NUMBER);
    const sb = String(b.CAR_NUMBER);
    if (sa !== sb) return sa.localeCompare(sb);
    const da = String(a.START_DATE);
    const db = String(b.START_DATE);
    if (da !== db) return da.localeCompare(db);
    return 0;
  });
}

export function excelDateFromIso(iso: string): Date | "" {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return EMPTY;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

export function exportRowToValues(r: VValidExportRow): (string | number | Date)[] {
  return V_VALID_EXPORT_HEADERS.map((h) => {
    const v = r[h];
    if (h === "START_DATE" || h === "END_DATE") {
      if (v === "" || v == null) return EMPTY;
      const d = excelDateFromIso(String(v));
      return d === EMPTY ? String(v) : d;
    }
    if (h === "ACTIVE" && (v === -1 || v === 0)) return v;
    if (NUMERIC6_HEADERS.has(h) || h === "VALID_CAR_ID") {
      if (v === "" || v == null) return EMPTY;
      if (typeof v === "number") return v;
      return parseExportNumber(v);
    }
    if (v === "" || v == null) return EMPTY;
    return v;
  });
}

export function excelNumFmtForHeader(h: VValidExportHeader): string | null {
  if (h === "START_DATE" || h === "END_DATE") return EXCEL_DATE_FMT;
  if (NUMERIC6_HEADERS.has(h)) return EXCEL_NUM_FMT_6;
  if (h === "VALID_CAR_ID") return EXCEL_NUM_FMT_INT;
  if (h === "ACTIVE") return EXCEL_NUM_FMT_INT;
  return null;
}

export function exportRowsToAoa(rows: VValidExportRow[]): (string | number | Date)[][] {
  return [[...V_VALID_EXPORT_HEADERS], ...rows.map(exportRowToValues)];
}

export type VValidViewRow = {
  export_src?: number | null;
  export_id?: number | null;
  car_initial?: string | null;
  car_number?: string | null;
  car_type?: string | null;
  mechanical_designation?: string | null;
  general_description?: string | null;
  dot_code?: string | null;
  lining_material?: string | null;
  lease_type?: string | null;
  managed?: string | null;
  managed_category?: string | null;
  entity?: string | null;
  active?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  rider?: string | null;
  assignment?: string | null;
  assignment_id?: string | null;
  lessee?: string | null;
  old_car_initial?: string | null;
  old_car_number?: string | null;
  owner?: string | null;
  valid_car_id?: string | null;
  client_id?: string | null;
  cover_sheet?: string | null;
  comment?: string | null;
  update_made?: string | null;
  update_needed_next_vcf?: string | null;
};

export function viewRowToExport(r: VValidViewRow): VValidExportRow {
  const active = r.active === -1 || r.active === 0 ? r.active : EMPTY;
  return {
    "UPDATE MADE": cell(r.update_made),
    " UPDATE NEEDED NEXT VCF": cell(r.update_needed_next_vcf),
    VALID_CAR_ID: parseExportNumber(r.valid_car_id),
    CAR_INITIAL: cell(r.car_initial),
    CAR_NUMBER: parseExportNumber(r.car_number),
    CAR_TYPE: cell(r.car_type),
    ASSIGNMENT_ID: parseExportNumber(r.assignment_id),
    ASSIGNMENT: cell(r.assignment),
    START_DATE: exportVcfDate(r.start_date),
    END_DATE: exportVcfDate(r.end_date),
    COMMENT: cell(r.comment),
    ACTIVE: active,
    CLIENT_ID: parseExportNumber(r.client_id),
    GENERAL_DESCRIPTION: cell(r.general_description),
    Owner: cell(r.owner),
    Lessee: cell(r.lessee),
    Rider: cell(r.rider),
    OLD_CAR_INITIAL: cell(r.old_car_initial),
    OLD_CAR_NUMBER: parseExportNumber(r.old_car_number),
    DOT_CODE: cell(r.dot_code),
    LEASE_TYPE: cell(r.lease_type),
    MANAGED: cell(r.managed),
    MANAGED_CATEGORY: cell(r.managed_category),
    COVER_SHEET: cell(r.cover_sheet),
    LINING_MATERIAL: cell(r.lining_material),
    Entity: exportVcfEntity(r.entity),
    MECHANICAL_DESIGNATION: cell(r.mechanical_designation),
  };
}
