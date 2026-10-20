/**
 * Read-only car resolution for /api/lineage?q=.
 * Selects railcars and car_number_history. Does not write.
 * A failed lookup is raised so the caller does not show a partial car list.
 */

import {
  LINEAGE_BARE_NUMBER_LIMIT,
  LINEAGE_MATCH_CAP,
  lineageLookupMarks,
  lineageLookupNumbers,
  lineageLookupRanges,
  lineageNumberVariants,
  parseLineageQuery,
  resolveLineageIdentities,
  type LineageCarRow,
  type LineageHistoryRow,
  type LineageIdentityResult,
  type LineageQueryPlan,
} from "@shared/lineage-identity";
import { supabaseAdmin } from "./supabase";

const MATCH_FETCH = LINEAGE_MATCH_CAP + 1;
const IN_CHUNK = 80;
const HISTORY_SELECT = "id, railcar_id, old_car_initial, old_car_number, new_car_initial, new_car_number";
const CAR_SELECT = "id, car_number, reporting_marks, car_initial";

type QueryResult = { data: unknown; error: { message: string } | null };
type Query = {
  gte: (column: string, value: string) => Query;
  lte: (column: string, value: string) => Query;
  like: (column: string, pattern: string) => Query;
  ilike: (column: string, pattern: string) => Query;
  in: (column: string, values: string[]) => Query;
  or: (filters: string) => Query;
  limit: (count: number) => Query;
  then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>;
};

function table(name: "railcars" | "car_number_history"): Query {
  return supabaseAdmin.from(name).select(CAR_SELECT) as unknown as Query;
}

function historyTable(): Query {
  return supabaseAdmin.from("car_number_history").select(HISTORY_SELECT) as unknown as Query;
}

async function readRows(label: string, query: Query): Promise<Record<string, unknown>[]> {
  const { data, error } = await query;
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error(`Lineage search failed (${label})`);
  return data as Record<string, unknown>[];
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

function uniqueDigits(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!/^\d+$/.test(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

async function selectIn(
  name: "railcars" | "car_number_history",
  column: string,
  values: string[],
  selectIsHistory: boolean,
): Promise<Record<string, unknown>[]> {
  const unique = uniqueDigits(values);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const slice = unique.slice(i, i + IN_CHUNK);
    const query = (selectIsHistory ? historyTable() : table(name)).in(column, slice);
    const batch = await readRows(`${name}.${column}`, query);
    for (const row of batch) rows.push(row);
  }
  return rows;
}

async function selectIlike(
  name: "railcars" | "car_number_history",
  column: string,
  number: string,
  selectIsHistory: boolean,
): Promise<Record<string, unknown>[]> {
  const query = (selectIsHistory ? historyTable() : table(name))
    .ilike(column, `%${number}%`)
    .limit(LINEAGE_BARE_NUMBER_LIMIT);
  return readRows(`${name}.${column} ilike`, query);
}

function withMark(query: Query, name: "railcars" | "car_number_history", mark: string | null): Query {
  if (!mark || !/^[A-Z]+$/.test(mark)) return query;
  if (name === "railcars") return query.or(`reporting_marks.ilike.${mark},car_initial.ilike.${mark}`);
  return query.or(`old_car_initial.ilike.${mark},new_car_initial.ilike.${mark}`);
}

async function selectRange(
  name: "railcars" | "car_number_history",
  column: string,
  low: string,
  high: string,
  mark: string | null,
): Promise<Record<string, unknown>[]> {
  const query = withMark(
    (name === "car_number_history" ? historyTable() : table(name))
      .gte(column, low)
      .lte(column, high)
      .like(column, "_".repeat(low.length))
      .limit(MATCH_FETCH),
    name,
    mark,
  );
  return readRows(`${name}.${column} range`, query);
}

async function historyForMark(mark: string): Promise<LineageHistoryRow[]> {
  const rows: LineageHistoryRow[] = [];
  const columns = ["old_car_initial", "new_car_initial"] as const;
  for (const column of columns) {
    const batch = await readRows(column, historyTable().ilike(column, mark).limit(MATCH_FETCH));
    for (const row of batch) rows.push(asHistory(row));
  }
  return rows;
}

async function loadCars(plan: LineageQueryPlan): Promise<LineageCarRow[]> {
  const { exact, loose } = lineageLookupNumbers(plan);
  const variants = uniqueDigits(exact).flatMap((number) => lineageNumberVariants(number));
  const rows = await selectIn("railcars", "car_number", variants, false);
  for (const number of uniqueDigits(loose)) {
    const like = await selectIlike("railcars", "car_number", number, false);
    for (const row of like) rows.push(row);
  }
  for (const range of lineageLookupRanges(plan)) {
    const ranged = await selectRange("railcars", "car_number", range.low, range.high, range.mark);
    for (const row of ranged) rows.push(row);
  }
  const cars: LineageCarRow[] = [];
  for (const row of rows) cars.push(asCar(row));
  return cars;
}

async function loadHistory(plan: LineageQueryPlan): Promise<LineageHistoryRow[]> {
  const rows: LineageHistoryRow[] = [];
  for (const mark of lineageLookupMarks(plan)) {
    if (!/^[A-Z]+$/.test(mark)) continue;
    const found = await historyForMark(mark);
    for (const row of found) rows.push(row);
  }
  const { exact, loose } = lineageLookupNumbers(plan);
  const variants = uniqueDigits(exact).flatMap((number) => lineageNumberVariants(number));
  const oldRows = await selectIn("car_number_history", "old_car_number", variants, true);
  const newRows = await selectIn("car_number_history", "new_car_number", variants, true);
  for (const row of oldRows) rows.push(asHistory(row));
  for (const row of newRows) rows.push(asHistory(row));
  for (const number of uniqueDigits(loose)) {
    const oldLike = await selectIlike("car_number_history", "old_car_number", number, true);
    const newLike = await selectIlike("car_number_history", "new_car_number", number, true);
    for (const row of oldLike) rows.push(asHistory(row));
    for (const row of newLike) rows.push(asHistory(row));
  }
  for (const range of lineageLookupRanges(plan)) {
    const oldRange = await selectRange("car_number_history", "old_car_number", range.low, range.high, range.mark);
    const newRange = await selectRange("car_number_history", "new_car_number", range.low, range.high, range.mark);
    for (const row of oldRange) rows.push(asHistory(row));
    for (const row of newRange) rows.push(asHistory(row));
  }
  return rows;
}

export async function resolveLineageRailcars(raw: string): Promise<LineageIdentityResult> {
  const plan = parseLineageQuery(raw);
  if (plan.message || plan.identities.length === 0) return { ids: [], message: plan.message };
  const [cars, history] = await Promise.all([loadCars(plan), loadHistory(plan)]);
  return resolveLineageIdentities(raw, cars, history);
}
