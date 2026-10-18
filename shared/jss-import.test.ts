/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import { parseJssPreviewCsv, jssGroups } from "./jss-preview";
import { buildJssPlanFromSources, planKey } from "./jss-import";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const expected = parseJssPreviewCsv(
  readFileSync(new URL("../script/_railcars_bundle/jss_preview.csv", import.meta.url), "utf8"),
);
const cutup = JSON.parse(
  readFileSync(new URL("../script/_railcars_bundle/jss_cutup_rows.json", import.meta.url), "utf8"),
) as unknown[][];
const trace = readFileSync(new URL("../script/_railcars_bundle/jss_source.csv", import.meta.url), "utf8");
const rebuilt = buildJssPlanFromSources({
  cutupRows: cutup,
  traceCsv: trace,
  cars: expected.map((r) => ({ car: r.car, railcar_id: r.railcar_id, active: r.active, ol: r.ol })),
});
ok(rebuilt.length === expected.length, `same row count ${rebuilt.length} vs ${expected.length}`);
const g = jssGroups(rebuilt);
ok(g.a.length === 36, `rebuild Group A ${g.a.length}`);
ok(g.b.length === 8, `rebuild Group B ${g.b.length}`);
ok(g.c.length === 1, "rebuild Group C");
const expKeys = new Set(expected.map(planKey));
const gotKeys = new Set(rebuilt.map(planKey));
const missing = [...expKeys].filter((k) => !gotKeys.has(k));
ok(missing.length === 0, missing.length ? `missing ${missing.join(" ; ")}` : "plan keys match jss_preview.csv");
const extra = [...gotKeys].filter((k) => !expKeys.has(k));
ok(extra.length === 0, extra.length ? `extra ${extra.join(" ; ")}` : "no extra plan keys");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
