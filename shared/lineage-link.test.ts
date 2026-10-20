/** Run: npx tsx shared/lineage-link.test.ts */
import { lineageCarHref, lineageCarQuery, safeLineageBack } from "./lineage-link";
import { lineageSearchPath } from "./lineage-search";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(lineageCarQuery({ id: 5, reporting_marks: "TILX", car_number: "100" }) === "TILX 100", "mark and number are the Lineage query");
ok(lineageCarQuery({ id: 5, query: "GATX 9" }) === "GATX 9", "an explicit car label wins");
ok(lineageCarQuery({ id: 12 }) === "12", "a bare id is the query when there is no mark");
ok(
  lineageCarHref({ id: 5, reporting_marks: "TILX", car_number: "100" }, "/railcars?rider_id=3")
    === "/history?q=TILX%20100&back=%2Frailcars%3Frider_id%3D3",
  "the link stays in the app and keeps a back path",
);
ok(safeLineageBack("/kpi/cars?bucket=idle") === "/kpi/cars?bucket=idle", "an internal path is a safe back target");
ok(safeLineageBack("//evil.example") === null, "a protocol-relative back path is ignored");
ok(safeLineageBack("https://evil.example") === null, "an external back path is ignored");
ok(safeLineageBack("/ok\\evil") === null, "a back path with a slash escape is ignored");
ok(lineageSearchPath("TILX 100", "/programs/4") === "/history?q=TILX%20100&back=%2Fprograms%2F4", "a new search keeps the back path");
ok(lineageSearchPath("TILX 100") === "/history?q=TILX%20100", "a search without a back path stays a query URL");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
