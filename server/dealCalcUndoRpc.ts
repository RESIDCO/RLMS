/**
 * Service-role calls into the deal-calc undo functions.
 * The four frozen rlms_ functions are not created or edited here.
 * rlms_undo_change_group is called only to roll back a core group when the
 * paired scenario write did not land.
 */

import { supabaseAdmin } from "./supabase";

export async function callUndoChangeGroup(group: string, actor: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.rpc("rlms_undo_change_group", {
    p_group: group,
    p_actor: actor,
  });
  if (error) throw error;
  return (data ?? {}) as Record<string, unknown>;
}

export async function callUndoCalcCreateOpp(calcGroup: string, coreGroup: string, actor: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.rpc("rlms_undo_calc_create_opp", {
    p_calc: calcGroup,
    p_core: coreGroup,
    p_actor: actor,
  });
  if (error) throw error;
  return (data ?? {}) as Record<string, unknown>;
}
