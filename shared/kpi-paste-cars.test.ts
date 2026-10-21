/* eslint-disable no-console */
/** Run: npx tsx shared/kpi-paste-cars.test.ts */

import {
  awaitingPasteSummary,
  formatUnmatchedPasteList,
  matchPastedCarsOnList,
  type AwaitingPasteCar,
} from "./kpi-paste-cars";
import { parseCarPasteList } from "./programs";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const awaiting: AwaitingPasteCar[] = [
  { railcar_id: 1, reporting_marks: "ELTX", car_number: "003105", car: "ELTX 003105" },
  { railcar_id: 2, reporting_marks: "ELTX", car_number: "3106", car: "ELTX 003106" },
  { railcar_id: 3, reporting_marks: "eltx", car_number: "0003107", car: "ELTX 003107" },
  { railcar_id: 4, reporting_marks: "OFOX", car_number: "815215", car: "OFOX 815215" },
];

ok(
  parseCarPasteList("ELTX 003105\nELTX3105\nELTX 3105").join("|") === "ELTX 003105",
  "spacing and leading zeros collapse to one token",
);
ok(parseCarPasteList("ELTX\t003105").join("|") === "ELTX 003105", "excel tab paste");
ok(
  parseCarPasteList("ELTX 003105, ELTX3105, ELTX 3105").length === 1,
  "comma-separated duplicates collapse",
);

const sameCar = matchPastedCarsOnList(
  "ELTX 003105\nELTX3105\nELTX 3105\nELTX\t003105",
  awaiting,
);
ok(sameCar.tokens.length === 1 && sameCar.tokens[0] === "ELTX 003105", "duplicate pastes are one token");
ok(sameCar.matchedIds.join(",") === "1", "all four spellings select the padded car");
ok(sameCar.unmatched.length === 0, "a matched car is not listed as missing");

const mixed = matchPastedCarsOnList(
  "ELTX 3105, ELTX3106\nELTX\t003107 ELTX 003200\nNOPE 000099\nNOPE 99\nZZZX 1\nZZZX 000001",
  awaiting,
);
ok(mixed.matchedIds.join(",") === "1,2,3", "space, comma, tab, and newline select the awaiting cars");
ok(
  mixed.unmatched.join("|") === "ELTX 003200|NOPE 000099|ZZZX 000001",
  "missing cars stay unmatched and duplicate spellings collapse",
);
ok(!mixed.matchedIds.includes(4), "a car that was not pasted stays off the selection");

const shortStored = matchPastedCarsOnList("ELTX 003106", [
  { railcar_id: 2, reporting_marks: "ELTX", car_number: "3106" },
]);
ok(shortStored.matchedIds.join(",") === "2" && shortStored.unmatched.length === 0, "pasted leading zeros match a short stored number");

const longStored = matchPastedCarsOnList("ELTX3107", [
  { railcar_id: 3, reporting_marks: "ELTX", car_number: "0003107" },
]);
ok(longStored.matchedIds.join(",") === "3", "a glued mark matches a longer padded number");

const displayOnly = matchPastedCarsOnList("ELTX 3105", [
  { railcar_id: 8, car: "ELTX 003105" },
]);
ok(displayOnly.matchedIds.join(",") === "8", "a formatted car label matches without separate mark fields");

const otherMark = matchPastedCarsOnList("OFOX 003105", awaiting);
ok(otherMark.matchedIds.length === 0 && otherMark.unmatched.join("|") === "OFOX 003105", "same number with another mark is not a match");

const shorter = matchPastedCarsOnList("ELTX 310", awaiting);
ok(shorter.matchedIds.length === 0 && shorter.unmatched.join("|") === "ELTX 000310", "a shorter number is not a substring match");

const empty = matchPastedCarsOnList("   \n", awaiting);
ok(empty.tokens.length === 0 && empty.matchedIds.length === 0 && empty.unmatched.length === 0, "blank paste matches nothing");

const active = { railcar_id: 2, reporting_marks: "ELTX", car_number: "003105", active: true };
const inactive = { railcar_id: 9, reporting_marks: "ELTX", car_number: "003105", active: false };
const preferred = matchPastedCarsOnList("ELTX 3105", [inactive, active]);
ok(preferred.matchedIds.join(",") === "2" && preferred.unmatched.length === 0, "leading zeros still prefer the active car");

const bothActive = matchPastedCarsOnList("ELTX 003105", [active, { ...active, railcar_id: 10 }]);
ok(
  bothActive.matchedIds.join(",") === "2,10" && bothActive.unmatched.length === 0,
  "two active cars with the same mark are both on the list",
);

const listOrder = matchPastedCarsOnList("ELTX 003107\nELTX 003105", awaiting);
ok(listOrder.matchedIds.join(",") === "1,3", "selection follows the awaiting list order");

ok(awaitingPasteSummary(3, 3) === "3 matched and selected", "summary when every match stays checked");
ok(awaitingPasteSummary(3, 1) === "3 matched · 1 selected", "summary after the user unchecks a match");
ok(awaitingPasteSummary(0, 0) === "0 matched and selected", "summary when nothing on the list matched");
ok(
  formatUnmatchedPasteList(mixed.unmatched) === "ELTX 003200\nNOPE 000099\nZZZX 000001",
  "unmatched copy text is one car per line",
);

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log(`ok ${passed}`);
