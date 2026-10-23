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
