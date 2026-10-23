/* eslint-disable no-console */
/** Run: npx tsx shared/rent-stops.test.ts */

import { RAILCAR_EXPORT_KEYS } from "./car-export-identity";
import {
  FOCUS_COLUMN_KEYS,
  layoutNeedsFocus,
  openStopFocusFields,
  parseViewLayout,
} from "./saved-views";
import {
  SCRAP_STOP_REASON,
  offRentRowStopDate,
  parseOffRentPaste,
  rentStopReasonFields,
} from "./rent-stops";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const scrap = rentStopReasonFields({ reason: SCRAP_STOP_REASON, note: "frame cracked" });
ok(scrap.reason === "other" && scrap.reason_other === SCRAP_STOP_REASON && scrap.note === "frame cracked", "scrap stores the label in reason_other and the note separately");

const scrapAgain = rentStopReasonFields(scrap);
ok(
  scrapAgain.reason === "other" && scrapAgain.reason_other === SCRAP_STOP_REASON && scrapAgain.note === "frame cracked",
  "coercing scrap twice keeps the label and the note",
);

const named = rentStopReasonFields({ reason: "quality repair", reason_other: "shop", note: "" });
ok(named.reason === "quality repair" && named.reason_other == null && named.note === "shop", "a named reason keeps its code and puts detail on the note");

const other = rentStopReasonFields({ reason: "other", reason_other: "waiting on parts" });
ok(other.reason === "other" && other.reason_other === "waiting on parts", "other keeps the typed detail as reason_other");

let threw = false;
try {
  rentStopReasonFields({ reason: "not-a-reason" }, { strict: true });
} catch {
  threw = true;
}
ok(threw, "abatement still rejects an unknown reason");

const rows = parseOffRentPaste(`car, date, note
TFOX 001000, 2026-09-09
TFOX 001036, 2026-10-16, uneconomical to repair
HWCX 10823\t2026-10-01\tcut up
TILX543210 2026-08-02 wheels
`);
ok(rows.length === 4, "header is skipped and four cars remain");
ok(rows[0].car === "TFOX 001000" && rows[0].stop_date === "2026-09-09" && rows[0].note == null, "comma row without a note");
ok(rows[1].stop_date === "2026-10-16" && rows[1].note === "uneconomical to repair", "comma row keeps the note");
ok(rows[2].car === "HWCX 10823" && rows[2].stop_date === "2026-10-01" && rows[2].note === "cut up", "tab row keeps date and note");
ok(rows[3].car === "TILX543210" && rows[3].stop_date === "2026-08-02" && rows[3].note === "wheels", "date in the line is enough");
ok(new Set(rows.map((row) => row.stop_date)).size === 4, "each pasted car keeps its own date");
ok(offRentRowStopDate(null, "2026-10-23") === "2026-10-23", "a missing row date uses the form date");
ok(offRentRowStopDate("2026-09-09", "2026-10-23") === "2026-09-09", "a row date wins over the form date");
ok(offRentRowStopDate("nope", "") === "", "a bad date does not become a stop date");

const shown = openStopFocusFields([{
  type: "Off rent",
  stop_date: "2026-10-01",
  reason: "other",
  reason_other: SCRAP_STOP_REASON,
  note: "frame cracked",
  actual_resume_date: null,
}]);
ok(shown.open_stop_reason === SCRAP_STOP_REASON && shown.open_stop_note === "frame cracked", "Stop reason shows scrap and Stop note shows the note");

const legacy = parseViewLayout({
  v: 1,
  cols: ["marks", "car_number", "open_stop_type", "latest_note", "scrapped_at"],
  order: ["marks", "car_number", "open_stop_type", "latest_note", "scrapped_at"],
});
ok(legacy.ok === true, "a saved view from before Stop note still parses");
const withNote = parseViewLayout({
  v: 1,
  cols: ["open_stop_note", "tags", "umler_status", "program_name"],
  order: ["marks", "car_number", "open_stop_note"],
});
ok(withNote.ok === true, "Stop note is an allowed saved-view column");
ok(FOCUS_COLUMN_KEYS.includes("open_stop_note"), "focus keys include the stop note");
ok(layoutNeedsFocus(["open_stop_note"]), "choosing Stop note asks the list to fill focus columns");
ok(layoutNeedsFocus(["program_name", "tags", "scrapped_at", "umler_status"]), "program, tags, scrapped, and UMLER ask for focus columns");
ok(!layoutNeedsFocus(["marks", "lessee"]), "identity columns do not ask for focus columns");
ok((RAILCAR_EXPORT_KEYS as readonly string[]).includes("open_stop_note"), "CSV export includes Stop note");
ok((RAILCAR_EXPORT_KEYS as readonly string[]).includes("open_stop_reason"), "CSV export includes Stop reason");
ok((RAILCAR_EXPORT_KEYS as readonly string[]).includes("tags"), "CSV export includes Tags");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
