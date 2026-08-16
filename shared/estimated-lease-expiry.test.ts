/* eslint-disable no-console */
/**
 * Run: npx tsx shared/estimated-lease-expiry.test.ts
 */
import { estimatedExpiryDateFromAssetMonths } from "./lease-authority";
import { buildEstimatedLeaseExpiryUpdates } from "./estimated-lease-expiry";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  estimatedExpiryDateFromAssetMonths("2026-07-01", 3) === "2026-09-30",
  "3.0 months from July 2026 → Sep 30"
);
assert(
  estimatedExpiryDateFromAssetMonths("2026-07-01", 4) === "2026-10-31",
  "4.0 months from July 2026 → Oct 31"
);
assert(
  estimatedExpiryDateFromAssetMonths("2026-07-01", 5) === "2026-11-30",
  "5.0 months from July 2026 → Nov 30"
);
assert(
  estimatedExpiryDateFromAssetMonths("2026-07-01", 3.4) === "2026-09-30",
  "3.4 rounds to 3 → Sep 30"
);
assert(
  estimatedExpiryDateFromAssetMonths("2026-07-01", -1) === "2026-05-31",
  "negative months stay last-day-of-month"
);

const plan = buildEstimatedLeaseExpiryUpdates(
  [
    { id: 1, car_number: "1", reporting_marks: "AA", rider_external_id: "OL1706", legal_owner: "Cox" },
    { id: 2, car_number: "2", reporting_marks: "BB", rider_external_id: "OL1513", legal_owner: "X" },
    { id: 3, car_number: "3", reporting_marks: "CC", rider_external_id: "COAL1", legal_owner: null },
    { id: 4, car_number: "4", reporting_marks: "DD", rider_external_id: "OL1236", legal_owner: "ALF VII" },
  ],
  [
    { snapshot_month: "2026-07-01", rider_id: "OL1706", legal_owner: "Cox", months_until_lease_exp: 3 },
    { snapshot_month: "2026-07-01", rider_id: "OL1513", legal_owner: "X", months_until_lease_exp: 3 },
    { snapshot_month: "2026-07-01", rider_id: "OL1513", legal_owner: "X", months_until_lease_exp: 12 },
    { snapshot_month: "2026-07-01", rider_id: "OL1236", legal_owner: "ALF VII", months_until_lease_exp: 6 },
    { snapshot_month: "2026-07-01", rider_id: "OL1236", legal_owner: "RPS, LLC", months_until_lease_exp: 9 },
    { snapshot_month: "2026-06-01", rider_id: "OL1706", legal_owner: "Cox", months_until_lease_exp: 99 },
  ]
);

assert(plan.snapshotMonth === "2026-07-01", "uses latest snapshot");
assert(plan.updated === 2, `expected 2 dated cars, got ${plan.updated}`);
assert(plan.conflicted === 1, `expected 1 conflict, got ${plan.conflicted}`);
assert(plan.noMatch === 1, `expected 1 no-match, got ${plan.noMatch}`);

const byId = new Map(plan.pending.map((u) => [u.id, u]));
assert(byId.get(1)?.estimated_lease_expiry === "2026-09-30", "OL1706 date");
assert(byId.get(1)?.lease_expiry_snapshot_month === "2026-07-01", "OL1706 snapshot");
assert(!byId.get(2) || byId.get(2)?.estimated_lease_expiry === null, "conflict stays null");
assert(!byId.get(3) || byId.get(3)?.estimated_lease_expiry === null, "no match stays null");
assert(byId.get(4)?.estimated_lease_expiry === "2026-12-31", "legal_owner splits OL1236");

console.log("estimated-lease-expiry tests passed");
