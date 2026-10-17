/* eslint-disable no-console */
/** Run: npx tsx client/src/lib/hash-location.test.ts */

import { contactsDirectoryPath, readDirectoryNavState } from "./directory-nav";
import { isDirectoryLeaseReviewTab } from "./directory-review-tab";
import {
  carPathFromProgram,
  decodeHashFrom,
  encodeHashFrom,
  parseHashSearch,
  programPathWithFrom,
  programsPathFromQuery,
} from "./hash-location";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(isDirectoryLeaseReviewTab(new URLSearchParams("tab=leases")), "tab=leases opens lease review");
ok(isDirectoryLeaseReviewTab(new URLSearchParams("tab=lease_gaps")), "tab=lease_gaps opens lease review");
ok(!isDirectoryLeaseReviewTab(new URLSearchParams("tab=pending_review")), "other tabs stay on default");
ok(!isDirectoryLeaseReviewTab(new URLSearchParams("")), "missing tab stays on default");

const dir = readDirectoryNavState(new URLSearchParams("q=Agrex&contact=12&company=4&view=people&lease=1"));
ok(dir.q === "Agrex" && dir.contactId === 12 && dir.companyId === 4 && dir.people && dir.leaseTied, "directory hash params parse");
ok(
  contactsDirectoryPath(dir) === "/contacts?q=Agrex&company=4&contact=12&view=people&lease=1",
  "directory path round-trips people + lease filters",
);
ok(contactsDirectoryPath({ q: "", companyId: null, contactId: null, people: false, leaseTied: false }) === "/contacts", "empty directory path");
ok(
  contactsDirectoryPath({ q: "Agrex", companyId: null, contactId: null, people: true, leaseTied: false, addContact: true }) === "/contacts?q=Agrex&view=people&add=1",
  "add=1 opens the add-contact dialog",
);
ok(readDirectoryNavState(new URLSearchParams("add=1")).addContact === true, "add=1 parses");

const kpiQs = parseHashSearch("#/kpi/cars?bucket=idle&car=5");
ok(kpiQs.get("bucket") === "idle" && kpiQs.get("car") === "5", "#/kpi/cars?bucket=idle&car=5 → bucket=idle, car=5");
ok(parseHashSearch("#/kpi/cars").get("bucket") == null, "hash without query is empty");

const listQuery = "status=closed&q=West Plains&type=Return";
ok(decodeHashFrom(encodeHashFrom(listQuery)) === listQuery, "encodeHashFrom/decodeHashFrom round-trip");
ok(encodeHashFrom("?" + listQuery) === encodeHashFrom(listQuery), "encodeHashFrom strips leading ?");
ok(decodeHashFrom("") === "" && decodeHashFrom(null) === "", "empty from decodes to empty");

const programHref = programPathWithFrom(12, listQuery);
ok(programHref.startsWith("/programs/12?from="), "program path carries from=");
const programParsed = parseHashSearch("#" + programHref);
ok(programParsed.get("from") === listQuery, "parseHashSearch get(from) restores list query");
ok(programsPathFromQuery(programParsed.get("from")) === `/programs?${listQuery}`, "back path is /programs?{list query}");
ok(programPathWithFrom(12, "") === "/programs/12", "no from when list query is empty");
ok(programsPathFromQuery(null) === "/programs", "no from returns plain /programs");

const programQuery = programHref.slice(programHref.indexOf("?") + 1);
const carHref = carPathFromProgram(99, 12, programQuery);
ok(carHref.includes("from_program=12"), "car path carries from_program");
const carParsed = parseHashSearch("#" + carHref);
ok(carParsed.get("from_program") === "12", "from_program id round-trips");
ok(carParsed.get("from") === programQuery, "car from= is encoded program query");
const backToProgram = `/programs/12?${carParsed.get("from")}`;
ok(
  parseHashSearch("#" + backToProgram).get("from") === listQuery,
  "program from= still restores list query after car hop",
);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
