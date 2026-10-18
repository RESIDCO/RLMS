/* eslint-disable no-console */
/** Run: npx tsx server/renewal-owner.test.ts */

import { renewalOwnerFields } from "../shared/account-mgmt";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const open = renewalOwnerFields({ owner_of_record: "KB", incoming_owner: "FF" });
ok(open.owner === "FF", "open handoff KB→FF assigns FF");
ok(open.owner_of_record === "KB" && open.incoming_owner === "FF", "preview keeps both owners");

const complete = renewalOwnerFields({ owner_of_record: "KB", incoming_owner: null });
ok(complete.owner === "KB" && complete.incoming_owner === null, "completed handoff uses the official owner");

const blank = renewalOwnerFields({ owner_of_record: null, incoming_owner: null });
ok(blank.owner === null && blank.owner_of_record === null, "no handoff and a blank owner stays null");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
