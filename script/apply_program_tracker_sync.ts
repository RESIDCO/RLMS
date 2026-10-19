/**
 * Dry-run preview for the programs tracker sync.
 *
 * Writes CSVs under the output directory. Does not open a database connection
 * and does not contain credentials. Active cars only. Never touches rent_events.
 *
 *   npx tsx script/apply_program_tracker_sync.ts \
 *     --tracker tracker.xlsx --diff Programs_Diff.xlsx \
 *     --columns Proposed_Column_Order.csv \
 *     --out previews/program_tracker_sync
 *
 * --apply is refused unless RLMS_ALLOW_PROGRAM_SYNC_APPLY=1 and DATABASE_URL
 * are both set, and even then this CLI does not connect. The write path is
 * POST /api/programs/tracker-sync/apply after the migration is installed.
 */
import ExcelJS from "exceljs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  NEW_SHOPS,
  TRACKER_ORDER_VIEW,
  columnOrderFromHeaders,
  groupByProgram,
  normalizeShopName,
  parseSheetCars,
  reclassifyEvidenceRow,
  resolveTrackerSheet,
  summaryPrograms,
  writesOnly,
  type PlannedChange,
  type ShopRecord,
} from "../shared/program-tracker-sync";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function cellValue(value: unknown): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const row = value as { result?: unknown; text?: unknown; richText?: { text?: string }[] };
    if (Array.isArray(row.richText)) return row.richText.map((part) => part.text ?? "").join("");
    if ("result" in row && row.result != null) return cellValue(row.result);
    if (typeof row.text === "string") return row.text;
  }
  return value;
}

async function loadSheets(path: string): Promise<Map<string, unknown[][]>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(path) as any);
  const sheets = new Map<string, unknown[][]>();
  wb.eachSheet((sheet) => {
    const rows: unknown[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      rows.push((row.values as unknown[]).slice(1).map(cellValue));
    });
    sheets.set(sheet.name, rows);
  });
  return sheets;
}

function csv(rows: Record<string, unknown>[], headers = rows.length ? Object.keys(rows[0]) : []): string {
  const esc = (value: unknown) => {
    const s = value == null ? "" : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => esc(row[h])).join(","));
  return lines.join("\n") + "\n";
}

function refuseApply(): never {
  if (process.env.RLMS_ALLOW_PROGRAM_SYNC_APPLY !== "1") {
    console.error("refusing --apply: set RLMS_ALLOW_PROGRAM_SYNC_APPLY=1 to acknowledge a write. Dry-run is the default and does not need that flag.");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error("refusing --apply: DATABASE_URL is not set. This script never stores credentials.");
    process.exit(2);
  }
  console.error("refusing --apply: this CLI does not open a database connection. Install migrations/20261112_program_global_optional_fields.sql, then apply from Programs → Tracker sync. Undo uses the same change group.");
  process.exit(2);
}

const trackerPath = arg("--tracker");
const diffPath = arg("--diff");
const columnsPath = arg("--columns");
const outDir = resolve(arg("--out") ?? "previews/program_tracker_sync");

if (process.argv.includes("--apply")) refuseApply();
if (!trackerPath || !diffPath) {
  console.error("usage: tsx script/apply_program_tracker_sync.ts --tracker <xlsx> --diff <xlsx> [--columns <csv>] [--out previews/program_tracker_sync]");
  process.exit(1);
}

const tracker = await loadSheets(resolve(trackerPath));
const diff = await loadSheets(resolve(diffPath));
const summaryRows = diff.get("Summary") ?? [];
const expectedCars = new Map<string, number>();
for (const row of summaryRows.slice(1)) {
  const sheet = String(row[0] ?? "").trim();
  const count = Number(row[3]);
  if (!sheet || !Number.isFinite(count)) continue;
  expectedCars.set(sheet, count);
}

const shopRows = diff.get("Shop matches") ?? [];
const shops: ShopRecord[] = [];
for (const row of shopRows.slice(1)) {
  const name = String(row[0] ?? "").trim();
  const id = Number(row[1]);
  if (name && Number.isFinite(id)) shops.push({ id, name });
}

const fieldRows = diff.get("Field diffs") ?? [];
const inactive: Record<string, unknown>[] = [];
const planned: PlannedChange[] = [];
const dropped: { program: string; car: string; field: string; action: string }[] = [];
for (const row of fieldRows.slice(1)) {
  const evidence = {
    program: String(row[0] ?? ""),
    program_car_id: Number(row[3]),
    car: String(row[2] ?? ""),
    field: String(row[5] ?? ""),
    current: row[6],
    proposed: row[7],
    action: String(row[8] ?? ""),
    note: row[10] == null ? "" : String(row[10]),
  };
  if (evidence.action.includes("inactive")) {
    inactive.push({
      program: evidence.program,
      program_car_id: evidence.program_car_id,
      car: evidence.car,
      field: evidence.field,
      action: evidence.action,
    });
    continue;
  }
  const next = reclassifyEvidenceRow(evidence, shops);
  if (!next) {
    dropped.push({ program: evidence.program, car: evidence.car, field: evidence.field, action: evidence.action });
    continue;
  }
  planned.push(next);
}

const writes = writesOnly(planned);
const reviews = planned.filter((row) => row.action === "review");
const groups = groupByProgram(planned);
const inactiveByProgram = new Map<string, number>();
for (const row of inactive) {
  const program = String(row.program);
  inactiveByProgram.set(program, (inactiveByProgram.get(program) ?? 0) + 1);
}

const scope = summaryPrograms(tracker.get("SUMMARY") ?? []).filter((row) => row.active_scope);
const carCounts: { program: string; sheet: string; parsed: number; evidence: number | null }[] = [];
const layouts: Record<string, unknown>[] = [];
const unmapped: Record<string, unknown>[] = [];
const trackerNames = Array.from(tracker.keys());
for (const row of scope) {
  const sheetName = resolveTrackerSheet(row.sheet, trackerNames);
  const rows = sheetName ? tracker.get(sheetName) ?? [] : [];
  const parsed = parseSheetCars(sheetName ?? row.sheet, rows);
  const evidence = (sheetName ? expectedCars.get(sheetName) : undefined) ?? expectedCars.get(row.sheet) ?? null;
  carCounts.push({ program: row.sheet, sheet: sheetName ?? "", parsed: parsed.cars.length, evidence });
  const order = columnOrderFromHeaders(parsed.headers.map((h) => h.header));
  layouts.push({
    program: row.sheet,
    list_key: "program_cars:<program_id>",
    view_name: TRACKER_ORDER_VIEW,
    is_shared: true,
    is_default: true,
    cols: order.join("|"),
  });
  for (const header of parsed.unmapped) unmapped.push({ header, sheet: sheetName ?? row.sheet });
}

const shopsToAdd = NEW_SHOPS.filter((name) => !shops.some((shop) => normalizeShopName(shop.name) === normalizeShopName(name))).map((name) => ({ name }));

let columnFileRows = 0;
if (columnsPath) {
  const text = readFileSync(resolve(columnsPath), "utf8").trim();
  columnFileRows = text ? text.split(/\r?\n/).length - 1 : 0;
}

const tally = { "fill blank": 0, change: 0, clear: 0, review: 0, skip: 0 };
for (const row of planned) tally[row.action] += 1;

const summary = [...new Set([...Object.keys(groups), ...inactiveByProgram.keys()])].sort().map((program) => ({
  program,
  fill_blank: groups[program]?.["fill blank"] ?? 0,
  change: groups[program]?.change ?? 0,
  clear: groups[program]?.clear ?? 0,
  review: groups[program]?.review ?? 0,
  inactive: inactiveByProgram.get(program) ?? 0,
}));

mkdirSync(outDir, { recursive: true });
function previewValue(row: PlannedChange): string {
  if (row.column === "shop_id") {
    if (row.note.startsWith("new shop:")) return row.note.slice("new shop:".length).trim();
    if (row.note.startsWith("shop ")) return row.note.slice("shop ".length).trim();
  }
  return row.proposed == null ? "" : String(row.proposed);
}

writeFileSync(resolve(outDir, "field_changes.csv"), csv(writes.map((row) => ({
  program: row.program,
  program_car_id: row.program_car_id,
  car: row.car,
  field: row.field,
  current: row.current ?? "",
  proposed: previewValue(row),
  action: row.action,
  note: row.note,
}))));
writeFileSync(resolve(outDir, "review.csv"), csv(reviews.map((row) => ({
  program: row.program,
  program_car_id: row.program_car_id,
  car: row.car,
  field: row.field,
  current: row.current ?? "",
  proposed: row.proposed ?? "",
  note: row.note,
})), ["program", "program_car_id", "car", "field", "current", "proposed", "note"]));
writeFileSync(resolve(outDir, "inactive_skipped.csv"), csv(inactive));
writeFileSync(resolve(outDir, "shops_to_add.csv"), csv(shopsToAdd));
writeFileSync(resolve(outDir, "column_layouts.csv"), csv(layouts));
writeFileSync(resolve(outDir, "summary_by_program.csv"), csv(summary));
writeFileSync(resolve(outDir, "unmapped_headers.csv"), csv(unmapped));
writeFileSync(resolve(outDir, "car_counts.csv"), csv(carCounts));

const mismatched = carCounts.filter((row) => row.evidence == null || row.parsed !== row.evidence);
const counts = {
  fill_blank: tally["fill blank"],
  change: tally.change,
  clear: tally.clear,
  review: tally.review,
  inactive: inactive.length,
  dropped: dropped.length,
  shops_to_add: shopsToAdd.map((row) => row.name),
  layouts: layouts.length,
  column_file_rows: columnFileRows,
  mismatched_sheets: mismatched,
};
writeFileSync(resolve(outDir, "counts.json"), JSON.stringify(counts, null, 2) + "\n");
console.log(JSON.stringify(counts, null, 2));

// 73 of 76 new-shop rows fill a blank shop. Three CP cars already have
// "Prairie Line Shop", so those are changes (619 other changes + 3).
const expected = { fill_blank: 2484, change: 622, clear: 460, review: 0, inactive: 1329 };
const countMismatch = (Object.keys(expected) as (keyof typeof expected)[]).filter((key) => counts[key] !== expected[key]);
if (countMismatch.length || mismatched.length || shopsToAdd.length !== 2 || layouts.length !== 19) {
  console.error("preview counts did not match the signed-off expectation");
  process.exit(1);
}
