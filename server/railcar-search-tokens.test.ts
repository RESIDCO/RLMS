/* eslint-disable no-console */
/**
 * Run: npx tsx server/railcar-search-tokens.test.ts
 */
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key";

const { railcarSearchTokens } = await import("./railcar-list");

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

function tagged(raw: string) {
  return railcarSearchTokens(raw).find((t: { value: string; carNumberOnly?: boolean }) => /^\d+$/.test(t.value))?.carNumberOnly === true;
}

ok(tagged("OFOX102"), "OFOX102 tags the number half");
ok(tagged("OFOX 102"), "OFOX 102 tags the number half");
ok(tagged("ofox 102"), "ofox 102 tags the number half");
ok(tagged("OFOX000102"), "OFOX000102 tags the number half");
ok(tagged("OFOX 000102"), "OFOX 000102 tags the number half");
ok(!tagged("102"), "bare 102 is not carNumberOnly");
ok(!railcarSearchTokens("OL1248").some((t: { carNumberOnly?: boolean }) => t.carNumberOnly), "OL1248 is not a mark+number pair");
ok(
  railcarSearchTokens("Agrex").every((t: { carNumberOnly?: boolean }) => !t.carNumberOnly),
  "lessee-only query has no carNumberOnly token",
);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
