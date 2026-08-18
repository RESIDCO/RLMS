/* eslint-disable no-console */
/** Run: npx tsx shared/exact-car-search.test.ts */

import {
  carNumberLookupVariants,
  carNumbersMatchIgnoringZeros,
  isExactCarRow,
  parseExactCarIdentifier,
} from "./exact-car-search";

let passed = 0;
let failed = 0;

function eq(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

eq(parseExactCarIdentifier("OFCX075192"), { marks: "OFCX", number: "075192" }, "compact");
eq(parseExactCarIdentifier("OFCX 075192"), { marks: "OFCX", number: "075192" }, "spaced");
eq(parseExactCarIdentifier("ofcx-075192"), { marks: "OFCX", number: "075192" }, "dash / lowercase");
eq(parseExactCarIdentifier("OFCX75192"), { marks: "OFCX", number: "75192" }, "leading zeros stripped");
eq(parseExactCarIdentifier("  OFCX 075192  "), { marks: "OFCX", number: "075192" }, "surrounding whitespace");

eq(parseExactCarIdentifier("075192"), null, "digits only are not exact");
eq(parseExactCarIdentifier("OFCX"), null, "marks only are not exact");
eq(parseExactCarIdentifier("BNSF"), null, "lessee / marks-only");
eq(parseExactCarIdentifier("OL2345"), null, "rider/OL code");
eq(parseExactCarIdentifier("ol2009"), null, "rider/OL lowercase");
eq(parseExactCarIdentifier("Carmeuse"), null, "lessee name");
eq(parseExactCarIdentifier("OFCX075"), { marks: "OFCX", number: "075" }, "short number is still an identifier shape");
eq(parseExactCarIdentifier("OFCX075192 extra"), null, "trailing junk");
eq(parseExactCarIdentifier(""), null, "empty");

eq(carNumbersMatchIgnoringZeros("075192", "75192"), true, "zero pad match");
eq(carNumbersMatchIgnoringZeros("075192", "075192"), true, "same pad match");
eq(carNumbersMatchIgnoringZeros("075", "075192"), false, "partial digits are not the same car");
eq(carNumberLookupVariants("75192").includes("075192"), true, "6-digit pad is a lookup variant");

eq(
  isExactCarRow({ reporting_marks: "OFCX", car_number: "075192" }, { marks: "OFCX", number: "75192" }),
  true,
  "row match ignores zeros",
);
eq(
  isExactCarRow({ reporting_marks: "OFCX", car_number: "075192" }, { marks: "OFCX", number: "075" }),
  false,
  "partial number is not the row",
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
