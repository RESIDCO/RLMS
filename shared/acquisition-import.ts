/**
 * New Acquisitions bulk loader — parse the 5-column template and classify rows.
 * Insert-only: existing (marks + number) cars are skipped, never updated.
 */

import { splitCarNumber } from "./residco-import";
import { parseFleetStatus, type FleetStatus } from "./fleet-status";

export const ACQUISITION_TEMPLATE_HEADERS = [
  "Marks",
  "Car Number",
  "Car Type",
  "Purchase Price ($)",
  "Notes",
] as const;

export type AcquisitionSkipReason = "missing_identity" | "already_exists" | "duplicate_in_file";

export type AcquisitionParsedRow = {
  row: number;
  marks: string;
  car_number: string;
  car_type: string | null;
  purchase_price: number | null;
  notes: string | null;
  skip_reason: AcquisitionSkipReason | null;
};

const ENTITY_MAP: Record<string, string> = {
  main: "Main",
  rps: "Rail Partners Select",
  "rail partners select": "Rail Partners Select",
  coal: "Coal",
};

export function parseAcquisitionEntity(raw: string): string | null {
  const key = String(raw ?? "").trim().toLowerCase();
  return ENTITY_MAP[key] ?? null;
}

export function parseAcquisitionPrice(raw: unknown): number | null {
  const s = String(raw ?? "").replace(/[$,\s]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normHeader(h: string) {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cell(row: Record<string, string>, aliases: string[]): string {
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) map[normHeader(k)] = v;
  for (const a of aliases) {
    const v = map[normHeader(a)];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

export function carIdentityKey(marks: string | null | undefined, num: string | null | undefined): string {
  return `${String(marks ?? "").trim().toUpperCase()}|${String(num ?? "").trim().toUpperCase()}`;
}

/** Keys that should collide with an existing railcars row (marks + number, never number-only). */
export function existingCarKeys(r: {
  reporting_marks?: string | null;
  car_initial?: string | null;
  car_number?: string | null;
}): string[] {
  const marks = String(r.reporting_marks ?? "").trim().toUpperCase();
  const initial = String(r.car_initial ?? "").trim().toUpperCase();
  const num = String(r.car_number ?? "").trim().toUpperCase();
  const keys = new Set<string>();
  if (!num) return [];
  if (marks) keys.add(carIdentityKey(marks, num));
  if (initial) keys.add(carIdentityKey(initial, num));
  const split = splitCarNumber(num);
  if (split.reporting_marks && split.car_number) {
    keys.add(carIdentityKey(split.reporting_marks, split.car_number));
    const owner = marks || initial || split.reporting_marks;
    keys.add(carIdentityKey(owner, split.car_number));
  }
  const owner = marks || initial;
  if (owner && !num.startsWith(owner)) {
    keys.add(carIdentityKey(owner, `${owner}${num}`));
  }
  return Array.from(keys);
}

export function buildExistingCarKeySet(
  cars: Array<{ reporting_marks?: string | null; car_initial?: string | null; car_number?: string | null }>,
): Set<string> {
  const set = new Set<string>();
  for (const c of cars) {
    for (const k of existingCarKeys(c)) set.add(k);
  }
  return set;
}

export function skipReasonLabel(reason: AcquisitionSkipReason | null): string {
  if (reason === "already_exists") return "Already exists — skipped.";
  if (reason === "duplicate_in_file") return "Duplicate in this file — skipped.";
  if (reason === "missing_identity") return "Missing Marks or Car Number.";
  return "";
}

export function parseAcquisitionRow(row: Record<string, string>, rowNum: number): AcquisitionParsedRow {
  const marksRaw = cell(row, ["Marks", "Reporting Marks", "Car Initial"]).toUpperCase();
  const numRaw = cell(row, ["Car Number", "Number"]);
  const splitFromNum = splitCarNumber(numRaw);
  const splitFromBoth = splitCarNumber(`${marksRaw}${numRaw}`.trim());
  const marks = marksRaw || splitFromNum.reporting_marks || splitFromBoth.reporting_marks || "";
  let carNumber = "";
  if (splitFromNum.reporting_marks && splitFromNum.car_number) {
    carNumber = splitFromNum.car_number;
  } else if (marksRaw && splitFromNum.car_number) {
    carNumber = splitFromNum.car_number;
  } else if (splitFromBoth.car_number) {
    carNumber = splitFromBoth.car_number;
  } else {
    carNumber = numRaw.trim().toUpperCase();
  }

  const carType = cell(row, ["Car Type", "Type"]) || null;
  const price = parseAcquisitionPrice(cell(row, ["Purchase Price ($)", "Purchase Price", "Price"]));
  const notes = cell(row, ["Notes", "Comment", "Comment / Event Note"]) || null;

  const skip_reason: AcquisitionSkipReason | null =
    !marks || !carNumber ? "missing_identity" : null;

  return {
    row: rowNum,
    marks,
    car_number: carNumber,
    car_type: carType,
    purchase_price: price,
    notes,
    skip_reason,
  };
}

export function classifyAcquisitionRows(
  rows: Record<string, string>[],
  existingKeySet: Set<string>,
): AcquisitionParsedRow[] {
  const seenInFile = new Set<string>();
  return rows.map((raw, i) => {
    const parsed = parseAcquisitionRow(raw, i + 2); // 1-based + header
    if (parsed.skip_reason) return parsed;
    const key = carIdentityKey(parsed.marks, parsed.car_number);
    const altKeys = existingCarKeys({
      reporting_marks: parsed.marks,
      car_initial: parsed.marks,
      car_number: parsed.car_number,
    });
    if (altKeys.some((k) => existingKeySet.has(k)) || existingKeySet.has(key)) {
      return { ...parsed, skip_reason: "already_exists" };
    }
    if (seenInFile.has(key)) {
      return { ...parsed, skip_reason: "duplicate_in_file" };
    }
    seenInFile.add(key);
    return parsed;
  });
}

export function resolveBatchRentalStatus(raw: unknown): FleetStatus {
  return parseFleetStatus(raw) ?? "Idle";
}
