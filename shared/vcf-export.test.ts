/* eslint-disable no-console */
/** Run: npx tsx shared/vcf-export.test.ts */

import {
  V_VALID_EXPORT_HEADERS,
  buildVValidExportRows,
  excelDateFromIso,
  exportRowToValues,
  exportVcfActive,
  exportVcfEndDate,
  exportVcfEntity,
  exportVcfStartDate,
  includeHistoryForExport,
  lesseeFromAssignmentLabel,
  type VValidCarAttrs,
  type VValidHistoryRow,
} from "./vcf-export";

let passed = 0;
let failed = 0;

function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(V_VALID_EXPORT_HEADERS[0] === "UPDATE MADE", "header 1 UPDATE MADE");
ok(V_VALID_EXPORT_HEADERS[1] === " UPDATE NEEDED NEXT VCF", "header 2 leading space");
ok(V_VALID_EXPORT_HEADERS.length === 27, "27 columns");
ok(V_VALID_EXPORT_HEADERS[25] === "Entity", "Entity column");
ok(V_VALID_EXPORT_HEADERS[26] === "MECHANICAL_DESIGNATION", "last column");

ok(exportVcfEntity("Rail Partners Select") === "Rail Partners Select", "entity keep RPS name");
ok(exportVcfEntity("RPS") === "Rail Partners Select", "entity expand RPS");
ok(exportVcfEntity("Coal") === "Coal", "entity Coal");
ok(exportVcfEntity("Main") === "Main", "entity Main");

ok(exportVcfEndDate(null) === "4000-12-31", "null end → 4000");
ok(exportVcfEndDate("1901-01-01") === "1901-01-01", "1901 end as-is");
ok(exportVcfStartDate(null, "vcf-import") === "1901-01-01", "null start vcf-import → 1901");
ok(exportVcfStartDate(null, "move-cars") === "", "null start other stays blank");
ok(exportVcfStartDate("2006-08-06", "vcf-import") === "2006-08-06", "real start kept");

ok(exportVcfActive(true, true) === -1, "active period -1");
ok(exportVcfActive(true, false) === 0, "inactive car forces 0");
ok(exportVcfActive(false, true) === 0, "inactive period 0");

ok(
  lesseeFromAssignmentLabel("ADM - OL1917", "OL1917") === "ADM",
  "strip own rider",
);
ok(
  lesseeFromAssignmentLabel("xADM - OL1917", "OL1917") === "xADM",
  "keep leading x",
);
ok(
  lesseeFromAssignmentLabel("ADM - OL1917 - EA1739", "OL1917") === "ADM",
  "strip leftover rider token",
);
ok(
  lesseeFromAssignmentLabel("Southwest Rail - SOLD", "") === "Southwest Rail",
  "strip trailing SOLD",
);

const load = "load-latest";
ok(includeHistoryForExport({ last_seen_load_id: load, moved_by: "vcf-import" }, load), "stamped latest");
ok(
  !includeHistoryForExport({ last_seen_load_id: "old", moved_by: "vcf-import" }, load),
  "old stamp excluded",
);
ok(
  includeHistoryForExport({ last_seen_load_id: null, moved_by: "move-cars" }, load),
  "RLMS-created included",
);
ok(
  !includeHistoryForExport({ last_seen_load_id: null, moved_by: "vcf-import" }, load),
  "unstamped vcf-import excluded",
);

const car: VValidCarAttrs = {
  id: 1,
  car_initial: "OFCX",
  car_number: "075192",
  car_type: "T106",
  mechanical_designation: "T",
  general_description: "tank",
  dot_code: null,
  lining_material: null,
  lease_type: null,
  managed: null,
  managed_category: null,
  entity: "Rail Partners Select",
  legal_owner: "RESIDCO",
  legacy_valid_car_id: "9",
  client_id: "12",
  cover_sheet: null,
  update_made: null,
  update_needed_next_vcf: null,
  rider_external_id: "OL1917",
  assignment_label: "ADM - OL1917",
  lessee_name: "ADM",
  active: true,
  acquisition_date: "2006-08-06",
};
const testCar: VValidCarAttrs = { ...car, id: 2, car_initial: "TEST", car_number: "999012" };
const ah: VValidHistoryRow = {
  id: 10,
  railcar_id: 1,
  rider_external_id: "OL1917",
  assignment_label: "ADM - OL1917",
  start_date: "2006-08-06",
  end_date: null,
  active: true,
  comment: null,
  assignment_id_ext: "55",
  last_seen_load_id: load,
  moved_by: "vcf-import",
  valid_car_id_ext: 12345,
};
const leftover: VValidHistoryRow = {
  ...ah,
  id: 11,
  last_seen_load_id: null,
};
const rows = buildVValidExportRows([ah, leftover], [car, testCar], [], load);
ok(rows.length === 1, "stamp filter + TEST drop");
ok(rows[0].VALID_CAR_ID === 12345, "VALID_CAR_ID from valid_car_id_ext");
ok(rows[0].Entity === "Rail Partners Select", "entity not abbreviated");
ok(rows[0].END_DATE === "4000-12-31", "open end sentinel");
ok(rows[0].CAR_NUMBER === 75192, "CAR_NUMBER numeric");

const values = exportRowToValues(rows[0]);
ok(values.length === 27, "value row 27");
ok(values[1] === "", "needed-next blank");
ok(values[8] instanceof Date, "START_DATE is Date");
ok(values[9] instanceof Date, "END_DATE is Date");
const end = values[9] as Date;
ok(end.getFullYear() === 4000 && end.getMonth() === 11 && end.getDate() === 31, "4000-12-31 local");
ok(excelDateFromIso("1901-01-01") instanceof Date, "1901 date object");

if (failed) {
  console.error(`FAILED ${failed} / ${passed + failed}`);
  process.exit(1);
}
console.log(`ok ${passed}`);
