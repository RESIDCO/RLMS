import ExcelJS from "exceljs";
import { supabaseAdmin } from "./supabase";
import { splitCarNumber } from "@shared/residco-import";
import {
  excelSheetName,
  formatCustomField,
  isCustomFieldPopulated,
  isProgramStatus,
  parseCarPasteList,
  reportFilename,
  type ProgramFieldDef,
  type ProgramStatus,
} from "@shared/programs";

const PROGRAM_LIST_SELECT = `
id, name, description, status, category_id, tags, entity, account_manager,
status_narrative, percent_complete, target_completion_date, opened_date, closed_date,
custom_fields, created_at, updated_at,
category:program_categories(id, name),
program_cars(id, exited_date),
program_documents(id)
`.replace(/\s+/g, " ").trim();

const CAR_SELECT = `
id, program_id, railcar_id, status, notes, flag_tag, joined_date, exited_date,
completed, completed_at, rider_external_id_snapshot, shop_id, scrap_yard_id, repair_cost_total, custom_fields, added_at,
railcar:railcars(id, car_number, reporting_marks, car_type, status, entity, active, rider_external_id, lessee_name),
shop:shops(id, name, location),
scrap_yard:scrap_yards(id, name, location)
`.replace(/\s+/g, " ").trim();

const CAR_SELECT_NO_COMPLETED = CAR_SELECT.replace("completed, completed_at, ", "");
const COMPLETE_CF = "__complete";

function missingCompletedColumn(err: unknown) {
  const msg = String((err as any)?.message ?? err ?? "");
  return /completed/i.test(msg) && /column|schema cache|does not exist|could not find/i.test(msg);
}

function isCarCompleted(row: any): boolean {
  if (row?.completed === true || row?.completed === "true") return true;
  const cf = row?.custom_fields;
  return Boolean(cf && typeof cf === "object" && (cf as any)[COMPLETE_CF]);
}

export async function logProgramActivity(row: {
  program_id: number;
  action: string;
  actor?: string | null;
  program_car_id?: number | null;
  railcar_id?: number | null;
  detail?: Record<string, unknown>;
}) {
  const { error } = await supabaseAdmin.from("program_activity").insert({
    program_id: row.program_id,
    action: row.action,
    actor: row.actor ?? null,
    program_car_id: row.program_car_id ?? null,
    railcar_id: row.railcar_id ?? null,
    detail: row.detail ?? {},
  });
  if (error) console.log(`[programs] activity log skipped: ${error.message}`);
}

function mapProgramList(p: any) {
  const links = Array.isArray(p.program_cars) ? p.program_cars : [];
  const active = links.filter((c: any) => !c.exited_date).length;
  const total = links.length;
  return {
    ...p,
    category: Array.isArray(p.category) ? p.category[0] ?? null : p.category ?? null,
    car_count: total,
    active_car_count: active,
    doc_count: p.program_documents?.length ?? 0,
    program_cars: undefined,
    program_documents: undefined,
  };
}

export async function listPrograms() {
  const { data, error } = await supabaseAdmin
    .from("programs")
    .select(PROGRAM_LIST_SELECT)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  // Keep recently updated work on top; completed programs still show, but after active ones.
  return (data ?? [])
    .map(mapProgramList)
    .sort((a, b) => Number(a.status === "complete") - Number(b.status === "complete"));
}

export async function listCategories() {
  const { data, error } = await supabaseAdmin
    .from("program_categories")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listFieldDefs(categoryId: number): Promise<ProgramFieldDef[]> {
  const { data, error } = await supabaseAdmin
    .from("program_field_defs")
    .select("*")
    .eq("category_id", categoryId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProgramFieldDef[];
}

export async function getProgram(id: number) {
  const { data, error } = await supabaseAdmin
    .from("programs")
    .select("*, category:program_categories(id, name, description)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const category = Array.isArray(data.category) ? data.category[0] ?? null : data.category;
  const field_defs = data.category_id ? await listFieldDefs(Number(data.category_id)) : [];
  return { ...data, category, field_defs };
}

export async function listProgramCars(programId: number, includeExited: boolean) {
  async function run(select: string) {
    let q = supabaseAdmin
      .from("program_cars")
      .select(select)
      .eq("program_id", programId)
      .order("joined_date", { ascending: true })
      .order("id", { ascending: true });
    if (!includeExited) q = q.is("exited_date", null);
    return q;
  }
  let { data, error } = await run(CAR_SELECT);
  if (error && missingCompletedColumn(error)) {
    ({ data, error } = await run(CAR_SELECT_NO_COMPLETED));
  }
  if (error) throw error;
  return (data ?? [])
    .map((row: any) => {
      const custom_fields = row.custom_fields && typeof row.custom_fields === "object" ? row.custom_fields : {};
      return {
        ...row,
        completed: isCarCompleted({ ...row, custom_fields }),
        railcar: Array.isArray(row.railcar) ? row.railcar[0] ?? null : row.railcar,
        shop: Array.isArray(row.shop) ? row.shop[0] ?? null : row.shop,
        scrap_yard: Array.isArray(row.scrap_yard) ? row.scrap_yard[0] ?? null : row.scrap_yard,
        custom_fields,
        doc_count: 0,
      };
    })
    .sort((a, b) => Number(Boolean(a.completed)) - Number(Boolean(b.completed)));
}

async function attachDocCounts(rows: any[]) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const { data, error } = await supabaseAdmin
    .from("program_car_documents")
    .select("id, program_car_id")
    .in("program_car_id", ids);
  if (error) {
    console.log(`[programs] car doc counts skipped: ${error.message}`);
    return rows;
  }
  const counts = new Map<number, number>();
  for (const d of data ?? []) {
    const id = Number((d as any).program_car_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return rows.map((r) => ({ ...r, doc_count: counts.get(r.id) ?? 0 }));
}

export async function listProgramCarsWithDocs(programId: number, includeExited: boolean) {
  return attachDocCounts(await listProgramCars(programId, includeExited));
}

export async function addCarsToProgram(
  programId: number,
  railcarIds: number[],
  actor: string | null,
) {
  const unique = [...new Set(railcarIds.map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!unique.length) return { added: [], skipped: [] as number[] };

  const { data: openRows, error: openErr } = await supabaseAdmin
    .from("program_cars")
    .select("railcar_id")
    .eq("program_id", programId)
    .is("exited_date", null)
    .in("railcar_id", unique);
  if (openErr) throw openErr;
  const already = new Set((openRows ?? []).map((r: any) => Number(r.railcar_id)));
  const toAdd = unique.filter((id) => !already.has(id));
  const skipped = unique.filter((id) => already.has(id));
  if (!toAdd.length) return { added: [], skipped };

  const { data: cars, error: carErr } = await supabaseAdmin
    .from("railcars")
    .select("id, rider_external_id")
    .in("id", toAdd);
  if (carErr) throw carErr;
  const olById = new Map((cars ?? []).map((c: any) => [Number(c.id), c.rider_external_id ?? null]));
  const today = new Date().toISOString().slice(0, 10);
  const insert = toAdd.map((rid) => ({
    program_id: programId,
    railcar_id: rid,
    joined_date: today,
    rider_external_id_snapshot: olById.get(rid) ?? null,
    custom_fields: {},
  }));
  const { data, error } = await supabaseAdmin.from("program_cars").insert(insert).select("id, railcar_id");
  if (error) throw error;
  for (const row of data ?? []) {
    await logProgramActivity({
      program_id: programId,
      action: "car_added",
      actor,
      program_car_id: row.id,
      railcar_id: row.railcar_id,
    });
  }
  await supabaseAdmin.from("programs").update({ updated_at: new Date().toISOString() }).eq("id", programId);
  return { added: data ?? [], skipped };
}

export async function exitCarFromProgram(programId: number, linkId: number, actor: string | null) {
  const { data: row, error: getErr } = await supabaseAdmin
    .from("program_cars")
    .select("id, railcar_id, exited_date")
    .eq("id", linkId)
    .eq("program_id", programId)
    .maybeSingle();
  if (getErr) throw getErr;
  if (!row) return null;
  if (row.exited_date) return row;
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("program_cars")
    .update({ exited_date: today })
    .eq("id", linkId)
    .select()
    .single();
  if (error) throw error;
  await logProgramActivity({
    program_id: programId,
    action: "car_removed",
    actor,
    program_car_id: linkId,
    railcar_id: row.railcar_id,
    detail: { exited_date: today },
  });
  await supabaseAdmin.from("programs").update({ updated_at: new Date().toISOString() }).eq("id", programId);
  return data;
}

function mapProgramCarRow(data: any) {
  const custom_fields = data.custom_fields && typeof data.custom_fields === "object" ? data.custom_fields : {};
  return {
    ...data,
    completed: isCarCompleted({ ...data, custom_fields }),
    railcar: Array.isArray(data.railcar) ? data.railcar[0] ?? null : data.railcar,
    shop: Array.isArray(data.shop) ? data.shop[0] ?? null : data.shop,
    scrap_yard: Array.isArray(data.scrap_yard) ? data.scrap_yard[0] ?? null : data.scrap_yard,
    custom_fields,
  };
}

export async function patchProgramCar(
  programId: number,
  linkId: number,
  body: Record<string, unknown>,
  actor: string | null = null,
) {
  const { data: existing, error: getErr } = await supabaseAdmin
    .from("program_cars")
    .select("*")
    .eq("id", linkId)
    .eq("program_id", programId)
    .maybeSingle();
  if (getErr) throw getErr;
  if (!existing) return null;
  const updates: Record<string, unknown> = {};
  if (body.status !== undefined) updates.status = body.status === "" ? null : String(body.status);
  if (body.notes !== undefined) updates.notes = body.notes === "" ? null : body.notes;
  if (body.flag_tag !== undefined) updates.flag_tag = body.flag_tag === "" ? null : String(body.flag_tag);
  if (body.completed !== undefined) {
    const on = body.completed === true || body.completed === "true" || body.completed === 1 || body.completed === "1";
    updates.completed = on;
    updates.completed_at = on ? new Date().toISOString() : null;
    const prev = existing.custom_fields && typeof existing.custom_fields === "object" ? existing.custom_fields : {};
    updates.custom_fields = { ...prev, [COMPLETE_CF]: on };
  }
  if (body.shop_id !== undefined) updates.shop_id = body.shop_id === "" || body.shop_id == null ? null : Number(body.shop_id);
  if (body.scrap_yard_id !== undefined) {
    updates.scrap_yard_id = body.scrap_yard_id === "" || body.scrap_yard_id == null ? null : Number(body.scrap_yard_id);
  }
  if (body.repair_cost_total !== undefined) {
    const n = body.repair_cost_total === "" || body.repair_cost_total == null ? null : Number(body.repair_cost_total);
    updates.repair_cost_total = n != null && Number.isFinite(n) ? n : null;
  }
  if (body.custom_fields && typeof body.custom_fields === "object") {
    const prev =
      (updates.custom_fields && typeof updates.custom_fields === "object"
        ? updates.custom_fields
        : existing.custom_fields && typeof existing.custom_fields === "object"
          ? existing.custom_fields
          : {}) as Record<string, unknown>;
    updates.custom_fields = { ...prev, ...(body.custom_fields as object) };
  }
  if (!Object.keys(updates).length) return existing;
  const runUpdate = (cols: Record<string, unknown>, select: string) =>
    supabaseAdmin.from("program_cars").update(cols).eq("id", linkId).select(select).single();
  let { data, error } = await runUpdate(updates, CAR_SELECT);
  if (error && missingCompletedColumn(error) && (updates.completed !== undefined || updates.completed_at !== undefined)) {
    const fallback = { ...updates };
    delete fallback.completed;
    delete fallback.completed_at;
    ({ data, error } = await runUpdate(fallback, CAR_SELECT_NO_COMPLETED));
  }
  if (error) throw error;
  if (updates.status !== undefined) {
    const from = existing.status ?? null;
    const to = updates.status ?? null;
    if (String(from ?? "") !== String(to ?? "")) {
      await logProgramActivity({
        program_id: programId,
        action: "status_change",
        actor,
        program_car_id: linkId,
        railcar_id: existing.railcar_id,
        detail: { from, to },
      });
    }
  }
  if (updates.completed !== undefined && Boolean(existing.completed) !== Boolean(updates.completed)) {
    await logProgramActivity({
      program_id: programId,
      action: updates.completed ? "car_completed" : "car_reopened",
      actor,
      program_car_id: linkId,
      railcar_id: existing.railcar_id,
      detail: { completed: updates.completed },
    });
  }
  await supabaseAdmin.from("programs").update({ updated_at: new Date().toISOString() }).eq("id", programId);
  return mapProgramCarRow(data);
}

export async function bulkPatchProgramCars(
  programId: number,
  linkIds: number[],
  body: Record<string, unknown>,
  actor: string | null,
) {
  const ids = [...new Set(linkIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  let updated = 0;
  for (const linkId of ids) {
    const row = await patchProgramCar(programId, linkId, body, actor);
    if (row) updated += 1;
  }
  return { updated };
}

export async function listStatusOptions(categoryId: number) {
  const { data, error } = await supabaseAdmin
    .from("program_status_options")
    .select("id, category_id, value, sort_order")
    .eq("category_id", categoryId)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("value", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

function normCarNumber(n: string): string {
  const s = String(n ?? "").replace(/^0+/, "");
  return s || "0";
}

function carLabel(c: { reporting_marks?: string | null; car_number?: string | null }): string {
  return [c.reporting_marks, c.car_number].filter(Boolean).join(" ");
}

export async function resolveProgramCars(opts: { text: string; programId?: number | null }) {
  const tokens = parseCarPasteList(opts.text);
  const matched: { token: string; railcar_id: number; label: string }[] = [];
  const notFound: { token: string; reason?: string }[] = [];
  const already: { token: string; railcar_id: number; label: string }[] = [];
  const ambiguous: { token: string; matches: { railcar_id: number; label: string }[] }[] = [];
  if (!tokens.length) return { matched, not_found: notFound, already_in_program: already, ambiguous };

  const parsed = tokens.map((token) => {
    const split = splitCarNumber(token);
    return { token, marks: split.reporting_marks, number: split.car_number };
  });
  const numbers = [...new Set(parsed.map((p) => p.number).filter(Boolean))];
  const numberVariants = new Set<string>();
  for (const n of numbers) {
    numberVariants.add(n);
    numberVariants.add(normCarNumber(n));
    if (/^\d+$/.test(n)) numberVariants.add(n.padStart(6, "0"));
  }

  const byId = new Map<number, any>();
  const variantList = [...numberVariants];
  for (let i = 0; i < variantList.length; i += 80) {
    const slice = variantList.slice(i, i + 80);
    const { data, error } = await supabaseAdmin
      .from("railcars")
      .select("id, car_number, reporting_marks, car_initial")
      .in("car_number", slice);
    if (error) throw error;
    for (const c of data ?? []) byId.set(Number(c.id), c);
  }
  const candidates = [...byId.values()];

  const openIds = new Set<number>();
  if (opts.programId && Number.isFinite(opts.programId)) {
    const { data: openRows, error: openErr } = await supabaseAdmin
      .from("program_cars")
      .select("railcar_id")
      .eq("program_id", opts.programId)
      .is("exited_date", null);
    if (openErr) throw openErr;
    for (const r of openRows ?? []) openIds.add(Number((r as any).railcar_id));
  }

  for (const p of parsed) {
    if (!p.number) {
      notFound.push({ token: p.token, reason: "no car number" });
      continue;
    }
    const wantNum = normCarNumber(p.number);
    const wantMark = p.marks ? p.marks.toUpperCase() : null;
    const hits = candidates.filter((c) => {
      if (normCarNumber(String(c.car_number ?? "")) !== wantNum) return false;
      if (!wantMark) return true;
      const rm = String(c.reporting_marks ?? "").trim().toUpperCase();
      const ci = String(c.car_initial ?? "").trim().toUpperCase();
      return rm === wantMark || ci === wantMark;
    });
    if (hits.length === 0) {
      notFound.push({ token: p.token });
      continue;
    }
    if (hits.length > 1) {
      ambiguous.push({
        token: p.token,
        matches: hits.map((c) => ({ railcar_id: Number(c.id), label: carLabel(c) })),
      });
      continue;
    }
    const car = hits[0];
    const row = { token: p.token, railcar_id: Number(car.id), label: carLabel(car) };
    if (openIds.has(row.railcar_id)) already.push(row);
    else matched.push(row);
  }

  return { matched, not_found: notFound, already_in_program: already, ambiguous };
}

export async function listActivity(programId: number, programCarId?: number) {
  let q = supabaseAdmin
    .from("program_activity")
    .select("*, railcar:railcars(id, car_number, reporting_marks)")
    .eq("program_id", programId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (programCarId && Number.isFinite(programCarId)) q = q.eq("program_car_id", programCarId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row,
    railcar: Array.isArray(row.railcar) ? row.railcar[0] ?? null : row.railcar,
  }));
}

export async function carProgramHistory(railcarId: number) {
  const { data, error } = await supabaseAdmin
    .from("program_cars")
    .select(
      `id, status, joined_date, exited_date, rider_external_id_snapshot, repair_cost_total, custom_fields,
       program:programs(id, name, status, category_id, category:program_categories(id, name))`,
    )
    .eq("railcar_id", railcarId)
    .order("joined_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => {
    const program = Array.isArray(row.program) ? row.program[0] ?? null : row.program;
    const category = program?.category
      ? Array.isArray(program.category)
        ? program.category[0] ?? null
        : program.category
      : null;
    return { ...row, program: program ? { ...program, category } : null };
  });
}

export async function olProgramHistory(ol: string) {
  const code = String(ol ?? "").trim().toUpperCase();
  if (!code) return [];

  const { data: snapRows, error: snapErr } = await supabaseAdmin
    .from("program_cars")
    .select("id, program_id, railcar_id, status, joined_date, exited_date, rider_external_id_snapshot")
    .ilike("rider_external_id_snapshot", code);
  if (snapErr) throw snapErr;

  const { data: currentCars, error: carErr } = await supabaseAdmin
    .from("railcars")
    .select("id")
    .ilike("rider_external_id", code);
  if (carErr) throw carErr;
  const currentIds = (currentCars ?? []).map((c: any) => Number(c.id)).filter(Boolean);

  let currentRows: any[] = [];
  if (currentIds.length) {
    const { data, error } = await supabaseAdmin
      .from("program_cars")
      .select("id, program_id, railcar_id, status, joined_date, exited_date, rider_external_id_snapshot")
      .in("railcar_id", currentIds);
    if (error) throw error;
    currentRows = data ?? [];
  }

  const byId = new Map<number, any>();
  for (const row of [...(snapRows ?? []), ...currentRows]) {
    byId.set(Number(row.id), row);
  }
  const links = [...byId.values()];
  if (!links.length) return [];

  const programIds = [...new Set(links.map((l) => Number(l.program_id)))];
  const { data: programs, error: pErr } = await supabaseAdmin
    .from("programs")
    .select("id, name, status, category_id, category:program_categories(id, name)")
    .in("id", programIds);
  if (pErr) throw pErr;
  const pMap = new Map(
    (programs ?? []).map((p: any) => {
      const category = Array.isArray(p.category) ? p.category[0] ?? null : p.category;
      return [Number(p.id), { ...p, category }];
    }),
  );

  const grouped = new Map<
    number,
    { program: any; car_count: number; current_count: number; snapshot_count: number }
  >();
  for (const link of links) {
    const pid = Number(link.program_id);
    const prog = pMap.get(pid);
    if (!prog) continue;
    const g = grouped.get(pid) ?? { program: prog, car_count: 0, current_count: 0, snapshot_count: 0 };
    g.car_count += 1;
    const snap = String(link.rider_external_id_snapshot ?? "").trim().toUpperCase();
    if (snap === code) g.snapshot_count += 1;
    if (currentIds.includes(Number(link.railcar_id))) g.current_count += 1;
    grouped.set(pid, g);
  }
  return [...grouped.values()].sort((a, b) => String(a.program.name).localeCompare(String(b.program.name)));
}

function coreCarColumns() {
  return [
    { key: "marks", label: "Reporting marks" },
    { key: "car_number", label: "Car number" },
    { key: "status", label: "Status" },
    { key: "completed", label: "Complete" },
    { key: "flag_tag", label: "Flag" },
    { key: "notes", label: "Notes" },
    { key: "joined_date", label: "Joined" },
    { key: "exited_date", label: "Exited" },
    { key: "ol_snapshot", label: "OL (at entry)" },
    { key: "ol_current", label: "OL (current)" },
    { key: "shop", label: "Shop" },
    { key: "repair_cost_total", label: "Repair cost total" },
  ] as const;
}

function carExportValue(row: any, key: string): string {
  const r = row.railcar ?? {};
  switch (key) {
    case "marks":
      return r.reporting_marks ?? "";
    case "car_number":
      return r.car_number ?? "";
    case "status":
      return row.status ?? "";
    case "completed":
      return isCarCompleted(row) ? "Yes" : "";
    case "flag_tag":
      return row.flag_tag ?? "";
    case "notes":
      return row.notes ?? "";
    case "joined_date":
      return row.joined_date ? String(row.joined_date).slice(0, 10) : "";
    case "exited_date":
      return row.exited_date ? String(row.exited_date).slice(0, 10) : "";
    case "ol_snapshot":
      return row.rider_external_id_snapshot ?? "";
    case "ol_current":
      return r.rider_external_id ?? "";
    case "shop":
      return row.shop?.name ?? "";
    case "repair_cost_total":
      return row.repair_cost_total != null ? String(row.repair_cost_total) : "";
    default:
      return "";
  }
}

export async function buildProgramReport(opts: {
  programIds: number[];
  includeExited: boolean;
  filename?: string;
}): Promise<{ buffer: Buffer; filename: string }> {
  const ids = [...new Set(opts.programIds.filter((id) => Number.isFinite(id)))];
  if (!ids.length) throw new Error("Select at least one program");

  const programs = [];
  for (const id of ids) {
    const p = await getProgram(id);
    if (p) programs.push(p);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "RLMS";
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Account Manager", key: "account_manager", width: 18 },
    { header: "Owned By", key: "entity", width: 22 },
    { header: "Category", key: "category", width: 28 },
    { header: "Project Files", key: "name", width: 36 },
    { header: "Status", key: "status_narrative", width: 50 },
    { header: "% Complete", key: "percent_complete", width: 14 },
    { header: "Total Cars in Project", key: "cars", width: 22 },
  ];
  summary.getRow(1).font = { bold: true };

  const usedNames = new Set<string>(["summary"]);

  for (const p of programs) {
    const cars = await listProgramCars(p.id, opts.includeExited);
    const defs = (p.field_defs ?? []) as ProgramFieldDef[];
    const usedDefs = defs.filter((d) =>
      cars.some((c) => isCustomFieldPopulated(c.custom_fields?.[d.field_key])),
    );
    const active = cars.filter((c) => !c.exited_date).length;
    summary.addRow({
      account_manager: p.account_manager ?? "",
      entity: p.entity ?? "",
      category: p.category?.name ?? "",
      name: p.name,
      status_narrative: p.status_narrative ?? "",
      percent_complete: p.percent_complete ?? "",
      cars: active !== cars.length && cars.length ? `${active} of ${cars.length}` : cars.length,
    });

    const sheet = wb.addWorksheet(excelSheetName(p.name, usedNames));
    const headers = [
      ...coreCarColumns().map((c) => c.label),
      ...usedDefs.map((d) => d.label),
    ];
    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true };
    for (const car of cars) {
      const vals = [
        ...coreCarColumns().map((c) => carExportValue(car, c.key)),
        ...usedDefs.map((d) => formatCustomField(car.custom_fields?.[d.field_key], d.field_type)),
      ];
      sheet.addRow(vals);
    }
    sheet.columns.forEach((col) => {
      col.width = Math.min(40, Math.max(12, Number(col.width) || 16));
    });
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: opts.filename ?? reportFilename() };
}

export function parseStatus(raw: unknown, fallback: ProgramStatus = "open"): ProgramStatus {
  const s = String(raw ?? "").trim();
  return isProgramStatus(s) ? s : fallback;
}
