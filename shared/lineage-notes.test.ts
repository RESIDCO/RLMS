/** Run: npx tsx shared/lineage-notes.test.ts */
import {
  appendTimestampedNote,
  capActivityEvents,
  isVcfAssignmentNoise,
  noteWriteDecision,
} from "./lineage-notes";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const inactive = noteWriteDecision({ id: 4, active: false, status: "Storage" });
ok(!inactive.ok && inactive.status === 409, "inactive car is rejected");
const statusInactive = noteWriteDecision({ id: 5, active: true, status: "Inactive" });
ok(!statusInactive.ok && statusInactive.status === 409, "Inactive status is rejected");
const missing = noteWriteDecision(null);
ok(!missing.ok && missing.status === 404, "missing car is rejected");
ok(noteWriteDecision({ id: 6, active: true, status: "Storage" }).ok, "an active storage car can take a note");

const appended = appendTimestampedNote("Kept prior", "Shop called", "10/20/2026 9:00 AM ET");
ok(appended.startsWith("Kept prior\n"), "prior note text is kept");
ok(appended.includes("[10/20/2026 9:00 AM ET] Shop called"), "new note is appended with a stamp");
ok(appendTimestampedNote("  ", "Only", "10/20/2026") === "[10/20/2026] Only", "blank existing notes do not leave a leading blank line");
let emptyThrew = false;
try {
  appendTimestampedNote("x", "  ", "10/20/2026");
} catch {
  emptyThrew = true;
}
ok(emptyThrew, "an empty note is refused");

const noise = { action: "reassignment", source: "vcf-import", actor: "someone", detail: { reason: "load" } };
const real = { action: "note", source: "ui", actor: "ada@example.com", detail: { body: "hello" } };
const reasonNoise = {
  action: "reassignment",
  source: "ui",
  actor: "import",
  detail: { reason: "V_VALID_CARS assignment period closed" },
};
ok(isVcfAssignmentNoise(noise) && isVcfAssignmentNoise(reasonNoise), "VCF assignment rows are noise");
ok(!isVcfAssignmentNoise(real), "a note is not VCF noise");

const head = Array.from({ length: 600 }, () => noise);
const cappedFirst = head.slice(0, 10).filter((row) => !isVcfAssignmentNoise(row));
ok(cappedFirst.length === 0, "capping before the filter would drop the real event");
const kept = capActivityEvents([...head, real], 10, false);
ok(kept.length === 1 && kept[0] === real, "the filter runs before the row cap");
ok(capActivityEvents([...head, real], 2, true).length === 2, "include-vcf keeps the noisy head");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
