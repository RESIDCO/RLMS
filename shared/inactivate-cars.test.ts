/* eslint-disable no-console */
/** Run: npx tsx shared/inactivate-cars.test.ts */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INACTIVATE_BATCH_MAX,
  INACTIVATE_CONFIRM,
  chooseInactivateIds,
  classifyInactivateRow,
  inactivateEndDateError,
  summarizeInactivate,
  type InactivateFacts,
} from "./inactivate-cars";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

function fact(over: Partial<InactivateFacts> & Pick<InactivateFacts, "id">): InactivateFacts {
  return {
    reporting_marks: "OFOX",
    car_number: String(310000 + over.id),
    car_status: "Storage",
    active: true,
    assignment: null,
    rent_stop: null,
    programs: [],
    commitment: null,
    ...over,
  };
}

const ready = classifyInactivateRow(fact({ id: 1 }), { closeAssignment: false });
ok(ready.status === "ready" && ready.blockers.length === 0, "clean Storage car is ready");

const assigned = classifyInactivateRow(
  fact({
    id: 2,
    assignment: { ol: "1503", label: "OL1503", last_active_on_ol: true, other_active_on_ol: 0 },
  }),
  { closeAssignment: false },
);
ok(assigned.status === "blocked" && assigned.blockers.includes("open_assignment"), "open assignment blocks");
ok(assigned.message.includes("last active car"), "last active car is named");

const closable = classifyInactivateRow(
  fact({
    id: 2,
    assignment: { ol: "1503", label: "OL1503", last_active_on_ol: true, other_active_on_ol: 0 },
  }),
  { closeAssignment: true },
);
ok(closable.status === "ready" && !closable.blockers.includes("open_assignment"), "closing the assignment clears that blocker");
ok(closable.message.includes("last active car"), "closing still says it is the last car");

const stopped = classifyInactivateRow(
  fact({ id: 3, rent_stop: { type: "Off rent", stop_date: "2026-10-01" }, programs: ["NLD"], commitment: { type: "scrap", name: "Cut up" } }),
  { closeAssignment: true },
);
ok(
  stopped.status === "blocked" &&
    stopped.blockers.includes("open_rent_stop") &&
    stopped.blockers.includes("open_program") &&
    stopped.blockers.includes("open_commitment"),
  "rent stop, program, and commitment stay blockers",
);
ok(!stopped.message.toLowerCase().includes("rent_events"), "preview does not mention rent events as something it will write");

const dead = classifyInactivateRow(fact({ id: 4, car_status: "Inactive", active: false }), { closeAssignment: false });
ok(dead.status === "already_inactive", "already inactive is not ready");

const legacy = classifyInactivateRow(fact({ id: 5, car_status: "Scrapped", active: false }), { closeAssignment: false });
ok(legacy.status === "already_inactive", "active=false with another status is already inactive");

const preview = summarizeInactivate([ready, assigned, stopped, dead]);
ok(preview.counts.ready === 1 && preview.counts.blocked === 2 && preview.counts.already_inactive === 1, "counts");
ok(chooseInactivateIds(preview, "all").ok === false, "all refuses when any car is blocked");
const good = chooseInactivateIds(preview, "good");
ok(good.ok === true && good.ok && good.ids.join(",") === "1", "ready only returns the clean car");

ok(inactivateEndDateError(true, "") != null, "close requires a date");
ok(inactivateEndDateError(true, "2026-10-19") == null, "ISO date is accepted");
ok(inactivateEndDateError(false, "") == null, "date is optional when not closing");
ok(INACTIVATE_CONFIRM === "INACTIVATE" && INACTIVATE_BATCH_MAX === 500, "confirm word and cap");

const sql = readFileSync(join(import.meta.dirname, "../migrations/20261113_inactivate_railcars.sql"), "utf8");
ok(!/\brent_events\b/i.test(sql), "migration never mentions rent_events");
ok(!/^UPDATE\s+public\.railcars/im.test(sql), "migration has no top-level railcar update");
ok(/CREATE OR REPLACE FUNCTION public\.inactivate_railcars/i.test(sql), "function is in the migration");
ok(/change_group/i.test(sql) && /car_status_history/i.test(sql), "one audited history write");
ok(!/\bINSERT\s+INTO\s+public\.railcars\b/i.test(sql), "migration does not insert cars");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
