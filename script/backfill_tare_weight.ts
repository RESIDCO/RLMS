/**
 * One-time production backfill: Equipment Id + Tare Weight CSV → railcars.tare_weight_lbs only.
 *
 *   npx tsx script/backfill_tare_weight.ts "C:\\Users\\BruceHarbridge\\OneDrive - RESIDCO\\Desktop\\simpleEquipmentQueryResult (21)_TARE Weight.csv"
 *   npx tsx script/backfill_tare_weight.ts "<csv>" --confirm
 *
 * Dry-run by default. Never writes build_year, railinc_oec, oec, nbv, or any other column.
 * Blank Tare Weight cells are skipped (never write 0 or NULL over an existing value).
 * Non-null file values overwrite an existing tare_weight_lbs.
 */
import fs from "fs";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import { matchKey, parseTareWeightCsv } from "../shared/tare-weight-backfill.ts";

const csvPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
const confirm = process.argv.includes("--confirm");

if (!csvPath || !fs.existsSync(csvPath)) {
  console.error("Usage: npx tsx script/backfill_tare_weight.ts <csv-path> [--confirm]");
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
  tare_weight_lbs: number | null;
};

async function fetchAllCars(): Promise<CarRow[]> {
  const out: CarRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("railcars")
      .select("id, reporting_marks, car_number, tare_weight_lbs")
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

const parsed = parseTareWeightCsv(fs.readFileSync(csvPath, "utf8"));
const cars = await fetchAllCars();

const byKey = new Map<string, CarRow[]>();
for (const c of cars) {
  const k = matchKey(c.reporting_marks ?? "", c.car_number ?? "");
  const list = byKey.get(k) ?? [];
  list.push(c);
  byKey.set(k, list);
}

type Update = {
  id: number;
  from: number | null;
  to: number;
  mark: string;
  car: string;
};

const updates: Update[] = [];
let unmatched = 0;
const unmatchedSamples: string[] = [];

for (const row of parsed.rows) {
  const hits = byKey.get(matchKey(row.mark, row.car_number));
  if (!hits?.length) {
    unmatched += 1;
    if (unmatchedSamples.length < 15) unmatchedSamples.push(row.rawId);
    continue;
  }
  for (const car of hits) {
    updates.push({
      id: car.id,
      from: car.tare_weight_lbs != null ? Number(car.tare_weight_lbs) : null,
      to: row.tare_weight_lbs,
      mark: row.mark,
      car: row.car_number,
    });
  }
}

const uniqueIds = new Set(updates.map((u) => u.id));
const alreadySame = updates.filter((u) => u.from === u.to).length;
const wouldChange = updates.filter((u) => u.from !== u.to).length;
const wouldOverwrite = updates.filter((u) => u.from != null && u.from !== u.to).length;
const populatedBefore = cars.filter((c) => c.tare_weight_lbs != null).length;

function spot(mark: string, num: string) {
  return updates.find((u) => u.mark === mark && u.car === num) ?? null;
}

const summary = {
  csvPath,
  totalDataRows: parsed.totalDataRows,
  csvWithTare: parsed.rows.length,
  blankTareSkipped: parsed.blankTare,
  blankTareIds: parsed.blankTareIds,
  skippedMalformedId: parsed.skippedMalformedId,
  skippedNonNumericTare: parsed.skippedNonNumericTare,
  duplicateDerivedKeys: parsed.duplicateKeys,
  unmatchedRows: unmatched,
  unmatchedSamples,
  matchedUpdates: updates.length,
  uniqueCars: uniqueIds.size,
  alreadySame,
  wouldChange,
  wouldOverwriteNonNull: wouldOverwrite,
  tarePopulatedBefore: populatedBefore,
  write: confirm,
  fieldsWritten: ["tare_weight_lbs"],
  spotChecks: {
    AOKX_040015: spot("AOKX", "040015"),
    CKIX_016011: spot("CKIX", "016011"),
    AEX_022766: spot("AEX", "022766"),
  },
};

console.log(JSON.stringify(summary, null, 2));

if (parsed.duplicateKeys.length) {
  console.error("Abort: duplicate derived (mark, car_number) keys in the file.");
  process.exit(1);
}

if (!confirm) {
  console.log("\nDry-run only. Pass --confirm to write railcars.tare_weight_lbs.");
  process.exit(0);
}

const pending = updates.filter((u) => u.from !== u.to);
const WAVE = 40;
let written = 0;
for (let i = 0; i < pending.length; i += WAVE) {
  const slice = pending.slice(i, i + WAVE);
  const results = await Promise.all(
    slice.map((u) => sb.from("railcars").update({ tare_weight_lbs: u.to }).eq("id", u.id)),
  );
  for (const r of results) {
    if (r.error) throw r.error;
  }
  written += slice.length;
  if (written % 500 === 0 || written === pending.length) {
    console.log(`wrote ${written}/${pending.length}`);
  }
}

const { data: aokx, error: aokxErr } = await sb
  .from("railcars")
  .select("reporting_marks, car_number, tare_weight_lbs")
  .eq("reporting_marks", "AOKX")
  .eq("car_number", "040015")
  .maybeSingle();
if (aokxErr) throw aokxErr;
const { data: ckix, error: ckixErr } = await sb
  .from("railcars")
  .select("reporting_marks, car_number, tare_weight_lbs")
  .eq("reporting_marks", "CKIX")
  .eq("car_number", "016011")
  .maybeSingle();
if (ckixErr) throw ckixErr;

const after = await sb.from("railcars").select("id", { count: "exact", head: true }).not("tare_weight_lbs", "is", null);
const zeros = await sb.from("railcars").select("id", { count: "exact", head: true }).eq("tare_weight_lbs", 0);

console.log(
  JSON.stringify(
    {
      ok: true,
      written,
      skippedAlreadySame: alreadySame,
      tarePopulatedAfter: after.count ?? null,
      tareZeroCount: zeros.count ?? null,
      aokx040015: aokx,
      ckix016011: ckix,
    },
    null,
    2,
  ),
);
