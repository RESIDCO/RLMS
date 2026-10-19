/* eslint-disable no-console */
/** Run: npx tsx shared/program-tracker-sync.test.ts */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  APPLY_TABLES,
  GLOBAL_PROGRAM_CAR_COLUMN_ORDER,
  NEW_SHOPS,
  applyCustomPatch,
  brcCells,
  buildApplyCar,
  carChangedSince,
  carMatchKeys,
  classifyCell,
  columnOrderFromHeaders,
  groupByProgram,
  identityKeys,
  matchShop,
  parseCurrency,
  parseDate,
  parseBoolean,
  typeValue,
  placeTraceDetails,
  planTouchesRentEvents,
  reclassifyEvidenceRow,
  resolveColumnLayout,
  resolveTrackerSheet,
  snapshotMatches,
  summaryPrograms,
  trackerOrderForProgram,
  undoCarFields,
  writesOnly,
  type PlannedChange,
  type RlmsCar,
} from "./program-tracker-sync";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(identityKeys("ELTX/OFCX", "003370").join(",") === "ELTX|3370,OFCX|3370", "split mark and drop leading zeros");
ok(identityKeys("TFOX", "000401").join(",") === "TFOX|401", "leading zeros ignored");
ok(identityKeys("tfox", 401).join(",") === "TFOX|401", "mark is uppercased");

const keys = carMatchKeys({
  reporting_marks: "TGCX",
  car_number: "3370",
  custom_fields: { old_reporting_mark: "ELTX", old_car_number: "003370" },
});
ok(keys.has("TGCX|3370") && keys.has("ELTX|3370"), "match on old or new mark and number");

ok(parseDate("7/6/2026") === "2026-07-06", "m/d/yyyy date");
ok(parseDate(new Date(Date.UTC(2026, 6, 15))) === "2026-07-15", "UTC midnight date stays on that calendar day");
ok(typeValue(new Date(Date.UTC(2026, 1, 25)), "text") === "2026-02-25", "text column stores an Excel date as ISO");
const sameDay = classifyCell({
  field: "return_location",
  column: "custom_fields",
  type: "text",
  current: "2026-02-25",
  raw: new Date(Date.UTC(2026, 1, 25)),
  inactive: false,
});
ok(sameDay.action === "skip", "ISO text date matches the Excel date and is not rewritten");
const code6Zero = classifyCell({
  field: "original_code6",
  column: "custom_fields",
  type: "currency",
  current: null,
  raw: 0,
  inactive: false,
});
ok(code6Zero.action === "code6 zero" && code6Zero.proposed === 0, "Code 6 zero into a blank cell is its own category");
const badDate = classifyCell({
  field: "arrived_shop_date",
  column: "custom_fields",
  type: "date",
  current: null,
  raw: "4//8/2026",
  inactive: false,
});
ok(badDate.action === "review" && badDate.note === "value doesn't fit the field type" && badDate.proposed === "4//8/2026", "typo date is a review with the reason");
ok(parseCurrency("$2,978.769") === 2978.77, "currency to 2dp");
ok(parseBoolean("Y") === true && parseBoolean("N") === false, "Y/N booleans");

const shops = [
  { id: 14, name: "Gerdau - Midlothian, TX" },
  { id: 19, name: "Radius - Gadsden, AL" },
];
ok(matchShop("  gerdau - midlothian, tx ", shops).id === 14, "shop match is normalized exact");
ok(matchShop("PFL-St Louis TRRA", shops).status === "missing", "unknown shop is not free text");
ok(matchShop("Not a shop", shops).status === "missing", "unapproved shop stays missing");

const newShop = classifyCell({
  field: "shop_id",
  column: "shop_id",
  type: "text",
  current: null,
  raw: "PFL-St Louis TRRA",
  inactive: false,
  shop: { status: "missing", id: null, name: "PFL-St Louis TRRA" },
});
ok(newShop.action === "fill blank" && newShop.note.startsWith("new shop:"), "approved new shop is a write, not free text");

const reviewShop = classifyCell({
  field: "shop_id",
  column: "shop_id",
  type: "text",
  current: null,
  raw: "Erman Corp-Kansas City",
  inactive: false,
  shop: { status: "missing", id: null, name: "Erman Corp-Kansas City" },
});
ok(reviewShop.action === "review", "unmatched shop stays in review");

const inactive = classifyCell({
  field: "trace_date",
  column: "custom_fields",
  type: "date",
  current: null,
  raw: "10/1/2026",
  inactive: true,
});
ok(inactive.action === "skip", "inactive cars are never writes");

const trinityNa = classifyCell({
  field: "outbound_target_date",
  column: "custom_fields",
  type: "date",
  current: "N/A",
  raw: "N/A",
  inactive: false,
});
ok(trinityNa.action === "clear" && trinityNa.proposed == null, "N/A blanks outside OL1826");

const olNa = classifyCell({
  field: "arrived_shop_date",
  column: "custom_fields",
  type: "date",
  current: "N/A",
  raw: "n/a",
  inactive: false,
});
ok(olNa.action === "clear", "N/A blanks OL1826 too");

const blankStays = classifyCell({
  field: "notes",
  column: "notes",
  type: "text",
  current: "keep me",
  raw: "",
  inactive: false,
});
ok(blankStays.action === "skip", "a blank cell does not clear a real value");

const brc = brcCells({ raw: "7/6/2026", currentFlag: null, currentDate: null, inactive: false });
ok(brc.some((c) => c.field === "brc_complete" && c.proposed === true), "BRC date sets the flag");
ok(brc.some((c) => c.field === "brc_complete_date" && c.proposed === "2026-07-06"), "BRC date sets brc_complete_date");

const evidenceNa = reclassifyEvidenceRow({
  program: "345-cars xTrinity cars",
  program_car_id: 1,
  car: "ELTX 3370",
  field: "outbound_target_date",
  current: "N/A",
  proposed: "N/A (clear)",
  action: "review - sheet N/A would clear RLMS value (outside OL1826)",
}, shops);
ok(evidenceNa?.action === "clear" && evidenceNa.active, "evidence N/A review becomes a clear");

const evidenceShop = reclassifyEvidenceRow({
  program: "CP ACQUISITION - 60 4750's",
  program_car_id: 42,
  car: "KCS 310671",
  field: "shop_location",
  current: null,
  proposed: "Port Harbor RR-Granite City, IL",
  action: "review - shop name not in shops table",
}, shops);
ok(evidenceShop?.action === "fill blank" && evidenceShop.field === "shop_id" && evidenceShop.note.startsWith("new shop:"), "new shop review becomes shop_id");

const evidenceClearMarker = reclassifyEvidenceRow({
  program: "OL1826 - Ingevity",
  program_car_id: 1133,
  car: "TFOX 9174",
  field: "arrived_shop_date",
  current: "N/A",
  proposed: "(clear)",
  action: "update",
}, shops);
ok(evidenceClearMarker?.action === "clear" && evidenceClearMarker.proposed == null, "OL1826 (clear) marker blanks the field");

const evidenceShopId = reclassifyEvidenceRow({
  program: "OL1826 - Ingevity",
  program_car_id: 1,
  car: "TFOX 1",
  field: "shop_id",
  current: null,
  proposed: "Gerdau - Midlothian, TX",
  action: "fill blank",
}, shops);
ok(evidenceShopId?.action === "fill blank" && evidenceShopId.proposed === 14, "matched shop fill stores shop id");

const evidenceInactive = reclassifyEvidenceRow({
  program: "xOL2526 - Solvay Return",
  program_car_id: 9,
  car: "SMNX 750",
  field: "status",
  current: "old",
  proposed: "new",
  action: "inactive car - no change",
}, shops);
ok(evidenceInactive == null, "inactive evidence rows are dropped");

const rlms: RlmsCar = {
  program_car_id: 42,
  program_id: 7,
  program_name: "CP ACQUISITION - 60 4750's",
  railcar_id: 100,
  active: true,
  exited: false,
  reporting_marks: "KCS",
  car_number: "310671",
  status: "Arrived",
  notes: null,
  shop_id: null,
  shop_name: null,
  custom_fields: { outbound_target_date: "N/A", trace_date: "2026-01-01" },
};
const changes: PlannedChange[] = [
  {
    program: rlms.program_name,
    program_id: 7,
    program_car_id: 42,
    railcar_id: 100,
    car: "KCS 310671",
    active: true,
    field: "outbound_target_date",
    column: "custom_fields",
    action: "clear",
    current: "N/A",
    proposed: null,
    note: "N/A blanks the field",
  },
  {
    program: rlms.program_name,
    program_id: 7,
    program_car_id: 42,
    railcar_id: 100,
    car: "KCS 310671",
    active: true,
    field: "shop_id",
    column: "shop_id",
    action: "fill blank",
    current: null,
    proposed: null,
    note: "new shop: PFL-St Louis TRRA",
  },
];
const applyCar = buildApplyCar(rlms, changes);
ok(applyCar?.custom_patch.outbound_target_date === null, "apply patch clears N/A");
ok(applyCar?.shop_name === "PFL-St Louis TRRA" && applyCar.set_shop, "apply carries the new shop name");
ok(applyCar?.expect.active === true, "snapshot expects an active car");
const patched = applyCustomPatch(rlms.custom_fields, applyCar!.custom_patch);
ok(patched.outbound_target_date == null && patched.trace_date === "2026-01-01", "clear removes only the N/A key");

const undone = undoCarFields(applyCar!.fields);
ok(undone.custom_patch.outbound_target_date === "N/A", "per-car undo restores the old N/A");
ok(undone.shop_id.set && undone.shop_id.value == null, "per-car undo clears the new shop");
const restored = applyCustomPatch(patched, undone.custom_patch);
ok(restored.outbound_target_date === "N/A", "undo puts the field back");

ok(!snapshotMatches({ ...applyCar!.expect, active: false }, applyCar!.expect), "inactive snapshot fails closed");
ok(snapshotMatches(applyCar!.expect, applyCar!.expect), "unchanged snapshot matches");
ok(carChangedSince({}, applyCar!.fields, patched, rlms.status, 55), "changed shop blocks a second undo");

const grouped = groupByProgram(writesOnly([...changes, { ...changes[0], program_car_id: 1, active: false, action: "skip" }]));
ok(grouped[rlms.program_name].clear === 1 && grouped[rlms.program_name]["fill blank"] === 1, "groups fill and clear");

const order = columnOrderFromHeaders([
  "Reporting Mark",
  "Railcar Number",
  "Trace Date",
  "L or E",
  "Event Text",
  "Train ID",
  "Destination City",
  "Destination State",
  "Reporting RR",
  "Off Rent Date",
]);
ok(order[0] === "car", "mark and car number collapse to the car column");
ok(order.indexOf("cf:trace_date") < order.indexOf("cf:trace_loaded_or_empty"), "L/E follows trace date");
ok(order.indexOf("cf:trace_loaded_or_empty") < order.indexOf("cf:trace_reporting_rr"), "trace details stay together");
ok(!order.some((k) => k.includes("rent")), "off-rent is not a column");
ok(!planTouchesRentEvents([...APPLY_TABLES]), "apply tables exclude rent_events");

const cp = trackerOrderForProgram("CP ACQUISITION - 60 4750's");
ok(Boolean(cp?.includes("cf:nld_to") && cp.includes("shop") && cp.includes("cf:trace_event_text")), "CP tab order includes shop and trace detail");
ok(GLOBAL_PROGRAM_CAR_COLUMN_ORDER.includes("cf:brc_complete_date"), "new programs show BRC complete date");
ok(!GLOBAL_PROGRAM_CAR_COLUMN_ORDER.includes("cf:gate_1_clearance"), "optional globals are hidden on the default");

const layout = resolveColumnLayout({
  user: { cols: ["notes"] },
  programShared: { cols: ["shop", "status"] },
  categoryShared: { cols: ["cf:due_for"] },
  globalShared: { cols: ["car"] },
  builtin: [...GLOBAL_PROGRAM_CAR_COLUMN_ORDER],
});
ok(layout.source === "user" && layout.cols[0] === "notes", "user view wins");
const programLayout = resolveColumnLayout({
  user: null,
  programShared: { cols: ["shop"], order: ["shop", "status"] },
  categoryShared: { cols: ["cf:due_for"] },
  globalShared: { cols: ["car"] },
  builtin: ["car"],
});
ok(programLayout.source === "program", "program shared default is next");
const categoryLayout = resolveColumnLayout({
  user: null,
  programShared: null,
  categoryShared: { cols: ["cf:due_for"] },
  globalShared: { cols: ["car"] },
  builtin: ["car"],
});
ok(categoryLayout.source === "category", "category default follows the program");
const builtin = resolveColumnLayout({
  user: null,
  programShared: null,
  categoryShared: null,
  globalShared: null,
  builtin: ["car", "shop"],
});
ok(builtin.source === "builtin", "builtin global order is last");

const summary = summaryPrograms([
  [1, "Bahnline", "RESIDCO", "ACQUISITION", "CP ACQUISITION"],
  [null, "ADM", "N/A", "RAS Issue Cars", "Live Estimates Issue Cars"],
  [null, "ADM", "N/A", "Shop details", "Shop Selection Details"],
]);
ok(summary.filter((s) => s.active_scope).map((s) => s.sheet).join(",") === "CP ACQUISITION", "ADM and reference tabs are out of scope");
ok(resolveTrackerSheet("OL2405 - The Andersons", ["OL2405 - Andersons"]) === "OL2405 - Andersons", "Andersons summary name opens the tracker tab");
ok(resolveTrackerSheet("VARIES - SOLD TO TRIPLE M", ["OL-VARIES - SOLD TO TRIPLE M"]) === "OL-VARIES - SOLD TO TRIPLE M", "Triple M summary name opens the tracker tab");
ok(resolveTrackerSheet("CP ACQUISITION", ["CP ACQUISITION"]) === "CP ACQUISITION", "matching tab names stay put");

ok(NEW_SHOPS.length === 2, "two shops are approved");

const started = Date.now();
const bulk: PlannedChange[] = [];
for (let i = 0; i < 3200; i += 1) {
  bulk.push({
    program: "P",
    program_id: 1,
    program_car_id: i + 1,
    railcar_id: i + 1,
    car: `TFOX ${i}`,
    active: true,
    field: "trace_date",
    column: "custom_fields",
    action: "fill blank",
    current: null,
    proposed: "2026-10-01",
    note: "",
  });
}
const cars = bulk.map((row) => buildApplyCar({
  ...rlms,
  program_car_id: row.program_car_id,
  railcar_id: row.railcar_id,
  custom_fields: {},
}, [row]));
ok(cars.filter(Boolean).length === 3200 && Date.now() - started < 1500, "3k-row apply plan stays in memory under 1.5s");

const moved = placeTraceDetails(["cf:trace_loaded_or_empty", "cf:trace_date", "shop"]);
ok(moved.indexOf("cf:trace_date") < moved.indexOf("cf:trace_loaded_or_empty"), "trace detail is moved after trace date");

const migration = readFileSync(new URL("../migrations/20261112_program_global_optional_fields.sql", import.meta.url), "utf8");
ok(!/insert\s+into\s+(public\.)?rent_events/i.test(migration), "migration does not insert rent_events");
ok(!/update\s+(public\.)?rent_events/i.test(migration), "migration does not update rent_events");
ok(migration.includes("r.active IS NOT TRUE"), "apply fails closed when a car is inactive");
ok(migration.includes("rent_events are out of scope"), "snapshot cannot carry rent_events");
ok(migration.includes("v_list_key text") && migration.includes("v_view_name text"), "layout plpgsql variables are prefixed");
ok(!/(^|\n)\s*list_key text;/.test(migration) && !/(^|\n)\s*view_name text;/.test(migration), "layout variables do not clash with user_column_prefs columns");

if (process.env.RLMS_DATE_TZ_CHILD === "1") {
  const sample = new Date(Date.UTC(2026, 6, 15));
  ok(sample.getTimezoneOffset() === 240, `child process is America/New_York (offset ${sample.getTimezoneOffset()})`);
} else {
  const child = spawnSync(process.execPath, ["--import", "tsx", "shared/program-tracker-sync.test.ts"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, TZ: "America/New_York", RLMS_DATE_TZ_CHILD: "1" },
    encoding: "utf8",
  });
  ok(child.status === 0, `dates parsed under TZ=America/New_York\n${child.stdout}\n${child.stderr}`);
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
