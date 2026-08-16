/**
 * Replace estimated_lease_expiry / lease_expiry_snapshot_month on every
 * active car from rider_financial_summary. Never writes lease_end_date,
 * lease_expiry, or any other railcars column. Never touches inactive cars.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "./fetch-all";
import {
  buildEstimatedLeaseExpiryUpdates,
  ESTIMATED_LEASE_EXPIRY_FIELDS,
  type ExpiryRefreshPlan,
  type FinExpiryRow,
} from "../shared/estimated-lease-expiry";

const MISSING_COL = /estimated_lease_expiry|lease_expiry_snapshot_month/i;

export type EstimatedLeaseExpiryRefreshResult = {
  snapshotMonth: string | null;
  updated: number;
  noMatch: number;
  conflicted: number;
  unchanged: number;
  rowsWritten: number;
  conflictGroups: ExpiryRefreshPlan["conflictGroups"];
};

export class MissingExpiryEstimateColumnsError extends Error {
  constructor() {
    super(
      "railcars.estimated_lease_expiry is missing. Run migrations/20260815_estimated_lease_expiry.sql in the Supabase SQL editor, then retry. Nothing was written to the estimate columns."
    );
    this.name = "MissingExpiryEstimateColumnsError";
  }
}

export async function probeEstimatedLeaseExpiryColumns(db: SupabaseClient): Promise<void> {
  const { error } = await db.from("railcars").select("id, estimated_lease_expiry, lease_expiry_snapshot_month").limit(1);
  if (error) {
    if (MISSING_COL.test(error.message)) throw new MissingExpiryEstimateColumnsError();
    throw error;
  }
}

export async function refreshEstimatedLeaseExpiry(
  db: SupabaseClient,
  snapshotMonth?: string | null,
  opts?: { dryRun?: boolean }
): Promise<EstimatedLeaseExpiryRefreshResult> {
  await probeEstimatedLeaseExpiryColumns(db);

  const [cars, summaryRows] = await Promise.all([
    fetchAllRows((from, to) =>
      db
        .from("railcars")
        .select(
          "id, car_number, reporting_marks, rider_external_id, legal_owner, estimated_lease_expiry, lease_expiry_snapshot_month"
        )
        .eq("active", true)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<FinExpiryRow>((from, to) =>
      db
        .from("rider_financial_summary")
        .select("snapshot_month, rider_id, legal_owner, months_until_lease_exp")
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  const plan = buildEstimatedLeaseExpiryUpdates(cars as any[], summaryRows, snapshotMonth);

  for (const g of plan.conflictGroups) {
    console.warn("[lease-expiry-estimate] conflict", JSON.stringify(g));
  }
  for (const c of plan.conflicts.slice(0, 40)) {
    console.warn("[lease-expiry-estimate] skipped car", JSON.stringify(c));
  }
  if (plan.conflicts.length > 40) {
    console.warn(`[lease-expiry-estimate] … ${plan.conflicts.length - 40} more conflicted cars`);
  }

  const WAVE = 40;
  let rowsWritten = 0;
  if (!opts?.dryRun) {
    for (let i = 0; i < plan.pending.length; i += WAVE) {
      const slice = plan.pending.slice(i, i + WAVE);
      const results = await Promise.all(
        slice.map((u) => {
          const payload: Record<string, unknown> = {};
          for (const f of ESTIMATED_LEASE_EXPIRY_FIELDS) payload[f] = u[f];
          return db.from("railcars").update(payload).eq("id", u.id).eq("active", true);
        })
      );
      for (const r of results) {
        if (r.error) throw r.error;
      }
      rowsWritten += slice.length;
    }
  }

  console.log("[lease-expiry-estimate]", JSON.stringify({
    snapshotMonth: plan.snapshotMonth,
    updated: plan.updated,
    noMatch: plan.noMatch,
    conflicted: plan.conflicted,
    unchanged: plan.unchanged,
    rowsWritten,
    conflictGroups: plan.conflictGroups,
  }));

  return {
    snapshotMonth: plan.snapshotMonth,
    updated: plan.updated,
    noMatch: plan.noMatch,
    conflicted: plan.conflicted,
    unchanged: plan.unchanged,
    rowsWritten,
    conflictGroups: plan.conflictGroups,
  };
}
