import type { Express, Request, Response } from "express";
import { pickRow } from "@shared/change-log";
import {
  defVisibleOnProgram,
  fieldTypeForColumn,
  isManageColumnType,
  normalizeSelectOptions,
  uniqueFieldKey,
  type ManagedFieldDef,
} from "@shared/manage-columns";
import type { ProgramFieldDef, ProgramFieldType } from "@shared/programs";
import { requireWrite } from "./auth";
import { recordChange, withChangeGroupResult } from "./change-log";
import { supabaseAdmin } from "./supabase";

const SNAPSHOT_KEYS = [
  "id",
  "category_id",
  "program_id",
  "field_key",
  "label",
  "field_type",
  "section",
  "sort_order",
  "select_options",
  "is_optional",
  "retired_at",
] as const;

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function columnErr(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
  const message = e.message ?? "Server error";
  res.status(status).json({ error: message, message });
}

async function loadProgram(programId: number): Promise<{ id: number; category_id: number | null } | null> {
  const { data, error } = await supabaseAdmin.from("programs").select("id, category_id").eq("id", programId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: Number(data.id), category_id: data.category_id == null ? null : Number(data.category_id) };
}

async function loadDefs(): Promise<ProgramFieldDef[]> {
  const { data, error } = await supabaseAdmin.from("program_field_defs").select("*").order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProgramFieldDef[];
}

async function loadDef(id: number): Promise<ProgramFieldDef | null> {
  const { data, error } = await supabaseAdmin.from("program_field_defs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as ProgramFieldDef | null) ?? null;
}

function assertOnProgram(def: ManagedFieldDef, programId: number, categoryId: number | null) {
  if (!defVisibleOnProgram(def, programId, categoryId)) {
    throw httpError(404, "Column not found on this program");
  }
}

function snapshot(row: Record<string, unknown> | null): Record<string, unknown> {
  return pickRow(row, [...SNAPSHOT_KEYS]);
}

export async function addProgramColumn(
  programId: number,
  body: { label?: unknown; type?: unknown; scope?: unknown; options?: unknown },
  actor: string,
) {
  return withChangeGroupResult(actor, async () => {
    const program = await loadProgram(programId);
    if (!program) throw httpError(404, "Program not found");
    const label = String(body.label ?? "").trim();
    if (!label) throw httpError(400, "Name is required");
    const typeRaw = String(body.type ?? "text");
    if (!isManageColumnType(typeRaw)) throw httpError(400, "Unknown column type");
    const scope = body.scope === "global" ? "global" : "program";
    const fieldType: ProgramFieldType = fieldTypeForColumn(typeRaw);
    const selectOptions = fieldType === "select" ? normalizeSelectOptions(body.options) : [];
    if (fieldType === "select" && selectOptions.length === 0) {
      throw httpError(400, "Select columns need at least one option");
    }
    const existing = await loadDefs();
    const fieldKey = uniqueFieldKey(label, existing.map((def) => def.field_key));
    const sortOrder = existing.reduce((max, def) => Math.max(max, Number(def.sort_order) || 0), 0) + 10;
    const insertRow = {
      field_key: fieldKey,
      label,
      field_type: fieldType,
      section: scope === "global" ? "Optional" : "Program",
      sort_order: sortOrder,
      select_options: fieldType === "select" ? selectOptions : null,
      is_optional: scope === "global",
      category_id: null,
      program_id: scope === "global" ? null : programId,
      retired_at: null,
    };
    const { data, error } = await supabaseAdmin.from("program_field_defs").insert(insertRow).select("*").single();
    if (error) throw error;
    await recordChange({
      table: "program_field_defs",
      pk: Number(data.id),
      before: {},
      after: snapshot(data as Record<string, unknown>),
      action: "column_added",
      entity_type: "program",
      entity_id: programId,
      actor,
      detail: { scope, field_key: fieldKey },
    });
    return { field_def: data, no_changes: false };
  });
}

export async function renameProgramColumn(programId: number, defId: number, labelRaw: unknown, actor: string) {
  return withChangeGroupResult(actor, async () => {
    const program = await loadProgram(programId);
    if (!program) throw httpError(404, "Program not found");
    const def = await loadDef(defId);
    if (!def) throw httpError(404, "Column not found");
    assertOnProgram(def, program.id, program.category_id);
    const label = String(labelRaw ?? "").trim();
    if (!label) throw httpError(400, "Name is required");
    if (label === def.label) return { field_def: def, no_changes: true };
    const { data, error } = await supabaseAdmin
      .from("program_field_defs")
      .update({ label })
      .eq("id", def.id)
      .select("*")
      .single();
    if (error) throw error;
    await recordChange({
      table: "program_field_defs",
      pk: Number(def.id),
      before: snapshot(def as unknown as Record<string, unknown>),
      after: snapshot(data as Record<string, unknown>),
      action: "column_renamed",
      entity_type: "program",
      entity_id: programId,
      actor,
      detail: { field_key: def.field_key },
    });
    return { field_def: data, no_changes: false };
  });
}

async function setRetired(programId: number, defId: number, retired: boolean, actor: string) {
  return withChangeGroupResult(actor, async () => {
    const program = await loadProgram(programId);
    if (!program) throw httpError(404, "Program not found");
    const def = await loadDef(defId);
    if (!def) throw httpError(404, "Column not found");
    assertOnProgram(def, program.id, program.category_id);
    const already = retired ? String(def.retired_at ?? "").trim() !== "" : def.retired_at == null || String(def.retired_at).trim() === "";
    if (already) return { field_def: def, no_changes: true };
    const retiredAt = retired ? new Date().toISOString() : null;
    const { data, error } = await supabaseAdmin
      .from("program_field_defs")
      .update({ retired_at: retiredAt })
      .eq("id", def.id)
      .select("*")
      .single();
    if (error) throw error;
    await recordChange({
      table: "program_field_defs",
      pk: Number(def.id),
      before: snapshot(def as unknown as Record<string, unknown>),
      after: snapshot(data as Record<string, unknown>),
      action: retired ? "column_retired" : "column_restored",
      entity_type: "program",
      entity_id: programId,
      actor,
      detail: { field_key: def.field_key },
    });
    return { field_def: data, no_changes: false };
  });
}

export function registerProgramColumnRoutes(app: Express) {
  app.post("/api/programs/:id/columns", async (req: Request, res: Response) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const programId = Number(req.params.id);
      if (!Number.isFinite(programId) || programId <= 0) return res.status(400).json({ error: "Invalid program" });
      res.json(await addProgramColumn(programId, req.body ?? {}, actor));
    } catch (err) {
      columnErr(res, err);
    }
  });

  app.patch("/api/programs/:id/columns/:defId", async (req: Request, res: Response) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const programId = Number(req.params.id);
      const defId = Number(req.params.defId);
      if (!Number.isFinite(programId) || programId <= 0 || !Number.isFinite(defId) || defId <= 0) {
        return res.status(400).json({ error: "Invalid column" });
      }
      res.json(await renameProgramColumn(programId, defId, req.body?.label, actor));
    } catch (err) {
      columnErr(res, err);
    }
  });

  app.post("/api/programs/:id/columns/:defId/retire", async (req: Request, res: Response) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const programId = Number(req.params.id);
      const defId = Number(req.params.defId);
      if (!Number.isFinite(programId) || programId <= 0 || !Number.isFinite(defId) || defId <= 0) {
        return res.status(400).json({ error: "Invalid column" });
      }
      res.json(await setRetired(programId, defId, true, actor));
    } catch (err) {
      columnErr(res, err);
    }
  });

  app.post("/api/programs/:id/columns/:defId/restore", async (req: Request, res: Response) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const programId = Number(req.params.id);
      const defId = Number(req.params.defId);
      if (!Number.isFinite(programId) || programId <= 0 || !Number.isFinite(defId) || defId <= 0) {
        return res.status(400).json({ error: "Invalid column" });
      }
      res.json(await setRetired(programId, defId, false, actor));
    } catch (err) {
      columnErr(res, err);
    }
  });
}
