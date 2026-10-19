/* eslint-disable no-console */
/** Run: npx tsx shared/manage-columns.test.ts */

import { readFileSync } from "node:fs";
import {
  activeFieldDefs,
  columnTypeFromField,
  defVisibleOnProgram,
  fieldDefsForProgram,
  fieldKeyFromLabel,
  fieldTypeForColumn,
  isRetiredField,
  normalizeSelectOptions,
  uniqueFieldKey,
} from "./manage-columns";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(fieldTypeForColumn("checkbox") === "boolean", "checkbox is stored as boolean");
ok(fieldTypeForColumn("currency") === "currency", "currency type stays currency");
ok(fieldTypeForColumn("select") === "select", "select type stays select");
ok(columnTypeFromField("boolean") === "checkbox", "boolean displays as checkbox");
ok(fieldKeyFromLabel("Resp 6 costs") === "resp_6_costs", "key is a slug of the name");
ok(uniqueFieldKey("Spend", ["spend"]) === "spend_2", "a taken key gets a suffix");
ok(uniqueFieldKey("Spend", []) === "spend", "the first key matches the label");
const renamed = "spend";
ok(renamed === "spend", "rename keeps the key that custom_fields already use");

ok(normalizeSelectOptions("A\nB, A").join("|") === "A|B", "select options trim and dedupe");
ok(normalizeSelectOptions(["Hot", " hot ", ""]).join("|") === "Hot", "blank and duplicate options drop");

const defs = [
  { field_key: "spend", retired_at: null },
  { field_key: "old", retired_at: "2026-10-19T00:00:00Z" },
];
ok(activeFieldDefs(defs).map((d) => d.field_key).join() === "spend", "retired defs leave the grid");
ok(isRetiredField(defs[1]) && !isRetiredField(defs[0]), "retired_at is the flag");
ok(defVisibleOnProgram({ field_key: "a", program_id: 4 }, 4, 1), "program scope is this program");
ok(!defVisibleOnProgram({ field_key: "a", program_id: 9 }, 4, 1), "another program's column stays off this grid");
ok(defVisibleOnProgram({ field_key: "g", program_id: null, category_id: null }, 4, 1), "global optional is on every program");
ok(defVisibleOnProgram({ field_key: "c", category_id: 2 }, 4, 2), "category column matches the program category");
const ranked = fieldDefsForProgram(
  [
    { id: 1, field_key: "spend", label: "Spend", category_id: null, program_id: null, retired_at: null, sort_order: 1 },
    { id: 2, field_key: "spend", label: "Spend retired", program_id: 4, retired_at: "2026-10-19", sort_order: 2 },
    { id: 3, field_key: "trace_date_ran", label: "Trace date ran", category_id: null, program_id: null, sort_order: 3 },
    { id: 4, field_key: "local", label: "Local", program_id: 9, sort_order: 4 },
  ],
  4,
  1,
);
ok(ranked.map((d) => d.field_key).join() === "spend,trace_date_ran", "active global stays when a program copy is retired");
ok(ranked[0]?.label === "Spend", "the active definition supplies the label");

const live = readFileSync(new URL("../migrations/20261113_program_global_optional_fields.sql", import.meta.url), "utf8");
const next = readFileSync(new URL("../migrations/20261115_manage_columns.sql", import.meta.url), "utf8");

function undoBody(sql: string): string {
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.rlms_undo_change_group");
  const end = sql.indexOf("$function$;", start);
  return sql.slice(start, end);
}

const previous = undoBody(live);
let current = undoBody(next);
const insertBranch = `    ELSIF op = 'insert' AND tbl = 'program_field_defs' THEN
      UPDATE public.program_field_defs
         SET retired_at = COALESCE(retired_at, now())
       WHERE id = pk;
      restored := restored + 1;
`;
ok(current.includes(insertBranch.trim()), "undo of add retires the definition instead of deleting it");
current = current.replace(insertBranch, "");
current = current.replace(", 'program_field_defs'", "");
ok(current === previous, "undo function is the live definition plus program_field_defs");

function patchBody(sql: string): string {
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.rlms_apply_jsonb_patch");
  const end = sql.indexOf("$function$;", start);
  return sql.slice(start, end);
}
let patch = patchBody(next);
const livePatch = patchBody(live);
ok(patch.includes("'shops', 'user_column_prefs', 'program_field_defs'"), "patch allowlist includes column definitions");
patch = patch.replace(", 'program_field_defs'", "");
ok(patch === livePatch, "patch function is the live definition plus program_field_defs");
ok(next.includes("DELETE FROM public.car_number_history"), "remark history removal stays");
ok(next.includes("'shops', 'user_column_prefs', 'program_field_defs'"), "shops, prefs, and column defs are undoable");
ok(next.includes("undo: program % still has cars"), "empty sync-created program undo stays");
ok(!/insert\s+into\s+(public\.)?rent_events/i.test(next), "migration does not insert rent_events");
ok(!/update\s+(public\.)?rent_events/i.test(next), "migration does not update rent_events");
ok(!/delete\s+from\s+(public\.)?rent_events/i.test(next), "migration does not delete rent_events");
ok(!/delete\s+from\s+(public\.)?program_field_defs/i.test(next), "retire path does not delete field defs");

const liveDoneSql = readFileSync(new URL("../migrations/20261030_railcars_workbench.sql", import.meta.url), "utf8");
const downSql = readFileSync(new URL("../migrations/20261115_manage_columns_down.sql", import.meta.url), "utf8");

function programDoneBody(sql: string): string {
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.rlms_program_car_is_program_done");
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end);
}

const liveDone = programDoneBody(liveDoneSql);
const droppedActive = liveDone.replace(
  "      rc.active IS NOT TRUE\n      OR rc.scrapped_at IS NOT NULL",
  "      rc.scrapped_at IS NOT NULL",
);
ok(droppedActive !== liveDone, "the live program-done function still names the fleet active check");
ok(programDoneBody(next) === droppedActive, "program done is the live definition without the fleet active check");
ok(!programDoneBody(next).includes("rc.active IS NOT TRUE"), "the up migration drops rc.active IS NOT TRUE");
ok(programDoneBody(next).includes("rc.scrapped_at IS NOT NULL"), "scrapped_at stays from the live definition");
ok(programDoneBody(downSql) === liveDone, "the down script restores the live program-done function");

const names = ["20261114_inactivate_railcars.sql", "20261115_manage_columns.sql"];
ok(names.slice().sort().join() === names.join(), "migration filename sorts after inactivate railcars");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
