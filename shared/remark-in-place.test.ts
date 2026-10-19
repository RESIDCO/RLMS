/* eslint-disable no-console */
/** Run: npx tsx shared/remark-in-place.test.ts */

import { readFileSync } from "node:fs";
import { buildVcfReview } from "./vcf-import.ts";
import { formerlyFromHistory, identitiesInSearch } from "./prior-mark.ts";
import {
  REMARK_CONFIRM,
  buildRemarkAliasIndex,
  classifyRemarkBatch,
  parseRemarkText,
  remarkHistoryReason,
  remarkPreviewToCsv,
  selectRemarkApply,
  type RemarkCarRecord,
} from "./remark-in-place.ts";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const parsed = parseRemarkText("KCS 310100 > OFOX 310100\nKCS 310101 -> OFOX\n");
ok(parsed.ok && parsed.rows.length === 2, "parses arrow lines");
if (parsed.ok) {
  ok(parsed.rows[1].new_mark === "OFOX" && parsed.rows[1].new_number === "310101", "missing new number keeps the old number");
}
const csv = parseRemarkText("Prefix,Number,Remark\nKCS,310102,OFOX\n");
ok(csv.ok && csv.rows[0].old_number === "310102" && csv.rows[0].new_mark === "OFOX", "headered csv maps prefix/number/remark");

const sheet = parseRemarkText("Prefix\tNumber\tRemark\tRemark\nKCS\t310664\tOFOX\t310664\n");
ok(sheet.ok && sheet.rows[0].new_mark === "OFOX" && sheet.rows[0].new_number === "310664", "duplicate Remark header is mark then number");

const tooMany = parseRemarkText(Array.from({ length: 501 }, (_, i) => `KCS ${310000 + i} > OFOX`).join("\n"));
ok(!tooMany.ok && tooMany.ok === false && tooMany.error.includes("500"), "batch cap");

function car(partial: Partial<RemarkCarRecord> & Pick<RemarkCarRecord, "id" | "car_number">): RemarkCarRecord {
  return {
    reporting_marks: "KCS",
    car_initial: "KCS",
    active: true,
    status: "Active/In-Service",
    fleet_status: "Idle",
    lessee_name: "IDLE (xCPKC)",
    rider_external_id: "EA2608",
    assignment_label: null,
    program: "CP ACQUISITION",
    ...partial,
  };
}

const catalog = [
  car({ id: 15568, car_number: "310100" }),
  car({ id: 15569, car_number: "310101", active: false }),
  car({ id: 20, car_number: "310200", reporting_marks: "OFOX", car_initial: "OFOX", program: null }),
  car({
    id: 15570,
    car_number: "310102",
    reporting_marks: "OFOX",
    car_initial: "OFOX",
    old_car_initial: "KCS",
    old_car_number: "310102",
  }),
];

const preview = classifyRemarkBatch({
  rows: [...(parsed.ok ? parsed.rows : []), ...(csv.ok ? csv.rows : [])],
  cars: catalog,
  history: [{ railcar_id: 15570, old_car_initial: "KCS", old_car_number: "310102" }],
});
const byNum = new Map(preview.rows.map((row) => [row.old_number, row]));
ok(byNum.get("310100")?.status === "ready" && byNum.get("310100")?.railcar_id === 15568, "active match is ready");
ok(byNum.get("310100")?.program === "CP ACQUISITION" && byNum.get("310100")?.lease === "EA2608", "preview shows program and lease");
ok(byNum.get("310101")?.status === "inactive", "inactive is skipped");
ok(byNum.get("310102")?.status === "already", "already the new mark via history");

const clash = classifyRemarkBatch({
  rows: [{ line: 1, input: "KCS 310100 > OFOX 310200", old_mark: "KCS", old_number: "310100", new_mark: "OFOX", new_number: "310200" }],
  cars: catalog,
  history: [],
});
ok(clash.rows[0].status === "clash" && clash.rows[0].clash?.id === 20, "clash shows the other record");

const missing = classifyRemarkBatch({
  rows: [{ line: 1, input: "KCS 999999 > OFOX 999999", old_mark: "KCS", old_number: "999999", new_mark: "OFOX", new_number: "999999" }],
  cars: catalog,
  history: [],
});
ok(missing.rows[0].status === "not_found", "unknown car");

const moved = classifyRemarkBatch({
  rows: [{ line: 1, input: "KCS 310102 > GATX 310102", old_mark: "KCS", old_number: "310102", new_mark: "GATX", new_number: "310102" }],
  cars: catalog,
  history: [{ railcar_id: 15570, old_car_initial: "KCS", old_car_number: "310102" }],
});
ok(moved.rows[0].status === "moved" && moved.rows[0].message.includes("OFOX 310102"), "prior mark with a different target is not applied");

const blocked = selectRemarkApply(preview, "all");
ok(!blocked.ok, "all-or-none refuses a batch with skipped rows");
const good = selectRemarkApply(preview, "good");
ok(good.ok && good.items.length === 1 && good.items[0].id === 15568, "good mode keeps the ready row");
ok(good.ok && good.items[0].reporting_marks === "OFOX" && good.items[0].car_number === "310100", "apply item keeps the number");

const onlyReady = classifyRemarkBatch({
  rows: [{ line: 1, input: "KCS 310100 > OFOX", old_mark: "KCS", old_number: "310100", new_mark: "OFOX", new_number: "310100" }],
  cars: catalog,
  history: [],
});
const allOk = selectRemarkApply(onlyReady, "all");
ok(allOk.ok && allOk.items.length === 1, "all-or-none applies a clean batch");
ok(remarkPreviewToCsv(onlyReady.rows).includes("ready"), "preview csv includes status");
ok(remarkHistoryReason("Remark KCS to OFOX", "c1aba9e8-5741-4de7-b104-f84a68effcf8").includes("change_group c1aba9e8"), "history reason carries the change group");
ok(REMARK_CONFIRM === "REMARK", "typed confirmation word");

const aliases = buildRemarkAliasIndex({
  cars: catalog,
  history: [{ railcar_id: 15570, old_car_initial: "KCS", old_car_number: "310102" }],
});
ok(aliases.get("KCS|310102") && aliases.get("KCS|310102") !== "ambiguous" && aliases.get("KCS|310102").railcarId === 15570, "alias index maps the old mark");

const vcfExisting = new Map([["OFOX|310100", { active: true, active_source: "auto" }]]);
const vcfAliases = new Map([["KCS|310100", { railcarId: 15568, currentMark: "OFOX", currentNumber: "310100" }]]);
const oldOnly = buildVcfReview(
  [{ CAR_INITIAL: "KCS", CAR_NUMBER: "310100", ACTIVE: "-1", ASSIGNMENT_ID: "1" }],
  new Set(vcfExisting.keys()),
  { keepCars: true, existingCars: vcfExisting, remarkAliases: vcfAliases },
);
ok(oldOnly.newCars === 0 && oldOnly.remarkedAliasCount === 1, "old mark is not a new car");
ok(oldOnly.remarkedAliases[0].action === "skip" && oldOnly.remarkedAliases[0].label.includes("OFOX 310100"), "preview label names the current mark");
ok(oldOnly.remarkedAliases[0].file_active === true, "active old-mark row is flagged");
ok(oldOnly.cars[0].isNew === false && oldOnly.cars[0].remarkAlias != null, "alias row is not inserted");
ok(oldOnly.projectedTotalCars === 1, "projected fleet does not grow");

const both = buildVcfReview(
  [
    { CAR_INITIAL: "KCS", CAR_NUMBER: "310100", ACTIVE: "-1", ASSIGNMENT_ID: "1" },
    { CAR_INITIAL: "OFOX", CAR_NUMBER: "310100", ACTIVE: "-1", ASSIGNMENT_ID: "2" },
  ],
  new Set(vcfExisting.keys()),
  { keepCars: true, existingCars: vcfExisting, remarkAliases: vcfAliases },
);
ok(both.newCars === 0 && both.updatedCars === 1, "when both marks are in the file, the new mark is the update");
ok(both.remarkedAliases[0].action === "ignore_old_keep_new", "old mark is ignored when the new mark is present");

const ambiguous = buildVcfReview(
  [{ CAR_INITIAL: "KCS", CAR_NUMBER: "310100", ACTIVE: "0", ASSIGNMENT_ID: "1" }],
  new Set(vcfExisting.keys()),
  { keepCars: true, existingCars: vcfExisting, remarkAliases: new Map([["KCS|310100", "ambiguous"]]) },
);
ok(ambiguous.newCars === 0 && ambiguous.remarkedAliases[0].action === "ambiguous", "ambiguous old mark is not inserted");
ok(ambiguous.remarkedAliases[0].file_active === false, "inactive old mark is not an active warning");

const untouched = buildVcfReview(
  [{ CAR_INITIAL: "NEWX", CAR_NUMBER: "000001", ACTIVE: "-1", ASSIGNMENT_ID: "9" }],
  new Set<string>(),
  { keepCars: false },
);
ok(untouched.newCars === 1 && untouched.remarkedAliasCount === 0, "a real new car is unchanged without an alias");

ok(identitiesInSearch("KCS 310100\nOFOX 1").length === 2, "search text yields mark+number identities");
const badges = formerlyFromHistory(
  [{ id: 15570, reporting_marks: "OFOX", car_number: "310102" }],
  identitiesInSearch("KCS 310102"),
  [{ railcar_id: 15570, old_car_initial: "KCS", old_car_number: "310102" }],
);
ok(badges.get(15570) === "formerly KCS 310102", "search badge uses the prior mark");

const sql = readFileSync(new URL("../migrations/20261112_remark_in_place.sql", import.meta.url), "utf8");
ok(sql.includes("remark_railcars_in_place"), "migration defines the in-place function");
ok(!sql.includes("CREATE OR REPLACE FUNCTION public.remark_railcars("), "migration does not replace retire-and-create");
ok(sql.includes("DELETE FROM public.car_number_history"), "undo removes history rows");
ok(sql.includes("change_group "), "history delete matches the reason marker");
ok(!/rent_events/i.test(sql.replace(/never touch rent_events/i, "")), "migration does not reference rent_events except the comment");
ok(sql.includes("'mark_change'") && sql.includes("'op', 'update'"), "activity rows match the undo format");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
