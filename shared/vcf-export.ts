/**
 * V_Valid Car File monthly export — reconstruct V_VALID_CARS from live RLMS data.
 * One output row per assignment_history period, plus a fallback row for cars
 * that have never had an assignment_history row (New Acquisitions / Add Railcar).
 *
 * Read-only. OLD_CAR_* is a best-effort date match against car_number_history
 * (same calendar date as the period start_date), not a guaranteed row-level link.
 */

export const V_VALID_EXPORT_HEADERS = [
  "CAR_INITIAL",
  "CAR_NUMBER",
  "CAR_TYPE",
  "MECHANICAL_DESIGNATION",
  "GENERAL_DESCRIPTION",
  "DOT_CODE",
  "LINING_MATERIAL",
  "LEASE_TYPE",
  "MANAGED",
  "MANAGED_CATEGORY",
  "Entity",
  "ACTIVE",
  "START_DATE",
  "END_DATE",
  "Rider",
  "ASSIGNMENT",
  "ASSIGNMENT_ID",
  "Lessee",
  "OLD_CAR_INITIAL",
  "OLD_CAR_NUMBER",
  "Owner",
  "VALID_CAR_ID",
  "CLIENT_ID",
  "COVER_SHEET",
  "COMMENT",
  "UPDATE MADE",
  "UPDATE NEEDED NEXT VCF",
] as const;

export type VValidExportHeader = (typeof V_VALID_EXPORT_HEADERS)[number];

export type VValidExportRow = Record<VValidExportHeader, string | number>;

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
};

export type VValidRemarkRow = {
  railcar_id: number;
  changed_at: string | null;
  old_car_initial: string | null;
  old_car_number: string | null;
};

const EMPTY = "";

function cell(v: unknown): string {
  if (v == null) return EMPTY;
  return String(v);
}

/** Original file used Main / RPS / Coal — never the display name Rail Partners Select. */
export function exportVcfEntity(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return EMPTY;
  if (s === "Rail Partners Select" || s.toLowerCase() === "rps") return "RPS";
  return s;
}

/** Per-period ACTIVE: true → -1, false → 0. Null stays blank (e.g. later Move Cars events). */
export function exportVcfActive(v: boolean | null | undefined): number | "" {
  if (v === true) return -1;
  if (v === false) return 0;
  return EMPTY;
}

/** Pass date values through as YYYY-MM-DD; do not null sentinels like 1901-01-01 or 4000-12-31. */
export function exportVcfDate(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Reconstruct Lessee from ASSIGNMENT by stripping this row's Rider id from the end.
 * Handles "Lessee - OL1948", "Lessee -OL1508", and "Lessee OL2522".
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
  return s.replace(/[\s\u2013\u2014-]+$/g, "").trim();
}

export function remarkCalendarDate(changedAt: string | null | undefined): string {
  return exportVcfDate(changedAt);
}

export function remarkLookupKey(railcarId: number, dateIso: string): string {
  return `${railcarId}|${dateIso}`;
}

export function buildRemarkIndex(remarks: VValidRemarkRow[]): Map<string, { old_car_initial: string; old_car_number: string }> {
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

function carFields(car: VValidCarAttrs): Pick<
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
  | "UPDATE NEEDED NEXT VCF"
> {
  return {
    CAR_INITIAL: cell(car.car_initial),
    CAR_NUMBER: cell(car.car_number),
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
    VALID_CAR_ID: cell(car.legacy_valid_car_id),
    CLIENT_ID: cell(car.client_id),
    COVER_SHEET: cell(car.cover_sheet),
    "UPDATE MADE": cell(car.update_made),
    "UPDATE NEEDED NEXT VCF": cell(car.update_needed_next_vcf),
  };
}

function lookupOldCar(
  idx: Map<string, { old_car_initial: string; old_car_number: string }>,
  railcarId: number,
  startDate: string,
): { OLD_CAR_INITIAL: string; OLD_CAR_NUMBER: string } {
  if (!startDate) return { OLD_CAR_INITIAL: EMPTY, OLD_CAR_NUMBER: EMPTY };
  const hit = idx.get(remarkLookupKey(railcarId, startDate));
  if (!hit) return { OLD_CAR_INITIAL: EMPTY, OLD_CAR_NUMBER: EMPTY };
  return { OLD_CAR_INITIAL: hit.old_car_initial, OLD_CAR_NUMBER: hit.old_car_number };
}

export function historyRowToExport(
  ah: VValidHistoryRow,
  car: VValidCarAttrs,
  remarks: Map<string, { old_car_initial: string; old_car_number: string }>,
): VValidExportRow {
  const start = exportVcfDate(ah.start_date);
  const old = lookupOldCar(remarks, car.id, start);
  return {
    ...carFields(car),
    ACTIVE: exportVcfActive(ah.active),
    START_DATE: start,
    END_DATE: exportVcfDate(ah.end_date),
    Rider: cell(ah.rider_external_id),
    ASSIGNMENT: cell(ah.assignment_label),
    ASSIGNMENT_ID: cell(ah.assignment_id_ext),
    Lessee: lesseeFromAssignmentLabel(ah.assignment_label, ah.rider_external_id),
    ...old,
    COMMENT: cell(ah.comment),
  };
}

/** Cars with no assignment_history at all — still must appear once. */
export function orphanCarToExport(car: VValidCarAttrs): VValidExportRow {
  return {
    ...carFields(car),
    ACTIVE: exportVcfActive(car.active),
    START_DATE: exportVcfDate(car.acquisition_date),
    END_DATE: EMPTY,
    Rider: cell(car.rider_external_id),
    ASSIGNMENT: cell(car.assignment_label),
    ASSIGNMENT_ID: EMPTY,
    Lessee: cell(car.lessee_name),
    OLD_CAR_INITIAL: EMPTY,
    OLD_CAR_NUMBER: EMPTY,
    COMMENT: EMPTY,
  };
}

export function buildVValidExportRows(
  history: VValidHistoryRow[],
  cars: VValidCarAttrs[],
  remarks: VValidRemarkRow[],
): VValidExportRow[] {
  const carById = new Map<number, VValidCarAttrs>();
  for (const c of cars) carById.set(c.id, c);
  const remarkIdx = buildRemarkIndex(remarks);
  const rows: VValidExportRow[] = [];
  const seenCarIds = new Set<number>();

  for (const ah of history) {
    const car = carById.get(ah.railcar_id);
    if (!car) continue;
    seenCarIds.add(car.id);
    rows.push(historyRowToExport(ah, car, remarkIdx));
  }

  for (const car of cars) {
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
    const na = String(a.CAR_NUMBER);
    const nb = String(b.CAR_NUMBER);
    if (na !== nb) return na.localeCompare(nb);
    const sa = String(a.START_DATE);
    const sb = String(b.START_DATE);
    if (sa !== sb) return sa.localeCompare(sb);
    const aa = String(a.ASSIGNMENT_ID);
    const ab = String(b.ASSIGNMENT_ID);
    if (aa !== ab) return aa.localeCompare(ab);
    return String(a.ASSIGNMENT).localeCompare(String(b.ASSIGNMENT));
  });
}

export function exportRowsToAoa(rows: VValidExportRow[]): (string | number)[][] {
  const header = [...V_VALID_EXPORT_HEADERS];
  const body = rows.map((r) =>
    header.map((h) => {
      const v = r[h];
      if (h === "ACTIVE" && (v === -1 || v === 0)) return v;
      if (v === "" || v == null) return EMPTY;
      return String(v);
    }),
  );
  return [header, ...body];
}

export type VValidViewRow = {
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
    CAR_INITIAL: cell(r.car_initial),
    CAR_NUMBER: cell(r.car_number),
    CAR_TYPE: cell(r.car_type),
    MECHANICAL_DESIGNATION: cell(r.mechanical_designation),
    GENERAL_DESCRIPTION: cell(r.general_description),
    DOT_CODE: cell(r.dot_code),
    LINING_MATERIAL: cell(r.lining_material),
    LEASE_TYPE: cell(r.lease_type),
    MANAGED: cell(r.managed),
    MANAGED_CATEGORY: cell(r.managed_category),
    Entity: exportVcfEntity(r.entity),
    ACTIVE: active,
    START_DATE: exportVcfDate(r.start_date),
    END_DATE: exportVcfDate(r.end_date),
    Rider: cell(r.rider),
    ASSIGNMENT: cell(r.assignment),
    ASSIGNMENT_ID: cell(r.assignment_id),
    Lessee: cell(r.lessee),
    OLD_CAR_INITIAL: cell(r.old_car_initial),
    OLD_CAR_NUMBER: cell(r.old_car_number),
    Owner: cell(r.owner),
    VALID_CAR_ID: cell(r.valid_car_id),
    CLIENT_ID: cell(r.client_id),
    COVER_SHEET: cell(r.cover_sheet),
    COMMENT: cell(r.comment),
    "UPDATE MADE": cell(r.update_made),
    "UPDATE NEEDED NEXT VCF": cell(r.update_needed_next_vcf),
  };
}
