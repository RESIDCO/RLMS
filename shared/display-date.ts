/**
 * One calendar format for the app: MM/DD/YYYY.
 * A value that includes a time is shown in Eastern Time and labeled ET.
 * A date-only value stays on that calendar day — it is not shifted through UTC.
 */

const EASTERN = "America/New_York";

type EtParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  dayPeriod: string;
};

function etParts(date: Date): EtParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    dayPeriod: get("dayPeriod"),
  };
}

function fromInstant(date: Date): string {
  const p = etParts(date);
  return `${p.month}/${p.day}/${p.year}`;
}

/** MM/DD/YYYY. Blank and unparseable values return "". */
export function formatUsDate(value: unknown): string {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return "";
    return fromInstant(value);
  }
  const s = String(value).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [year, month, day] = s.split("-");
    return `${month}/${day}/${year}`;
  }
  const date = new Date(s);
  if (!Number.isFinite(date.getTime())) return "";
  return fromInstant(date);
}

/** MM/DD/YYYY, plus h:mm AM/PM ET when the value has a time. Date-only stays date-only. */
export function formatUsDateTimeEt(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return formatUsDate(value);
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "";
  const p = etParts(date);
  const clock = `${p.hour}:${p.minute} ${p.dayPeriod}`.replace(/\s+/g, " ").trim();
  return `${p.month}/${p.day}/${p.year} ${clock} ET`;
}

export function hasClockTime(value: unknown): boolean {
  if (value instanceof Date) return true;
  const s = String(value ?? "").trim();
  if (!s || /^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return Number.isFinite(new Date(s).getTime());
}
