/**
 * Bulk Inactivate preview. Inactive is the only status that sets active=false.
 * Blockers are shown per car. Apply is ready-only or every row, with a reason
 * and a typed INACTIVATE confirmation. This module does not write.
 */

import { isFrozenRailcar } from "./car-lifecycle-status";

export const INACTIVATE_CONFIRM = "INACTIVATE";
export const INACTIVATE_BATCH_MAX = 500;

export type InactivateBlockerKind =
  | "already_inactive"
  | "open_assignment"
  | "open_rent_stop"
  | "open_program"
  | "open_commitment";

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
  rent_stop: { type: string; stop_date: string } | null;
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
  opts: { closeAssignment: boolean },
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
  if (fact.rent_stop) {
    blockers.push("open_rent_stop");
    notes.push(`Open rent stop (${fact.rent_stop.type} ${fact.rent_stop.stop_date}). Not closed.`);
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
    rent_stop: fact.rent_stop ? `${fact.rent_stop.type} ${fact.rent_stop.stop_date}` : null,
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
  const header = ["Car", "Id", "Status", "Active", "Car status", "Assignment", "Rent stop", "Programs", "Commitment", "Check"];
  const lines = [header.join(",")];
  for (const row of rows) {
    const cells = [
      row.car,
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
    lines.push(cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","));
  }
  return lines.join("\n");
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function inactivateEndDateError(closeAssignment: boolean, endDate: string | null | undefined): string | null {
  if (!closeAssignment) return null;
  const day = String(endDate ?? "").slice(0, 10);
  if (!ISO_DATE.test(day)) return "Enter an assignment end date (YYYY-MM-DD)";
  return null;
}
