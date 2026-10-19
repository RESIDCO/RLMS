/**
 * Saved search views. Pure validation and undo payload shapes.
 * The database migration is preview-only; callers must tolerate missing columns.
 */

import { changedKeys } from "./change-log";

export const SAVED_VIEWS_SCHEMA_MESSAGE = "Saved views need a database update";
export const INACTIVE_NOTE_MESSAGE = "inactive – left alone";
export const VIEW_MEMBER_CAP = 2000;
export const VIEW_PIN_CAP = 12;

export const FOCUS_COLUMN_KEYS = [
  "open_stop_type",
  "open_stop_since",
  "open_stop_days",
  "open_stop_expected",
  "open_stop_reason",
  "program_name",
  "program_status",
  "program_milestone",
  "program_note",
  "scrapped_at",
  "umler_status",
  "latest_note",
  "tags",
  "view_note",
] as const;

export type FocusColumnKey = (typeof FOCUS_COLUMN_KEYS)[number];

/** Columns a saved view may store. Core grid columns plus Search optional columns plus focus columns. */
export const SEARCH_LAYOUT_KEYS = [
  "marks",
  "car_number",
  "lease_type",
  "entity",
  "type",
  "status",
  "lessee",
  "rider",
  "lease",
  "expires",
  "nbv",
  "oac",
  "oec",
  "capacity_cf",
  "lining",
  "build_year",
  "description",
  "mech_designation",
  "equipment_type_code",
  "monthly_rent_per_car",
  "monthly_depr_per_car",
  "commodity",
  "commodity_family",
  "dot_code",
  "lease_expiry",
  "lease_start_date",
  "lease_end_date",
  "data_source",
  "active",
  "comment_event_note",
  "rider_external_id",
  "account_manager_initials",
  "am_note",
  ...FOCUS_COLUMN_KEYS,
] as const;

const LAYOUT_KEY_SET = new Set<string>(SEARCH_LAYOUT_KEYS);

export const FOCUS_COLUMN_LABELS: Record<FocusColumnKey, string> = {
  open_stop_type: "Rent stop",
  open_stop_since: "Stop since",
  open_stop_days: "Days stopped",
  open_stop_expected: "Expected resume",
  open_stop_reason: "Stop reason",
  program_name: "Program",
  program_status: "Program status",
  program_milestone: "Milestone",
  program_note: "Program note",
  scrapped_at: "Scrapped",
  umler_status: "UMLER status",
  latest_note: "Latest note",
  tags: "Tags",
  view_note: "View note",
};

export type ViewKind = "fixed" | "query";
export type ViewDensity = "comfortable" | "compact";
export type ViewActive = "active" | "inactive" | "all";
export type OpenStopFilter = "" | "any" | "Abatement" | "Off rent" | "none";

export type ViewFilters = {
  type: string;
  mech: string;
  aar: string;
  entity: string;
  status: string;
  active: ViewActive;
  open_stop: OpenStopFilter;
  program: string;
  tag: string;
};

export type ViewLayout = {
  v: 1;
  cols: string[];
  order: string[];
  widths: Record<string, number>;
  sort: { key: string; dir: "asc" | "desc" } | null;
  filters: ViewFilters;
  pageSize: 75 | 200 | 500;
  showInactive: boolean;
  panelCollapsed: boolean;
  density: ViewDensity;
};

export type ViewQuery = {
  v: 1;
  q: string;
  scope: { cars: boolean; leases: boolean; carData: boolean };
  fleet: boolean;
  filters: ViewFilters;
  source?: "paste";
  unmatched?: string[];
  ambiguous?: { token: string; matches: { id: number; label: string }[] }[];
};

export type OpenStopRow = {
  type?: string | null;
  stop_date?: string | null;
  expected_resume_date?: string | null;
  actual_resume_date?: string | null;
  reason?: string | null;
  reason_other?: string | null;
  note?: string | null;
};

export type ProgramJoinRow = {
  name?: string | null;
  status?: string | null;
  milestone?: string | null;
  milestone_at?: string | null;
  notes?: string | null;
  added_at?: string | null;
  exited_date?: string | null;
};

const OPEN_STOPS = new Set(["", "any", "Abatement", "Off rent", "none"]);

export function emptyViewFilters(active: ViewActive = "active"): ViewFilters {
  return {
    type: "",
    mech: "",
    aar: "",
    entity: "",
    status: "",
    active,
    open_stop: "",
    program: "",
    tag: "",
  };
}

export function canonicalViewName(name: string): string {
  return String(name ?? "").trim().replace(/\s+/g, " ");
}

export function viewNameKey(name: string): string {
  return canonicalViewName(name).toLowerCase();
}

/** Case-insensitive, and internal whitespace is collapsed before compare. */
export function viewNamesCollide(a: string, b: string): boolean {
  const left = viewNameKey(a);
  return left.length > 0 && left === viewNameKey(b);
}

export function isFocusColumn(key: string): key is FocusColumnKey {
  return (FOCUS_COLUMN_KEYS as readonly string[]).includes(key);
}

export function layoutNeedsFocus(keys: Iterable<string>): boolean {
  for (const key of keys) {
    if (isFocusColumn(key) || key === "am_note") return true;
  }
  return false;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseFilters(raw: unknown): ViewFilters | string {
  const base = emptyViewFilters();
  if (raw == null) return base;
  if (typeof raw !== "object" || Array.isArray(raw)) return "filters must be an object";
  const o = raw as Record<string, unknown>;
  const allowed = new Set(Object.keys(base));
  for (const key of Object.keys(o)) {
    if (!allowed.has(key)) return `unknown filter ${key}`;
  }
  base.type = asString(o.type);
  base.mech = asString(o.mech);
  base.aar = asString(o.aar);
  base.entity = asString(o.entity);
  base.status = asString(o.status);
  base.program = asString(o.program);
  base.tag = asString(o.tag);
  const active = asString(o.active);
  if (active === "inactive" || active === "all" || active === "active" || active === "") {
    base.active = active === "" ? "active" : active;
  } else return "active filter must be active, inactive, or all";
  const stop = o.open_stop == null ? "" : String(o.open_stop);
  if (!OPEN_STOPS.has(stop)) return "open_stop must be any, Abatement, Off rent, or none";
  base.open_stop = stop as OpenStopFilter;
  return base;
}

function takeColumns(raw: unknown, label: string): string[] | string {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return `${label} must be a list`;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) return `${label} entries must be column keys`;
    const key = item.trim();
    if (!LAYOUT_KEY_SET.has(key)) return `unknown column ${key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function parseViewLayout(raw: unknown): { ok: true; layout: ViewLayout } | { ok: false; message: string } {
  const source = raw == null ? {} : raw;
  if (typeof source !== "object" || Array.isArray(source)) return { ok: false, message: "layout must be an object" };
  const o = source as Record<string, unknown>;
  if (o.v != null && o.v !== 1) return { ok: false, message: "layout version is not supported" };
  const cols = takeColumns(o.cols, "cols");
  if (typeof cols === "string") return { ok: false, message: cols };
  const order = takeColumns(o.order ?? cols, "order");
  if (typeof order === "string") return { ok: false, message: order };
  const widths: Record<string, number> = {};
  if (o.widths != null) {
    if (typeof o.widths !== "object" || Array.isArray(o.widths)) return { ok: false, message: "widths must be an object" };
    for (const [key, value] of Object.entries(o.widths as Record<string, unknown>)) {
      if (!LAYOUT_KEY_SET.has(key)) return { ok: false, message: `unknown column ${key}` };
      if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, message: `width for ${key} must be a number` };
      widths[key] = Math.max(40, Math.min(800, Math.round(value)));
    }
  }
  let sort: ViewLayout["sort"] = null;
  if (o.sort != null) {
    if (typeof o.sort !== "object" || Array.isArray(o.sort)) return { ok: false, message: "sort must be an object" };
    const key = asString((o.sort as Record<string, unknown>).key);
    if (!key || !LAYOUT_KEY_SET.has(key)) return { ok: false, message: `unknown column ${key || "sort"}` };
    const dir = (o.sort as Record<string, unknown>).dir === "desc" ? "desc" : "asc";
    sort = { key, dir };
  }
  const filters = parseFilters(o.filters);
  if (typeof filters === "string") return { ok: false, message: filters };
  const pageRaw = o.pageSize == null ? 75 : Number(o.pageSize);
  if (pageRaw !== 75 && pageRaw !== 200 && pageRaw !== 500) return { ok: false, message: "pageSize must be 75, 200, or 500" };
  const density = o.density == null || o.density === "comfortable" ? "comfortable" : o.density === "compact" ? "compact" : null;
  if (!density) return { ok: false, message: "density must be comfortable or compact" };
  return {
    ok: true,
    layout: {
      v: 1,
      cols,
      order: order.length ? order : cols,
      widths,
      sort,
      filters,
      pageSize: pageRaw,
      showInactive: o.showInactive === true,
      panelCollapsed: o.panelCollapsed !== false,
      density,
    },
  };
}

export function parseViewQuery(raw: unknown, kind: ViewKind): { ok: true; query: ViewQuery } | { ok: false; message: string } {
  const source = raw == null ? {} : raw;
  if (typeof source !== "object" || Array.isArray(source)) return { ok: false, message: "query must be an object" };
  const o = source as Record<string, unknown>;
  if (o.v != null && o.v !== 1) return { ok: false, message: "query version is not supported" };
  const filters = parseFilters(o.filters);
  if (typeof filters === "string") return { ok: false, message: filters };
  const scopeRaw = o.scope;
  const scope = { cars: true, leases: true, carData: false };
  if (scopeRaw != null) {
    if (typeof scopeRaw !== "object" || Array.isArray(scopeRaw)) return { ok: false, message: "scope must be an object" };
    const s = scopeRaw as Record<string, unknown>;
    if ("cars" in s) scope.cars = s.cars !== false;
    if ("leases" in s) scope.leases = s.leases !== false;
    if ("carData" in s) scope.carData = s.carData === true;
  }
  const unmatched = Array.isArray(o.unmatched) ? o.unmatched.map((t) => String(t)).filter(Boolean).slice(0, 500) : [];
  const ambiguous: ViewQuery["ambiguous"] = [];
  if (Array.isArray(o.ambiguous)) {
    for (const item of o.ambiguous.slice(0, 200)) {
      if (!item || typeof item !== "object") continue;
      const token = asString((item as Record<string, unknown>).token);
      const matches = Array.isArray((item as Record<string, unknown>).matches)
        ? ((item as Record<string, unknown>).matches as unknown[])
            .map((m) => {
              const row = m as Record<string, unknown>;
              return { id: Number(row?.id), label: asString(row?.label) };
            })
            .filter((m) => Number.isFinite(m.id) && m.id > 0)
        : [];
      if (token) ambiguous.push({ token, matches });
    }
  }
  const query: ViewQuery = {
    v: 1,
    q: asString(o.q),
    scope,
    fleet: o.fleet !== false,
    filters,
    unmatched,
    ambiguous,
  };
  if (kind === "fixed") {
    query.source = "paste";
    return { ok: true, query };
  }
  if (o.source != null && o.source !== "paste") return { ok: false, message: "query source is not supported" };
  const hasFilter = Boolean(
    query.q || query.filters.type || query.filters.mech || query.filters.aar || query.filters.entity ||
    query.filters.status || query.filters.open_stop || query.filters.program || query.filters.tag,
  );
  if (!hasFilter) return { ok: false, message: "a saved search needs a query or a filter" };
  return { ok: true, query };
}

export const FOCUS_PRESET_ID = "focus-rent-stops-scrap";
export const FOCUS_PRESET_LABEL = "Focus: rent stops & scrap";

export function focusPresetLayout(filters?: Partial<ViewFilters>): ViewLayout {
  const parsed = parseViewLayout({
    v: 1,
    cols: [
      "rider_external_id",
      "open_stop_type",
      "open_stop_since",
      "open_stop_days",
      "program_status",
      "program_milestone",
      "latest_note",
      "view_note",
      "tags",
    ],
    order: [
      "marks",
      "car_number",
      "lessee",
      "rider_external_id",
      "open_stop_type",
      "open_stop_since",
      "open_stop_days",
      "program_status",
      "program_milestone",
      "latest_note",
      "view_note",
      "tags",
    ],
    sort: { key: "program_status", dir: "asc" },
    filters: { ...emptyViewFilters(), ...filters },
    pageSize: 75,
    showInactive: false,
    panelCollapsed: true,
    density: "comfortable",
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.layout;
}

export type ViewWrite =
  | "create_shared"
  | "create_private"
  | "update"
  | "pin"
  | "members"
  | "note"
  | "delete";

/** Viewers may save a private copy. Other writes are editor or admin. Delete is the owner or an admin. */
export function viewWriteAllowed(opts: {
  role: string | null | undefined;
  action: ViewWrite;
  actorId?: string | null;
  ownerId?: string | null;
}): boolean {
  const role = String(opts.role ?? "");
  const actor = String(opts.actorId ?? "");
  const owner = String(opts.ownerId ?? "");
  switch (opts.action) {
    case "create_private":
      return role === "admin" || role === "editor" || role === "viewer";
    case "create_shared":
    case "update":
    case "pin":
    case "members":
    case "note":
      return role === "admin" || role === "editor";
    case "delete":
      return role === "admin" || (actor !== "" && actor === owner);
    default: {
      const _never: never = opts.action;
      return _never;
    }
  }
}

export function viewWriteStatus(opts: {
  role: string | null | undefined;
  action: ViewWrite;
  actorId?: string | null;
  ownerId?: string | null;
}): 403 | null {
  return viewWriteAllowed(opts) ? null : 403;
}

/** True when the row changed after the client loaded it. */
export function viewUpdatedAtConflicts(current: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected) return true;
  const left = Date.parse(String(current ?? ""));
  const right = Date.parse(String(expected));
  if (!Number.isFinite(left) || !Number.isFinite(right)) return String(current ?? "") !== String(expected);
  return left !== right;
}

export type PersistableChange = {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  op: "insert" | "update" | "delete";
};

/** Same before/after/op split recordChange writes, so tests can check Undo without the database. */
export function persistableChange(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): PersistableChange {
  const diff = changedKeys(before ?? {}, after ?? {});
  const isInsert = !before || Object.keys(before).length === 0;
  const isDelete = !after || Object.keys(after).length === 0;
  return {
    before: isInsert ? {} : diff.before,
    after: isDelete ? {} : isInsert ? (after ?? {}) : diff.after,
    op: isInsert ? "insert" : isDelete ? "delete" : "update",
  };
}

/**
 * Create is stored as an update whose only diff is deleted_at.
 * Both snapshots carry the new fields so Undo does not null NOT NULL columns;
 * it only sets deleted_at and the view disappears.
 */
export function viewCreateSnapshots(row: Record<string, unknown>, hiddenAt: string): {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
} {
  return {
    before: { ...row, deleted_at: hiddenAt },
    after: { ...row, deleted_at: null },
  };
}

export function viewDeleteSnapshots(hiddenAt: string): { before: Record<string, unknown>; after: Record<string, unknown> } {
  return { before: { deleted_at: null }, after: { deleted_at: hiddenAt } };
}

export function memberRemoveSnapshots(hiddenAt: string): { before: Record<string, unknown>; after: Record<string, unknown> } {
  return { before: { removed_at: null }, after: { removed_at: hiddenAt } };
}

export function memberReaddSnapshots(previousRemovedAt: string): { before: Record<string, unknown>; after: Record<string, unknown> } {
  return { before: { removed_at: previousRemovedAt }, after: { removed_at: null } };
}

export function etDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

export function formatEtTime(iso: string | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${clock} ET`;
}

/** Whole days from stop_date to today in Eastern Time. Closed stops are not passed in. */
export function daysStopped(stopDate: string | null | undefined, now = new Date()): number | null {
  const day = String(stopDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const start = Date.parse(`${day}T00:00:00Z`);
  const today = Date.parse(`${etDate(now)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(today)) return null;
  return Math.round((today - start) / 86_400_000);
}

/** Closed stops (actual resume date set) are never shown. */
export function pickOpenStop<T extends OpenStopRow>(stops: T[]): T | null {
  return stops.find((stop) => stop.actual_resume_date == null || stop.actual_resume_date === "") ?? null;
}

export function openStopReason(stop: OpenStopRow | null): { text: string; note: string } {
  if (!stop) return { text: "", note: "" };
  const text = String(stop.reason_other ?? "").trim() || String(stop.reason ?? "").trim();
  return { text, note: String(stop.note ?? "").trim() };
}

/** Latest open program row. A car can be in more than one; the rest become the +N badge. */
export function pickOpenPrograms<T extends ProgramJoinRow>(rows: T[]): { latest: T | null; extra: number } {
  const open = rows.filter((row) => row.exited_date == null || row.exited_date === "");
  open.sort((a, b) => String(b.added_at ?? "").localeCompare(String(a.added_at ?? "")));
  return { latest: open[0] ?? null, extra: Math.max(0, open.length - 1) };
}

export function memberNoteAllowed(active: boolean | null | undefined): { ok: true } | { ok: false; status: 409; message: string } {
  if (active === false) return { ok: false, status: 409, message: INACTIVE_NOTE_MESSAGE };
  return { ok: true };
}

export function isMissingViewSchema(error: unknown): boolean {
  const row = error as { code?: string; message?: string } | null;
  const code = String(row?.code ?? "");
  const msg = String(row?.message ?? error ?? "");
  if (code === "42703" || code === "PGRST204") return true;
  return /schema cache|could not find the|column .* does not exist/i.test(msg)
    && /kind|deleted_at|layout|pinned|pin_order|updated_at|updated_by|removed_at|added_at|added_by|sort_order|\bnote\b/i.test(msg);
}

export function countCacheKey(id: number, updatedAt: string, showInactive: boolean, active: string): string {
  return `${id}|${updatedAt}|${showInactive ? 1 : 0}|${active}`;
}

export const GRAYMONT_MARKS = "TFOX";
export const GRAYMONT_NUMBERS = [
  "401", "406", "407", "408", "409", "411", "416", "419", "420", "422", "423", "424",
  "426", "427", "428", "429", "430", "431", "432", "433", "434", "435", "438", "439",
  "441", "443", "444", "446", "447", "448", "449",
] as const;

export const GRAYMONT_INACTIVE_NUMBERS = ["406", "416"] as const;
