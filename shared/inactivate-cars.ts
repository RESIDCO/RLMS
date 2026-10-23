/**
 * Bulk Inactivate preview. Inactive is the only status that sets active=false.
 * Blockers are shown per car. Apply is ready-only or every row, with a reason
 * and a typed INACTIVATE confirmation. This module does not write.
 *
 * Open Off rent stops are the permanent off-rent record. When the assignment
 * is closed, those stops stay open and their stop dates are not replaced by
 * the inactivation date. The date entered in the dialog is only the assignment
 * end / inactive-as-of date. It must be on or after every Off rent stop date.
 * A car is ready on stops only when every open stop is Off rent. Abatement or
 * any other stop type blocks, and the preview lists each open stop. Open
 * programs and commitments still block.
 */

import { isFrozenRailcar } from "./car-lifecycle-status";
import {
  CAR_EXPORT_MARK_HEADER,
  CAR_EXPORT_NUMBER_HEADER,
  carIdentityCells,
  csvCarNumberField,
  csvField,
} from "./car-export-identity";

export const INACTIVATE_CONFIRM = "INACTIVATE";
export const INACTIVATE_BATCH_MAX = 500;

export type InactivateBlockerKind =
  | "already_inactive"
  | "open_assignment"
  | "open_rent_stop"
  | "inactivation_before_off_rent"
  | "open_program"
  | "open_commitment";

/** Stored car_rent_stops.type for a permanent off-rent record. */
export const OFF_RENT_STOP_TYPE = "Off rent";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type InactivateRentStop = { type: string; stop_date: string };

export function isOffRentStop(type: string): boolean {
  return type.trim() === OFF_RENT_STOP_TYPE;
}

/** Every open row. Callers must not keep only the first stop for a car. */
export function collectOpenRentStops(
  rows: { railcar_id: number; type: string | null; stop_date: string | null }[],
): Map<number, InactivateRentStop[]> {
  const byCar = new Map<number, InactivateRentStop[]>();
  for (const row of rows) {
    const id = Number(row.railcar_id);
    const list = byCar.get(id) ?? [];
    list.push({
      type: String(row.type ?? "Rent stop"),
      stop_date: String(row.stop_date ?? "").slice(0, 10),
    });
    byCar.set(id, list);
  }
  return byCar;
}

function orderedRentStops(stops: InactivateRentStop[]): InactivateRentStop[] {
  return [...stops].sort((a, b) => {
    const byDate = a.stop_date.localeCompare(b.stop_date);
    if (byDate !== 0) return byDate;
    return a.type.localeCompare(b.type);
  });
}

/**
 * Both dates belong in the preview. The stop date is the one already stored.
 * The end date is the separate inactivation / assignment end date.
 * A missing end date is named, not treated as the stop date.
 * An earlier end date warns and is not ready.
 */
export function offRentKeptNote(
  stopDate: string,
  endDate: string | null | undefined,
): { note: string; beforeOffRent: boolean } {
  const stop = String(stopDate ?? "").slice(0, 10);
  const end = String(endDate ?? "").slice(0, 10);
  const endLabel = ISO_DATE.test(end) ? end : "not entered";
  const beforeOffRent = ISO_DATE.test(stop) && ISO_DATE.test(end) && end < stop;
  const warning = beforeOffRent ? ". Inactivation date is before the off-rent date." : "";
  return {
    note: `Off rent since ${stop} (kept) · Inactive/assignment end ${endLabel}${warning}`,
    beforeOffRent,
  };
}

export type InactivateStatus = "ready" | "blocked" | "already_inactive";

export type InactivateAssignmentFact = {
  ol: string | null;
  label: string | null;
  last_active_on_ol: boolean;
  other_active_on_ol: number;
};

export type InactivateFacts = {
  id: number;
  reporting_marks: string | null;
  car_number: string | null;
  car_status: string | null;
  active: boolean | null;
  assignment: InactivateAssignmentFact | null;
  rent_stops: InactivateRentStop[];
  programs: string[];
  commitment: { type: string; name: string } | null;
};

export type InactivatePreviewRow = {
  id: number;
  car: string;
  status: InactivateStatus;
  message: string;
  blockers: InactivateBlockerKind[];
  active: boolean | null;
  car_status: string | null;
  assignment: InactivateAssignmentFact | null;
  rent_stop: string | null;
  programs: string[];
  commitment: string | null;
};

export type InactivatePreview = {
  rows: InactivatePreviewRow[];
  counts: Record<InactivateStatus, number> & { total: number; blockers: number };
  ready: InactivatePreviewRow[];
};

export function inactivateCarLabel(marks: string | null | undefined, number: string | null | undefined, id: number): string {
  const label = [marks, number].filter((part) => String(part ?? "").trim()).join(" ");
  return label || `#${id}`;
}

export function assignmentBlockerMessage(assignment: InactivateAssignmentFact, closeAssignment: boolean): string {
  const ol = assignment.ol ? `OL ${assignment.ol}` : "an open assignment";
  const last = assignment.last_active_on_ol
    ? ` This is the last active car on ${ol}.`
    : assignment.ol
      ? ` ${assignment.other_active_on_ol} other active car${assignment.other_active_on_ol === 1 ? "" : "s"} remain on ${ol}.`
      : "";
  if (closeAssignment) {
    return `Open assignment will be closed on the end date.${last}`;
  }
  return `Open assignment on ${ol}.${last}`;
}

export function classifyInactivateRow(
  fact: InactivateFacts,
  opts: { closeAssignment: boolean; endDate?: string | null },
): InactivatePreviewRow {
  const blockers: InactivateBlockerKind[] = [];
  const notes: string[] = [];
  const frozen = isFrozenRailcar({ active: fact.active, status: fact.car_status });
  if (frozen) {
    blockers.push("already_inactive");
    notes.push("Already inactive. Left unchanged.");
  }
  if (fact.assignment) {
    if (!opts.closeAssignment) blockers.push("open_assignment");
    notes.push(assignmentBlockerMessage(fact.assignment, opts.closeAssignment));
  }
  const stops = orderedRentStops(fact.rent_stops);
  if (stops.length) {
    const everyOffRent = stops.every((stop) => isOffRentStop(stop.type));
    if (opts.closeAssignment && everyOffRent) {
      let beforeOffRent = false;
      for (const stop of stops) {
        const kept = offRentKeptNote(stop.stop_date, opts.endDate);
        if (kept.beforeOffRent) beforeOffRent = true;
        notes.push(kept.note);
      }
      if (beforeOffRent) blockers.push("inactivation_before_off_rent");
    } else {
      blockers.push("open_rent_stop");
      for (const stop of stops) {
        notes.push(`Open rent stop (${stop.type} ${stop.stop_date}). Not closed.`);
      }
    }
  }
  if (fact.programs.length) {
    blockers.push("open_program");
    notes.push(`Open program: ${fact.programs.join(", ")}.`);
  }
  if (fact.commitment) {
    blockers.push("open_commitment");
    notes.push(`Open commitment: ${fact.commitment.type} ${fact.commitment.name}.`);
  }
  let status: InactivateStatus = "ready";
  if (blockers.includes("already_inactive")) status = "already_inactive";
  else if (blockers.length) status = "blocked";
  if (status === "ready" && !notes.length) notes.push("Ready to inactivate.");
  return {
    id: fact.id,
    car: inactivateCarLabel(fact.reporting_marks, fact.car_number, fact.id),
    status,
    message: notes.join(" "),
    blockers,
    active: fact.active,
    car_status: fact.car_status,
    assignment: fact.assignment,
    rent_stop: stops.length ? stops.map((stop) => `${stop.type} ${stop.stop_date}`).join("; ") : null,
    programs: fact.programs,
    commitment: fact.commitment ? `${fact.commitment.type} ${fact.commitment.name}` : null,
  };
}

export function summarizeInactivate(rows: InactivatePreviewRow[]): InactivatePreview {
  const counts: InactivatePreview["counts"] = {
    ready: 0,
    blocked: 0,
    already_inactive: 0,
    total: rows.length,
    blockers: 0,
  };
  const ready: InactivatePreviewRow[] = [];
  for (const row of rows) {
    counts[row.status] += 1;
    if (row.status === "ready") ready.push(row);
    else counts.blockers += 1;
  }
  return { rows, counts, ready };
}

export function chooseInactivateIds(
  preview: InactivatePreview,
  mode: "all" | "good",
): { ok: true; ids: number[] } | { ok: false; error: string } {
  if (mode === "good") {
    if (!preview.ready.length) return { ok: false, error: "No ready cars to inactivate" };
    return { ok: true, ids: preview.ready.map((row) => row.id) };
  }
  if (preview.counts.blockers > 0) {
    return {
      ok: false,
      error: "Every car must be ready, or apply ready rows only",
    };
  }
  if (!preview.ready.length) return { ok: false, error: "No ready cars to inactivate" };
  return { ok: true, ids: preview.ready.map((row) => row.id) };
}

export function inactivatePreviewToCsv(rows: InactivatePreviewRow[]): string {
  const header = [CAR_EXPORT_MARK_HEADER, CAR_EXPORT_NUMBER_HEADER, "Id", "Status", "Active", "Car status", "Assignment", "Rent stop", "Programs", "Commitment", "Check"];
  const lines = [header.map((cell) => csvField(cell)).join(",")];
  for (const row of rows) {
    const identity = carIdentityCells({ car: row.car });
    const cells = [
      identity.mark,
      identity.number,
      String(row.id),
      row.status,
      row.active == null ? "" : row.active ? "true" : "false",
      row.car_status ?? "",
      row.assignment?.ol ?? "",
      row.rent_stop ?? "",
      row.programs.join("; "),
      row.commitment ?? "",
      row.message,
    ];
    lines.push(cells.map((cell, index) => (index === 1 ? csvCarNumberField(cell) : csvField(cell))).join(","));
  }
  return lines.join("\n");
}

export function inactivateEndDateError(closeAssignment: boolean, endDate: string | null | undefined): string | null {
  if (!closeAssignment) return null;
  const day = String(endDate ?? "").slice(0, 10);
  if (!ISO_DATE.test(day)) return "Enter an assignment end date (YYYY-MM-DD)";
  return null;
}
