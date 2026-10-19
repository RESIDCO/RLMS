/* eslint-disable no-console */
/** Run: npx tsx server/search-focus.test.ts */

import { openStopFocusFields } from "@shared/saved-views";
import { decoratePasteSearch } from "./search-focus";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const fox = openStopFocusFields(
  [{ type: "Abatement", stop_date: "2026-10-16", reason: "quality repair", actual_resume_date: null }],
  new Date("2026-10-19T16:00:00.000Z"),
);

const focused = await decoratePasteSearch(
  { railcars: [{ id: 29330, notes: null as string | null }] },
  { focus: 1 },
  async (rows) => rows.map((row) => ({ ...row, ...fox })),
);
const car = focused.railcars[0] as { open_stop_type?: string | null; open_stop_since?: string | null; open_stop_reason?: string | null };
ok(car.open_stop_type === "Abatement", "POST /api/search focus=1 returns open_stop_type Abatement");
ok(car.open_stop_since === "2026-10-16", "POST /api/search focus=1 returns open_stop_since 2026-10-16");
ok(String(car.open_stop_reason).includes("quality repair"), "POST /api/search focus=1 returns the quality repair reason");

let attached = false;
const plain = await decoratePasteSearch(
  { railcars: [{ id: 29330, notes: null as string | null }] },
  {},
  async (rows) => {
    attached = true;
    return rows;
  },
);
ok(!attached && !("open_stop_type" in plain.railcars[0]), "POST /api/search without focus=1 adds no focus keys");

const closed = await decoratePasteSearch(
  { railcars: [{ id: 1, notes: null as string | null }] },
  { focus: 1 },
  async (rows) => rows.map((row) => ({
    ...row,
    ...openStopFocusFields([{ type: "Off rent", stop_date: "2026-01-01", reason: "shop", actual_resume_date: "2026-01-02" }]),
  })),
);
const closedCar = closed.railcars[0] as { open_stop_type: string | null };
ok(closedCar.open_stop_type == null, "a closed stop is never attached");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
