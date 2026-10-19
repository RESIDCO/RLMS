/* eslint-disable no-console */
/** Run: npx tsx shared/programs.test.ts */

import { expandRangeEnd, parseCarPasteList, parseCarPasteListDetailed } from "./programs";

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

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
