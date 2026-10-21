import {
  decidePastedCar,
  parseCarPasteList,
  type PasteCarCandidate,
  type PasteHitDecision,
} from "./programs";
import { splitCarNumber } from "./residco-import";

/**
 * A car already on a KPI list. Matching is read-only: it does not write,
 * preview, or apply.
 */
export type AwaitingPasteCar = {
  railcar_id: number;
  car?: string | null;
  reporting_marks?: string | null;
  car_initial?: string | null;
  car_number?: string | null;
  active?: boolean | null;
};

export type AwaitingPasteMatch = {
  /** Unique canonical tokens, first-seen order. Duplicates are collapsed. */
  tokens: string[];
  /** Cars on the list that the paste matched, in list order. */
  matchedIds: number[];
  /** Pasted cars that are not on the list. Duplicates are already collapsed. */
  unmatched: string[];
};

function toCandidate(row: AwaitingPasteCar): PasteCarCandidate | null {
  const id = Number(row.railcar_id);
  if (!Number.isFinite(id) || id <= 0) return null;
  let marks = String(row.reporting_marks ?? "").trim();
  let initial = String(row.car_initial ?? "").trim();
  let number = String(row.car_number ?? "").trim();
  if ((!marks && !initial) || !number) {
    const split = splitCarNumber(row.car ?? "");
    if (!marks && !initial) {
      marks = split.reporting_marks ?? "";
      initial = split.car_initial ?? "";
    }
    if (!number) number = split.car_number;
  }
  return {
    id,
    reporting_marks: marks || null,
    car_initial: initial || marks || null,
    car_number: number || null,
    active: row.active !== false,
  };
}

function idsFromDecision(decision: PasteHitDecision): number[] {
  switch (decision.kind) {
    case "none":
      return [];
    case "match":
      return [decision.car.id];
    case "ambiguous":
      return decision.matches.map((car) => car.id);
    default: {
      const unreachable: never = decision;
      throw new Error(`Unhandled paste decision ${String(unreachable)}`);
    }
  }
}

/**
 * Match a pasted car list against cars already loaded for a KPI drill-down.
 * Parsing and leading-zero identity are the same helpers Search and Bulk Rent
 * Start use (`parseCarPasteList`, `decidePastedCar`). A token that hits no car
 * on the list is unmatched. Every car on the list that a token hits is selected.
 */
export function matchPastedCarsOnList(
  raw: string,
  cars: readonly AwaitingPasteCar[],
): AwaitingPasteMatch {
  const tokens = parseCarPasteList(raw);
  const candidates: PasteCarCandidate[] = [];
  for (const row of cars) {
    const candidate = toCandidate(row);
    if (candidate) candidates.push(candidate);
  }
  const matched = new Set<number>();
  const unmatched: string[] = [];
  for (const token of tokens) {
    const split = splitCarNumber(token);
    const decision = decidePastedCar({
      marks: split.reporting_marks,
      number: split.car_number,
      cars: candidates,
    });
    const ids = idsFromDecision(decision);
    if (!ids.length) {
      unmatched.push(token);
      continue;
    }
    for (const id of ids) matched.add(id);
  }
  const matchedIds = cars
    .map((row) => Number(row.railcar_id))
    .filter((id) => matched.has(id));
  return { tokens, matchedIds, unmatched };
}

/** Summary shown after a paste is applied. */
export function awaitingPasteSummary(matched: number, selected: number): string {
  if (matched === selected) return `${matched} matched and selected`;
  return `${matched} matched · ${selected} selected`;
}

/** One unmatched car per line, for the copy button. */
export function formatUnmatchedPasteList(unmatched: readonly string[]): string {
  return unmatched.join("\n");
}
