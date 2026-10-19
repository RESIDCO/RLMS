/**
 * Bulk in-place remark. Does not call remark_railcars (retire-and-create).
 * Writes go through remark_railcars_in_place, which keeps the railcar id.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./fetch-all";
import {
  buildRemarkAliasIndex,
  classifyRemarkBatch,
  parseRemarkMatrix,
  parseRemarkText,
  selectRemarkApply,
  type RemarkAliasTarget,
  type RemarkApplyItem,
  type RemarkCarRecord,
  type RemarkHistoryRef,
  type RemarkInputRow,
  type RemarkPreview,
} from "@shared/remark-in-place";

const CAR_SELECT =
  "id, reporting_marks, car_initial, car_number, active, status, fleet_status, lessee_name, rider_external_id, assignment_label, old_car_initial, old_car_number";

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function numbersOf(rows: RemarkInputRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.old_number) set.add(row.old_number);
    if (row.new_number) set.add(row.new_number);
  }
  return Array.from(set);
}

async function carsByNumbers(numbers: string[]): Promise<RemarkCarRecord[]> {
  const byId = new Map<number, RemarkCarRecord>();
  for (const slice of chunk(numbers, 80)) {
    const [current, prior] = await Promise.all([
      supabaseAdmin.from("railcars").select(CAR_SELECT).in("car_number", slice),
      supabaseAdmin.from("railcars").select(CAR_SELECT).in("old_car_number", slice),
    ]);
    if (current.error) throw current.error;
    if (prior.error) throw prior.error;
    for (const row of [...(current.data ?? []), ...(prior.data ?? [])]) {
      byId.set(Number(row.id), row as RemarkCarRecord);
    }
  }
  return Array.from(byId.values());
}

async function historyForNumbers(numbers: string[]): Promise<RemarkHistoryRef[]> {
  const rows: RemarkHistoryRef[] = [];
  for (const slice of chunk(numbers, 80)) {
    const { data, error } = await supabaseAdmin
      .from("car_number_history")
      .select("railcar_id, old_car_initial, old_car_number")
      .in("old_car_number", slice);
    if (error) throw error;
    rows.push(...((data ?? []) as RemarkHistoryRef[]));
  }
  return rows;
}

async function attachPrograms(cars: RemarkCarRecord[]): Promise<RemarkCarRecord[]> {
  const ids = cars.map((car) => car.id);
  const names = new Map<number, string[]>();
  for (const slice of chunk(ids, 80)) {
    const { data, error } = await supabaseAdmin
      .from("program_cars")
      .select("railcar_id, program:programs(name)")
      .in("railcar_id", slice)
      .is("exited_date", null);
    if (error) throw error;
    for (const row of data ?? []) {
      const program = Array.isArray(row.program) ? row.program[0] : row.program;
      const name = String((program as { name?: string } | null)?.name ?? "").trim();
      if (!name) continue;
      const id = Number(row.railcar_id);
      const list = names.get(id) ?? [];
      if (!list.includes(name)) list.push(name);
      names.set(id, list);
    }
  }
  return cars.map((car) => ({ ...car, program: (names.get(car.id) ?? []).join(", ") || null }));
}

async function hydrateMissing(cars: RemarkCarRecord[], history: RemarkHistoryRef[]): Promise<RemarkCarRecord[]> {
  const have = new Set(cars.map((car) => car.id));
  const missing = Array.from(new Set(history.map((row) => Number(row.railcar_id)).filter((id) => id && !have.has(id))));
  if (!missing.length) return cars;
  const extra: RemarkCarRecord[] = [];
  for (const slice of chunk(missing, 80)) {
    const { data, error } = await supabaseAdmin.from("railcars").select(CAR_SELECT).in("id", slice);
    if (error) throw error;
    extra.push(...((data ?? []) as RemarkCarRecord[]));
  }
  return [...cars, ...extra];
}

export async function previewRemark(rows: RemarkInputRow[]): Promise<RemarkPreview> {
  const numbers = numbersOf(rows);
  const history = numbers.length ? await historyForNumbers(numbers) : [];
  const loaded = numbers.length ? await carsByNumbers(numbers) : [];
  const cars = await attachPrograms(await hydrateMissing(loaded, history));
  return classifyRemarkBatch({ rows, cars, history });
}

export async function applyRemarkInPlace(input: {
  items: RemarkApplyItem[];
  reason: string;
  changedBy: string;
  actor: string;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.rpc("remark_railcars_in_place", {
    p_items: input.items,
    p_reason: input.reason,
    p_changed_by: input.changedBy,
    p_actor: input.actor,
  });
  if (error) throw error;
  return (data ?? {}) as Record<string, unknown>;
}

export function chooseRemarkItems(preview: RemarkPreview, mode: "all" | "good") {
  return selectRemarkApply(preview, mode);
}

export async function loadVcfRemarkAliases(
  db: SupabaseClient,
  cars: Array<{
    id: number;
    reporting_marks?: string | null;
    car_initial?: string | null;
    car_number?: string | null;
    old_car_initial?: string | null;
    old_car_number?: string | null;
  }>,
): Promise<Map<string, RemarkAliasTarget | "ambiguous">> {
  const history = await fetchAllRows<RemarkHistoryRef>((from, to) =>
    db
      .from("car_number_history")
      .select("railcar_id, old_car_initial, old_car_number")
      .order("id", { ascending: true })
      .range(from, to),
  );
  return buildRemarkAliasIndex({ cars, history });
}

function excelCell(value: ExcelJS.CellValue): unknown {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && "richText" in value) {
    return value.richText.map((part) => part.text).join("");
  }
  if (typeof value === "object" && "text" in value && value.text != null) return value.text;
  if (typeof value === "object" && "result" in value) return value.result ?? "";
  return value;
}

export async function parseRemarkUpload(buf: Buffer, filename: string) {
  const name = filename.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) return parseRemarkText(buf.toString("utf8"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { ok: false as const, error: "No cars to remark" };
  const matrix: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    matrix.push(values.slice(1).map((cell) => excelCell(cell)));
  });
  return parseRemarkMatrix(matrix);
}
