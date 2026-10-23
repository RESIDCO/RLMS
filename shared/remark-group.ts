import { isUndoAllowedTable } from "./undo";

type RemarkGroupRow = {
  action?: string | null;
  table_name?: string | null;
  detail?: { op?: unknown } | null;
};

/** A remark change group inserts the new active railcar and records mark_change. */
export function isRemarkRetireGroup(rows: RemarkGroupRow[]): boolean {
  return rows.some(
    (row) => row.action === "mark_change" && row.table_name === "railcars" && String(row.detail?.op ?? "") === "insert",
  );
}

/**
 * Frozen undo rejects car_number_history. A remark group still records that
 * insert so rlms_undo_change_group fails closed. Preview allows it and sends
 * the group to rlms_undo_remark_group.
 */
export function remarkUndoTableAllowed(table: string, rows: RemarkGroupRow[]): boolean {
  if (isUndoAllowedTable(table)) return true;
  return isRemarkRetireGroup(rows) && table === "car_number_history";
}

/** Child rows whose delete would cascade or restrict when the new railcar is removed. */
export const REMARK_OUTSIDE_REFS = [
  { table: "rent_events", column: "car_id", label: "rent event" },
  { table: "railcar_assignments", column: "railcar_id", label: "assignment" },
  { table: "assignment_history", column: "railcar_id", label: "assignment history" },
  { table: "program_cars", column: "railcar_id", label: "a program membership" },
  { table: "car_rent_stops", column: "railcar_id", label: "a rent stop" },
  { table: "car_tags", column: "railcar_id", label: "a tag" },
  { table: "car_list_members", column: "railcar_id", label: "a list item" },
  { table: "car_commitments", column: "railcar_id", label: "a commitment" },
  { table: "car_number_history", column: "railcar_id", label: "car number history" },
  { table: "car_status_history", column: "car_id", label: "status history" },
  { table: "railcar_ab_items", column: "railcar_id", label: "an A/B item" },
  { table: "dv_calculations", column: "railcar_id", label: "a DV calculation" },
  { table: "program_activity", column: "railcar_id", label: "program activity" },
  { table: "attachments", column: "entity_id", label: "an attachment" },
] as const;

export const REMARK_REFERENCED_MESSAGE = "Undo refused: the new car was referenced after the remark.";

/** True when rlms_fk_outside_group rejected the table or column instead of searching it. */
export function frozenFkOutsideUnchecked(message: string): boolean {
  return message.includes("referenced-since:") && message.includes("is not checked");
}

export function remarkOutsideUndoMessage(label: string, recordId: number): string {
  if (label === "rent event") {
    return "Undo refused: a rent event is attached to the new car. Remark does not delete rent events.";
  }
  if (label === "assignment") {
    return `Undo refused: an assignment was added on the new car after the remark (record ${recordId}). Undo will not delete it.`;
  }
  if (label === "assignment history") {
    return `Undo refused: assignment history was added on the new car after the remark (record ${recordId}). Undo will not delete it.`;
  }
  return `Undo refused: ${label} on the new car is outside this change (record ${recordId}). Undo will not delete it.`;
}

/** Smallest id in foundIds that this change group did not log. */
export function firstOutsideRecordId(foundIds: number[], loggedIds: Iterable<number>): number | null {
  const logged = new Set(loggedIds);
  let best: number | null = null;
  for (const id of foundIds) {
    if (!Number.isFinite(id) || logged.has(id)) continue;
    if (best == null || id < best) best = id;
  }
  return best;
}
