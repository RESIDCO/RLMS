/**
 * Program-grid dates. Display is MM/DD/YYYY (month-only values MM/YYYY).
 * Stored values are ISO calendar dates, parsed from the text so a timezone
 * cannot move the day.
 */

export type ProgramDateValue = { iso: string; monthOnly: boolean };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function fullDate(year: number, month: number, day: number): ProgramDateValue | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { iso: `${year}-${pad2(month)}-${pad2(day)}`, monthOnly: false };
}

function monthDate(year: number, month: number): ProgramDateValue | null {
  if (month < 1 || month > 12 || year < 1000 || year > 9999) return null;
  return { iso: `${year}-${pad2(month)}`, monthOnly: true };
}

function expandYear(year: number): number {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

/** MM/DD/YY, MM/DD/YYYY, YYYY-MM-DD, or a month-only MM/YYYY / YYYY-MM. */
export function parseProgramDate(raw: unknown): ProgramDateValue | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return fullDate(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
  }
  const s = String(raw).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) return fullDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const isoMonth = s.match(/^(\d{4})-(\d{2})$/);
  if (isoMonth) return monthDate(Number(isoMonth[1]), Number(isoMonth[2]));
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (mdy) return fullDate(expandYear(Number(mdy[3])), Number(mdy[1]), Number(mdy[2]));
  const my = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (my) return monthDate(Number(my[2]), Number(my[1]));
  return null;
}

/** Blank stays blank. Full dates are MM/DD/YYYY. Month-only values are MM/YYYY. */
export function formatProgramDate(value: unknown): string {
  if (value == null || value === "") return "";
  const parsed = parseProgramDate(value);
  if (!parsed) return String(value);
  if (parsed.monthOnly) {
    const [year, month] = parsed.iso.split("-");
    return `${month}/${year}`;
  }
  const [year, month, day] = parsed.iso.split("-");
  return `${month}/${day}/${year}`;
}

/** Empty clears the cell. Invalid text returns undefined so the stored value stays. */
export function parseProgramDateInput(raw: string): string | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  const parsed = parseProgramDate(s);
  return parsed ? parsed.iso : undefined;
}
