import { jsonEqual } from "@shared/change-log";
import {
  isOppDocCategory,
  type OppDocCategory,
} from "@shared/attachment-category";
import { opOf, type UndoLogRow } from "@shared/undo";
import { recordChange, withChangeGroup, withChangeGroupResult, type RecordChangeOpts } from "./change-log";
import { insertAttachmentRow, STORAGE_BUCKET } from "./attachments";
import { supabaseAdmin } from "./supabase";

export const LINE_HAS_FILES_MESSAGE = "Line has files — move or delete them first";

export class AttachmentHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AttachmentHttpError";
    this.status = status;
  }
}

export type LinePin = {
  id: number;
  opportunity_id: number;
  deleted_at: string | null;
};

type UploadFile = {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype: string;
};

export function pickAttachmentUploads<T>(
  files: { file?: T[]; files?: T[] } | null | undefined,
  entityType: string,
): T[] {
  if (entityType === "opportunity") {
    if (files?.files?.length) return files.files;
    if (files?.file?.length) return files.file;
    return [];
  }
  return files?.file?.length ? [files.file[0]] : [];
}

export function readOpportunityCategory(raw: unknown, mode: "upload" | "patch"): OppDocCategory | undefined {
  if (raw == null || raw === "") {
    if (mode === "upload") return "other";
    return undefined;
  }
  if (!isOppDocCategory(raw)) throw new AttachmentHttpError(400, "Unknown file category");
  return raw;
}

export function readOpportunityLineId(raw: unknown, mode: "upload" | "patch"): number | null | undefined {
  if (raw === undefined) return mode === "upload" ? null : undefined;
  if (raw === null || raw === "" || raw === "none") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new AttachmentHttpError(400, "Unknown deal line");
  return n;
}

export function assertCanPinLine(line: LinePin | null, opportunityId: number): void {
  if (!line || Number(line.opportunity_id) !== Number(opportunityId)) {
    throw new AttachmentHttpError(400, "That deal line is not on this offering");
  }
  if (line.deleted_at) {
    throw new AttachmentHttpError(400, "That deal line was removed");
  }
}

export function filterAttachmentsByLine<T extends { opportunity_line_id?: number | null }>(
  rows: T[],
  line: unknown,
): T[] {
  if (line == null || line === "" || line === "all") return rows;
  const raw = Array.isArray(line) ? line[0] : line;
  if (raw == null || raw === "" || raw === "all") return rows;
  if (raw === "none") return rows.filter((row) => row.opportunity_line_id == null);
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return rows;
  return rows.filter((row) => Number(row.opportunity_line_id) === id);
}

export function lineInsertBlockedByOutsideFiles(attachmentIds: number[], inGroupIds: number[]): boolean {
  const inside = new Set(inGroupIds);
  return attachmentIds.some((id) => !inside.has(id));
}

export function opportunityFileInsertChange(row: Record<string, unknown>, actor: string): RecordChangeOpts {
  return {
    table: "attachments",
    pk: Number(row.id),
    before: {},
    after: row,
    action: "Upload bid file",
    entity_type: "opportunity",
    entity_id: Number(row.entity_id),
    actor,
    detail: {
      storage_path: row.storage_path ?? null,
      file_name: row.file_name ?? null,
    },
  };
}

export function opportunityFileDeleteChange(row: Record<string, unknown>, actor: string): RecordChangeOpts {
  return {
    table: "attachments",
    pk: Number(row.id),
    before: row,
    after: {},
    action: "Delete bid file",
    entity_type: "opportunity",
    entity_id: Number(row.entity_id),
    actor,
    detail: {
      storage_path: row.storage_path ?? null,
      file_name: row.file_name ?? null,
    },
  };
}

export function opportunityFileUpdateChange(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  actor: string,
): RecordChangeOpts {
  return {
    table: "attachments",
    pk: Number(before.id),
    before,
    after,
    action: "Recategorize bid file",
    entity_type: "opportunity",
    entity_id: Number(before.entity_id),
    actor,
    detail: {
      storage_path: before.storage_path ?? null,
      file_name: before.file_name ?? null,
    },
  };
}

async function loadPinLine(id: number): Promise<LinePin | null> {
  const { data, error } = await supabaseAdmin
    .from("opportunity_lines")
    .select("id, opportunity_id, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: Number(data.id),
    opportunity_id: Number(data.opportunity_id),
    deleted_at: data.deleted_at == null ? null : String(data.deleted_at),
  };
}

function safeStorageName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || "file";
}

async function rollbackUpload(groupId: string, uploadedPaths: string[], insertedIds: number[]): Promise<void> {
  try {
    if (insertedIds.length) {
      await supabaseAdmin.from("attachments").delete().in("id", insertedIds);
    }
    if (groupId) {
      await supabaseAdmin.from("activity_log").delete().eq("change_group", groupId);
    }
    if (uploadedPaths.length) {
      await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(uploadedPaths);
    }
  } catch (cleanupErr) {
    console.error("[crm-bid-attachments] upload rollback failed", cleanupErr);
  }
}

/** One change group for the whole dialog submit, so one Undo removes the batch. */
export async function uploadOpportunityFiles(opts: {
  opportunityId: number;
  actor: string;
  files: UploadFile[];
  docCategory: unknown;
  opportunityLineId: unknown;
  notes: string | null;
}): Promise<{ files: Record<string, unknown>[]; change_group: string }> {
  if (!Number.isFinite(opts.opportunityId) || opts.opportunityId <= 0) {
    throw new AttachmentHttpError(400, "Invalid opportunity");
  }
  if (!opts.files.length) throw new AttachmentHttpError(400, "No file provided");
  if (opts.files.length > 20) throw new AttachmentHttpError(400, "Upload 20 files at a time");
  const docCategory = readOpportunityCategory(opts.docCategory, "upload") ?? "other";
  const lineId = readOpportunityLineId(opts.opportunityLineId, "upload");
  if (lineId != null) {
    assertCanPinLine(await loadPinLine(lineId), opts.opportunityId);
  }
  const notes = opts.notes?.trim() ? opts.notes.trim() : null;
  const ts = Date.now();
  const uploadedPaths: string[] = [];
  const insertedIds: number[] = [];
  let groupId = "";
  try {
    return await withChangeGroup(opts.actor, async (group) => {
      groupId = group;
      const saved: Record<string, unknown>[] = [];
      for (let index = 0; index < opts.files.length; index += 1) {
        const file = opts.files[index];
        const storagePath = `opportunity/${opts.opportunityId}/${ts}-${index}-${safeStorageName(file.originalname)}`;
        const { error: uploadError } = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });
        if (uploadError) throw uploadError;
        uploadedPaths.push(storagePath);
        const row = await insertAttachmentRow({
          entity_type: "opportunity",
          entity_id: opts.opportunityId,
          file_name: file.originalname,
          file_size: file.size,
          mime_type: file.mimetype,
          storage_path: storagePath,
          uploaded_by: opts.actor,
          notes,
          source_module: "crm",
          doc_category: docCategory,
          opportunity_line_id: lineId,
        });
        insertedIds.push(Number(row.id));
        await recordChange(opportunityFileInsertChange(row as Record<string, unknown>, opts.actor));
        saved.push(row as Record<string, unknown>);
      }
      return { files: saved, change_group: group };
    });
  } catch (err) {
    await rollbackUpload(groupId, uploadedPaths, insertedIds);
    throw err;
  }
}

export async function patchOpportunityAttachment(
  before: Record<string, unknown>,
  body: { doc_category?: unknown; opportunity_line_id?: unknown },
  actor: string,
): Promise<{ attachment: Record<string, unknown>; change_group: string }> {
  if (String(before.entity_type ?? "") !== "opportunity") {
    throw new AttachmentHttpError(404, "Attachment not found");
  }
  const id = Number(before.id);
  const patch: Record<string, unknown> = {};
  if (body.doc_category !== undefined) {
    const category = readOpportunityCategory(body.doc_category, "patch");
    if (category === undefined) throw new AttachmentHttpError(400, "Unknown file category");
    patch.doc_category = category;
  }
  if (body.opportunity_line_id !== undefined) {
    const lineId = readOpportunityLineId(body.opportunity_line_id, "patch");
    if (lineId === undefined) throw new AttachmentHttpError(400, "Unknown deal line");
    if (lineId != null) {
      assertCanPinLine(await loadPinLine(lineId), Number(before.entity_id));
    }
    patch.opportunity_line_id = lineId;
  }
  if (!Object.keys(patch).length) throw new AttachmentHttpError(400, "Nothing to change");
  const unchanged = Object.keys(patch).every((key) => jsonEqual(before[key] ?? null, patch[key] ?? null));
  if (unchanged) throw new AttachmentHttpError(400, "Nothing to change");

  return withChangeGroupResult(actor, async (group) => {
    const { data, error } = await supabaseAdmin
      .from("attachments")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    try {
      await recordChange(opportunityFileUpdateChange(before, data as Record<string, unknown>, actor));
    } catch (err) {
      const revert: Record<string, unknown> = {};
      for (const key of Object.keys(patch)) revert[key] = before[key] ?? null;
      await supabaseAdmin.from("attachments").update(revert).eq("id", id);
      await supabaseAdmin.from("activity_log").delete().eq("change_group", group);
      throw err;
    }
    return { attachment: data as Record<string, unknown> };
  });
}

/**
 * Opportunity delete keeps the storage object. Undo re-inserts the row and the
 * file is still there. Objects whose delete is never undone can be cleaned up later.
 */
export async function deleteOpportunityAttachment(
  before: Record<string, unknown>,
  actor: string,
): Promise<{ ok: true; change_group: string }> {
  if (String(before.entity_type ?? "") !== "opportunity") {
    throw new AttachmentHttpError(404, "Attachment not found");
  }
  const id = Number(before.id);
  return withChangeGroupResult(actor, async (group) => {
    try {
      await recordChange(opportunityFileDeleteChange(before, actor));
      const { error } = await supabaseAdmin.from("attachments").delete().eq("id", id);
      if (error) throw error;
      return { ok: true as const };
    } catch (err) {
      await supabaseAdmin.from("activity_log").delete().eq("change_group", group);
      throw err;
    }
  });
}

export async function assertLineInsertUndoHasNoOutsideFiles(rows: UndoLogRow[], group: string): Promise<void> {
  const lineIds = rows
    .filter((row) => row.table_name === "opportunity_lines" && opOf(row) === "insert" && row.row_pk != null)
    .map((row) => Number(row.row_pk));
  if (!lineIds.length) return;
  const { data, error } = await supabaseAdmin
    .from("attachments")
    .select("id")
    .in("opportunity_line_id", lineIds);
  if (error) throw error;
  const attachmentIds = (data ?? []).map((row) => Number(row.id)).filter((id) => id > 0);
  if (!attachmentIds.length) return;
  const { data: logged, error: logErr } = await supabaseAdmin
    .from("activity_log")
    .select("row_pk")
    .eq("change_group", group)
    .eq("table_name", "attachments")
    .in("row_pk", attachmentIds);
  if (logErr) throw logErr;
  const inGroup = (logged ?? []).map((row) => Number(row.row_pk));
  if (lineInsertBlockedByOutsideFiles(attachmentIds, inGroup)) {
    throw new AttachmentHttpError(409, LINE_HAS_FILES_MESSAGE);
  }
}
