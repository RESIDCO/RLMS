/* eslint-disable no-console */
/** Run: npx tsx shared/remark-unified.test.ts */

import { readFileSync } from "node:fs";
import { skipVcfRailcarPatch } from "./vcf-assignment-closeout";
import { buildVcfReview } from "./vcf-import";
import { classifyRemarkBatch, type RemarkCarRecord } from "./remark-in-place";
import {
  firstOutsideRecordId,
  frozenFkOutsideUnchecked,
  isRemarkRetireGroup,
  remarkOutsideUndoMessage,
  remarkUndoTableAllowed,
} from "./remark-group";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const sql = readFileSync(new URL("../migrations/20261125_remark_unified.sql", import.meta.url), "utf8");
const sqlCode = sql.replace(/--.*$/gm, "");
const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
const remarkRoutes = readFileSync(new URL("../server/remark-routes.ts", import.meta.url), "utf8");
const undoSrc = readFileSync(new URL("../server/undo.ts", import.meta.url), "utf8");
const applySrc = readFileSync(new URL("../server/remark-apply.ts", import.meta.url), "utf8");

ok(sql.includes("remark_railcars_apply"), "migration defines the shared function");
ok(sql.includes("SELECT public.remark_railcars_apply"), "both older RPCs delegate to it");
ok(!sql.includes("CREATE OR REPLACE FUNCTION public.rlms_apply_jsonb_patch"), "does not replace rlms_apply_jsonb_patch");
ok(!sql.includes("CREATE OR REPLACE FUNCTION public.rlms_undo_change_group"), "does not replace rlms_undo_change_group");
ok(!sql.includes("CREATE OR REPLACE FUNCTION public.rlms_referenced_outside_group"), "does not replace rlms_referenced_outside_group");
ok(!sql.includes("CREATE OR REPLACE FUNCTION public.rlms_fk_outside_group"), "does not replace rlms_fk_outside_group");
ok(!/insert\s+into\s+(public\.)?rent_events/i.test(sqlCode), "does not insert rent_events");
ok(!/update\s+(public\.)?rent_events/i.test(sqlCode), "does not update rent_events");
ok(!/delete\s+from\s+(public\.)?rent_events/i.test(sqlCode), "does not delete rent_events");
ok(sql.includes("Only an active car can be remarked"), "inactive source is refused");
ok(sql.includes("Remark will not merge into it"), "an existing target is not merged");
ok(sql.includes("GRANT EXECUTE ON FUNCTION public.remark_railcars_apply"), "apply is granted");
ok(sql.includes("TO service_role"), "execute is limited to service_role");
ok(sql.includes("REVOKE ALL ON FUNCTION public.remark_railcars_apply"), "public execute is revoked");
ok(!/create\s+(or\s+replace\s+)?view/i.test(sqlCode), "no new view");
ok(!/create\s+table/i.test(sqlCode), "no new table");

const changeStart = routes.indexOf('app.post("/api/railcars/:id/change-number"');
const bulkEnd = routes.indexOf('app.delete("/api/railcars/:id"');
const handlers = routes.slice(changeStart, bulkEnd);
ok(handlers.includes("applyRemark(") && handlers.includes("remarkFailure("), "car-detail and bulk routes call applyRemark");
ok(!handlers.includes("recordNonUndoable") && !handlers.includes('rpc("remark_railcars"'), "those routes no longer record a non-undoable remark");
ok(handlers.includes("undoable: true"), "the HTTP result is undoable");
ok(remarkRoutes.includes("applyRemarkInPlace") && remarkRoutes.includes("remarkFailure"), "bulk remark route uses the same apply");
ok(!remarkRoutes.includes("remark_railcars_in_place"), "bulk route does not call the old RPC");
ok(applySrc.includes("remark_railcars_apply"), "server apply calls the shared function");
ok(undoSrc.includes("rlms_undo_remark_group") && undoSrc.includes("isRemarkRetireGroup"), "undo routes a remark group to its own function");
ok(sql.includes("public.rlms_referenced_outside_group("), "undo calls rlms_referenced_outside_group");
ok(sql.includes("public.rlms_fk_outside_group("), "undo calls rlms_fk_outside_group");
ok(sql.includes("assignment history was added on the new car after the remark"), "a later assignment history row gets a clear refusal");
ok(sql.includes("an assignment was added on the new car after the remark"), "a later assignment row gets a clear refusal");
ok(!sql.includes("reason LIKE"), "history is deleted by the logged row id, not by reason text");
ok(
  undoSrc.includes('rpc("rlms_referenced_outside_group"') && undoSrc.includes('rpc("rlms_fk_outside_group"'),
  "undo preview calls both frozen reference checks",
);
ok(firstOutsideRecordId([4, 9], [4]) === 9, "a child row logged in the group is not an outside reference");
ok(firstOutsideRecordId([4], [4]) == null, "only logged child rows do not block");
ok(frozenFkOutsideUnchecked("referenced-since: table program_cars is not checked"), "the frozen table refusal is recognized");
ok(!frozenFkOutsideUnchecked("function public.rlms_fk_outside_group does not exist"), "a missing function is not treated as an empty check");
ok(
  remarkOutsideUndoMessage("assignment history", 12).includes("record 12") &&
    remarkOutsideUndoMessage("assignment history", 12).includes("will not delete it"),
  "preview names the later assignment history row",
);
ok(
  remarkOutsideUndoMessage("a program membership", 7).includes("program membership"),
  "preview names a later program membership",
);

ok(
  isRemarkRetireGroup([{ action: "mark_change", table_name: "railcars", detail: { op: "insert" } }]),
  "a new-car insert is a remark group",
);
ok(
  !isRemarkRetireGroup([{ action: "mark_change", table_name: "railcars", detail: { op: "update" } }]),
  "an older in-place update is not this group",
);
const remarkRows = [{ action: "mark_change", table_name: "railcars", detail: { op: "insert" } }];
ok(remarkUndoTableAllowed("car_number_history", remarkRows), "preview allows the history row");
ok(!remarkUndoTableAllowed("car_number_history", []), "history stays blocked outside a remark");
ok(remarkUndoTableAllowed("railcars", []), "railcars stay undoable");

function car(partial: Partial<RemarkCarRecord> & Pick<RemarkCarRecord, "id" | "car_number">): RemarkCarRecord {
  return {
    reporting_marks: "KCS",
    car_initial: "KCS",
    active: true,
    status: "Active/In-Service",
    fleet_status: "Leased",
    lessee_name: "Acme",
    rider_external_id: "OL1",
    assignment_label: null,
    program: null,
    ...partial,
  };
}

const inactiveTarget = classifyRemarkBatch({
  rows: [{ line: 1, input: "KCS 310100 > OFOX 310100", old_mark: "KCS", old_number: "310100", new_mark: "OFOX", new_number: "310100" }],
  cars: [
    car({ id: 1, car_number: "310100" }),
    car({ id: 9, car_number: "310100", reporting_marks: "OFOX", car_initial: "OFOX", active: false, status: "Off-Lease" }),
  ],
  history: [],
});
ok(
  inactiveTarget.rows[0].status === "clash" && inactiveTarget.rows[0].message.includes("inactive") && inactiveTarget.rows[0].message.includes("will not merge"),
  "preview refuses an inactive target without offering a merge",
);

const retired = new Map([
  ["KCS|310100", { active: false, active_source: "manual", status: "Off-Lease" }],
  ["OFOX|310100", { active: true, active_source: "auto", status: "Active/In-Service" }],
]);
const vcf = buildVcfReview(
  [{ CAR_INITIAL: "KCS", CAR_NUMBER: "310100", ACTIVE: "-1", ASSIGNMENT_ID: "1" }],
  new Set(retired.keys()),
  {
    keepCars: true,
    existingCars: retired,
    remarkAliases: new Map([["KCS|310100", { railcarId: 2, currentMark: "OFOX", currentNumber: "310100" }]]),
  },
);
ok(vcf.newCars === 0 && vcf.remarkedAliasCount === 0, "an old mark that is already a row is not inserted and is not treated as an alias");
ok(vcf.skippedManualCars.length === 1, "the review records the retired row as manual");
ok(
  skipVcfRailcarPatch({ active_source: "manual", active: false, status: "Off-Lease" }),
  "commit skips every field on that retired row",
);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
