/* eslint-disable no-console */
/** Run: npx tsx shared/carTypeAliases.test.ts */

import {
  CAR_TYPE_ALIASES,
  classifyFleetQuery,
  fleetMatchLabel,
  fleetOrClause,
  fleetPatternToLike,
  matchCarTypeAlias,
} from "./carTypeAliases";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(CAR_TYPE_ALIASES.length >= 4, "alias map has the seed rules");

const hopper = matchCarTypeAlias("Covered Hoppers");
ok(hopper?.id === "covered-hopper", "covered hoppers matches the hopper rule");
ok(hopper?.mechanical.includes("LO") === true, "hopper rule includes mechanical LO");
ok(hopper?.carTypes.includes("C*") === true, "hopper rule includes car type C*");
ok(matchCarTypeAlias("tub gon")?.id === "tub-gon", "tub gon is the tub rule");
ok(matchCarTypeAlias("tub gondola")?.carTypes.includes("J31*") === true, "tub gondola is J31*");
ok(matchCarTypeAlias("gon")?.id === "gondola", "gon is the gondola rule");
ok(matchCarTypeAlias("gondolas")?.mechanical.includes("GT*") === true, "gondola includes GT*");
ok(matchCarTypeAlias("tank")?.carTypes.includes("T*") === true, "tank is T*");
ok(matchCarTypeAlias("graymont") == null, "graymont is not an alias");
ok(matchCarTypeAlias("tub") == null, "bare tub is not the tub-gon phrase");

ok(classifyFleetQuery("J312").kind === "car_type", "J312 is a car type code");
ok(classifyFleetQuery("c614").kind === "car_type" && (classifyFleetQuery("c614") as { code: string }).code === "C614", "car type codes upper-case");
ok(classifyFleetQuery("LO").kind === "mechanical", "LO is a mechanical candidate");
ok(classifyFleetQuery("t").kind === "mechanical" && (classifyFleetQuery("t") as { code: string }).code === "T", "lower-case t is mechanical");
ok(classifyFleetQuery("HTS").kind === "mechanical", "HTS is mechanical");
ok(classifyFleetQuery("BNSF").kind === "mechanical", "4-letter tokens are mechanical candidates");
ok(classifyFleetQuery("graymont").kind === "text", "words longer than 4 letters stay text");
ok(classifyFleetQuery("OL2330").kind === "text", "OL numbers are not car type codes");
ok(classifyFleetQuery("covered hopper").kind === "alias", "phrase classifies as alias");

ok(fleetPatternToLike("C*") === "C%", "star is a prefix");
ok(fleetPatternToLike("J31*") === "J31%", "J31* prefix");
ok(fleetPatternToLike("LO") === "LO", "exact code has no wildcard");
ok(fleetPatternToLike("GB*") === "GB%", "mechanical prefix");

const j312 = classifyFleetQuery("J312");
if (j312.kind === "car_type") {
  ok(
    fleetOrClause(j312) === 'car_type.ilike."J312",equipment_type_code.ilike."J312"',
    "car type matches both columns exactly",
  );
  ok(fleetMatchLabel(j312, 199) === "Matched car type J312 (199 active)", "car type label includes the active count");
} else {
  ok(false, "J312 class");
}

const lo = classifyFleetQuery("lo");
if (lo.kind === "mechanical") {
  ok(fleetOrClause(lo) === 'mechanical_designation.ilike."LO"', "mechanical match is exact, not a substring");
  ok(fleetMatchLabel(lo, 8190) === "Matched mechanical designation LO (8,190 active)", "mechanical label");
} else {
  ok(false, "LO class");
}

const covered = classifyFleetQuery("covered hopper");
if (covered.kind === "alias") {
  const clause = fleetOrClause(covered);
  ok(clause.includes('mechanical_designation.ilike."LO"'), "alias clause includes LO");
  ok(clause.includes('car_type.ilike."C%"'), "alias clause includes C*");
  ok(clause.includes('equipment_type_code.ilike."C%"'), "alias clause includes equipment type C*");
  ok(fleetMatchLabel(covered) === "Matched rule: covered hopper → mechanical LO or car type C*", "alias label shows the rule");
} else {
  ok(false, "covered hopper class");
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
