import { splitCarNumber } from "./residco-import";

/** Rider/schedule codes (OL2345) are not a single car identifier. */
const RIDER_CODE = /^OL\d+$/i;

export type ExactCarIdentifier = {
  marks: string;
  number: string;
};

/**
 * True when the whole query is one reporting-mark + car-number identifier
 * (OFCX075192, OFCX 075192, OFCX-075192). Digit-only, lessee names, and OL
 * codes are not exact car identifiers.
 */
export function parseExactCarIdentifier(raw: string): ExactCarIdentifier | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const compact = trimmed.toUpperCase().replace(/[\s\-_]+/g, "");
  if (!compact || RIDER_CODE.test(compact)) return null;

  const split = splitCarNumber(trimmed);
  if (!split.reporting_marks || !split.car_number) return null;
  if (!/^\d+$/.test(split.car_number)) return null;
  if (split.reporting_marks.length < 2 || split.reporting_marks.length > 4) return null;
  if (compact !== `${split.reporting_marks}${split.car_number}`) return null;

  return { marks: split.reporting_marks, number: split.car_number };
}

export function carNumbersMatchIgnoringZeros(a: string, b: string): boolean {
  const da = String(a ?? "").replace(/\D/g, "");
  const db = String(b ?? "").replace(/\D/g, "");
  if (!da || !db) return false;
  const strip = (s: string) => s.replace(/^0+/, "") || "0";
  return strip(da) === strip(db);
}

/** Stored car_number spellings to try for one typed number (leading-zero variants). */
export function carNumberLookupVariants(number: string): string[] {
  const digits = String(number ?? "").replace(/\D/g, "");
  if (!digits) return [];
  const stripped = digits.replace(/^0+/, "") || "0";
  const out = new Set<string>([digits, stripped]);
  for (const len of [4, 5, 6, 7]) {
    if (stripped.length <= len) out.add(stripped.padStart(len, "0"));
  }
  return [...out];
}

export function compactCarNumberLookupVariants(marks: string, number: string): string[] {
  const m = String(marks ?? "").toUpperCase();
  return carNumberLookupVariants(number).map((n) => `${m}${n}`);
}

export function isExactCarRow(
  car: { reporting_marks?: string | null; car_number?: string | null },
  id: ExactCarIdentifier,
): boolean {
  const marks = String(car.reporting_marks ?? "").trim().toUpperCase();
  const rawNum = String(car.car_number ?? "").trim().toUpperCase().replace(/[\s\-_]+/g, "");
  if (marks === id.marks && carNumbersMatchIgnoringZeros(rawNum, id.number)) return true;
  const split = splitCarNumber(rawNum.startsWith(id.marks) ? rawNum : `${marks}${rawNum}`);
  return split.reporting_marks === id.marks && carNumbersMatchIgnoringZeros(split.car_number, id.number);
}
