/* eslint-disable no-console */
/** Run: npx tsx client/src/lib/hash-location.test.ts */

import { contactsDirectoryPath, readDirectoryNavState } from "./directory-nav";
import { isDirectoryLeaseReviewTab } from "./directory-review-tab";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(isDirectoryLeaseReviewTab(new URLSearchParams("tab=leases")), "tab=leases opens lease review");
ok(isDirectoryLeaseReviewTab(new URLSearchParams("tab=lease_gaps")), "tab=lease_gaps opens lease review");
ok(!isDirectoryLeaseReviewTab(new URLSearchParams("tab=pending_review")), "other tabs stay on default");
ok(!isDirectoryLeaseReviewTab(new URLSearchParams("")), "missing tab stays on default");

const dir = readDirectoryNavState(new URLSearchParams("q=Agrex&contact=12&company=4&view=people&lease=1"));
ok(dir.q === "Agrex" && dir.contactId === 12 && dir.companyId === 4 && dir.people && dir.leaseTied, "directory hash params parse");
ok(
  contactsDirectoryPath(dir) === "/contacts?q=Agrex&company=4&contact=12&view=people&lease=1",
  "directory path round-trips people + lease filters",
);
ok(contactsDirectoryPath({ q: "", companyId: null, contactId: null, people: false, leaseTied: false }) === "/contacts", "empty directory path");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
