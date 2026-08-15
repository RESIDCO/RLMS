/**
 * One-time production backfill: Equipment Id + Built Date CSV → railcars.build_year only.
 *
 *   npx tsx script/backfill_build_year.ts "C:\\Users\\BruceHarbridge\\Downloads\\BHARBRID-CSV-20260815-121822.csv"
 *   npx tsx script/backfill_build_year.ts "<csv>" --confirm
 *
 * Dry-run by default. --confirm writes build_year. Never writes built_year or any other column.
 */
import fs from "fs";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import { matchKey, parseBuildYearCsv } from "../shared/build-year-backfill.ts";

const csvPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
const confirm = process.argv.includes("--confirm");

if (!csvPath || !fs.existsSync(csvPath)) {
  console.error("Usage: npx tsx script/backfill_build_year.ts <csv-path> [--confirm]");
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

type CarRow = {
  id: number;
  reporting_marks: string | null;
  car_number: string | null;
  build_year: number | null;
  built_year: number | null;
  active: boolean | null;
  entity: string | null;
  lessee_name: string | null;
  nbv: number | null;
  financial_snapshot_month: string | null;
};

async function fetchAllCars(): Promise<CarRow[]> {
  const out: CarRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("railcars")
      .select(
        "id, reporting_marks, car_number, build_year, built_year, active, entity, lessee_name, nbv, financial_snapshot_month"
      )
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    const chunk = (data ?? []) as CarRow[];
    out.push(...chunk);
    if (chunk.length < 1000) break;
    from += 1000;
  }
  return out;
}

const parsed = parseBuildYearCsv(fs.readFileSync(csvPath, "utf8"));
const cars = await fetchAllCars();

const byKey = new Map<string, CarRow[]>();
for (const c of cars) {
  const k = matchKey(c.reporting_marks ?? "", c.car_number ?? "");
  const list = byKey.get(k) ?? [];
  list.push(c);
  byKey.set(k, list);
}

const updates: Array<{ id: number; from: number | null; to: number; active: boolean | null }> = [];
let unmatched = 0;
for (const row of parsed.dated) {
  const hits = byKey.get(matchKey(row.mark, row.car_number));
  if (!hits?.length) {
    unmatched += 1;
    continue;
  }
  for (const car of hits) {
    updates.push({ id: car.id, from: car.build_year, to: row.year, active: car.active });
  }
}

const uniqueIds = new Set(updates.map((u) => u.id));
const alreadySame = updates.filter((u) => u.from === u.to).length;
const wouldChange = updates.filter((u) => u.from !== u.to).length;
const activeMatched = updates.filter((u) => u.active === true).length;
const inactiveMatched = updates.filter((u) => u.active !== true).length;
const buildYearBefore = cars.filter((c) => c.build_year != null).length;

const summary = {
  csvPath,
  totalDataRows: parsed.totalDataRows,
  confidentialSkipped: parsed.confidential,
  invalidDates: parsed.invalidDates.length,
  malformedIds: parsed.skippedMalformedId,
  datedRows: parsed.dated.length,
  unmatchedDatedRows: unmatched,
  matchedUpdates: updates.length,
  uniqueCars: uniqueIds.size,
  alreadySame,
  wouldChange,
  activeMatched,
  inactiveMatched,
  matchRateOfCsv: parsed.totalDataRows
    ? Math.round((uniqueIds.size / parsed.totalDataRows) * 1000) / 10
    : 0,
  buildYearPopulatedBefore: buildYearBefore,
  write: confirm,
  fieldsWritten: ["build_year"],
};

console.log(JSON.stringify(summary, null, 2));
if (parsed.invalidDates.length) {
  console.log("INVALID_DATES " + JSON.stringify(parsed.invalidDates.slice(0, 20)));
}

if (!confirm) {
  console.log("Dry-run only. Pass --confirm to write railcars.build_year.");
  process.exit(0);
}

const pending = updates.filter((u) => u.from !== u.to);
const WAVE = 40;
let written = 0;
for (let i = 0; i < pending.length; i += WAVE) {
  const slice = pending.slice(i, i + WAVE);
  const results = await Promise.all(
    slice.map((u) => sb.from("railcars").update({ build_year: u.to }).eq("id", u.id))
  );
  for (const r of results) {
    if (r.error) throw r.error;
  }
  written += slice.length;
  if (written % 500 === 0 || written === pending.length) {
    console.log(`wrote ${written}/${pending.length}`);
  }
}

const sampleIds = pending.slice(0, 8).map((u) => u.id);
if (sampleIds.length) {
  const { data, error } = await sb
    .from("railcars")
    .select(
      "id, reporting_marks, car_number, build_year, built_year, active, entity, lessee_name, nbv, financial_snapshot_month"
    )
    .in("id", sampleIds);
  if (error) throw error;
  const beforeById = new Map(cars.map((c) => [c.id, c]));
  const spot = (data ?? []).map((after: CarRow) => {
    const before = beforeById.get(after.id)!;
    return {
      id: after.id,
      marks: after.reporting_marks,
      car_number: after.car_number,
      build_year: after.build_year,
      built_year_unchanged: after.built_year === before.built_year,
      active_unchanged: after.active === before.active,
      entity_unchanged: after.entity === before.entity,
      lessee_unchanged: after.lessee_name === before.lessee_name,
      nbv_unchanged: after.nbv === before.nbv,
      financial_snapshot_unchanged: after.financial_snapshot_month === before.financial_snapshot_month,
    };
  });
  console.log("SPOT_CHECK " + JSON.stringify(spot, null, 2));
}

const afterCount = await sb
  .from("railcars")
  .select("id", { count: "exact", head: true })
  .not("build_year", "is", null);
console.log(
  JSON.stringify(
    {
      ok: true,
      written,
      skippedAlreadySame: alreadySame,
      buildYearPopulatedAfter: afterCount.count ?? null,
    },
    null,
    2
  )
);
