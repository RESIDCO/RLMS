/**
 * Lease-status authority: railcars fields written by monthly VCF import.
 *
 * riders.expiration_date is NOT authoritative — historically seeded and often
 * years stale. Prefer railcars.lease_end_date / lease_expiry / lessee_name /
 * rider_external_id for any "is this lease current / who is the lessee / which OL"
 * question. riders.expiration_date may be refreshed as a derived cache for
 * Lease Management UI, but Dashboard and lease-status KPIs must read cars.
 */

import { isIndefiniteEndDate } from "./vcf-import";

function genuineEndDate(iso: string): string | null {
  const s = String(iso ?? "").trim().slice(0, 10);
  if (!s || isIndefiniteEndDate(s)) return null;
  return s;
}

export type CarLeaseFields = {
  lease_end_date?: string | null;
  lease_expiry?: string | null;
  lease_start_date?: string | null;
  lessee_name?: string | null;
  rider_external_id?: string | null;
  assignment_label?: string | null;
};

/** Canonical known end date from the car record (null = indefinite / unknown). */
export function carLeaseEndDate(car: CarLeaseFields): string | null {
  return genuineEndDate(car.lease_end_date ?? "") || genuineEndDate(car.lease_expiry ?? "");
}

export function carLesseeName(car: CarLeaseFields): string | null {
  const name = String(car.lessee_name ?? "").trim();
  return name || null;
}

export function carOlCode(car: CarLeaseFields): string | null {
  const ol = String(car.rider_external_id ?? "").trim();
  if (!ol) return null;
  if (ol.toUpperCase() === "SOLD") return null;
  return ol;
}

export function parseIsoDateOnly(d: string | null | undefined): Date | null {
  if (!d) return null;
  const s = String(d).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const dt = new Date(`${s}T12:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function addCalendarMonths(iso: string, months: number): string | null {
  const d = parseIsoDateOnly(iso);
  if (!d) return null;
  d.setMonth(d.getMonth() + months);
  return formatIsoDateOnly(d);
}

function formatIsoDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayIsoDateOnly(d = new Date()): string {
  return formatIsoDateOnly(d);
}

/** Audit-trail timestamp from a date picker. Today (or blank) keeps the real clock; other dates use noon UTC so the calendar day survives US timezones. */
export function effectiveDateToTimestamp(isoDate: string | null | undefined, now = new Date()): string {
  const s = String(isoDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return now.toISOString();
  if (s === formatIsoDateOnly(now)) return now.toISOString();
  return `${s}T12:00:00.000Z`;
}

/**
 * Asset Report lease-term date used by Dashboard Lease Expiration Timeline
 * and per-car estimated_lease_expiry.
 *
 * Snapshot months are stored as the 1st (e.g. 2026-07-01). Adding N months
 * lands on the 1st of a later month; the Timeline displays that as the last
 * day of the prior month (verified: July 2026 + 3.0 → Sep 30, 2026). Round
 * fractional months the same way the Timeline does (Math.round). Negative
 * values are overdue terms and are allowed.
 */
export function estimatedExpiryDateFromAssetMonths(
  snapshotMonth: string,
  monthsUntil: number
): string | null {
  const months = Math.round(Number(monthsUntil));
  if (!Number.isFinite(months)) return null;
  const snap = String(snapshotMonth ?? "").trim().slice(0, 10);
  const landed = addCalendarMonths(snap, months);
  if (!landed) return null;
  const d = parseIsoDateOnly(landed);
  if (!d) return null;
  d.setDate(d.getDate() - 1);
  return formatIsoDateOnly(d);
}

/** Format a YYYY-MM-DD (or timestamp) as a calendar date without UTC shift. */
export function formatCalendarDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = String(iso).trim().slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export function formatAssetReportMonth(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = String(iso).trim().slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/**
 * Latest known end among cars that have one. For the derived riders.expiration_date
 * cache only — never use this as a stand-in date for cars whose lease_end_date is null.
 * Dashboard timeline / expiring tiles must group by (OL, exact end date) instead.
 */
export function aggregateOlEndDate(ends: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const e of ends) {
    const s = genuineEndDate(e ?? "");
    if (!s) continue;
    if (!best || s > best) best = s;
  }
  return best;
}
