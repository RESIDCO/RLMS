/** Run: npx tsx shared/move-legacy.test.ts */
import { fleetMoveLaunch, moveLegacyDestination, moveLegacyDestinationFromSources } from "./move-legacy";

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
ok(redirected.kind === "redirect", "a rider query redirects");
if (redirected.kind === "redirect") {
  ok(redirected.path === "/railcars?rider_id=42&move=1", "redirect uses rider_id and opens the dialog");
  ok(!redirected.path.includes("rider=42"), "redirect does not reuse the OL-code rider param");
}

const encoded = moveLegacyDestination("rider=OL%20100");
ok(encoded.kind === "redirect" && encoded.path.includes("rider_id=OL%20100"), "rider ids are encoded");

const fromLocation = moveLegacyDestinationFromSources("", "?rider=7");
ok(fromLocation.kind === "redirect" && fromLocation.path.endsWith("rider_id=7&move=1"), "an old location.search rider still redirects");

const hashWins = moveLegacyDestinationFromSources("?rider=3", "?rider=9");
ok(hashWins.kind === "redirect" && hashWins.path.includes("rider_id=3"), "the hash query wins over location.search");

const launch = fleetMoveLaunch("?rider=OL100&rider_id=15&move=1");
ok(launch.riderId === "15" && launch.openMove, "Railcars reads rider_id and move=1");
ok(fleetMoveLaunch("?rider=OL100").riderId === "" && !fleetMoveLaunch("?rider=OL100").openMove, "the OL-code rider param does not open a move");
ok(!fleetMoveLaunch("?move=0").openMove, "only move=1 opens the dialog");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
