/**
 * One-time production backfill: active-car estimated_lease_expiry from the
 * latest rider_financial_summary snapshot (expected 2026-07-01).
 *
 *   npx tsx script/backfill_estimated_lease_expiry.ts
 *   npx tsx script/backfill_estimated_lease_expiry.ts --confirm
 *
 * Dry-run by default. --confirm writes only estimated_lease_expiry and
 * lease_expiry_snapshot_month on active cars. Never writes lease_end_date.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import { refreshEstimatedLeaseExpiry } from "../server/refresh-estimated-lease-expiry.ts";

const confirm = process.argv.includes("--confirm");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const result = await refreshEstimatedLeaseExpiry(sb, null, { dryRun: !confirm });
console.log(confirm ? "Wrote lease expiry estimates:" : "Dry-run (pass --confirm to write):");
console.log(JSON.stringify({
  snapshotMonth: result.snapshotMonth,
  updated: result.updated,
  noMatch: result.noMatch,
  conflicted: result.conflicted,
  unchanged: result.unchanged,
  rowsWritten: result.rowsWritten,
  conflictGroups: result.conflictGroups,
}, null, 2));

if (confirm && result.snapshotMonth) {
  const { data: spot, error } = await sb
    .from("railcars")
    .select("id, car_number, reporting_marks, rider_external_id, legal_owner, estimated_lease_expiry, lease_expiry_snapshot_month, lease_end_date, active")
    .eq("active", true)
    .eq("rider_external_id", "OL1706")
    .limit(5);
  if (error) throw error;
  console.log("OL1706 spot-check:", JSON.stringify(spot, null, 2));

  const { count: inactiveWithEst } = await sb
    .from("railcars")
    .select("id", { count: "exact", head: true })
    .eq("active", false)
    .not("estimated_lease_expiry", "is", null);
  console.log("Inactive cars with an estimate (must be 0):", inactiveWithEst ?? 0);
}
