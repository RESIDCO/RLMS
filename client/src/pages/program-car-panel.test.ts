/* eslint-disable no-console */
/** Run: npx tsx client/src/pages/program-car-panel.test.ts */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const program = readFileSync(join(root, "client/src/pages/ProgramDetail.tsx"), "utf8");
const fleet = readFileSync(join(root, "client/src/pages/FleetRegistry.tsx"), "utf8");
const section = readFileSync(join(root, "client/src/components/ProgramCarSection.tsx"), "utf8");
const commitment = readFileSync(join(root, "client/src/pages/CommitmentOps.tsx"), "utf8");

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}`);
  const next = src.indexOf("\n  async function ", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
}

const carCellStart = program.indexOf("link-program-car-");
const carCell = program.slice(Math.max(0, carCellStart - 400), carCellStart + 500);
ok(carCellStart > 0 && carCell.includes("link-program-car-"), "the car number keeps the program-car test id");
ok(carCell.includes("openProgramCar(c.id)"), "the car number opens the side panel");
ok(!carCell.includes("<Link") && !carCell.includes("carPathFromProgram"), "the car number no longer navigates to /cars/:id");
ok(/openProgramCar\(c\.id\)/.test(program), "a row click opens the same panel");
ok(program.includes("carPageHref={sheetCar ? carPathFromProgram("), "Car page still uses carPathFromProgram so Back to program survives");
ok(!program.includes("function CarDetailPanel"), "the read-only program pane is gone");
ok(!program.includes("ResizablePanelGroup"), "the grid is no longer split with the old pane");
ok(program.includes("<RailcarDetailSheet"), "the program page opens the shared railcar sheet");

ok(program.includes('confirmLabel: "Remove from program"'), "Remove from program stays a grid-row action");
ok(program.includes(">Put on rent<") || program.includes("Put on rent"), "Put on rent stays a grid action");
ok(!section.includes("put-on-rent") && !section.includes("cars/remove"), "the program section does not remove a car or put it on rent");

ok(section.includes("This program"), "the section is titled This program");
ok(section.includes('commitmentScopeLabel("program")'), "the section labels Program commitment");
ok(section.includes("button-program-car-history") && section.includes("button-program-car-files"), "History and Files stay on the section");
ok(section.includes("Scrap flag") && section.includes("Scrapped date"), "scrap flag and scrapped date are on the section");
ok(section.includes('label="Notes"') && section.includes('label="Comment"'), "notes and comment are both on the section");
ok(section.includes("button-save-program-car-section"), "the section has its own save");

const previewFn = fnBody(program, "requestSheetPreview");
const applyFn = fnBody(program, "applySheetPreview");
ok(previewFn.includes("programCarPatchPreviewPath") && !previewFn.includes("programCarPatchApplyPath"), "opening save requests a preview and does not apply it");
ok(applyFn.includes("programCarPatchApplyPath") && applyFn.includes("offerUndoToast"), "confirm applies the preview and keeps undo");
ok(applyFn.includes("invalidateQueries"), "apply refreshes the grid and the open panel");
ok(program.includes("sheetPreview"), "the preview is shown before apply");

const openStart = program.indexOf("function openProgramCar");
const openFn = program.slice(openStart, program.indexOf("async function requestSheetPreview"));
ok(openFn.includes("programCarSectionDiscardConfirmed"), "opening another car asks before discarding side-panel edits");
ok(
  openFn.indexOf("programCarSectionDiscardConfirmed") < openFn.indexOf("setSheetLinkId"),
  "the warning runs before the panel switches cars",
);
ok(program.includes("programCarSectionDiscardConfirmed(null)"), "closing the sheet asks before discarding side-panel edits");
ok(section.includes("Discard them and switch cars?"), "the section warns before a car switch drops edits");
ok(section.includes("programCarSectionSwitchBlocked"), "the section uses the switch guard");
ok(program.includes("unsavedDraftIds"), "save and the leave guard count every dirty draft");
ok(program.includes("programCarSectionHasUnsavedEdits"), "reload guard includes side-panel edits");
ok(!program.includes("visibleIdsRef"), "save no longer limits itself to the filtered rows");
ok(program.includes("programCarStaysVisible"), "dirty rows stay visible under the car filters");
ok(program.includes("unsaved-program-car-"), "dirty rows show an unsaved marker");
ok(program.includes('saveCarCountLabel(plan.count, "confirm")'), "save confirms how many cars will be saved");
ok(program.includes('saveCarCountLabel(plan.count, "saved")'), "save reports how many cars were saved");
ok(program.includes("programCarPinnedOnly"), "select all skips rows that are only pinned because they are dirty");
ok(program.includes("selectAllShownCarIds"), "select all uses the filter-matching id list");
const bulkStart = program.indexOf("onApply={async (label, updates)");
const bulkFn = program.slice(bulkStart, bulkStart + 900);
ok(bulkFn.includes("draftsAfterBulkApply"), "bulk apply clears only the fields it wrote");
ok(!bulkFn.includes("clearLinks"), "bulk apply does not drop the rest of the car draft");

ok(fleet.includes("ProgramCarSection"), "the shared sheet renders the program section");
ok(fleet.includes('commitmentScopeLabel("car")'), "car-level commitment is labeled Car commitment from a program");
ok(fleet.includes("programCarActionMode(fromProgram)") && fleet.includes('data-testid="move-ol-expander"'), "Move to another OL collapses behind an expander from a program");
ok(commitment.includes('data-testid="rent-start-expander"'), "Rent start collapses behind an expander from a program");
ok(commitment.includes("{heading}"), "the commitment panel uses the scope label");

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log(`${passed} passed, ${failed} failed`);
