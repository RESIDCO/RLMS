/* eslint-disable no-console */
/** Run: npx tsx client/src/lib/directory-people-group.test.ts */

import { groupDirectoryPeopleById } from "./directory-people-group";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const grouped = groupDirectoryPeopleById([
  {
    id: 1,
    name: "Ann",
    via_company: false,
    master_lease: { lease_number: "A", lessee: "Acme" },
    rider: { rider_name: "OL1" },
  },
  {
    id: 1,
    name: "Ann",
    via_company: true,
    master_lease: { lease_number: "B", lessee: "Acme" },
    rider: { rider_name: "OL2" },
  },
]);

ok(grouped.length === 1, "one person");
ok(grouped[0].via_company === true, "via_company survives a later company-wide row");
ok(grouped[0].leases.length === 2, "both leases kept");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
