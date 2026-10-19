/**
 * Dry-run of planTrackerSync, the same planner POST /api/programs/tracker-sync/preview uses.
 *
 * Current RLMS values come from Programs_Diff.xlsx (the fields that differ). Cells the
 * diff does not list already match, so they are seeded from the sheet and then skipped.
 * Does not open a database connection.
 *
 *   npx tsx script/apply_program_tracker_sync.ts \
 *     --tracker tracker.xlsx --diff Programs_Diff.xlsx \
 *     --out previews/program_tracker_sync
 *
 * --apply is refused unless RLMS_ALLOW_PROGRAM_SYNC_APPLY=1 and DATABASE_URL
 * are both set, and even then this CLI does not connect.
 */
import ExcelJS from "exceljs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  NEW_SHOPS,
  TAB_PROGRAM_ALIASES,
  excelCellValue,
  identityKeys,
  normalizeCarNumber,
  normalizeShopName,
  parseSheetCars,
  planTrackerSync,
  splitMarks,
  summaryPrograms,
  writesOnly,
  type FieldTarget,
  type PlannedChange,
  type RlmsCar,
  type SheetCar,
  type ShopRecord,
} from "../shared/program-tracker-sync";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

async function loadSheets(path: string): Promise<Map<string, unknown[][]>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(path) as any);
  const sheets = new Map<string, unknown[][]>();
  wb.eachSheet((sheet) => {
    const rows: unknown[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      rows.push((row.values as unknown[]).slice(1).map(excelCellValue));
    });
    sheets.set(sheet.name, rows);
  });
  return sheets;
}

function display(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return utcDay(value) ?? "";
  return String(value);
}

function csv(rows: Record<string, unknown>[], headers = rows.length ? Object.keys(rows[0]) : []): string {
  const esc = (value: unknown) => {
    const s = display(value);
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
  console.error("refusing --apply: this CLI does not open a database connection. Install migrations/20261113_program_global_optional_fields.sql after migrations/20261112_remark_in_place.sql, then apply from Programs → Tracker sync. Undo uses the same change group.");
  process.exit(2);
}

function utcDay(raw: unknown): string | null {
  if (!(raw instanceof Date) || Number.isNaN(raw.getTime())) return null;
  const y = raw.getUTCFullYear();
  const m = String(raw.getUTCMonth() + 1).padStart(2, "0");
  const d = String(raw.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isNaText(raw: unknown): boolean {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return text === "n/a" || text === "na" || text === "n.a." || text === "#n/a";
}

type DiffRec = {
  program: string;
  program_car_id: number;
  car: string;
  field: string;
  current: unknown;
  action: string;
};

function fieldKey(field: string): string {
  return field === "shop_location" ? "shop_id" : field;
}

function previewValue(row: PlannedChange): string {
  if (row.column === "shop_id") {
    if (row.note.startsWith("new shop:")) return row.note.slice("new shop:".length).trim();
    if (row.note.startsWith("shop ")) return row.note.slice("shop ".length).trim();
  }
  return row.proposed == null ? "" : String(row.proposed);
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

const shops: ShopRecord[] = [];
const shopIds = new Map<string, number>();
let nextShopId = 100;
function rememberShop(name: unknown, id?: number): number | null {
  const label = String(name ?? "").replace(/\s+/g, " ").trim();
  const norm = normalizeShopName(label);
  if (!norm || isNaText(label)) return null;
  if (NEW_SHOPS.some((shop) => normalizeShopName(shop) === norm)) return null;
  const known = shopIds.get(norm);
  if (known) return known;
  const assigned = id && Number.isFinite(id) ? id : nextShopId++;
  shopIds.set(norm, assigned);
  shops.push({ id: assigned, name: label });
  return assigned;
}
for (const row of (diff.get("Shop matches") ?? []).slice(1)) {
  const id = Number(row[1]);
  if (row[0] && Number.isFinite(id)) rememberShop(row[0], id);
}

const diffsByProgram = new Map<string, Map<number, DiffRec[]>>();
for (const row of (diff.get("Field diffs") ?? []).slice(1)) {
  const rec: DiffRec = {
    program: String(row[0] ?? ""),
    program_car_id: Number(row[3]),
    car: String(row[2] ?? ""),
    field: String(row[5] ?? ""),
    current: row[6] == null || row[6] === "" ? null : row[6],
    action: String(row[8] ?? ""),
  };
  const bucket = diffsByProgram.get(rec.program) ?? new Map<number, DiffRec[]>();
  const list = bucket.get(rec.program_car_id) ?? [];
  list.push(rec);
  bucket.set(rec.program_car_id, list);
  diffsByProgram.set(rec.program, bucket);
  if (fieldKey(rec.field) === "shop_id" && rec.current) rememberShop(rec.current);
}

function carKeys(mark: string, number: string): string[] {
  return [...identityKeys(mark, number), ...splitMarks(mark).map((part) => `${part}|${normalizeCarNumber(number)}`)];
}

function blankCode6(field: string, raw: unknown, recs: DiffRec[]): boolean {
  if (field !== "original_code6" && field !== "final_code6") return false;
  if (raw !== 0 && raw !== "0") return false;
  const pair = field === "original_code6" ? "original_code7" : "final_code7";
  const pairRec = recs.find((rec) => rec.field === pair && !rec.action.includes("inactive"));
  return !!pairRec && pairRec.action.includes("fill") && (pairRec.current == null || pairRec.current === "");
}

function baseline(raw: unknown, target: FieldTarget, recs: DiffRec[]): unknown {
  if (raw == null || raw === "" || isNaText(raw)) return null;
  if (target.kind === "custom" && blankCode6(target.key, raw, recs)) return null;
  if (target.kind === "custom" && (target.key === "original_code6" || target.key === "final_code6") && (raw === 0 || raw === "0")) return 0;
  const day = utcDay(raw);
  if (day && (target.kind !== "custom" || target.type === "date" || target.type === "text")) return day;
  return raw;
}

const scope = summaryPrograms(tracker.get("SUMMARY") ?? []).filter((row) => row.active_scope);
const programs = scope.map((row, index) => ({
  id: index + 1,
  name: TAB_PROGRAM_ALIASES[row.sheet] ?? row.sheet,
  sheet: row.sheet,
}));
const carsByProgram = new Map<number, RlmsCar[]>();
const unusedActive: string[] = [];

for (const program of programs) {
  const sheetName = tracker.has(program.sheet) ? program.sheet : tracker.has(program.name) ? program.name : null;
  const aliasTab = Object.entries(TAB_PROGRAM_ALIASES).find(([, rlms]) => rlms === program.name)?.[0];
  const rows = tracker.get(sheetName ?? "") ?? (aliasTab ? tracker.get(aliasTab) : undefined) ?? [];
  const parsed = parseSheetCars(program.sheet, rows);
  const groups = diffsByProgram.get(program.name) ?? new Map<number, DiffRec[]>();
  const used = new Set<number>();
  const cars: RlmsCar[] = [];

  function fromDiff(recs: DiffRec[], sheetCar: SheetCar | null): RlmsCar {
    const inactive = recs.some((rec) => rec.action.includes("inactive"));
    const [mark, number] = recs[0].car.split(/\s+/, 2);
    const diffFields = new Set(recs.map((rec) => fieldKey(rec.field)));
    const custom: Record<string, unknown> = {};
    let status: string | null = null;
    let shop_id: number | null = null;
    for (const rec of recs) {
      const key = fieldKey(rec.field);
      if (key === "shop_id") shop_id = rememberShop(rec.current);
      else if (key === "status") status = rec.current == null ? null : String(rec.current);
      else custom[key] = rec.current;
    }
    if (sheetCar) {
      for (const cell of sheetCar.cells) {
        const target = cell.target;
        if (target.kind === "custom" && target.write && !diffFields.has(target.key)) {
          const value = baseline(cell.raw, target, recs);
          if (value !== null || blankCode6(target.key, cell.raw, recs)) custom[target.key] = value;
        }
        if (target.kind === "column" && target.key === "shop_id" && !diffFields.has("shop_id")) {
          shop_id = rememberShop(cell.raw);
        }
        if (target.kind === "column" && target.key === "status" && !diffFields.has("status") && cell.raw != null && !isNaText(cell.raw)) {
          status = String(cell.raw);
        }
      }
    }
    return {
      program_car_id: recs[0].program_car_id,
      program_id: program.id,
      program_name: program.name,
      railcar_id: recs[0].program_car_id,
      active: !inactive,
      exited: false,
      reporting_marks: sheetCar?.mark || mark || "",
      car_number: sheetCar?.number || number || "",
      status,
      notes: null,
      shop_id,
      shop_name: null,
      custom_fields: custom,
    };
  }

  for (const sheetCar of parsed.cars) {
    const want = new Set(carKeys(sheetCar.mark, sheetCar.number).concat(carKeys(sheetCar.newMark, sheetCar.newNumber || sheetCar.number)));
    const hits: DiffRec[][] = [];
    for (const [id, recs] of groups) {
      if (used.has(id)) continue;
      const [mark, number] = recs[0].car.split(/\s+/, 2);
      if (carKeys(mark ?? "", number ?? "").some((key) => want.has(key))) hits.push(recs);
    }
    if (hits.length === 1) {
      used.add(hits[0][0].program_car_id);
      cars.push(fromDiff(hits[0], sheetCar));
      continue;
    }
    if (hits.length > 1) {
      for (const recs of hits) {
        used.add(recs[0].program_car_id);
        cars.push(fromDiff(recs, sheetCar));
      }
      continue;
    }
    const custom: Record<string, unknown> = {};
    let shop_id: number | null = null;
    let status: string | null = null;
    for (const cell of sheetCar.cells) {
      const target = cell.target;
      if (target.kind === "custom" && target.write) {
        const value = baseline(cell.raw, target, []);
        if (value != null) custom[target.key] = value;
      }
      if (target.kind === "column" && target.key === "shop_id") shop_id = rememberShop(cell.raw);
      if (target.kind === "column" && target.key === "status" && cell.raw != null && !isNaText(cell.raw)) status = String(cell.raw);
    }
    cars.push({
      program_car_id: -cars.length - 1,
      program_id: program.id,
      program_name: program.name,
      railcar_id: 0,
      active: true,
      exited: false,
      reporting_marks: sheetCar.mark,
      car_number: sheetCar.number,
      status,
      notes: null,
      shop_id,
      shop_name: null,
      custom_fields: custom,
    });
  }
  for (const [id, recs] of groups) {
    if (used.has(id)) continue;
    if (!recs.some((rec) => rec.action.includes("inactive"))) unusedActive.push(`${program.name} ${recs[0].car}`);
    cars.push(fromDiff(recs, null));
  }
  carsByProgram.set(program.id, cars);
}

const plan = await planTrackerSync({
  summaryRows: tracker.get("SUMMARY") ?? [],
  sheetNames: Array.from(tracker.keys()),
  rowsFor: (name) => tracker.get(name),
  programs,
  shops,
  carsFor: async (program) => carsByProgram.get(program.id) ?? [],
});

const writes = writesOnly(plan.changes);
const reviews = plan.changes.filter((row) => row.action === "review");
const code6 = plan.changes.filter((row) => row.action === "code6 zero");
const tally = { "fill blank": 0, change: 0, clear: 0, review: 0, "code6 zero": 0, skip: 0 };
for (const row of plan.changes) tally[row.action] += 1;

const byProgram = new Map<string, { fill_blank: number; change: number; clear: number; review: number; code6_zero: number; inactive: number }>();
function bucket(program: string) {
  const row = byProgram.get(program) ?? { fill_blank: 0, change: 0, clear: 0, review: 0, code6_zero: 0, inactive: 0 };
  byProgram.set(program, row);
  return row;
}
for (const row of plan.changes) {
  const item = bucket(row.program);
  if (row.action === "fill blank") item.fill_blank += 1;
  else if (row.action === "change") item.change += 1;
  else if (row.action === "clear") item.clear += 1;
  else if (row.action === "review") item.review += 1;
  else if (row.action === "code6 zero") item.code6_zero += 1;
}
for (const row of plan.inactiveCars) bucket(row.program).inactive += 1;

const changeRows = writes.map((row) => ({
  program: row.program,
  program_car_id: row.program_car_id,
  car: row.car,
  field: row.field,
  current: row.current ?? "",
  proposed: previewValue(row),
  action: row.action,
  note: row.note,
}));
const reviewRows = [
  ...reviews.map((row) => ({
    program: row.program,
    program_car_id: row.program_car_id,
    car: row.car,
    field: row.field,
    current: row.current ?? "",
    proposed: row.proposed ?? "",
    note: row.note,
  })),
  ...plan.carReviews.map((row) => ({
    program: row.program,
    program_car_id: "",
    car: row.car,
    field: "",
    current: "",
    proposed: "",
    note: row.note,
  })),
];
const code6Rows = code6.map((row) => ({
  program: row.program,
  program_car_id: row.program_car_id,
  car: row.car,
  field: row.field,
  current: row.current ?? "",
  proposed: row.proposed ?? "",
  action: row.action,
  note: row.note,
}));

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "field_changes.csv"), csv(changeRows));
writeFileSync(resolve(outDir, "review.csv"), csv(reviewRows, ["program", "program_car_id", "car", "field", "current", "proposed", "note"]));
writeFileSync(resolve(outDir, "code6_zeros.csv"), csv(code6Rows, ["program", "program_car_id", "car", "field", "current", "proposed", "action", "note"]));
writeFileSync(resolve(outDir, "inactive_skipped.csv"), csv(plan.inactiveCars.map((row) => ({
  program: row.program,
  program_car_id: row.program_car_id,
  car: row.car,
  note: "inactive car - no change",
}))));
writeFileSync(resolve(outDir, "shops_to_add.csv"), csv(NEW_SHOPS.filter((name) => !shops.some((shop) => normalizeShopName(shop.name) === normalizeShopName(name))).map((name) => ({ name }))));
writeFileSync(resolve(outDir, "column_layouts.csv"), csv(plan.layouts.map((layout) => ({
  program: layout.program,
  list_key: "program_cars:<program_id>",
  view_name: layout.view_name,
  is_shared: true,
  is_default: true,
  cols: layout.visible_cols.cols.join("|"),
}))));
writeFileSync(resolve(outDir, "summary_by_program.csv"), csv([...byProgram.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([program, counts]) => ({ program, ...counts }))));
writeFileSync(resolve(outDir, "unmapped_headers.csv"), csv(plan.unmapped));
writeFileSync(resolve(outDir, "car_counts.csv"), csv(plan.carCounts.map((row) => ({
  ...row,
  evidence: expectedCars.get(row.sheet) ?? expectedCars.get(row.program) ?? null,
}))));

let columnFileRows = 0;
if (columnsPath) {
  const text = readFileSync(resolve(columnsPath), "utf8").trim();
  columnFileRows = text ? text.split(/\r?\n/).length - 1 : 0;
}
const mismatched = plan.carCounts.filter((row) => {
  const evidence = expectedCars.get(row.sheet) ?? expectedCars.get(row.program);
  return evidence == null || row.parsed !== evidence;
});
const counts = {
  fill_blank: tally["fill blank"],
  change: tally.change,
  clear: tally.clear,
  review: tally.review + plan.carReviews.length,
  code6_zero: tally["code6 zero"],
  inactive_cars: plan.inactiveSkipped,
  shops_to_add: NEW_SHOPS.filter((name) => !shops.some((shop) => normalizeShopName(shop.name) === normalizeShopName(name))),
  layouts: plan.layouts.length,
  column_file_rows: columnFileRows,
  mismatched_sheets: mismatched,
  unused_active_cars: unusedActive,
};
writeFileSync(resolve(outDir, "counts.json"), JSON.stringify(counts, null, 2) + "\n");
console.log(JSON.stringify(counts, null, 2));

const expected = { fill_blank: 2478, change: 620, clear: 460, review: 244, code6_zero: 57 };
const countMismatch = (Object.keys(expected) as (keyof typeof expected)[]).filter((key) => counts[key] !== expected[key]);
if (countMismatch.length || mismatched.length || counts.shops_to_add.length !== 2 || counts.layouts !== 19 || unusedActive.length) {
  console.error("preview counts did not match the dry-run of planTrackerSync");
  process.exit(1);
}
