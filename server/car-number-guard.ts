import { supabase } from "./supabase";
import {
  describeCarNumberConflict,
  type CarIdentityConflict,
} from "@shared/residco-import";

const CONFLICT_SELECT =
  "id, car_number, reporting_marks, status, fleet_status, entity, active";

export async function findCarNumberConflict(opts: {
  car_number: string;
  reporting_marks: string | null;
  excludeId?: number;
}): Promise<CarIdentityConflict | null> {
  let q = supabase.from("railcars").select(CONFLICT_SELECT).eq("car_number", opts.car_number);
  q = opts.reporting_marks == null
    ? q.is("reporting_marks", null)
    : q.eq("reporting_marks", opts.reporting_marks);
  if (opts.excludeId != null) q = q.neq("id", opts.excludeId);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return (data as CarIdentityConflict | null) ?? null;
}

export function conflictResponse(row: CarIdentityConflict) {
  return {
    message: describeCarNumberConflict(row),
    conflict: {
      id: row.id,
      reporting_marks: row.reporting_marks ?? null,
      car_number: row.car_number ?? null,
      status: row.status ?? null,
      fleet_status: row.fleet_status ?? null,
      entity: row.entity ?? null,
      active: row.active ?? null,
    },
  };
}
