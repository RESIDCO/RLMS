import { isFrozenRailcar } from "@shared/car-lifecycle-status";
import { supabaseAdmin } from "./supabase";

export const FROZEN_CAR_MESSAGE =
  "Inactive cars are read-only. An admin can reactivate them with a reason.";

const CHUNK = 200;

export async function findFrozenRailcarIds(ids: number[]): Promise<number[]> {
  const unique = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0)));
  const frozen: number[] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin.from("railcars").select("id, active, status").in("id", slice);
    if (error) throw error;
    for (const row of data ?? []) {
      if (isFrozenRailcar(row)) frozen.push(Number(row.id));
    }
  }
  return frozen;
}

export async function assertRailcarsWritable(ids: number[]): Promise<void> {
  const frozen = await findFrozenRailcarIds(ids);
  if (!frozen.length) return;
  throw Object.assign(new Error(FROZEN_CAR_MESSAGE), { status: 409, frozen_ids: frozen });
}
