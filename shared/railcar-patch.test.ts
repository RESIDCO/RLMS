/* eslint-disable no-console */
/** Run: npx tsx shared/railcar-patch.test.ts */

import { activityInsertBody, canonicalChangePair, parseCanonical } from "./canonical-json";
import { insertRailcarSchema } from "./schema";
import { diffRailcarPatch, preprocessRailcarPatchBody, railcarFormPatch } from "./railcar-patch";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const prior = {
  car_type: "Hopper",
  equipment_type_code: null,
  status: "Active/In-Service",
  fleet_status: "Leased",
  entity: "Trinity",
  transit_status: null,
  transit_label: null,
  mechanical_designation: null,
  general_description: null,
  lease_type: null,
  managed: null,
  managed_category: "Keep me",
  lining_material: null,
  sold_to: null,
  ops_flag: null,
  nbv: 100,
  oac: null,
  oec: null,
};

const form = {
  car_type: "Hopper",
  equipment_type_code: "",
  status: "Active/In-Service",
  fleet_status: "Leased",
  entity: "Trinity",
  transit_status: "",
  transit_label: "",
  mechanical_designation: "",
  general_description: "",
  lease_type: "",
  managed: "",
  managed_category: "Keep me",
  lining_material: "",
  sold_to: "",
  ops_flag: "",
  nbv: "0",
  oac: "",
  oec: "",
};

const clientPatch = railcarFormPatch(prior, form);
ok(Object.keys(clientPatch).length === 1 && clientPatch.nbv === 0, "edit form sends only the changed nbv");
ok(!("entity" in clientPatch), "unchanged entity stays off the wire");
ok(!("managed_category" in clientPatch), "unchanged managed category stays off the wire");
ok(!("lining_material" in clientPatch), "a blank that was already empty is not a write");

const blanks = preprocessRailcarPatchBody({ nbv: "", oac: "  ", lining_material: "" });
const blankParsed = insertRailcarSchema.partial().parse(blanks);
ok(blankParsed.nbv === null && blankParsed.oac === null && blankParsed.lining_material === null, "blanks become null before coerce can turn them into 0");

const raw = preprocessRailcarPatchBody({
  ...form,
  car_number: "000001",
  notes: "leave the notes column alone",
  append_note: "separate",
});
const parsed = insertRailcarSchema.partial().parse(raw);
const candidate: Record<string, unknown> = { ...parsed };
delete candidate.car_number;
delete candidate.reporting_marks;
delete candidate.car_initial;
delete candidate.notes;
delete candidate.ops_flag;
delete candidate.fleet_status;
delete candidate.fleet_status_source;
delete candidate.active;
delete candidate.active_status;
delete candidate.active_source;
const serverPatch = diffRailcarPatch(prior, candidate);
ok(Object.keys(serverPatch).length === 1 && serverPatch.nbv === 0, "PATCH writes only the one changed field");
ok(!("entity" in serverPatch), "PATCH does not write an unchanged entity");

const beforeText = '{"id":1,"nbv":100.00,"entity":"Trinity","managed_category":"Keep me"}';
const afterText = '{"id":1,"nbv":0.00,"entity":"Trinity","managed_category":"Keep me"}';
const pair = canonicalChangePair(beforeText, afterText, Object.keys(serverPatch));
ok(pair != null && pair.keys.length === 1 && pair.keys[0] === "nbv", "change capture logs one key");
ok(pair?.beforeJson === '{"nbv":100.00}' && pair?.afterJson === '{"nbv":0.00}', "logged nbv keeps numeric(12,2) scale");

const body = activityInsertBody(
  { action: "railcar_patch", entity_type: "railcar", entity_id: 1, undoable: true },
  pair!.beforeJson,
  pair!.afterJson,
);
const logged = parseCanonical(body);
ok(logged.kind === "obj", "activity insert is one object");
if (logged.kind === "obj") {
  const after = logged.fields.find((field) => field.key === "after");
  ok(after?.value.kind === "obj" && after.value.fields[0]?.value.kind === "num" && after.value.fields[0].value.raw === "0.00", "insert body does not collapse 0.00 to 0");
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
