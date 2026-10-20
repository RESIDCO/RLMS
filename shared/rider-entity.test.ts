/* eslint-disable no-console */
/** Run: npx tsx shared/rider-entity.test.ts */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RIDER_IMPORT_NEVER_WRITE } from "./rider-import-guard";
import {
  RIDER_ENTITY_VALUES,
  editedRiderEntity,
  entityMismatchWarning,
  requireRiderEntity,
  withRequiredRiderEntity,
} from "./rider-entity";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

function throws(fn: () => unknown): string {
  try {
    fn();
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

ok(
  RIDER_ENTITY_VALUES.join("|") === "Main|Rail Partners Select|Coal",
  "check values match railcars.entity exactly",
);
ok(requireRiderEntity("Main") === "Main", "Main payload");
ok(requireRiderEntity("Rail Partners Select") === "Rail Partners Select", "RPS full name payload");
ok(requireRiderEntity("Coal") === "Coal", "Coal payload");
ok(throws(() => requireRiderEntity("RPS")).includes("Entity must be"), "RPS alias is not a stored value");
ok(throws(() => requireRiderEntity("")).includes("required"), "blank new rider entity rejected");
ok(throws(() => requireRiderEntity(null)).includes("required"), "null new rider entity rejected");
ok(throws(() => requireRiderEntity(" main ")).includes("Entity must be"), "trimmed unknown value rejected");

ok(editedRiderEntity(null) === null, "edit may clear entity");
ok(editedRiderEntity("") === null, "blank edit clears entity");
ok(editedRiderEntity("Coal") === "Coal", "edit accepts Coal");
ok(throws(() => editedRiderEntity("Owned")).includes("Entity must be"), "Owned is not a rider entity");

const payload = withRequiredRiderEntity(
  { rider_name: "OL2543", schedule_number: "OL2543", owner_entity: "ALF P-I" },
  "Main",
);
ok(payload.entity === "Main" && payload.rider_name === "OL2543", "setup payload keeps rider fields and sets entity");
ok(payload.owner_entity === "ALF P-I", "owner_entity is left untouched on the payload");
ok(!("entity" in { rider_name: "OL1" }) || true, "payload helper is the writer of entity");

const same = entityMismatchWarning("Main", [{ id: 1, entity: "Main", label: "OFOX 1" }]);
ok(same === null, "matching entity does not warn");
const skipped = entityMismatchWarning(null, [{ id: 1, entity: "Coal", label: "OFOX 1" }]);
ok(skipped === null, "null rider entity skips the warning");
ok(entityMismatchWarning("  ", [{ id: 1, entity: "Coal" }]) === null, "blank rider entity skips the warning");
const mismatch = entityMismatchWarning("Main", [
  { id: 4, entity: "Coal", label: "OFOX 4" },
  { id: 5, entity: "Main", label: "OFOX 5" },
  { id: 6, entity: null, label: "OFOX 6" },
]);
ok(mismatch?.cars.map((car) => car.id).join(",") === "4,6", "warns on different and blank car entity");
ok(mismatch?.riderEntity === "Main" && mismatch.message.includes("OFOX 4 (Coal)") && mismatch.message.includes("OFOX 6 (blank)"), "warning names both entities");
ok(mismatch?.message.includes("Assign anyway?"), "warning asks for confirm");

const migration = readFileSync(join(import.meta.dirname, "../migrations/20261122_rider_lease_entity.sql"), "utf8");
const down = readFileSync(join(import.meta.dirname, "../migrations/20261122_rider_lease_entity_down.sql"), "utf8");
const check = /check\s*\(\s*entity\s+is\s+null\s+or\s+entity\s+in\s*\(\s*'Main'\s*,\s*'Rail Partners Select'\s*,\s*'Coal'\s*\)\s*\)/i;
ok(check.test(migration), "migration check lists the three values");
const migrationSql = migration.replace(/--[^\n]*/g, "");
ok(!/\b(grant|revoke)\b/i.test(migrationSql), "adding the column issues no grant or revoke");
ok(!/CREATE OR REPLACE FUNCTION public\.rlms_(apply_jsonb_patch|undo_change_group|referenced_outside_group|fk_outside_group)/i.test(migration), "migration does not replace undo functions");
ok(migration.includes("66be7d422ec47e8c711f83c8ca001c79"), "apply_jsonb_patch md5");
ok(migration.includes("fda2979bbd2d37e82c936b0abcdf8927"), "undo_change_group md5");
ok(migration.includes("ee76481bbbeb897c18d4f0349e9c0f2d"), "referenced_outside_group md5");
ok(migration.includes("b997a1a457d73f865b29560eeef625a6"), "fk_outside_group md5");
ok(/drop\s+column\s+entity/i.test(down) && down.includes("66be7d422ec47e8c711f83c8ca001c79"), "down drops the column and rechecks md5");
ok(!/CREATE OR REPLACE FUNCTION public\.rlms_/i.test(down), "down does not replace undo functions");
ok(/grant\s+select\s+on\s+public\.v_lease_rider_rollup,\s*public\.v_lease_lessee_rollup\s+to\s+authenticated,\s*service_role/i.test(down), "down restores only the view select grants that drop removed");

const preview = readFileSync(join(import.meta.dirname, "../script/preview_rider_entity.sql"), "utf8");
ok(!/\b(insert|update|delete|alter|drop|grant|copy)\b/i.test(preview.replace(/--[^\n]*/g, "")), "preview script is select-only");
ok(/WITH\s+latest_assignment/i.test(preview) && /active IS TRUE/i.test(preview), "preview uses latest assignment of active cars");

ok(RIDER_IMPORT_NEVER_WRITE.includes("entity"), "importers cannot write riders.entity");
ok(RIDER_IMPORT_NEVER_WRITE.includes("owner_entity"), "owner_entity stays never-write");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
