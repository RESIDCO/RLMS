/* eslint-disable no-console */
/** Run: npx tsx shared/program-grid.test.ts */

import { programCarFleetFrozen } from "./program-car-fleet";
import { formatProgramDate, parseProgramDateInput } from "./program-dates";
import { programCarMatchesQuery } from "./program-car-filter";
import { isCompleteProgramStatus, mergeProgramStatusOptions, statusLeavesComplete } from "./program-status";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(formatProgramDate("2024-11-18") === "11/18/2024", "ISO date displays MM/DD/YYYY");
ok(formatProgramDate("2024-11-18T00:00:00.000Z") === "11/18/2024", "a timestamp keeps the calendar date");
ok(formatProgramDate("11/2024") === "11/2024", "month-only text displays MM/YYYY");
ok(formatProgramDate("2024-11") === "11/2024", "ISO month displays MM/YYYY");
ok(formatProgramDate(null) === "", "blank date stays blank");
ok(parseProgramDateInput("10/10/26") === "2026-10-10", "MM/DD/YY stores ISO");
ok(parseProgramDateInput("10/10/2026") === "2026-10-10", "MM/DD/YYYY stores ISO");
ok(parseProgramDateInput("2026-10-10") === "2026-10-10", "ISO stores ISO");
ok(parseProgramDateInput("11/2024") === "2024-11", "month-only stores YYYY-MM");
ok(parseProgramDateInput("") === null, "clearing a date stores null");
ok(parseProgramDateInput("02/31/2026") === undefined, "impossible day is rejected");
ok(formatProgramDate(parseProgramDateInput("10/10/26")) === "10/10/2026", "typed 10/10/26 displays with a 4-digit year");
const stored = "2024-11-18";
formatProgramDate(stored);
ok(stored === "2024-11-18", "display does not rewrite the stored date");

const choices = mergeProgramStatusOptions(
  [
    { value: "AT SHOP", sort_order: 10 },
    { value: "COMPLETE – ARRIVED GEON", sort_order: 20 },
  ],
  ["COMPLETE – ARRIVED GEON", "ENROUTE"],
);
ok(choices.join("|") === "AT SHOP|COMPLETE – ARRIVED GEON|ENROUTE", "catalog and in-use statuses are one list");
ok(isCompleteProgramStatus("COMPLETE – ARRIVED GEON"), "complete label");
ok(statusLeavesComplete("AT SHOP"), "in-progress status leaves complete");
ok(statusLeavesComplete(""), "clearing status leaves complete");
ok(!statusLeavesComplete("COMPLETE – ARRIVED GEON"), "another complete label stays complete");

const trinity = {
  reporting_marks: "TFOX",
  car_number: "003107",
  status: "COMPLETE – ARRIVED GEON",
  shop: "Curry-Hockley",
  custom: { remark_date: "2024-11" },
};
ok(programCarMatchesQuery(trinity, "3107"), "filter matches the car number without leading zeros");
ok(programCarMatchesQuery(trinity, "TFOX 3107"), "filter matches mark and number");
ok(programCarMatchesQuery(trinity, "TFOX003107"), "filter matches a glued mark and number");
ok(programCarMatchesQuery(trinity, "curry"), "filter matches shop");
ok(programCarMatchesQuery(trinity, "complete"), "filter matches status");
ok(!programCarMatchesQuery(trinity, "TGCX"), "filter excludes other marks");
ok(programCarFleetFrozen({ active: false, status: "Storage" }), "active false is frozen");
ok(programCarFleetFrozen({ active: true, status: "Inactive" }), "Inactive status is frozen");
ok(!programCarFleetFrozen({ active: true, status: "Off-Lease" }), "an active Off-Lease car is not frozen");
ok(!programCarFleetFrozen({ active: null, status: "Storage" }), "a missing active flag is not frozen by itself");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
