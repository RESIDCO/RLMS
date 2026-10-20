import { isFrozenRailcar } from "./car-lifecycle-status";
import { assignmentRentStartOnMove, statusFromAssignmentLink } from "./commitment";
import { formatUsDate } from "./display-date";

export type MoveDisposition = "move" | "left_alone";
export type LeftAloneReason = "inactive" | "blocked";

export type MovePlanSide = {
  rider_id: number | null;
  rider_name: string | null;
  fleet_name: string | null;
  rent_start_date: string | null;
  status: string | null;
};

export type MovePlanCarInput = {
  id: number;
  label: string;
  found: boolean;
  blocked?: boolean;
  active?: boolean | null;
  status?: string | null;
  fleet_status?: string | null;
  from_rider_id?: number | null;
  from_rider_name?: string | null;
  from_fleet?: string | null;
  rent_start_date?: string | null;
  rent_start_set_by?: string | null;
  rent_start_set_at?: string | null;
  assignment_id?: number | null;
};

export type MovePlanOptions = {
  toRiderId: number;
  toRiderName: string;
  olLessee: string | null;
  typedLessee: string | null;
  dateSupplied: boolean;
  suppliedDate: string | null;
  actor: string;
  movedAt: string;
};

export type MoveAssignmentWrite = {
  from_rider_id: number | null;
  from_fleet: string | null;
  to_fleet: string | null;
  rent_start_date: string | null;
  rent_start_set_by: string | null;
  rent_start_set_at: string | null;
  prior_date_note: string | null;
  assignment_id: number | null;
};

export type MovePlanRow = {
  railcar_id: number;
  label: string;
  disposition: MoveDisposition;
  left_alone_reason: LeftAloneReason | null;
  before: MovePlanSide;
  after: MovePlanSide | null;
  rent_start_impact: string;
  status_impact: string;
  assignment: MoveAssignmentWrite | null;
};

/** The client "moved by" string is ignored. The signed-in user is the actor. */
export function moveActor(input: {
  email?: string | null;
  userId?: string | null;
  clientMovedBy?: string | null;
}): string {
  void input.clientMovedBy;
  const email = String(input.email ?? "").trim();
  if (email) return email;
  const userId = String(input.userId ?? "").trim();
  return userId || "system";
}

/** Ad Hoc riders are created only when the caller explicitly asks. */
export function resolveWillCreate(body: { create?: unknown } | null | undefined): boolean {
  return body?.create === true;
}

export function targetFleetName(
  fromFleet: string | null | undefined,
  olLessee: string | null | undefined,
  typedLessee: string | null | undefined,
): string | null {
  const ol = String(olLessee ?? "").trim();
  if (ol) return ol;
  const typed = String(typedLessee ?? "").trim();
  if (typed) return typed;
  const from = String(fromFleet ?? "").trim();
  return from || null;
}

export function withCurrentAssignmentPointer(
  patch: Record<string, unknown>,
  pointer: string | null,
): Record<string, unknown> {
  return { ...patch, current_assignment_id: pointer };
}

export function moveHistoryCapture(row: Record<string, unknown>): {
  table: "assignment_history";
  before: Record<string, unknown>;
  after: Record<string, unknown>;
} {
  return { table: "assignment_history", before: {}, after: { ...row } };
}

function sideStatus(input: {
  fleetStatus?: string | null;
  rider?: string | null;
  lessee?: string | null;
  rentStart?: string | null;
  hasAssignment: boolean;
}): string {
  const stored = String(input.fleetStatus ?? "").trim();
  if (stored) return stored;
  return statusFromAssignmentLink({
    hasAssignment: input.hasAssignment,
    rider: input.rider,
    lesseeName: input.lessee,
    rentStartDate: input.rentStart,
  });
}

function rentImpact(
  disposition: MoveDisposition,
  dateSupplied: boolean,
  sameRider: boolean,
  rentStart: string | null,
): string {
  if (disposition === "left_alone") return "left alone";
  if (dateSupplied) return `set to ${formatUsDate(rentStart) || rentStart || "—"}`;
  if (sameRider) return "kept";
  return "cleared";
}

function statusImpact(disposition: MoveDisposition, before: string, after: string | null): string {
  if (disposition === "left_alone" || after == null) return "left alone";
  if (before === after) return after;
  return `${before} → ${after}`;
}

export function planMoveCar(car: MovePlanCarInput, opts: MovePlanOptions): MovePlanRow {
  const beforeStatus = sideStatus({
    fleetStatus: car.fleet_status,
    rider: car.from_rider_name,
    lessee: car.from_fleet,
    rentStart: car.rent_start_date,
    hasAssignment: car.from_rider_id != null || Boolean(car.assignment_id),
  });
  const before: MovePlanSide = {
    rider_id: car.from_rider_id ?? null,
    rider_name: car.from_rider_name ?? null,
    fleet_name: car.from_fleet ?? null,
    rent_start_date: car.rent_start_date ?? null,
    status: beforeStatus,
  };
  const blocked = !car.found || car.blocked === true;
  const inactive = car.found && isFrozenRailcar({ active: car.active, status: car.status });
  const reason: LeftAloneReason | null = blocked ? "blocked" : inactive ? "inactive" : null;
  if (reason) {
    return {
      railcar_id: car.id,
      label: car.label,
      disposition: "left_alone",
      left_alone_reason: reason,
      before,
      after: null,
      rent_start_impact: "left alone",
      status_impact: "left alone",
      assignment: null,
    };
  }

  const toFleet = targetFleetName(car.from_fleet, opts.olLessee, opts.typedLessee);
  const rent = assignmentRentStartOnMove({
    fromRiderId: car.from_rider_id,
    toRiderId: opts.toRiderId,
    prevDate: car.rent_start_date,
    prevSetBy: car.rent_start_set_by,
    prevSetAt: car.rent_start_set_at,
    dateSupplied: opts.dateSupplied,
    suppliedDate: opts.suppliedDate,
    actor: opts.actor,
    movedAt: opts.movedAt,
  });
  const afterStatus = statusFromAssignmentLink({
    hasAssignment: true,
    rider: opts.toRiderName,
    lesseeName: toFleet,
    rentStartDate: rent.rent_start_date,
    fleetStatus: car.fleet_status,
  });
  const sameRider = car.from_rider_id != null && Number(car.from_rider_id) === Number(opts.toRiderId);
  const after: MovePlanSide = {
    rider_id: opts.toRiderId,
    rider_name: opts.toRiderName,
    fleet_name: toFleet,
    rent_start_date: rent.rent_start_date,
    status: afterStatus,
  };
  return {
    railcar_id: car.id,
    label: car.label,
    disposition: "move",
    left_alone_reason: null,
    before,
    after,
    rent_start_impact: rentImpact("move", opts.dateSupplied, sameRider, rent.rent_start_date),
    status_impact: statusImpact("move", beforeStatus, afterStatus),
    assignment: {
      from_rider_id: car.from_rider_id ?? null,
      from_fleet: car.from_fleet ?? null,
      to_fleet: toFleet,
      rent_start_date: rent.rent_start_date,
      rent_start_set_by: rent.rent_start_set_by,
      rent_start_set_at: rent.rent_start_set_at,
      prior_date_note: rent.priorDateNote,
      assignment_id: car.assignment_id ?? null,
    },
  };
}

export function planMoveBatch(cars: MovePlanCarInput[], opts: MovePlanOptions): MovePlanRow[] {
  return cars.map((car) => planMoveCar(car, opts));
}

/**
 * The old move endpoint rejected a frozen car with 409.
 * A batch that is entirely inactive does the same. A mix still moves the rest.
 */
export function allRequestedCarsInactive(
  plans: readonly { disposition: string; left_alone_reason: string | null }[],
): boolean {
  return plans.length > 0 && plans.every((row) => row.disposition === "left_alone" && row.left_alone_reason === "inactive");
}

/** Known inactive cars are not part of a move selection. Unknown ids stay for the server to judge. */
export function idsEligibleForMove(
  selectedIds: Iterable<number>,
  cars: ReadonlyArray<{ id: number; active?: boolean | null; status?: string | null }>,
): { ids: number[]; skippedInactive: number } {
  const byId = new Map(cars.map((car) => [Number(car.id), car]));
  const ids: number[] = [];
  const seen = new Set<number>();
  let skippedInactive = 0;
  for (const raw of Array.from(selectedIds)) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    const car = byId.get(id);
    if (car && isFrozenRailcar(car)) {
      skippedInactive += 1;
      continue;
    }
    ids.push(id);
  }
  return { ids, skippedInactive };
}
