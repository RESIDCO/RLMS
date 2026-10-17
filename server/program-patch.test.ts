/* eslint-disable no-console */
/** Run: npx tsx server/program-patch.test.ts */

import { diffProgramPatch, PROGRAM_PATCH_BLOCKED } from "@shared/program-patch";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const before: Record<string, unknown> = {
  id: 5,
  name: "OL1503 - NLD to Washington Penn",
  type: null,
  tags: null,
  status_narrative: "ok",
  target_completion_date: null,
  pending_note: null,
  account_manager: "BH",
  opened_date: "2026-01-01",
  closed_date: null,
  lifecycle: "active",
  status: "open",
};

const fullForm = {
  name: before.name,
  type: "Return",
  tags: [],
  status_narrative: "ok",
  target_completion_date: null,
  pending_note: null,
  account_manager: "BH",
  opened_date: "2026-01-01",
  closed_date: null,
  lifecycle: "active",
};

ok(Object.keys(diffProgramPatch(before, {
  name: before.name,
  type: null,
  tags: [],
  status_narrative: "ok",
  target_completion_date: "",
  pending_note: null,
  account_manager: "BH",
})).length === 0, "unchanged form fields produce empty diff");

ok(
  JSON.stringify(diffProgramPatch(before, { ...fullForm, type: "Return" })) === JSON.stringify({ type: "Return" }),
  "only type changes when inferred type is sent as a real edit",
);

const nameOnly = diffProgramPatch(before, { ...fullForm, name: "OL1503 renamed", type: null });
ok(Object.keys(nameOnly).join() === "name", "name-only patch");
ok(nameOnly.name === "OL1503 renamed", "name value");

const noteOnly = diffProgramPatch(before, { ...fullForm, type: null, pending_note: "awaiting cars" });
ok(Object.keys(noteOnly).join() === "pending_note", "pending_note-only");

for (const key of ["name", "type", "status_narrative", "target_completion_date", "pending_note", "account_manager"] as const) {
  const body = { ...fullForm, type: null, [key]: before[key] };
  const d = diffProgramPatch(before, body);
  ok(!Object.keys(d).includes("opened_date"), `${key} patch never includes opened_date`);
  ok(!Object.keys(d).includes("closed_date"), `${key} patch never includes closed_date`);
  ok(!Object.keys(d).includes("lifecycle"), `${key} patch never includes lifecycle`);
}

ok(
  !("opened_date" in diffProgramPatch(before, { opened_date: "2099-01-01", closed_date: "2099-01-01", lifecycle: "closed" })),
  "blocked keys in body are ignored",
);
ok(PROGRAM_PATCH_BLOCKED.includes("opened_date"), "opened_date blocked");
ok(PROGRAM_PATCH_BLOCKED.includes("closed_date"), "closed_date blocked");

const past = diffProgramPatch(before, { target_completion_date: "2026-10-15" });
ok(past.target_completion_date === "2026-10-15", "target date can still be set (client warns if past)");

const fields = Object.keys(diffProgramPatch(before, { name: "x", type: null, tags: [], status_narrative: "ok" }));
ok(fields.join() === "name", "program_updated.fields would list only name");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
