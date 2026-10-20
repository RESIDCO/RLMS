/** Run: npx tsx server/append-note.test.ts */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentChangeGroup, withChangeGroupResult } from "./change-log";
import {
  appendNotesInGroup,
  normalizeAppendNote,
  stripNotesField,
  withNoteReport,
  type NoteWriter,
} from "./append-note";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(normalizeAppendNote("  hi ") === "hi", "note text is trimmed");
ok(normalizeAppendNote("   ") === null && normalizeAppendNote(null) === null, "empty notes are skipped");

const stripped = stripNotesField({ notes: "overwrite me", status: "Active" });
ok(!Object.prototype.hasOwnProperty.call(stripped, "notes") && stripped.status === "Active", "raw notes are stripped");

const unchanged = withNoteReport({ ok: true as const }, "  ", { appended: [1], skipped: [] });
ok(!Object.prototype.hasOwnProperty.call(unchanged, "note_appended"), "an empty note leaves the response unchanged");
const reported = withNoteReport({ ok: true as const }, "kept", { appended: [4], skipped: [{ id: 9, status: 409, message: "inactive" }] });
ok(reported.note_appended?.[0] === 4 && reported.note_skipped?.[0]?.id === 9, "a real note reports appended and skipped ids");

const quiet: NoteWriter = async () => {
  throw new Error("empty note must not call the writer");
};
const emptyReport = await appendNotesInGroup(
  { entityType: "railcar", ids: [1, 2], note: " \n ", actor: "ada" },
  quiet,
);
ok(emptyReport.appended.length === 0 && emptyReport.skipped.length === 0, "whitespace note writes nothing");

let sawGroup: string | null = null;
const outer = await withChangeGroupResult("ada", async () => {
  const group = currentChangeGroup();
  const report = await appendNotesInGroup(
    { entityType: "railcar", ids: [1, 2, 2, 0], note: " Shop called ", actor: "ada" },
    async (opts) => {
      const nested = await withChangeGroupResult("ada", async () => ({ joined: currentChangeGroup() }));
      sawGroup = nested.joined;
      ok(nested.change_group === group, "a nested addNote joins the edit's change group");
      if (opts.entity_id === 2) {
        throw Object.assign(new Error("Inactive cars are read-only"), { status: 409 });
      }
      return { ok: true };
    },
  );
  ok(report.appended.length === 1 && report.appended[0] === 1, "one note per car, duplicates ignored");
  ok(report.skipped.length === 1 && report.skipped[0].status === 409, "inactive 409 does not fail the save");
  ok(sawGroup === group && Boolean(group), "the note sees the outer change group");
  return { saved: true };
});
ok(outer.saved && Boolean(outer.change_group), "the edit group still completes");

let blew = false;
try {
  await appendNotesInGroup(
    { entityType: "rider", ids: [3], note: "hello", actor: "ada" },
    async () => {
      throw Object.assign(new Error("db down"), { status: 500 });
    },
  );
} catch (err) {
  blew = Number((err as { status?: number }).status) === 500;
}
ok(blew, "a non-409 note error still fails the save");

const root = resolve(import.meta.dirname, "..");
const appendSrc = readFileSync(resolve(root, "server/append-note.ts"), "utf8");
const activitySrc = readFileSync(resolve(root, "server/activity-log.ts"), "utf8");
const routesSrc = readFileSync(resolve(root, "server/routes.ts"), "utf8");
const moveSrc = readFileSync(resolve(root, "server/move-cars.ts"), "utf8");
const inactivateSrc = readFileSync(resolve(root, "server/inactivate-cars.ts"), "utf8");
ok(appendSrc.includes("write: NoteWriter = addNote"), "appendNotesInGroup calls addNote by default");
ok(activitySrc.includes("return withChangeGroupResult"), "addNote records inside a change group");

const patchStart = routesSrc.indexOf('app.patch("/api/railcars/:id"');
const patchEnd = routesSrc.indexOf('app.post("/api/railcars/:id/change-number"');
const patch = routesSrc.slice(patchStart, patchEnd);
ok(patch.includes("stripNotesField("), "railcar PATCH strips raw notes");
ok(
  patch.indexOf("withChangeGroupResult") !== -1 &&
    patch.indexOf("withChangeGroupResult") < patch.indexOf("appendNotesInGroup"),
  "railcar PATCH appends the note inside the change group",
);

const moveStart = moveSrc.indexOf("export async function applyMove");
const moveFn = moveSrc.slice(moveStart);
ok(
  moveFn.indexOf("withChangeGroupResult") < moveFn.indexOf("appendNotesInGroup") &&
    moveFn.includes("ids: input.car_ids"),
  "move appends one note per requested car inside the move group",
);

const inactivateStart = inactivateSrc.indexOf("export async function applyInactivate");
const inactivateFn = inactivateSrc.slice(inactivateStart, inactivateStart + 2500);
ok(
  inactivateFn.indexOf("appendNotesInGroup") < inactivateFn.indexOf("inactivate_railcars"),
  "inactivate notes the cars before the freeze",
);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
