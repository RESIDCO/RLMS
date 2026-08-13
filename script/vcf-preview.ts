/**
 * Dry-run VCF review against a local workbook (non-prod gate).
 * Usage: npx tsx script/vcf-preview.ts "path/to/V_VALID_CARS.xlsx"
 */
import fs from "fs";
import path from "path";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { buildVcfReview } from "../shared/vcf-import.ts";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const filePath = process.argv[2];
if (!filePath || !fs.existsSync(filePath)) {
  console.error("Usage: npx tsx script/vcf-preview.ts <path-to-V_VALID_CARS.xlsx>");
  process.exit(1);
}

const wb = XLSX.readFile(filePath, { cellDates: true });
const sheetName = wb.SheetNames.find((n) => /^V_VALID_CARS$/i.test(n)) ?? wb.SheetNames[0];
const ws = wb.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true }) as Record<string, unknown>[];

console.error(`Sheet: ${sheetName} · rows: ${rows.length}`);

const existingKeys = new Set<string>();
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (url && key) {
  const sb = createClient(url, key);
  const { data, error } = await sb.from("railcars").select("car_initial, car_number, reporting_marks");
  if (error) {
    console.error("Warn: could not load existing railcars:", error.message);
  } else {
    for (const r of data ?? []) {
      const initial = String(r.car_initial || r.reporting_marks || "")
        .trim()
        .toUpperCase();
      const num = String(r.car_number ?? "").trim();
      if (initial || num) existingKeys.add(`${initial}|${num}`);
    }
    console.error(`Existing cars in DB: ${existingKeys.size}`);
  }
} else {
  console.error("No Supabase env — treating all cars as new");
}

const review = buildVcfReview(rows, existingKeys);

const out = {
  sourceFile: path.basename(filePath),
  sheet: sheetName,
  totalRows: review.totalRows,
  distinctCars: review.distinctCars,
  newCars: review.newCars,
  updatedCars: review.updatedCars,
  multipleActiveCount: review.multipleActiveCount,
  multipleActiveCars: review.multipleActiveCars,
  badActiveCount: review.badActiveCount,
  badActiveValues: review.badActiveValues,
  unmappedManagedCategoryCount: review.unmappedManagedCategoryCount,
  unmappedManagedCategories: review.unmappedManagedCategories,
};

const outPath = path.join("script", "vcf-preview-last.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.error(`Wrote ${outPath}`);
