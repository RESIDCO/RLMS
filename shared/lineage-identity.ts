/**
 * Lineage car query. Tokenizes on whitespace as well as commas, newlines, and
 * semicolons, then pairs a mark with the following number. The shared
 * splitCarNumber helper removes every space, which glues "OFOX 310100 OFOX 310110"
 * into one false car. Search and the other callers keep that helper.
 */

import { splitCarNumber } from "./residco-import";

/** Same fan-out cap as the bare-number lookup in the activity resolver. */
export const LINEAGE_CAR_CAP = 80;

export const LINEAGE_TOO_MANY_MESSAGE = "Too many cars, narrow it.";

export type LineageCarRow = {
  id: number;
  car_number?: string | null;
  reporting_marks?: string | null;
  car_initial?: string | null;
};

export type LineageHistoryRow = {
  railcar_id: number;
  old_car_initial?: string | null;
  old_car_number?: string | null;
  new_car_initial?: string | null;
  new_car_number?: string | null;
};

export type LineageIdentity =
  | { kind: "car"; mark: string | null; number: string }
  | { kind: "range"; mark: string | null; numbers: string[] }
  | { kind: "number"; number: string }
  | { kind: "mark"; mark: string };

export type LineageQueryPlan = {
  identities: LineageIdentity[];
  message: string | null;
};

export type LineageIdentityResult = {
  ids: number[];
  message: string | null;
};

type TokenShape =
  | { type: "mark"; mark: string }
  | { type: "number"; number: string }
  | { type: "range"; mark: string | null; from: string; to: string }
  | { type: "car"; mark: string; number: string }
  | { type: "dash" }
  | { type: "skip" };

function setValues<T>(values: Set<T>): T[] {
  const out: T[] = [];
  values.forEach((value) => out.push(value));
  return out;
}

export function lineageNumberVariants(n: string): string[] {
  const out = new Set<string>();
  const raw = String(n ?? "").trim();
  if (!raw) return [];
  out.add(raw);
  const stripped = raw.replace(/^0+/, "") || "0";
  out.add(stripped);
  if (/^\d+$/.test(stripped)) out.add(stripped.padStart(6, "0"));
  return setValues(out);
}

function normalizeToken(token: string): string {
  return token.trim().toUpperCase().replace(/^0(?=[A-Z])/, "O");
}

function tokenShape(token: string): TokenShape {
  if (token === "-" || token === "–" || token === "—") return { type: "dash" };
  const numeric = /^(\d+)-(\d+)$/.exec(token);
  if (numeric) return { type: "range", mark: null, from: numeric[1], to: numeric[2] };
  const marked = /^([A-Z]+)(\d+)-(\d+)$/.exec(token);
  if (marked) return { type: "range", mark: marked[1], from: marked[2], to: marked[3] };
  const split = splitCarNumber(token);
  if (split.reporting_marks && /^\d+$/.test(split.car_number)) {
    return { type: "car", mark: split.reporting_marks, number: split.car_number };
  }
  if (split.reporting_marks && !split.car_number) return { type: "mark", mark: split.reporting_marks };
  if (!split.reporting_marks && /^\d+$/.test(split.car_number)) {
    return { type: "number", number: split.car_number };
  }
  return { type: "skip" };
}

function expandRange(from: string, to: string): string[] | null {
  if (!/^\d+$/.test(from) || !/^\d+$/.test(to)) return null;
  const start = Number(from);
  const end = Number(to);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  const count = high - low + 1;
  if (!Number.isSafeInteger(count) || count > LINEAGE_CAR_CAP) return null;
  const numbers: string[] = [];
  for (let n = low; n <= high; n += 1) numbers.push(String(n));
  return numbers;
}

export function parseLineageQuery(raw: string): LineageQueryPlan {
  const tokens = String(raw ?? "")
    .split(/[\s,;\n\r]+/)
    .map(normalizeToken)
    .filter(Boolean);
  const identities: LineageIdentity[] = [];
  let ranged = 0;

  const takeRange = (mark: string | null, from: string, to: string): boolean => {
    const numbers = expandRange(from, to);
    if (!numbers || ranged + numbers.length > LINEAGE_CAR_CAP) return false;
    ranged += numbers.length;
    identities.push({ kind: "range", mark, numbers });
    return true;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const shape = tokenShape(tokens[i] ?? "");
    const next = i + 1 < tokens.length ? tokenShape(tokens[i + 1] ?? "") : null;
    switch (shape.type) {
      case "dash":
      case "skip":
        break;
      case "mark": {
        if (next?.type === "number") {
          const third = i + 2 < tokens.length ? tokenShape(tokens[i + 2] ?? "") : null;
          const fourth = i + 3 < tokens.length ? tokenShape(tokens[i + 3] ?? "") : null;
          if (third?.type === "dash" && fourth?.type === "number") {
            if (!takeRange(shape.mark, next.number, fourth.number)) {
              return { identities: [], message: LINEAGE_TOO_MANY_MESSAGE };
            }
            i += 3;
            break;
          }
          identities.push({ kind: "car", mark: shape.mark, number: next.number });
          i += 1;
          break;
        }
        if (next?.type === "range") {
          if (!takeRange(shape.mark, next.from, next.to)) {
            return { identities: [], message: LINEAGE_TOO_MANY_MESSAGE };
          }
          i += 1;
          break;
        }
        identities.push({ kind: "mark", mark: shape.mark });
        break;
      }
      case "number": {
        const third = i + 2 < tokens.length ? tokenShape(tokens[i + 2] ?? "") : null;
        if (next?.type === "dash" && third?.type === "number") {
          if (!takeRange(null, shape.number, third.number)) {
            return { identities: [], message: LINEAGE_TOO_MANY_MESSAGE };
          }
          i += 2;
          break;
        }
        identities.push({ kind: "number", number: shape.number });
        break;
      }
      case "range":
        if (!takeRange(shape.mark, shape.from, shape.to)) {
          return { identities: [], message: LINEAGE_TOO_MANY_MESSAGE };
        }
        break;
      case "car":
        identities.push({ kind: "car", mark: shape.mark, number: shape.number });
        break;
      default: {
        const _never: never = shape;
        return _never;
      }
    }
  }

  return { identities, message: null };
}

export function lineageLookupNumbers(plan: LineageQueryPlan): { exact: string[]; loose: string[] } {
  const exact: string[] = [];
  const loose: string[] = [];
  if (plan.message) return { exact, loose };
  for (const item of plan.identities) {
    switch (item.kind) {
      case "car":
        exact.push(item.number);
        break;
      case "range":
        exact.push(...item.numbers);
        break;
      case "number":
        exact.push(item.number);
        loose.push(item.number);
        break;
      case "mark":
        break;
      default: {
        const _never: never = item;
        return _never;
      }
    }
  }
  return { exact, loose };
}

export function lineageLookupMarks(plan: LineageQueryPlan): string[] {
  if (plan.message) return [];
  const marks: string[] = [];
  for (const item of plan.identities) {
    switch (item.kind) {
      case "mark":
        marks.push(item.mark);
        break;
      case "car":
      case "range":
      case "number":
        break;
      default: {
        const _never: never = item;
        return _never;
      }
    }
  }
  return marks;
}

function markOf(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

function numberHit(stored: string | null | undefined, wanted: string, loose: boolean): boolean {
  const raw = String(stored ?? "").trim();
  if (!raw) return false;
  if (lineageNumberVariants(wanted).includes(raw)) return true;
  return loose && raw.includes(wanted);
}

function carHit(car: LineageCarRow, mark: string | null, number: string, loose: boolean): boolean {
  if (!numberHit(car.car_number, number, loose)) return false;
  if (!mark) return true;
  return markOf(car.reporting_marks) === mark || markOf(car.car_initial) === mark;
}

function historyNumberHit(row: LineageHistoryRow, number: string, loose: boolean): boolean {
  return numberHit(row.old_car_number, number, loose) || numberHit(row.new_car_number, number, loose);
}

function historyMarkHit(row: LineageHistoryRow, mark: string | null): boolean {
  if (!mark) return true;
  return markOf(row.old_car_initial) === mark || markOf(row.new_car_initial) === mark;
}

function addId(into: Set<number>, id: number): void {
  if (Number.isFinite(id) && id > 0) into.add(id);
}

function collectNumber(
  cars: readonly LineageCarRow[],
  history: readonly LineageHistoryRow[],
  mark: string | null,
  number: string,
  loose: boolean,
  into: Set<number>,
): void {
  for (const car of cars) {
    if (carHit(car, mark, number, loose)) addId(into, Number(car.id));
  }
  for (const row of history) {
    if (!historyNumberHit(row, number, loose) || !historyMarkHit(row, mark)) continue;
    addId(into, Number(row.railcar_id));
  }
}

function collectMark(history: readonly LineageHistoryRow[], mark: string): Set<number> {
  const ids = new Set<number>();
  for (const row of history) {
    if (!historyMarkHit(row, mark)) continue;
    addId(ids, Number(row.railcar_id));
  }
  return ids;
}

export function resolveLineageIdentities(
  raw: string,
  cars: readonly LineageCarRow[],
  history: readonly LineageHistoryRow[],
): LineageIdentityResult {
  const plan = parseLineageQuery(raw);
  if (plan.message) return { ids: [], message: plan.message };
  const ids = new Set<number>();
  const ranged = new Set<number>();
  for (const item of plan.identities) {
    switch (item.kind) {
      case "car":
        collectNumber(cars, history, item.mark, item.number, false, ids);
        break;
      case "number":
        collectNumber(cars, history, null, item.number, true, ids);
        break;
      case "range": {
        const found = new Set<number>();
        for (const number of item.numbers) collectNumber(cars, history, item.mark, number, false, found);
        const union = new Set<number>();
        ranged.forEach((id) => union.add(id));
        found.forEach((id) => union.add(id));
        if (found.size > LINEAGE_CAR_CAP || union.size > LINEAGE_CAR_CAP) {
          return { ids: [], message: LINEAGE_TOO_MANY_MESSAGE };
        }
        found.forEach((id) => {
          ids.add(id);
          ranged.add(id);
        });
        break;
      }
      case "mark": {
        const found = collectMark(history, item.mark);
        if (found.size > LINEAGE_CAR_CAP) return { ids: [], message: LINEAGE_TOO_MANY_MESSAGE };
        found.forEach((id) => ids.add(id));
        break;
      }
      default: {
        const _never: never = item;
        return _never;
      }
    }
  }
  return { ids: setValues(ids).sort((a, b) => a - b), message: null };
}
