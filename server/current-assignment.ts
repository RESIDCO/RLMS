import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * railcars.current_assignment_id is the internal railcar_assignments.id, never
 * the VCF source ASSIGNMENT_ID (that lives on assignment_history.assignment_id_ext).
 */
export async function pointCurrentAssignmentAt(
  db: SupabaseClient,
  rows: Array<{ railcar_id: number; id: number }>,
) {
  for (const row of rows) {
    const rid = Number(row.railcar_id);
    const aid = Number(row.id);
    if (!Number.isFinite(rid) || !Number.isFinite(aid) || aid <= 0) continue;
    const { error } = await db
      .from("railcars")
      .update({ current_assignment_id: String(aid) })
      .eq("id", rid);
    if (error) throw error;
  }
}

export async function pointCurrentAssignmentAtIds(
  db: SupabaseClient,
  assignmentIds: number[],
) {
  const ids = [...new Set(assignmentIds.filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return;
  const { data, error } = await db
    .from("railcar_assignments")
    .select("id, railcar_id")
    .in("id", ids);
  if (error) throw error;
  await pointCurrentAssignmentAt(db, data ?? []);
}
