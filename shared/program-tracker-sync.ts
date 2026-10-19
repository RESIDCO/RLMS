/**
 * Programs tracker sync: match cars, type values, blank every N/A on active
 * cars, and build per-program column layouts. Pure functions — no I/O.
 *
 * The tracker wins. Inactive cars and rent_events are never writes.
 */

import { TRACKER_TAB_COLUMNS } from "./program-tracker-orders";

export const TRACKER_SYNC_KIND = "program_tracker_sync";
export const TRACKER_ORDER_VIEW = "Tracker order";
export const PROGRAM_DEFAULT_VIEW = "Program default";

export const NEW_SHOPS = ["PFL-St Louis TRRA", "Port Harbor RR-Granite City, IL"] as const;

/** Sheet tab → RLMS program name when the two differ. */
export const TAB_PROGRAM_ALIASES: Record<string, string> = {
  "CP ACQUISITION": "CP ACQUISITION - 60 4750's",
  "OL2405 - Andersons": "OL2405 - The Andersons",
  "OL-VARIES - SOLD TO TRIPLE M": "VARIES - SOLD TO TRIPLE M",
};

export const REFERENCE_TABS = new Set([
  "template",
  "chart1",
  "summary",
  "pod tracker",
  "live estimates issue cars",
  "scrap locations",
  "shop selection details",
]);

export type SyncAction = "fill blank" | "change" | "clear" | "review" | "skip";

export type FieldType = "text" | "number" | "currency" | "date" | "boolean";

export type FieldTarget =
  | { kind: "custom"; key: string; type: FieldType; write: boolean }
  | { kind: "column"; key: "status" | "notes" | "shop_id"; type: FieldType; write: boolean }
  | { kind: "identity"; role: "old_mark" | "old_number" | "new_mark" | "new_number" }
  | { kind: "skip" };

const TRACE_DETAIL_KEYS = [
  "trace_loaded_or_empty",
  "trace_event_text",
  "trace_train_id",
  "trace_destination_city",
  "trace_destination_state",
  "trace_reporting_rr",
] as const;

export const GLOBAL_OPTIONAL_FIELDS: { field_key: string; label: string; field_type: FieldType; section: string }[] = [
  { field_key: "gate_1_clearance", label: "Gate 1 clearance", field_type: "text", section: "Optional" },
  { field_key: "gate_2_clearance", label: "Gate 2 clearance", field_type: "text", section: "Optional" },
  { field_key: "gate_3_clearance", label: "Gate 3 clearance", field_type: "text", section: "Optional" },
  { field_key: "cost_of_exterior_paint", label: "Cost of exterior paint", field_type: "currency", section: "Optional" },
  { field_key: "cost_of_interior_paint", label: "Cost of interior paint", field_type: "currency", section: "Optional" },
  { field_key: "cost_of_cleaning", label: "Cost of cleaning", field_type: "currency", section: "Optional" },
  { field_key: "b_o_estimate_cost", label: "B/O estimate cost", field_type: "currency", section: "Optional" },
  { field_key: "b_o_estimate_approved", label: "B/O estimate approved", field_type: "boolean", section: "Optional" },
  { field_key: "nld_arrival_date", label: "NLD arrival date", field_type: "date", section: "Optional" },
  { field_key: "pod_date", label: "POD date", field_type: "date", section: "Optional" },
  { field_key: "completion_date", label: "Completion date", field_type: "date", section: "Optional" },
  { field_key: "eol_date", label: "EOL date", field_type: "date", section: "Optional" },
  { field_key: "billing_end_date", label: "Billing end date", field_type: "date", section: "Optional" },
  { field_key: "brc_complete_date", label: "BRC complete date", field_type: "date", section: "Optional" },
  { field_key: "operating_lease", label: "Operating lease", field_type: "text", section: "Optional" },
  { field_key: "new_operating_lease", label: "New operating lease", field_type: "text", section: "Optional" },
  { field_key: "previous_lease", label: "Previous lease", field_type: "text", section: "Optional" },
  { field_key: "approval_request", label: "Approval request", field_type: "date", section: "Optional" },
  { field_key: "original_code6_lessee_approval", label: "Original Code 6 lessee approval", field_type: "date", section: "Optional" },
  { field_key: "final_code6_approval_request", label: "Final Code 6 approval request", field_type: "date", section: "Optional" },
  { field_key: "final_code6_lessee_approval", label: "Final Code 6 lessee approval", field_type: "date", section: "Optional" },
  { field_key: "cleaning_certificate_received", label: "Cleaning certificate received", field_type: "boolean", section: "Optional" },
  { field_key: "umler_rights_granted", label: "Umler rights granted", field_type: "boolean", section: "Optional" },
  { field_key: "remark_date", label: "Remark date", field_type: "date", section: "Optional" },
  { field_key: "scrap_arrival_date", label: "Scrap arrival date", field_type: "date", section: "Optional" },
  { field_key: "next_qual_due", label: "Next qual due", field_type: "date", section: "Optional" },
  { field_key: "remark_material_ordered", label: "Remark material ordered", field_type: "text", section: "Optional" },
  { field_key: "lessee", label: "Lessee", field_type: "text", section: "Optional" },
  { field_key: "loaded_by_lessee", label: "Loaded by lessee", field_type: "text", section: "Optional" },
  { field_key: "return_location", label: "Return location", field_type: "text", section: "Optional" },
  { field_key: "settlement_amount", label: "Settlement amount", field_type: "currency", section: "Optional" },
];

/** Grid columns for a program that has no saved layout yet. Optional globals stay hidden. */
export const GLOBAL_PROGRAM_CAR_COLUMN_ORDER = [
  "car",
  "cf:new_reporting_mark",
  "cf:new_car_number",
  "cf:operating_lease",
  "cf:nld_to",
  "shop",
  "status",
  "cf:arrived_shop_date",
  "cf:repair_date",
  "cf:original_code6",
  "cf:original_code7",
  "cf:original_brc_total",
  "cf:original_approval_date",
  "cf:final_code6",
  "cf:final_code7",
  "cf:final_brc_total",
  "cf:final_approval_date",
  "cf:outbound_target_date",
  "cf:brc_complete",
  "cf:brc_complete_date",
  "cf:dispo_requested",
  "cf:dispo_provided",
  "cf:dispo_instructions",
  "cf:released_from_shop",
  "cf:lease_start_date",
  "cf:arrived_lessee_destination",
  "notes",
  "cf:trace_date",
  "cf:trace_city",
  "cf:trace_state",
] as const;

/** SUMMARY label or tab name → the workbook tab that actually exists. */
export function resolveTrackerSheet(name: string, sheetNames: readonly string[]): string | null {
  const names = new Set(sheetNames);
  if (names.has(name)) return name;
  const want = name.trim().toLowerCase();
  for (const [tab, program] of Object.entries(TAB_PROGRAM_ALIASES)) {
    if (program.trim().toLowerCase() === want && names.has(tab)) return tab;
    if (tab.trim().toLowerCase() === want && names.has(program)) return program;
  }
  return sheetNames.find((n) => n.trim().toLowerCase() === want) ?? null;
}

export function programCarsListKey(programId: number): string {
  return `program_cars:${programId}`;
}

export function categoryCarsListKey(categoryId: number): string {
  return `program_cars:category:${categoryId}`;
}

export function normalizeHeader(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeShopName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isNaValue(raw: unknown): boolean {
  if (raw == null) return false;
  const s = String(raw).replace(/\s+/g, " ").trim().toLowerCase();
  return s === "n/a" || s === "na" || s === "n.a." || s === "#n/a" || s === "n/a (clear)";
}

export function isBlankValue(raw: unknown): boolean {
  if (raw == null) return true;
  if (typeof raw === "string" && raw.trim() === "") return true;
  return false;
}

/** Digits only, leading zeros removed. "003370" and 3370 share a key. */
export function normalizeCarNumber(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return digits || (String(raw ?? "").trim() ? "0" : "");
}

/** "ELTX/OFCX" becomes both marks. */
export function splitMarks(raw: unknown): string[] {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return [];
  const parts = s.split("/").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : [s];
}

export function identityKeys(mark: unknown, number: unknown): string[] {
  const num = normalizeCarNumber(number);
  if (!num) return [];
  return splitMarks(mark).map((m) => `${m}|${num}`);
}

export type ShopRecord = { id: number; name: string };

export function matchShop(name: unknown, shops: ShopRecord[]): { id: number | null; status: "blank" | "match" | "missing" | "ambiguous" } {
  const norm = normalizeShopName(name);
  if (!norm || isNaValue(name)) return { id: null, status: "blank" };
  const hits = shops.filter((s) => normalizeShopName(s.name) === norm);
  if (hits.length === 1) return { id: hits[0].id, status: "match" };
  if (hits.length === 0) return { id: null, status: "missing" };
  return { id: null, status: "ambiguous" };
}

function custom(key: string, type: FieldType, write = true): FieldTarget {
  return { kind: "custom", key, type, write };
}
function column(key: "status" | "notes" | "shop_id", type: FieldType): FieldTarget {
  return { kind: "column", key, type, write: true };
}
function layoutOnly(key: string, type: FieldType): FieldTarget {
  return { kind: "custom", key, type, write: false };
}

const HEADER_TARGETS: Record<string, FieldTarget> = {
  "reporting mark": { kind: "identity", role: "old_mark" },
  "current rm": { kind: "identity", role: "old_mark" },
  "car mark": { kind: "identity", role: "old_mark" },
  mark: { kind: "identity", role: "old_mark" },
  initial: { kind: "identity", role: "old_mark" },
  "new reporting mark": { kind: "identity", role: "new_mark" },
  "new rm": { kind: "identity", role: "new_mark" },
  "new mark": { kind: "identity", role: "new_mark" },
  "new car mark": { kind: "identity", role: "new_mark" },
  "new railcar number": { kind: "identity", role: "new_number" },
  "new car number": { kind: "identity", role: "new_number" },
  "new number": { kind: "identity", role: "new_number" },
  "ol#": custom("operating_lease", "text"),
  "operating lease": custom("operating_lease", "text"),
  "previous lease": custom("previous_lease", "text"),
  "new ol#": custom("new_operating_lease", "text"),
  "nld to": custom("nld_to", "text"),
  "shop location": column("shop_id", "text"),
  shop: column("shop_id", "text"),
  "designated shop location": column("shop_id", "text"),
  status: column("status", "text"),
  "car status": column("status", "text"),
  "arrived shop": custom("arrived_shop_date", "date"),
  "repair date": custom("repair_date", "date"),
  "original code 6 lessee repair": custom("original_code6", "currency"),
  "original code 7 owners repair": custom("original_code7", "currency"),
  "original total brc": custom("original_brc_total", "currency"),
  "original ras approval date": custom("original_approval_date", "date"),
  "original tops approval date": custom("original_approval_date", "date"),
  "original code 6 approval request": custom("approval_request", "date"),
  "original code 6 approval requested": custom("approval_request", "date"),
  "original code 6 lessee approval": custom("original_code6_lessee_approval", "date"),
  "final code 6 lessee repair": custom("final_code6", "currency"),
  "final code 7 owners repair": custom("final_code7", "currency"),
  "final total brc": custom("final_brc_total", "currency"),
  "final ras approval date": custom("final_approval_date", "date"),
  "final tops approval date": custom("final_approval_date", "date"),
  "final code 6 approval request": custom("final_code6_approval_request", "date"),
  "final code 6 lessee approval": custom("final_code6_lessee_approval", "date"),
  "outbound target date": custom("outbound_target_date", "date"),
  "brc complete": custom("brc_complete", "boolean"),
  "dispo requested": custom("dispo_requested", "date"),
  "dispo provided": custom("dispo_provided", "date"),
  "dispo instructions": custom("dispo_instructions", "text"),
  "dispo location": custom("dispo_location", "text"),
  "released from shop": custom("released_from_shop", "date"),
  "lease start date": custom("lease_start_date", "date"),
  "arrived destination": custom("arrived_lessee_destination", "date"),
  "arrived lessee destination": custom("arrived_lessee_destination", "date"),
  "trace date": custom("trace_date", "date"),
  "location city": layoutOnly("trace_city", "text"),
  "location state": layoutOnly("trace_state", "text"),
  lessee: custom("lessee", "text"),
  "umler rights granted": custom("umler_rights_granted", "boolean"),
  "pre-registered in umler": custom("pre_registered", "boolean"),
  "pre-registered": custom("pre_registered", "boolean"),
  "pre-registered as sphx": custom("pre_registered", "boolean"),
  "pre-registered in umler ": custom("pre_registered", "boolean"),
  "arrived return/interchange location": custom("return_location", "text"),
  "remark material ordered": custom("remark_material_ordered", "text"),
  "remark date": custom("remark_date", "date"),
  "loaded by lessee": custom("loaded_by_lessee", "text"),
  "cleaning certificate received": custom("cleaning_certificate_received", "boolean"),
  "cleaning cert received": custom("cleaning_certificate_received", "boolean"),
  "clean certificate": custom("cleaning_certificate_received", "boolean"),
  "next due": custom("next_qual_due", "date"),
  "next qual due": custom("next_qual_due", "date"),
  "due for": custom("due_for", "text"),
  "arrived dispo location": custom("arrived_dispo_location", "date"),
  "scrap location": custom("scrap_location", "text"),
  "scrap arrival date": custom("scrap_arrival_date", "date"),
  "settlement amount": custom("settlement_amount", "currency"),
  "eol date": custom("eol_date", "date"),
  "end of life": custom("eol_date", "date"),
  "b/o estimate cost": custom("b_o_estimate_cost", "currency"),
  "b/o estimate approved": custom("b_o_estimate_approved", "boolean"),
  "cost of cleaning": custom("cost_of_cleaning", "currency"),
  "cost of exterior paint": custom("cost_of_exterior_paint", "currency"),
  "cost of interior paint": custom("cost_of_interior_paint", "currency"),
  "gate 1 clearance": custom("gate_1_clearance", "text"),
  "gate 2 clearance": custom("gate_2_clearance", "text"),
  "gate 3 clearance": custom("gate_3_clearance", "text"),
  "nld arrival dates": custom("nld_arrival_date", "date"),
  "nld arrival date": custom("nld_arrival_date", "date"),
  "pod date": custom("pod_date", "date"),
  "completion date": custom("completion_date", "date"),
  "billing end date": custom("billing_end_date", "date"),
  "approval request": custom("approval_request", "date"),
  notes: column("notes", "text"),
  note: column("notes", "text"),
  "l or e": layoutOnly("trace_loaded_or_empty", "text"),
  "event text": layoutOnly("trace_event_text", "text"),
  "train id": layoutOnly("trace_train_id", "text"),
  "destination city": layoutOnly("trace_destination_city", "text"),
  "destination state": layoutOnly("trace_destination_state", "text"),
  "reporting rr": layoutOnly("trace_reporting_rr", "text"),
};

export function headerTarget(header: unknown, prev: FieldTarget | null): FieldTarget {
  const norm = normalizeHeader(header);
  if (!norm || norm === "#" || norm === "built date" || norm === "off rent date") return { kind: "skip" };
  if (norm === "number" || norm === "year" || norm === "month" || norm === "day" || norm === "sighting hour and minute") {
    return { kind: "skip" };
  }
  if (norm === "railcar number" || norm === "car number") {
    if (prev?.kind === "identity" && prev.role === "new_mark") return { kind: "identity", role: "new_number" };
    return { kind: "identity", role: "old_number" };
  }
  return HEADER_TARGETS[norm] ?? { kind: "skip" };
}

export type ParsedHeader = { index: number; header: string; target: FieldTarget };

export function parseHeaders(headers: unknown[]): ParsedHeader[] {
  const out: ParsedHeader[] = [];
  let prev: FieldTarget | null = null;
  headers.forEach((header, index) => {
    const target = headerTarget(header, prev);
    if (String(header ?? "").trim()) {
      out.push({ index, header: String(header).replace(/\s+/g, " ").trim(), target });
      if (target.kind !== "skip") prev = target;
    }
  });
  return out;
}

function gridKey(target: FieldTarget): string | null {
  if (target.kind === "identity") {
    if (target.role === "old_mark" || target.role === "old_number") return "car";
    if (target.role === "new_mark") return "cf:new_reporting_mark";
    return "cf:new_car_number";
  }
  if (target.kind === "column") {
    if (target.key === "shop_id") return "shop";
    return target.key;
  }
  if (target.kind === "custom") return `cf:${target.key}`;
  return null;
}

/** Sheet order, with trace detail columns kept directly after Trace date. */
export function columnOrderFromHeaders(headers: unknown[]): string[] {
  const parsed = parseHeaders(headers);
  const order: string[] = [];
  const seen = new Set<string>();
  for (const col of parsed) {
    const key = gridKey(col.target);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    order.push(key);
  }
  return placeTraceDetails(order);
}

export function placeTraceDetails(order: string[]): string[] {
  const details = TRACE_DETAIL_KEYS.map((k) => `cf:${k}`);
  const rest = order.filter((k) => !details.includes(k));
  const present = details.filter((k) => order.includes(k));
  if (!present.length) return rest;
  const traceAt = rest.indexOf("cf:trace_date");
  if (traceAt < 0) return [...rest, ...present];
  let insertAt = traceAt + 1;
  while (insertAt < rest.length && (rest[insertAt] === "cf:trace_city" || rest[insertAt] === "cf:trace_state")) {
    insertAt += 1;
  }
  return [...rest.slice(0, insertAt), ...present, ...rest.slice(insertAt)];
}

export function trackerOrderForProgram(programName: string): string[] | null {
  const want = programName.trim().toLowerCase();
  const tab = TRACKER_TAB_COLUMNS.find(
    (t) => t.program.trim().toLowerCase() === want || t.sheet.trim().toLowerCase() === want,
  );
  if (!tab) return null;
  return columnOrderFromHeaders(tab.headers);
}

export function columnPrefsPayload(order: string[]): {
  cols: string[];
  order: string[];
  sort: null;
  widths: Record<string, number>;
} {
  return { cols: [...order], order: [...order], sort: null, widths: {} };
}

export type LayoutSource = "user" | "program" | "category" | "global" | "builtin";

export type LayoutPrefs = { cols: string[]; order?: string[]; sort?: { key: string; dir: "asc" | "desc" } | null; widths?: Record<string, number> } | null;

export function resolveColumnLayout(input: {
  user: LayoutPrefs;
  programShared: LayoutPrefs;
  categoryShared: LayoutPrefs;
  globalShared: LayoutPrefs;
  builtin: string[];
}): { source: LayoutSource; cols: string[]; order: string[] } {
  const pick = (prefs: LayoutPrefs, source: LayoutSource) => {
    if (!prefs || !Array.isArray(prefs.cols) || prefs.cols.length === 0) return null;
    const order = prefs.order && prefs.order.length ? prefs.order : prefs.cols;
    return { source, cols: prefs.cols, order };
  };
  return (
    pick(input.user, "user") ??
    pick(input.programShared, "program") ??
    pick(input.categoryShared, "category") ??
    pick(input.globalShared, "global") ?? {
      source: "builtin",
      cols: [...input.builtin],
      order: [...input.builtin],
    }
  );
}

export function parseDate(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, "0");
    const d = String(raw.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 20000 && raw < 80000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(epoch.getTime() + Math.round(raw) * 86400000);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dt.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(raw).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdY = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdY) {
    const month = Number(mdY[1]);
    const day = Number(mdY[2]);
    let year = Number(mdY[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

export function parseCurrency(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw * 100) / 100;
  const s = String(raw ?? "").replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

export function parseBoolean(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  const s = String(raw ?? "").trim().toLowerCase();
  if (["y", "yes", "true", "t", "1"].includes(s)) return true;
  if (["n", "no", "false", "f", "0"].includes(s)) return false;
  return null;
}

export function typeValue(raw: unknown, type: FieldType): unknown {
  if (isBlankValue(raw) || isNaValue(raw)) return null;
  if (type === "date") return parseDate(raw);
  if (type === "currency" || type === "number") return parseCurrency(raw);
  if (type === "boolean") return parseBoolean(raw);
  return String(raw).replace(/\s+/g, " ").trim();
}

export function canonical(raw: unknown, type: FieldType): unknown {
  if (isBlankValue(raw)) return null;
  if (isNaValue(raw)) return "N/A";
  return typeValue(raw, type);
}

export function valuesEqual(current: unknown, proposed: unknown, type: FieldType): boolean {
  const a = canonical(current, type);
  const b = canonical(proposed, type);
  if (a == null && b == null) return true;
  if (type === "currency" || type === "number") {
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.001;
  }
  if (type === "date" && typeof a === "string" && typeof b === "string") return a.slice(0, 10) === b.slice(0, 10);
  if (type === "boolean") return a === b;
  return String(a ?? "") === String(b ?? "");
}

export type ClassifiedCell = {
  field: string;
  action: SyncAction;
  current: unknown;
  proposed: unknown;
  note: string;
  column: "custom_fields" | "status" | "notes" | "shop_id";
};

export function classifyCell(input: {
  field: string;
  column: ClassifiedCell["column"];
  type: FieldType;
  current: unknown;
  raw: unknown;
  inactive: boolean;
  shop?: { status: "blank" | "match" | "missing" | "ambiguous"; id: number | null; name?: string };
}): ClassifiedCell {
  const base = {
    field: input.field,
    current: input.current ?? null,
    column: input.column,
  };
  if (input.inactive) {
    return { ...base, action: "skip", proposed: null, note: "inactive car - no change" };
  }
  if (input.column === "shop_id") {
    if (isNaValue(input.raw)) {
      if (isBlankValue(input.current)) return { ...base, action: "skip", proposed: null, note: "" };
      return { ...base, action: "clear", proposed: null, note: "N/A blanks the shop" };
    }
    if (isBlankValue(input.raw)) return { ...base, action: "skip", proposed: null, note: "" };
    if (!input.shop || input.shop.status === "missing") {
      const approved = NEW_SHOPS.find((name) => normalizeShopName(name) === normalizeShopName(input.shop?.name || input.raw));
      if (approved) {
        const note = `new shop: ${approved}`;
        if (input.current == null || input.current === "") {
          return { ...base, action: "fill blank", proposed: null, note };
        }
        return { ...base, action: "change", proposed: null, note };
      }
      return { ...base, action: "review", proposed: null, note: "shop name not in shops table" };
    }
    if (input.shop.status === "ambiguous") {
      return { ...base, action: "review", proposed: null, note: "shop name matches more than one shop" };
    }
    const proposed = input.shop.id;
    if (input.current == null || input.current === "") {
      return { ...base, action: "fill blank", proposed, note: input.shop.name ? `shop ${input.shop.name}` : "" };
    }
    if (String(input.current) === String(proposed)) return { ...base, action: "skip", proposed, note: "" };
    return { ...base, action: "change", proposed, note: input.shop.name ? `shop ${input.shop.name}` : "" };
  }
  if (isNaValue(input.raw)) {
    if (isBlankValue(input.current)) return { ...base, action: "skip", proposed: null, note: "" };
    return { ...base, action: "clear", proposed: null, note: "N/A blanks the field" };
  }
  if (isBlankValue(input.raw)) return { ...base, action: "skip", proposed: null, note: "" };
  const proposed = typeValue(input.raw, input.type);
  if (proposed == null) {
    return { ...base, action: "review", proposed: null, note: "value did not match the field type" };
  }
  if (isBlankValue(input.current) || isNaValue(input.current)) {
    return { ...base, action: "fill blank", proposed, note: "" };
  }
  if (valuesEqual(input.current, proposed, input.type)) return { ...base, action: "skip", proposed, note: "" };
  return { ...base, action: "change", proposed, note: "" };
}

/** A date in BRC Complete sets the flag and the date. Y/N sets only the flag. N/A clears both. */
export function brcCells(input: {
  raw: unknown;
  currentFlag: unknown;
  currentDate: unknown;
  inactive: boolean;
}): ClassifiedCell[] {
  const flag = classifyCell({
    field: "brc_complete",
    column: "custom_fields",
    type: "boolean",
    current: input.currentFlag,
    raw: input.raw,
    inactive: input.inactive,
  });
  const dateParsed = !isBlankValue(input.raw) && !isNaValue(input.raw) ? parseDate(input.raw) : null;
  if (input.inactive) return [flag];
  if (dateParsed) {
    const flagCell = classifyCell({
      field: "brc_complete",
      column: "custom_fields",
      type: "boolean",
      current: input.currentFlag,
      raw: "Y",
      inactive: false,
    });
    const dateCell = classifyCell({
      field: "brc_complete_date",
      column: "custom_fields",
      type: "date",
      current: input.currentDate,
      raw: dateParsed,
      inactive: false,
    });
    return [flagCell, dateCell];
  }
  if (isNaValue(input.raw)) {
    const dateCell = classifyCell({
      field: "brc_complete_date",
      column: "custom_fields",
      type: "date",
      current: input.currentDate,
      raw: "N/A",
      inactive: false,
    });
    return [flag, dateCell].filter((c) => c.action !== "skip");
  }
  return [flag].filter((c) => c.action !== "skip");
}

export type RlmsCar = {
  program_car_id: number;
  program_id: number;
  program_name: string;
  railcar_id: number;
  active: boolean;
  exited: boolean;
  reporting_marks: string;
  car_number: string;
  status: string | null;
  notes: string | null;
  shop_id: number | null;
  shop_name: string | null;
  custom_fields: Record<string, unknown>;
};

export function carMatchKeys(car: Pick<RlmsCar, "reporting_marks" | "car_number" | "custom_fields">): Set<string> {
  const keys = new Set<string>();
  for (const k of identityKeys(car.reporting_marks, car.car_number)) keys.add(k);
  const cf = car.custom_fields ?? {};
  for (const k of identityKeys(cf.old_reporting_mark, cf.old_car_number)) keys.add(k);
  for (const k of identityKeys(cf.new_reporting_mark, cf.new_car_number)) keys.add(k);
  for (const k of identityKeys(cf.new_reporting_mark, car.car_number)) keys.add(k);
  return keys;
}

export function matchProgramName(sheetOrSummary: string, programs: { id: number; name: string }[]): { id: number; name: string } | null {
  const alias = TAB_PROGRAM_ALIASES[sheetOrSummary.trim()] ?? sheetOrSummary.trim();
  const want = alias.toLowerCase();
  return programs.find((p) => p.name.trim().toLowerCase() === want) ?? null;
}

export type SummaryProgram = { sheet: string; account_manager: string; active_scope: boolean };

export function summaryPrograms(rows: unknown[][]): SummaryProgram[] {
  const out: SummaryProgram[] = [];
  for (const row of rows) {
    const am = String(row[1] ?? "").trim();
    const sheet = String(row[4] ?? "").trim();
    if (!am || !sheet) continue;
    if (normalizeHeader(am) === "account manager") continue;
    const excluded = normalizeHeader(am) === "adm" || REFERENCE_TABS.has(normalizeHeader(sheet));
    out.push({ sheet, account_manager: am, active_scope: !excluded });
  }
  return out;
}

export function isHeaderRow(row: unknown[]): boolean {
  return row.some((c) => {
    const n = normalizeHeader(c);
    return n === "reporting mark" || n === "car mark" || n === "current rm" || n === "mark" || n === "initial";
  });
}

export type SheetCar = {
  sheet: string;
  mark: string;
  number: string;
  newMark: string;
  newNumber: string;
  cells: { header: string; target: FieldTarget; raw: unknown }[];
};

export function parseSheetCars(sheet: string, rows: unknown[][]): { headers: ParsedHeader[]; cars: SheetCar[]; unmapped: string[] } {
  let headerRow = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (isHeaderRow(rows[i] ?? [])) {
      headerRow = i;
      break;
    }
  }
  if (headerRow < 0) return { headers: [], cars: [], unmapped: [] };
  const headers = parseHeaders(rows[headerRow] ?? []);
  const unmapped = headers.filter((h) => h.target.kind === "skip" && !["#", "number", "year", "month", "day", "sighting hour and minute", "built date", "off rent date"].includes(normalizeHeader(h.header)) && normalizeHeader(h.header) !== "#").map((h) => h.header);
  const cars: SheetCar[] = [];
  for (let i = headerRow + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    if (isHeaderRow(row)) continue;
    let mark = "";
    let number = "";
    let newMark = "";
    let newNumber = "";
    const cells: SheetCar["cells"] = [];
    for (const h of headers) {
      const raw = row[h.index];
      if (h.target.kind === "identity") {
        if (h.target.role === "old_mark") mark = String(raw ?? "").trim();
        else if (h.target.role === "old_number") number = String(raw ?? "").trim();
        else if (h.target.role === "new_mark") newMark = String(raw ?? "").trim();
        else newNumber = String(raw ?? "").trim();
        continue;
      }
      if (h.target.kind === "skip") continue;
      if (h.target.kind === "custom" && !h.target.write) continue;
      cells.push({ header: h.header, target: h.target, raw });
    }
    if (!number && !newNumber) continue;
    cars.push({ sheet, mark, number, newMark, newNumber, cells });
  }
  return { headers, cars, unmapped: [...new Set(unmapped)] };
}

export function findRlmsCars(sheetCar: SheetCar, candidates: RlmsCar[]): RlmsCar[] {
  const want = new Set<string>([
    ...identityKeys(sheetCar.mark, sheetCar.number),
    ...identityKeys(sheetCar.newMark, sheetCar.newNumber || sheetCar.number),
    ...identityKeys(sheetCar.mark, sheetCar.newNumber),
  ]);
  if (!want.size) return [];
  return candidates.filter((c) => {
    const keys = carMatchKeys(c);
    for (const k of want) if (keys.has(k)) return true;
    return false;
  });
}

export function findRlmsCar(sheetCar: SheetCar, candidates: RlmsCar[]): RlmsCar | null {
  const hits = findRlmsCars(sheetCar, candidates);
  if (hits.length === 1) return hits[0];
  const open = hits.filter((h) => !h.exited);
  if (open.length === 1) return open[0];
  return null;
}

export type PlannedChange = ClassifiedCell & {
  program: string;
  program_id: number;
  program_car_id: number;
  railcar_id: number;
  car: string;
  active: boolean;
};

export function planCarChanges(sheetCar: SheetCar, rlms: RlmsCar, shops: ShopRecord[]): PlannedChange[] {
  const inactive = rlms.active !== true || rlms.exited;
  const out: PlannedChange[] = [];
  const push = (cell: ClassifiedCell) => {
    out.push({
      ...cell,
      program: rlms.program_name,
      program_id: rlms.program_id,
      program_car_id: rlms.program_car_id,
      railcar_id: rlms.railcar_id,
      car: `${rlms.reporting_marks} ${rlms.car_number}`.trim(),
      active: !inactive,
    });
  };
  for (const cell of sheetCar.cells) {
    const target = cell.target;
    if (target.kind === "custom" && target.key === "brc_complete") {
      const parts = brcCells({
        raw: cell.raw,
        currentFlag: rlms.custom_fields?.brc_complete,
        currentDate: rlms.custom_fields?.brc_complete_date,
        inactive,
      });
      for (const part of parts) push(part);
      continue;
    }
    if (target.kind === "column" && target.key === "shop_id") {
      const shop = matchShop(cell.raw, shops);
      const name = isBlankValue(cell.raw) ? "" : String(cell.raw).replace(/\s+/g, " ").trim();
      push(classifyCell({
        field: "shop_id",
        column: "shop_id",
        type: "text",
        current: rlms.shop_id,
        raw: cell.raw,
        inactive,
        shop: { ...shop, name },
      }));
      continue;
    }
    if (target.kind === "column" && (target.key === "status" || target.key === "notes")) {
      push(classifyCell({
        field: target.key,
        column: target.key,
        type: "text",
        current: target.key === "status" ? rlms.status : rlms.notes,
        raw: cell.raw,
        inactive,
      }));
      continue;
    }
    if (target.kind === "custom" && target.write) {
      push(classifyCell({
        field: target.key,
        column: "custom_fields",
        type: target.type,
        current: rlms.custom_fields?.[target.key],
        raw: cell.raw,
        inactive,
      }));
    }
  }
  return out.filter((c) => c.action !== "skip");
}

export type EvidenceRow = {
  program: string;
  program_car_id: number;
  car: string;
  field: string;
  current: unknown;
  proposed: unknown;
  action: string;
  note?: string;
};

/** Reclassify the evidence diff with Bruce's rules: every N/A blanks, and the two new shops match. */
export function reclassifyEvidenceRow(row: EvidenceRow, shops: ShopRecord[]): PlannedChange | null {
  const action = String(row.action ?? "");
  const inactive = action.includes("inactive");
  const program_car_id = Number(row.program_car_id);
  const base = {
    program: row.program,
    program_id: 0,
    program_car_id,
    railcar_id: 0,
    car: row.car,
    active: !inactive,
    current: row.current ?? null,
  };
  if (inactive) return null;
  const clearMarker = String(row.proposed ?? "").trim().toLowerCase() === "(clear)";
  const shopField = row.field === "shop_id" || row.field === "shop_location" || action.includes("shop");
  if (clearMarker || action.includes("N/A") || (isNaValue(row.current) && isBlankValue(row.proposed)) || isNaValue(row.proposed)) {
    if (!clearMarker && !action.includes("N/A") && isBlankValue(row.current) && isBlankValue(row.proposed)) return null;
    return {
      ...base,
      field: row.field === "shop_location" ? "shop_id" : row.field,
      column: row.field === "shop_id" || row.field === "shop_location" ? "shop_id" : row.field === "status" ? "status" : row.field === "notes" ? "notes" : "custom_fields",
      action: "clear",
      proposed: null,
      note: "N/A blanks the field",
    };
  }
  if (shopField) {
    const shop = matchShop(row.proposed, shops);
    const cell = classifyCell({
      field: "shop_id",
      column: "shop_id",
      type: "text",
      current: row.current,
      raw: row.proposed,
      inactive: false,
      shop: { ...shop, name: String(row.proposed ?? "") },
    });
    if (cell.action === "skip") return null;
    return { ...base, ...cell };
  }
  const field = row.field === "shop_location" ? "shop_id" : row.field;
  const column: PlannedChange["column"] = field === "shop_id" ? "shop_id" : field === "status" ? "status" : field === "notes" ? "notes" : "custom_fields";
  let sync: SyncAction;
  if (action.includes("fill")) sync = "fill blank";
  else if (action.includes("clear")) sync = "clear";
  else if (action.includes("review")) sync = "review";
  else if (action.includes("update") || action.includes("change")) sync = "change";
  else return null;
  return { ...base, field, column, action: sync, proposed: row.proposed ?? null, note: row.note ?? "" };
}

export function writesOnly(rows: PlannedChange[]): PlannedChange[] {
  return rows.filter((r) => r.active && (r.action === "fill blank" || r.action === "change" || r.action === "clear"));
}

export function groupByProgram(rows: PlannedChange[]): Record<string, Record<SyncAction, number>> {
  const out: Record<string, Record<SyncAction, number>> = {};
  for (const row of rows) {
    const bucket = out[row.program] ?? { "fill blank": 0, change: 0, clear: 0, review: 0, skip: 0 };
    bucket[row.action] += 1;
    out[row.program] = bucket;
  }
  return out;
}

export type CarExpect = {
  active: boolean;
  status: string | null;
  shop_id: number | null;
  custom_fields: Record<string, unknown>;
};

export type ApplyCar = {
  program_car_id: number;
  program_id: number;
  railcar_id: number;
  expect: CarExpect;
  set_status: boolean;
  status: string | null;
  set_shop: boolean;
  shop_id: number | null;
  shop_name: string | null;
  custom_patch: Record<string, unknown>;
  fields: Record<string, { old: unknown; new: unknown }>;
};

export function buildApplyCar(rlms: RlmsCar, changes: PlannedChange[]): ApplyCar | null {
  const mine = changes.filter((c) => c.program_car_id === rlms.program_car_id && c.active && c.action !== "review" && c.action !== "skip");
  if (!mine.length) return null;
  if (rlms.active !== true || rlms.exited) return null;
  const custom_patch: Record<string, unknown> = {};
  const fields: ApplyCar["fields"] = {};
  let set_status = false;
  let status: string | null = rlms.status;
  let set_shop = false;
  let shop_id: number | null = rlms.shop_id;
  let shop_name: string | null = null;
  for (const change of mine) {
    fields[change.field] = { old: change.current ?? null, new: change.action === "clear" ? null : change.proposed ?? null };
    if (change.column === "custom_fields") {
      custom_patch[change.field] = change.action === "clear" ? null : change.proposed;
    } else if (change.column === "status") {
      set_status = true;
      status = change.action === "clear" ? null : change.proposed == null ? null : String(change.proposed);
    } else if (change.column === "shop_id") {
      set_shop = true;
      if (change.note?.startsWith("new shop:")) {
        shop_id = null;
        shop_name = change.note.slice("new shop:".length).trim();
      } else {
        shop_id = change.action === "clear" || change.proposed == null ? null : Number(change.proposed);
        shop_name = change.note?.startsWith("shop ") ? change.note.slice(5) : null;
      }
    }
  }
  return {
    program_car_id: rlms.program_car_id,
    program_id: rlms.program_id,
    railcar_id: rlms.railcar_id,
    expect: {
      active: true,
      status: rlms.status ?? null,
      shop_id: rlms.shop_id ?? null,
      custom_fields: { ...(rlms.custom_fields ?? {}) },
    },
    set_status,
    status,
    set_shop,
    shop_id,
    shop_name,
    custom_patch,
    fields,
  };
}

export function applyCustomPatch(current: Record<string, unknown> | null | undefined, patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value == null) delete next[key];
    else next[key] = value;
  }
  return next;
}

export function snapshotMatches(current: CarExpect, expect: CarExpect): boolean {
  if (current.active !== true || expect.active !== true) return false;
  if ((current.status ?? null) !== (expect.status ?? null)) return false;
  if ((current.shop_id ?? null) !== (expect.shop_id ?? null)) return false;
  return JSON.stringify(normalizeJson(current.custom_fields)) === JSON.stringify(normalizeJson(expect.custom_fields));
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = normalizeJson(src[key]);
    return out;
  }
  return value ?? null;
}

/** Per-car undo restores field-level old values. Group undo restores every car in the apply. */
export function undoCarFields(fields: Record<string, { old: unknown; new: unknown }>): {
  custom_patch: Record<string, unknown>;
  status: { set: boolean; value: string | null };
  shop_id: { set: boolean; value: number | null };
} {
  const custom_patch: Record<string, unknown> = {};
  let status = { set: false, value: null as string | null };
  let shop_id = { set: false, value: null as number | null };
  for (const [key, pair] of Object.entries(fields)) {
    if (key === "status") {
      status = { set: true, value: pair.old == null || pair.old === "" ? null : String(pair.old) };
    } else if (key === "shop_id") {
      shop_id = { set: true, value: pair.old == null || pair.old === "" ? null : Number(pair.old) };
    } else {
      custom_patch[key] = pair.old ?? null;
    }
  }
  return { custom_patch, status, shop_id };
}

export function carChangedSince(current: Record<string, unknown>, fields: Record<string, { old: unknown; new: unknown }>, custom: Record<string, unknown>, status: unknown, shopId: unknown): boolean {
  for (const [key, pair] of Object.entries(fields)) {
    const live = key === "status" ? status : key === "shop_id" ? shopId : custom[key];
    const expected = pair.new ?? null;
    if (expected == null) {
      if (live != null && live !== "") return true;
      continue;
    }
    if (String(live ?? "") !== String(expected)) return true;
  }
  return false;
}

export const APPLY_TABLES = ["program_cars", "shops", "user_column_prefs", "programs"] as const;

export function planTouchesRentEvents(tables: string[]): boolean {
  return tables.some((t) => t === "rent_events");
}
