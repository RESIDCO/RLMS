/**
 * Lease/OL date precedence:
 *   1. Asset Report (rider_financial_summary) — latest snapshot, soonest date
 *      across split rows for the same OL.
 *   2. V_Valid / car-level dates only when Asset Report is silent for that OL.
 *
 * That rule applies to riders.expiration_date AND to lease dates duplicated
 * onto railcars (lease_start_date, lease_end_date, lease_expiry,
 * estimated_lease_expiry). Car-intrinsic fields are out of scope.
 */

import {
  carLeaseEndDate,
  carOlCode,
  estimatedExpiryDateFromAssetMonths,
  formatAssetReportMonth,
  soonestOlEndDate,
  type CarLeaseFields,
} from "./lease-authority";

export type LeaseDateSource = "asset_report" | "asset_report_multi_term" | "car_records";

export type AssetReportFinRow = {
  snapshot_month?: string | null;
  rider_id?: string | null;
  lessee?: string | null;
  months_until_lease_exp?: number | string | null;
  lease_exp_date?: string | null;
};

export type GovernedOlExpiration = {
  ol: string;
  expiration_date: string;
  source: LeaseDateSource;
  snapshot_month: string | null;
  months_until: number | null;
  lessee: string | null;
};

export function normalizeOlKey(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

export function latestSnapshotMonth(
  rows: Array<{ snapshot_month?: string | null }>
): string | null {
  let latest: string | null = null;
  for (const r of rows) {
    const s = String(r.snapshot_month ?? "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) continue;
    if (!latest || s > latest) latest = s;
  }
  return latest;
}

function asIsoDate(v: unknown): string | null {
  const s = String(v ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parseMonths(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

/** True when this snapshot stored real Lease Exp dates (not months-only history). */
export function snapshotHasLeaseExpDates(
  rows: AssetReportFinRow[],
  snap: string | null
): boolean {
  if (!snap) return false;
  return rows.some(
    (r) => asIsoDate(r.snapshot_month) === snap && asIsoDate(r.lease_exp_date)
  );
}

export function expirationFromAssetRow(
  row: AssetReportFinRow,
  snapshotFallback: string | null,
  allowMonthsFallback = true
): string | null {
  const direct = asIsoDate(row.lease_exp_date);
  if (direct) return direct;
  if (!allowMonthsFallback) return null;
  const months = parseMonths(row.months_until_lease_exp);
  const snap = asIsoDate(row.snapshot_month) ?? snapshotFallback;
  if (months == null || !snap) return null;
  return estimatedExpiryDateFromAssetMonths(snap, months);
}

/** Latest snapshot only; soonest date wins when an OL is split across rows. */
export function buildAssetReportExpirations(
  finRows: AssetReportFinRow[]
): { latestSnap: string | null; byOl: Map<string, GovernedOlExpiration> } {
  const latestSnap = latestSnapshotMonth(finRows);
  const latestRows = latestSnap
    ? finRows.filter((r) => asIsoDate(r.snapshot_month) === latestSnap)
    : [];
  const allowMonthsFallback = !snapshotHasLeaseExpDates(finRows, latestSnap);
  const byOl = new Map<string, GovernedOlExpiration>();
  const datesByOl = new Map<string, Set<string>>();
  for (const r of latestRows) {
    const ol = String(r.rider_id ?? "").trim();
    const key = normalizeOlKey(ol);
    if (!key) continue;
    const date = expirationFromAssetRow(r, latestSnap, allowMonthsFallback);
    if (!date) continue;
    const months = parseMonths(r.months_until_lease_exp);
    const seen = datesByOl.get(key) ?? new Set<string>();
    seen.add(date);
    datesByOl.set(key, seen);
    const existing = byOl.get(key);
    if (!existing || date < existing.expiration_date) {
      byOl.set(key, {
        ol,
        expiration_date: date,
        source: seen.size > 1 ? "asset_report_multi_term" : "asset_report",
        snapshot_month: latestSnap,
        months_until: months,
        lessee: r.lessee ? String(r.lessee) : null,
      });
    } else {
      if (existing && seen.size > 1) existing.source = "asset_report_multi_term";
      if (existing && !existing.lessee && r.lessee) existing.lessee = String(r.lessee);
    }
  }
  return { latestSnap, byOl };
}

export type CarForLeaseFallback = CarLeaseFields & {
  estimated_lease_expiry?: string | null;
  active?: boolean | null;
};

export function carFallbackEndDate(car: CarForLeaseFallback): string | null {
  return (
    asIsoDate(car.estimated_lease_expiry) ||
    carLeaseEndDate(car)
  );
}

/** min(estimated_lease_expiry / lease end) per OL among active cars. */
export function buildCarFallbackExpirations(
  cars: CarForLeaseFallback[]
): Map<string, string> {
  const ends = new Map<string, string[]>();
  for (const c of cars) {
    if (c.active === false) continue;
    const ol = carOlCode(c);
    if (!ol) continue;
    const end = carFallbackEndDate(c);
    if (!end) continue;
    const key = normalizeOlKey(ol);
    const list = ends.get(key) ?? [];
    list.push(end);
    ends.set(key, list);
  }
  const out = new Map<string, string>();
  for (const [key, list] of ends) {
    const soonest = soonestOlEndDate(list);
    if (soonest) out.set(key, soonest);
  }
  return out;
}

export function resolveGovernedExpiration(
  olKey: string,
  assetByOl: Map<string, GovernedOlExpiration>,
  carFallbackByOl: Map<string, string>,
  assetPresent?: Set<string>
): GovernedOlExpiration | null {
  const key = normalizeOlKey(olKey);
  if (!key) return null;
  const asset = assetByOl.get(key);
  if (asset) return asset;
  if (assetPresent?.has(key)) return null;
  const carDate = carFallbackByOl.get(key);
  if (!carDate) return null;
  return {
    ol: olKey,
    expiration_date: carDate,
    source: "car_records",
    snapshot_month: null,
    months_until: null,
    lessee: null,
  };
}

export function riderOlKeys(rider: {
  rider_name?: string | null;
  schedule_number?: string | null;
}): string[] {
  const keys = [
    normalizeOlKey(rider.rider_name),
    normalizeOlKey(rider.schedule_number),
  ].filter(Boolean);
  return [...new Set(keys)];
}

export function lookupGovernedForRider(
  rider: { rider_name?: string | null; schedule_number?: string | null },
  assetByOl: Map<string, GovernedOlExpiration>,
  carFallbackByOl: Map<string, string>,
  assetPresent?: Set<string>
): GovernedOlExpiration | null {
  const keys = riderOlKeys(rider);
  for (const k of keys) {
    const asset = assetByOl.get(k);
    if (asset) return asset;
  }
  for (const k of keys) {
    const fallback = resolveGovernedExpiration(k, assetByOl, carFallbackByOl, assetPresent);
    if (fallback) return fallback;
  }
  return null;
}

export function olsPresentInSnapshot(
  finRows: AssetReportFinRow[],
  snap: string | null
): Set<string> {
  const out = new Set<string>();
  if (!snap) return out;
  for (const r of finRows) {
    if (asIsoDate(r.snapshot_month) !== snap) continue;
    const key = normalizeOlKey(r.rider_id);
    if (key) out.add(key);
  }
  return out;
}

export function formatRiderTermSchedule(
  terms: Array<{ term_end?: string | null; status_text?: string | null; car_count?: number | null }>
): string | null {
  if (!terms.length) return null;
  const dated = terms
    .filter((t) => asIsoDate(t.term_end))
    .sort((a, b) => String(a.term_end).localeCompare(String(b.term_end)));
  const statuses = terms.filter((t) => String(t.status_text ?? "").trim());
  if (dated.length < 2 && statuses.length === 0) return null;
  const parts: string[] = [];
  for (const t of dated) {
    const n = Number(t.car_count) || 0;
    const d = asIsoDate(t.term_end)!;
    const [y, m, day] = d.split("-");
    parts.push(`${n} cars through ${Number(m)}/${Number(day)}/${y.slice(2)}`);
  }
  for (const t of statuses) {
    const n = Number(t.car_count) || 0;
    parts.push(`${n} ${String(t.status_text).trim().toUpperCase()}`);
  }
  return parts.join(" · ");
}

export function leaseStatusLabel(status: string | null | undefined): string | null {
  const s = String(status ?? "").trim().toUpperCase();
  if (!s) return null;
  if (s === "MTM") return "MTM";
  if (s === "SCRAPPING") return "Scrapping";
  if (s === "AVAILABLE") return "Available";
  if (s === "GOING ON LEASE") return "Going on lease";
  if (s === "PARTOUT") return "Partout";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function leaseExpirationSourceLabel(
  source: string | null | undefined,
  snapshotMonth?: string | null
): string | null {
  const s = String(source ?? "").trim();
  if (s === "asset_report") {
    const month = formatAssetReportMonth(snapshotMonth);
    return month ? `Asset Report · ${month}` : "Asset Report";
  }
  if (s === "asset_report_multi_term") {
    const month = formatAssetReportMonth(snapshotMonth);
    return month ? `Earliest of N terms · ${month}` : "Earliest of N terms";
  }
  if (s === "car_records") return "Estimated from car records";
  return null;
}
