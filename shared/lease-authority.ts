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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
