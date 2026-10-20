/* eslint-disable no-console */
/** Run: npx tsx shared/crm-source.test.ts */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTO_EXPIRY_CHANGE_ERROR,
  AUTO_EXPIRY_SOURCE_ERROR,
  mergeSourceSuggestions,
  normalizeOpportunitySource,
  resolveOpportunitySourceWrite,
} from "./crm";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const preset = normalizeOpportunitySource("  Manual  ");
ok(preset.ok && preset.value === "manual", "preset label collapses to the key");
const free = normalizeOpportunitySource("  Broker   book ");
ok(free.ok && free.value === "Broker book", "free text keeps casing and collapses whitespace");
ok(!normalizeOpportunitySource("x".repeat(61)).ok, "a source longer than 60 characters is rejected");
ok(normalizeOpportunitySource("Auto expiry").ok === false && normalizeOpportunitySource("Auto expiry").error === AUTO_EXPIRY_SOURCE_ERROR, "Auto expiry is rejected");
ok(!normalizeOpportunitySource("auto_expiry ").ok, "auto_expiry with a trailing space is rejected");
const same = resolveOpportunitySourceWrite("auto_expiry", "patch", "auto_expiry");
ok(same.ok && same.value === "auto_expiry", "an unchanged auto_expiry patch is allowed");
const away = resolveOpportunitySourceWrite("manual", "patch", "auto_expiry");
ok(!away.ok && away.error === AUTO_EXPIRY_CHANGE_ERROR, "patching away from auto_expiry is rejected");
const toward = resolveOpportunitySourceWrite("auto_expiry", "patch", "manual");
ok(!toward.ok, "patching to auto_expiry is rejected");
const created = resolveOpportunitySourceWrite("auto_expiry", "create", null);
ok(!created.ok, "create cannot store auto_expiry");
const suggestions = mergeSourceSuggestions(["broker book", "Broker Book", "manual", "auto_expiry"]);
ok(suggestions[0].value === "manual" && suggestions.some((row) => row.value === "Broker Book") && suggestions.filter((row) => row.value.toLowerCase() === "broker book").length === 1, "suggestions dedupe free text and omit auto_expiry");

const root = join(import.meta.dirname, "..");
const opportunities = readFileSync(join(root, "server/crm-opportunities.ts"), "utf8");
ok(opportunities.includes('source: "auto_expiry"'), "the renewal generator still writes auto_expiry");
ok(opportunities.includes("resolveOpportunitySourceWrite"), "create and patch normalize source through the shared helper");
const up = readFileSync(join(root, "migrations/20261121_crm_bid_import_p1.sql"), "utf8");
const down = readFileSync(join(root, "migrations/20261121_crm_bid_import_p1_down.sql"), "utf8");
for (const hash of [
  "66be7d422ec47e8c711f83c8ca001c79",
  "fda2979bbd2d37e82c936b0abcdf8927",
  "ee76481bbbeb897c18d4f0349e9c0f2d",
  "b997a1a457d73f865b29560eeef625a6",
]) {
  ok(up.includes(hash) && down.includes(hash), `migration guard includes ${hash}`);
}
ok(down.includes("down refused:"), "down refuses when a source is outside the presets");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
