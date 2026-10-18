import { jsonEqual } from "./change-log";

export const UNDO_WINDOW_HOURS = 24;

export const UNDO_ALLOWED_TABLES = [
  "railcars",
  "car_commitments",
  "car_rent_stops",
  "program_cars",
  "program_car_milestones",
  "programs",
  "railcar_assignments",
  "assignment_history",
  "car_status_history",
  "car_tags",
  "car_lists",
  "car_list_members",
  "riders",
  "master_leases",
  "attachments",
  "opportunities",
  "crm_activities",
] as const;

export type UndoAllowedTable = (typeof UNDO_ALLOWED_TABLES)[number];

export function isUndoAllowedTable(raw: string | null | undefined): raw is UndoAllowedTable {
  return (UNDO_ALLOWED_TABLES as readonly string[]).includes(String(raw ?? ""));
}

export type UndoLogRow = {
  id: number;
  change_group: string | null;
  table_name: string | null;
  row_pk: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  undoable?: boolean | null;
  undone_at?: string | null;
  actor?: string | null;
  action?: string | null;
  occurred_at?: string | null;
  detail?: Record<string, unknown> | null;
  entity_type?: string | null;
  entity_id?: number | null;
  railcar_id?: number | null;
};

export type UndoConflict = {
  activity_id: number;
  table_name: string | null;
  row_pk: number | null;
  reason: string;
};

function coerce(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    if (s === "true") return true;
    if (s === "false") return false;
    return s;
  }
  return v;
}

export function currentMatchesAfter(
  current: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): boolean {
  if (!after || Object.keys(after).length === 0) return true;
  const cur = current ?? {};
  for (const [k, expected] of Object.entries(after)) {
    if (!jsonEqual(coerce(cur[k]), coerce(expected))) return false;
  }
  return true;
}

export function opOf(row: UndoLogRow): "insert" | "update" | "delete" {
  const d = String(row.detail?.op ?? "").toLowerCase();
  if (d === "insert" || d === "delete" || d === "update") return d;
  const b = row.before && Object.keys(row.before).length > 0;
  const a = row.after && Object.keys(row.after).length > 0;
  if (!b && a) return "insert";
  if (b && !a) return "delete";
  return "update";
}

export function summarizeUndoRows(rows: UndoLogRow[]): { count: number; lines: string[] } {
  const lines: string[] = [];
  for (const r of rows) {
    const op = opOf(r);
    const keys = Object.keys(op === "insert" ? r.after ?? {} : r.before ?? {}).join(", ") || "row";
    lines.push(`${op} ${r.table_name ?? "?"} #${r.row_pk ?? r.id} (${keys})`);
  }
  return { count: rows.length, lines };
}

export function nonUndoableMessage(action: string | null | undefined): string {
  const a = String(action ?? "").toLowerCase();
  if (a.includes("remark") || a.includes("mark_change") || a.includes("change-number")) {
    return "Remarks cannot be undone (the old car row is retired and a new id is inserted).";
  }
  if (a.includes("import") || a.includes("vcf")) {
    return "Imports cannot be undone.";
  }
  return "This change is marked non-undoable.";
}
