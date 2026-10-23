/**
 * Every remark entry point calls applyRemark.
 * The transaction is public.remark_railcars_apply. The older RPCs
 * remark_railcars and remark_railcars_in_place delegate to that function.
 */

import { supabaseAdmin } from "./supabase";

export type RemarkApplyItem = {
  id: number;
  reporting_marks: string;
  car_number: string;
  old_reporting_marks?: string;
  old_car_number?: string;
};

export type RemarkApplyResult = {
  ok?: boolean;
  undoable?: boolean;
  error?: string;
  change_group?: string;
  conflicts?: Array<Record<string, unknown>>;
  results?: Array<Record<string, unknown>>;
};

export async function applyRemark(input: {
  items: RemarkApplyItem[];
  reason: string | null;
  changedBy: string;
  actor: string;
  changeGroup?: string | null;
}): Promise<RemarkApplyResult> {
  const { data, error } = await supabaseAdmin.rpc("remark_railcars_apply", {
    p_items: input.items,
    p_reason: input.reason,
    p_changed_by: input.changedBy,
    p_actor: input.actor,
    p_change_group: input.changeGroup ?? null,
  });
  if (error) throw error;
  return (data ?? {}) as RemarkApplyResult;
}

export function remarkFailure(result: RemarkApplyResult): { status: number; body: { message: string; conflicts: unknown } } | null {
  if (result.ok !== false) return null;
  const message = String(result.error || "Remark failed");
  if (Array.isArray(result.conflicts) && result.conflicts.length) {
    return { status: 409, body: { message, conflicts: result.conflicts } };
  }
  return { status: 400, body: { message, conflicts: null } };
}
