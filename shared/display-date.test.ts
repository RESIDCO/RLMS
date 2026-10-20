/** Run: npx tsx shared/display-date.test.ts */
import { formatCalendarDate } from "./lease-authority";
import { formatUsDate, formatUsDateTimeEt, hasClockTime } from "./display-date";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(formatUsDate("2026-10-20") === "10/20/2026", "date-only is MM/DD/YYYY and does not shift a day");
ok(formatUsDate("2026-01-05") === "01/05/2026", "month and day are zero-padded");
ok(formatUsDate("") === "" && formatUsDate(null) === "", "blank date stays blank");
ok(formatCalendarDate("2026-10-20") === "10/20/2026", "shared calendar formatter is MM/DD/YYYY");
ok(formatCalendarDate(null) === "—", "missing calendar date is an em dash");

const stamped = formatUsDateTimeEt("2026-10-20T16:30:00.000Z");
ok(stamped === "10/20/2026 12:30 PM ET", `timestamp is Eastern and labeled ET (${stamped})`);
ok(formatUsDateTimeEt("2026-10-20") === "10/20/2026", "date-only timestamp helper has no clock");
ok(hasClockTime("2026-10-20T16:30:00.000Z") && !hasClockTime("2026-10-20"), "clock time is detected only when present");
ok(formatUsDate("2026-10-20T03:30:00.000Z") === "10/19/2026", "a UTC instant before midnight ET uses the Eastern calendar day");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
