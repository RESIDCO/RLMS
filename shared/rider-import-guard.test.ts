/* eslint-disable no-console */
/** Run: npx tsx shared/rider-import-guard.test.ts */

import {
  RIDER_FINANCIAL_FILL_BLANK_FIELDS,
  RIDER_IMPORT_NEVER_WRITE,
  assertRiderImporterPatch,
  riderFinancialFillBlankPayload,
  riderVcfExpirationSyncPayload,
} from "./rider-import-guard";

let passed = 0;
let failed = 0;

function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(RIDER_IMPORT_NEVER_WRITE.includes("account_manager"), "account_manager is named never-write");
ok(
  !(RIDER_FINANCIAL_FILL_BLANK_FIELDS as readonly string[]).includes("account_manager"),
  "account_manager is not a fill-blank field",
);

let threw = false;
try {
  assertRiderImporterPatch({ account_manager: "GS" });
} catch {
  threw = true;
}
ok(threw, "assert rejects account_manager");

const fill = riderFinancialFillBlankPayload("monthly_rent_per_car", 100);
ok(fill.monthly_rent_per_car === 100 && !("account_manager" in fill), "fill-blank payload is rent only");

const dates = riderVcfExpirationSyncPayload({ expiration_date: "2028-01-01" });
ok(dates.expiration_date === "2028-01-01" && !("account_manager" in dates), "vcf sync payload is dates only");

console.log(`passed ${passed} failed ${failed}`);
if (failed) process.exit(1);
