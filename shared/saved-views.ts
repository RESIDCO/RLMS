/**
 * Saved search views. Pure validation and undo payload shapes.
 * The database migration is preview-only; callers must tolerate missing columns.
 */

import { activityRailcarId, changedKeys } from "./change-log";

export const SAVED_VIEWS_SCHEMA_MESSAGE = "Saved views need a database update";
export const VIEWS_UNAVAILABLE_MESSAGE = "Views unavailable";
export const VIEW_NAME_UNDO_CONFLICT = "A view with that name already exists. Rename it first.";
export const INACTIVE_NOTE_MESSAGE = "inactive – left alone";

/** car_lists columns that reject NULL. An undo before-value for one of these must be the previous value. */
export const CAR_LIST_NOT_NULL = ["name", "shared", "created_at", "kind", "layout", "pinned", "updated_at"] as const;
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
  for (const key of Array.from(keys)) {
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
  return withLeadingIdentityColumnsLayout(parsed.layout);
}

const IDENTITY_COLUMNS = ["marks", "car_number"] as const;

/** Marks and car number stay in front so sticky cells are not laid over later columns. */
export function withLeadingIdentityColumns(order: string[]): string[] {
  const lead = IDENTITY_COLUMNS.filter((key) => order.includes(key));
  const rest = order.filter((key) => key !== "marks" && key !== "car_number");
  return [...lead, ...rest];
}

export function withLeadingIdentityColumnsLayout<T extends { order: string[]; cols: string[] }>(layout: T): T {
  return {
    ...layout,
    order: withLeadingIdentityColumns(layout.order),
    cols: withLeadingIdentityColumns(layout.cols),
  };
}

/**
 * Left offsets for marks and car number when they are the leading columns.
 * The checkbox occupies `checkboxWidth` pixels at the left edge.
 */
export function stickyLeftOffsets(
  keys: string[],
  widthOf: (key: string) => number,
  checkboxWidth = 36,
): Record<string, number> {
  const offsets: Record<string, number> = {};
  let left = checkboxWidth;
  for (const key of keys) {
    if (key !== "marks" && key !== "car_number") break;
    offsets[key] = left;
    left += widthOf(key);
  }
  return offsets;
}

export function searchWantsFocus(value: unknown): boolean {
  return value === 1 || value === "1" || value === true || value === "true" || value === "yes";
}

export function pasteSearchBody(opts: {
  q: string;
  active: string;
  scope: { cars: boolean; leases: boolean; carData: boolean };
  layoutKeys: Iterable<string>;
  viewId?: number | null;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    q: opts.q,
    active: opts.active,
    search_cars: opts.scope.cars ? 1 : 0,
    search_leases: opts.scope.leases ? 1 : 0,
    search_car_data: opts.scope.carData ? 1 : 0,
  };
  if (layoutNeedsFocus(opts.layoutKeys)) body.focus = 1;
  if (opts.viewId != null && opts.viewId > 0) body.view_id = opts.viewId;
  return body;
}

export function openStopFocusFields(stops: OpenStopRow[], now = new Date()): {
  open_stop_type: string | null;
  open_stop_since: string | null;
  open_stop_days: number | null;
  open_stop_expected: string | null;
  open_stop_reason: string | null;
  open_stop_note: string | null;
} {
  const open = pickOpenStop(stops);
  const reason = openStopReason(open);
  return {
    open_stop_type: open ? String(open.type ?? "").trim() || null : null,
    open_stop_since: open?.stop_date ? String(open.stop_date).slice(0, 10) : null,
    open_stop_days: open ? daysStopped(open.stop_date, now) : null,
    open_stop_expected: open?.expected_resume_date ? String(open.expected_resume_date).slice(0, 10) : null,
    open_stop_reason: reason.text || null,
    open_stop_note: reason.note || null,
  };
}

export function viewSavedToast(name: string, shared: boolean, pinned: boolean): string {
  const quoted = `Saved '${name}'`;
  if (shared && pinned) return `${quoted} — shared with RESIDCO, pinned`;
  if (shared) return `${quoted} — shared with RESIDCO`;
  if (pinned) return `${quoted} — pinned`;
  return quoted;
}

export const EMPTY_VIEWS_HINT = "No saved views yet — use Save view above";

export function createdViewSelection<T extends { id: number; name: string }>(views: T[], createdId: number): T | null {
  return views.find((view) => view.id === createdId) ?? null;
}

/** One POST, then the refetched list, then the new view is the one to select. */
export async function runViewCreate<T extends { id: number; name: string }>(opts: {
  post: () => Promise<{ id: number; name: string }>;
  refetch: () => Promise<T[]>;
}): Promise<{ posts: number; selected: { id: number; name: string } }> {
  const created = await opts.post();
  let views: T[] = [];
  try {
    views = await opts.refetch();
  } catch {
    views = [];
  }
  const selected = createdViewSelection(views, created.id) ?? { id: created.id, name: created.name };
  return { posts: 1, selected };
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

/**
 * Before-image for a view PATCH. Every key in the patch is copied from the
 * current row, including updated_at and updated_by. Leaving a key out makes
 * changedKeys store null, and Undo then writes NULL.
 */
export function snapshotBeforePatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    before[key] = Object.prototype.hasOwnProperty.call(current, key) ? (current[key] ?? null) : null;
  }
  return before;
}

/** Assign every patch key, including JSON null, the way rlms_apply_jsonb_patch does. */
export function applyJsonbPatch(
  row: Record<string, unknown>,
  patch: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const next = { ...row };
  for (const key of Object.keys(patch ?? {})) next[key] = patch?.[key] ?? null;
  return next;
}

/** Selected add/remove skips inactive cars. Creating from a paste does not use this. */
export function idsWithoutInactive(ids: number[], inactive: ReadonlySet<number>): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (!Number.isFinite(id) || id <= 0 || inactive.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Unique violation when Undo restores a soft-deleted view whose name is already live. */
export function viewUndoNameConflict(error: unknown): string | null {
  const row = error as { code?: string; message?: string; details?: string; hint?: string } | null;
  const text = [
    row?.message,
    row?.details,
    row?.hint,
    error instanceof Error ? error.message : "",
  ].filter(Boolean).join(" ");
  const code = String(row?.code ?? "");
  const unique = code === "23505" || /\b23505\b/.test(text);
  if (!unique || !/car_lists_name_live_uq/i.test(text)) return null;
  return VIEW_NAME_UNDO_CONFLICT;
}

/** Probe failure: a missing column is the migration gap; anything else is a short outage. */
export function schemaProbeResult(error: unknown | null | undefined): {
  ready: boolean;
  unavailable: boolean;
  message: string;
} {
  if (!error) return { ready: true, unavailable: false, message: "" };
  if (isMissingViewSchema(error)) {
    return { ready: false, unavailable: false, message: SAVED_VIEWS_SCHEMA_MESSAGE };
  }
  return { ready: false, unavailable: true, message: VIEWS_UNAVAILABLE_MESSAGE };
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

function errorText(error: unknown): { code: string; message: string } {
  const row = error as { code?: unknown; message?: unknown } | null;
  const code = row && typeof row === "object" && row.code != null ? String(row.code) : "";
  const message = error instanceof Error
    ? error.message
    : row && typeof row === "object" && typeof row.message === "string"
      ? row.message
      : typeof error === "string"
        ? error
        : "";
  return { code, message };
}

/** Missing column (42703 / PGRST204) or missing table (42P01 / PGRST205) only. */
export function isMissingViewSchema(error: unknown): boolean {
  const { code, message } = errorText(error);
  if (code === "42703" || code === "42P01" || code === "PGRST204" || code === "PGRST205") return true;
  if (/relation ["']?[\w.]+["']? does not exist/i.test(message)) return true;
  if (/could not find the table/i.test(message)) return true;
  return /schema cache|could not find the|column .* does not exist/i.test(message)
    && /kind|deleted_at|layout|pinned|pin_order|updated_at|updated_by|removed_at|added_at|added_by|sort_order|\bnote\b/i.test(message);
}

export type ViewWriteErrorBody = {
  status: number;
  message: string;
  code?: string;
  schema_ready?: false;
};

/** HTTP body for a view route failure. Schema gaps stay the database-update message. */
export function viewWriteError(error: unknown): ViewWriteErrorBody {
  if (isMissingViewSchema(error)) {
    return { status: 503, schema_ready: false, message: SAVED_VIEWS_SCHEMA_MESSAGE };
  }
  const row = (error && typeof error === "object" ? error : {}) as { status?: unknown; code?: unknown };
  const statusNum = Number(row.status);
  const status = Number.isFinite(statusNum) && statusNum >= 400 && statusNum < 600 ? statusNum : 500;
  const { code, message } = errorText(error);
  const body: ViewWriteErrorBody = { status, message: message || "Request failed" };
  if (code) body.code = code;
  return body;
}

/**
 * List changes keep entity_id = the view id and railcar_id null.
 * Undo of car_lists (rlms_undo_change_group) patches by row_pk and copies
 * railcar_id onto its own activity_log row. That column is a nullable FK.
 */
export function listChangeLogIds(viewId: number): { entity_id: number; railcar_id: null } {
  const railcarId = activityRailcarId({ railcar_id: null, entity_type: "railcar", entity_id: viewId });
  if (railcarId != null) throw new Error("view id must not be stored as railcar_id");
  return { entity_id: viewId, railcar_id: null };
}

/** Soft-delete after a failed create. A non-null deleted_at releases car_lists_name_live_uq. */
export function abandonedListPatch(hiddenAt: string): { deleted_at: string } {
  return { deleted_at: hiddenAt };
}

export function liveViewNameHeld(deletedAt: string | null | undefined): boolean {
  return deletedAt == null || String(deletedAt).trim() === "";
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
