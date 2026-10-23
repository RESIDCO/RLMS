/* eslint-disable no-console */
/** Run: npx tsx shared/inactivate-cars.test.ts */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INACTIVATE_BATCH_MAX,
  INACTIVATE_CONFIRM,
  chooseInactivateIds,
  classifyInactivateRow,
  collectOpenRentStops,
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
    rent_stops: [],
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
  fact({ id: 3, rent_stops: [{ type: "Off rent", stop_date: "2026-10-01" }], programs: ["NLD"], commitment: { type: "scrap", name: "Cut up" } }),
  { closeAssignment: true, endDate: "2026-10-19" },
);
ok(
  stopped.status === "blocked" &&
    !stopped.blockers.includes("open_rent_stop") &&
    stopped.blockers.includes("open_program") &&
    stopped.blockers.includes("open_commitment"),
  "off rent is kept when closing; program and commitment still block",
);
ok(
  stopped.message.includes("Off rent since 2026-10-01 (kept) · Inactive/assignment end 2026-10-19"),
  "preview shows the kept off-rent date and the separate inactivation date",
);
ok(!stopped.message.includes("Not closed"), "a kept off-rent stop is not described as unclosed");
ok(!stopped.message.toLowerCase().includes("rent_events"), "preview does not mention rent events as something it will write");

const offRentLeftOpen = classifyInactivateRow(
  fact({ id: 6, rent_stops: [{ type: "Off rent", stop_date: "2026-10-19" }] }),
  { closeAssignment: false },
);
ok(
  offRentLeftOpen.status === "blocked" && offRentLeftOpen.blockers.includes("open_rent_stop"),
  "off rent still blocks when the assignment is left open",
);

const kept = classifyInactivateRow(
  fact({
    id: 36017,
    car_number: "074041",
    assignment: { ol: "1220", label: "OL1220", last_active_on_ol: false, other_active_on_ol: 2 },
    rent_stops: [{ type: "Off rent", stop_date: "2026-10-19" }],
  }),
  { closeAssignment: true, endDate: "2026-10-19" },
);
ok(kept.status === "ready" && kept.blockers.length === 0, "OFOX 074041 with a kept off-rent stop is ready");
ok(
  kept.message ===
    "Open assignment will be closed on the end date. 2 other active cars remain on OL 1220. Off rent since 2026-10-19 (kept) · Inactive/assignment end 2026-10-19",
  "example preview keeps the off-rent date beside the inactivation date",
);
ok(kept.rent_stop === "Off rent 2026-10-19", "rent stop column stays the stop's own date");

const keptLater = classifyInactivateRow(
  fact({ id: 8, rent_stops: [{ type: "Off rent", stop_date: "2026-10-19" }] }),
  { closeAssignment: true, endDate: "2026-10-20" },
);
ok(keptLater.status === "ready", "an inactivation date after the off-rent date is ready");

const keptUndated = classifyInactivateRow(
  fact({ id: 9, rent_stops: [{ type: "Off rent", stop_date: "2026-10-19" }] }),
  { closeAssignment: true },
);
ok(
  keptUndated.status === "ready" && keptUndated.message.includes("Inactive/assignment end not entered"),
  "a missing inactivation date is named and does not block the kept stop",
);

const early = classifyInactivateRow(
  fact({ id: 10, rent_stops: [{ type: "Off rent", stop_date: "2026-10-19" }] }),
  { closeAssignment: true, endDate: "2026-10-01" },
);
ok(
  early.status === "blocked" &&
    early.blockers.includes("inactivation_before_off_rent") &&
    !early.blockers.includes("open_rent_stop"),
  "an earlier inactivation date warns and is not ready",
);
ok(
  early.message ===
    "Off rent since 2026-10-19 (kept) · Inactive/assignment end 2026-10-01. Inactivation date is before the off-rent date.",
  "warning names both dates and the order",
);
const earlyPreview = summarizeInactivate([early]);
ok(chooseInactivateIds(earlyPreview, "all").ok === false, "a too-early inactivation date refuses apply-all");
ok(chooseInactivateIds(earlyPreview, "good").ok === false, "a too-early inactivation date is not ready");

const abatement = classifyInactivateRow(
  fact({ id: 11, rent_stops: [{ type: "Abatement", stop_date: "2026-10-01" }] }),
  { closeAssignment: true, endDate: "2026-10-19" },
);
ok(
  abatement.status === "blocked" && abatement.blockers.includes("open_rent_stop") && abatement.message.includes("Not closed."),
  "abatement still blocks when the assignment is closed",
);

const otherStop = classifyInactivateRow(
  fact({ id: 12, rent_stops: [{ type: "Shop", stop_date: "2026-10-01" }] }),
  { closeAssignment: true, endDate: "2026-10-19" },
);
ok(otherStop.blockers.includes("open_rent_stop"), "other stop types still block");

const mixedRows = collectOpenRentStops([
  { railcar_id: 13, type: "Off rent", stop_date: "2026-10-01" },
  { railcar_id: 13, type: "Abatement", stop_date: "2026-10-19" },
]);
ok(mixedRows.get(13)?.length === 2, "collector keeps the off-rent stop and the later abatement");
const mixedStops = classifyInactivateRow(
  fact({ id: 13, rent_stops: mixedRows.get(13) ?? [] }),
  { closeAssignment: true, endDate: "2026-10-19" },
);
ok(
  mixedStops.status === "blocked" && mixedStops.blockers.includes("open_rent_stop") && mixedStops.blockers.length === 1,
  "off rent plus abatement blocks even when off rent is first",
);
ok(
  mixedStops.message.includes("Open rent stop (Off rent 2026-10-01). Not closed.") &&
    mixedStops.message.includes("Open rent stop (Abatement 2026-10-19). Not closed."),
  "blocked preview lists each open stop",
);
const mixedPreview = summarizeInactivate([mixedStops]);
ok(chooseInactivateIds(mixedPreview, "all").ok === false, "apply-all refuses off rent plus abatement");
ok(chooseInactivateIds(mixedPreview, "good").ok === false, "apply-ready skips off rent plus abatement");

const twoOff = classifyInactivateRow(
  fact({
    id: 14,
    rent_stops: [
      { type: "Off rent", stop_date: "2026-10-19" },
      { type: "Off rent", stop_date: "2026-10-01" },
    ],
  }),
  { closeAssignment: true, endDate: "2026-10-19" },
);
ok(twoOff.status === "ready" && twoOff.blockers.length === 0, "two off-rent stops pass when the date is on or after both");
ok(
  twoOff.message.includes("Off rent since 2026-10-01 (kept) · Inactive/assignment end 2026-10-19") &&
    twoOff.message.includes("Off rent since 2026-10-19 (kept) · Inactive/assignment end 2026-10-19"),
  "both off-rent dates are listed as kept",
);
ok(twoOff.rent_stop === "Off rent 2026-10-01; Off rent 2026-10-19", "rent stop column lists both stop dates");
const twoReady = summarizeInactivate([twoOff]);
const twoChosen = chooseInactivateIds(twoReady, "all");
ok(twoChosen.ok === true && twoChosen.ok && twoChosen.ids.join(",") === "14", "apply accepts two off-rent stops covered by the date");

const twoEarly = classifyInactivateRow(
  fact({
    id: 15,
    rent_stops: [
      { type: "Off rent", stop_date: "2026-10-19" },
      { type: "Off rent", stop_date: "2026-10-01" },
    ],
  }),
  { closeAssignment: true, endDate: "2026-10-10" },
);
ok(
  twoEarly.status === "blocked" &&
    twoEarly.blockers.includes("inactivation_before_off_rent") &&
    !twoEarly.blockers.includes("open_rent_stop"),
  "a date before either off-rent stop is not ready",
);
ok(
  twoEarly.message.includes("Off rent since 2026-10-01 (kept)") &&
    twoEarly.message.includes("Off rent since 2026-10-19 (kept)") &&
    twoEarly.message.includes("Inactivation date is before the off-rent date."),
  "the early pair still lists each stop",
);

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

const sql = readFileSync(join(import.meta.dirname, "../migrations/20261114_inactivate_railcars.sql"), "utf8");
ok(!/\brent_events\b/i.test(sql), "migration never mentions rent_events");
ok(!/car_rent_stops/i.test(sql), "migration does not read or write rent stops");
ok(!/^UPDATE\s+public\.railcars/im.test(sql), "migration has no top-level railcar update");
ok(/CREATE OR REPLACE FUNCTION public\.inactivate_railcars/i.test(sql), "function is in the migration");
ok(/change_group/i.test(sql) && /car_status_history/i.test(sql), "one audited history write");
ok(!/\bINSERT\s+INTO\s+public\.railcars\b/i.test(sql), "migration does not insert cars");

const serverSrc = readFileSync(join(import.meta.dirname, "../server/inactivate-cars.ts"), "utf8");
const applyStart = serverSrc.indexOf("export async function applyInactivate");
const applyFn = serverSrc.slice(applyStart);
ok(applyFn.includes("endDate: opts.endDate"), "apply classifies with the inactivation date");
ok(!/\.from\(["']car_rent_stops["']\)/.test(applyFn), "apply does not query rent stops");
ok(!/\.from\(["']rent_events["']\)/.test(applyFn), "apply does not query rent events");
ok(!/\b(update|insert|delete)\b[\s\S]{0,80}car_rent_stops/i.test(applyFn), "apply does not write rent stops");
ok(/from\("car_rent_stops"\)/.test(serverSrc.slice(0, applyStart)), "preview only reads open rent stops");
ok(serverSrc.includes("collectOpenRentStops(rentStopRows)"), "preview passes every open stop into classify");
ok(!serverSrc.includes("if (rentStops.has(id)) continue"), "preview does not drop open stops after the first");
ok(applyFn.includes("previewInactivate"), "apply uses the same preview classification");

const dialogSrc = readFileSync(join(import.meta.dirname, "../client/src/pages/railcars/InactivateCarsDialog.tsx"), "utf8");
ok(dialogSrc.includes("Inactive / assignment end date"), "dialog labels the inactivation date as its own field");
ok(dialogSrc.includes("end_date: closeAssignment ? endDate : null"), "preview is sent the inactivation date");
ok(dialogSrc.includes("inactivate-date-warning"), "dialog warns when the inactivation date is too early");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
