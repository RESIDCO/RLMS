/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import { jssGroups, parseJssPreviewCsv } from "./jss-preview";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const text = readFileSync(new URL("../script/_railcars_bundle/jss_preview.csv", import.meta.url), "utf8");
const rows = parseJssPreviewCsv(text);
ok(rows.length === 45, `45 plan rows (got ${rows.length})`);
const g = jssGroups(rows);
ok(g.a.length === 36, `Group A 36 (got ${g.a.length})`);
ok(g.b.length === 8, `Group B 8 (got ${g.b.length})`);
ok(g.c.length === 1 && /001621/.test(g.c[0].car), "Group C TFOX 001621 inactive");
ok(g.a.filter((r) => r.ol === "OL1961").length === 1, "100284 stays on OL1961");
ok(g.a.every((r) => r.off_rent_date && r.cut_up_date && r.sale_date), "A has arrival+cut-up+sale");
ok(g.b.every((r) => !r.off_rent_date && r.note), "B notes only");
const disc = g.a.filter((r) => r.discrepancy_comment);
ok(disc.length === 8, `8 cut-up < arrival comments (got ${disc.length})`);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
