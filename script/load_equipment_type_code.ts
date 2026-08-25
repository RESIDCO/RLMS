/**
 * One-time load: simpleEquipmentQueryResult.csv → railcars.equipment_type_code.
 *
 *   npx tsx script/load_equipment_type_code.ts "C:\\Users\\BruceHarbridge\\Downloads\\simpleEquipmentQueryResult.csv"
 *   npx tsx script/load_equipment_type_code.ts "<csv>" --confirm
 *
 * Dry-run by default. --confirm writes equipment_type_code only.
 */
import fs from "fs";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import { parseEquipmentId } from "../shared/build-year-backfill.ts";

const csvPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
const confirm = process.argv.includes("--confirm");

if (!csvPath || !fs.existsSync(csvPath)) {
  console.error("Usage: npx tsx script/load_equipment_type_code.ts <csv-path> [--confirm]");
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function stripZeros(raw: string): string {
  const s = String(raw ?? "").trim().replace(/^0+/, "");
  return s || "0";
}

function equipKey(mark: string, carNumber: string): string {
  return `${String(mark).trim().toUpperCase()}|${stripZeros(carNumber)}`;
}

function parseCsv(text: string): Array<{ rawId: string; mark: string; car_number: string; code: string }> {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const out: Array<{ rawId: string; mark: string; car_number: string; code: string }> = [];
  let skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols: string[] = [];
    let cur = "";
    let inQ = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (ch === "," && !inQ) {
        cols.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    cols.push(cur);
    const id = (cols[0] ?? "").trim();
    const code = (cols[1] ?? "").trim();
    if (i === 0 && /equipment\s*id/i.test(id)) continue;
    const parsed = parseEquipmentId(id);
    if (!parsed || !code) {
      skipped += 1;
      continue;
    }
    out.push({ rawId: id, mark: parsed.mark, car_number: parsed.car_number, code });
  }
  if (skipped) console.warn(`skipped malformed rows: ${skipped}`);
  return out;
}

type CarRow = {
  id: number;
  reporting_marks: string | null;
  car_number: string | null;
  equipment_type_code: string | null;
  active: boolean | null;
  fleet_status: string | null;
};

async function fetchAllCars(): Promise<CarRow[]> {
  const out: CarRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("railcars")
      .select("id, reporting_marks, car_number, equipment_type_code, active, fleet_status")
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

const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
const cars = await fetchAllCars();
const byKey = new Map<string, CarRow[]>();
for (const c of cars) {
  const k = equipKey(c.reporting_marks ?? "", c.car_number ?? "");
  const list = byKey.get(k) ?? [];
  list.push(c);
  byKey.set(k, list);
}

const updates: Array<{ id: number; code: string; from: string | null }> = [];
const unmatchedCsv: typeof rows = [];
const ambiguous: typeof rows = [];
for (const row of rows) {
  const hits = byKey.get(equipKey(row.mark, row.car_number)) ?? [];
  if (hits.length === 0) unmatchedCsv.push(row);
  else if (hits.length > 1) ambiguous.push(row);
  else updates.push({ id: hits[0].id, code: row.code, from: hits[0].equipment_type_code });
}

const matchedIds = new Set(updates.map((u) => u.id));
const unmatchedCars = cars.filter((c) => c.active === true && !matchedIds.has(c.id));
const byStatus = (status: string) => unmatchedCars.filter((c) => String(c.fleet_status ?? "") === status).length;
const leasedGap = unmatchedCars.filter((c) => String(c.fleet_status ?? "") === "Leased");

const summary = {
  csvRows: rows.length,
  uniqueMatchedCars: matchedIds.size,
  unmatchedCsvRows: unmatchedCsv.length,
  ambiguousCsvRows: ambiguous.length,
  alreadySet: updates.filter((u) => u.from === u.code).length,
  wouldChange: updates.filter((u) => u.from !== u.code).length,
  activeUnmatched: unmatchedCars.length,
  unmatchedSold: byStatus("Sold"),
  unmatchedIdle: byStatus("Idle"),
  unmatchedLeased: leasedGap.length,
  unmatchedOther: unmatchedCars.length - byStatus("Sold") - byStatus("Idle") - leasedGap.length,
  write: confirm,
};
console.log(JSON.stringify(summary, null, 2));
if (leasedGap.length) {
  const marks = new Map<string, number>();
  for (const c of leasedGap) {
    const m = String(c.reporting_marks ?? "").trim() || "(blank)";
    marks.set(m, (marks.get(m) ?? 0) + 1);
  }
  console.log(
    "leased unmatched marks:",
    [...marks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
  );
}

if (!confirm) {
  console.log("Dry-run only. Pass --confirm to write equipment_type_code.");
  process.exit(0);
}

const WAVE = 80;
const pending = updates.filter((u) => u.from !== u.code);
for (let i = 0; i < pending.length; i += WAVE) {
  const slice = pending.slice(i, i + WAVE);
  const results = await Promise.all(
    slice.map((u) => sb.from("railcars").update({ equipment_type_code: u.code }).eq("id", u.id)),
  );
  for (const r of results) {
    if (r.error) throw r.error;
  }
  console.log(`wrote ${Math.min(i + WAVE, pending.length)} / ${pending.length}`);
}
console.log("done");
