import { supabaseAdmin } from "./supabase";
import {
  crossesInactiveBoundary,
  fieldsForInactiveBoundaryChange,
  inactiveBoundaryEventType,
  isInactiveCarStatus,
  type CarStatusHistoryEventType,
} from "@shared/car-lifecycle-status";

export type ApplyCarStatusResult = {
  updated: number;
  history_written: number;
  skipped_same: number;
};

async function createdByLabel(userId: string): Promise<string> {
  const { data: userRow } = await supabaseAdmin
    .from("user_roles")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle();
  return userRow?.email ?? userId;
}

/**
 * Keep the current open assignment_history period's ACTIVE in sync with railcars.active
 * so v_valid_export_rows / V_Valid export reflect guarded Inactive flips.
 * Does not touch start_date / end_date / rider / labels.
 */
export async function syncCurrentAssignmentHistoryActive(
  railcarId: number,
  active: boolean,
): Promise<void> {
  const { data: openRows, error } = await supabaseAdmin
    .from("assignment_history")
    .select("id, start_date")
    .eq("railcar_id", railcarId)
    .is("end_date", null)
    .order("start_date", { ascending: false });
  if (error) throw error;
  if (!openRows?.length) return;
  const targetId = openRows[0].id;
  const { error: uErr } = await supabaseAdmin
    .from("assignment_history")
    .update({ active })
    .eq("id", targetId);
  if (uErr) throw uErr;
}

/**
 * Apply Car Status to one or more cars.
 * Crossing the Inactive boundary requires a non-empty reason and writes history;
 * other status changes only update railcars.status (legacy behavior).
 * Never touches fleet_status / rental status.
 */
export async function applyCarStatusChange(opts: {
  ids: number[];
  status: string;
  reason?: string | null;
  userId: string;
}): Promise<ApplyCarStatusResult> {
  const toStatus = String(opts.status ?? "").trim();
  if (!toStatus) throw Object.assign(new Error("status is required"), { status: 400 });

  const uniqueIds = Array.from(
    new Set(opts.ids.filter((n) => Number.isFinite(n) && n > 0)),
  );
  if (!uniqueIds.length) throw Object.assign(new Error("ids required"), { status: 400 });

  const { data: cars, error: cErr } = await supabaseAdmin
    .from("railcars")
    .select("id, status")
    .in("id", uniqueIds);
  if (cErr) throw cErr;

  const byId = new Map((cars ?? []).map((c: any) => [Number(c.id), c]));
  const reason = String(opts.reason ?? "").trim();
  const created_by = await createdByLabel(opts.userId);

  let updated = 0;
  let history_written = 0;
  let skipped_same = 0;
  const historyRows: {
    car_id: number;
    event_type: CarStatusHistoryEventType;
    reason: string;
    created_by: string;
    from_status: string | null;
    to_status: string;
  }[] = [];

  for (const id of uniqueIds) {
    const car = byId.get(id);
    if (!car) continue;
    const fromStatus = car.status ?? null;
    if (String(fromStatus ?? "").trim() === toStatus) {
      skipped_same += 1;
      continue;
    }

    const crosses = crossesInactiveBoundary(fromStatus, toStatus);
    if (crosses && !reason) {
      throw Object.assign(
        new Error(
          "A reason is required when marking cars Inactive or reactivating them from Inactive",
        ),
        { status: 400 },
      );
    }

    const patch = crosses
      ? fieldsForInactiveBoundaryChange(toStatus)
      : { status: toStatus };

    const { error: uErr } = await supabaseAdmin.from("railcars").update(patch).eq("id", id);
    if (uErr) throw uErr;
    updated += 1;

    if (crosses) {
      await syncCurrentAssignmentHistoryActive(id, patch.active);
      historyRows.push({
        car_id: id,
        event_type: inactiveBoundaryEventType(toStatus),
        reason,
        created_by,
        from_status: fromStatus,
        to_status: patch.status,
      });
    }
  }

  if (historyRows.length) {
    const { error: hErr } = await supabaseAdmin.from("car_status_history").insert(historyRows);
    if (hErr) throw hErr;
    history_written = historyRows.length;
  }

  return { updated, history_written, skipped_same };
}

/** Reject PATCH bodies that try to cross Inactive without inactive_change_reason. */
export function assertInactivePatchAllowed(opts: {
  currentStatus: string | null | undefined;
  nextStatus: string | null | undefined;
  reason: string | null | undefined;
}): void {
  if (opts.nextStatus == null) return;
  if (!crossesInactiveBoundary(opts.currentStatus, opts.nextStatus)) return;
  if (String(opts.reason ?? "").trim()) return;
  throw Object.assign(
    new Error(
      "A reason is required when marking a car Inactive or reactivating it from Inactive",
    ),
    { status: 400 },
  );
}

export function patchFieldsForStatusChange(
  currentStatus: string | null | undefined,
  nextStatus: string,
): Record<string, unknown> {
  if (crossesInactiveBoundary(currentStatus, nextStatus)) {
    return fieldsForInactiveBoundaryChange(nextStatus);
  }
  return { status: nextStatus };
}

export async function writeCarStatusHistoryRow(opts: {
  carId: number;
  fromStatus: string | null | undefined;
  toStatus: string;
  reason: string;
  userId: string;
}): Promise<void> {
  const created_by = await createdByLabel(opts.userId);
  const { error } = await supabaseAdmin.from("car_status_history").insert({
    car_id: opts.carId,
    event_type: inactiveBoundaryEventType(opts.toStatus),
    reason: opts.reason.trim(),
    created_by,
    from_status: opts.fromStatus ?? null,
    to_status: opts.toStatus,
  });
  if (error) throw error;
}

export { isInactiveCarStatus, crossesInactiveBoundary };
