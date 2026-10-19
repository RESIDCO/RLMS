import { isArrivedMilestone } from "./programs";
import { parseProgramDateInput } from "./program-dates";
import { isCompleteProgramStatus, statusLeavesComplete } from "./program-status";

/** Completion lives on program_cars.custom_fields, not a completed column. */
export const PROGRAM_COMPLETE_CF = "__complete";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function customFieldsOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

/**
 * Turn Complete off. Clears the outcome date and __complete.
 * Spreads the prior custom fields so __keep_open stays put.
 * Does not write program_cars.completed or completed_at.
 */
export function clearCompleteFlags(out: Record<string, unknown>, prior: Record<string, unknown> | null) {
  out.outcome_reached_at = null;
  const prev = out.custom_fields && typeof out.custom_fields === "object"
    ? customFieldsOf(out.custom_fields)
    : customFieldsOf(prior?.custom_fields);
  out.custom_fields = { ...prev, [PROGRAM_COMPLETE_CF]: false };
}

/**
 * Columns for one program-car patch, including the bulk Complete bar.
 * `updates.completed` is the request flag. The stored value is custom_fields.__complete.
 */
export function patchColumns(updates: Record<string, unknown>, prior: Record<string, unknown> | null) {
  const out: Record<string, unknown> = {};
  if (updates.milestone !== undefined) out.milestone = updates.milestone === "" ? null : String(updates.milestone);
  if (updates.milestone_at !== undefined) {
    const parsed = parseProgramDateInput(String(updates.milestone_at ?? ""));
    if (parsed === null) out.milestone_at = null;
    else if (parsed && /^\d{4}-\d{2}-\d{2}$/.test(parsed)) out.milestone_at = parsed;
  }
  if (updates.status !== undefined) out.status = updates.status === "" ? null : String(updates.status);
  if (updates.notes !== undefined) out.notes = updates.notes === "" ? null : updates.notes;
  if (updates.flag_tag !== undefined) out.flag_tag = updates.flag_tag === "" ? null : String(updates.flag_tag);
  if (updates.shop_id !== undefined) out.shop_id = updates.shop_id == null || updates.shop_id === "" ? null : Number(updates.shop_id);
  if (updates.scrap_yard_id !== undefined) {
    out.scrap_yard_id = updates.scrap_yard_id == null || updates.scrap_yard_id === "" ? null : Number(updates.scrap_yard_id);
  }
  if (updates.repair_cost_total !== undefined) {
    const n = updates.repair_cost_total === "" || updates.repair_cost_total == null ? null : Number(updates.repair_cost_total);
    out.repair_cost_total = n != null && Number.isFinite(n) ? n : null;
  }
  if (updates.outcome_reached === true || updates.outcome_reached === "true") {
    out.outcome_reached_at = todayIso();
  }
  if (updates.outcome_reached === false || updates.outcome_reached === "false") {
    clearCompleteFlags(out, prior);
  }
  if (updates.completed !== undefined) {
    const on = updates.completed === true || updates.completed === "true" || updates.completed === 1 || updates.completed === "1";
    if (on && out.outcome_reached_at === undefined && !prior?.outcome_reached_at) {
      out.outcome_reached_at = todayIso();
    }
    if (!on && updates.outcome_reached === undefined) {
      out.outcome_reached_at = null;
    }
    const prevCf = customFieldsOf(prior?.custom_fields);
    out.custom_fields = { ...prevCf, [PROGRAM_COMPLETE_CF]: on };
  }
  if (updates.custom_fields && typeof updates.custom_fields === "object") {
    const prev = out.custom_fields && typeof out.custom_fields === "object"
      ? customFieldsOf(out.custom_fields)
      : customFieldsOf(prior?.custom_fields);
    out.custom_fields = { ...prev, ...(updates.custom_fields as object) };
  }
  const nextMilestone = (out.milestone !== undefined ? out.milestone : prior?.milestone) as string | null;
  if (isArrivedMilestone(nextMilestone) && out.outcome_reached_at === undefined && !prior?.outcome_reached_at) {
    const d = out.milestone_at != null ? String(out.milestone_at).slice(0, 10) : todayIso();
    out.outcome_reached_at = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayIso();
  }
  const priorStatus = prior?.status == null ? "" : String(prior.status);
  if (
    updates.status !== undefined &&
    isCompleteProgramStatus(priorStatus) &&
    statusLeavesComplete(out.status == null ? "" : String(out.status))
  ) {
    clearCompleteFlags(out, prior);
  }
  return out;
}

/** True when a program-car write would touch the columns that were never migrated. */
export function patchWritesCompletedColumn(cols: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(cols, "completed") || Object.prototype.hasOwnProperty.call(cols, "completed_at");
}
