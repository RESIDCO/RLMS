/**
 * Per-car estimated_lease_expiry from rider_financial_summary.
 *
 * Match: active car rider_external_id + legal_owner ↔ latest (or specified)
 * snapshot's rider_id + legal_owner. Conflicting months_until_lease_exp
 * within a group → leave null and log. No match → null (not an error).
 *
 * Writes ONLY estimated_lease_expiry and lease_expiry_snapshot_month.
 */

import { estimatedExpiryDateFromAssetMonths } from "./lease-authority";

export const ESTIMATED_LEASE_EXPIRY_FIELDS = [
  "estimated_lease_expiry",
  "lease_expiry_snapshot_month",
] as const;

export type FinExpiryRow = {
  snapshot_month: string | null;
  rider_id: string | null;
  legal_owner: string | null;
  months_until_lease_exp: number | string | null;
};

export type ActiveCarForExpiry = {
  id: number;
  car_number?: string | null;
  reporting_marks?: string | null;
  rider_external_id: string | null;
  legal_owner: string | null;
  estimated_lease_expiry?: string | null;
  lease_expiry_snapshot_month?: string | null;
};

export type ExpiryConflictLog = {
  car_number: string | null;
  reporting_marks: string | null;
  rider: string;
  legal_owner: string;
  values: number[];
};

export type ExpiryCarUpdate = {
  id: number;
  estimated_lease_expiry: string | null;
  lease_expiry_snapshot_month: string | null;
};

export type ExpiryRefreshPlan = {
  snapshotMonth: string | null;
  updates: ExpiryCarUpdate[];
  pending: ExpiryCarUpdate[];
  updated: number;
  noMatch: number;
  conflicted: number;
  unchanged: number;
  conflicts: ExpiryConflictLog[];
  conflictGroups: Array<{ rider: string; legal_owner: string; values: number[]; carCount: number }>;
};

function normRider(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

function normOwner(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

function matchKey(rider: unknown, owner: unknown): string {
  return `${normRider(rider)}\0${normOwner(owner)}`;
}

function asIsoDate(v: unknown): string | null {
  const s = String(v ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parseMonths(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function latestSnapshotMonth(rows: FinExpiryRow[]): string | null {
  let best: string | null = null;
  for (const r of rows) {
    const s = asIsoDate(r.snapshot_month);
    if (s && (!best || s > best)) best = s;
  }
  return best;
}

export function buildEstimatedLeaseExpiryUpdates(
  activeCars: ActiveCarForExpiry[],
  summaryRows: FinExpiryRow[],
  snapshotMonth?: string | null
): ExpiryRefreshPlan {
  const snap = asIsoDate(snapshotMonth) ?? latestSnapshotMonth(summaryRows);
  const monthRows = snap
    ? summaryRows.filter((r) => asIsoDate(r.snapshot_month) === snap)
    : [];

  type Group = { rider: string; owner: string; months: Set<number> };
  const groups = new Map<string, Group>();
  for (const r of monthRows) {
    const rider = normRider(r.rider_id);
    if (!rider) continue;
    const months = parseMonths(r.months_until_lease_exp);
    if (months == null) continue;
    const rounded = Math.round(months);
    const key = matchKey(rider, r.legal_owner);
    let g = groups.get(key);
    if (!g) {
      g = { rider, owner: normOwner(r.legal_owner), months: new Set() };
      groups.set(key, g);
    }
    g.months.add(rounded);
  }

  const conflictGroups: ExpiryRefreshPlan["conflictGroups"] = [];
  const dates = new Map<string, string>();
  const conflictByKey = new Map<string, ExpiryRefreshPlan["conflictGroups"][number]>();
  for (const [key, g] of groups) {
    if (g.months.size > 1) {
      const row = {
        rider: g.rider,
        legal_owner: g.owner || "(blank)",
        values: Array.from(g.months).sort((a, b) => a - b),
        carCount: 0,
      };
      conflictGroups.push(row);
      conflictByKey.set(key, row);
      continue;
    }
    const only = Array.from(g.months)[0];
    const date = snap ? estimatedExpiryDateFromAssetMonths(snap, only) : null;
    if (date) dates.set(key, date);
  }

  const updates: ExpiryCarUpdate[] = [];
  const conflicts: ExpiryConflictLog[] = [];
  let updated = 0;
  let noMatch = 0;
  let conflicted = 0;
  let unchanged = 0;

  for (const car of activeCars) {
    const key = matchKey(car.rider_external_id, car.legal_owner);
    let estimated: string | null = null;
    let sourceMonth: string | null = null;

    if (conflictByKey.has(key)) {
      conflicted += 1;
      const g = conflictByKey.get(key)!;
      g.carCount += 1;
      conflicts.push({
        car_number: car.car_number ?? null,
        reporting_marks: car.reporting_marks ?? null,
        rider: normRider(car.rider_external_id) || "(blank)",
        legal_owner: normOwner(car.legal_owner) || "(blank)",
        values: g.values,
      });
    } else {
      const date = dates.get(key);
      if (date && snap) {
        estimated = date;
        sourceMonth = snap;
        updated += 1;
      } else {
        noMatch += 1;
      }
    }

    const prevDate = asIsoDate(car.estimated_lease_expiry);
    const prevMonth = asIsoDate(car.lease_expiry_snapshot_month);
    if (prevDate === estimated && prevMonth === sourceMonth) {
      unchanged += 1;
      continue;
    }
    updates.push({
      id: car.id,
      estimated_lease_expiry: estimated,
      lease_expiry_snapshot_month: sourceMonth,
    });
  }

  return {
    snapshotMonth: snap,
    updates,
    pending: updates,
    updated,
    noMatch,
    conflicted,
    unchanged,
    conflicts,
    conflictGroups,
  };
}
