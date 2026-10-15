/* eslint-disable no-console */
/**
 * File-vs-itself: if assignment_history already equals the Oct 13 file,
 * matching must be a no-op. Run: npx tsx shared/vcf-oct13-idempotence.test.ts
 */
import { existsSync } from "fs";
import { parseVcfUploadFromPath } from "../server/vcf-workbook.ts";
import { assignmentHistoryPayloadFromPeriod, buildVcfReview, railcarPayloadFromCurrent } from "./vcf-import.ts";
import {
  applyVcfLeaseDateGuard,
  closeoutStats,
  planVcfAssignmentCloseout,
  skipVcfRailcarPatch,
} from "./vcf-assignment-closeout.ts";

const FIXTURES = [
  process.env.VCF_OCT13_FIXTURE,
  "C:\\Users\\BruceHarbridge\\Downloads\\Claude outputs\\V_VALID_CARS_toAlltranstek_10.13.26_LOADER_FIXED.xlsx",
  "script/fixtures/V_VALID_CARS_toAlltranstek_10.13.26_LOADER_FIXED.xlsx",
].filter((p): p is string => Boolean(p));

const file = FIXTURES.find((p) => existsSync(p));
if (!file) {
  console.log("skip: Oct 13 VCF fixture not found");
  process.exit(0);
}

const rows = await parseVcfUploadFromPath(file, "V_VALID_CARS_toAlltranstek_10.13.26_LOADER_FIXED.xlsx");
const keys = new Set(rows.map((r) => `${r.car_initial}|${r.car_number}`));
const review = buildVcfReview(rows, keys, { keepCars: true });

function asStr(v: unknown): string {
  if (v == null || v === "") return "";
  return String(v).trim();
}
function payloadChanged(next: Record<string, unknown>, existing: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(next)) {
    if (asStr(v) !== asStr(existing[k])) return true;
  }
  return false;
}

let inserted = 0;
let updated = 0;
let closed = 0;
let cars = 0;
let carPatches = 0;
let leaseWrites = 0;
for (const car of review.cars) {
  cars += 1;
  const incoming = car.periods.map((p) => assignmentHistoryPayloadFromPeriod(cars, p, "2026-10-15T00:00:00.000Z"));
  const existingRows = incoming.map((p, i) => ({ id: i + 1, ...p }));
  const st = closeoutStats(planVcfAssignmentCloseout({ existingRows, incoming }));
  inserted += st.inserted;
  updated += st.updated;
  closed += st.closed;

  const payload = railcarPayloadFromCurrent(car.current, { needsReview: car.needsReview });
  const existing = {
    ...payload,
    active_source: "auto",
    lease_date_source: "asset_report",
    lease_start_date: "1999-01-01",
    lease_end_date: "2029-09-30",
    lease_expiry: "2029-09-30",
  };
  if (skipVcfRailcarPatch(existing)) continue;
  const next = applyVcfLeaseDateGuard({ ...payload }, existing);
  if ("lease_start_date" in next || "lease_end_date" in next || "lease_expiry" in next) leaseWrites += 1;
  if (payloadChanged(next, existing)) carPatches += 1;
}

console.log("fixture", file);
console.log("cars", cars, "insert", inserted, "update", updated, "close", closed, "carPatches", carPatches, "leaseWrites", leaseWrites);
if (inserted || updated || closed) {
  console.error("FAIL file-vs-itself period matching is not a no-op");
  process.exit(1);
}
if (leaseWrites || carPatches) {
  console.error("FAIL file-vs-itself car patches are not a no-op under asset_report guard");
  process.exit(1);
}
console.log("ok oct13 file-vs-itself 0 period changes and 0 car/lease patches");
