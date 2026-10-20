/** Run: npx tsx shared/lineage-search.test.ts */
import { lineageSearchCommit, lineageSearchPath, lineageSearchRequests, LINEAGE_SEARCH_DEBOUNCE_MS } from "./lineage-search";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(LINEAGE_SEARCH_DEBOUNCE_MS >= 250, "search waits before it requests");
const burst = ["h", "hw", "hwc", "hwcx 100"];
ok(lineageSearchRequests(burst).join("|") === "hwcx 100", "a typing burst is one request for the last query");
ok(lineageSearchRequests(burst).length === 1, "intermediate keystrokes are not requests");
ok(lineageSearchPath("hwcx 100") === "/history?q=hwcx%20100", "the settled query is kept in the URL");
ok(lineageSearchPath("  ") === "/history", "an empty query clears the URL");

const again = lineageSearchCommit("hwcx 100", "hwcx 100");
ok(!again.push && again.settled === "hwcx 100", "refresh of the same URL does not push another entry");
const back = lineageSearchCommit("hwcx", "hwcx 100");
ok(back.push && back.path === "/history?q=hwcx", "a different settled query is a history entry Back can restore");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
