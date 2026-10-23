/* eslint-disable no-console */
/** Run: npx tsx shared/kpi-why.test.ts */
import { kpiBucketTitle } from "./kpi-buckets.ts";
import { kpiWhyLines } from "./kpi-why.ts";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const conflict = kpiWhyLines({
  bucket: "lease_end_conflict",
  reason: "Rider expiration and car lease end differ",
  primary: "lease_end_conflict",
  statusTag: "Leased",
  derivedStatus: "On rent",
  lease: "OL100",
  lessee: "Covia",
});
ok(conflict.title === "Rider expiration and car lease end differ", "the reason is the why line");
ok(
  conflict.status === "Lease end date conflict · tag Leased · derived On rent",
  "the status line names the bucket, tag, and derived status",
);
ok(conflict.lease === "Lease OL100 · Covia", "the lease line names the OL and lessee");

const fallback = kpiWhyLines({ bucket: "lease_end_conflict" });
ok(fallback.title === kpiBucketTitle("lease_end_conflict"), "a blank reason falls back to the bucket title");
ok(fallback.status.includes("tag —") && fallback.status.includes("derived —"), "blank status fields stay em dashes");
ok(fallback.lease === "Lease — · —", "blank lease fields stay em dashes");
ok(kpiWhyLines({ bucket: "no_link", reason: "   " }).title === "No lease link", "whitespace reason does not replace the bucket title");

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log(`${passed} passed, ${failed} failed`);
