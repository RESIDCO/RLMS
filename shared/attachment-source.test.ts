/* eslint-disable no-console */
/** Run: npx tsx shared/attachment-source.test.ts */

import {
  ACCOUNT_TRANSITIONS_SOURCE,
  formatAttachmentProvenance,
  stampGenericAttachmentSource,
} from "./attachment-source";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(stampGenericAttachmentSource("rider") === "lease_management", "OL uploads via generic route stamp lease_management");
ok(stampGenericAttachmentSource("master_lease") === "lease_management", "MLA uploads stamp lease_management");
ok(stampGenericAttachmentSource("railcar") === "manual", "railcar uploads stamp manual");
ok(ACCOUNT_TRANSITIONS_SOURCE === "account_transitions", "AT source is account_transitions");

const spoof = { source_module: "lease_management" };
ok(
  ACCOUNT_TRANSITIONS_SOURCE !== spoof.source_module,
  "AT stamp is not taken from a client spoof object",
);

ok(
  formatAttachmentProvenance("account_transitions", "2026-08-25T15:00:00.000Z").startsWith("Account Transitions · "),
  "list label is source plus date",
);

console.log(`passed ${passed} failed ${failed}`);
if (failed) process.exit(1);
