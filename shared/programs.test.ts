/* eslint-disable no-console */
/** Run: npx tsx shared/programs.test.ts */

import {
  decidePastedCar,
  decidePriorIdentityPaste,
  expandRangeEnd,
  formerlyOnLabel,
  labelWithFormerly,
  parseCarPasteList,
  parseCarPasteListDetailed,
  pasteSearchBatches,
  programPickerFromSearch,
} from "./programs";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(parseCarPasteList("TFOX 2248\nTFOX 000430, KBX 123").length === 3, "paste list splits");
ok(parseCarPasteList("TFOX\t3297").join("|") === "TFOX 003297", "tab + zero-pad");
ok(parseCarPasteList("TFOX  3297\nTFOX 003297").length === 1, "spaces and pad collapse to one car");
ok(parseCarPasteList("TFOX 401\nTFOX 402").length === 2, "newline list still works");
ok(parseCarPasteList("TFOX000401").join("|") === "TFOX 000401", "glued mark+number still works");
ok(parseCarPasteList("TFOX-401").join("|") === "TFOX 000401", "dashed single car still works");
ok(parseCarPasteList("TFOX 401, 402, 405").length === 3, "comma list still works");

const range = parseCarPasteListDetailed("TFOX 401-449");
ok(range.tokens.length === 49, "TFOX 401-449 → 49 tokens");
ok(range.tokens[0] === "TFOX 000401", "range starts at 401");
ok(range.tokens[48] === "TFOX 000449", "range ends at 449");
ok(range.expandedFrom.length === 1 && range.expandedFrom[0].count === 49, "range expansion is reported");
ok(range.rejectedRanges.length === 0, "a valid range is not rejected");
ok(!range.tokens.some((t) => t.includes("401449")), "hyphen no longer glues the numbers");

const thru = parseCarPasteListDetailed("TFOX 000401 thru 000449");
ok(thru.tokens.length === 49, "TFOX 000401 thru 000449 → 49");
ok(thru.tokens[0] === "TFOX 000401" && thru.tokens[48] === "TFOX 000449", "thru range keeps width");
ok(!thru.tokens.some((t) => t.startsWith("THRU")), "THRU is not a reporting mark");

const through = parseCarPasteListDetailed("TFOX 000401 through 000403");
ok(through.tokens.length === 3, "through is a connector");
const toWord = parseCarPasteListDetailed("TFOX 10 to 12");
ok(toWord.tokens.length === 3 && !toWord.tokens.some((t) => t.startsWith("TO ")), "TO is not a reporting mark");

const inherited = parseCarPasteListDetailed("TFOX 100, 401-449");
ok(inherited.tokens.includes("TFOX 000100"), "mark earlier on the line is kept");
ok(inherited.tokens.includes("TFOX 000401") && inherited.tokens.includes("TFOX 000449"), "401-449 inherits the mark");
ok(inherited.tokens.length === 50, "inherited range adds 49 cars plus the earlier one");

const backwards = parseCarPasteListDetailed("TFOX 401-399");
ok(backwards.tokens.length === 1 && backwards.tokens[0] === "TFOX 401-399", "descending range stays as-is");
ok(backwards.rejectedRanges.length === 1 && /backwards/i.test(backwards.rejectedRanges[0].message), "descending range is flagged");
ok(!backwards.tokens.some((t) => t.includes("401399")), "descending range is not glued");

const tooLong = parseCarPasteListDetailed("TFOX 1-502");
ok(tooLong.rejectedRanges.length === 1 && /longer than 500/i.test(tooLong.rejectedRanges[0].message), "span over 500 is rejected");
ok(tooLong.tokens.length === 1, "an over-long range is not expanded");
ok(tooLong.expandedFrom.length === 0, "an over-long range has no expansion");

const atCap = parseCarPasteListDetailed("1-501");
ok(atCap.rejectedRanges.length === 0 && atCap.tokens.length === 501, "end − start of 500 is allowed");

ok(expandRangeEnd("401", "49") === "449", "shorter end keeps the start's leading digits");
ok(expandRangeEnd("000401", "49") === "000449", "padded shorter end");
const shortEnd = parseCarPasteListDetailed("TFOX 401-49");
ok(shortEnd.tokens.length === 49 && shortEnd.tokens[48] === "TFOX 000449", "TFOX 401-49 means 401–449");

const enDash = parseCarPasteListDetailed("TFOX 401–403");
ok(enDash.tokens.length === 3, "en dash is a range");

const ofoxList = [
  "OFOX815215",
  "OFOX815220",
  "OFOX815253",
  "OFOX815269",
  "OFOX815283",
  "OFOX815321",
  "OFOX815337",
  "OFOX815346",
  "OFOX815360",
  "OFOX815412",
  "OFOX815437",
  "OFOX815460",
  "OFOX815496",
  "OFOX816411",
  "OFOX820013",
  "OFOX820016",
  "OFOX820022",
  "OFOX826940",
].join("\n");
const ofoxTokens = parseCarPasteList(ofoxList);
ok(ofoxTokens.length === 18, "18 glued OFOX lines stay 18 cars");
ok(ofoxTokens[0] === "OFOX 815215" && ofoxTokens[17] === "OFOX 826940", "glued MARKNUMBER splits and keeps the number");
ok(parseCarPasteList("OFOX    815215").join("|") === "OFOX 815215", "several spaces still split mark and number");
ok(parseCarPasteList("OFOX-815215").join("|") === "OFOX 815215", "MARK-NUMBER is one car");
ok(parseCarPasteList("0FOX815215").join("|") === "OFOX 815215", "leading zero before a mark is the letter O");
ok(parseCarPasteList("0FOX 815215").join("|") === "OFOX 815215", "spaced 0FOX stays paired with its number");
ok(parseCarPasteList("OFOX 0815215").join("|") === "OFOX 815215", "a leading zero on the number collapses");
ok(parseCarPasteList("OFOX 815215\nOFOX 0815215").length === 1, "padded and unpadded number are the same car");

const activeOfox = { id: 2, reporting_marks: "OFOX", car_initial: "OFOX", car_number: "815215", active: true };
const inactiveTwin = { id: 9, reporting_marks: "NDYX", car_initial: "OFOX", car_number: "815215", active: false };
const inactiveSameMark = { id: 3, reporting_marks: "OFOX", car_initial: "OFOX", car_number: "815215", active: false };
const marked = decidePastedCar({ marks: "OFOX", number: "815215", cars: [inactiveTwin, activeOfox] });
ok(marked.kind === "match" && marked.car.id === 2, "a mark prefers the active car and ignores the other mark");
const sameMark = decidePastedCar({ marks: "OFOX", number: "0815215", cars: [inactiveSameMark, activeOfox] });
ok(sameMark.kind === "match" && sameMark.car.id === 2, "leading zeros still prefer the active car with that mark");
const bare = decidePastedCar({ marks: null, number: "815215", cars: [inactiveTwin, activeOfox] });
ok(bare.kind === "ambiguous" && bare.matches.length === 2 && /pick one/i.test(bare.reason), "a bare number that hits two cars asks for a choice");
const twoActive = decidePastedCar({
  marks: "OFOX",
  number: "815215",
  cars: [activeOfox, { ...activeOfox, id: 4 }],
});
ok(twoActive.kind === "ambiguous", "two active cars with the same mark stay a choice");

const batches = pasteSearchBatches(ofoxList);
ok(batches.batches.length === 1 && batches.batches[0].split("\n").length === 18, "18 cars are one search batch");
const many = Array.from({ length: 81 }, (_, i) => `TFOX ${i + 1}`).join("\n");
ok(pasteSearchBatches(many).batches.length === 2, "81 cars are two search batches");

const preview = programPickerFromSearch([
  {
    railcars: [activeOfox, inactiveTwin, { id: 8, reporting_marks: "OFOX", car_number: "826940", active: false }],
    not_found: ["NOPE 1"],
    ambiguous: [{
      token: "815215",
      reason: "This number matches more than one car. Pick one.",
      matches: [
        { id: 2, label: "OFOX 815215", active: true },
        { id: 9, label: "NDYX 815215", active: false },
      ],
    }],
    already_in_program: [{ railcar_id: 7, label: "OFOX 816411", token: "OFOX 816411" }],
  },
]);
ok(preview.matched.length === 0, "cars that need a choice are not auto-added");
ok(preview.ambiguous.length === 1 && preview.ambiguous[0].matches.some((m) => m.railcar_id === 2), "the bare duplicate is a choice");
ok(preview.not_found.some((row) => row.token === "OFOX 826940" && /inactive/i.test(row.reason ?? "")), "an inactive unique car is explained");
ok(preview.not_found.some((row) => row.token === "NOPE 1"), "missing tokens are kept");
ok(preview.already_in_program[0]?.railcar_id === 7, "cars already on the program are listed separately");
const clean = programPickerFromSearch([{
  railcars: ofoxTokens.slice(0, 3).map((token, i) => {
    const [marks, num] = token.split(" ");
    return { id: 100 + i, reporting_marks: marks, car_number: num, active: true };
  }),
  not_found: [],
  ambiguous: [],
}]);
ok(clean.matched.length === 3 && clean.not_found.length === 0, "unique active cars from search are the ones to add");

const remarkedOfox = {
  id: 15570,
  reporting_marks: "OFOX",
  car_initial: "OFOX",
  car_number: "310100",
  active: true,
};
const pastedKcs = decidePastedCar({ marks: "KCS", number: "310100", cars: [remarkedOfox] });
ok(pastedKcs.kind === "none", "KCS 310100 is not the current identity of the OFOX car");
const priorKcs = decidePriorIdentityPaste({ marks: "KCS", number: "310100", cars: [remarkedOfox] });
ok(
  priorKcs.kind === "match" && priorKcs.car.id === 15570,
  "one prior identity resolves KCS 310100 to OFOX 310100",
);
ok(
  labelWithFormerly("OFOX 310100", "KCS 310100", remarkedOfox) === "OFOX 310100 (formerly KCS 310100)",
  "pasting KCS 310100 labels the OFOX car with (formerly KCS 310100)",
);
ok(
  formerlyOnLabel("OFOX 310100", "KCS 310100") === "OFOX 310100 (formerly KCS 310100)",
  "a program-car label uses the same formerly suffix",
);
ok(labelWithFormerly("OFOX 310100", "OFOX 310100", remarkedOfox) === "OFOX 310100", "the current mark stays a plain label");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
