/* eslint-disable no-console */
/**
 * Run: npx tsx server/railcar-search-filter.test.ts
 *
 * Without fleet=1, applySearchFilter must build the same or= clauses as master
 * (cb13b19). Car type, equipment, mechanical designation, and general description
 * are added only when Car data is on. AAR, description, and notes are not part
 * of master's list.
 */
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

import { carNumberSearchPattern } from "../shared/residco-import";

const { applySearchFilter, railcarSearchTokens } = await import("./railcar-list");

type Scope = { cars: boolean; leases: boolean; carData: boolean };
type Token = { value: string; carNumberOnly?: boolean };

const CAR_NUMBER_FIELDS = ["reporting_marks", "car_initial", "car_number"] as const;
const LEASE_OL_FIELDS = ["lessee_name", "rider_external_id", "assignment_label"] as const;
/** Master's CAR_DATA_FIELDS. Copied here so this file stays the expected snapshot. */
const MASTER_CAR_DATA_FIELDS = [
  "car_type",
  "equipment_type_code",
  "general_description",
  "mechanical_designation",
] as const;

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

function capture() {
  const ors: string[] = [];
  const query = {
    or(clause: string) {
      ors.push(clause);
      return query;
    },
  };
  return { query, ors };
}

/** Master's applySearchFilter loop, from cb13b19, using the same tokenizer. */
function masterClauses(raw: string, scope?: Scope): string[] {
  const tokens = railcarSearchTokens(raw) as Token[];
  const sc = scope ?? { cars: true, leases: true, carData: false };
  const ors: string[] = [];
  for (const tok of tokens) {
    const t = tok.value;
    const parts: string[] = [];
    if (tok.carNumberOnly) {
      parts.push(`car_number.ilike.%${carNumberSearchPattern(t)}%`);
      ors.push(parts.join(","));
      continue;
    }
    const hasLetter = /[a-z]/i.test(t);
    const hasDigit = /\d/.test(t);
    if (sc.cars) {
      if (hasDigit && !hasLetter) parts.push(`car_number.ilike.%${t}%`);
      else for (const col of CAR_NUMBER_FIELDS) parts.push(`${col}.ilike.%${t}%`);
    }
    if (sc.leases) {
      for (const col of LEASE_OL_FIELDS) parts.push(`${col}.ilike.%${t}%`);
    }
    if (sc.carData) {
      for (const col of MASTER_CAR_DATA_FIELDS) parts.push(`${col}.ilike.%${t}%`);
    }
    if (parts.length) ors.push(parts.join(","));
  }
  return ors;
}

function actualClauses(raw: string, scope?: Scope, fleetCodes?: boolean): string[] {
  const { query, ors } = capture();
  applySearchFilter(query, raw, scope, fleetCodes ? { fleetCodes: true } : undefined);
  return ors;
}

const QUERIES = ["FL", "LO", "GT", "C614", "hopper"];
const FLEET_ONLY = ["car_type", "equipment_type_code", "aar_designation", "mechanical_designation", "general_description", "notes"];

function mentions(clause: string, column: string): boolean {
  return clause.split(",").some((part) => part.startsWith(`${column}.ilike.`));
}

for (const term of QUERIES) {
  const got = actualClauses(term);
  const expected = masterClauses(term);
  ok(got.join("\n") === expected.join("\n"), `${term} without fleet=1 matches master`);
  const joined = got.join(",");
  ok(
    !FLEET_ONLY.some((col) => mentions(joined, col)) && !mentions(joined, "description"),
    `${term} does not search car-data columns unless Car data is ticked`,
  );

  const withData = actualClauses(term, { cars: true, leases: true, carData: true });
  const masterData = masterClauses(term, { cars: true, leases: true, carData: true });
  ok(withData.join("\n") === masterData.join("\n"), `${term} with Car data matches master`);
  const dataJoined = withData.join(",");
  ok(
    MASTER_CAR_DATA_FIELDS.every((col) => mentions(dataJoined, col)),
    `${term} with Car data searches master's car type, equipment, mechanical, and description columns`,
  );
  ok(!mentions(dataJoined, "aar_designation"), `${term} with Car data does not add AAR`);
  ok(!mentions(dataJoined, "description") && !mentions(dataJoined, "notes"), `${term} with Car data does not add notes`);
}

const c614 = actualClauses("C614");
ok(c614.length === 2, "C614 is a mark token plus a car-number token");
ok(c614[0] === masterClauses("C614")[0] && c614[1].includes("car_number.ilike.%000614%"), "C614 number clause is the padded car number");

const fleet = actualClauses("FL", undefined, true).join(",");
ok(mentions(fleet, "mechanical_designation") && mentions(fleet, "car_type") && mentions(fleet, "aar_designation"), "fleet=1 still searches car type, AAR, and mechanical");
ok(!mentions(fleet, "description") && !mentions(fleet, "notes"), "fleet=1 does not add notes unless Car data is ticked");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
