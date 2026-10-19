import { pickRow } from "@shared/change-log";
import {
  fieldsForCarStatusSave,
  inactiveBoundaryEvent,
  isInactiveCarStatus,
  type CarStatusHistoryEventType,
} from "@shared/car-lifecycle-status";
import { recordChange } from "./change-log";
import { supabaseAdmin } from "./supabase";

const STATUS_TRIAD_KEYS = ["status", "active", "active_status", "active_source", "fleet_status"];

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
    .select("id, active, start_date")
    .eq("railcar_id", railcarId)
    .is("end_date", null)
    .order("start_date", { ascending: false });
  if (error) throw error;
  if (!openRows?.length) return;
  const target = openRows[0];
  const targetId = target.id;
  const { error: uErr } = await supabaseAdmin
    .from("assignment_history")
    .update({ active })
    .eq("id", targetId);
  if (uErr) throw uErr;
  await recordChange({
    table: "assignment_history",
    pk: Number(targetId),
    before: pickRow(target, ["active"]),
    after: { active },
    action: "status_change",
    entity_type: "railcar",
    entity_id: railcarId,
    railcar_id: railcarId,
  });
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
 * Only Inactive sets active=false. Every other status keeps active=true.
 * Entering Inactive, or leaving a frozen car, requires a reason and writes history.
 * Never touches fleet_status / rental status. Never touches rent_events.
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

  let cars: any[] | null = null;
  {
    const withFleet = await supabaseAdmin
      .from("railcars")
      .select("id, status, active, active_status, active_source, fleet_status")
      .in("id", uniqueIds);
    if (withFleet.error && /fleet_status/i.test(withFleet.error.message)) {
      const withoutFleet = await supabaseAdmin
        .from("railcars")
        .select("id, status, active, active_status, active_source")
        .in("id", uniqueIds);
      if (withoutFleet.error) throw withoutFleet.error;
      cars = withoutFleet.data ?? [];
    } else if (withFleet.error) {
      throw withFleet.error;
    } else {
      cars = withFleet.data ?? [];
    }
  }

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
    const event = inactiveBoundaryEvent({ status: fromStatus, active: car.active }, toStatus);
    if (event && !reason) {
      throw Object.assign(
        new Error(
          "A reason is required when marking cars Inactive or reactivating them",
        ),
        { status: 400 },
      );
    }

    const patch = fieldsForCarStatusSave(toStatus, { stampManual: Boolean(event) });
    if (triadAlreadyMatches(car, patch)) {
      skipped_same += 1;
      continue;
    }

    const { error: uErr } = await supabaseAdmin.from("railcars").update(patch).eq("id", id);
    if (uErr) throw uErr;
    updated += 1;
    await recordChange({
      table: "railcars",
      pk: id,
      before: pickRow(car, STATUS_TRIAD_KEYS),
      after: pickRow({ ...car, ...patch }, STATUS_TRIAD_KEYS),
      action: "status_change",
      entity_type: "railcar",
      entity_id: id,
      railcar_id: id,
      actor: created_by,
      source_table: "railcars",
      source_id: null,
      detail: { from: fromStatus, to: patch.status, reason: reason || null },
    });

    if (car.active !== patch.active) {
      await syncCurrentAssignmentHistoryActive(id, patch.active);
    }

    if (event) {
      historyRows.push({
        car_id: id,
        event_type: event,
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
      const car = byId.get(Number(h.car_id));
      await recordChange({
        table: "car_status_history",
        pk: Number(h.id),
        before: {
          ...pickRow(car, STATUS_TRIAD_KEYS),
          from_status: h.from_status,
          to_status: h.from_status,
        },
        after: {
          status: h.to_status,
          from_status: h.from_status,
          to_status: h.to_status,
          event_type: h.event_type,
          reason: h.reason,
        },
        action: "status_change",
        entity_type: "railcar",
        entity_id: Number(h.car_id),
        railcar_id: Number(h.car_id),
        actor: h.created_by,
        detail: {
          event_type: h.event_type,
          from: h.from_status,
          to: h.to_status,
          reason: h.reason,
        },
        occurred_at: h.created_at,
        source_table: "car_status_history",
        source_id: Number(h.id),
      });
    }
  }

  return { updated, history_written, skipped_same };
}

/** Reject a direct PATCH that marks Inactive, or that reactivates without a reason. */
export function assertInactivePatchAllowed(opts: {
  currentStatus: string | null | undefined;
  currentActive?: boolean | null;
  nextStatus: string | null | undefined;
  reason: string | null | undefined;
}): void {
  if (opts.nextStatus == null) return;
  if (isInactiveCarStatus(opts.nextStatus) && !isInactiveCarStatus(opts.currentStatus)) {
    throw Object.assign(
      new Error("Use Set Car Status → Inactive so each car can be previewed"),
      { status: 400 },
    );
  }
  const event = inactiveBoundaryEvent(
    { status: opts.currentStatus, active: opts.currentActive },
    String(opts.nextStatus),
  );
  if (!event) return;
  if (String(opts.reason ?? "").trim()) return;
  throw Object.assign(
    new Error("A reason is required when reactivating an inactive car"),
    { status: 400 },
  );
}

export function patchFieldsForStatusChange(
  current: { status?: string | null; active?: boolean | null },
  nextStatus: string,
): Record<string, unknown> {
  const event = inactiveBoundaryEvent(current, nextStatus);
  return fieldsForCarStatusSave(nextStatus, { stampManual: Boolean(event) });
}

export async function writeCarStatusHistoryRow(opts: {
  carId: number;
  fromStatus: string | null | undefined;
  currentActive?: boolean | null;
  toStatus: string;
  reason: string;
  userId: string;
}): Promise<void> {
  const created_by = await createdByLabel(opts.userId);
  const event = inactiveBoundaryEvent(
    { status: opts.fromStatus, active: opts.currentActive },
    opts.toStatus,
  );
  if (!event) return;
  const { data, error } = await supabaseAdmin.from("car_status_history").insert({
    car_id: opts.carId,
    event_type: event,
    reason: opts.reason.trim(),
    created_by,
    from_status: opts.fromStatus ?? null,
    to_status: opts.toStatus,
  }).select("id, created_at").single();
  if (error) throw error;
  await recordChange({
    table: "car_status_history",
    pk: data?.id != null ? Number(data.id) : null,
    before: { status: opts.fromStatus ?? null, from_status: opts.fromStatus ?? null },
    after: { status: opts.toStatus, to_status: opts.toStatus, reason: opts.reason.trim() },
    action: "status_change",
    entity_type: "railcar",
    entity_id: opts.carId,
    railcar_id: opts.carId,
    actor: created_by,
    detail: {
      event_type: event,
      from: opts.fromStatus ?? null,
      to: opts.toStatus,
      reason: opts.reason.trim(),
    },
    occurred_at: data?.created_at,
    source_table: "car_status_history",
    source_id: data?.id != null ? Number(data.id) : null,
  });
}

export { isInactiveCarStatus, inactiveBoundaryEvent };
