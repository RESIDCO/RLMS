/* eslint-disable no-console */
/** Run: npx tsx shared/account-transitions.test.ts */

import {
  accountHandoffPct,
  flaggedHandoffAvgPct,
  isCommunicationMethod,
  isFlaggedTransition,
} from "./account-transitions";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(!isFlaggedTransition(null), "blank incoming is not flagged");
ok(isFlaggedTransition("GS"), "incoming AM flags the record");
ok(accountHandoffPct({}) === 0, "empty record is 0%");
ok(accountHandoffPct({ to_account_manager: "BH" }) === 33, "incoming only is 33%");
ok(
  accountHandoffPct({ to_account_manager: "BH", meeting_scheduled: true }) === 67,
  "incoming + meeting is 67%",
);
ok(
  accountHandoffPct({
    to_account_manager: "BH",
    meeting_scheduled: true,
    communication_completed: true,
  }) === 100,
  "all three is 100%",
);
ok(flaggedHandoffAvgPct([{ meeting_scheduled: true }]) === null, "unflagged rows excluded from tile avg");
ok(
  flaggedHandoffAvgPct([
    { to_account_manager: "BH", meeting_scheduled: true },
    { to_account_manager: "FF" },
  ]) === 50,
  "tile avg is mean of flagged thirds",
);
ok(isCommunicationMethod("in_person") && isCommunicationMethod("call") && isCommunicationMethod("email"), "handoff bucket methods are valid");

console.log(`passed ${passed} failed ${failed}`);
if (failed) process.exit(1);
