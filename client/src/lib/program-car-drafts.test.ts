/* eslint-disable no-console */
/** Run: npx tsx client/src/lib/program-car-drafts.test.ts */

import {
  createProgramCarDraftSession,
  datePatchValue,
  draftDiffers,
  draftsAfterSave,
  emptySaveToast,
  keptEditsToast,
  moneyPatchValue,
  planCarSave,
  programCarStaysVisible,
  saveCarCountLabel,
  saveFailureToast,
  textPatchValue,
  unsavedDraftIds,
  type CarBaseline,
  type CarDraftMap,
} from "./program-car-drafts";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const car1: CarBaseline = {
  notes: "keep",
  status: "Enroute",
  repair_cost_total: null,
  custom_fields: {},
};
const car2: CarBaseline = {
  notes: "same",
  status: "Enroute",
  custom_fields: { settlement_amount: null },
};
const baselines = new Map<number, CarBaseline>([
  [1, car1],
  [2, car2],
]);

function settlement(amount: number): Record<string, unknown> {
  return { custom_fields: { settlement_amount: amount } };
}

// Save while the editor is still active: the draft map is empty until flush.
{
  const session = createProgramCarDraftSession();
  const stop = session.register(1, () => {
    const value = moneyPatchValue(null, "9178.90");
    if (typeof value !== "number") return value === "invalid" ? "invalid" : "unchanged";
    session.queue(1, settlement(value));
    return "queued";
  });
  ok(Object.keys(session.getDrafts()).length === 0, "typing has not committed before Save");
  const flushed = session.flushEditors();
  ok(!flushed.invalid, "9178.90 is a real amount");
  const plan = planCarSave(session.getDrafts(), baselines);
  ok(plan.count === 1, "Save while editing counts one car");
  ok(plan.items.length === 1 && plan.items[0].link_id === 1, "payload has the edited car");
  const fields = plan.items[0].updates.custom_fields as Record<string, unknown>;
  ok(fields.settlement_amount === 9178.9, "Save while editing persists 9178.90");
  stop();
}

// Enter/Tab commits first. A later Save reads the draft with no active editor.
{
  const entered = moneyPatchValue(null, "8725");
  ok(entered === 8725, "Enter commits the typed amount");
  const dated = datePatchValue(null, "10/10/26", false);
  ok(dated === "2026-10-10", "Enter commits a milestone date");
  const note = textPatchValue("", "shop called");
  ok(note === "shop called", "Enter commits a program note");
  const status = textPatchValue("Enroute", "At shop");
  ok(status === "At shop", "Enter commits a custom status");

  const session = createProgramCarDraftSession();
  if (typeof entered === "number") session.queue(1, settlement(entered));
  if (typeof note === "string") session.queue(1, { notes: note });
  if (typeof dated === "string") session.queue(1, { milestone_at: dated });
  if (typeof status === "string") session.queue(1, { status });
  const plan = planCarSave(session.getDrafts(), baselines);
  ok(plan.count === 1, "Enter-then-Save counts the one car, not each field");
  const updates = plan.items[0].updates;
  const fields = updates.custom_fields as Record<string, unknown>;
  ok(fields.settlement_amount === 8725, "Enter-then-Save keeps the amount");
  ok(updates.notes === "shop called", "Enter-then-Save keeps the note");
  ok(updates.milestone_at === "2026-10-10", "Enter-then-Save keeps the date");
  ok(updates.status === "At shop", "Enter-then-Save keeps the status");
  ok(moneyPatchValue(8725, "$8,725.00") === "unchanged", "blurred currency text is not a second edit");
}

// The old label counted every draft-map key. A second car whose patch matches
// the loaded row must not turn "Saving 1 car" into "Saving 2 cars".
{
  const stale: CarDraftMap = {
    1: { notes: "keep", ...settlement(9178.9) },
    2: { notes: "same" },
  };
  ok(Object.keys(stale).length === 2, "stale map still has two keys");
  ok(!draftDiffers(car2, stale[2]), "the second car does not differ from the loaded row");
  const plan = planCarSave(stale, baselines);
  ok(plan.count === 1, "count is the one car that actually changed");
  ok(plan.items.length === 1 && plan.items[0].link_id === 1, "the unchanged car is left out of the payload");
  const hiddenBaselines = new Map<number, CarBaseline>([
    [1, car1],
    [9, { notes: "" }],
  ]);
  const hiddenDrafts: CarDraftMap = { 1: settlement(5), 9: { notes: "hidden edit" } };
  const hiddenPlan = planCarSave(hiddenDrafts, hiddenBaselines);
  ok(hiddenPlan.count === 2, "a filtered car is part of the saving count");
  ok(!("hidden" in hiddenPlan), "a filtered car is not split out of the save");
  ok(
    hiddenPlan.items.map((item) => item.link_id).join(",") === "1,9",
    "a filtered car is included in the save payload",
  );
  ok(saveCarCountLabel(hiddenPlan.count, "confirm") === "Save 2 cars?", "confirm names every car that will be saved");
  ok(saveCarCountLabel(1, "saving") === "Saving 1 car…", "the saving toast uses the singular count");
  ok(saveCarCountLabel(hiddenPlan.count, "saved") === "Saved 2 cars", "the saved toast names every car that was saved");
}

// Editing two cars, then narrowing the text filter, the level chips, or a paste
// list, still saves both. The filtered car stays on screen because it is dirty.
{
  const filterBaselines = new Map<number, CarBaseline>([
    [1, car1],
    [2, { notes: "same" }],
    [3, { notes: "" }],
  ]);
  const across: CarDraftMap = {
    1: { notes: "shop called" },
    2: { notes: "hidden edit" },
  };
  const dirty = new Set(unsavedDraftIds(across, filterBaselines));
  ok(dirty.has(1) && dirty.has(2) && !dirty.has(3), "leave guard sees both edited cars and skips the clean one");

  function shown(input: {
    matchesText: boolean;
    levelSelected: boolean;
    narrowing: boolean;
    pasteActive?: boolean;
    matchesPaste?: boolean;
    id: number;
  }): boolean {
    return programCarStaysVisible({
      matchesText: input.matchesText,
      pasteActive: input.pasteActive === true,
      matchesPaste: input.matchesPaste !== false,
      applyLevelFilter: !input.narrowing,
      levelSelected: input.levelSelected,
      dirty: dirty.has(input.id),
    });
  }

  const levelDefault = shown({ id: 2, matchesText: true, levelSelected: false, narrowing: false });
  const textNarrowed = [
    shown({ id: 1, matchesText: false, levelSelected: true, narrowing: true }),
    shown({ id: 2, matchesText: true, levelSelected: false, narrowing: true }),
    shown({ id: 3, matchesText: false, levelSelected: true, narrowing: true }),
  ];
  ok(levelDefault, "a dirty car stays visible when its completion level is filtered out");
  ok(textNarrowed[0] && textNarrowed[1] && !textNarrowed[2], "dirty cars stay visible when the text filter misses them");
  ok(
    shown({ id: 1, matchesText: false, levelSelected: false, narrowing: true, pasteActive: true, matchesPaste: false }),
    "a dirty car stays visible when a paste list excludes it",
  );
  ok(
    !shown({ id: 3, matchesText: false, levelSelected: false, narrowing: false }),
    "a clean car stays hidden when the text and level filters miss it",
  );

  const beforeSwitch = planCarSave(across, filterBaselines);
  const afterText = planCarSave(across, filterBaselines);
  const afterLevel = planCarSave(across, filterBaselines);
  ok(beforeSwitch.count === 2 && afterText.count === 2 && afterLevel.count === 2, "changing the filter does not change the saving count");
  ok(
    afterText.items.map((item) => item.link_id).join(",") === "1,2"
      && afterLevel.items.map((item) => item.link_id).join(",") === "1,2",
    "multi-car save keeps every edited car across filter changes",
  );
  const cleared = draftsAfterSave(across, afterLevel.items, "saved");
  ok(cleared[1] == null && cleared[2] == null, "saving across a filter clears every sent car");
  ok(
    unsavedDraftIds({ 4: { notes: "kept while exited" } }, filterBaselines).join(",") === "4",
    "leave guard keeps a draft whose car is not in the loaded rows",
  );
  const orphan = planCarSave({ 4: { notes: "kept while exited" }, 2: { notes: "same" } }, filterBaselines);
  ok(orphan.count === 1 && orphan.items[0].link_id === 4, "save still sends a draft whose car is not loaded");
}

// Failed save and "no changes" keep the typed value. A real save clears it.
// A newer keystroke that landed during the request stays.
{
  const sent = [{ link_id: 1, updates: settlement(9178.9) }];
  const drafts: CarDraftMap = { 1: settlement(9178.9), 2: { notes: "same" } };
  const onError = draftsAfterSave(drafts, sent, "error");
  ok(onError[1]?.custom_fields != null, "failed save keeps the settlement edit");
  ok(
    (onError[1].custom_fields as Record<string, unknown>).settlement_amount === 9178.9,
    "failed save does not revert the amount",
  );
  const toast = saveFailureToast("Network down");
  ok(toast.title === "Save failed" && toast.variant === "destructive", "failed save uses an error toast");
  ok(toast.description.includes("still on the grid"), "error toast says the edits were kept");
  const onEmpty = draftsAfterSave(drafts, sent, "no_changes");
  ok(
    (onEmpty[1].custom_fields as Record<string, unknown>).settlement_amount === 9178.9,
    "no changes does not discard the typed amount",
  );
  ok(keptEditsToast().description.includes("still on the grid"), "no-changes copy keeps the edits");
  const onSaved = draftsAfterSave(drafts, sent, "saved");
  ok(onSaved[1] == null, "a stored save clears that car");
  const raced = draftsAfterSave({ 1: { ...settlement(9178.9), notes: "typed while saving" } }, sent, "saved");
  ok(raced[1]?.notes === "typed while saving", "a newer edit during save is not cleared");
  ok(emptySaveToast(true).description?.includes("still in the cell"), "unreadable text is kept");
  ok(emptySaveToast(false).title === "No changes", "an empty save does not mention a hidden car");
}

{
  const session = createProgramCarDraftSession();
  ok(session.beginSave() === true, "first Save starts");
  ok(session.beginSave() === false, "second Save is ignored while the first is running");
  session.endSave();
  ok(session.beginSave() === true, "Save can run again after the first finishes");
  session.endSave();
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
