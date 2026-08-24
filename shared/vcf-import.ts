/**
 * Valid Car File (V_VALID_CARS) import — assignment-period grouping (§2).
 * Preview/review is dry-run; commit is a separate step.
 *
 * Write scope (commit): railcars, assignment_history, car_number_history.
 * Does not insert riders or master_leases. Does not write riders.account_manager.
 * See docs/IMPORT_WRITE_BOUNDARIES.md.
 */

export type VcfRawRow = Record<string, unknown>;

export type ParsedActive =
  | { ok: true; active: boolean; raw: string }
  | { ok: false; active: null; raw: string; error: string };

export type VcfParsedRow = {
  sourceRow: number;
  car_initial: string;
  car_number: string;
  carKey: string;
  car_type: string | null;
  assignment_id: string | null;
  assignment_label: string | null;
  start_date: string | null;
  end_date: string | null;
  start_date_unknown: boolean;
  end_date_unknown: boolean;
  end_date_indefinite: boolean;
  comment: string | null;
  activeParse: ParsedActive;
  client_id: string | null;
  general_description: string | null;
  legal_owner: string | null;
  lessee_name: string | null;
  rider_external_id: string | null;
  old_car_initial: string | null;
  old_car_number: string | null;
  dot_code: string | null;
  lease_type: string | null;
  managed: string | null;
  managed_category_raw: string | null;
  managed_category: string | null;
  managed_category_unmapped: boolean;
  cover_sheet: string | null;
  lining_material: string | null;
  entity: string | null;
  mechanical_designation: string | null;
  legacy_valid_car_id: string | null;
  update_made: string | null;
  update_needed_next_vcf: string | null;
};

export type CarGroupReview = {
  carKey: string;
  car_initial: string;
  car_number: string;
  periodCount: number;
  activePeriodCount: number;
  multipleActive: boolean;
  needsReview: boolean;
  current: VcfParsedRow;
  periods: VcfParsedRow[];
  isNew: boolean;
  isUpdate: boolean;
};

export type VcfReviewSummary = {
  totalRows: number;
  distinctCars: number;
  newCars: number;
  updatedCars: number;
  multipleActiveCount: number;
  multipleActiveCars: Array<{
    car_initial: string;
    car_number: string;
    activePeriodCount: number;
    assignment_ids: string[];
    start_dates: string[];
  }>;
  badActiveCount: number;
  badActiveValues: Array<{ raw: string; count: number; sampleRows: number[] }>;
  unmappedManagedCategoryCount: number;
  unmappedManagedCategories: Array<{ raw: string; count: number }>;
  cars: CarGroupReview[];
};

/** Canonical MANAGED_CATEGORY values (§4.2). */
export const MANAGED_CATEGORY_CANONICAL = [
  "ALF Marks",
  "Net Lease",
  "Idle",
  "Non-RAS Managed",
  "Progress, Special Handling",
] as const;

const MANAGED_CATEGORY_MAP: Record<string, (typeof MANAGED_CATEGORY_CANONICAL)[number]> = {
  alfmarks: "ALF Marks",
  netlease: "Net Lease",
  idle: "Idle",
  nonrasmanaged: "Non-RAS Managed",
  progressspecialhandling: "Progress, Special Handling",
};

const UNKNOWN_START = new Set(["1901-01-01"]);
const UNKNOWN_END = new Set(["1900-01-06", "1901-01-01"]);

/**
 * VCF uses 4000-12-31 as "indefinite / open-ended". Source files also produce
 * near-miss variants (e.g. 4000-12-21 from a typo or Excel quirk). Treat any
 * end year ≥ 3000 as the same sentinel — never as a real lease expiration.
 */
export function isIndefiniteEndDate(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const y = Number(String(iso).trim().slice(0, 4));
  return Number.isFinite(y) && y >= 3000;
}

function normKey(h: string): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Map VCF header variants → internal field. */
const VCF_HEADERS: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  const add = (field: string, ...aliases: string[]) => {
    for (const a of aliases) m[normKey(a)] = field;
  };
  add("update_made", "UPDATE MADE", "UPDATE_MADE");
  add("update_needed_next_vcf", "UPDATE NEEDED NEXT VCF", "UPDATE_NEEDED_NEXT_VCF");
  add("legacy_valid_car_id", "VALID_CAR_ID");
  add("car_initial", "CAR_INITIAL");
  add("car_number", "CAR_NUMBER");
  add("car_type", "CAR_TYPE");
  add("assignment_id", "ASSIGNMENT_ID");
  add("assignment_label", "ASSIGNMENT");
  add("start_date", "START_DATE");
  add("end_date", "END_DATE");
  add("comment", "COMMENT");
  add("active_raw", "ACTIVE");
  add("client_id", "CLIENT_ID");
  add("general_description", "GENERAL_DESCRIPTION");
  add("legal_owner", "Owner", "OWNER");
  add("lessee_name", "Lessee", "LESSEE");
  add("rider_external_id", "Rider", "RIDER");
  add("old_car_initial", "OLD_CAR_INITIAL");
  add("old_car_number", "OLD_CAR_NUMBER");
  add("dot_code", "DOT_CODE");
  add("lease_type", "LEASE_TYPE");
  add("managed", "MANAGED");
  add("managed_category_raw", "MANAGED_CATEGORY");
  add("cover_sheet", "COVER_SHEET");
  add("lining_material", "LINING_MATERIAL");
  add("entity", "Entity", "ENTITY");
  add("mechanical_designation", "MECHANICAL_DESIGNATION");
  return m;
})();

export function normalizeVcfHeaderRow(row: VcfRawRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const field = VCF_HEADERS[normKey(k)];
    if (!field) continue;
    out[field] = v;
  }
  return out;
}

export function mapManagedCategory(raw: string | null | undefined): {
  canonical: string | null;
  unmapped: boolean;
  raw: string | null;
} {
  if (raw == null) return { canonical: null, unmapped: false, raw: null };
  const s = String(raw).trim();
  if (!s) return { canonical: null, unmapped: false, raw: null };
  const key = s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const mapped = MANAGED_CATEGORY_MAP[key];
  if (mapped) return { canonical: mapped, unmapped: false, raw: s };
  return { canonical: s, unmapped: true, raw: s };
}

export function parseActiveCell(v: unknown): ParsedActive {
  if (v === null || v === undefined || v === "") {
    return { ok: false, active: null, raw: "(blank)", error: "ACTIVE is blank" };
  }
  // Excel may give number -1 / 0
  if (typeof v === "number") {
    if (v === -1) return { ok: true, active: true, raw: "-1" };
    if (v === 0) return { ok: true, active: false, raw: "0" };
    return { ok: false, active: null, raw: String(v), error: `Unrecognized ACTIVE numeric value: ${v}` };
  }
  const s = String(v).trim();
  if (s === "-1") return { ok: true, active: true, raw: s };
  if (s === "0") return { ok: true, active: false, raw: s };
  return { ok: false, active: null, raw: s, error: `Unrecognized ACTIVE value: ${s}` };
}

function excelSerialToIso(n: number): string | null {
  // Excel serial (1900 date system); Lotus leap-year quirk
  const ms = (n - 25569) * 86400 * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function parseVcfDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") return excelSerialToIso(v);
  const s = String(v).trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/.exec(s);
  if (us) {
    const [, m, d, y] = us;
    const yyyy = y.length === 2 ? (Number(y) > 50 ? `19${y}` : `20${y}`) : y;
    return `${yyyy}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

function str(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s || null;
}

function carNumStr(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "number") return String(Math.trunc(v));
  return String(v).trim();
}

export function parseVcfRow(raw: VcfRawRow, sourceRow: number): VcfParsedRow | null {
  const n = normalizeVcfHeaderRow(raw);
  const car_initial = (str(n.car_initial) ?? "").toUpperCase();
  const car_number = carNumStr(n.car_number);
  if (!car_initial && !car_number) return null;

  const start_date = parseVcfDate(n.start_date);
  const end_date = parseVcfDate(n.end_date);
  const mc = mapManagedCategory(str(n.managed_category_raw));
  const activeParse = parseActiveCell(n.active_raw);

  return {
    sourceRow,
    car_initial,
    car_number,
    carKey: `${car_initial}|${car_number}`,
    car_type: str(n.car_type),
    assignment_id: str(n.assignment_id),
    assignment_label: str(n.assignment_label),
    start_date,
    end_date,
    start_date_unknown: !!(start_date && UNKNOWN_START.has(start_date)),
    end_date_unknown: !!(end_date && UNKNOWN_END.has(end_date)),
    end_date_indefinite: isIndefiniteEndDate(end_date),
    comment: str(n.comment),
    activeParse,
    client_id: str(n.client_id),
    general_description: str(n.general_description),
    legal_owner: str(n.legal_owner),
    lessee_name: str(n.lessee_name),
    rider_external_id: str(n.rider_external_id),
    old_car_initial: str(n.old_car_initial)?.toUpperCase() ?? null,
    old_car_number: n.old_car_number == null || n.old_car_number === "" ? null : carNumStr(n.old_car_number),
    dot_code: str(n.dot_code),
    lease_type: str(n.lease_type),
    managed: str(n.managed),
    managed_category_raw: mc.raw,
    managed_category: mc.canonical,
    managed_category_unmapped: mc.unmapped,
    cover_sheet: str(n.cover_sheet),
    lining_material: str(n.lining_material),
    entity: str(n.entity),
    mechanical_designation: str(n.mechanical_designation),
    legacy_valid_car_id: str(n.legacy_valid_car_id),
    update_made: str(n.update_made),
    update_needed_next_vcf: str(n.update_needed_next_vcf),
  };
}

function dateSortKey(d: string | null, unknown: boolean): number {
  if (!d || unknown) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(d);
  return isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Pick current row for a car group per §2.1 step 3. */
export function pickCurrentRow(periods: VcfParsedRow[]): {
  current: VcfParsedRow;
  multipleActive: boolean;
  needsReview: boolean;
} {
  const activeOk = periods.filter((p) => p.activeParse.ok && p.activeParse.active === true);
  if (activeOk.length === 1) {
    return { current: activeOk[0], multipleActive: false, needsReview: false };
  }
  if (activeOk.length > 1) {
    const sorted = [...activeOk].sort(
      (a, b) => dateSortKey(b.start_date, b.start_date_unknown) - dateSortKey(a.start_date, a.start_date_unknown)
    );
    return { current: sorted[0], multipleActive: true, needsReview: true };
  }
  // No active periods — latest END_DATE excluding indefinite sentinel
  const candidates = periods.filter((p) => !p.end_date_indefinite);
  const pool = candidates.length ? candidates : periods;
  const sorted = [...pool].sort(
    (a, b) => dateSortKey(b.end_date, b.end_date_unknown) - dateSortKey(a.end_date, a.end_date_unknown)
  );
  return { current: sorted[0], multipleActive: false, needsReview: false };
}

/**
 * Build §2.3 review summary. existingKeys = Set of "INITIAL|NUMBER" already in railcars.
 */
export function buildVcfReview(
  rawRows: VcfRawRow[],
  existingKeys: Set<string> = new Set()
): VcfReviewSummary {
  const parsed: VcfParsedRow[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const p = parseVcfRow(rawRows[i], i + 2); // +2 ≈ header on row 1
    if (p) parsed.push(p);
  }

  const byCar = new Map<string, VcfParsedRow[]>();
  for (const p of parsed) {
    const list = byCar.get(p.carKey) ?? [];
    list.push(p);
    byCar.set(p.carKey, list);
  }

  const cars: CarGroupReview[] = [];
  const multipleActiveCars: VcfReviewSummary["multipleActiveCars"] = [];
  let newCars = 0;
  let updatedCars = 0;

  for (const [carKey, periods] of byCar) {
    const { current, multipleActive, needsReview } = pickCurrentRow(periods);
    const exists = existingKeys.has(carKey);
    if (exists) updatedCars += 1;
    else newCars += 1;
    const activePeriodCount = periods.filter((p) => p.activeParse.ok && p.activeParse.active).length;
    cars.push({
      carKey,
      car_initial: current.car_initial,
      car_number: current.car_number,
      periodCount: periods.length,
      activePeriodCount,
      multipleActive,
      needsReview,
      current,
      periods,
      isNew: !exists,
      isUpdate: exists,
    });
    if (multipleActive) {
      multipleActiveCars.push({
        car_initial: current.car_initial,
        car_number: current.car_number,
        activePeriodCount,
        assignment_ids: periods
          .filter((p) => p.activeParse.ok && p.activeParse.active)
          .map((p) => p.assignment_id ?? "(none)"),
        start_dates: periods
          .filter((p) => p.activeParse.ok && p.activeParse.active)
          .map((p) => p.start_date ?? "(unknown)"),
      });
    }
  }

  // Bad ACTIVE tallies
  const badMap = new Map<string, { count: number; sampleRows: number[] }>();
  for (const p of parsed) {
    if (p.activeParse.ok) continue;
    const raw = p.activeParse.raw;
    const e = badMap.get(raw) ?? { count: 0, sampleRows: [] };
    e.count += 1;
    if (e.sampleRows.length < 5) e.sampleRows.push(p.sourceRow);
    badMap.set(raw, e);
  }
  const badActiveValues = [...badMap.entries()]
    .map(([raw, v]) => ({ raw, count: v.count, sampleRows: v.sampleRows }))
    .sort((a, b) => b.count - a.count);

  // Unmapped managed category
  const umMap = new Map<string, number>();
  for (const p of parsed) {
    if (!p.managed_category_unmapped || !p.managed_category_raw) continue;
    umMap.set(p.managed_category_raw, (umMap.get(p.managed_category_raw) ?? 0) + 1);
  }
  const unmappedManagedCategories = [...umMap.entries()]
    .map(([raw, count]) => ({ raw, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalRows: parsed.length,
    distinctCars: byCar.size,
    newCars,
    updatedCars,
    multipleActiveCount: multipleActiveCars.length,
    multipleActiveCars: multipleActiveCars.sort((a, b) =>
      `${a.car_initial}${a.car_number}`.localeCompare(`${b.car_initial}${b.car_number}`)
    ),
    badActiveCount: badActiveValues.reduce((s, x) => s + x.count, 0),
    badActiveValues,
    unmappedManagedCategoryCount: unmappedManagedCategories.reduce((s, x) => s + x.count, 0),
    unmappedManagedCategories,
    cars,
  };
}

/** Build railcars upsert payload from current VCF period (locked column mapping). */
export function railcarPayloadFromCurrent(
  current: VcfParsedRow,
  opts?: { needsReview?: boolean }
): Record<string, unknown> {
  const active =
    current.activeParse.ok && current.activeParse.active === true
      ? true
      : current.activeParse.ok
        ? false
        : false;
  const reviewNote = opts?.needsReview
    ? "NEEDS REVIEW: multiple simultaneously-active VCF assignment rows (imported with latest START_DATE as best-guess current)."
    : null;
  const comment = [current.comment, reviewNote].filter(Boolean).join(" | ") || null;
  return {
    car_initial: current.car_initial,
    car_number: current.car_number,
    reporting_marks: current.car_initial,
    car_type: current.car_type,
    mechanical_designation: current.mechanical_designation,
    general_description: current.general_description,
    lease_type: current.lease_type,
    managed: current.managed,
    managed_category: current.managed_category,
    lining_material: current.lining_material,
    entity: current.entity,
    active,
    active_status: active ? "Active" : "Inactive",
    rider_external_id: current.rider_external_id,
    lessee_name: current.lessee_name,
    assignment_label: current.assignment_label,
    lease_start_date: current.start_date_unknown ? null : current.start_date,
    lease_end_date:
      current.end_date_unknown || current.end_date_indefinite ? null : current.end_date,
    lease_expiry:
      current.end_date_unknown || current.end_date_indefinite ? null : current.end_date,
    dot_code: current.dot_code,
    dot_specification: current.dot_code,
    comment_event_note: comment,
    legacy_valid_car_id: current.legacy_valid_car_id,
    client_id: current.client_id,
    cover_sheet: current.cover_sheet,
    legal_owner: current.legal_owner,
    update_made: current.update_made,
    update_needed_next_vcf: current.update_needed_next_vcf,
    current_assignment_id: current.assignment_id,
    data_source: "V_VALID_CARS",
    // Do NOT set old_car_initial / old_car_number — remarks go to car_number_history only
  };
}

/**
 * Natural key for a VCF assignment-period row in assignment_history (§2.1 step 5).
 *
 * Bruce's intent: car + ASSIGNMENT_ID. In the real V_VALID_CARS file that alone is not
 * unique — renewals reuse ASSIGNMENT_ID, and a handful of rows also share start_date
 * while differing on end_date. Period identity is therefore:
 *   railcar_id + ASSIGNMENT_ID + start_date + end_date
 * ACTIVE is intentionally NOT part of the key so month-over-month ACTIVE flips update
 * the existing period row instead of inserting a sibling.
 * Nulls are empty-string so the key stays stable across runs.
 */
export function assignmentHistoryNaturalKey(
  railcarId: number,
  assignmentIdExt: string | null | undefined,
  startDate: string | null | undefined,
  endDate?: string | null | undefined
): string {
  return [
    railcarId,
    String(assignmentIdExt ?? "").trim(),
    String(startDate ?? "").trim(),
    String(endDate ?? "").trim(),
  ].join("|");
}

/** Natural key for a VCF remark row in car_number_history. */
export function carNumberHistoryNaturalKey(input: {
  railcarId: number;
  old_car_initial: string | null | undefined;
  old_car_number: string | null | undefined;
  new_car_initial: string | null | undefined;
  new_car_number: string | null | undefined;
  changed_at: string | null | undefined;
}): string {
  const day = String(input.changed_at ?? "").slice(0, 10);
  return [
    input.railcarId,
    String(input.old_car_initial ?? "").trim().toUpperCase(),
    String(input.old_car_number ?? "").trim(),
    String(input.new_car_initial ?? "").trim().toUpperCase(),
    String(input.new_car_number ?? "").trim(),
    day,
  ].join("|");
}

export type AssignmentHistoryPeriodPayload = {
  railcar_id: number;
  rider_external_id: string | null;
  assignment_label: string | null;
  start_date: string | null;
  end_date: string | null;
  active: boolean | null;
  comment: string | null;
  assignment_id_ext: string | null;
  moved_at: string;
  moved_by: string;
  reason: string;
};

/** Build assignment_history row from a VCF period (no delete-all — upsert by natural key). */
export function assignmentHistoryPayloadFromPeriod(
  railcarId: number,
  p: VcfParsedRow,
  movedAtIso: string
): AssignmentHistoryPeriodPayload {
  return {
    railcar_id: railcarId,
    rider_external_id: p.rider_external_id,
    assignment_label: p.assignment_label,
    start_date: p.start_date_unknown ? null : p.start_date,
    end_date: p.end_date_unknown || p.end_date_indefinite ? null : p.end_date,
    active: p.activeParse.ok ? p.activeParse.active : null,
    comment: p.comment,
    assignment_id_ext: p.assignment_id,
    moved_at: movedAtIso,
    moved_by: "vcf-import",
    reason: "V_VALID_CARS assignment period",
  };
}

export type CarNumberHistoryPayload = {
  railcar_id: number;
  old_car_initial: string | null;
  old_car_number: string;
  new_car_initial: string;
  new_car_number: string;
  changed_at: string;
  changed_by: string;
  reason: string;
};

/** Build car_number_history row when OLD_CAR_* is present. */
export function carNumberHistoryPayloadFromPeriod(
  railcarId: number,
  p: VcfParsedRow,
  fallbackIso: string
): CarNumberHistoryPayload | null {
  if (!p.old_car_initial && !p.old_car_number) return null;
  const changed_at =
    p.start_date && !p.start_date_unknown ? `${p.start_date}T00:00:00.000Z` : fallbackIso;
  return {
    railcar_id: railcarId,
    old_car_initial: p.old_car_initial,
    old_car_number: p.old_car_number || p.car_number,
    new_car_initial: p.car_initial,
    new_car_number: p.car_number,
    changed_at,
    changed_by: "vcf-import",
    reason: "V_VALID_CARS OLD_CAR_*",
  };
}

/**
 * Compare two assignment_history period payloads for "content unchanged".
 * Ignores moved_at so identical monthly re-runs don't look like drift.
 */
export function assignmentHistoryContentEqual(
  a: Partial<AssignmentHistoryPeriodPayload>,
  b: Partial<AssignmentHistoryPeriodPayload>
): boolean {
  const fields: (keyof AssignmentHistoryPeriodPayload)[] = [
    "rider_external_id",
    "assignment_label",
    "start_date",
    "end_date",
    "active",
    "comment",
    "assignment_id_ext",
    "reason",
  ];
  return fields.every((f) => String(a[f] ?? "") === String(b[f] ?? ""));
}
