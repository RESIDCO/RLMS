import ExcelJS from "exceljs";
import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabase";
import { requireAdmin, requireWrite } from "./auth";
import { recordChange, withChangeGroupResult } from "./change-log";
import { logProgramActivity } from "./programs";
import {
  NEW_SHOPS,
  TRACKER_ORDER_VIEW,
  TRACKER_SYNC_KIND,
  applyCustomPatch,
  buildApplyCar,
  carChangedSince,
  columnOrderFromHeaders,
  columnPrefsPayload,
  findRlmsCars,
  groupByProgram,
  matchProgramName,
  normalizeShopName,
  parseSheetCars,
  planCarChanges,
  programCarsListKey,
  resolveTrackerSheet,
  summaryPrograms,
  trackerOrderForProgram,
  undoCarFields,
  writesOnly,
  type PlannedChange,
  type RlmsCar,
  type ShopRecord,
} from "@shared/program-tracker-sync";

const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

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

export async function workbookRows(buffer: Buffer): Promise<Map<string, unknown[][]>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const sheets = new Map<string, unknown[][]>();
  wb.eachSheet((sheet) => {
    const rows: unknown[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const values = (row.values as unknown[]).slice(1).map(cellValue);
      rows.push(values);
    });
    sheets.set(sheet.name, rows);
  });
  return sheets;
}

type LoadedProgram = { id: number; name: string; category_id: number | null };

async function loadPrograms(): Promise<LoadedProgram[]> {
  const { data, error } = await supabaseAdmin.from("programs").select("id, name, category_id");
  if (error) throw error;
  return (data ?? []) as LoadedProgram[];
}

async function loadShops(): Promise<ShopRecord[]> {
  const { data, error } = await supabaseAdmin.from("shops").select("id, name").order("name");
  if (error) throw error;
  return (data ?? []) as ShopRecord[];
}

async function loadProgramCars(program: { id: number; name: string }): Promise<RlmsCar[]> {
  const { data, error } = await supabaseAdmin
    .from("program_cars")
    .select("id, program_id, railcar_id, status, notes, shop_id, custom_fields, exited_date, railcar:railcars(id, reporting_marks, car_number, active), shop:shops(id, name)")
    .eq("program_id", program.id);
  if (error) throw error;
  return (data ?? []).map((row: any) => {
    const railcar = Array.isArray(row.railcar) ? row.railcar[0] : row.railcar;
    const shop = Array.isArray(row.shop) ? row.shop[0] : row.shop;
    return {
      program_car_id: Number(row.id),
      program_id: program.id,
      program_name: program.name,
      railcar_id: Number(row.railcar_id),
      active: railcar?.active === true,
      exited: row.exited_date != null,
      reporting_marks: String(railcar?.reporting_marks ?? ""),
      car_number: String(railcar?.car_number ?? ""),
      status: row.status ?? null,
      notes: row.notes ?? null,
      shop_id: row.shop_id == null ? null : Number(row.shop_id),
      shop_name: shop?.name ?? null,
      custom_fields: row.custom_fields && typeof row.custom_fields === "object" ? row.custom_fields : {},
    };
  });
}

export async function buildTrackerPreview(buffer: Buffer) {
  const sheets = await workbookRows(buffer);
  const summary = summaryPrograms(sheets.get("SUMMARY") ?? []);
  const activeSheets = summary.filter((row) => row.active_scope);
  const programs = await loadPrograms();
  const shops = await loadShops();
  const changes: PlannedChange[] = [];
  const reviews: { program: string; car: string; note: string }[] = [];
  const carsByProgram = new Map<number, RlmsCar[]>();
  const programsToCreate: { name: string; sheet: string }[] = [];
  const layouts: { program_id: number; program: string; list_key: string; view_name: string; visible_cols: ReturnType<typeof columnPrefsPayload> }[] = [];
  let inactiveSkipped = 0;
  let sheetCars = 0;

  for (const scope of activeSheets) {
    const sheetName = resolveTrackerSheet(scope.sheet, Array.from(sheets.keys()));
    const rows = sheetName ? sheets.get(sheetName) : undefined;
    if (!rows) {
      reviews.push({ program: scope.sheet, car: "", note: "sheet missing from the workbook" });
      continue;
    }
    const program = matchProgramName(scope.sheet, programs);
    const parsed = parseSheetCars(scope.sheet, rows);
    sheetCars += parsed.cars.length;
    if (!program) {
      programsToCreate.push({ name: scope.sheet, sheet: scope.sheet });
      reviews.push({ program: scope.sheet, car: "", note: "no RLMS program — preview includes create program" });
      continue;
    }
    const order = columnOrderFromHeaders(parsed.headers.map((h) => h.header));
    const saved = order.length ? order : trackerOrderForProgram(program.name) ?? [];
    if (saved.length) {
      layouts.push({
        program_id: program.id,
        program: program.name,
        list_key: programCarsListKey(program.id),
        view_name: TRACKER_ORDER_VIEW,
        visible_cols: columnPrefsPayload(saved),
      });
    }
    const rlmsCars = await loadProgramCars(program);
    carsByProgram.set(program.id, rlmsCars);
    for (const sheetCar of parsed.cars) {
      const hits = findRlmsCars(sheetCar, rlmsCars);
      const open = hits.filter((h) => !h.exited);
      const hit = hits.length === 1 ? hits[0] : open.length === 1 ? open[0] : null;
      if (!hit) {
        reviews.push({
          program: program.name,
          car: [sheetCar.mark, sheetCar.number].filter(Boolean).join(" "),
          note: hits.length > 1 ? "ambiguous car" : "car not on this program",
        });
        continue;
      }
      if (hit.active !== true || hit.exited) {
        inactiveSkipped += 1;
        continue;
      }
      changes.push(...planCarChanges(sheetCar, hit, shops));
    }
  }

  const shopsToAdd = NEW_SHOPS.filter((name) => !shops.some((shop) => normalizeShopName(shop.name) === normalizeShopName(name))).map((name) => ({ name }));
  const writes = writesOnly(changes);
  const byCar = new Map<number, RlmsCar>();
  for (const cars of Array.from(carsByProgram.values())) {
    for (const car of cars) byCar.set(car.program_car_id, car);
  }
  const applyCars = Array.from(byCar.values())
    .map((car) => buildApplyCar(car, writes))
    .filter((car): car is NonNullable<typeof car> => car != null);

  const token = randomUUID();
  const expires = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();
  const snapshot = {
    shops: shopsToAdd,
    cars: applyCars,
    layouts,
    programs_to_create: programsToCreate,
    summary: {
      sheet_cars: sheetCars,
      inactive_skipped: inactiveSkipped,
      writes: writes.length,
      reviews: changes.filter((c) => c.action === "review").length + reviews.length,
    },
  };
  const { error } = await supabaseAdmin.from("rlms_preview_tokens").insert({
    token,
    kind: TRACKER_SYNC_KIND,
    snapshot,
    expires_at: expires,
  });
  if (error) throw error;

  const groups = groupByProgram(changes);
  return {
    preview_token: token,
    expires_at: expires,
    groups: Object.entries(groups).map(([program, counts]) => ({ program, ...counts })),
    shops: shopsToAdd,
    programs_to_create: programsToCreate,
    layouts: layouts.map((layout) => ({ program: layout.program, list_key: layout.list_key, view_name: layout.view_name, cols: layout.visible_cols.cols })),
    inactive_skipped: inactiveSkipped,
    sheet_cars: sheetCars,
    writes: writes.length,
    reviews: [...changes.filter((c) => c.action === "review").map((c) => ({ program: c.program, car: c.car, field: c.field, note: c.note })), ...reviews],
  };
}

export async function applyTrackerPreview(token: string, signedOffBy: string, actor: string) {
  const signed = String(signedOffBy ?? "").trim();
  if (!signed) {
    const err: any = new Error("signed_off_by is required");
    err.status = 400;
    throw err;
  }
  const { data, error } = await supabaseAdmin.rpc("rlms_apply_program_tracker_sync", {
    p_token: token,
    p_actor: actor,
    p_signed_off_by: signed,
  });
  if (error) throw error;
  const result = (data ?? {}) as Record<string, unknown>;
  if (result.ok === false) {
    const err: any = new Error(String(result.error ?? "apply failed"));
    err.status = 409;
    throw err;
  }
  return result;
}

export async function undoProgramCarActivity(programId: number, activityId: number, actor: string) {
  const { data: activity, error } = await supabaseAdmin
    .from("program_activity")
    .select("id, program_id, program_car_id, railcar_id, action, detail")
    .eq("id", activityId)
    .eq("program_id", programId)
    .maybeSingle();
  if (error) throw error;
  if (!activity) {
    const err: any = new Error("Activity not found");
    err.status = 404;
    throw err;
  }
  const detail = activity.detail && typeof activity.detail === "object" ? activity.detail as Record<string, unknown> : {};
  const fields = detail.fields && typeof detail.fields === "object" ? detail.fields as Record<string, { old: unknown; new: unknown }> : null;
  if (!fields || !Object.keys(fields).length) {
    const err: any = new Error("This activity has no field-level undo");
    err.status = 400;
    throw err;
  }
  const linkId = Number(activity.program_car_id);
  const { data: car, error: carErr } = await supabaseAdmin
    .from("program_cars")
    .select("id, program_id, railcar_id, status, shop_id, custom_fields, exited_date, railcar:railcars(active)")
    .eq("id", linkId)
    .maybeSingle();
  if (carErr) throw carErr;
  if (!car) {
    const err: any = new Error("Program car not found");
    err.status = 404;
    throw err;
  }
  const railcar = Array.isArray((car as any).railcar) ? (car as any).railcar[0] : (car as any).railcar;
  if (railcar?.active !== true || car.exited_date != null) {
    const err: any = new Error("Inactive cars are not changed");
    err.status = 409;
    throw err;
  }
  const custom = car.custom_fields && typeof car.custom_fields === "object" ? car.custom_fields as Record<string, unknown> : {};
  if (carChangedSince(custom, fields, custom, car.status, car.shop_id)) {
    const err: any = new Error("Changed since — undo refused");
    err.status = 409;
    throw err;
  }
  const undo = undoCarFields(fields);
  const nextCustom = applyCustomPatch(custom, undo.custom_patch);
  const updates: Record<string, unknown> = { custom_fields: nextCustom };
  if (undo.status.set) updates.status = undo.status.value;
  if (undo.shop_id.set) updates.shop_id = undo.shop_id.value;
  return withChangeGroupResult(actor, async () => {
    const { data: saved, error: updErr } = await supabaseAdmin
      .from("program_cars")
      .update(updates)
      .eq("id", linkId)
      .select("id, status, shop_id, custom_fields, railcar_id")
      .single();
    if (updErr) throw updErr;
    await recordChange({
      table: "program_cars",
      pk: linkId,
      before: { custom_fields: custom, status: car.status ?? null, shop_id: car.shop_id ?? null },
      after: { custom_fields: saved.custom_fields, status: saved.status ?? null, shop_id: saved.shop_id ?? null },
      action: "program_tracker_sync_undo_car",
      entity_type: "program_car",
      entity_id: linkId,
      railcar_id: car.railcar_id,
      actor,
      detail: { undid_activity_id: activityId },
    });
    await logProgramActivity({
      program_id: programId,
      program_car_id: linkId,
      railcar_id: car.railcar_id,
      action: "tracker_sync_undo",
      actor,
      detail: { undid_activity_id: activityId, fields: undo.custom_patch },
    });
    return { program_car_id: linkId };
  });
}

export async function createShopRecord(
  name: string,
  actor: string,
  programId?: number | null,
  extra?: { location?: string | null; shop_type?: string | null },
) {
  const trimmed = name.trim();
  if (!trimmed) {
    const err: any = new Error("Shop name is required");
    err.status = 400;
    throw err;
  }
  const { data: existing, error: findErr } = await supabaseAdmin.from("shops").select("*").ilike("name", trimmed).limit(1);
  if (findErr) throw findErr;
  if (existing && existing.length) return { ...existing[0], change_group: null, created: false };
  return withChangeGroupResult(actor, async () => {
    const location = extra?.location ? String(extra.location) : null;
    const shopType = extra?.shop_type ? String(extra.shop_type) : null;
    const { data, error } = await supabaseAdmin.from("shops").insert({
      name: trimmed,
      location,
      shop_type: shopType,
    }).select().single();
    if (error) throw error;
    await recordChange({
      table: "shops",
      pk: Number(data.id),
      before: {},
      after: { id: data.id, name: data.name, location: data.location, shop_type: data.shop_type },
      action: "shop_created",
      entity_type: "program",
      entity_id: programId && programId > 0 ? programId : Number(data.id),
      actor,
      detail: { source: "inline_shop" },
    });
    return { ...data, created: true };
  });
}

export async function saveProgramColumnLayout(opts: {
  programId: number;
  programName: string;
  actor: string;
  mode: "tracker" | "save";
  visibleCols?: unknown;
}) {
  const order = opts.mode === "tracker"
    ? trackerOrderForProgram(opts.programName)
    : null;
  const cols = opts.mode === "tracker" ? order : null;
  if (opts.mode === "tracker" && !cols) {
    const err: any = new Error("This program has no tracker column order");
    err.status = 404;
    throw err;
  }
  const visible = opts.mode === "tracker" ? columnPrefsPayload(cols!) : opts.visibleCols;
  if (!visible || typeof visible !== "object") {
    const err: any = new Error("visible_cols required");
    err.status = 400;
    throw err;
  }
  const listKey = programCarsListKey(opts.programId);
  const viewName = opts.mode === "tracker" ? TRACKER_ORDER_VIEW : "Program default";
  return withChangeGroupResult(opts.actor, async () => {
    const { data: existing, error: findErr } = await supabaseAdmin
      .from("user_column_prefs")
      .select("*")
      .eq("list_key", listKey)
      .eq("view_name", viewName)
      .eq("is_shared", true)
      .limit(1);
    if (findErr) throw findErr;
    const current = existing?.[0] ?? null;
    const { error: clearErr } = await supabaseAdmin
      .from("user_column_prefs")
      .update({ is_default: false })
      .eq("list_key", listKey)
      .eq("is_shared", true)
      .eq("is_default", true);
    if (clearErr) throw clearErr;
    let id = current ? Number(current.id) : 0;
    if (!current) {
      const { data, error } = await supabaseAdmin.from("user_column_prefs").insert({
        user_id: opts.actor,
        page: "program_cars",
        list_key: listKey,
        view_name: viewName,
        is_default: true,
        is_shared: true,
        visible_cols: visible,
        updated_at: new Date().toISOString(),
      }).select("id").single();
      if (error) throw error;
      id = Number(data.id);
      await recordChange({
        table: "user_column_prefs",
        pk: id,
        before: {},
        after: { id, list_key: listKey, view_name: viewName, is_shared: true, is_default: true, page: "program_cars", visible_cols: visible },
        action: "program_column_layout",
        entity_type: "program",
        entity_id: opts.programId,
        actor: opts.actor,
      });
    } else {
      const { error } = await supabaseAdmin.from("user_column_prefs").update({
        visible_cols: visible,
        is_default: true,
        is_shared: true,
        page: "program_cars",
        updated_at: new Date().toISOString(),
      }).eq("id", current.id);
      if (error) throw error;
      await recordChange({
        table: "user_column_prefs",
        pk: id,
        before: { visible_cols: current.visible_cols, is_default: current.is_default, view_name: viewName, list_key: listKey },
        after: { visible_cols: visible, is_default: true, view_name: viewName, list_key: listKey },
        action: "program_column_layout",
        entity_type: "program",
        entity_id: opts.programId,
        actor: opts.actor,
      });
    }
    return { list_key: listKey, view_name: viewName };
  });
}

function errHandler(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
  res.status(status).json({ error: e.message ?? "Server error" });
}

export function registerProgramTrackerRoutes(app: Express, upload: { single: (name: string) => any }) {
  app.post("/api/programs/tracker-sync/preview", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const actor = await requireAdmin(req, res);
      if (!actor) return;
      const file = (req as Request & { file?: { buffer?: Buffer } }).file;
      if (!file?.buffer) return res.status(400).json({ error: "xlsx file is required" });
      res.json(await buildTrackerPreview(file.buffer));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/programs/tracker-sync/apply", async (req: Request, res: Response) => {
    try {
      const actor = await requireAdmin(req, res);
      if (!actor) return;
      const token = String(req.body?.token ?? "").trim();
      if (!token) return res.status(400).json({ error: "token is required" });
      res.json(await applyTrackerPreview(token, String(req.body?.signed_off_by ?? ""), actor));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/programs/:id/column-layout", async (req: Request, res: Response) => {
    try {
      const actor = await requireAdmin(req, res);
      if (!actor) return;
      const programId = Number(req.params.id);
      const { data: program, error } = await supabaseAdmin.from("programs").select("id, name").eq("id", programId).maybeSingle();
      if (error) throw error;
      if (!program) return res.status(404).json({ error: "Program not found" });
      const mode = req.body?.mode === "tracker" ? "tracker" : "save";
      res.json(await saveProgramColumnLayout({
        programId,
        programName: String(program.name),
        actor,
        mode,
        visibleCols: req.body?.visible_cols,
      }));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/programs/:id/activity/:activityId/undo", async (req: Request, res: Response) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await undoProgramCarActivity(Number(req.params.id), Number(req.params.activityId), actor));
    } catch (err) { errHandler(res, err); }
  });
}
