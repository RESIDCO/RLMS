/** Run: npx tsx shared/move-legacy.test.ts */
import { fleetMoveSource, moveLegacyDestination, moveLegacyDestinationFromSources } from "./move-legacy";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const bare = moveLegacyDestination("");
ok(bare.kind === "notice", "a bare /move visit is a notice");

const redirected = moveLegacyDestination("?rider=42");
ok(redirected.kind === "redirect", "a rider id opens the move dialog");
if (redirected.kind === "redirect") {
  ok(redirected.path === "/railcars?move_source=42", "redirect preselects the source rider");
  ok(!redirected.path.includes("rider_id"), "redirect does not set a Railcars rider filter");
  ok(!redirected.path.includes("rider=42"), "redirect does not reuse the OL-code rider param");
}

ok(moveLegacyDestination("rider=OL%20100").kind === "notice", "a non-numeric rider stays on the notice page");

const fromLocation = moveLegacyDestinationFromSources("", "?rider=7");
ok(fromLocation.kind === "redirect" && fromLocation.path === "/railcars?move_source=7", "an old location.search rider still opens the dialog");

const hashWins = moveLegacyDestinationFromSources("?rider=3", "?rider=9");
ok(hashWins.kind === "redirect" && hashWins.path.endsWith("move_source=3"), "the hash query wins over location.search");

ok(fleetMoveSource("?move_source=15") === 15, "Railcars reads only the move source");
ok(fleetMoveSource("?rider_id=15&move=1") === null, "rider_id does not change the Railcars filter or open a move");
ok(fleetMoveSource("?rider=OL100") === null, "the OL-code rider param does not open a move");
ok(fleetMoveSource("?move_source=0") === null, "a blank source does not open the dialog");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
