import { randomUUID } from "crypto";
import { readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import ExcelJS from "exceljs";
import { supabaseAdmin } from "./supabase";
import {
  V_VALID_EXPORT_HEADERS,
  exportRowToValues,
  viewRowToExport,
  type VValidViewRow,
} from "@shared/vcf-export";

export type VcfExportJobPublic = {
  id: string;
  status: "running" | "ready" | "failed";
  error?: string;
  filename?: string;
  rowCount?: number;
};

type ExportJobRow = {
  id: string;
  kind: string;
  status: "running" | "ready" | "failed";
  created_at: string;
  updated_at: string;
  error_message: string | null;
  row_count: number | null;
  storage_path: string | null;
  filename: string | null;
};

const KIND = "v_valid_cars";
const BATCH_SIZE = 1000;
const STORAGE_BUCKET = "rlms-attachments";
const SQL_HINT =
  "Apply migrations/20260817_export_jobs.sql in the Supabase SQL editor, then retry.";

const VIEW_SELECT = [
  "export_src",
  "export_id",
  "car_initial",
  "car_number",
  "car_type",
  "mechanical_designation",
  "general_description",
  "dot_code",
  "lining_material",
  "lease_type",
  "managed",
  "managed_category",
  "entity",
  "active",
  "start_date",
  "end_date",
  "rider",
  "assignment",
  "assignment_id",
  "lessee",
  "old_car_initial",
  "old_car_number",
  "owner",
  "valid_car_id",
  "client_id",
  "cover_sheet",
  "comment",
  "update_made",
  "update_needed_next_vcf",
].join(", ");

const WORKER_RESTARTED = "Worker restarted before the export finished.";

function logMem(jobId: string, label: string, extra?: Record<string, unknown>) {
  const mu = process.memoryUsage();
  const bits = extra
    ? " " +
      Object.entries(extra)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")
    : "";
  console.log(
    `[vcf-export] ${jobId} ${label} rss=${Math.round(mu.rss / 1048576)}MB heapUsed=${Math.round(mu.heapUsed / 1048576)}MB${bits}`,
  );
}

function errMessage(err: unknown): string {
  return String((err as { message?: string })?.message ?? err ?? "Export failed");
}

function isMissingExportJobs(err: unknown) {
  const msg = errMessage(err);
  const code = (err as { code?: string })?.code;
  return code === "42P01" || (/export_jobs/i.test(msg) && /does not exist|schema cache/i.test(msg));
}

function isMissingView(err: unknown) {
  const msg = errMessage(err);
  return /v_valid_export_rows|rlms_vcf_lessee/i.test(msg) && /does not exist|schema cache|42703/i.test(msg);
}

function isUniqueViolation(err: unknown) {
  return (err as { code?: string })?.code === "23505";
}

function publicFromRow(row: ExportJobRow): VcfExportJobPublic {
  return {
    id: row.id,
    status: row.status,
    error: row.error_message ?? undefined,
    filename: row.filename ?? undefined,
    rowCount: row.row_count ?? undefined,
  };
}

async function updateJob(id: string, patch: Record<string, unknown>) {
  const { error } = await supabaseAdmin
    .from("export_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

async function failJob(id: string, message: string) {
  try {
    await updateJob(id, { status: "failed", error_message: message });
  } catch (err) {
    console.error(`[vcf-export] ${id} failed to persist error status:`, err);
  }
}

async function fetchBatch(src: 1 | 2, afterId: number): Promise<VValidViewRow[]> {
  let q = supabaseAdmin
    .from("v_valid_export_rows")
    .select(VIEW_SELECT)
    .eq("export_src", src)
    .order("export_id", { ascending: true })
    .range(0, BATCH_SIZE - 1);
  if (afterId > 0) q = q.gt("export_id", afterId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as VValidViewRow[];
}

async function uploadWorkbook(jobId: string, tmpPath: string): Promise<string> {
  const storagePath = `exports/v-valid/${jobId}.xlsx`;
  const buf = await readFile(tmpPath);
  const { error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(storagePath, buf, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: true,
  });
  if (error) throw error;
  return storagePath;
}

async function runJob(jobId: string) {
  const tmpPath = join(tmpdir(), `vcf-export-${jobId}.xlsx`);
  logMem(jobId, "start");
  try {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: tmpPath,
      useStyles: false,
      useSharedStrings: false,
    });
    const sheet = workbook.addWorksheet("V_VALID_CARS");
    sheet.addRow([...V_VALID_EXPORT_HEADERS]).commit();

    let rowCount = 0;
    for (const src of [1, 2] as const) {
      let afterId = 0;
      for (;;) {
        const batch = await fetchBatch(src, afterId);
        if (!batch.length) break;
        for (const raw of batch) {
          const values = exportRowToValues(viewRowToExport(raw));
          sheet.addRow(values).commit();
          rowCount += 1;
        }
        const nextId = Number(batch[batch.length - 1]?.export_id);
        logMem(jobId, "batch", { src, afterId, nextId, rowCount, batch: batch.length });
        if (!Number.isFinite(nextId) || nextId <= afterId) break;
        afterId = nextId;
      }
    }

    await workbook.commit();
    logMem(jobId, "workbook-committed", { rowCount });

    const storagePath = await uploadWorkbook(jobId, tmpPath);
    logMem(jobId, "uploaded", { rowCount });

    await updateJob(jobId, {
      status: "ready",
      row_count: rowCount,
      storage_path: storagePath,
    });
    logMem(jobId, "ready", { rowCount });
  } catch (err) {
    const message = isMissingView(err)
      ? "v_valid_export_rows is missing. Apply migrations/20260817_v_valid_export_view.sql, then retry."
      : errMessage(err);
    console.error(`[vcf-export] ${jobId} failed:`, err);
    await failJob(jobId, message);
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }
}

export async function recoverStaleExportJobs(): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("export_jobs")
    .update({
      status: "failed",
      error_message: WORKER_RESTARTED,
      updated_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .select("id");
  if (error) {
    if (isMissingExportJobs(error)) {
      console.warn(`[vcf-export] export_jobs table missing. ${SQL_HINT}`);
      return;
    }
    console.error("[vcf-export] recover failed:", error);
    return;
  }
  if (data?.length) {
    console.log(`[vcf-export] marked ${data.length} stale running job(s) failed after restart`);
  }
}

export async function startVcfExportJob(): Promise<{ id: string } | { error: string; status: number }> {
  const id = randomUUID();
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `V_VALID_CARS_${stamp}.xlsx`;
  const { error } = await supabaseAdmin.from("export_jobs").insert({
    id,
    kind: KIND,
    status: "running",
    filename,
  });
  if (error) {
    if (isMissingExportJobs(error)) {
      return { error: `export_jobs table is missing. ${SQL_HINT}`, status: 503 };
    }
    if (isUniqueViolation(error) || /duplicate key|export_jobs_one_running/i.test(errMessage(error))) {
      return { error: "An export is already running. Wait for it to finish, then try again.", status: 409 };
    }
    return { error: errMessage(error), status: 500 };
  }
  void runJob(id).catch(async (err) => {
    console.error(`[vcf-export] ${id} unhandled:`, err);
    await failJob(id, errMessage(err));
  });
  return { id };
}

export async function getVcfExportJob(id: string): Promise<VcfExportJobPublic | null> {
  const { data, error } = await supabaseAdmin.from("export_jobs").select("*").eq("id", id).maybeSingle();
  if (error) {
    if (isMissingExportJobs(error)) return null;
    throw error;
  }
  if (!data) return null;
  return publicFromRow(data as ExportJobRow);
}

export async function getVcfExportFile(
  id: string,
): Promise<
  | { ok: true; buffer: Buffer; filename: string }
  | { ok: false; status: number; message: string }
> {
  const { data, error } = await supabaseAdmin.from("export_jobs").select("*").eq("id", id).maybeSingle();
  if (error) {
    if (isMissingExportJobs(error)) return { ok: false, status: 404, message: "Export job not found" };
    throw error;
  }
  const row = data as ExportJobRow | null;
  if (!row) return { ok: false, status: 404, message: "Export job not found" };
  if (row.status === "running") return { ok: false, status: 409, message: "Export is still running" };
  if (row.status === "failed") return { ok: false, status: 500, message: row.error_message || "Export failed" };
  if (!row.storage_path) return { ok: false, status: 500, message: "Export file is missing" };

  const downloaded = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(row.storage_path);
  if (downloaded.error || !downloaded.data) {
    return { ok: false, status: 500, message: downloaded.error?.message || "Could not read export file from storage" };
  }
  const buffer = Buffer.from(await downloaded.data.arrayBuffer());
  return { ok: true, buffer, filename: row.filename || "V_VALID_CARS.xlsx" };
}
