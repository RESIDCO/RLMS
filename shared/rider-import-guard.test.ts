/* eslint-disable no-console */
/** Run: npx tsx shared/rider-import-guard.test.ts */

import {
  ACCOUNT_IMPORT_NEVER_WRITE,
  RIDER_FINANCIAL_FILL_BLANK_FIELDS,
  RIDER_IMPORT_NEVER_WRITE,
  assertAccountImporterPatch,
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

ok(RIDER_IMPORT_NEVER_WRITE.includes("status_tag"), "status_tag is named never-write");
ok(!(RIDER_IMPORT_NEVER_WRITE as readonly string[]).includes("account_mgmt_comment"), "dropped riders.account_mgmt_comment is not a rider column");
let tagThrew = false;
try {
  assertRiderImporterPatch({ status_tag: "good" });
} catch {
  tagThrew = true;
}
ok(tagThrew, "assert rejects riders.status_tag");
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
ok(threw, "assert rejects riders.account_manager");

ok(ACCOUNT_IMPORT_NEVER_WRITE.includes("account_manager"), "accounts.account_manager is named never-write");
let acctThrew = false;
try {
  assertAccountImporterPatch({ name: "Acme", account_manager: "ZZ" });
} catch {
  acctThrew = true;
}
ok(acctThrew, "assert rejects accounts.account_manager");
assertAccountImporterPatch({ name: "Acme" });

const fill = riderFinancialFillBlankPayload("monthly_rent_per_car", 100);
ok(fill.monthly_rent_per_car === 100 && !("account_manager" in fill), "fill-blank payload is rent only");

const dates = riderVcfExpirationSyncPayload({ expiration_date: "2028-01-01" });
ok(dates.expiration_date === "2028-01-01" && !("account_manager" in dates), "vcf sync payload is dates only");

console.log(`passed ${passed} failed ${failed}`);
if (failed) process.exit(1);
