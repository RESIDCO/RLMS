/**
 * Lease-status authority: railcars fields written by monthly VCF import.
 *
 * riders.expiration_date is NOT authoritative — historically seeded and often
 * years stale. Prefer railcars.lease_end_date / lease_expiry / lessee_name /
 * rider_external_id for any "is this lease current / who is the lessee / which OL"
 * question. riders.expiration_date may be refreshed as a derived cache for
 * Lease Management UI, but Dashboard and lease-status KPIs must read cars.
 */

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
  const end = String(car.lease_end_date ?? "").trim().slice(0, 10);
  if (end) return end;
  const exp = String(car.lease_expiry ?? "").trim().slice(0, 10);
  if (exp) return exp;
  return null;
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

/** Aggregate known end dates for an OL: latest (max) among cars with a known end. */
export function aggregateOlEndDate(ends: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const e of ends) {
    const s = e ? String(e).trim().slice(0, 10) : "";
    if (!s) continue;
    if (!best || s > best) best = s;
  }
  return best;
}
