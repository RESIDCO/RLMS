/** Diff helpers for activity_log before/after payloads. Undo (PR U2) restores only these keys. */

export type ActivityEntityType =
  | "railcar"
  | "rider"
  | "program"
  | "program_car"
  | "master_lease"
  | "account"
  | "opportunity"
  | "crm_activity"
  | "company"
  | "company_contact"
  | "opportunity_contact"
  | "opportunity_line"
  | "deal_calc_scenario"
  | "deal_calc_assumption_set";

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return true;
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    try {
      return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
    } catch {
      return false;
    }
  }
  if (a instanceof Date || b instanceof Date) {
    return String(a) === String(b);
  }
  return false;
}

function canonicalize(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = canonicalize(obj[k]);
  return out;
}

export function changedKeys(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const left = before && typeof before === "object" ? before : {};
  const right = after && typeof after === "object" ? after : {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const outBefore: Record<string, unknown> = {};
  const outAfter: Record<string, unknown> = {};
  for (const key of keys) {
    const lv = key in left ? left[key] : null;
    const rv = key in right ? right[key] : null;
    if (jsonEqual(lv, rv)) continue;
    outBefore[key] = lv ?? null;
    outAfter[key] = rv ?? null;
  }
  return { before: outBefore, after: outAfter };
}

export function pickRow(row: Record<string, unknown> | null | undefined, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!row) return out;
  for (const key of keys) {
    if (key in row) out[key] = row[key] ?? null;
  }
  return out;
}

/**
 * Value written to activity_log.railcar_id.
 * An explicit null stays null. Omitting the field still defaults a railcar
 * entity to entity_id. View rows must pass null: entity_id is the view id,
 * and activity_log_railcar_id_fkey rejects a view id that is not a railcar.
 */
export function activityRailcarId(opts: {
  railcar_id?: number | null;
  entity_type: string;
  entity_id: number;
}): number | null {
  if (opts.railcar_id !== undefined) return opts.railcar_id;
  if (opts.entity_type === "railcar") return opts.entity_id;
  return null;
}

/** Null satisfies the FK. Any other id must already exist in railcars. */
export function activityLogRailcarFkAllows(railcarId: number | null, existingRailcarIds: ReadonlySet<number>): boolean {
  if (railcarId == null) return true;
  return existingRailcarIds.has(railcarId);
}

export type ActivityLogInput = {
  table: string;
  pk: number | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  action: string;
  entity_type: string;
  entity_id: number;
  railcar_id?: number | null;
  rider_id?: number | null;
  actor?: string | null;
  undoable?: boolean;
  source?: string;
  source_table?: string | null;
  source_id?: number | null;
  detail?: Record<string, unknown>;
  occurred_at?: string;
  force?: boolean;
};

/** One activity_log row, or null when nothing changed. Same shape recordChange inserts. */
export function buildActivityLogRow(
  opts: ActivityLogInput,
  ctx: { group: string; actor: string | null; occurred_at: string },
): Record<string, unknown> | null {
  const diff = changedKeys(opts.before ?? {}, opts.after ?? {});
  const isInsert = !opts.before || Object.keys(opts.before).length === 0;
  const isDelete = !opts.after || Object.keys(opts.after).length === 0;
  if (!opts.force && !isInsert && !isDelete && Object.keys(diff.before).length === 0) return null;
  const before = isInsert ? {} : diff.before;
  const after = isDelete ? {} : isInsert ? (opts.after ?? {}) : diff.after;
  const actor = opts.actor ?? ctx.actor;
  return {
    entity_type: opts.entity_type,
    entity_id: opts.entity_id,
    action: opts.action,
    actor: actor ?? null,
    railcar_id: activityRailcarId(opts),
    rider_id:
      opts.rider_id !== undefined
        ? opts.rider_id
        : opts.entity_type === "rider"
          ? opts.entity_id
          : null,
    detail: {
      ...(opts.detail ?? {}),
      op: isInsert ? "insert" : isDelete ? "delete" : "update",
    },
    source: opts.source ?? "ui",
    occurred_at: opts.occurred_at ?? ctx.occurred_at,
    source_table: opts.source_table ?? null,
    source_id: opts.source_id ?? null,
    change_group: ctx.group,
    table_name: opts.table,
    row_pk: opts.pk,
    before,
    after,
    undoable: opts.undoable !== false,
  };
}
