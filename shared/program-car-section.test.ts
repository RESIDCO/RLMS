/* eslint-disable no-console */
/** Run: npx tsx shared/program-car-section.test.ts */

import { PROGRAM_KEEP_OPEN_CF } from "./programs.ts";
import {
  commitmentScopeLabel,
  describeProgramCarUpdates,
  programCarActionMode,
  programCarFieldsEditable,
  programCarKeepOpenEditable,
  programCarPatchApplyPath,
  programCarPatchBody,
  programCarPatchPreviewPath,
  programCarSectionCanSave,
  programCarSectionEdit,
  programCarSectionPatch,
  programCarSectionSavePatch,
  programCarSectionVisible,
  type ProgramCarSectionSource,
  type ProgramCarSectionSource,
} from "./program-car-section.ts";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const base: ProgramCarSectionSource = {
  status: "In shop",
  notes: "Wheel set",
  milestone: "Enroute",
  milestone_at: "2026-04-02",
  shop_id: 4,
  outcome_reached_at: null,
  completed: false,
  custom_fields: {},
  exited_date: null,
  railcar: { active: true, status: "Active/In-Service", ops_flag: null, scrapped_at: null },
};

ok(programCarSectionVisible(null) === false, "no context hides the program section");
ok(programCarSectionVisible({ programId: 0, car: base }) === false, "a missing program id hides the section");
ok(programCarSectionVisible({ programId: 12, car: null }) === false, "a missing program-car row hides the section");
ok(programCarSectionVisible({ programId: 12, car: base }) === true, "program id plus a car row shows the section");

ok(
  programCarFieldsEditable({ canEdit: true, exited: false, active: true, railcarStatus: "Active/In-Service" }) === true,
  "an open active car is editable",
);
ok(
  programCarFieldsEditable({ canEdit: false, exited: false, active: true, railcarStatus: "Active/In-Service" }) === false,
  "a viewer cannot edit program fields",
);
ok(
  programCarFieldsEditable({ canEdit: true, exited: true, active: true, railcarStatus: "Active/In-Service" }) === false,
  "an exited row is read-only",
);
ok(
  programCarFieldsEditable({ canEdit: true, exited: false, active: false, railcarStatus: "Inactive" }) === false,
  "a frozen car without Keep open does not take field edits",
);
ok(
  programCarFieldsEditable({
    canEdit: true,
    exited: false,
    active: false,
    railcarStatus: "Inactive",
    customFields: { [PROGRAM_KEEP_OPEN_CF]: true },
  }) === true,
  "Keep open already on lets a frozen car take field edits",
);
ok(
  programCarKeepOpenEditable({ canEdit: true, exited: false }) === true,
  "Keep open stays editable on a car that is still in the program",
);
ok(
  programCarKeepOpenEditable({ canEdit: true, exited: true }) === false,
  "Keep open is locked after the car exits",
);
ok(programCarSectionCanSave({ canEdit: true, exited: false }) === true, "editors can save an open row");
ok(programCarSectionCanSave({ canEdit: false, exited: false }) === false, "viewers do not get a save");
ok(programCarSectionCanSave({ canEdit: true, exited: true }) === false, "an exited row does not save");

ok(programCarActionMode(true) === "collapsed", "a program opening collapses car-level rent start and move");
ok(programCarActionMode(false) === "expanded", "the fleet panel leaves rent start and move expanded");
ok(commitmentScopeLabel("car") === "Car commitment", "car-level commitment is labeled Car commitment");
ok(commitmentScopeLabel("program") === "Program commitment", "the program block labels Program commitment");
ok(commitmentScopeLabel("default") === "Commitment", "other panels keep the Commitment label");

const same = programCarSectionEdit(base);
ok(programCarSectionPatch(base, same) === null, "an unchanged form does not preview");

const status = programCarSectionPatch(base, { ...same, status: "Ready" });
ok(status?.status === "Ready" && status.outcome_reached === undefined, "a status edit is the only status write");

const leaving = programCarSectionPatch(
  { ...base, status: "Complete" },
  { ...programCarSectionEdit({ ...base, status: "Complete" }), status: "In shop" },
);
ok(
  leaving?.status === "In shop" && leaving.outcome_reached === false && leaving.completed === false,
  "leaving a complete status clears the outcome in the same patch",
);

const notes = programCarSectionPatch(base, { ...same, notes: "New note" });
ok(notes?.notes === "New note" && Object.keys(notes).length === 1, "notes and comment share one notes write");

const milestone = programCarSectionPatch(base, { ...same, milestone: "Work complete", milestoneAt: "04/03/2026" });
ok(
  milestone?.milestone === "Work complete" && milestone.milestone_at === "04/03/2026",
  "milestone and date save together",
);
ok(
  programCarSectionPatch(base, { ...same, milestoneAt: "04/02/2026" }) === null,
  "a milestone date that formats the same is not a change",
);

const shop = programCarSectionPatch(base, { ...same, shopId: null });
ok(shop?.shop_id === null && Object.keys(shop).length === 1, "clearing the shop is a patch");

const outcome = programCarSectionPatch(base, { ...same, outcomeReached: true });
ok(outcome?.outcome_reached === true, "checking outcome sends outcome_reached");

const frozenGate = { canEdit: true, exited: false, active: false, railcarStatus: "Inactive", customFields: {} };
const frozenSave = programCarSectionSavePatch(
  base,
  { ...same, status: "Ready", keepOpen: true },
  frozenGate,
);
ok(
  frozenSave != null && frozenSave.status === undefined && (frozenSave.custom_fields as Record<string, unknown>)?.[PROGRAM_KEEP_OPEN_CF] === true,
  "a frozen car previews Keep open and not the locked status",
);
ok(
  programCarSectionSavePatch(base, { ...same, status: "Ready" }, { canEdit: false, exited: false, active: true }) === null,
  "a viewer save is dropped before preview",
);
ok(
  programCarSectionSavePatch(base, { ...same, notes: "x" }, { canEdit: true, exited: true, active: true }) === null,
  "an exited row does not preview",
);
const openFrozen: ProgramCarSectionSource = {
  ...base,
  custom_fields: { [PROGRAM_KEEP_OPEN_CF]: true },
  railcar: { active: false, status: "Inactive" },
};
ok(
  programCarSectionSavePatch(
    openFrozen,
    { ...programCarSectionEdit(openFrozen), status: "Ready" },
    { canEdit: true, exited: false, active: false, railcarStatus: "Inactive", customFields: openFrozen.custom_fields },
  )?.status === "Ready",
  "Keep open already on lets the status into the preview",
);

const keep = programCarSectionPatch(base, { ...same, keepOpen: true });
ok(
  (keep?.custom_fields as Record<string, unknown>)?.[PROGRAM_KEEP_OPEN_CF] === true,
  "Keep open saves through the program custom field",
);
ok(!("ops_flag" in (keep ?? {})) && !("scrapped_at" in (keep ?? {})), "scrap flag and scrapped date are not patch fields");

const body = programCarPatchBody(44, { status: "Ready" });
ok(
  body.items.length === 1 && body.items[0].link_id === 44 && body.items[0].updates.status === "Ready",
  "preview body is one program-car item",
);
ok(
  programCarPatchPreviewPath(9) === "/api/programs/9/cars/patch/preview",
  "save previews on the existing program-car patch route",
);
ok(
  programCarPatchApplyPath(9) === "/api/programs/9/cars/patch/apply",
  "confirm applies on the existing program-car patch route",
);

const lines = describeProgramCarUpdates({
  status: "Ready",
  notes: "",
  custom_fields: { [PROGRAM_KEEP_OPEN_CF]: true },
});
ok(lines.includes("Status: Ready"), "preview names the status change");
ok(lines.includes("Notes: —"), "preview shows a cleared note");
ok(lines.includes("Keep open: Yes"), "preview names Keep open");

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log(`${passed} passed, ${failed} failed`);
