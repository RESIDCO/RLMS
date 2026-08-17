import { randomUUID } from "crypto";
import XLSX from "xlsx";
import { supabaseAdmin } from "./supabase";
import { fetchAllRows, fetchAllRowsOrThrow } from "./fetch-all";
import {
  buildVValidExportRows,
  exportRowsToAoa,
  sortVValidExportRows,
  viewRowToExport,
  type VValidExportRow,
  type VValidViewRow,
} from "@shared/vcf-export";

export type VcfExportJobPublic = {
  id: string;
  status: "running" | "ready" | "error";
  error?: string;
  filename?: string;
  rowCount?: number;
};

type VcfExportJob = VcfExportJobPublic & {
  buffer?: Buffer;
  createdAt: number;
};

const jobs = new Map<string, VcfExportJob>();
const TTL_MS = 15 * 60 * 1000;
const MAX_RUNNING = 2;

const CAR_SELECT =
  "id, car_initial, car_number, car_type, mechanical_designation, general_description, dot_code, lining_material, lease_type, managed, managed_category, entity, legal_owner, legacy_valid_car_id, client_id, cover_sheet, update_made, update_needed_next_vcf, rider_external_id, assignment_label, lessee_name, active, acquisition_date";
const CAR_SELECT_NO_ACQ = CAR_SELECT.replace(", acquisition_date", "");

function gc() {
  const now = Date.now();
  for (const [id, job] of Array.from(jobs.entries())) {
    if (now - job.createdAt > TTL_MS) jobs.delete(id);
  }
}

function isMissingRelation(err: unknown) {
  const msg = String((err as any)?.message ?? err ?? "");
  return /v_valid_export_rows|rlms_vcf_lessee/i.test(msg) && /does not exist|schema cache|42703/i.test(msg);
}

async function fetchFromJoinedView(): Promise<VValidExportRow[] | null> {
  try {
    const raw = await fetchAllRows<VValidViewRow>((from, to) =>
      supabaseAdmin
        .from("v_valid_export_rows")
        .select("*")
        .order("export_src", { ascending: true })
        .order("export_id", { ascending: true })
        .range(from, to),
    );
    return sortVValidExportRows(raw.map(viewRowToExport));
  } catch (err) {
    if (isMissingRelation(err)) return null;
    throw err;
  }
}

async function fetchFromTables(): Promise<VValidExportRow[]> {
  const histJob = fetchAllRowsOrThrow(supabaseAdmin, "assignment_history", (from, to) =>
    supabaseAdmin
      .from("assignment_history")
      .select("id, railcar_id, rider_external_id, assignment_label, start_date, end_date, active, comment, assignment_id_ext")
      .order("id", { ascending: true })
      .range(from, to),
  );
  const remarkJob = fetchAllRowsOrThrow(supabaseAdmin, "car_number_history", (from, to) =>
    supabaseAdmin
      .from("car_number_history")
      .select("railcar_id, changed_at, old_car_initial, old_car_number")
      .order("id", { ascending: true })
      .range(from, to),
  );
  const carsJob = (async () => {
    try {
      return await fetchAllRowsOrThrow(supabaseAdmin, "railcars", (from, to) =>
        supabaseAdmin.from("railcars").select(CAR_SELECT).order("id", { ascending: true }).range(from, to),
      );
    } catch (err) {
      const msg = String((err as any)?.message ?? err ?? "");
      if (!/acquisition_date/i.test(msg)) throw err;
      return await fetchAllRowsOrThrow(supabaseAdmin, "railcars", (from, to) =>
        supabaseAdmin.from("railcars").select(CAR_SELECT_NO_ACQ).order("id", { ascending: true }).range(from, to),
      );
    }
  })();
  const [history, remarks, cars] = await Promise.all([histJob, remarkJob, carsJob]);
  return buildVValidExportRows(history as any, cars as any, remarks as any);
}

function workbookBuffer(rows: VValidExportRow[]): Buffer {
  const aoa = exportRowsToAoa(rows);
  const ws = XLSX.utils.aoa_to_sheet(aoa, { raw: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "V_VALID_CARS");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function runJob(job: VcfExportJob) {
  const joined = await fetchFromJoinedView();
  const rows = joined ?? (await fetchFromTables());
  const stamp = new Date().toISOString().slice(0, 10);
  job.buffer = workbookBuffer(rows);
  job.filename = `V_VALID_CARS_${stamp}.xlsx`;
  job.rowCount = rows.length;
  job.status = "ready";
}

export function startVcfExportJob(): { id: string } | { error: string; status: number } {
  gc();
  const running = Array.from(jobs.values()).filter((j) => j.status === "running").length;
  if (running >= MAX_RUNNING) {
    return { error: "An export is already running. Wait for it to finish, then try again.", status: 429 };
  }
  const id = randomUUID();
  const job: VcfExportJob = { id, status: "running", createdAt: Date.now() };
  jobs.set(id, job);
  void runJob(job).catch((err) => {
    job.status = "error";
    job.error = String((err as any)?.message ?? err);
  });
  return { id };
}

export function getVcfExportJob(id: string): VcfExportJob | null {
  gc();
  return jobs.get(id) ?? null;
}

export function publicVcfExportJob(job: VcfExportJob): VcfExportJobPublic {
  return {
    id: job.id,
    status: job.status,
    error: job.error,
    filename: job.filename,
    rowCount: job.rowCount,
  };
}
