import { pickRow } from "@shared/change-log";
import { effectiveDateToTimestamp } from "@shared/lease-authority";
import {
  allRequestedCarsInactive,
  moveHistoryCapture,
  planMoveBatch,
  withCurrentAssignmentPointer,
  type MovePlanCarInput,
  type MovePlanRow,
} from "@shared/move-plan";
import type { MoveCarsInput } from "@shared/schema";
import { recordChange, withChangeGroupResult } from "./change-log";
import { FROZEN_CAR_MESSAGE } from "./frozen-cars";
import { pointCurrentAssignmentAt } from "./current-assignment";
import { loadOlIdentity, railcarIdentityPatch } from "./ol-identity";
import { supabaseAdmin } from "./supabase";

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

type LoadedCar = {
  id: number;
  label: string;
  active: boolean | null;
  status: string | null;
  fleet_status: string | null;
  current_assignment_id: string | null;
  lessee_name: string | null;
  rider_external_id: string | null;
  assignment_label: string | null;
  lease_type: string | null;
  assignment: {
    id: number;
    rider_id: number | null;
    fleet_name: string | null;
    rent_start_date: string | null;
    rent_start_set_by: string | null;
    rent_start_set_at: string | null;
    rider_name: string | null;
  } | null;
};

async function rowsIn<T>(ids: number[], run: (slice: number[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    out.push(...(await run(ids.slice(i, i + 200))));
  }
  return out;
}

function carLabel(row: { reporting_marks?: string | null; car_number?: string | null; id: number }): string {
  const label = [row.reporting_marks, row.car_number].filter(Boolean).join(" ");
  return label || `#${row.id}`;
}

async function loadCars(ids: number[]): Promise<Map<number, LoadedCar>> {
  const carRows = await rowsIn(ids, async (slice) => {
    const { data, error } = await supabaseAdmin
      .from("railcars")
      .select("id, car_number, reporting_marks, active, status, fleet_status, current_assignment_id, lessee_name, rider_external_id, assignment_label, lease_type")
      .in("id", slice);
    if (error) throw error;
    return data ?? [];
  });
  const assignRows = await rowsIn(ids, async (slice) => {
    const { data, error } = await supabaseAdmin
      .from("railcar_assignments")
      .select("id, railcar_id, rider_id, fleet_name, rent_start_date, rent_start_set_by, rent_start_set_at")
      .in("railcar_id", slice);
    if (error) throw error;
    return data ?? [];
  });
  const riderIds = Array.from(new Set(assignRows.map((row) => Number(row.rider_id)).filter((id) => id > 0)));
  const riderNames = new Map<number, string>();
  if (riderIds.length) {
    const riders = await rowsIn(riderIds, async (slice) => {
      const { data, error } = await supabaseAdmin.from("riders").select("id, rider_name").in("id", slice);
      if (error) throw error;
      return data ?? [];
    });
    for (const rider of riders) riderNames.set(Number(rider.id), String(rider.rider_name ?? ""));
  }
  const assignByCar = new Map<number, (typeof assignRows)[number]>();
  for (const row of assignRows) assignByCar.set(Number(row.railcar_id), row);
  const out = new Map<number, LoadedCar>();
  for (const row of carRows) {
    const assignment = assignByCar.get(Number(row.id)) ?? null;
    out.set(Number(row.id), {
      id: Number(row.id),
      label: carLabel(row),
      active: row.active ?? null,
      status: row.status ?? null,
      fleet_status: row.fleet_status ?? null,
      current_assignment_id: row.current_assignment_id == null ? null : String(row.current_assignment_id),
      lessee_name: row.lessee_name ?? null,
      rider_external_id: row.rider_external_id ?? null,
      assignment_label: row.assignment_label ?? null,
      lease_type: row.lease_type ?? null,
      assignment: assignment
        ? {
            id: Number(assignment.id),
            rider_id: assignment.rider_id == null ? null : Number(assignment.rider_id),
            fleet_name: assignment.fleet_name ?? null,
            rent_start_date: assignment.rent_start_date ?? null,
            rent_start_set_by: assignment.rent_start_set_by ?? null,
            rent_start_set_at: assignment.rent_start_set_at ?? null,
            rider_name: assignment.rider_id == null ? null : riderNames.get(Number(assignment.rider_id)) ?? null,
          }
        : null,
    });
  }
  return out;
}

async function buildPlans(input: MoveCarsInput, actor: string): Promise<{ plans: MovePlanRow[]; cars: Map<number, LoadedCar>; movedAt: string }> {
  const identity = await loadOlIdentity(input.to_rider_id);
  if (!identity) throw httpError(400, "Destination rider not found");
  const typedLessee = String(input.new_fleet_name ?? "").trim() || null;
  if (input.lessee_override) {
    if (!String(input.reason ?? "").trim()) throw httpError(400, "Reason is required when overriding the OL lessee");
    if (!typedLessee) throw httpError(400, "Lessee is required when overriding the OL lessee");
  }
  const deriveOlLessee = !identity.is_sold && !identity.is_adhoc && !input.lessee_override && Boolean(identity.canonical_lessee);
  const olLessee = deriveOlLessee ? identity.canonical_lessee : null;
  const dateSupplied = typeof input.rent_start_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.rent_start_date);
  const movedAt = effectiveDateToTimestamp(input.effective_date);
  const cars = await loadCars(input.car_ids);
  const planInputs: MovePlanCarInput[] = input.car_ids.map((id) => {
    const car = cars.get(id);
    if (!car) return { id, label: `#${id}`, found: false };
    return {
      id,
      label: car.label,
      found: true,
      active: car.active,
      status: car.status,
      fleet_status: car.fleet_status,
      from_rider_id: car.assignment?.rider_id ?? null,
      from_rider_name: car.assignment?.rider_name ?? null,
      from_fleet: car.assignment?.fleet_name ?? null,
      rent_start_date: car.assignment?.rent_start_date ?? null,
      rent_start_set_by: car.assignment?.rent_start_set_by ?? null,
      rent_start_set_at: car.assignment?.rent_start_set_at ?? null,
      assignment_id: car.assignment?.id ?? null,
    };
  });
  const plans = planMoveBatch(planInputs, {
    toRiderId: input.to_rider_id,
    toRiderName: identity.rider_name,
    olLessee,
    typedLessee,
    dateSupplied,
    suppliedDate: input.rent_start_date ?? null,
    actor,
    movedAt,
  });
  return { plans, cars, movedAt };
}

export async function previewMove(input: MoveCarsInput, actor: string) {
  const { plans } = await buildPlans(input, actor);
  const movable = plans.filter((row) => row.disposition === "move").length;
  return {
    ok: true,
    actor,
    total: plans.length,
    movable,
    left_alone: plans.length - movable,
    cars: plans,
  };
}

export async function applyMove(input: MoveCarsInput, actor: string) {
  const { plans, cars, movedAt } = await buildPlans(input, actor);
  const identity = await loadOlIdentity(input.to_rider_id);
  if (!identity) throw httpError(400, "Destination rider not found");
  if (allRequestedCarsInactive(plans)) {
    throw httpError(409, FROZEN_CAR_MESSAGE);
  }
  const moving = plans.filter((row) => row.disposition === "move" && row.assignment);
  return withChangeGroupResult(actor, async () => {
    const historyRows: Record<string, unknown>[] = [];
    for (const plan of moving) {
      const car = cars.get(plan.railcar_id);
      const write = plan.assignment;
      if (!car || !write) continue;
      const assignAfter = {
        rider_id: input.to_rider_id,
        fleet_name: write.to_fleet,
        assigned_at: movedAt,
        rent_start_date: write.rent_start_date,
        rent_start_set_by: write.rent_start_set_by,
        rent_start_set_at: write.rent_start_set_at,
      };
      const histReason = write.prior_date_note
        ? [input.reason ?? null, `prior rent_start_date ${write.prior_date_note}`].filter(Boolean).join("; ")
        : input.reason ?? null;
      let assignmentId = write.assignment_id;
      const prev = car.assignment;
      if (prev && assignmentId) {
        const { error } = await supabaseAdmin.from("railcar_assignments").update(assignAfter).eq("id", assignmentId);
        if (error) throw error;
        await pointCurrentAssignmentAt(supabaseAdmin, [{ id: assignmentId, railcar_id: car.id }]);
        await recordChange({
          table: "railcar_assignments",
          pk: assignmentId,
          before: pickRow(prev as unknown as Record<string, unknown>, ["rider_id", "fleet_name", "rent_start_date", "rent_start_set_by", "rent_start_set_at"]),
          after: assignAfter,
          action: "reassignment",
          entity_type: "railcar",
          entity_id: car.id,
          railcar_id: car.id,
          rider_id: input.to_rider_id,
          actor,
          detail: {
            from_rider_id: write.from_rider_id,
            to_rider_id: input.to_rider_id,
            from_fleet: write.from_fleet,
            to_fleet: write.to_fleet,
            reason: histReason,
          },
          occurred_at: movedAt,
        });
      } else {
        const { data: inserted, error } = await supabaseAdmin
          .from("railcar_assignments")
          .insert({ railcar_id: car.id, ...assignAfter })
          .select("id")
          .single();
        if (error) throw error;
        assignmentId = Number(inserted.id);
        await pointCurrentAssignmentAt(supabaseAdmin, [{ id: assignmentId, railcar_id: car.id }]);
        await recordChange({
          table: "railcar_assignments",
          pk: assignmentId,
          before: {},
          after: { railcar_id: car.id, ...assignAfter },
          action: "reassignment",
          entity_type: "railcar",
          entity_id: car.id,
          railcar_id: car.id,
          rider_id: input.to_rider_id,
          actor,
          detail: {
            from_rider_id: write.from_rider_id,
            to_rider_id: input.to_rider_id,
            from_fleet: write.from_fleet,
            to_fleet: write.to_fleet,
            reason: histReason,
          },
          occurred_at: movedAt,
        });
      }

      const carPatch = railcarIdentityPatch(identity, write.to_fleet);
      const identKeys = Object.keys(carPatch);
      const { error: carErr } = await supabaseAdmin.from("railcars").update(carPatch).eq("id", car.id);
      if (carErr) throw carErr;
      const nextPointer = assignmentId != null ? String(assignmentId) : null;
      const carRecord = car as unknown as Record<string, unknown>;
      await recordChange({
        table: "railcars",
        pk: car.id,
        before: withCurrentAssignmentPointer(pickRow(carRecord, identKeys), car.current_assignment_id),
        after: withCurrentAssignmentPointer(pickRow({ ...carRecord, ...carPatch }, identKeys), nextPointer),
        action: "reassignment",
        entity_type: "railcar",
        entity_id: car.id,
        railcar_id: car.id,
        rider_id: input.to_rider_id,
        actor,
        occurred_at: movedAt,
      });
      historyRows.push({
        railcar_id: car.id,
        from_rider_id: write.from_rider_id,
        to_rider_id: input.to_rider_id,
        from_fleet_name: write.from_fleet,
        to_fleet_name: write.to_fleet,
        moved_at: movedAt,
        moved_by: actor,
        reason: histReason,
      });
    }

    if (historyRows.length) {
      const { data: insertedHist, error } = await supabaseAdmin
        .from("assignment_history")
        .insert(historyRows)
        .select("id, railcar_id, from_rider_id, to_rider_id, from_fleet_name, to_fleet_name, moved_at, moved_by, reason");
      if (error) throw error;
      for (const row of insertedHist ?? []) {
        const capture = moveHistoryCapture(row);
        await recordChange({
          table: capture.table,
          pk: Number(row.id),
          before: capture.before,
          after: capture.after,
          action: "reassignment",
          entity_type: "railcar",
          entity_id: Number(row.railcar_id),
          railcar_id: Number(row.railcar_id),
          rider_id: row.to_rider_id == null ? null : Number(row.to_rider_id),
          actor,
          detail: {
            from_rider_id: row.from_rider_id,
            to_rider_id: row.to_rider_id,
            from_fleet: row.from_fleet_name,
            to_fleet: row.to_fleet_name,
            reason: row.reason,
          },
          occurred_at: row.moved_at,
          source_table: "assignment_history",
          source_id: Number(row.id),
        });
      }
    }

    const leftAlone = plans.filter((row) => row.disposition === "left_alone");
    return {
      ok: true as const,
      moved: historyRows.length,
      total: plans.length,
      left_alone: leftAlone,
      actor,
      cars: plans,
    };
  });
}
