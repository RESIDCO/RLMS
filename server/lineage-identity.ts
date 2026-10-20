/**
 * Read-only car resolution for /api/lineage?q=.
 * Selects railcars and car_number_history. Does not write.
 */

import {
  LINEAGE_CAR_CAP,
  LINEAGE_TOO_MANY_MESSAGE,
  lineageLookupMarks,
  lineageLookupNumbers,
  lineageNumberVariants,
  parseLineageQuery,
  resolveLineageIdentities,
  type LineageCarRow,
  type LineageHistoryRow,
  type LineageIdentityResult,
  type LineageQueryPlan,
} from "@shared/lineage-identity";
import { supabaseAdmin } from "./supabase";

const PAGE = 200;
const IN_CHUNK = 80;
const HISTORY_SELECT = "id, railcar_id, old_car_initial, old_car_number, new_car_initial, new_car_number";
const CAR_SELECT = "id, car_number, reporting_marks, car_initial";

function logSkip(label: string, message: string): void {
  console.log(`[lineage] ${label} skipped: ${message}`);
}

function asCar(row: Record<string, unknown>): LineageCarRow {
  return {
    id: Number(row.id),
    car_number: row.car_number == null ? null : String(row.car_number),
    reporting_marks: row.reporting_marks == null ? null : String(row.reporting_marks),
    car_initial: row.car_initial == null ? null : String(row.car_initial),
  };
}

function asHistory(row: Record<string, unknown>): LineageHistoryRow {
  return {
    railcar_id: Number(row.railcar_id),
    old_car_initial: row.old_car_initial == null ? null : String(row.old_car_initial),
    old_car_number: row.old_car_number == null ? null : String(row.old_car_number),
    new_car_initial: row.new_car_initial == null ? null : String(row.new_car_initial),
    new_car_number: row.new_car_number == null ? null : String(row.new_car_number),
  };
}

async function selectIn(
  table: "railcars" | "car_number_history",
  column: string,
  values: string[],
  select: string,
): Promise<Record<string, unknown>[]> {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const slice = unique.slice(i, i + IN_CHUNK);
    const { data, error } = await supabaseAdmin.from(table).select(select).in(column, slice);
    if (error) {
      logSkip(`${table}.${column}`, error.message);
      continue;
    }
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
  }
  return rows;
}

async function selectIlike(
  table: "railcars" | "car_number_history",
  column: string,
  number: string,
  select: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select(select)
    .ilike(column, `%${number}%`)
    .limit(LINEAGE_CAR_CAP);
  if (error) {
    logSkip(`${table}.${column} ilike`, error.message);
    return [];
  }
  return (data ?? []) as unknown as Record<string, unknown>[];
}

async function historyForMark(mark: string): Promise<{ rows: LineageHistoryRow[]; tooMany: boolean }> {
  const rows: LineageHistoryRow[] = [];
  const seen = new Set<number>();
  const columns = ["old_car_initial", "new_car_initial"] as const;
  for (const column of columns) {
    let finished = false;
    for (let from = 0; from < 5000; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from("car_number_history")
        .select(HISTORY_SELECT)
        .ilike(column, mark)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        logSkip(column, error.message);
        finished = true;
        break;
      }
      const batch = (data ?? []) as unknown as Record<string, unknown>[];
      for (const row of batch) {
        const history = asHistory(row);
        rows.push(history);
        if (Number.isFinite(history.railcar_id) && history.railcar_id > 0) seen.add(history.railcar_id);
      }
      if (seen.size > LINEAGE_CAR_CAP) return { rows: [], tooMany: true };
      if (batch.length < PAGE) {
        finished = true;
        break;
      }
    }
    if (!finished) return { rows: [], tooMany: true };
  }
  return { rows, tooMany: false };
}

function digitNumbers(values: string[]): string[] {
  return values.filter((number) => /^\d+$/.test(number));
}

async function loadCars(plan: LineageQueryPlan): Promise<LineageCarRow[]> {
  const { exact, loose } = lineageLookupNumbers(plan);
  const variants = digitNumbers(exact).flatMap((number) => lineageNumberVariants(number));
  const rows = await selectIn("railcars", "car_number", variants, CAR_SELECT);
  for (const number of digitNumbers(loose)) {
    rows.push(...(await selectIlike("railcars", "car_number", number, CAR_SELECT)));
  }
  return rows.map(asCar);
}

async function loadHistory(plan: LineageQueryPlan): Promise<{ rows: LineageHistoryRow[]; tooMany: boolean }> {
  const rows: LineageHistoryRow[] = [];
  for (const mark of lineageLookupMarks(plan)) {
    if (!/^[A-Z]+$/.test(mark)) continue;
    const found = await historyForMark(mark);
    if (found.tooMany) return { rows: [], tooMany: true };
    rows.push(...found.rows);
  }
  const { exact, loose } = lineageLookupNumbers(plan);
  const variants = digitNumbers(exact).flatMap((number) => lineageNumberVariants(number));
  const oldRows = await selectIn("car_number_history", "old_car_number", variants, HISTORY_SELECT);
  const newRows = await selectIn("car_number_history", "new_car_number", variants, HISTORY_SELECT);
  rows.push(...oldRows.map(asHistory), ...newRows.map(asHistory));
  for (const number of digitNumbers(loose)) {
    const oldLike = await selectIlike("car_number_history", "old_car_number", number, HISTORY_SELECT);
    const newLike = await selectIlike("car_number_history", "new_car_number", number, HISTORY_SELECT);
    rows.push(...oldLike.map(asHistory), ...newLike.map(asHistory));
  }
  return { rows, tooMany: false };
}

export async function resolveLineageRailcars(raw: string): Promise<LineageIdentityResult> {
  const plan = parseLineageQuery(raw);
  if (plan.message || plan.identities.length === 0) return { ids: [], message: plan.message };
  const [cars, history] = await Promise.all([loadCars(plan), loadHistory(plan)]);
  if (history.tooMany) return { ids: [], message: LINEAGE_TOO_MANY_MESSAGE };
  return resolveLineageIdentities(raw, cars, history.rows);
}
