/**
 * §F lessee response window: N business days (Mon–Fri), skip owner holidays,
 * floor ≥72 hours. Configurable per tenant / entity. America/New_York calendar.
 */
import { DEFAULT_TENANT_ID, q } from "../db";

const ET = "America/New_York";
const DEFAULT_BUSINESS_DAYS = 3;
const DEFAULT_MIN_HOURS = 72;
const DAY_MS = 24 * 3600_000;

export type LesseeWindowConfig = {
  businessDays: number;
  minHours: number;
  holidays: string[]; // YYYY-MM-DD in ET
  entityCode: string | null;
};

function ymdInEt(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function weekdayInEt(d: Date): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
  }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

function isBusinessDayEt(d: Date, holidays: Set<string>): boolean {
  const wd = weekdayInEt(d);
  if (wd === 0 || wd === 6) return false;
  return !holidays.has(ymdInEt(d));
}

/**
 * Add N business days (Mon–Fri, skip holidays) from `from`.
 * Result is at least `minHours` after `from`.
 */
export function computeResponseDueAt(
  from: Date,
  businessDays: number,
  minHours: number,
  holidays: string[] = [],
): Date {
  const days = Math.max(1, Math.trunc(businessDays) || DEFAULT_BUSINESS_DAYS);
  const minMs =
    Math.max(DEFAULT_MIN_HOURS, Math.trunc(minHours) || DEFAULT_MIN_HOURS) *
    3600_000;
  const holidaySet = new Set(
    holidays.map((h) => String(h).trim().slice(0, 10)).filter(Boolean),
  );

  let cursor = new Date(from.getTime());
  let remaining = days;
  let guard = 0;
  while (remaining > 0 && guard < 400) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    if (isBusinessDayEt(cursor, holidaySet)) remaining -= 1;
    guard += 1;
  }

  const floor = new Date(from.getTime() + minMs);
  return cursor.getTime() >= floor.getTime() ? cursor : floor;
}

/** Link hard expiry = response due + 30 calendar days. */
export function computeLinkExpiresAt(responseDueAt: Date): Date {
  return new Date(responseDueAt.getTime() + 30 * DAY_MS);
}

export function formatDueEt(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

export async function loadLesseeWindowConfig(opts: {
  tenantId?: string;
  entityCode?: string | null;
}): Promise<LesseeWindowConfig> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(`SELECT settings FROM repair.tenants WHERE id = $1`, [
    tenantId,
  ]);
  const settings = (rows[0]?.settings as Record<string, unknown>) ?? {};
  const entityCode = opts.entityCode
    ? String(opts.entityCode).trim().toUpperCase()
    : null;

  let businessDays =
    Number(settings.lesseeResponseBusinessDays ?? DEFAULT_BUSINESS_DAYS) ||
    DEFAULT_BUSINESS_DAYS;
  let minHours =
    Number(settings.lesseeResponseMinHours ?? DEFAULT_MIN_HOURS) ||
    DEFAULT_MIN_HOURS;
  let holidays: string[] = Array.isArray(settings.ownerHolidays)
    ? (settings.ownerHolidays as unknown[]).map(String)
    : [];

  const byEntity = (settings.lesseeResponseByEntity ?? {}) as Record<
    string,
    { businessDays?: number; minHours?: number; holidays?: string[] }
  >;
  if (entityCode && byEntity[entityCode]) {
    const ov = byEntity[entityCode];
    if (ov.businessDays != null) {
      businessDays = Number(ov.businessDays) || businessDays;
    }
    if (ov.minHours != null) minHours = Number(ov.minHours) || minHours;
    if (Array.isArray(ov.holidays)) holidays = ov.holidays.map(String);
  }

  return {
    businessDays: Math.max(1, Math.trunc(businessDays)),
    minHours: Math.max(DEFAULT_MIN_HOURS, Math.trunc(minHours)),
    holidays,
    entityCode,
  };
}

/** Human phrase for email Description — "within N business days". */
export function responseWindowPhrase(businessDays: number): string {
  const n = Math.max(1, Math.trunc(businessDays) || DEFAULT_BUSINESS_DAYS);
  return n === 1 ? "1 business day" : `${n} business days`;
}
