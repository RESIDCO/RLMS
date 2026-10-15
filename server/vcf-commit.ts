import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "./fetch-all";
import { deleteVcfPreview, getVcfPreview } from "./vcf-preview-cache";
import { governLeaseDates } from "./govern-lease-dates";
import { autoFleetStatusFromLegacyText } from "@shared/fleet-status";
import { statusAlignedToActiveFlag } from "@shared/car-lifecycle-status";
import { assertRailcarImporterPatch } from "@shared/rider-import-guard";
import {
  buildVcfReview,
  vcfCarKeyFromDb,
  railcarPayloadFromCurrent,
  assignmentHistoryPayloadFromPeriod,
  carNumberHistoryNaturalKey,
  carNumberHistoryPayloadFromPeriod,
  type VcfExistingCar,
} from "@shared/vcf-import";
import {
  closeoutClosePatch,
  closeoutStats,
  planVcfAssignmentCloseout,
  skipVcfAssignmentWrites,
  VCF_MANUAL_PROTECTED_RAILCAR_FIELDS,
  type ExistingHistoryRow,
} from "@shared/vcf-assignment-closeout";
import {
  buildVcfIntegrityChecks,
  countFleet,
  countOpenPeriodStats,
  fetchWatchCars,
  watchUnchanged,
  type VcfIntegrityCheck,
} from "./vcf-load-integrity";

const RAILCAR_SELECT =
  "id, car_initial, car_number, reporting_marks, car_type, mechanical_designation, general_description, lease_type, managed, managed_category, lining_material, entity, active, active_status, rider_external_id, lessee_name, assignment_label, lease_start_date, lease_end_date, lease_expiry, dot_code, dot_specification, comment_event_note, legacy_valid_car_id, client_id, cover_sheet, legal_owner, update_made, update_needed_next_vcf, data_source, status, fleet_status, fleet_status_source, active_source";

const AH_SELECT =
  "id, railcar_id, assignment_id_ext, start_date, end_date, rider_external_id, assignment_label, active, comment, reason, moved_at, moved_by";

const BACKUP_KEYS = RAILCAR_SELECT.split(", ").filter((k) => k !== "id");

export class VcfCommitError extends Error {
  constructor(
    message: string,
    public stage: string,
    public loadId: string | null,
    public written: Record<string, number>
  ) {
    super(message);
    this.name = "VcfCommitError";
  }
}

export type VcfCommitResult = {
  ok: true;
  loadId: string;
  fileName: string | null;
  inserted: number;
  updated: number;
  unchanged: number;
  reactivated: number;
  deactivated: number;
  skippedManual: number;
  notInFile: number;
  carsProcessed: number;
  assignmentInserted: number;
  assignmentUpdated: number;
  assignmentUnchanged: number;
  assignmentClosed: number;
  assignmentSkipped: number;
  remarkInserted: number;
  remarkUnchanged: number;
  multipleActiveFlagged: number;
  integrityChecks: VcfIntegrityCheck[];
  riderExpirationSync: Awaited<ReturnType<typeof governLeaseDates>> | null;
};

function asStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v).trim();
}

function payloadChanged(next: Record<string, unknown>, existing: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(next)) {
    if (asStr(v) !== asStr(existing[k])) return true;
  }
  return false;
}

function pickBackup(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of BACKUP_KEYS) out[k] = row[k] ?? null;
  return out;
}

async function insertChunks(
  db: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  size = 200
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size);
    const { error } = await db.from(table).insert(slice);
    if (error) throw error;
  }
}

export async function runVcfCommit(opts: {
  db: SupabaseClient;
  writerId: string;
  previewId: string;
  confirmProductionImport: boolean;
  progress: (phase: string) => void;
}): Promise<VcfCommitResult> {
  const { db, writerId, previewId, confirmProductionImport, progress } = opts;
  let stage = "sign_off";
  let loadId: string | null = null;
  const written = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    assignmentInserted: 0,
    assignmentUpdated: 0,
    assignmentClosed: 0,
    remarkInserted: 0,
  };
  const fail = (raw: string): never => {
    throw new VcfCommitError(`commit failed: ${stage}: ${raw}`, stage, loadId, { ...written });
  };

  try {
    if (!confirmProductionImport) {
      fail("VCF commit blocked — check “I have reviewed these counts” and confirm.");
    }
    stage = "load_preview";
    progress("Loading staged preview");
    const cached = await getVcfPreview(db, previewId, writerId);
    if (!cached?.rows?.length) fail("Preview expired, re-drop the file");
    const rows = cached.rows;
    const fileName = cached.fileName;

    stage = "load_existing";
    progress("Loading existing cars");
    const existingList = await fetchAllRows<Record<string, unknown>>((from, to) =>
      db.from("railcars").select(RAILCAR_SELECT).order("id", { ascending: true }).range(from, to)
    );
    const existingByKey = new Map<string, Record<string, unknown>>();
    const existingCars = new Map<string, VcfExistingCar>();
    const keyToId = new Map<string, number>();
    const existingKeys = new Set<string>();
    for (const r of existingList) {
      const k = vcfCarKeyFromDb(r as any);
      existingByKey.set(k, r);
      existingKeys.add(k);
      keyToId.set(k, Number(r.id));
      existingCars.set(k, {
        active: (r.active as boolean | null) ?? null,
        active_source: (r.active_source as string | null) ?? null,
      });
    }

    stage = "build_review";
    progress("Building write plan");
    const review = buildVcfReview(rows, existingKeys, { keepCars: true, existingCars });

    stage = "snapshot_checks";
    progress("Recording pre-load checks");
    const openBefore = await countOpenPeriodStats(db);
    const watchBefore = await fetchWatchCars(db);

    stage = "load_history";
    progress("Loading assignment history");
    const ahByRailcar = new Map<number, ExistingHistoryRow[]>();
    {
      const ahRows = await fetchAllRows<ExistingHistoryRow>((from, to) =>
        db.from("assignment_history").select(AH_SELECT).order("id", { ascending: true }).range(from, to)
      );
      for (const r of ahRows) {
        const rid = Number(r.railcar_id);
        const list = ahByRailcar.get(rid) ?? [];
        list.push(r);
        ahByRailcar.set(rid, list);
      }
    }
    const cnhByKey = new Map<string, any>();
    {
      const cnhRows = await fetchAllRows<any>((from, to) =>
        db
          .from("car_number_history")
          .select("id, railcar_id, old_car_initial, old_car_number, new_car_initial, new_car_number, changed_at, changed_by, reason")
          .eq("changed_by", "vcf-import")
          .order("id", { ascending: true })
          .range(from, to)
      );
      for (const r of cnhRows) {
        cnhByKey.set(
          carNumberHistoryNaturalKey({
            railcarId: r.railcar_id,
            old_car_initial: r.old_car_initial,
            old_car_number: r.old_car_number,
            new_car_initial: r.new_car_initial,
            new_car_number: r.new_car_number,
            changed_at: r.changed_at,
          }),
          r
        );
      }
    }

    stage = "open_load";
    const { data: logRow, error: logErr } = await db
      .from("vcf_load_log")
      .insert({
        loaded_by: writerId,
        file_name: fileName,
        preview_id: previewId,
        summary: { status: "started" },
        checks: [],
      })
      .select("id")
      .single();
    if (logErr || !logRow) fail(logErr?.message ?? "Could not open vcf_load_log");
    loadId = String(logRow.id);

    const movedAt = new Date().toISOString();
    const railcarBackups: Record<string, unknown>[] = [];
    const ahBackups = new Map<number, Record<string, unknown>>();
    const planned: Array<{
      car: (typeof review.cars)[number];
      existingId: number | undefined;
      existingCar: Record<string, unknown> | undefined;
      updatePayload: Record<string, unknown> | null;
      insertPayload: Record<string, unknown> | null;
      skipHistory: boolean;
      actions: ReturnType<typeof planVcfAssignmentCloseout>;
    }> = [];

    for (const car of review.cars) {
      const payload = railcarPayloadFromCurrent(car.current, { needsReview: car.needsReview });
      const existingId = keyToId.get(car.carKey);
      const existingCar = existingId ? existingByKey.get(car.carKey) : undefined;
      let updatePayload: Record<string, unknown> | null = null;
      let insertPayload: Record<string, unknown> | null = null;
      if (existingId && existingCar) {
        updatePayload = { ...payload };
        if (existingCar.entity === payload.entity) delete updatePayload.entity;
        if (existingCar.fleet_status_source === "manual") {
          delete updatePayload.fleet_status;
          delete updatePayload.fleet_status_source;
        } else {
          updatePayload.fleet_status = autoFleetStatusFromLegacyText({
            active: payload.active as boolean | undefined,
            rider_external_id: payload.rider_external_id as string | null,
            assignment_label: payload.assignment_label as string | null,
            managed_category: payload.managed_category as string | null,
          });
          updatePayload.fleet_status_source = "auto";
        }
        const activeManual = existingCar.active_source === "manual";
        if (activeManual) {
          for (const key of VCF_MANUAL_PROTECTED_RAILCAR_FIELDS) delete updatePayload[key];
        } else {
          updatePayload.active_source = "auto";
          if (typeof payload.active === "boolean") {
            updatePayload.status = statusAlignedToActiveFlag(
              existingCar.status as string | null,
              payload.active
            );
          }
        }
        assertRailcarImporterPatch(updatePayload);
        if (!payloadChanged(updatePayload, existingCar)) updatePayload = null;
        else railcarBackups.push({ load_id: loadId, railcar_id: existingId, before: pickBackup(existingCar) });
      } else {
        insertPayload = {
          ...payload,
          status: statusAlignedToActiveFlag(null, payload.active === true),
          fleet_status: autoFleetStatusFromLegacyText({
            active: payload.active as boolean | undefined,
            rider_external_id: payload.rider_external_id as string | null,
            assignment_label: payload.assignment_label as string | null,
            managed_category: payload.managed_category as string | null,
          }),
          fleet_status_source: "auto",
          active_source: "auto",
        };
        assertRailcarImporterPatch(insertPayload);
      }

      const skipHistory = skipVcfAssignmentWrites({
        active_source: existingId ? (existingCar?.active_source as string | null) : "auto",
        active: existingId ? (existingCar?.active as boolean | null) : true,
      });
      let actions: ReturnType<typeof planVcfAssignmentCloseout> = [];
      if (!skipHistory && (existingId || insertPayload)) {
        const rid = existingId ?? -1;
        if (existingId) {
          const incoming = car.periods.map((p) => assignmentHistoryPayloadFromPeriod(existingId, p, movedAt));
          actions = planVcfAssignmentCloseout({
            existingRows: ahByRailcar.get(existingId) ?? [],
            incoming,
          });
          for (const action of actions) {
            if (action.op !== "close" && action.op !== "update") continue;
            const row = (ahByRailcar.get(rid) ?? []).find((x) => x.id === action.existingId);
            if (row && !ahBackups.has(row.id)) {
              ahBackups.set(row.id, {
                load_id: loadId,
                assignment_history_id: row.id,
                before: { ...row },
              });
            }
          }
        }
      }
      planned.push({
        car,
        existingId,
        existingCar,
        updatePayload,
        insertPayload,
        skipHistory,
        actions,
      });
    }

    stage = "backup";
    progress(`Saving rollback snapshots (${railcarBackups.length} cars, ${ahBackups.size} periods)`);
    await insertChunks(db, "vcf_load_railcar_backup", railcarBackups);
    await insertChunks(db, "vcf_load_assignment_backup", [...ahBackups.values()]);

    stage = "write_cars";
    const BATCH = 100;
    let assignmentSkipped = 0;
    let assignmentUnchanged = 0;
    let remarkUnchanged = 0;
    const railcarInserts: Record<string, unknown>[] = [];
    const ahInserts: Record<string, unknown>[] = [];
    const cnhInserts: Record<string, unknown>[] = [];

    for (let i = 0; i < planned.length; i += BATCH) {
      const slice = planned.slice(i, i + BATCH);
      progress(`Writing cars (${Math.min(i + BATCH, planned.length)} of ${planned.length})`);
      for (const item of slice) {
        const { car } = item;
        let railcarId = item.existingId;
        if (item.existingId) {
          if (item.updatePayload) {
            const { error } = await db.from("railcars").update(item.updatePayload).eq("id", item.existingId);
            if (error) fail(error.message);
            written.updated += 1;
          } else {
            written.unchanged += 1;
          }
        } else if (item.insertPayload) {
          const { data: ins, error } = await db.from("railcars").insert(item.insertPayload).select("id").single();
          if (error) fail(error.message);
          railcarId = ins!.id;
          keyToId.set(car.carKey, railcarId);
          railcarInserts.push({ load_id: loadId, railcar_id: railcarId });
          written.inserted += 1;
        }

        if (item.skipHistory) {
          assignmentSkipped += car.periods.length;
        } else {
          const incoming = car.periods.map((p) => assignmentHistoryPayloadFromPeriod(railcarId!, p, movedAt));
          const actions =
            item.existingId && item.actions.length
              ? item.actions
              : planVcfAssignmentCloseout({
                  existingRows: ahByRailcar.get(railcarId!) ?? [],
                  incoming,
                });
          const plannedStats = closeoutStats(actions);
          for (const action of actions) {
            if (action.op === "unchanged") continue;
            if (action.op === "update") {
              const { error } = await db.from("assignment_history").update(action.payload).eq("id", action.existingId);
              if (error) fail(error.message);
              written.assignmentUpdated += 1;
            } else if (action.op === "insert") {
              const { data: ins, error } = await db.from("assignment_history").insert(action.payload).select("id").single();
              if (error) fail(error.message);
              const next = ahByRailcar.get(railcarId!) ?? [];
              next.push({ id: ins!.id, ...action.payload });
              ahByRailcar.set(railcarId!, next);
              ahInserts.push({ load_id: loadId, assignment_history_id: ins!.id });
              written.assignmentInserted += 1;
            } else if (action.op === "close") {
              const { error } = await db
                .from("assignment_history")
                .update(closeoutClosePatch(action, movedAt))
                .eq("id", action.existingId);
              if (error) fail(error.message);
              written.assignmentClosed += 1;
            }
          }
          assignmentUnchanged += plannedStats.unchanged;
        }

        for (const p of car.periods) {
          const remark = carNumberHistoryPayloadFromPeriod(railcarId!, p, movedAt);
          if (!remark) continue;
          const key = carNumberHistoryNaturalKey({
            railcarId: remark.railcar_id,
            old_car_initial: remark.old_car_initial,
            old_car_number: remark.old_car_number,
            new_car_initial: remark.new_car_initial,
            new_car_number: remark.new_car_number,
            changed_at: remark.changed_at,
          });
          if (cnhByKey.get(key)) {
            remarkUnchanged += 1;
            continue;
          }
          const { data: ins, error } = await db.from("car_number_history").insert(remark).select("id").single();
          if (error) fail(error.message);
          cnhByKey.set(key, { id: ins!.id, ...remark });
          cnhInserts.push({ load_id: loadId, car_number_history_id: ins!.id });
          written.remarkInserted += 1;
        }
      }
    }

    stage = "record_inserts";
    await insertChunks(db, "vcf_load_railcar_insert", railcarInserts);
    await insertChunks(db, "vcf_load_assignment_insert", ahInserts);
    await insertChunks(db, "vcf_load_cnh_insert", cnhInserts);

    stage = "lease_dates";
    progress("Re-applying lease-date governance");
    let riderExpirationSync: Awaited<ReturnType<typeof governLeaseDates>> | null = null;
    try {
      riderExpirationSync = await governLeaseDates(db);
    } catch (syncErr) {
      console.warn("[vcf/commit] lease date governance failed", syncErr);
    }

    stage = "integrity";
    progress("Running post-load checks");
    const fleetAfter = await countFleet(db);
    const openAfter = await countOpenPeriodStats(db);
    const watchAfter = await fetchWatchCars(db);
    const integrityChecks = buildVcfIntegrityChecks({
      reviewProjectedTotal: review.projectedTotalCars,
      reviewProjectedActive: review.projectedActiveCars,
      fleetAfter,
      openBefore,
      openAfter,
      watch: watchUnchanged(watchBefore, watchAfter),
    });

    const summary = {
      inserted: written.inserted,
      updated: written.updated,
      unchanged: written.unchanged,
      reactivated: review.reactivatedCars,
      deactivated: review.deactivatedCars,
      skippedManual: review.skippedManualCount,
      notInFile: review.notInFileCount,
      assignmentInserted: written.assignmentInserted,
      assignmentUpdated: written.assignmentUpdated,
      assignmentUnchanged,
      assignmentClosed: written.assignmentClosed,
      assignmentSkipped,
      remarkInserted: written.remarkInserted,
      remarkUnchanged,
      projectedTotalCars: review.projectedTotalCars,
      projectedActiveCars: review.projectedActiveCars,
    };

    stage = "load_log";
    const { error: updLogErr } = await db
      .from("vcf_load_log")
      .update({ summary, checks: integrityChecks })
      .eq("id", loadId);
    if (updLogErr) console.warn("[vcf/commit] load log update:", updLogErr.message);

    stage = "consume_preview";
    await deleteVcfPreview(db, previewId, writerId);

    progress("Done");
    return {
      ok: true,
      loadId,
      fileName,
      inserted: written.inserted,
      updated: written.updated,
      unchanged: written.unchanged,
      reactivated: review.reactivatedCars,
      deactivated: review.deactivatedCars,
      skippedManual: review.skippedManualCount,
      notInFile: review.notInFileCount,
      carsProcessed: review.cars.length,
      assignmentInserted: written.assignmentInserted,
      assignmentUpdated: written.assignmentUpdated,
      assignmentUnchanged,
      assignmentClosed: written.assignmentClosed,
      assignmentSkipped,
      remarkInserted: written.remarkInserted,
      remarkUnchanged,
      multipleActiveFlagged: review.multipleActiveCount,
      integrityChecks,
      riderExpirationSync,
    };
  } catch (err) {
    if (err instanceof VcfCommitError) throw err;
    const raw = err instanceof Error ? err.message : String(err);
    fail(raw);
  }
}
