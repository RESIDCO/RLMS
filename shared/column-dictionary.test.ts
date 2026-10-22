/* eslint-disable no-console */
/** Run: npx tsx shared/column-dictionary.test.ts */

import {
  RENDERED_COLUMNS,
  getColumn,
  getKpiReason,
  columnLabel,
  COLUMN_DICTIONARY,
} from "./column-dictionary";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

for (const [listKey, keys] of Object.entries(RENDERED_COLUMNS)) {
  for (const colKey of keys) {
    const entry = getColumn(listKey, colKey);
    ok(!!entry, `${listKey}.${colKey} has a dictionary entry`);
    if (entry) {
      ok(Boolean(entry.label.trim()), `${listKey}.${colKey} has a label`);
      ok(Boolean(entry.meaning.trim()), `${listKey}.${colKey} has meaning`);
      ok(Boolean(entry.source.trim()), `${listKey}.${colKey} has source`);
      ok(Boolean(entry.derivation.trim()), `${listKey}.${colKey} has derivation`);
    }
  }
}

ok(columnLabel("kpi_cars", "status_tag") === "Status tag", "status_tag label");
ok(columnLabel("kpi_cars", "derived_status") === "KPI status", "derived_status label");
ok(columnLabel("kpi_cars", "current_lease") === "Current lease", "current_lease label");
ok(columnLabel("kpi_cars", "reason") === "Why in KPI", "reason label");
ok(
  getColumn("kpi_cars", "derived_status")!.meaning.includes("Going On Lease"),
  "derived_status meaning includes Going On Lease",
);
ok(
  getColumn("kpi_cars", "derived_status")!.meaning.includes("rent start blank counts as on rent"),
  "derived_status meaning blank rent start",
);
ok(getColumn("kpi_cars", "derived_status")!.source === "calculated", "derived_status source");
ok(
  getColumn("kpi_cars", "rent_start_date")!.source === "railcar_assignments.rent_start_date",
  "rent start source",
);

ok(!!getKpiReason("open Commitment"), "reason value: open Commitment");
ok(!!getKpiReason("Sold – needs tag"), "reason value: Sold – needs tag");
ok(!!getKpiReason("program"), "reason value: program");
ok(!!getKpiReason("Going On Lease"), "reason value: Going On Lease");
ok(!!getKpiReason("no link"), "reason value: no link");
ok(!getKpiReason(null), "blank reason has no entry");

ok(!!getColumn("program_cars", "cf:lining_type"), "custom field fallback");
ok(columnLabel("program_cars", "ops_flag") === "Scrap flag", "program cars scrap flag");
ok(columnLabel("program_cars", "scrapped_at") === "Scrapped date", "program cars scrapped date");
ok(columnLabel("programs", "type") === "Type", "programs type is program type");
ok(columnLabel("fleet_registry", "type") === "Car type", "fleet type is car type");
ok(COLUMN_DICTIONARY["derived_status"]?.label === "KPI status", "shared derived_status");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
