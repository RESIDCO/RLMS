/**
 * Prior-mark search. "KCS 310100" matches a car whose car_number_history
 * (or old_car_* columns) still records that identity, and the result can
 * show "formerly KCS 310100".
 */

import { splitCarNumber } from "./residco-import";
import { paddedCarNumber } from "./remark-in-place";

export type PriorIdentity = { mark: string; number: string };

export type PriorHistoryRow = {
  railcar_id: number;
  old_car_initial?: string | null;
  old_car_number?: string | null;
};

export function identitiesInSearch(raw: string): PriorIdentity[] {
  const groups = String(raw ?? "")
    .split(/[\n\r,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const out: PriorIdentity[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    const split = splitCarNumber(group);
    const number = paddedCarNumber(split.car_number);
    const mark = split.reporting_marks?.toUpperCase() ?? "";
    if (!mark || !number) continue;
    const key = `${mark}|${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ mark, number });
  }
  return out;
}

export function formerlyLabel(mark: string, number: string): string {
  return `formerly ${mark} ${number}`;
}

export function formerlyFromHistory<T extends { id: number; reporting_marks?: string | null; car_initial?: string | null; car_number?: string | null }>(
  rows: T[],
  wanted: PriorIdentity[],
  history: PriorHistoryRow[],
): Map<number, string> {
  const want = new Set(wanted.map((item) => `${item.mark}|${item.number}`));
  const labels = new Map<number, string>();
  if (!want.size) return labels;
  for (const row of history) {
    const mark = String(row.old_car_initial ?? "").trim().toUpperCase();
    const number = paddedCarNumber(row.old_car_number);
    if (!mark || !number) continue;
    if (!want.has(`${mark}|${number}`)) continue;
    const id = Number(row.railcar_id);
    const car = rows.find((item) => item.id === id);
    if (!car) continue;
    const current = String(car.car_initial || car.reporting_marks || "").trim().toUpperCase();
    if (current === mark && paddedCarNumber(car.car_number) === number) continue;
    if (!labels.has(id)) labels.set(id, formerlyLabel(mark, number));
  }
  return labels;
}
