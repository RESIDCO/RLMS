import { supabaseAdmin } from "./supabase";
import { logActivity } from "./activity-log";
import {
  crossesInactiveBoundary,
  fieldsForCarStatusSave,
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

function triadAlreadyMatches(
  car: { status?: string | null; active?: boolean | null; active_status?: string | null },
  patch: { status: string; active: boolean; active_status: string },
): boolean {
  return (
    String(car.status ?? "").trim() === patch.status &&
    car.active === patch.active &&
    String(car.active_status ?? "").trim().toLowerCase() === patch.active_status.toLowerCase()
  );
}

/**
 * Apply Car Status to one or more cars.
 * Always writes active/active_status implied by the submitted status (self-heals desync).
 * Crossing the Inactive *status value* requires a reason and writes history.
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
    .select("id, status, active, active_status")
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
    const crosses = crossesInactiveBoundary(fromStatus, toStatus);
    if (crosses && !reason) {
      throw Object.assign(
        new Error(
          "A reason is required when marking cars Inactive or reactivating them from Inactive",
        ),
        { status: 400 },
      );
    }

    const patch = fieldsForCarStatusSave(toStatus, { stampManual: crosses });
    if (triadAlreadyMatches(car, patch)) {
      skipped_same += 1;
      continue;
    }

    const { error: uErr } = await supabaseAdmin.from("railcars").update(patch).eq("id", id);
    if (uErr) throw uErr;
    updated += 1;

    if (car.active !== patch.active) {
      await syncCurrentAssignmentHistoryActive(id, patch.active);
    }

    if (crosses) {
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
    const { data: inserted, error: hErr } = await supabaseAdmin
      .from("car_status_history")
      .insert(historyRows)
      .select("id, car_id, event_type, reason, created_by, from_status, to_status, created_at");
    if (hErr) throw hErr;
    history_written = inserted?.length ?? historyRows.length;
    for (const h of inserted ?? []) {
      await logActivity({
        entity_type: "railcar",
        entity_id: h.car_id,
        railcar_id: h.car_id,
        action: "status_change",
        actor: h.created_by,
        detail: {
          event_type: h.event_type,
          from: h.from_status,
          to: h.to_status,
          reason: h.reason,
        },
        occurred_at: h.created_at,
        source_table: "car_status_history",
        source_id: h.id,
      });
    }
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
  const crosses = crossesInactiveBoundary(currentStatus, nextStatus);
  return fieldsForCarStatusSave(nextStatus, { stampManual: crosses });
}

export async function writeCarStatusHistoryRow(opts: {
  carId: number;
  fromStatus: string | null | undefined;
  toStatus: string;
  reason: string;
  userId: string;
}): Promise<void> {
  const created_by = await createdByLabel(opts.userId);
  const { data, error } = await supabaseAdmin.from("car_status_history").insert({
    car_id: opts.carId,
    event_type: inactiveBoundaryEventType(opts.toStatus),
    reason: opts.reason.trim(),
    created_by,
    from_status: opts.fromStatus ?? null,
    to_status: opts.toStatus,
  }).select("id, created_at").single();
  if (error) throw error;
  await logActivity({
    entity_type: "railcar",
    entity_id: opts.carId,
    railcar_id: opts.carId,
    action: "status_change",
    actor: created_by,
    detail: {
      event_type: inactiveBoundaryEventType(opts.toStatus),
      from: opts.fromStatus ?? null,
      to: opts.toStatus,
      reason: opts.reason.trim(),
    },
    occurred_at: data?.created_at,
    source_table: "car_status_history",
    source_id: data?.id ?? null,
  });
}

export { isInactiveCarStatus, crossesInactiveBoundary };
