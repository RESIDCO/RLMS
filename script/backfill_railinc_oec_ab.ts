/**
 * One-time load: UMLER A&B / Original Cost CSV → railcars.railinc_oec + railcar_ab_items.
 *
 *   npx tsx script/backfill_railinc_oec_ab.ts "C:\\Users\\BruceHarbridge\\Downloads\\BHARBRID-CSV-20260816-134351.csv"
 *   npx tsx script/backfill_railinc_oec_ab.ts "<csv>" --confirm
 *
 * Dry-run by default. Never writes oec / nbv / oac.
 */
import fs from "fs";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import { matchKey, parseAbExportCsv } from "../shared/ab-export-backfill.ts";

const csvPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
const confirm = process.argv.includes("--confirm");

if (!csvPath || !fs.existsSync(csvPath)) {
  console.error("Usage: npx tsx script/backfill_railinc_oec_ab.ts <csv-path> [--confirm]");
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
  oec: number | null;
  railinc_oec: number | null;
};

async function fetchAllCars(): Promise<CarRow[]> {
  const out: CarRow[] = [];
  let from = 0;
  let selectCols = "id, reporting_marks, car_number, oec, railinc_oec";
  for (;;) {
    const { data, error } = await sb
      .from("railcars")
      .select(selectCols)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) {
      if (selectCols.includes("railinc_oec") && /railinc_oec/i.test(error.message)) {
        selectCols = "id, reporting_marks, car_number, oec";
        from = 0;
        out.length = 0;
        continue;
      }
      throw error;
    }
    const chunk = (data ?? []).map((r: any) => ({
      ...r,
      railinc_oec: r.railinc_oec ?? null,
    })) as CarRow[];
    out.push(...chunk);
    if (chunk.length < 1000) break;
    from += 1000;
  }
  return out;
}

const parsed = parseAbExportCsv(fs.readFileSync(csvPath, "utf8"));
const cars = await fetchAllCars();

const { data: codeRows, error: codeErr } = await sb.from("dv_ab_codes").select("code");
if (codeErr) throw codeErr;
const knownCodes = new Set((codeRows ?? []).map((r: { code: string }) => r.code));
const unknownInCsv = parsed.unknownCodes.filter((c) => !knownCodes.has(c));

const byKey = new Map<string, CarRow[]>();
for (const c of cars) {
  const k = matchKey(c.reporting_marks ?? "", c.car_number ?? "");
  const list = byKey.get(k) ?? [];
  list.push(c);
  byKey.set(k, list);
}

type OecUpdate = { id: number; from: number | null; to: number; mark: string; car: string };
type AbInsert = {
  railcar_id: number;
  seq: number;
  code: string;
  amount: number;
  sign: "P" | "N";
  application_date: string;
};

const oecUpdates: OecUpdate[] = [];
const abInserts: AbInsert[] = [];
let unmatched = 0;
let unmatchedWithData = 0;
const unmatchedSamples: string[] = [];

for (const row of parsed.rows) {
  if (row.confidential) continue;
  const hits = byKey.get(matchKey(row.mark, row.car_number));
  if (!hits?.length) {
    unmatched += 1;
    if (row.railinc_oec != null || row.abItems.length) {
      unmatchedWithData += 1;
      if (unmatchedSamples.length < 15) unmatchedSamples.push(row.rawId);
    }
    continue;
  }
  for (const car of hits) {
    if (row.railinc_oec != null) {
      oecUpdates.push({
        id: car.id,
        from: car.railinc_oec != null ? Number(car.railinc_oec) : null,
        to: row.railinc_oec,
        mark: row.mark,
        car: row.car_number,
      });
    }
    for (const it of row.abItems) {
      if (!knownCodes.has(it.code)) continue;
      abInserts.push({
        railcar_id: car.id,
        seq: it.seq,
        code: it.code,
        amount: it.amount,
        sign: it.sign,
        application_date: it.application_date,
      });
    }
  }
}

const uniqueOecCars = new Set(oecUpdates.map((u) => u.id));
const uniqueAbCars = new Set(abInserts.map((u) => u.railcar_id));

function spot(
  mark: string,
  num: string,
): { oec?: OecUpdate; abs: AbInsert[] } {
  const carHits = byKey.get(matchKey(mark, num)) ?? [];
  const id = carHits[0]?.id;
  return {
    oec: oecUpdates.find((u) => u.id === id),
    abs: abInserts.filter((a) => a.railcar_id === id).sort((a, b) => a.seq - b.seq),
  };
}

const summary = {
  csvPath,
  totalDataRows: parsed.totalDataRows,
  confidentialRows: parsed.confidentialRows,
  skippedMalformedId: parsed.skippedMalformedId,
  csvOecPopulated: parsed.oecPopulated,
  csvCarsWithAb: parsed.carsWithAb,
  csvAbItemCount: parsed.abItemCount,
  unknownCodesInCsv: unknownInCsv,
  parseWarningCount: parsed.parseWarnings.length,
  unmatchedRows: unmatched,
  unmatchedWithData,
  unmatchedSamples,
  oecWouldWrite: oecUpdates.length,
  uniqueOecCars: uniqueOecCars.size,
  abWouldInsert: abInserts.length,
  uniqueAbCars: uniqueAbCars.size,
  spotChecks: {
    CKIX_016011: spot("CKIX", "016011"),
    OFOX_023501: spot("OFOX", "023501"),
    OFOX_011657: spot("OFOX", "011657"),
  },
  mode: confirm ? "CONFIRM_WRITE" : "DRY_RUN",
};

console.log(JSON.stringify(summary, null, 2));
if (parsed.parseWarnings.length) {
  console.log("parseWarnings (first 20):", parsed.parseWarnings.slice(0, 20));
}

if (!confirm) {
  console.log("\nDry-run only. Re-run with --confirm to write.");
  process.exit(0);
}

if (unknownInCsv.length) {
  console.error("Abort: unknown A&B codes not in dv_ab_codes:", unknownInCsv);
  process.exit(1);
}

let oecWritten = 0;
for (let i = 0; i < oecUpdates.length; i += 100) {
  const chunk = oecUpdates.slice(i, i + 100);
  await Promise.all(
    chunk.map(async (u) => {
      const { error } = await sb.from("railcars").update({ railinc_oec: u.to }).eq("id", u.id);
      if (error) throw error;
      oecWritten += 1;
    }),
  );
  process.stdout.write(`\roec ${Math.min(i + 100, oecUpdates.length)}/${oecUpdates.length}`);
}
console.log(`\nrailinc_oec written: ${oecWritten}`);

// Replace A&B rows for affected cars (idempotent re-run).
const abCarIds = [...uniqueAbCars];
for (let i = 0; i < abCarIds.length; i += 200) {
  const ids = abCarIds.slice(i, i + 200);
  const { error } = await sb.from("railcar_ab_items").delete().in("railcar_id", ids);
  if (error) throw error;
}

let abWritten = 0;
for (let i = 0; i < abInserts.length; i += 200) {
  const chunk = abInserts.slice(i, i + 200);
  const { error } = await sb.from("railcar_ab_items").insert(chunk);
  if (error) throw error;
  abWritten += chunk.length;
  process.stdout.write(`\rab ${abWritten}/${abInserts.length}`);
}
console.log(`\nrailcar_ab_items inserted: ${abWritten}`);

const { count: oecCount } = await sb
  .from("railcars")
  .select("id", { count: "exact", head: true })
  .not("railinc_oec", "is", null);
const { count: abCount } = await sb
  .from("railcar_ab_items")
  .select("id", { count: "exact", head: true });
const { count: abCarCount } = await sb
  .from("railcar_ab_items")
  .select("railcar_id", { count: "exact", head: true });

console.log(
  JSON.stringify(
    {
      done: true,
      railcarsWithRailincOec: oecCount,
      railcarAbItemsRows: abCount,
      note: "abCarCount via distinct not available; uniqueAbCars from load = " + uniqueAbCars.size,
    },
    null,
    2,
  ),
);
