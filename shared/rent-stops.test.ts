/* eslint-disable no-console */
/** Run: npx tsx shared/rent-stops.test.ts */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KPI_EXPORT_DATA_KEYS, RAILCAR_EXPORT_KEYS } from "./car-export-identity";
import { kpiBucketsForRow, projectRentStopFlags, summarizeKpiCountImpact } from "./kpi-buckets";
import {
  FOCUS_COLUMN_KEYS,
  RENT_STOP_COLUMN_KEYS,
  layoutNeedsFocus,
  openStopFocusFields,
  parseViewLayout,
  rentStopExportCells,
  rentStopExportHeaders,
  selectionNeedsRentStops,
} from "./saved-views";
import {
  SCRAP_STOP_REASON,
  offRentRowStopDate,
  parseOffRentPaste,
  rentStopReasonFields,
} from "./rent-stops";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function src(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

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
ok(
  other.reason === "other" && other.reason_other === "waiting on parts" && other.note == null,
  "other keeps the typed detail as reason_other and does not copy it onto the stop note",
);

const otherSplit = rentStopReasonFields({ reason: "other", reason_other: "waiting on parts", note: "call shop" });
ok(
  otherSplit.reason === "other" && otherSplit.reason_other === "waiting on parts" && otherSplit.note === "call shop",
  "other keeps reason detail and the stop note as different fields",
);

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

const onRent = {
  active: true,
  is_op: true,
  is_sold: false,
  off_rent: false,
  on_rent: true,
  open_abatement: false,
  has_open_commitment: false,
  in_open_program: false,
  going_on_lease: false,
  awaiting_rent_start: false,
  status_tag: "Leased",
};
const beforeOnRent = kpiBucketsForRow(onRent);
function delta(rows: { bucket: string; delta: number }[], bucket: string): number {
  return rows.find((row) => row.bucket === bucket)?.delta ?? 0;
}
const offImpact = summarizeKpiCountImpact([{
  before: beforeOnRent,
  after: kpiBucketsForRow(projectRentStopFlags(onRent, "off_rent")),
}]);
ok(offImpact.length === 0, "a new off-rent stop leaves dashboard tiles unchanged");
ok(projectRentStopFlags(onRent, "off_rent").off_rent === false, "a new off-rent stop keeps the assignment off-rent flag");

const afterAbate = kpiBucketsForRow(projectRentStopFlags(onRent, "abatement"));
const abateImpact = summarizeKpiCountImpact([{ before: beforeOnRent, after: afterAbate }]);
ok(delta(abateImpact, "on_rent") === -1 && delta(abateImpact, "rental_abatement") === 1, "abatement leaves on rent and enters abatement");
ok(delta(abateImpact, "off_rent") === 0, "abatement does not enter off rent");

const abated = { ...onRent, open_abatement: true, on_rent: false };
const convertImpact = summarizeKpiCountImpact([{
  before: kpiBucketsForRow(abated),
  after: kpiBucketsForRow(projectRentStopFlags(abated, "convert")),
}]);
ok(delta(convertImpact, "rental_abatement") === -1 && delta(convertImpact, "on_rent") === 1, "converting an abatement returns the car to on rent");
ok(delta(convertImpact, "off_rent") === 0, "convert does not enter the assignment off-rent tile");
ok(summarizeKpiCountImpact([{ before: ["on_rent"], after: ["on_rent"] }]).length === 0, "a preview with no tile change has no count rows");

const exported = rentStopExportCells({
  open_stop_type: "Off rent",
  open_stop_since: "2026-10-01",
  open_stop_days: 12,
  open_stop_expected: null,
  open_stop_reason: "waiting on parts",
  open_stop_note: "call shop",
});
ok(rentStopExportHeaders().join("|") === "Rent stop|Stop since|Days stopped|Expected resume|Stop reason|Stop note", "rent-stop export headers");
ok(exported[2] === 12 && exported[4] === "waiting on parts" && exported[5] === "call shop", "export keeps days numeric and the note separate from the reason");
ok(selectionNeedsRentStops(["open_stop_note"]) && !selectionNeedsRentStops(["marks", "lessee"]), "a selected stop column is what asks a list to load stops");
ok(RENT_STOP_COLUMN_KEYS.every((key) => (KPI_EXPORT_DATA_KEYS as readonly string[]).includes(key)), "KPI export can include every rent-stop column");

const drawer = src("client/src/pages/railcars/BulkEditDrawer.tsx");
ok(
  /rentStopReasonFields\(\{\s*reason: stopReason,\s*reason_other: stopDetail,\s*note: stopNote\s*\}\)/.test(drawer),
  "bulk drawer passes reason detail and stop note as different fields",
);
ok(!drawer.includes("note: stopDetail"), "bulk drawer does not save the reason detail as the stop note");

const bulkPage = src("client/src/pages/CommitmentOps.tsx");
const bulkStart = bulkPage.indexOf("export function BulkRentStopsPage");
const bulkEnd = bulkPage.indexOf("export function BulkRentStartPage");
const bulk = bulkPage.slice(bulkStart, bulkEnd);
ok(bulk.includes("useState(false)") && bulk.includes("copy_car_note: true"), "car-note copy is an opt-in that starts off");
ok(bulk.includes("kpi_counts"), "bulk preview renders dashboard counts");
ok(!bulk.includes("appendNoteBody"), "bulk rent stops does not copy the stop note onto the car unless the checkbox is sent");

const applySrc = src("server/rent-stops.ts");
const applyAt = applySrc.indexOf('app.post("/api/rent-stops/bulk/apply"');
ok(applyAt > 0 && applySrc.includes("summarizeKpiCountImpact"), "bulk preview summarizes dashboard counts");
ok(applySrc.includes("kpi_note") && applySrc.includes('kind === "abatement" || kind === "off_rent" || kind === "convert"'), "off rent, convert, and abatement preview the dashboard counts");
const applyHandler = applySrc.slice(applyAt);
ok(applyHandler.includes("copy_car_note === true") && !applyHandler.includes("append_note"), "bulk apply copies a car note only from the checkbox");

const grids = [
  "client/src/pages/FleetRegistry.tsx",
  "client/src/pages/Search.tsx",
  "client/src/pages/ProgramDetail.tsx",
  "client/src/pages/LeaseManagement.tsx",
  "client/src/pages/FleetBrowse.tsx",
  "client/src/pages/KpiCarList.tsx",
  "client/src/pages/Accounts.tsx",
];
for (const path of grids) {
  const text = src(path);
  ok(
    text.includes("open_stop_note") || text.includes("RENT_STOP_COLUMN_KEYS"),
    `${path} can show the rent-stop columns, including Stop note`,
  );
}
ok(src("server/programs.ts").includes("RENT_STOP_COLUMN_KEYS"), "program Excel report includes rent-stop columns");
ok(src("server/lease-export.ts").includes("rentStopExportHeaders"), "lease workbook car sheet includes rent-stop columns");
ok(src("server/turning50-export.ts").includes("rentStopExportHeaders"), "turning-50 workbook car sheet includes rent-stop columns");
ok(src("server/kpi-cars.ts").includes("selectionNeedsRentStops"), "KPI export loads stop columns when they are selected");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
