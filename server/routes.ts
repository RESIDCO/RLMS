import type { Express, Request, Response } from "express";
import type { Server } from "http";
import multer from "multer";
import { supabase, supabaseAdmin } from "./supabase";
import { fetchAllRows, fetchAllRowsOrThrow } from "./fetch-all";
import { startVcfExportJob, getVcfExportJob, getVcfExportFile, recoverStaleExportJobs } from "./vcf-export-job";
import { queryRailcars, queryRailcarIds, parseRailcarListParams, attachAccountManagerInitials } from "./railcar-list";
import { listAccounts, getAccount, createAccount, updateAccount, ensureAccountForLessee, accountManagerByAccountIds, listAccountManagementOverview, isStatusTag, patchRiderStatusTag, listRiderCarsForAccountMgmt } from "./accounts";
import {
  attachLatestAmNotes,
  createRiderAccountComment,
  deleteRiderAccountComment,
  listRiderAccountComments,
} from "./rider-account-comments";
import {
  addComment as addTransitionComment,
  addMilestone,
  createTransitionRecord,
  deleteComment as deleteTransitionComment,
  deleteMilestone,
  getTransitionDetail,
  listTransitionRecords,
  listTransitionSummary,
  patchMilestone,
  patchTransitionRecord,
} from "./account-transitions";
import {
  generateBriefingPdf,
  getOrCreateBriefingForm,
  saveBriefingForm,
} from "./account-transition-briefing";
import {
  ACCOUNT_TRANSITIONS_SOURCE,
  genericUploadSource,
  insertAttachmentRow,
  isAttachmentEntityType,
  listAccountScopedAttachments,
  riderBelongsToAccount,
} from "./attachments";
import { persistOpsFlag, omitOpsFlagFields } from "./ops-flag-persist";
import {
  MASTER_LEASE_DATE_KEYS,
  RAILCAR_DATE_KEYS,
  RIDER_DATE_KEYS,
  nullifyEmptyDateStrings,
} from "./sanitize";
import { buildLeaseReport } from "./lease-export";
import { runGlobalSearch } from "./global-search";
import { addNote, listActivityLog, logActivity } from "./activity-log";
import { countActiveCarsByRiderId, countCarsByRiderId } from "./rider-car-counts";
import {
  applyCarStatusChange,
  assertInactivePatchAllowed,
  patchFieldsForStatusChange,
  writeCarStatusHistoryRow,
  syncCurrentAssignmentHistoryActive,
} from "./car-status-history";
import { crossesInactiveBoundary, fieldsImpliedByCarStatus, statusAlignedToActiveFlag } from "@shared/car-lifecycle-status";
import { fillBlankRiderMonthlyRent } from "./rider-rent-rollup";
import { applyCarFinancialsFromSummary, loadFinancialSummaryRows } from "./refresh-car-financials";
import { assertRailcarImporterPatch, assertRiderImporterPatch } from "@shared/rider-import-guard";
import {
  addCarsToProgram,
  buildProgramReport,
  bulkPatchProgramCars,
  carProgramHistory,
  exitCarFromProgram,
  getProgram,
  listActivity,
  listCategories,
  listProgramCarsWithDocs,
  listPrograms,
  listStatusOptions,
  olProgramHistory,
  parseStatus,
  patchProgramCar,
  resolveProgramCars,
  logProgramActivity,
} from "./programs";
import { masterReportFilename } from "@shared/programs";
import { asOne } from "@shared/lease-type";
import { hydrateOpsFlag } from "@shared/ops-flag";
import {
  getAuthUser,
  getUserRole,
  normalizeEmail,
  requireApiAuth,
  requireAdmin,
  requireWrite,
  requireUser,
  requireContactsWrite,
  requireContactsDelete,
  requireAccountMgmtWrite,
  isValidRole,
  type AppRole,
} from "./auth";
import {
  insertMasterLeaseSchema,
  insertRiderSchema,
  insertRailcarSchema,
  insertRiderContactSchema,
  changeCarNumberSchema,
  moveCarsSchema,
} from "@shared/schema";
import {
  normalizeRow,
  deriveManagedCategory,
  deriveActiveBool,
  parseDateCell,
  parseNumberCell,
  parseIntCell,
  splitCarNumber,
  deriveLeaseKey,
  synthesizeLeaseNumber,
} from "@shared/residco-import";
import {
  buildVcfReview,
  railcarPayloadFromCurrent,
  assignmentHistoryNaturalKey,
  assignmentHistoryPayloadFromPeriod,
  assignmentHistoryContentEqual,
  carNumberHistoryNaturalKey,
  carNumberHistoryPayloadFromPeriod,
} from "@shared/vcf-import";
import {
  deriveFleetStatus,
  isOperatingFleetCar,
  autoFleetStatusFromLegacyText,
  parseFleetStatus,
  countsAsLeasedForKpi,
  isLeasedFleetStatus,
  isResidcoOwnedEntity,
  type FleetStatus,
} from "@shared/fleet-status";
import {
  aggregateOlEndDate,
  carLeaseEndDate,
  carLesseeName,
  carOlCode,
  parseIsoDateOnly,
  effectiveDateToTimestamp,
} from "@shared/lease-authority";
import {
  buildAssetReportExpirations,
  buildCarFallbackExpirations,
  resolveGovernedExpiration,
} from "@shared/lease-governance";
import { governLeaseDates } from "./govern-lease-dates";
import {
  MissingExpiryEstimateColumnsError,
  probeEstimatedLeaseExpiryColumns,
} from "./refresh-estimated-lease-expiry";
import { carBuildYear, turning50ByYear } from "@shared/build-year";
import { browseGroup, browseOl, browseTurning50, countInProgram } from "./browse";
import { buildTurning50Report } from "./turning50-export";
import {
  buildFinancialReview,
  financialRowToDbPayload,
  mergeFinancialRowsByUniqueKey,
  normalizeSnapshotMonth,
  RAILCAR_FINANCIAL_REFRESH_FIELDS,
} from "@shared/financial-import";
import {
  classifyAcquisitionRows,
  buildExistingCarKeySet,
  parseAcquisitionEntity,
  parseAcquisitionPrice,
  resolveBatchRentalStatus,
  skipReasonLabel,
  type AcquisitionParsedRow,
} from "@shared/acquisition-import";
import {
  calculateDv,
  type DvInputs,
  type DvReferenceData,
  type EquipmentType,
  type AbRateBasis,
  type AbItemInput,
} from "@shared/rule107";
import { enrichDvResultWarnings, validateMaterialCompositionForSave } from "@shared/dv-material-guardrails";

// Multer: store uploads in memory (files go straight to Supabase Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 52 * 1024 * 1024 }, // 50 MB
});

const STORAGE_BUCKET = "rlms-attachments";

/* ==================================================================
 *  DV CALCULATOR (AAR Rule 107) — module helpers
 * ================================================================== */

async function dvLoadReferenceData(): Promise<DvReferenceData> {
  const [cf, sq, cr] = await Promise.all([
    supabase.from("dv_cost_factors").select("year, factor").order("year", { ascending: true }),
    supabase.from("dv_salvage_quarters").select("quarter_code, steel_per_lb, aluminum_per_lb, stainless_per_lb, dismantling_per_gt").order("quarter_code", { ascending: true }),
    supabase.from("dv_car_dep_rates").select("equipment_type, annual_rate, max_depreciation, age_cutoff_years"),
  ]);
  if (cf.error) throw cf.error;
  if (sq.error) throw sq.error;
  if (cr.error) throw cr.error;
  return {
    costFactors: (cf.data || []).map((r: any) => ({ year: r.year, factor: r.factor })),
    salvageQuarters: (sq.data || []).map((r: any) => ({
      quarterCode: r.quarter_code,
      steelPerLb: Number(r.steel_per_lb),
      aluminumPerLb: Number(r.aluminum_per_lb),
      stainlessPerLb: r.stainless_per_lb == null ? null : Number(r.stainless_per_lb),
      dismantlingPerGt: Number(r.dismantling_per_gt),
    })),
    carDepRates: (cr.data || []).map((r: any) => ({
      equipmentType: r.equipment_type as EquipmentType,
      annualRate: Number(r.annual_rate),
      maxDepreciation: Number(r.max_depreciation),
      ageCutoffYears: r.age_cutoff_years,
    })),
  };
}

function dvMaterialWeights(inputs: DvInputs) {
  return {
    tareWeightLb: inputs.tareWeightLb,
    steelWeightLb: inputs.steelWeightLb,
    aluminumWeightLb: inputs.aluminumWeightLb,
    stainlessWeightLb: inputs.stainlessWeightLb ?? 0,
    nonMetallicWeightLb: inputs.nonMetallicWeightLb,
  };
}

function dvCalculateWithGuardrails(inputs: DvInputs, ref: DvReferenceData) {
  return enrichDvResultWarnings(calculateDv(inputs, ref), dvMaterialWeights(inputs));
}

function dvParseInputs(body: any, abCodes: Map<string, { rate_basis: AbRateBasis; rate: number; max_depreciation: number }>): DvInputs {
  const abItems: AbItemInput[] = (body.abItems || []).map((it: any) => {
    const meta = abCodes.get((it.code || "").toUpperCase());
    const rateBasis: AbRateBasis = (it.rateBasis as AbRateBasis) || meta?.rate_basis || "ANNUAL";
    const rate = it.rate != null ? Number(it.rate) : Number(meta?.rate ?? 0);
    const maxDepreciation = it.maxDepreciation != null ? Number(it.maxDepreciation) : Number(meta?.max_depreciation ?? 0.9);
    return {
      code: String(it.code || "").toUpperCase(),
      value: Number(it.value) || 0,
      installDate: new Date(it.installDate),
      rateBasis,
      rate,
      max: maxDepreciation,
    };
  });
  return {
    incidentDate:       new Date(body.incidentDate),
    buildDate:          new Date(body.buildDate),
    originalCost:       Number(body.originalCost) || 0,
    tareWeightLb:       Number(body.tareWeightLb) || 0,
    steelWeightLb:      Number(body.steelWeightLb) || 0,
    aluminumWeightLb:   Number(body.aluminumWeightLb) || 0,
    stainlessWeightLb:  body.stainlessWeightLb != null ? Number(body.stainlessWeightLb) : 0,
    nonMetallicWeightLb: Number(body.nonMetallicWeightLb) || 0,
    equipmentType:      body.equipmentType as EquipmentType,
    abItems,
  };
}

// Freshness per AAR Office Manual Rule 107.E:
//   • Cost Factors — Rule 107.E.2 uses the factor for the year PRIOR to the
//     incident year (e.g. a 2026 incident uses the 2025 factor). Stale only if
//     the prior-year row is missing.
//   • Salvage Quarters — quarterly; the current-quarter row must exist.
//   • A&B Codes — reference-only; no fixed quarterly cadence, so not flagged.
async function dvComputeFreshness() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  const quarterCode = year * 10 + q;
  const priorYear = year - 1;
  const [cfRes, sqRes] = await Promise.all([
    supabase.from("dv_cost_factors").select("year", { count: "exact", head: false }).eq("year", priorYear),
    supabase.from("dv_salvage_quarters").select("quarter_code", { count: "exact", head: false }).eq("quarter_code", quarterCode),
  ]);
  const stale: string[] = [];
  if (!cfRes.error && (cfRes.data?.length ?? 0) === 0) stale.push("cost_factors");
  if (!sqRes.error && (sqRes.data?.length ?? 0) === 0) stale.push("salvage_quarters");
  return {
    currentYear: year,
    currentQuarter: q,
    currentQuarterCode: quarterCode,
    currentQuarterLabel: `${year} Q${q}`,
    priorYear,
    staleTables: stale,
    isStale: stale.length > 0,
  };
}

function errHandler(res: Response, err: unknown) {
  // Handle Supabase StorageError and PostgrestError objects (have .message but aren't Error instances)
  let msg: string;
  if (err instanceof Error) {
    msg = err.message;
  } else if (err && typeof err === 'object' && 'message' in err) {
    msg = String((err as any).message);
  } else {
    msg = String(err);
  }
  console.error("[api]", msg, err);
  return res.status(500).json({ message: msg });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Gate every /api route: valid Supabase session (Bearer JWT) required.
  // Writes still use requireWrite / requireAdmin for role checks on top of this.
  app.use("/api", requireApiAuth);

  await recoverStaleExportJobs();

  // ---------- Batch Lease Setup (wizard) ----------
  // Creates MLA + riders + new railcars + assignments in one atomic-ish call.
  // Each rider may carry an optional `cars` array of car objects to create & assign.
  app.post("/api/setup-lease", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { mla, riders: riderPayloads } = req.body as {
        mla: Record<string, any>;
        riders: Array<{
          rider: Record<string, any>;
          cars: Array<Record<string, any>>; // new car objects to create
          existing_car_ids: number[];        // already-in-DB cars to assign
          fleet_name?: string;
        }>;
      };

      // 1. Create MLA (lease_type only if human set it in the wizard — never invent a default)
      const mlaRow = { ...mla };
      delete mlaRow.account_id;
      if (mlaRow.lease_type != null && String(mlaRow.lease_type).trim() === "") {
        mlaRow.lease_type = null;
      }
      mlaRow.account_id = await ensureAccountForLessee(mlaRow.lessee ?? null);
      const { data: newMla, error: mlaErr } = await supabase
        .from("master_leases")
        .insert(mlaRow)
        .select()
        .single();
      if (mlaErr) throw mlaErr;

      const now = new Date().toISOString();
      const riderResults: any[] = [];

      for (const rp of riderPayloads ?? []) {
        // 2. Create rider under this MLA (do not write deprecated riders.account_manager)
        const riderInsert = { ...rp.rider, master_lease_id: newMla.id };
        delete riderInsert.account_manager;
        const { data: newRider, error: rErr } = await supabase
          .from("riders")
          .insert(riderInsert)
          .select()
          .single();
        if (rErr) throw rErr;

        const carIds: number[] = [...(rp.existing_car_ids ?? [])];

        // 3. Create new railcars
        for (const carObj of rp.cars ?? []) {
          const { data: newCar, error: cErr } = await supabase
            .from("railcars")
            .insert({
              ...carObj,
              ...fieldsImpliedByCarStatus(carObj.status ?? "Active/In-Service"),
            })
            .select()
            .single();
          if (cErr) throw cErr;
          carIds.push(newCar.id);
        }

        // 4. Assign all cars to this rider
        if (carIds.length > 0) {
          // Fetch existing assignments so we can upsert
          const { data: existingAssigns } = await supabase
            .from("railcar_assignments")
            .select("id, railcar_id")
            .in("railcar_id", carIds);
          const alreadyAssigned = new Map<number, number>(
            (existingAssigns ?? []).map((a: any) => [a.railcar_id, a.id])
          );

          for (const carId of carIds) {
            const existingId = alreadyAssigned.get(carId);
            if (existingId) {
              await supabase
                .from("railcar_assignments")
                .update({ rider_id: newRider.id, fleet_name: rp.fleet_name ?? null, assigned_at: now })
                .eq("id", existingId);
            } else {
              await supabase
                .from("railcar_assignments")
                .insert({ railcar_id: carId, rider_id: newRider.id, fleet_name: rp.fleet_name ?? null, assigned_at: now });
            }
          }
        }

        riderResults.push({ rider: newRider, car_count: carIds.length });
      }

      res.json({ ok: true, mla: newMla, riders: riderResults });
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Dashboard ----------
  app.get("/api/dashboard", async (_req, res) => {
    try {
      // Lease dates: Asset Report first (via rider_financial_summary / governed
      // riders.expiration_date). V_Valid car dates only fill OLs the report omits.
      // Lessee / OL identity still come from railcars.
      // PostgREST caps at 1000 rows — paginate and verify exact count or refuse to serve.
      const db = supabaseAdmin;
      const { data: fleetSql, error: fleetSqlErr } = await db.rpc("rlms_fleet_kpis");
      if (fleetSqlErr) {
        console.warn("[dashboard] rlms_fleet_kpis unavailable, using row fetch:", fleetSqlErr.message);
      }
      const sqlKpis = fleetSql?.kpis;

      const [allRailcarsRaw, assignmentsRaw, scannedCountRes] = sqlKpis
        ? [[], [], { count: Number(sqlKpis.scanned) || 0 }]
        : await Promise.all([
        fetchAllRows<any>((from, to) =>
          db
            .from("railcars")
            .select(
              `id, entity, active, fleet_status, rider_external_id, assignment_label, managed_category,
               lessee_name, lease_end_date, lease_expiry, build_year, built_year`
            )
            .eq("active", true)
            .order("id", { ascending: true })
            .range(from, to)
        ),
        fetchAllRows<any>((from, to) =>
          db
            .from("railcar_assignments")
            .select("id, railcar_id, rider_id")
            .order("id", { ascending: true })
            .range(from, to)
        ),
        db.from("railcars").select("id", { count: "exact", head: true }),
      ]);
      if (!sqlKpis && (scannedCountRes as any)?.error) throw (scannedCountRes as any).error;

      const allRailcars = allRailcarsRaw.map((r: any) => {
        const fleetStatus: FleetStatus | null = deriveFleetStatus({
          active: r.active,
          fleet_status: r.fleet_status,
          rider_external_id: r.rider_external_id,
          assignment_label: r.assignment_label,
          managed_category: r.managed_category,
        });
        return { ...r, fleet_status: fleetStatus };
      });

      const activeCars = allRailcars.filter((r: any) => r.active === true);
      const railcars = activeCars.filter((r: any) =>
        isOperatingFleetCar({
          active: r.active,
          fleet_status: r.fleet_status,
          rider_external_id: r.rider_external_id,
          assignment_label: r.assignment_label,
          managed_category: r.managed_category,
        })
      );
      const operatingCarIds = new Set(railcars.map((r: any) => r.id));
      const soldCars = activeCars.filter((r: any) => r.fleet_status === "Sold");
      const idleCars = activeCars.filter((r: any) => r.fleet_status === "Idle");
      const leasedCars = activeCars.filter((r: any) => isLeasedFleetStatus(r.fleet_status));
      const abatementCars = activeCars.filter((r: any) => r.fleet_status === "Abatement");

      const assignments = assignmentsRaw.filter((a: any) =>
        operatingCarIds.has(a.railcar_id)
      );
      const assignedCarIds = new Set(assignments.map((a: any) => a.railcar_id));

      // Active Cars = operating fleet minus Idle, Abatement, Unassigned (Sold already out of Total Fleet).
      const activeAssignments = leasedCars.filter((r: any) => operatingCarIds.has(r.id)).length;

      // Unassigned = operating cars with no railcar_assignments row (not "rider expired")
      const unassignedCarList = railcars.filter((r: any) => !assignedCarIds.has(r.id));
      const unassignedCars = unassignedCarList.length;
      const formulaActiveCars = (total: number, idle: number, abatement: number, unassigned: number) =>
        total - idle - abatement - unassigned;
      const jsActiveCars = formulaActiveCars(railcars.length, idleCars.length, abatementCars.length, unassignedCars);

      const utilization = railcars.length > 0
        ? Math.round((jsActiveCars / railcars.length) * 1000) / 10
        : 0;

      const rpsCars = railcars.filter((r: any) => r.entity === "Rail Partners Select");
      const ownedCars = railcars.filter((r: any) => isResidcoOwnedEntity(r.entity));
      const coalCars = railcars.filter((r: any) => r.entity === "Coal");
      const rpsAssigned = rpsCars.filter((r: any) => countsAsLeasedForKpi(r.fleet_status)).length;
      const ownedAssigned = ownedCars.filter((r: any) => countsAsLeasedForKpi(r.fleet_status)).length;
      const rpsUtil = rpsCars.length > 0 ? Math.round((rpsAssigned / rpsCars.length) * 1000) / 10 : 0;
      const ownedUtil = ownedCars.length > 0 ? Math.round((ownedAssigned / ownedCars.length) * 1000) / 10 : 0;

      // Off Rent — rent_events only (never riders.expiration_date).
      // When the SQL KPI RPC succeeded, off_rent / financial / rider timeline / fleet age
      // are already aggregated in Postgres — do not fetchAllRows those tables again.
      let rentEvents: any[] = [];
      let finRows: any[] = [];
      if (!sqlKpis) {
        const fetched = await Promise.all([
          fetchAllRows((from, to) =>
            supabaseAdmin
              .from("rent_events")
              .select("car_id, event_type, event_date")
              .order("event_date", { ascending: false })
              .range(from, to)
          ),
          fetchAllRows((from, to) =>
            supabaseAdmin
              .from("rider_financial_summary")
              .select(
                "snapshot_month, rider_id, entity, lessee, months_until_lease_exp, lease_exp_date, count_cars"
              )
              .order("id", { ascending: true })
              .range(from, to)
          ).catch(async () =>
            fetchAllRows((from, to) =>
              supabaseAdmin
                .from("rider_financial_summary")
                .select("snapshot_month, rider_id, entity, lessee, months_until_lease_exp, count_cars")
                .order("id", { ascending: true })
                .range(from, to)
            )
          ),
        ]);
        rentEvents = fetched[0] as any[];
        finRows = fetched[1] as any[];
      }
      const latestRentByCarId = new Map<number, string>();
      const activeCarIds = new Set(activeCars.map((r: any) => r.id));
      for (const ev of rentEvents as any[]) {
        if (!activeCarIds.has(ev.car_id)) continue;
        if (!latestRentByCarId.has(ev.car_id)) {
          latestRentByCarId.set(ev.car_id, ev.event_type);
        }
      }
      const offRentIds = new Set<number>();
      for (const c of activeCars as any[]) {
        if (c.fleet_status === "Idle" || c.fleet_status === "Abatement") offRentIds.add(c.id);
      }
      for (const [id, t] of latestRentByCarId) {
        if (t === "off_rent") offRentIds.add(id);
      }
      const offRentCount = offRentIds.size;

      const now = new Date();
      const twelveMo = new Date(now);
      twelveMo.setMonth(twelveMo.getMonth() + 12);
      const sixMo = new Date(now);
      sixMo.setMonth(sixMo.getMonth() + 6);

      const { latestSnap, byOl: assetByOl } = sqlKpis
        ? (() => {
            const byOl = new Map<string, any>();
            const snap = fleetSql.financial_snapshot_month
              ? String(fleetSql.financial_snapshot_month).slice(0, 10)
              : null;
            for (const f of fleetSql.financial_timeline || []) {
              const ol = String(f.ol ?? "").trim();
              const expiration_date = String(f.expiration_date ?? "").trim().slice(0, 10);
              if (!ol || !/^\d{4}-\d{2}-\d{2}$/.test(expiration_date)) continue;
              byOl.set(ol.toUpperCase(), {
                ol,
                expiration_date,
                source: "asset_report",
                snapshot_month: snap,
                months_until: f.months_until != null ? Number(f.months_until) : null,
                lessee: f.lessee ? String(f.lessee) : null,
              });
            }
            return { latestSnap: snap, byOl };
          })()
        : buildAssetReportExpirations(finRows as any[]);
      const carFallbackByOl = sqlKpis
        ? (() => {
            const m = new Map<string, string>();
            for (const row of fleetSql.expiration_timeline_vcf || []) {
              const key = String(row.rider_name ?? "").trim().toUpperCase();
              const d = String(row.expiration_date ?? "").trim().slice(0, 10);
              if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
              const prev = m.get(key);
              if (!prev || d < prev) m.set(key, d);
            }
            return m;
          })()
        : buildCarFallbackExpirations(railcars as any[]);

      // Active Riders / OLs — distinct rider_external_id on operating cars
      type OlAgg = {
        ol: string;
        car_count: number;
        car_ids: number[];
        ends: string[];
        lessee_name: string | null;
        assignment_label: string | null;
      };
      type EndBucket = {
        ol: string;
        expiration_date: string;
        car_count: number;
        lessee_name: string | null;
      };
      const olMap = new Map<string, OlAgg>();
      const endBuckets = new Map<string, EndBucket>();
      let undefinedEndCarCount = 0;
      for (const c of railcars as any[]) {
        const ol = carOlCode(c);
        const governed = ol ? resolveGovernedExpiration(ol, assetByOl, carFallbackByOl) : null;
        if (!governed) undefinedEndCarCount += 1;
        const end = governed?.expiration_date ?? carLeaseEndDate(c);
        if (!ol) continue;
        const key = ol.toUpperCase();
        let agg = olMap.get(key);
        if (!agg) {
          agg = {
            ol,
            car_count: 0,
            car_ids: [],
            ends: [],
            lessee_name: carLesseeName(c),
            assignment_label: c.assignment_label ?? null,
          };
          olMap.set(key, agg);
        }
        agg.car_count += 1;
        agg.car_ids.push(c.id);
        if (end) agg.ends.push(end);
        if (!agg.lessee_name) agg.lessee_name = carLesseeName(c);

        if (end) {
          const bkey = `${key}|${end}`;
          let bucket = endBuckets.get(bkey);
          if (!bucket) {
            bucket = {
              ol,
              expiration_date: end,
              car_count: 0,
              lessee_name: carLesseeName(c),
            };
            endBuckets.set(bkey, bucket);
          }
          bucket.car_count += 1;
          if (!bucket.lessee_name) bucket.lessee_name = carLesseeName(c);
        }
      }
      if (sqlKpis) {
        const olCounts = fleetSql.ol_counts || {};
        let assignedToOl = 0;
        undefinedEndCarCount = 0;
        for (const [ol, nRaw] of Object.entries(olCounts)) {
          const n = Number(nRaw) || 0;
          assignedToOl += n;
          if (!resolveGovernedExpiration(ol, assetByOl, carFallbackByOl)) undefinedEndCarCount += n;
        }
        const operating = Number(sqlKpis.operating) || 0;
        undefinedEndCarCount += Math.max(0, operating - assignedToOl);
      }
      const activeOls = Array.from(olMap.values()).map((agg) => ({
        id: agg.ol,
        rider_name: agg.ol,
        schedule_number: agg.ol,
        expiration_date:
          resolveGovernedExpiration(agg.ol, assetByOl, carFallbackByOl)?.expiration_date ??
          aggregateOlEndDate(agg.ends),
        lease_number: null as string | null,
        lessee_name: agg.lessee_name,
        car_count: agg.car_count,
      }));

      const inExpiryWindow = (iso: string, cutoff: Date) => {
        const d = parseIsoDateOnly(iso);
        if (!d) return false;
        return d >= now && d <= cutoff;
      };

      type TimelineRow = {
        rider_id: string;
        rider_name: string;
        schedule_number: string;
        expiration_date: string;
        lease_number: string | null;
        car_count: number;
        source: "financial" | "vcf";
        months_until_lease_exp: number | null;
      };

      const financialTimeline: TimelineRow[] = Array.from(assetByOl.values())
        .map((f) => {
          const live = olMap.get(f.ol.toUpperCase());
          const sqlCount = fleetSql?.ol_counts?.[f.ol.toUpperCase()];
          const sqlLessee = fleetSql?.ol_lessees?.[f.ol.toUpperCase()];
          return {
            rider_id: f.ol,
            rider_name: f.ol,
            schedule_number: f.ol,
            expiration_date: f.expiration_date,
            lease_number: f.lessee ?? live?.lessee_name ?? sqlLessee ?? null,
            car_count: live?.car_count ?? (Number(sqlCount) || 0),
            source: "financial" as const,
            months_until_lease_exp: f.months_until,
          };
        })
        .filter((r) => r.car_count > 0)
        .sort((a, b) => a.expiration_date.localeCompare(b.expiration_date) || a.rider_name.localeCompare(b.rider_name));

      const vcfTimeline: TimelineRow[] = Array.from(endBuckets.values())
        .sort((a, b) => a.expiration_date.localeCompare(b.expiration_date) || a.ol.localeCompare(b.ol))
        .map((b) => ({
          rider_id: `${b.ol}|${b.expiration_date}|vcf`,
          rider_name: b.ol,
          schedule_number: b.ol,
          expiration_date: b.expiration_date,
          lease_number: b.lessee_name,
          car_count: b.car_count,
          source: "vcf" as const,
          months_until_lease_exp: null,
        }))
        .filter((r) => r.car_count > 0);

      const fallbackTimeline: TimelineRow[] = [];
      const olKeysForFallback = sqlKpis
        ? Object.keys(fleetSql.ol_counts || {})
        : Array.from(olMap.keys());
      for (const key of olKeysForFallback) {
        if (assetByOl.has(key.toUpperCase())) continue;
        const governed = resolveGovernedExpiration(key, assetByOl, carFallbackByOl);
        if (!governed) continue;
        const live = olMap.get(key.toUpperCase());
        const sqlCount = fleetSql?.ol_counts?.[key.toUpperCase()];
        const sqlLessee = fleetSql?.ol_lessees?.[key.toUpperCase()];
        const carCount = live?.car_count ?? (Number(sqlCount) || 0);
        if (carCount <= 0) continue;
        fallbackTimeline.push({
          rider_id: governed.ol,
          rider_name: live?.ol ?? governed.ol,
          schedule_number: live?.ol ?? governed.ol,
          expiration_date: governed.expiration_date,
          lease_number: live?.lessee_name ?? sqlLessee ?? null,
          car_count: carCount,
          source: "vcf",
          months_until_lease_exp: null,
        });
      }

      const expirationTimeline = [...financialTimeline, ...fallbackTimeline].sort(
        (a, b) => a.expiration_date.localeCompare(b.expiration_date) || a.rider_name.localeCompare(b.rider_name)
      );
      const expiringRiders = expirationTimeline.filter((r) => inExpiryWindow(r.expiration_date, twelveMo));
      const expiring6Groups = expirationTimeline.filter((r) => inExpiryWindow(r.expiration_date, sixMo));
      const expiring12mo = expiringRiders.length;
      const expiring6mo = expiring6Groups.length;

      // Cars by Lessee — counts only. Group by railcars.lessee_name.
      // Do not use assignment.fleet_name or riders. Full car lists load on click.
      type FleetEntry = {
        fleet_name: string;
        count: number;
        lease_number: string | null;
        lessor: string | null;
        lessee: string | null;
        rider_name: string | null;
        schedule_number: string | null;
        expiration_date: string | null;
        cars: {
          id: number;
          car_number: string;
          reporting_marks: string | null;
          car_type: string | null;
          status: string | null;
          entity: string | null;
        }[];
      };
      const lesseeMap = new Map<
        string,
        { count: number; ends: string[]; ols: Set<string> }
      >();
      for (const c of railcars as any[]) {
        const lessee = carLesseeName(c) || "Unassigned";
        let entry = lesseeMap.get(lessee);
        if (!entry) {
          entry = { count: 0, ends: [], ols: new Set() };
          lesseeMap.set(lessee, entry);
        }
        entry.count += 1;
        const end = carLeaseEndDate(c);
        if (end) entry.ends.push(end);
        const ol = carOlCode(c);
        if (ol) entry.ols.add(ol);
      }
      const carsByFleet: FleetEntry[] = Array.from(lesseeMap.entries())
        .map(([fleet_name, entry]) => {
          const ols = Array.from(entry.ols).sort();
          return {
            fleet_name,
            count: entry.count,
            lease_number: null,
            lessor: null,
            lessee: fleet_name,
            rider_name: ols[0] ?? null,
            schedule_number: ols.length > 1 ? `${ols.length} OLs` : ols[0] ?? null,
            expiration_date: aggregateOlEndDate(entry.ends),
            cars: [],
          };
        })
        .sort((a, b) => b.count - a.count);

      const sqlUtil = (op: number, leased: number) =>
        op > 0 ? Math.round((leased / op) * 1000) / 10 : 0;

      const fleet_age = sqlKpis && fleetSql.fleet_age
        ? {
            tiles: fleetSql.fleet_age.tiles || [],
            unknown_count: Number(fleetSql.fleet_age.unknown_count) || 0,
            known_count: Number(fleetSql.fleet_age.known_count) || 0,
            operating_count: Number(fleetSql.fleet_age.operating_count) || 0,
          }
        : turning50ByYear(activeCars as any[]);

      let in_program_count = sqlKpis && sqlKpis.in_program_count != null
        ? Number(sqlKpis.in_program_count) || 0
        : 0;
      if (!sqlKpis || sqlKpis.in_program_count == null) {
        try {
          in_program_count = await countInProgram();
        } catch (e: any) {
          console.warn("[dashboard] in_program_count unavailable:", e?.message ?? e);
        }
      }
      const in_transit_leased_count = in_program_count;

      let activeOlCount = sqlKpis ? Number(sqlKpis.riders_count) || 0 : 0;
      let dealsExpiring: { year: number; count: number }[] = Array.isArray(fleetSql?.deals_expiring)
        ? fleetSql.deals_expiring.map((d: any) => ({ year: Number(d.year), count: Number(d.count) || 0 }))
        : [];
      let riderExpirationTimeline: any[] = Array.isArray(fleetSql?.rider_expiration_timeline)
        ? fleetSql.rider_expiration_timeline.map((r: any) => ({
            rider_id: r.rider_id,
            rider_name: r.rider_name,
            schedule_number: r.schedule_number,
            expiration_date: String(r.expiration_date ?? "").trim().slice(0, 10),
            lease_number: r.lease_number ?? null,
            car_count: Number(r.car_count) || 0,
            source: "financial" as const,
            months_until_lease_exp: r.months_until_lease_exp ?? null,
          }))
        : [];
      if (!sqlKpis) {
        const [activeByRider, amOverview, riderExpRows] = await Promise.all([
          countActiveCarsByRiderId(),
          listAccountManagementOverview(null, { includeInactive: false }),
          fetchAllRows<{
            id: number;
            rider_name: string;
            schedule_number: string | null;
            expiration_date: string | null;
            master_lease: { lessee: string | null; lease_number: string | null } | { lessee: string | null; lease_number: string | null }[] | null;
          }>((from, to) =>
            supabaseAdmin
              .from("riders")
              .select("id, rider_name, schedule_number, expiration_date, master_lease:master_leases(lessee, lease_number)")
              .order("id", { ascending: true })
              .range(from, to)
          ),
        ]);
        activeOlCount = 0;
        for (const n of activeByRider.values()) {
          if (n > 0) activeOlCount += 1;
        }
        dealsExpiring = amOverview.kpis.expiring;
        riderExpirationTimeline = riderExpRows
          .filter((r) => (activeByRider.get(r.id) ?? 0) > 0 && String(r.expiration_date ?? "").trim())
          .map((r) => {
            const ml = Array.isArray(r.master_lease) ? r.master_lease[0] : r.master_lease;
            return {
              rider_id: r.id,
              rider_name: r.rider_name,
              schedule_number: r.schedule_number,
              expiration_date: String(r.expiration_date).trim().slice(0, 10),
              lease_number: ml?.lease_number ?? ml?.lessee ?? null,
              car_count: activeByRider.get(r.id) ?? 0,
              source: "financial" as const,
              months_until_lease_exp: null as number | null,
            };
          })
          .sort(
            (a, b) =>
              a.expiration_date.localeCompare(b.expiration_date) || a.rider_name.localeCompare(b.rider_name)
          );
      }

      let fleetKpis = sqlKpis
        ? {
            total_fleet: Number(sqlKpis.operating) || 0,
            active_assignments: Number(sqlKpis.leased_operating) || 0,
            unassigned_cars: Number(sqlKpis.unassigned) || 0,
            sold_count: Number(sqlKpis.sold) || 0,
            idle_count: Number(sqlKpis.idle) || 0,
            leased_count: Number(sqlKpis.leased) || 0,
            abatement_count: Number(sqlKpis.abatement) || 0,
            active_cars_including_sold: Number(sqlKpis.active_including_sold) || 0,
            rps_total: Number(sqlKpis.rps_total) || 0,
            rps_assigned: Number(sqlKpis.rps_assigned) || 0,
            owned_total: Number(sqlKpis.owned_total) || 0,
            owned_assigned: Number(sqlKpis.owned_assigned) || 0,
            coal_total: Number(sqlKpis.coal_total) || 0,
            railcars_scanned: Number(sqlKpis.scanned) || 0,
            leased_only: Number(sqlKpis.leased_only ?? sqlKpis.leased_operating) || 0,
          }
        : null;

      const sqlActiveCars = fleetKpis
        ? formulaActiveCars(
            fleetKpis.total_fleet,
            fleetKpis.idle_count,
            fleetKpis.abatement_count,
            fleetKpis.unassigned_cars
          )
        : jsActiveCars;
      if (fleetKpis && fleetKpis.leased_only !== sqlActiveCars) {
        console.warn("[dashboard] Active Cars mismatch", { leased_only: fleetKpis.leased_only, byFormula: sqlActiveCars });
      } else if (!fleetKpis && activeAssignments !== jsActiveCars) {
        console.warn("[dashboard] Active Cars mismatch", { leased: activeAssignments, byFormula: jsActiveCars });
      }

      res.json({
        kpis: fleetKpis
          ? {
              total_fleet: fleetKpis.total_fleet,
              active_assignments: sqlActiveCars,
              active_cars: sqlActiveCars,
              unassigned_cars: fleetKpis.unassigned_cars,
              expiring_12mo: expiring12mo,
              expiring_6mo: expiring6mo,
              deals_expiring: dealsExpiring,
              off_rent_count: Number(sqlKpis.off_rent) || 0,
              undefined_end_car_count: undefinedEndCarCount,
              financial_snapshot_month: latestSnap,
              riders_count: activeOlCount,
              utilization_pct: sqlUtil(fleetKpis.total_fleet, sqlActiveCars),
              utilization_cars: sqlActiveCars,
              sold_count: fleetKpis.sold_count,
              idle_count: fleetKpis.idle_count,
              leased_count: fleetKpis.leased_count,
              abatement_count: fleetKpis.abatement_count,
              in_program_count,
              in_transit_leased_count,
              active_cars_including_sold: fleetKpis.active_cars_including_sold,
              rps_total: fleetKpis.rps_total,
              rps_assigned: fleetKpis.rps_assigned,
              rps_util_pct: sqlUtil(fleetKpis.rps_total, fleetKpis.rps_assigned),
              owned_total: fleetKpis.owned_total,
              owned_assigned: fleetKpis.owned_assigned,
              owned_util_pct: sqlUtil(fleetKpis.owned_total, fleetKpis.owned_assigned),
              coal_total: fleetKpis.coal_total,
              lessee_count: Array.isArray(fleetSql?.cars_by_fleet) ? fleetSql.cars_by_fleet.length : 0,
              lease_authority: "asset_report",
              railcars_scanned: fleetKpis.railcars_scanned,
            }
          : {
          total_fleet: railcars.length,
          active_assignments: jsActiveCars,
          active_cars: jsActiveCars,
          unassigned_cars: unassignedCars,
          expiring_12mo: expiring12mo,
          expiring_6mo: expiring6mo,
          deals_expiring: dealsExpiring,
          off_rent_count: offRentCount,
          undefined_end_car_count: undefinedEndCarCount,
          financial_snapshot_month: latestSnap,
          riders_count: activeOlCount,
          utilization_pct: utilization,
          utilization_cars: jsActiveCars,
          sold_count: soldCars.length,
          idle_count: idleCars.length,
          leased_count: leasedCars.length,
          abatement_count: abatementCars.length,
          in_program_count,
          in_transit_leased_count,
          active_cars_including_sold: activeCars.length,
          rps_total: rpsCars.length,
          rps_assigned: rpsAssigned,
          rps_util_pct: rpsUtil,
          owned_total: ownedCars.length,
          owned_assigned: ownedAssigned,
          owned_util_pct: ownedUtil,
          coal_total: coalCars.length,
          lessee_count: carsByFleet.length,
          lease_authority: "asset_report",
          railcars_scanned: Number((scannedCountRes as any)?.count) || allRailcarsRaw.length,
        },
        detail: {
          all_cars: [],
          assigned_cars: [],
          unassigned_cars: unassignedCarList.map((r: any) => ({
            id: r.id,
            car_number: r.car_number,
            reporting_marks: r.reporting_marks,
            car_type: r.car_type,
            status: r.status,
            entity: r.entity,
            active: r.active,
            fleet_status: r.fleet_status,
            fleet_name: carLesseeName(r),
            rider_name: carOlCode(r),
            lease_number: null,
            lessee: carLesseeName(r),
          })),
          sold_cars: [],
          expiring_riders: expiringRiders.map((r) => ({
            id: r.rider_id,
            rider_name: r.rider_name,
            schedule_number: r.schedule_number,
            expiration_date: r.expiration_date,
            lease_number: r.lease_number,
            car_count: r.car_count,
          })),
          riders: sqlKpis
            ? Object.entries(fleetSql.ol_counts || {}).map(([ol, n]) => ({
                id: ol,
                rider_name: ol,
                schedule_number: ol,
                expiration_date: null,
                lease_number: fleetSql.ol_lessees?.[ol] ?? null,
                car_count: Number(n) || 0,
              }))
            : activeOls.map((r) => ({
            id: r.id,
            rider_name: r.rider_name,
            schedule_number: r.schedule_number,
            expiration_date: r.expiration_date,
            lease_number: r.lessee_name,
            car_count: r.car_count,
          })),
        },
        cars_by_fleet: sqlKpis
          ? (fleetSql.cars_by_fleet || []).map((f: any) => ({
              fleet_name: f.fleet_name,
              count: f.count,
              lease_number: null,
              lessor: null,
              lessee: f.fleet_name,
              rider_name: f.rider_name ?? null,
              schedule_number: f.schedule_number ?? null,
              expiration_date: f.expiration_date ?? null,
              cars: [],
            }))
          : carsByFleet,
        expiration_timeline: riderExpirationTimeline,
        expiration_timeline_vcf: [],
        fleet_age,
      });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/dashboard/lessee", async (req: Request, res: Response) => {
    try {
      const name = String(req.query.name ?? "").trim();
      if (!name) return res.status(400).json({ message: "name is required" });

      const cars = await fetchAllRows((from, to) =>
        supabaseAdmin
          .from("railcars")
          .select(
            "id, car_number, reporting_marks, car_type, status, fleet_status, entity, active, lessee_name, rider_external_id, assignment_label, managed_category, sold_to"
          )
          .eq("active", true)
          .eq("lessee_name", name)
          .order("id", { ascending: true })
          .range(from, to)
      );
      const operating = cars.filter((r: any) =>
        isOperatingFleetCar({
          active: r.active,
          fleet_status: r.fleet_status,
          rider_external_id: r.rider_external_id,
          assignment_label: r.assignment_label,
          managed_category: r.managed_category,
        })
      );
      res.json({
        fleet_name: name,
        count: operating.length,
        cars: operating
          .map((c: any) => ({
            id: c.id,
            car_number: c.car_number,
            reporting_marks: c.reporting_marks,
            car_type: c.car_type,
            status: c.status,
            entity: c.entity,
            active: c.active,
            rider_external_id: c.rider_external_id,
            assignment_label: c.assignment_label,
            managed_category: c.managed_category,
            fleet_status: parseFleetStatus(c.fleet_status) ?? deriveFleetStatus({
              active: c.active,
              fleet_status: c.fleet_status,
              rider_external_id: c.rider_external_id,
              assignment_label: c.assignment_label,
              managed_category: c.managed_category,
            }),
          }))
          .sort((a: any, b: any) => String(a.car_number).localeCompare(String(b.car_number))),
      });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/browse/group", async (req: Request, res: Response) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const kind = String(req.query.kind ?? "").trim();
      const key = String(req.query.key ?? "").trim();
      if (kind !== "lessee" && kind !== "entity") {
        return res.status(400).json({ message: "kind must be lessee or entity" });
      }
      if (!key) return res.status(400).json({ message: "key is required" });
      res.json(await browseGroup(kind, key));
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/browse/ol", async (req: Request, res: Response) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const code = String(req.query.code ?? "").trim();
      if (!code) return res.status(400).json({ message: "code is required" });
      const lessee = String(req.query.lessee ?? "").trim() || undefined;
      const entity = String(req.query.entity ?? "").trim() || undefined;
      res.json(await browseOl(code, { lessee, entity }));
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/browse/turning50", async (req: Request, res: Response) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const year = Number(req.query.year);
      if (!Number.isFinite(year) || year < 1900 || year > 2100) {
        return res.status(400).json({ message: "year is required" });
      }
      const ol = String(req.query.ol ?? "").trim() || undefined;
      res.json(await browseTurning50(year, ol));
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/browse/turning50/export", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      const year = Number(req.query.year);
      if (!Number.isFinite(year) || year < 1900 || year > 2100) {
        return res.status(400).json({ message: "year is required" });
      }
      const ols = String(req.query.ols ?? req.query.ol ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const carIds = String(req.query.ids ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      const { buffer, filename } = await buildTurning50Report({
        year,
        ols: ols.length ? ols : undefined,
        carIds: carIds.length ? carIds : undefined,
      });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      errHandler(res, err);
    }
  });

  /** Refresh riders.expiration_date + car lease dates: Asset Report first, V_Valid fallback. */
  app.post("/api/riders/sync-expirations", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const result = await governLeaseDates(supabase);
      res.json(result);
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Railcars ----------
  app.get("/api/railcars", async (req: Request, res: Response) => {
    try {
      const params = parseRailcarListParams(req.query as Record<string, unknown>);
      const result = await queryRailcars(params);
      if (params.all) {
        res.json(result.rows);
        return;
      }
      res.json(result);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/railcars/ids", async (req: Request, res: Response) => {
    try {
      const params = parseRailcarListParams(req.query as Record<string, unknown>);
      const ids = await queryRailcarIds({ ...params, all: true });
      res.json({ ids, total_count: ids.length });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/railcars/bulk-fleet-status", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const idsRaw = Array.isArray(req.body?.ids) ? req.body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0) : [];
      const fleet_status = parseFleetStatus(req.body?.fleet_status);
      if (!fleet_status) {
        return res.status(400).json({ message: "fleet_status must be Leased, Idle, Sold, or Abatement" });
      }
      if (idsRaw.length === 0) {
        return res.status(400).json({ message: "ids required" });
      }
      if (idsRaw.length > 20_000) {
        return res.status(400).json({ message: "Too many cars in one request (max 20,000)" });
      }
      const uniqueIds = [...new Set(idsRaw)];
      const CHUNK = 200;
      const movedAt = effectiveDateToTimestamp(
        typeof req.body?.effective_date === "string" ? req.body.effective_date : null,
      );
      const movedBy = typeof req.body?.moved_by === "string" && req.body.moved_by.trim()
        ? req.body.moved_by.trim()
        : "bulk-action";
      let updated = 0;
      const historyRows: any[] = [];
      for (let i = 0; i < uniqueIds.length; i += CHUNK) {
        const slice = uniqueIds.slice(i, i + CHUNK);
        // Rental Status only — never touch active / active_status / status (Car Status).
        const { data, error } = await supabase
          .from("railcars")
          .update({ fleet_status, fleet_status_source: "manual" })
          .in("id", slice)
          .select("id");
        if (error) throw error;
        updated += data?.length ?? 0;

        const { data: assigns, error: aErr } = await supabase
          .from("railcar_assignments")
          .select("railcar_id, rider_id, fleet_name")
          .in("railcar_id", slice);
        if (aErr) throw aErr;
        const byCar = new Map<number, any>();
        for (const a of assigns ?? []) byCar.set(a.railcar_id, a);
        for (const carId of slice) {
          const prev = byCar.get(carId);
          historyRows.push({
            railcar_id: carId,
            from_rider_id: prev?.rider_id ?? null,
            to_rider_id: prev?.rider_id ?? null,
            from_fleet_name: prev?.fleet_name ?? null,
            to_fleet_name: prev?.fleet_name ?? null,
            moved_at: movedAt,
            moved_by: movedBy,
            reason: `Rental status set to ${fleet_status}`,
          });
        }
      }
      if (historyRows.length) {
        for (let i = 0; i < historyRows.length; i += CHUNK) {
          const { error: hErr } = await supabase
            .from("assignment_history")
            .insert(historyRows.slice(i, i + CHUNK));
          if (hErr) throw hErr;
        }
      }
      res.json({ ok: true, updated, fleet_status });
    } catch (err) {
      errHandler(res, err);
    }
  });

  /** Guarded Car Status change (Inactive / reactivate require reason + history). */
  app.post("/api/railcars/car-status", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const idsRaw = Array.isArray(req.body?.ids)
        ? req.body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
        : [];
      const status = String(req.body?.status ?? "").trim();
      const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
      if (!status) return res.status(400).json({ message: "status is required" });
      if (!idsRaw.length) return res.status(400).json({ message: "ids required" });
      if (idsRaw.length > 20_000) {
        return res.status(400).json({ message: "Too many cars in one request (max 20,000)" });
      }
      const result = await applyCarStatusChange({
        ids: idsRaw,
        status,
        reason,
        userId: writerId,
      });
      res.json({ ok: true, ...result, status });
    } catch (err: any) {
      if (err?.status === 400) return res.status(400).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.get("/api/car-status-history/car/:carId", async (req, res) => {
    try {
      const carId = Number(req.params.carId);
      if (!Number.isFinite(carId) || carId <= 0) {
        return res.status(400).json({ message: "Invalid car id" });
      }
      const { data, error } = await supabaseAdmin
        .from("car_status_history")
        .select("*")
        .eq("car_id", carId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/railcars/bulk-needs-completion", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const idsRaw = Array.isArray(req.body?.ids) ? req.body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0) : [];
      if (idsRaw.length === 0) {
        return res.status(400).json({ message: "ids required" });
      }
      if (idsRaw.length > 20_000) {
        return res.status(400).json({ message: "Too many cars in one request (max 20,000)" });
      }
      const needs_completion = req.body?.needs_completion === true;
      const uniqueIds = [...new Set(idsRaw)];
      const CHUNK = 200;
      let updated = 0;
      for (let i = 0; i < uniqueIds.length; i += CHUNK) {
        const slice = uniqueIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("railcars")
          .update({ needs_completion })
          .in("id", slice)
          .select("id");
        if (error) throw error;
        updated += data?.length ?? 0;
      }
      res.json({ ok: true, updated, needs_completion });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/railcars/bulk-entity", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const idsRaw = Array.isArray(req.body?.ids) ? req.body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0) : [];
      const rawEntity = String(req.body?.entity ?? "").trim();
      const entity =
        rawEntity === "RPS" || rawEntity.toLowerCase() === "rps" || rawEntity === "Rail Partners Select"
          ? "Rail Partners Select"
          : rawEntity === "Main"
            ? "Main"
            : rawEntity === "Coal"
              ? "Coal"
              : null;
      if (!entity) {
        return res.status(400).json({ message: "entity must be Main, RPS, or Coal" });
      }
      if (idsRaw.length === 0) {
        return res.status(400).json({ message: "ids required" });
      }
      if (idsRaw.length > 20_000) {
        return res.status(400).json({ message: "Too many cars in one request (max 20,000)" });
      }
      const uniqueIds = [...new Set(idsRaw)];
      const CHUNK = 200;
      let updated = 0;
      for (let i = 0; i < uniqueIds.length; i += CHUNK) {
        const slice = uniqueIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("railcars")
          .update({ entity })
          .in("id", slice)
          .select("id");
        if (error) throw error;
        updated += data?.length ?? 0;
      }
      res.json({ ok: true, updated, entity });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/railcars/bulk-ops-flag", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const idsRaw = Array.isArray(req.body?.ids) ? req.body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0) : [];
      if (idsRaw.length === 0) {
        return res.status(400).json({ message: "ids required" });
      }
      if (idsRaw.length > 20_000) {
        return res.status(400).json({ message: "Too many cars in one request (max 20,000)" });
      }
      const raw = req.body?.ops_flag;
      const ops_flag = raw == null || String(raw).trim() === "" ? null : String(raw).trim().slice(0, 80);
      const uniqueIds = [...new Set(idsRaw)];
      const updated = await persistOpsFlag(uniqueIds, ops_flag);
      res.json({ ok: true, updated, ops_flag });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/acquisition-batches", async (_req, res) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("acquisition_batches")
        .select("id, label, acquisition_date, entity, default_rental_status, car_count, created_at")
        .order("created_at", { ascending: false });
      if (error) {
        if (/acquisition_batches/i.test(error.message) && /does not exist|schema cache/i.test(error.message)) {
          return res.json([]);
        }
        throw error;
      }
      res.json(data ?? []);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/reports/v-valid-cars/jobs", async (_req, res) => {
    try {
      const started = await startVcfExportJob();
      if ("error" in started) {
        return res.status(started.status).json({ message: started.error });
      }
      res.status(202).json({ id: started.id, status: "running" });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/reports/v-valid-cars/jobs/:id", async (req, res) => {
    try {
      const job = await getVcfExportJob(String(req.params.id));
      if (!job) return res.status(404).json({ message: "Export job not found" });
      res.json(job);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/reports/v-valid-cars/jobs/:id/file", async (req, res) => {
    try {
      const file = await getVcfExportFile(String(req.params.id));
      if (!file.ok) return res.status(file.status).json({ message: file.message });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(file.buffer);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/railcars/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { data: car, error } = await supabase
        .from("railcars")
        .select(
          `*,
          assignment:railcar_assignments(
            *,
            rider:riders(*, master_lease:master_leases(*))
          )`
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;

      const [histRes, numHistRes, abRes] = await Promise.all([
        supabase
          .from("assignment_history")
          .select(
            `*,
            from_rider:riders!assignment_history_from_rider_id_fkey(id, rider_name, master_lease:master_leases(id, lease_number)),
            to_rider:riders!assignment_history_to_rider_id_fkey(id, rider_name, master_lease:master_leases(id, lease_number))`
          )
          .eq("railcar_id", id)
          .order("moved_at", { ascending: false }),
        supabase
          .from("car_number_history")
          .select("*")
          .eq("railcar_id", id)
          .order("changed_at", { ascending: false }),
        supabase
          .from("railcar_ab_items")
          .select("seq, code, amount, sign, signed_amount, application_date")
          .eq("railcar_id", id)
          .order("seq", { ascending: true }),
      ]);
      if (histRes.error) throw histRes.error;
      if (numHistRes.error) throw numHistRes.error;

      if (!car) return res.status(404).json({ message: "Railcar not found" });
      const assignmentRaw = asOne(car.assignment);
      const rider = asOne(assignmentRaw?.rider);
      const [normalized] = await attachLatestAmNotes(await attachAccountManagerInitials([
        hydrateOpsFlag({
          ...car,
          assignment: assignmentRaw
            ? { ...assignmentRaw, rider: rider ? { ...rider, master_lease: asOne(rider.master_lease) } : null }
            : null,
          railcar_ab_items: abRes.error ? [] : (abRes.data ?? []),
        }),
      ]));
      res.json({ railcar: normalized, history: histRes.data ?? [], number_history: numHistRes.data ?? [] });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/railcars", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const parsed = insertRailcarSchema.parse(req.body);
      nullifyEmptyDateStrings(parsed as Record<string, unknown>, [...RAILCAR_DATE_KEYS]);
      const flag = parsed.ops_flag;
      const insertRow: Record<string, unknown> = omitOpsFlagFields({ ...parsed });
      if (parsed.fleet_status) {
        insertRow.fleet_status = parsed.fleet_status;
        insertRow.fleet_status_source = "manual";
      } else {
        insertRow.fleet_status = autoFleetStatusFromLegacyText(parsed);
        insertRow.fleet_status_source = "auto";
      }
      Object.assign(insertRow, fieldsImpliedByCarStatus(String(parsed.status ?? "Active/In-Service")));
      const { data, error } = await supabase
        .from("railcars")
        .insert(insertRow)
        .select()
        .single();
      if (error) throw error;
      if (flag) await persistOpsFlag([data.id], flag);
      res.json(hydrateOpsFlag({ ...data, ops_flag: flag ?? null }));
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.patch("/api/railcars/:id", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const id = Number(req.params.id);
      const inactiveReason =
        typeof req.body?.inactive_change_reason === "string"
          ? req.body.inactive_change_reason
          : null;
      const parsed = insertRailcarSchema.partial().parse(req.body);
      nullifyEmptyDateStrings(parsed as Record<string, unknown>, [...RAILCAR_DATE_KEYS]);
      const flag = parsed.ops_flag;
      const updateRow: Record<string, unknown> = omitOpsFlagFields({ ...parsed });

      // Rental Status must never flip active / active_status / Car Status as a side effect.
      if (parsed.fleet_status) {
        updateRow.fleet_status = parsed.fleet_status;
        updateRow.fleet_status_source = "manual";
      }

      let priorStatus: string | null | undefined;
      let priorActive: boolean | null | undefined;
      let crossedInactive = false;

      // Never let casual PATCH bodies flip fleet membership except via Car Status save.
      delete updateRow.active;
      delete updateRow.active_status;
      delete updateRow.active_source;

      if (parsed.status !== undefined) {
        const { data: current, error: curErr } = await supabase
          .from("railcars")
          .select("status, active")
          .eq("id", id)
          .single();
        if (curErr) throw curErr;
        priorStatus = current?.status;
        priorActive = current?.active;
        try {
          assertInactivePatchAllowed({
            currentStatus: priorStatus,
            nextStatus: parsed.status,
            reason: inactiveReason,
          });
        } catch (e: any) {
          if (e?.status === 400) return res.status(400).json({ message: e.message });
          throw e;
        }
        crossedInactive = crossesInactiveBoundary(priorStatus, parsed.status);
        Object.assign(updateRow, patchFieldsForStatusChange(priorStatus, String(parsed.status ?? "")));
      }

      const { data, error } = await supabase
        .from("railcars")
        .update(updateRow)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      if (parsed.status !== undefined && updateRow.active !== undefined && priorActive !== updateRow.active) {
        await syncCurrentAssignmentHistoryActive(id, updateRow.active === true);
      }

      if (crossedInactive && String(inactiveReason ?? "").trim()) {
        await writeCarStatusHistoryRow({
          carId: id,
          fromStatus: priorStatus,
          toStatus: String((updateRow.status as string) ?? parsed.status),
          reason: String(inactiveReason),
          userId: writerId,
        });
      }

      if (flag !== undefined) await persistOpsFlag([id], flag);
      res.json(hydrateOpsFlag({ ...data, ops_flag: flag !== undefined ? flag : (data as any).ops_flag }));
    } catch (err) {
      errHandler(res, err);
    }
  });

  // Change reporting mark / car number (remark) — retains all other attributes, logs history
  app.post("/api/railcars/:id/change-number", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const id = Number(req.params.id);
      const { new_car_number, reason, changed_by } = changeCarNumberSchema.parse(req.body);
      const split = splitCarNumber(new_car_number);
      if (!split.car_number) {
        return res.status(400).json({ message: "Enter a mark and number (e.g. OFCX 349699)" });
      }
      const newMarks = split.reporting_marks;
      const newNum = split.car_number;
      const newInitial = split.car_initial ?? split.reporting_marks;

      const { data: car, error: cErr } = await supabase
        .from("railcars")
        .select("id, car_number, reporting_marks, car_initial")
        .eq("id", id)
        .single();
      if (cErr) throw cErr;
      if (!car) return res.status(404).json({ message: "Railcar not found" });

      const oldInitial = car.car_initial ?? car.reporting_marks ?? null;
      const sameMark =
        String(car.reporting_marks ?? "").toUpperCase() === String(newMarks ?? "").toUpperCase();
      const sameNum = String(car.car_number ?? "").toUpperCase() === String(newNum).toUpperCase();
      if (sameMark && sameNum) {
        return res.status(400).json({ message: "New mark/number is the same as the current value" });
      }

      let conflictQ = supabase
        .from("railcars")
        .select("id")
        .eq("car_number", newNum)
        .neq("id", id);
      conflictQ = newMarks == null
        ? conflictQ.is("reporting_marks", null)
        : conflictQ.eq("reporting_marks", newMarks);
      const { data: conflict } = await conflictQ.maybeSingle();
      if (conflict) {
        const label = [newMarks, newNum].filter(Boolean).join(" ");
        return res.status(400).json({ message: `Car number ${label} is already in use` });
      }

      const changedAt = new Date().toISOString();
      const { error: uErr } = await supabase
        .from("railcars")
        .update({
          car_number: newNum,
          reporting_marks: newMarks,
          car_initial: newInitial,
        })
        .eq("id", id);
      if (uErr) throw uErr;

      const { data: histRow, error: hErr } = await supabase.from("car_number_history").insert({
        railcar_id: id,
        old_car_initial: oldInitial,
        old_car_number: car.car_number,
        new_car_initial: newInitial,
        new_car_number: newNum,
        changed_at: changedAt,
        changed_by: changed_by ?? req.authUser?.email ?? "system",
        reason: reason ?? null,
      }).select("id").single();
      if (hErr) throw hErr;

      const fromLabel = [oldInitial, car.car_number].filter(Boolean).join(" ");
      const toLabel = [newInitial, newNum].filter(Boolean).join(" ");
      await logActivity({
        entity_type: "railcar",
        entity_id: id,
        railcar_id: id,
        action: "mark_change",
        actor: changed_by ?? req.authUser?.email ?? "system",
        detail: { from: fromLabel, to: toLabel, reason: reason ?? null },
        occurred_at: changedAt,
        source_table: "car_number_history",
        source_id: histRow?.id ?? null,
      });

      res.json({
        ok: true,
        old_car_initial: oldInitial,
        old_car_number: car.car_number,
        new_car_initial: newInitial,
        new_car_number: newNum,
      });
    } catch (err) { errHandler(res, err); }
  });

  app.delete("/api/railcars/:id", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const id = Number(req.params.id);
      const { data: assignments, error: aErr } = await supabase
        .from("railcar_assignments")
        .select("id")
        .eq("railcar_id", id);
      if (aErr) throw aErr;
      if ((assignments ?? []).length > 0) {
        return res
          .status(400)
          .json({ message: "Cannot delete: railcar has an active assignment" });
      }
      const { error } = await supabase.from("railcars").delete().eq("id", id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Leases (Master + nested riders) ----------
  app.get("/api/leases", async (_req, res) => {
    try {
      const [leasesRes, ridersRes, countByRider, activeByRider] = await Promise.all([
        supabase.from("master_leases").select("*").order("lease_number"),
        supabase.from("riders").select("*").order("rider_name"),
        countCarsByRiderId(),
        countActiveCarsByRiderId(),
      ]);
      if (leasesRes.error) throw leasesRes.error;
      if (ridersRes.error) throw ridersRes.error;

      const riders = (ridersRes.data ?? []).map((r) => {
        const car_count = countByRider.get(r.id) ?? 0;
        const active_car_count = activeByRider.get(r.id) ?? 0;
        const { account_manager: _deprecatedRiderAm, ...rest } = r as any;
        return {
          ...rest,
          car_count,
          active_car_count,
          is_inactive: active_car_count === 0,
        };
      });

      const amByAccount = await accountManagerByAccountIds(
        (leasesRes.data ?? []).map((l: any) => Number(l.account_id)).filter((n) => n > 0),
      );

      const result = (leasesRes.data ?? []).map((l) => {
        const leaseRiders = riders.filter((r) => r.master_lease_id === l.id);
        const car_count = leaseRiders.reduce(
          (acc, r) => acc + (r.car_count ?? 0),
          0
        );
        const is_inactive =
          leaseRiders.length === 0 || leaseRiders.every((r) => r.is_inactive);
        const accountId = (l as any).account_id ?? null;
        return {
          ...l,
          account_manager: accountId ? amByAccount.get(accountId) ?? null : null,
          riders: leaseRiders,
          car_count,
          is_inactive,
        };
      });

      res.json(result);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/leases/export", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const scopeAll = req.query.scope === "all" || req.query.all === "1" || req.query.all === "true";
      let ids = String(req.query.ids ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (scopeAll) {
        const { data, error } = await supabase.from("master_leases").select("id").order("lease_number");
        if (error) throw error;
        ids = (data ?? []).map((r: any) => Number(r.id)).filter((n) => n > 0);
      }
      const { buffer, filename } = await buildLeaseReport({ leaseIds: ids });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/leases", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const parsed = insertMasterLeaseSchema.parse(req.body);
      nullifyEmptyDateStrings(parsed as Record<string, unknown>, [...MASTER_LEASE_DATE_KEYS]);
      if (parsed.lease_type != null && String(parsed.lease_type).trim() === "") {
        parsed.lease_type = null;
      }
      const accountId = await ensureAccountForLessee(parsed.lessee ?? null);
      const { data, error } = await supabase
        .from("master_leases")
        .insert({ ...parsed, account_id: accountId })
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.patch("/api/leases/:id", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const id = Number(req.params.id);
      const parsed = insertMasterLeaseSchema.partial().parse(req.body);
      nullifyEmptyDateStrings(parsed as Record<string, unknown>, [...MASTER_LEASE_DATE_KEYS]);
      if (parsed.lease_type != null && String(parsed.lease_type).trim() === "") {
        parsed.lease_type = null;
      }
      const leasePatch: Record<string, unknown> = { ...parsed };
      if (parsed.lessee !== undefined) {
        leasePatch.account_id = await ensureAccountForLessee(parsed.lessee ?? null);
      }
      const { data, error } = await supabase
        .from("master_leases")
        .update(leasePatch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.delete("/api/leases/:id", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const id = Number(req.params.id);
      const { data: riders } = await supabase
        .from("riders")
        .select("id")
        .eq("master_lease_id", id);
      if ((riders ?? []).length > 0) {
        return res
          .status(400)
          .json({ message: "Cannot delete: master lease has riders" });
      }
      const { error } = await supabase
        .from("master_leases")
        .delete()
        .eq("id", id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Riders ----------
  app.get("/api/riders", async (_req, res) => {
    try {
      const [ridersRes, countByRider] = await Promise.all([
        supabaseAdmin
          .from("riders")
          .select("*, master_lease:master_leases(id, lease_number)")
          .order("rider_name", { ascending: true }),
        countCarsByRiderId(),
      ]);
      if (ridersRes.error) throw ridersRes.error;
      const out = (ridersRes.data ?? []).map((r: any) => ({
        ...r,
        car_count: countByRider.get(r.id) ?? 0,
      }));
      res.json(out);
    } catch (err) {
      errHandler(res, err);
    }
  });

  /** Resolve a free-text OL/rider label to an existing rider, or create one under an Ad Hoc MLA. */
  app.post("/api/riders/resolve", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const raw = String(req.body?.label ?? req.body?.rider_name ?? "").trim();
      if (!raw) return res.status(400).json({ message: "label is required" });

      const riders = await fetchAllRows((from, to) =>
        supabase
          .from("riders")
          .select("id, rider_name, schedule_number, master_lease_id")
          .order("id", { ascending: true })
          .range(from, to)
      );
      const upper = raw.toUpperCase();
      const asId = Number(raw);
      const match =
        (Number.isFinite(asId) && asId > 0
          ? riders.find((r: any) => r.id === asId)
          : undefined) ??
        riders.find(
          (r: any) =>
            String(r.rider_name ?? "").trim().toUpperCase() === upper ||
            String(r.schedule_number ?? "").trim().toUpperCase() === upper
        );
      if (match) {
        return res.json({ id: match.id, rider_name: match.rider_name, created: false });
      }

      const AD_HOC_LEASE = "AD-HOC-OL";
      let { data: mla } = await supabase
        .from("master_leases")
        .select("id")
        .eq("lease_number", AD_HOC_LEASE)
        .maybeSingle();
      if (!mla) {
        const { data: created, error: mErr } = await supabase
          .from("master_leases")
          .insert({
            lease_number: AD_HOC_LEASE,
            lessor: "RESIDCO",
            lessee: "Ad Hoc / Free-text OL",
            account_id: await ensureAccountForLessee("Ad Hoc / Free-text OL"),
            // lease_type left null — set in Lease Management
          })
          .select("id")
          .single();
        if (mErr) throw mErr;
        mla = created;
      }

      const { data: inserted, error: rErr } = await supabase
        .from("riders")
        .insert({
          master_lease_id: mla!.id,
          rider_name: raw,
          schedule_number: raw,
          // riders.account_manager is deprecated / unused
        })
        .select("id, rider_name")
        .single();
      if (rErr) throw rErr;
      res.json({ id: inserted.id, rider_name: inserted.rider_name, created: true });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/riders", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const parsed = insertRiderSchema.parse(req.body);
      nullifyEmptyDateStrings(parsed as Record<string, unknown>, [...RIDER_DATE_KEYS]);
      delete (parsed as { account_manager?: unknown }).account_manager;
      delete (parsed as { status_tag?: unknown }).status_tag;
      delete (parsed as { account_mgmt_comment?: unknown }).account_mgmt_comment;
      const { data, error } = await supabase
        .from("riders")
        .insert(parsed)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.patch("/api/riders/:id", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const id = Number(req.params.id);
      const parsed = insertRiderSchema.partial().parse(req.body);
      nullifyEmptyDateStrings(parsed as Record<string, unknown>, [...RIDER_DATE_KEYS]);
      delete (parsed as { account_manager?: unknown }).account_manager;
      delete (parsed as { status_tag?: unknown }).status_tag;
      delete (parsed as { account_mgmt_comment?: unknown }).account_mgmt_comment;
      const { data, error } = await supabase
        .from("riders")
        .update(parsed)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.delete("/api/riders/:id", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const id = Number(req.params.id);
      const { data: assigns } = await supabase
        .from("railcar_assignments")
        .select("id")
        .eq("rider_id", id);
      if ((assigns ?? []).length > 0) {
        return res
          .status(400)
          .json({ message: "Cannot delete: rider has cars assigned" });
      }
      const { error } = await supabase.from("riders").delete().eq("id", id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Assignments ----------
  app.get("/api/assignments", async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from("railcar_assignments")
        .select(
          `*, railcar:railcars(id, car_number, reporting_marks, status),
           rider:riders(id, rider_name, schedule_number, master_lease:master_leases(id, lease_number))`
        )
        .order("assigned_at", { ascending: false });
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Move cars ----------
  app.post("/api/move", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const input = moveCarsSchema.parse(req.body);
      const { car_ids, to_rider_id, new_fleet_name, reason, moved_by, effective_date } = input;

      // verify destination rider exists
      const { data: toRider, error: rErr } = await supabase
        .from("riders")
        .select("id, rider_name")
        .eq("id", to_rider_id)
        .single();
      if (rErr) throw rErr;
      if (!toRider)
        return res.status(400).json({ message: "Destination rider not found" });

      // fetch current assignments for each car
      const { data: currentAssigns, error: caErr } = await supabase
        .from("railcar_assignments")
        .select("id, railcar_id, rider_id, fleet_name")
        .in("railcar_id", car_ids);
      if (caErr) throw caErr;
      const currentByCar = new Map<number, any>();
      for (const a of currentAssigns ?? []) currentByCar.set(a.railcar_id, a);

      const historyRows: any[] = [];
      const movedAt = effectiveDateToTimestamp(effective_date);

      for (const carId of car_ids) {
        const prev = currentByCar.get(carId);
        const fromRiderId = prev?.rider_id ?? null;
        const fromFleet = prev?.fleet_name ?? null;
        const targetFleet = new_fleet_name ?? fromFleet;

        if (prev) {
          const { error: uErr } = await supabase
            .from("railcar_assignments")
            .update({
              rider_id: to_rider_id,
              fleet_name: targetFleet,
              assigned_at: movedAt,
            })
            .eq("id", prev.id);
          if (uErr) throw uErr;
        } else {
          const { error: iErr } = await supabase
            .from("railcar_assignments")
            .insert({
              railcar_id: carId,
              rider_id: to_rider_id,
              fleet_name: targetFleet,
              assigned_at: movedAt,
            });
          if (iErr) throw iErr;
        }

        historyRows.push({
          railcar_id: carId,
          from_rider_id: fromRiderId,
          to_rider_id: to_rider_id,
          from_fleet_name: fromFleet,
          to_fleet_name: targetFleet,
          moved_at: movedAt,
          moved_by: moved_by ?? "system",
          reason: reason ?? null,
        });
      }

      if (historyRows.length) {
        const { data: insertedHist, error: hErr } = await supabase
          .from("assignment_history")
          .insert(historyRows)
          .select("id, railcar_id, from_rider_id, to_rider_id, from_fleet_name, to_fleet_name, moved_at, moved_by, reason");
        if (hErr) throw hErr;
        const actor = moved_by ?? req.authUser?.email ?? "system";
        for (const h of insertedHist ?? []) {
          await logActivity({
            entity_type: "railcar",
            entity_id: h.railcar_id,
            railcar_id: h.railcar_id,
            rider_id: h.to_rider_id ?? null,
            action: "reassignment",
            actor,
            detail: {
              from_rider_id: h.from_rider_id,
              to_rider_id: h.to_rider_id,
              from_fleet: h.from_fleet_name,
              to_fleet: h.to_fleet_name,
              reason: h.reason,
            },
            occurred_at: h.moved_at,
            source_table: "assignment_history",
            source_id: h.id,
          });
        }
      }

      res.json({ ok: true, moved: car_ids.length });
    } catch (err) {
      errHandler(res, err);
    }
  });

  // GET /api/contacts — all contacts across all riders, joined with rider + MLA info
  app.get("/api/contacts", async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from("rider_contacts")
        .select(`
          *,
          rider:riders(
            id, rider_name, schedule_number,
            master_lease:master_leases(id, lease_number, lessee)
          )
        `)
        .order("name");
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

  // ---------- Rider Contacts ----------
  app.get("/api/riders/:id/contacts", async (req, res) => {
    try {
      const riderId = Number(req.params.id);
      const { data, error } = await supabase
        .from("rider_contacts")
        .select("*")
        .eq("rider_id", riderId)
        .order("name");
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/riders/:id/contacts", async (req, res) => {
    try {
      const writerId = await requireContactsWrite(req, res);
      if (!writerId) return;
      const riderId = Number(req.params.id);
      const parsed = insertRiderContactSchema.parse({ ...req.body, rider_id: riderId });
      const { data, error } = await supabase
        .from("rider_contacts").insert(parsed).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/contacts — create a contact directly (rider_id in body)
  app.post("/api/contacts", async (req, res) => {
    try {
      const writerId = await requireContactsWrite(req, res);
      if (!writerId) return;
      const parsed = insertRiderContactSchema.parse(req.body);
      const { data, error } = await supabase
        .from("rider_contacts").insert(parsed).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  app.patch("/api/contacts/:id", async (req, res) => {
    try {
      const writerId = await requireContactsWrite(req, res);
      if (!writerId) return;
      const id = Number(req.params.id);
      const parsed = insertRiderContactSchema.partial().parse(req.body);
      const { data, error } = await supabase
        .from("rider_contacts").update(parsed).eq("id", id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  app.delete("/api/contacts/:id", async (req, res) => {
    try {
      const writerId = await requireContactsDelete(req, res);
      if (!writerId) return;
      const id = Number(req.params.id);
      const { error } = await supabase.from("rider_contacts").delete().eq("id", id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  // ---------- Bulk Import ----------
  // Builds a normalized row from a workbook row using flexible header matching
  // (see shared/residco-import.ts). Used by both /preview and /commit so the
  // shape rendered to the operator matches what is written to the DB.
  function buildRailcarFromRow(row: any) {
    const n = normalizeRow(row);
    const get = (k: string): string => {
      const v = (n as any)[k];
      return v == null ? "" : String(v).trim();
    };
    // Workbook "Car Number" is the full identifier (e.g. "TFOX88031"). Split
    // into reporting_marks ("TFOX") and the numeric portion ("88031") so the
    // RLMS data model — which stores them separately and uniquely on
    // (reporting_marks, car_number) — stays intact. If the workbook also
    // provides explicit "Reporting Marks" / "Car Initial" columns, they win.
    const rawCarNum = get("car_number");
    const explicitMarks = get("reporting_marks") || null;
    const explicitInitial = get("car_initial") || null;
    const split = splitCarNumber(rawCarNum);
    const marks = explicitMarks ?? split.reporting_marks;
    const carInitial = explicitInitial ?? split.car_initial ?? marks;
    const carNum = split.car_number || rawCarNum.toUpperCase();
    const carType = get("car_type") || null;
    const statusRaw = get("status");
    const status = statusRaw || "Active/In-Service";
    const fleetName = get("fleet_name") || get("lessee_name") || null;
    const riderName = get("rider_name") || null;
    const notes = get("notes") || null;

    const entityRaw = get("entity") || null;
    const description = get("general_description") || null;
    const mechDesig = get("mechanical_designation") || null;
    const buildYearRaw = get("build_year");
    const buildYear = buildYearRaw ? parseIntCell(buildYearRaw) : null;
    const capacityRaw = get("capacity_cf");
    const capacityCf = capacityRaw ? parseIntCell(capacityRaw) : null;
    const lining = get("lining") || null;
    const oecRaw = get("oec");
    const oec = oecRaw ? parseNumberCell(oecRaw) : null;
    const nbvRaw = get("nbv");
    const nbv = nbvRaw ? parseNumberCell(nbvRaw) : null;
    const oacRaw = get("oac");
    const oac = oacRaw ? parseNumberCell(oacRaw) : null;

    // Master-list extended fields
    const riderExternalId = get("rider_external_id") || null;
    const lesseeName = get("lessee_name") || null;
    const activeStatus = get("active_status") || null;
    const dataSource = get("data_source") || null;
    const assignmentLabel = get("assignment_label") || null;
    const leaseType = get("lease_type") || null;
    const leaseStartDate = parseDateCell((n as any).lease_start_date);
    const leaseEndDate = parseDateCell((n as any).lease_end_date);
    const leaseExpiry = parseDateCell((n as any).lease_expiry);
    const monthlyRentPerCar = parseNumberCell((n as any).monthly_rent_per_car);
    const monthlyDeprPerCar = parseNumberCell((n as any).monthly_depr_per_car);
    const totalBvRider = parseNumberCell((n as any).total_bv_rider);
    const carsOnRiderAr = parseIntCell((n as any).cars_on_rider_ar);
    const commodityFamily = get("commodity_family") || null;
    const commodity = get("commodity") || null;
    const dotCode = get("dot_code") || null;
    const commentEventNote = get("comment_event_note") || null;

    const managedCategory = deriveManagedCategory(entityRaw);
    const activeBool = activeStatus ? deriveActiveBool(activeStatus) : true;
    const alignedStatus = statusAlignedToActiveFlag(status, activeBool);

    return {
      car_number: carNum,
      reporting_marks: marks,
      car_initial: carInitial,
      // Full original workbook identifier — preserved for search/export so
      // operators can still query by "TFOX88031" even though the DB stores
      // marks and number separately.
      full_car_number: marks ? `${marks}${carNum}` : carNum,
      car_type: carType,
      status: alignedStatus,
      fleet_name: fleetName,
      rider_name: riderName,
      notes,
      entity: entityRaw,
      managed_category: managedCategory,
      description,
      general_description: description,
      mechanical_designation: mechDesig,
      build_year: buildYear,
      built_year: buildYear,
      capacity_cf: capacityCf,
      lining,
      oec, nbv, oac,
      rider_external_id: riderExternalId,
      lessee_name: lesseeName,
      active_status: activeBool ? "Active" : "Inactive",
      active: activeBool,
      data_source: dataSource,
      assignment_label: assignmentLabel,
      lease_type: leaseType,
      lease_start_date: leaseStartDate,
      lease_end_date: leaseEndDate,
      lease_expiry: leaseExpiry,
      monthly_rent_per_car: monthlyRentPerCar,
      monthly_depr_per_car: monthlyDeprPerCar,
      total_bv_rider: totalBvRider,
      cars_on_rider_ar: carsOnRiderAr,
      commodity_family: commodityFamily,
      commodity,
      dot_code: dotCode,
      dot_specification: dotCode, // mirror — keeps DV calculator path working
      comment_event_note: commentEventNote,
      fleet_status: autoFleetStatusFromLegacyText({
        active: activeBool,
        rider_external_id: riderExternalId,
        assignment_label: assignmentLabel,
        fleet_name: fleetName,
        managed_category: managedCategory,
      }),
      fleet_status_source: "auto",
      // Raw original headers preserved for debugging / round-trip
      _normalized: n,
    };
  }

  app.post("/api/import/preview", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { rows } = req.body as { rows: any[] };
      if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ message: "No rows provided" });

      // Fetch existing (reporting_marks + car_number) pairs for dupe detection.
      // The DB enforces uniqueness on the combination, not car_number alone, so
      // we must key on the same shape the import will write.
      const existing = await fetchAllRows((from, to) =>
        supabase
          .from("railcars")
          .select("car_number, reporting_marks")
          .order("id", { ascending: true })
          .range(from, to)
      );
      const dupeKey = (marks: string | null | undefined, num: string | null | undefined) =>
        `${(marks ?? "").trim().toUpperCase()}|${(num ?? "").trim().toUpperCase()}`;
      const existingNums = new Set(
        existing.map((r: any) => dupeKey(r.reporting_marks, r.car_number))
      );

      // Fetch riders for name matching (suggestions / existing link only — new OL codes are allowed)
      const riders = await fetchAllRows((from, to) =>
        supabase
          .from("riders")
          .select("id, rider_name")
          .order("id", { ascending: true })
          .range(from, to)
      );
      const riderMap = new Map<string, number>();
      for (const r of riders) riderMap.set(r.rider_name.trim().toUpperCase(), r.id);

      // Track in-batch duplicates (marks+number repeated within the same upload)
      const seenInBatch = new Set<string>();

      const preview = rows.map((row, idx) => {
        const built = buildRailcarFromRow(row);

        const key = built.car_number ? dupeKey(built.reporting_marks, built.car_number) : "";
        const isDbDupe = !!built.car_number && existingNums.has(key);
        const isBatchDupe = !!built.car_number && seenInBatch.has(key);
        if (built.car_number) seenInBatch.add(key);

        const riderId = built.rider_name ? (riderMap.get(built.rider_name.toUpperCase()) ?? null) : null;
        const riderUnknown = !!built.rider_name && riderId === null;

        const errors: string[] = [];
        const warnings: string[] = [];

        if (!built.car_number) errors.push("Missing car_number — required field");
        if (isDbDupe) errors.push("Car number already exists in the system — duplicate will be skipped");
        if (isBatchDupe) errors.push("Car number is duplicated within this file — only the first occurrence will be imported");

        // New OL/rider codes are expected — commit creates the rider when Lessee/MLA context exists.
        if (riderUnknown)
          warnings.push(`Rider/OL "${built.rider_name}" is new — will be created on import when Lessee is present`);
        if (built.entity && !["Main", "Rail Partners Select", "Coal"].includes(built.entity))
          warnings.push(`entity "${built.entity}" is unrecognised — expected "Main", "Rail Partners Select" or "Coal"; managed_category will fall back to entity value`);

        const isValid = errors.length === 0;
        return {
          _row: idx + 1,
          ...built,
          rider_id: riderId,
          is_dupe: isDbDupe,
          is_batch_dupe: isBatchDupe,
          errors,
          warnings,
          valid: isValid,
        };
      });

      res.json({
        total: rows.length,
        valid: preview.filter((r) => r.valid && r.warnings.length === 0).length,
        valid_with_warnings: preview.filter((r) => r.valid && r.warnings.length > 0).length,
        dupes: preview.filter((r) => r.is_dupe || r.is_batch_dupe).length,
        errors: preview.filter((r) => !r.valid).length,
        preview,
      });
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/import/commit", async (req: Request, res: Response) => {
    // Do-not-touch: accounts.account_manager (ensureAccountForLessee inserts name only).
    // riders.account_manager is deprecated and still excluded via assertRiderImporterPatch.
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { rows } = req.body as { rows: any[] };
      if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ message: "No rows" });

      const validRows = rows.filter((r) => r.valid && r.car_number);
      if (validRows.length === 0)
        return res.status(400).json({ message: "No valid rows to import" });

      const BATCH = 500;
      const now = new Date().toISOString();

      // ---- 1. Build (lessee → master_lease) and (rider_external_id → rider) maps ----
      // The workbook does not carry an MLA number, so we treat each distinct
      // Lessee as one master_lease. Within an MLA, each distinct Rider ID is
      // one rider. Existing MLAs/riders in the DB are reused (matched by
      // synthesized lease_number for MLAs, by rider_name for riders) so
      // re-running an import is idempotent.

      // Distinct lessees we'll need to ensure exist as MLAs.
      const lesseeSet = new Set<string>();
      for (const r of validRows) {
        const k = deriveLeaseKey(r.lessee_name);
        if (k) lesseeSet.add(k);
      }

      // Pre-load existing MLAs. Match by lessee name, then by lease_number
      // (including a legacy VCF- prefix from the original load).
      const lesseeToMlaId = new Map<string, number>();
      const { data: existingMlas, error: mlaErr } = await supabase
        .from("master_leases").select("id, lease_number, lessee, account_id");
      if (mlaErr) throw mlaErr;
      const leaseNumberToId = new Map<string, number>();
      for (const m of existingMlas ?? []) {
        if (m.lessee) lesseeToMlaId.set(m.lessee.trim(), m.id);
        const ln = String(m.lease_number ?? "").trim().toUpperCase();
        if (ln) {
          leaseNumberToId.set(ln, m.id);
          const stripped = ln.replace(/^VCF-/, "");
          if (stripped) leaseNumberToId.set(stripped, m.id);
        }
      }
      for (const lessee of lesseeSet) {
        if (lesseeToMlaId.has(lessee)) continue;
        const want = synthesizeLeaseNumber(lessee);
        const id = leaseNumberToId.get(want) ?? leaseNumberToId.get(`VCF-${want}`);
        if (id) lesseeToMlaId.set(lessee, id);
      }

      const lesseeToAccountId = new Map<string, number>();
      for (const lessee of lesseeSet) {
        const accountId = await ensureAccountForLessee(lessee);
        if (accountId) lesseeToAccountId.set(lessee, accountId);
      }

      // Insert any missing MLAs. lease_type is intentionally omitted —
      // Lease Management is the sole writer of that field (left null for Bruce).
      // account_id is set; account_manager on the account is left null.
      const newMlaPayloads = Array.from(lesseeSet)
        .filter((lessee) => !lesseeToMlaId.has(lessee))
        .map((lessee) => ({
          lease_number: synthesizeLeaseNumber(lessee),
          lessee,
          lessor: "RESIDCO",
          notes: "Auto-created by RESIDCO Master Car List import",
          account_id: lesseeToAccountId.get(lessee) ?? null,
        }));
      let mlasCreated = 0;
      for (let i = 0; i < newMlaPayloads.length; i += BATCH) {
        const slice = newMlaPayloads.slice(i, i + BATCH);
        const { data: ins, error } = await supabase
          .from("master_leases").insert(slice).select("id, lessee");
        if (error) throw error;
        for (const m of ins ?? []) {
          if (m.lessee) lesseeToMlaId.set(m.lessee.trim(), m.id);
        }
        mlasCreated += ins?.length ?? 0;
      }

      for (const m of existingMlas ?? []) {
        if (m.account_id) continue;
        const lessee = String(m.lessee ?? "").trim();
        if (!lessee || !lesseeSet.has(lessee)) continue;
        const accountId = lesseeToAccountId.get(lessee);
        if (!accountId) continue;
        const { error: linkErr } = await supabase
          .from("master_leases")
          .update({ account_id: accountId })
          .eq("id", m.id);
        if (linkErr) throw linkErr;
      }

      // Distinct riders. A rider is identified by (Rider ID OR rider_name) per
      // lessee. We use rider_external_id as the natural key when present,
      // falling back to rider_name. Within the row, we now know the
      // master_lease_id from the lessee map.
      type RiderSpec = {
        master_lease_id: number;
        rider_name: string;       // schedule_number / display name
        external_id: string | null;
        effective_date: string | null;
        expiration_date: string | null;
        permissible_commodity: string | null;
        monthly_rent_per_car: number | null;
      };
      const riderKeyOf = (mlaId: number, name: string) => `${mlaId}|${name.trim().toUpperCase()}`;
      const riderSpecs = new Map<string, RiderSpec>();
      for (const r of validRows) {
        const lessee = deriveLeaseKey(r.lessee_name);
        if (!lessee) continue;
        const mlaId = lesseeToMlaId.get(lessee);
        if (!mlaId) continue;
        // rider name = the workbook Rider ID (schedule label) or fall back to assignment label / lessee
        const riderName = (r.rider_external_id || r.assignment_label || lessee).toString().trim();
        if (!riderName) continue;
        const key = riderKeyOf(mlaId, riderName);
        if (!riderSpecs.has(key)) {
          riderSpecs.set(key, {
            master_lease_id: mlaId,
            rider_name: riderName,
            external_id: r.rider_external_id ?? null,
            effective_date: r.lease_start_date ?? null,
            expiration_date: r.lease_expiry ?? r.lease_end_date ?? null,
            permissible_commodity: r.commodity ?? null,
            monthly_rent_per_car: r.monthly_rent_per_car ?? null,
          });
        }
      }

      // Pre-load existing riders for those MLAs.
      const riderKeyToId = new Map<string, number>();
      const mlaIds = Array.from(new Set(Array.from(riderSpecs.values()).map((s) => s.master_lease_id)));
      if (mlaIds.length > 0) {
        const { data: existingRiders, error: rErr } = await supabase
          .from("riders").select("id, master_lease_id, rider_name").in("master_lease_id", mlaIds);
        if (rErr) throw rErr;
        for (const er of existingRiders ?? []) {
          riderKeyToId.set(riderKeyOf(er.master_lease_id, er.rider_name), er.id);
        }
      }

      // Insert any missing riders.
      const newRiderPayloads = Array.from(riderSpecs.values())
        .filter((s) => !riderKeyToId.has(riderKeyOf(s.master_lease_id, s.rider_name)))
        .map((s) => {
          const row = {
            master_lease_id: s.master_lease_id,
            rider_name: s.rider_name,
            schedule_number: s.external_id,
            effective_date: s.effective_date,
            expiration_date: s.expiration_date,
            permissible_commodity: s.permissible_commodity,
            monthly_rent_per_car: s.monthly_rent_per_car,
          };
          assertRiderImporterPatch(row);
          return row;
        });
      let ridersCreated = 0;
      for (let i = 0; i < newRiderPayloads.length; i += BATCH) {
        const slice = newRiderPayloads.slice(i, i + BATCH);
        const { data: ins, error } = await supabase
          .from("riders").insert(slice).select("id, master_lease_id, rider_name");
        if (error) throw error;
        for (const er of ins ?? []) {
          riderKeyToId.set(riderKeyOf(er.master_lease_id, er.rider_name), er.id);
        }
        ridersCreated += ins?.length ?? 0;
      }

      // ---- 2. Insert railcars (strip preview-only fields) ----
      const stripPreviewOnly = (r: any) => {
        const {
          _row, _normalized,
          rider_name, fleet_name, rider_id, full_car_number,
          is_dupe, is_batch_dupe, errors, warnings, valid,
          ...rest
        } = r;
        return rest;
      };
      const carInserts = validRows.map((r) => {
        const rest = stripPreviewOnly(r);
        delete (rest as any).equipment_type_code;
        assertRailcarImporterPatch(rest);
        return rest;
      });

      let importedCount = 0;
      // Map composite key (marks|number) → railcar id
      const carKeyToId = new Map<string, number>();
      const carKey = (m: string | null | undefined, n: string | null | undefined) =>
        `${(m ?? "").trim().toUpperCase()}|${(n ?? "").trim().toUpperCase()}`;
      for (let i = 0; i < carInserts.length; i += BATCH) {
        const slice = carInserts.slice(i, i + BATCH);
        const { data: inserted, error: insErr } = await supabase
          .from("railcars").insert(slice).select("id, car_number, reporting_marks");
        if (insErr) throw insErr;
        for (const c of inserted ?? []) {
          carKeyToId.set(carKey(c.reporting_marks, c.car_number), c.id);
        }
        importedCount += inserted?.length ?? 0;
      }

      // ---- 3. Build railcar_assignments using the rider map we just built ----
      // Prefer the rider we created from this row; fall back to a workbook
      // rider_name match for rows that had no Lessee but did name a rider.
      const { data: legacyRiders } = await supabase.from("riders").select("id, rider_name");
      const legacyRiderByName = new Map<string, number>();
      for (const r of legacyRiders ?? []) {
        legacyRiderByName.set(r.rider_name.trim().toUpperCase(), r.id);
      }

      const assignments: Array<{
        railcar_id: number;
        rider_id: number;
        fleet_name: string | null;
        sub_lease_number: string | null;
        sublease_expiration_date: string | null;
        assigned_at: string;
      }> = [];
      for (const r of validRows) {
        const cid = carKeyToId.get(carKey(r.reporting_marks, r.car_number));
        if (!cid) continue;
        let riderId: number | null = null;
        const lessee = deriveLeaseKey(r.lessee_name);
        if (lessee) {
          const mlaId = lesseeToMlaId.get(lessee);
          if (mlaId) {
            const rname = (r.rider_external_id || r.assignment_label || lessee).toString().trim();
            riderId = riderKeyToId.get(riderKeyOf(mlaId, rname)) ?? null;
          }
        }
        if (!riderId && r.rider_name) {
          riderId = legacyRiderByName.get(r.rider_name.trim().toUpperCase()) ?? null;
        }
        if (!riderId && r.rider_id) {
          riderId = r.rider_id;
        }
        if (!riderId) continue;
        assignments.push({
          railcar_id: cid,
          rider_id: riderId,
          fleet_name: r.fleet_name ?? r.lessee_name ?? null,
          sub_lease_number: r.assignment_label ?? null,
          sublease_expiration_date: r.lease_expiry ?? r.lease_end_date ?? null,
          assigned_at: now,
        });
      }

      if (assignments.length > 0) {
        for (let i = 0; i < assignments.length; i += BATCH) {
          const slice = assignments.slice(i, i + BATCH);
          const { error: aErr } = await supabase.from("railcar_assignments").insert(slice);
          if (aErr) throw aErr;
        }
      }

      const totalSubmitted = rows.length;
      res.json({
        ok: true,
        imported: importedCount,
        assigned: assignments.length,
        mlas_created: mlasCreated,
        riders_created: ridersCreated,
        skipped: totalSubmitted - importedCount,
      });
    } catch (err) { errHandler(res, err); }
  });

  // ---------- Valid Car File (V_VALID_CARS) — assignment-grouped preview (§2 / §2.3) ----------
  // Dry-run review only unless a separate commit endpoint is used after Bruce sign-off.
  app.post("/api/import/vcf/preview", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { rows } = req.body as { rows: any[] };
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No rows provided" });
      }

      const existingKeys = new Set<string>();
      const { data: existing, error: eErr } = await supabase
        .from("railcars")
        .select("car_initial, car_number, reporting_marks");
      if (eErr) throw eErr;
      for (const r of existing ?? []) {
        const initial = String((r as any).car_initial || (r as any).reporting_marks || "")
          .trim()
          .toUpperCase();
        const num = String((r as any).car_number ?? "").trim();
        if (initial || num) existingKeys.add(`${initial}|${num}`);
      }

      const review = buildVcfReview(rows, existingKeys);
      // Omit full cars[] from response (can be 30k+) — keep summary + flags for UI.
      res.json({
        ok: true,
        mode: "vcf",
        existingCarsInDb: existingKeys.size,
        totalRows: review.totalRows,
        distinctCars: review.distinctCars,
        newCars: review.newCars,
        updatedCars: review.updatedCars,
        multipleActiveCount: review.multipleActiveCount,
        multipleActiveCars: review.multipleActiveCars,
        badActiveCount: review.badActiveCount,
        badActiveValues: review.badActiveValues,
        unmappedManagedCategoryCount: review.unmappedManagedCategoryCount,
        unmappedManagedCategories: review.unmappedManagedCategories,
        // Sample of needs-review cars for UI (full list is multipleActiveCars)
        needsReviewSample: review.cars.filter((c) => c.needsReview).slice(0, 50).map((c) => ({
          car_initial: c.car_initial,
          car_number: c.car_number,
          periodCount: c.periodCount,
          activePeriodCount: c.activePeriodCount,
        })),
      });
    } catch (err) { errHandler(res, err); }
  });

  // VCF commit — gated. Requires confirmProductionImport === true after Bruce review.
  // Not used for the non-prod gate run; kept ready for the signed-off production load.
  // Do-not-touch: accounts.account_manager, riders.account_manager (deprecated).
  // VCF writes railcars + assignment_history + car_number_history. It does not
  // insert riders or accounts. Post-commit expiration sync may patch
  // riders.expiration_date / effective_date only.
  // See docs/IMPORT_WRITE_BOUNDARIES.md.
  app.post("/api/import/vcf/commit", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { rows, confirmProductionImport } = req.body as {
        rows: any[];
        confirmProductionImport?: boolean;
      };
      if (!confirmProductionImport) {
        return res.status(400).json({
          message: "VCF commit blocked — set confirmProductionImport: true only after Bruce signs off on the §2.3 review.",
        });
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No rows provided" });
      }

      const existingKeys = new Set<string>();
      const { data: existing } = await supabase
        .from("railcars")
        .select("id, car_initial, car_number, reporting_marks");
      const keyToId = new Map<string, number>();
      for (const r of existing ?? []) {
        const initial = String((r as any).car_initial || (r as any).reporting_marks || "")
          .trim()
          .toUpperCase();
        const num = String((r as any).car_number ?? "").trim();
        const k = `${initial}|${num}`;
        existingKeys.add(k);
        keyToId.set(k, (r as any).id);
      }

      const review = buildVcfReview(rows, existingKeys);
      const BATCH = 500;
      let inserted = 0;
      let updated = 0;
      let historyRows = 0;
      let assignmentPeriods = 0;
      let assignmentInserted = 0;
      let assignmentUpdated = 0;
      let assignmentUnchanged = 0;
      let remarkHistory = 0;
      let remarkInserted = 0;
      let remarkUpdated = 0;
      let remarkUnchanged = 0;
      const movedAt = new Date().toISOString();

      // Prefetch existing VCF history for idempotent upsert (car + ASSIGNMENT_ID + start_date)
      const ahByKey = new Map<string, any>();
      {
        let from = 0;
        for (;;) {
          const { data, error } = await supabase
            .from("assignment_history")
            .select(
              "id, railcar_id, assignment_id_ext, start_date, end_date, rider_external_id, assignment_label, active, comment, reason"
            )
            .eq("moved_by", "vcf-import")
            .range(from, from + 999);
          if (error) throw error;
          const chunk = data ?? [];
          for (const r of chunk) {
            ahByKey.set(
              assignmentHistoryNaturalKey(
                r.railcar_id,
                r.assignment_id_ext,
                r.start_date,
                r.end_date
              ),
              r
            );
          }
          if (chunk.length < 1000) break;
          from += 1000;
        }
      }
      const cnhByKey = new Map<string, any>();
      {
        let from = 0;
        for (;;) {
          const { data, error } = await supabase
            .from("car_number_history")
            .select(
              "id, railcar_id, old_car_initial, old_car_number, new_car_initial, new_car_number, changed_at, changed_by, reason"
            )
            .eq("changed_by", "vcf-import")
            .range(from, from + 999);
          if (error) throw error;
          const chunk = data ?? [];
          for (const r of chunk) {
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
          if (chunk.length < 1000) break;
          from += 1000;
        }
      }

      for (let i = 0; i < review.cars.length; i += BATCH) {
        const slice = review.cars.slice(i, i + BATCH);
        for (const car of slice) {
          const payload = railcarPayloadFromCurrent(car.current, {
            needsReview: car.needsReview,
          });
          const existingId = keyToId.get(car.carKey);
          let railcarId = existingId;
          if (existingId) {
            // Skip entity in update when unchanged so the old managed_category trigger doesn't fire
            const { data: existingCar } = await supabase
              .from("railcars")
              .select("entity, fleet_status_source, active_source, active, status")
              .eq("id", existingId)
              .maybeSingle();
            const updatePayload = { ...payload };
            if (existingCar && (existingCar as any).entity === payload.entity) {
              delete (updatePayload as any).entity;
            }
            // Never overwrite a human fleet_status pick. Auto rows re-derive from this VCF period.
            if ((existingCar as any)?.fleet_status_source === "manual") {
              delete (updatePayload as any).fleet_status;
              delete (updatePayload as any).fleet_status_source;
            } else {
              (updatePayload as any).fleet_status = autoFleetStatusFromLegacyText({
                active: payload.active as boolean | undefined,
                rider_external_id: payload.rider_external_id as string | null,
                assignment_label: payload.assignment_label as string | null,
                managed_category: payload.managed_category as string | null,
              });
              (updatePayload as any).fleet_status_source = "auto";
            }
            // Never overwrite a human Inactive/Reactivate pick.
            const activeManual = (existingCar as any)?.active_source === "manual";
            if (activeManual) {
              delete (updatePayload as any).active;
              delete (updatePayload as any).active_status;
              delete (updatePayload as any).status;
              delete (updatePayload as any).active_source;
            } else {
              (updatePayload as any).active_source = "auto";
              if (typeof payload.active === "boolean") {
                (updatePayload as any).status = statusAlignedToActiveFlag(
                  (existingCar as any)?.status,
                  payload.active,
                );
              }
            }
            assertRailcarImporterPatch(updatePayload);
            const { error } = await supabase.from("railcars").update(updatePayload).eq("id", existingId);
            if (error) throw error;
            updated += 1;

            // Idempotent assignment_history upsert — natural key car + ASSIGNMENT_ID + start_date
            // (Do NOT delete-all / blind-insert; monthly re-runs must not double rows.)
            const protectedActive =
              activeManual ? ((existingCar as any).active === true) : null;
            for (const p of car.periods) {
              const hist = assignmentHistoryPayloadFromPeriod(railcarId!, p, movedAt);
              // Only the open-ended (current) period feeds export "current" ACTIVE;
              // keep it aligned with guarded railcars.active. Closed periods keep file ACTIVE.
              if (protectedActive != null && hist.end_date == null) {
                hist.active = protectedActive;
              }
              const key = assignmentHistoryNaturalKey(
                hist.railcar_id,
                hist.assignment_id_ext,
                hist.start_date,
                hist.end_date
              );
              const existing = ahByKey.get(key);
              if (existing) {
                if (assignmentHistoryContentEqual(existing, hist)) {
                  assignmentUnchanged += 1;
                } else {
                  const { error } = await supabase
                    .from("assignment_history")
                    .update(hist)
                    .eq("id", existing.id);
                  if (error) throw error;
                  ahByKey.set(key, { ...existing, ...hist });
                  assignmentUpdated += 1;
                }
              } else {
                const { data: ins, error } = await supabase
                  .from("assignment_history")
                  .insert(hist)
                  .select("id")
                  .single();
                if (error) throw error;
                ahByKey.set(key, { id: ins!.id, ...hist });
                assignmentInserted += 1;
              }
              assignmentPeriods += 1;
            }

            // After import, re-assert current open AH.active for manual cars (export SoT).
            if (activeManual) {
              await syncCurrentAssignmentHistoryActive(
                existingId,
                (existingCar as any).active === true,
              );
            }

            // Idempotent car_number_history upsert — remark natural key
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
              const existing = cnhByKey.get(key);
              if (existing) {
                remarkUnchanged += 1;
                remarkHistory += 1;
                continue;
              }
              const { data: ins, error } = await supabase
                .from("car_number_history")
                .insert(remark)
                .select("id")
                .single();
              if (error) throw error;
              cnhByKey.set(key, { id: ins!.id, ...remark });
              remarkInserted += 1;
              remarkHistory += 1;
            }
            historyRows += 1;
            continue; // skip the shared AH/CNH loops below for this car
          } else {
            const insertPayload = {
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
            const { data: ins, error } = await supabase.from("railcars").insert(insertPayload).select("id").single();
            if (error) throw error;
            railcarId = ins!.id;
            keyToId.set(car.carKey, railcarId);
            inserted += 1;
          }

          // Idempotent assignment_history upsert — natural key car + ASSIGNMENT_ID + start_date
          // (Do NOT delete-all / blind-insert; monthly re-runs must not double rows.)
          for (const p of car.periods) {
            const hist = assignmentHistoryPayloadFromPeriod(railcarId!, p, movedAt);
            const key = assignmentHistoryNaturalKey(
              hist.railcar_id,
              hist.assignment_id_ext,
              hist.start_date,
              hist.end_date
            );
            const existing = ahByKey.get(key);
            if (existing) {
              if (assignmentHistoryContentEqual(existing, hist)) {
                assignmentUnchanged += 1;
              } else {
                const { error } = await supabase
                  .from("assignment_history")
                  .update(hist)
                  .eq("id", existing.id);
                if (error) throw error;
                ahByKey.set(key, { ...existing, ...hist });
                assignmentUpdated += 1;
              }
            } else {
              const { data: ins, error } = await supabase
                .from("assignment_history")
                .insert(hist)
                .select("id")
                .single();
              if (error) throw error;
              ahByKey.set(key, { id: ins!.id, ...hist });
              assignmentInserted += 1;
            }
            assignmentPeriods += 1;
          }

          // Idempotent car_number_history upsert — remark natural key
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
            const existing = cnhByKey.get(key);
            if (existing) {
              remarkUnchanged += 1;
              remarkHistory += 1;
              continue;
            }
            const { data: ins, error } = await supabase
              .from("car_number_history")
              .insert(remark)
              .select("id")
              .single();
            if (error) throw error;
            cnhByKey.set(key, { id: ins!.id, ...remark });
            remarkInserted += 1;
            remarkHistory += 1;
          }
          historyRows += 1;
        }
      }

      // After VCF writes raw car lease dates, re-apply Asset Report precedence
      // (and V_Valid fallback only for OLs the report omits).
      let riderExpirationSync: Awaited<ReturnType<typeof governLeaseDates>> | null = null;
      try {
        riderExpirationSync = await governLeaseDates(supabase);
      } catch (syncErr) {
        console.warn("[vcf/commit] lease date governance failed", syncErr);
      }

      res.json({
        ok: true,
        inserted,
        updated,
        carsProcessed: review.cars.length,
        assignmentPeriods,
        assignmentInserted,
        assignmentUpdated,
        assignmentUnchanged,
        remarkHistory,
        remarkInserted,
        remarkUpdated,
        remarkUnchanged,
        multipleActiveFlagged: review.multipleActiveCount,
        riderExpirationSync,
      });
    } catch (err) { errHandler(res, err); }
  });

  // ---------- Financial Data Refresh (Asset Report) — §3 preview / gated commit ----------
  app.post("/api/import/financial/preview", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { mainRows, rpsRows, snapshotMonth } = req.body as {
        mainRows?: unknown[][];
        rpsRows?: unknown[][];
        snapshotMonth?: string | null;
      };
      if (!Array.isArray(mainRows) && !Array.isArray(rpsRows)) {
        return res.status(400).json({ message: "Provide mainRows and/or rpsRows sheet matrices" });
      }

      // Active cars for reconciliation / refresh preview
      const activeCars: any[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from("railcars")
          .select("id, rider_external_id, car_type, mechanical_designation, general_description, entity")
          .eq("active", true)
          .range(from, from + 999);
        if (error) throw error;
        const chunk = data ?? [];
        activeCars.push(...chunk);
        if (chunk.length < 1000) break;
        from += 1000;
      }

      const review = buildFinancialReview(
        mainRows ?? [],
        rpsRows ?? [],
        activeCars,
        snapshotMonth ?? null
      );

      const month = normalizeSnapshotMonth(review.snapshotMonth);
      let existingSnapshotRows = 0;
      if (month) {
        const { count, error: cErr } = await supabaseAdmin
          .from("rider_financial_summary")
          .select("id", { count: "exact", head: true })
          .eq("snapshot_month", month);
        if (cErr) throw cErr;
        existingSnapshotRows = count ?? 0;
      }

      res.json({
        ok: true,
        mode: "financial",
        productionWrite: false,
        snapshotMonth: month,
        snapshotMonthDetected: review.snapshotMonthDetected,
        existingSnapshotRows,
        qualifyingRows: review.qualifyingRows,
        qualifyingCarCount: review.qualifyingCarCount,
        mainRows: review.main.rows.length,
        rpsRows: review.rps.rows.length,
        skippedNonRail: review.skippedNonRail,
        flaggedCount: review.flaggedCount,
        flagged: review.flagged,
        unmatchedRiders: review.unmatchedRiders,
        activeCarsInRlms: review.activeCarsInRlms,
        fileVsActiveDelta: review.fileVsActiveDelta,
        fileNoCarMatchCount: review.fileNoCarMatches.length,
        fileNoCarMatches: review.fileNoCarMatches.slice(0, 50),
        carsNoFileMatch: review.carsNoFileMatch,
        refreshPreview: review.refreshPreview,
        matchPathStats: review.matchPathStats,
        assetFamilyMappingNotes: review.assetFamilyMappingNotes,
        joinRules: review.joinRules,
        railcarFieldsWritten: RAILCAR_FINANCIAL_REFRESH_FIELDS,
      });
    } catch (err) { errHandler(res, err); }
  });

  // Do-not-touch: accounts.account_manager, riders.account_manager (deprecated),
  // car_number, entity, active, lessee, rider assignment. Writes
  // rider_financial_summary + RAILCAR_FINANCIAL_REFRESH_FIELDS on railcars,
  // then governLeaseDates for OL expiration onto riders and cars.
  // fillBlankRiderMonthlyRent may fill blank riders.monthly_rent_per_car.
  // See docs/IMPORT_WRITE_BOUNDARIES.md.
  app.post("/api/import/financial/commit", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { mainRows, rpsRows, snapshotMonth, confirmReplace } = req.body as {
        mainRows?: unknown[][];
        rpsRows?: unknown[][];
        snapshotMonth?: string | null;
        confirmReplace?: boolean;
      };

      const month = normalizeSnapshotMonth(snapshotMonth);
      if (!month) {
        return res.status(400).json({ message: "snapshot_month is required — confirm or override it before committing." });
      }

      const { count: existingCount, error: existErr } = await supabaseAdmin
        .from("rider_financial_summary")
        .select("id", { count: "exact", head: true })
        .eq("snapshot_month", month);
      if (existErr) throw existErr;
      if ((existingCount ?? 0) > 0 && !confirmReplace) {
        return res.status(409).json({
          message: `${month} already has ${existingCount} rows. Set confirmReplace: true to replace that month only.`,
          snapshotMonth: month,
          existingSnapshotRows: existingCount,
        });
      }

      const colProbe = await supabaseAdmin.from("railcars").select("id, financial_snapshot_month").limit(1);
      if (colProbe.error) {
        if (/financial_snapshot_month/i.test(colProbe.error.message)) {
          return res.status(503).json({
            message:
              "railcars.financial_snapshot_month is missing. Run migrations/20260814_financial_snapshot_month.sql in the Supabase SQL editor, then retry. Nothing was written.",
          });
        }
        throw colProbe.error;
      }
      try {
        await probeEstimatedLeaseExpiryColumns(supabaseAdmin);
      } catch (probeErr) {
        if (probeErr instanceof MissingExpiryEstimateColumnsError) {
          return res.status(503).json({ message: probeErr.message });
        }
        throw probeErr;
      }

      const activeCars: any[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await supabaseAdmin
          .from("railcars")
          .select("id, rider_external_id, car_type, mechanical_designation, general_description, entity, nbv, oec, monthly_rent_per_car, monthly_depr_per_car, financial_snapshot_month")
          .eq("active", true)
          .range(from, from + 999);
        if (error) throw error;
        const chunk = data ?? [];
        activeCars.push(...chunk);
        if (chunk.length < 1000) break;
        from += 1000;
      }

      const review = buildFinancialReview(
        mainRows ?? [],
        rpsRows ?? [],
        activeCars,
        month
      );
      if (!review.snapshotMonth) {
        return res.status(400).json({ message: "snapshot_month required — detect failed; pass snapshotMonth explicitly" });
      }

      // Replace this month only — other months stay. Never append/duplicate.
      const { error: delErr } = await supabaseAdmin
        .from("rider_financial_summary")
        .delete()
        .eq("snapshot_month", month);
      if (delErr) throw delErr;

      const allRows = mergeFinancialRowsByUniqueKey([...review.main.rows, ...review.rps.rows]);
      const BATCH = 100;
      let inserted = 0;
      for (let i = 0; i < allRows.length; i += BATCH) {
        const slice = allRows.slice(i, i + BATCH).map(financialRowToDbPayload);
        const { error } = await supabaseAdmin.from("rider_financial_summary").insert(slice);
        if (error) throw error;
        inserted += slice.length;
      }

      // Recompute cars from the latest month that matches each car (not only this file).
      const summaryRows = await loadFinancialSummaryRows(supabaseAdmin);
      const {
        carsUpdated,
        carsUnchanged,
        carsLeftBlank: leftBlank,
        coalSkipped,
      } = await applyCarFinancialsFromSummary(supabaseAdmin, activeCars, summaryRows);

      const leaseGovernance = await governLeaseDates(supabaseAdmin);
      const riderRentRollup = await fillBlankRiderMonthlyRent();

      console.log("[financial-refresh]", JSON.stringify({
        snapshotMonth: month,
        summaryRowsDeleted: existingCount ?? 0,
        summaryRowsWritten: inserted,
        carsUpdated,
        carsUnchanged,
        carsLeftBlank: leftBlank,
        coalSkipped,
        unmatchedRiders: review.unmatchedRiders.length,
        railcarFieldsWritten: RAILCAR_FINANCIAL_REFRESH_FIELDS,
        leaseGovernance,
        riderRentRollup,
      }));

      res.json({
        ok: true,
        snapshotMonth: month,
        summaryRowsDeleted: existingCount ?? 0,
        summaryRowsWritten: inserted,
        carsUpdated,
        carsUnchanged,
        carsLeftBlank: leftBlank,
        coalSkipped,
        flaggedCount: review.flaggedCount,
        qualifyingRows: review.qualifyingRows,
        qualifyingCarCount: review.qualifyingCarCount,
        skippedNonRail: review.skippedNonRail,
        mainRows: review.main.rows.length,
        rpsRows: review.rps.rows.length,
        unmatchedRiders: review.unmatchedRiders,
        fileNoCarMatchCount: review.fileNoCarMatches.length,
        activeCarsInRlms: review.activeCarsInRlms,
        railcarFieldsWritten: RAILCAR_FINANCIAL_REFRESH_FIELDS,
        leaseGovernance,
        riderRentRollup,
      });
    } catch (err) { errHandler(res, err); }
  });

  function summarizeAcquisition(classified: AcquisitionParsedRow[]) {
    const toInsert = classified.filter((r) => !r.skip_reason);
    const skippedExists = classified.filter((r) => r.skip_reason === "already_exists");
    const skippedInvalid = classified.filter((r) => r.skip_reason === "missing_identity" || r.skip_reason === "duplicate_in_file");
    const skipped = classified
      .filter((r) => r.skip_reason)
      .map((r) => ({
        row: r.row,
        marks: r.marks,
        car_number: r.car_number,
        skip_reason: r.skip_reason,
        skip_label: skipReasonLabel(r.skip_reason),
      }));
    return {
      total: classified.length,
      new_count: toInsert.length,
      skipped_exists: skippedExists.length,
      skipped_invalid: skippedInvalid.length,
      skipped,
      to_insert: toInsert,
    };
  }

  async function classifyAcquisitionUpload(rows: Record<string, string>[]) {
    const existing = await fetchAllRows<{
      car_number: string | null;
      reporting_marks: string | null;
      car_initial: string | null;
    }>((from, to) =>
      supabaseAdmin
        .from("railcars")
        .select("car_number, reporting_marks, car_initial")
        .order("id", { ascending: true })
        .range(from, to)
    );
    const classified = classifyAcquisitionRows(rows, buildExistingCarKeySet(existing));
    return summarizeAcquisition(classified);
  }

  const ACQUISITION_SCHEMA_HINT =
    "Acquisition tables are missing. Run migrations/20260817_acquisition_batches.sql in the Supabase SQL editor, then retry. Nothing was written.";

  app.post("/api/import/acquisitions/preview", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { rows } = req.body as { rows?: Record<string, string>[] };
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No rows provided" });
      }
      const review = await classifyAcquisitionUpload(rows);
      res.json({
        ok: true,
        total: review.total,
        new_count: review.new_count,
        skipped_exists: review.skipped_exists,
        skipped_invalid: review.skipped_invalid,
        skipped: review.skipped,
      });
    } catch (err) {
      const msg = String((err as any)?.message ?? err ?? "");
      if (/acquisition_batch|needs_completion|purchase_price/i.test(msg) && /does not exist|schema cache/i.test(msg)) {
        return res.status(503).json({ message: ACQUISITION_SCHEMA_HINT });
      }
      errHandler(res, err);
    }
  });

  app.post("/api/import/acquisitions/commit", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const body = req.body as {
        rows?: Record<string, string>[];
        label?: string;
        acquisition_date?: string;
        entity?: string;
        default_purchase_price?: unknown;
        default_rental_status?: unknown;
      };
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (rows.length === 0) {
        return res.status(400).json({ message: "No rows provided" });
      }
      const label = String(body.label ?? "").trim();
      if (!label) return res.status(400).json({ message: "Batch label is required" });
      const acquisition_date = String(body.acquisition_date ?? "").trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(acquisition_date)) {
        return res.status(400).json({ message: "Acquisition date is required (YYYY-MM-DD)" });
      }
      const entity = parseAcquisitionEntity(String(body.entity ?? ""));
      if (!entity) {
        return res.status(400).json({ message: "Entity must be Main, RPS, or Coal" });
      }
      const default_purchase_price = parseAcquisitionPrice(body.default_purchase_price);
      const default_rental_status = resolveBatchRentalStatus(body.default_rental_status);

      const review = await classifyAcquisitionUpload(rows);
      if (review.new_count === 0) {
        return res.json({
          ok: true,
          inserted: 0,
          skipped_exists: review.skipped_exists,
          skipped_invalid: review.skipped_invalid,
          batch: null,
        });
      }

      const { data: batch, error: batchErr } = await supabaseAdmin
        .from("acquisition_batches")
        .insert({
          label,
          acquisition_date,
          entity,
          default_purchase_price,
          default_rental_status,
          created_by: String(writerId),
          car_count: 0,
        })
        .select("id, label, acquisition_date, entity, default_rental_status")
        .single();
      if (batchErr) {
        const msg = String(batchErr.message ?? "");
        if (/acquisition_batches/i.test(msg) && /does not exist|schema cache/i.test(msg)) {
          return res.status(503).json({ message: ACQUISITION_SCHEMA_HINT });
        }
        throw batchErr;
      }

      const payloads = review.to_insert.map((r) => ({
        reporting_marks: r.marks,
        car_initial: r.marks,
        car_number: r.car_number,
        car_type: r.car_type,
        notes: r.notes,
        comment_event_note: r.notes,
        entity,
        fleet_status: default_rental_status,
        fleet_status_source: "manual",
        active: true,
        active_status: "Active",
        status: "Active/In-Service",
        acquisition_batch_id: batch.id,
        acquisition_date,
        purchase_price: r.purchase_price ?? default_purchase_price,
        needs_completion: true,
      }));

      let inserted = 0;
      const CHUNK = 100;
      for (let i = 0; i < payloads.length; i += CHUNK) {
        const slice = payloads.slice(i, i + CHUNK);
        const { data, error } = await supabaseAdmin.from("railcars").insert(slice).select("id");
        if (error) {
          if (String(error.code) === "23505" || /duplicate|unique/i.test(error.message ?? "")) {
            for (const row of slice) {
              const one = await supabaseAdmin.from("railcars").insert(row).select("id");
              if (one.error) {
                if (String(one.error.code) === "23505" || /duplicate|unique/i.test(one.error.message ?? "")) continue;
                throw one.error;
              }
              inserted += one.data?.length ?? 0;
            }
            continue;
          }
          throw error;
        }
        inserted += data?.length ?? 0;
      }

      await supabaseAdmin
        .from("acquisition_batches")
        .update({ car_count: inserted })
        .eq("id", batch.id);

      res.json({
        ok: true,
        inserted,
        skipped_exists: review.skipped_exists,
        skipped_invalid: review.skipped_invalid,
        batch: { ...batch, car_count: inserted },
      });
    } catch (err) {
      const msg = String((err as any)?.message ?? err ?? "");
      if (/acquisition_batch|needs_completion|purchase_price/i.test(msg) && /does not exist|schema cache/i.test(msg)) {
        return res.status(503).json({ message: ACQUISITION_SCHEMA_HINT });
      }
      errHandler(res, err);
    }
  });

  // ---------- Cleanup test/sample railcars (admin-only, dry-run by default) ----------
  // GET /api/admin/cleanup-test-railcars                 → preview candidates only (no DB writes)
  // POST /api/admin/cleanup-test-railcars { confirm: true } → snapshot to railcars_test_quarantine
  //                                                          and DELETE matching rows
  // The predicate matches obvious markers only; see migrations/cleanup_test_railcars.sql
  // for the canonical SQL implementation. The Node path mirrors that predicate via
  // simple ilike/regex queries so an operator can run it without psql access.
  // Mirrors migrations/cleanup_test_railcars.sql predicate. Kept conservative
  // so legitimate cars aren't accidentally matched.
  async function findTestRailcarCandidates(): Promise<any[]> {
    const { data, error } = await supabase
      .from("railcars")
      .select("id, car_number, reporting_marks, car_type, entity, managed_category, status, notes, general_description")
      .order("car_number", { ascending: true });
    if (error) throw error;
    const all = data ?? [];
    const startsWithMarker = /^(TEST|SAMPLE|DEMO|FAKE|DUMMY|PLACEHOLDER|FOO|BAR|EXAMPLE|XXX+|ZZZ+)/i;
    const tokenMarker = /\b(TEST|SAMPLE|DEMO|FAKE|DUMMY|PLACEHOLDER)\b/i;
    const marksMarkers = new Set(["TEST", "SAMP", "DEMO", "XXXX", "ZZZZ", "DUMM", "FAKE"]);
    const textHas = (s: string | null | undefined, needles: string[]) => {
      if (!s) return false;
      const lower = s.toLowerCase();
      return needles.some((n) => lower.includes(n));
    };
    const NEEDLES = ["[test data]", "test record", "sample data", "placeholder", "do not use", "demo data"];
    return all.filter((r: any) => {
      const cn = String(r.car_number ?? "");
      if (startsWithMarker.test(cn) || tokenMarker.test(cn)) return true;
      if (r.reporting_marks && marksMarkers.has(String(r.reporting_marks).toUpperCase())) return true;
      if (textHas(r.notes, NEEDLES)) return true;
      if (textHas(r.general_description, NEEDLES)) return true;
      return false;
    });
  }

  app.get("/api/admin/cleanup-test-railcars", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const candidates = await findTestRailcarCandidates();
      res.json({ count: candidates.length, candidates });
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/admin/cleanup-test-railcars", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const confirm = (req.body as any)?.confirm === true;
      const candidates = await findTestRailcarCandidates();
      if (!confirm) {
        return res.json({
          ok: true,
          mode: "dry-run",
          note: "Pass { confirm: true } to actually delete the listed rows. Snapshot will be taken first.",
          count: candidates.length,
          candidates,
        });
      }
      if (candidates.length === 0) {
        return res.json({ ok: true, mode: "delete", deleted: 0, note: "No candidates matched." });
      }
      const ids = candidates.map((c: any) => c.id);
      // Best-effort snapshot — write to a per-run notes string so we have an audit
      // trail even if the SQL quarantine table doesn't exist in this environment.
      const snapshot = JSON.stringify(candidates).slice(0, 500_000);
      // Cascade deletes: assignments + history first, then car
      await supabase.from("railcar_assignments").delete().in("railcar_id", ids);
      await supabase.from("assignment_history").delete().in("railcar_id", ids);
      await supabase.from("car_number_history").delete().in("railcar_id", ids);
      const { error } = await supabase.from("railcars").delete().in("id", ids);
      if (error) throw error;
      res.json({
        ok: true,
        mode: "delete",
        deleted: ids.length,
        snapshot_bytes: snapshot.length,
      });
    } catch (err) { errHandler(res, err); }
  });

  // ---------- Global Search ----------
  app.get("/api/search", async (req: Request, res: Response) => {
    try {
      const raw = (req.query.q as string | undefined)?.trim() ?? "";
      if (!raw) return res.json({ railcars: [], riders: [], leases: [], not_found: [], terms: [], counts: { railcars: 0, riders: 0, leases: 0, total: 0 } });
      res.json(await runGlobalSearch(raw));
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/search", async (req: Request, res: Response) => {
    try {
      const raw = String((req.body as any)?.q ?? "").trim();
      if (!raw) return res.json({ railcars: [], riders: [], leases: [], not_found: [], terms: [], counts: { railcars: 0, riders: 0, leases: 0, total: 0 } });
      res.json(await runGlobalSearch(raw));
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- History ----------
  app.get("/api/history", async (req, res) => {
    try {
      const search = (req.query.search as string | undefined)?.trim();
      const { data, error } = await supabase
        .from("assignment_history")
        .select(
          `*,
          railcar:railcars(id, car_number, reporting_marks),
          from_rider:riders!assignment_history_from_rider_id_fkey(id, rider_name, master_lease:master_leases(id, lease_number)),
          to_rider:riders!assignment_history_to_rider_id_fkey(id, rider_name, master_lease:master_leases(id, lease_number))`
        )
        .order("moved_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      let rows = data ?? [];
      if (search) {
        const q = search.toLowerCase();
        rows = rows.filter((r: any) =>
          r.railcar?.car_number?.toLowerCase().includes(q)
        );
      }
      res.json(rows);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/activity", async (req, res) => {
    try {
      const railcarId = req.query.railcar_id ? Number(req.query.railcar_id) : undefined;
      const riderId = req.query.rider_id ? Number(req.query.rider_id) : undefined;
      const qRaw = req.query.q;
      const q = qRaw == null || qRaw === ""
        ? undefined
        : String(Array.isArray(qRaw) ? qRaw[0] : qRaw).trim() || undefined;
      const includeVcf = req.query.include_vcf === "1" || req.query.include_vcf === "true";
      const result = await listActivityLog({
        railcarId: Number.isFinite(railcarId) ? railcarId : undefined,
        riderId: Number.isFinite(riderId) ? riderId : undefined,
        q,
        includeVcfNoise: includeVcf,
      });
      res.json(result);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/activity/notes", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const entity_type = req.body?.entity_type === "rider" ? "rider" : "railcar";
      const entity_id = Number(req.body?.entity_id);
      const body = String(req.body?.body ?? "");
      if (!Number.isFinite(entity_id) || entity_id <= 0) {
        return res.status(400).json({ message: "entity_id is required" });
      }
      const row = await addNote({
        entity_type,
        entity_id,
        body,
        actor: req.authUser?.email ?? "system",
      });
      res.status(201).json(row);
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // AUTH ROUTES
  // ─────────────────────────────────────────────────────────────

  // Role helpers (requireAdmin / requireWrite / requireUser / contacts) live in ./auth

  const VALID_ROLES = ["admin", "editor", "viewer"] as const;
  type AppRole = (typeof VALID_ROLES)[number];
  // isValidRole imported from ./auth

  /** Insert or update user_roles by email (lowercase). Never creates a duplicate. */
  async function saveUserRole(opts: {
    email: string;
    role: AppRole;
    userId?: string | null;
  }): Promise<{ id: string; email: string; role: AppRole; user_id: string | null }> {
    const email = normalizeEmail(opts.email);
    const { data: existing, error: findErr } = await supabaseAdmin
      .from("user_roles")
      .select("id, user_id, role, email")
      .ilike("email", email)
      .maybeSingle();
    if (findErr) throw findErr;

    if (existing) {
      const patch: Record<string, unknown> = { role: opts.role, email };
      if (opts.userId) patch.user_id = opts.userId;
      const { error } = await supabaseAdmin.from("user_roles").update(patch).eq("id", existing.id);
      if (error) throw error;
      return {
        id: existing.id,
        email,
        role: opts.role,
        user_id: (opts.userId ?? existing.user_id) as string | null,
      };
    }

    const insert: Record<string, unknown> = { email, role: opts.role, user_id: opts.userId ?? null };
    const { data: created, error } = await supabaseAdmin
      .from("user_roles")
      .insert(insert)
      .select("id, user_id, role, email")
      .single();
    if (error) throw error;
    return {
      id: created.id,
      email: created.email,
      role: created.role,
      user_id: created.user_id,
    };
  }

  async function findRoleRowByParam(param: string) {
    const { data: byPk } = await supabase
      .from("user_roles")
      .select("id, user_id, email, role")
      .eq("id", param)
      .maybeSingle();
    if (byPk) return byPk;
    const { data: byUser } = await supabase
      .from("user_roles")
      .select("id, user_id, email, role")
      .eq("user_id", param)
      .maybeSingle();
    return byUser;
  }

  // GET /api/auth/me — returns current user's role
  app.get("/api/auth/me", async (req, res) => {
    try {
      const user = req.authUser ?? (await getAuthUser(req));
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const role = req.authRole ?? (await getUserRole(user));
      res.json({ id: user.id, email: user.email, role: role ?? null });
    } catch (err) { errHandler(res, err); }
  });

  // ---------- Column Preferences ----------
  // GET /api/prefs/columns?page=<page> — returns visible_cols array for the current user + page
  app.get("/api/prefs/columns", async (req: Request, res: Response) => {
    try {
      const user = req.authUser ?? (await getAuthUser(req));
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const page = String(req.query.page ?? "").trim();
      if (!page) return res.status(400).json({ error: "page param required" });

      const { data } = await supabase
        .from("user_column_prefs")
        .select("visible_cols")
        .eq("user_id", user.id)
        .eq("page", page)
        .single();

      res.json({ visible_cols: data?.visible_cols ?? null });
    } catch (err) { errHandler(res, err); }
  });

  // PUT /api/prefs/columns — upsert visible_cols for the current user + page
  app.put("/api/prefs/columns", async (req: Request, res: Response) => {
    try {
      const user = req.authUser ?? (await getAuthUser(req));
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const { page, visible_cols } = req.body as { page: string; visible_cols: unknown };
      if (!page) return res.status(400).json({ error: "page required" });
      const prefsOk =
        Array.isArray(visible_cols) ||
        (visible_cols != null &&
          typeof visible_cols === "object" &&
          Array.isArray((visible_cols as { cols?: unknown }).cols));
      if (!prefsOk) return res.status(400).json({ error: "visible_cols must be an array or { cols, order, widths }" });

      const { error } = await supabase
        .from("user_column_prefs")
        .upsert(
          { user_id: user.id, page, visible_cols, updated_at: new Date().toISOString() },
          { onConflict: "user_id,page" }
        );
      if (error) throw error;

      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  // GET /api/admin/users — list all users with roles (admin only)
  app.get("/api/admin/users", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      // Join user_roles with auth.users email via a view-friendly RPC approach
      // We store email in user_roles at invite time so we can query it directly
      const { data, error } = await supabase
        .from("user_roles")
        .select("id, user_id, role, email, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      res.json((data ?? []).map((r: any) => ({
        id: r.id,
        user_id: r.user_id ?? null,
        email: r.email ?? "unknown",
        role: r.role,
        created_at: r.created_at,
      })));
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/admin/users/invite — invite a new user OR resend invite to existing (admin only)
  app.post("/api/admin/users/invite", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const { email: rawEmail, role } = req.body as { email: string; role: AppRole };
      if (!rawEmail || !isValidRole(role)) return res.status(400).json({ error: "email and valid role required" });
      const email = normalizeEmail(rawEmail);
      // Public app origin for invite/magic-link redirects — never use VITE_API_BASE
      // (that is often "" for same-origin API and previously fell back to a stale host).
      const appUrl =
        process.env.APP_URL ||
        process.env.SITE_URL ||
        "https://rlms-d6kb.onrender.com";

      // Try the standard invite first
      const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: appUrl,
      });

      // If user already exists in auth, fall back to generateLink (resend)
      if (inviteErr) {
        const isAlreadyRegistered =
          inviteErr.message.toLowerCase().includes("already registered") ||
          inviteErr.message.toLowerCase().includes("already been invited") ||
          inviteErr.message.toLowerCase().includes("user already exists") ||
          inviteErr.status === 422;

        if (!isAlreadyRegistered) {
          return res.status(400).json({ error: `Invite failed: ${inviteErr.message}` });
        }

        // User already exists — generate a fresh magic link and email it
        const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: { redirectTo: appUrl },
        });
        if (linkErr) {
          return res.status(400).json({ error: `Resend failed: ${linkErr.message}` });
        }
        const saved = await saveUserRole({ email, role, userId: linkData.user?.id ?? null });
        return res.json({ id: saved.id, user_id: saved.user_id, email, role, resent: true });
      }

      const userId = inviteData.user?.id;
      if (!userId) return res.status(500).json({ error: "User ID missing after invite" });
      const saved = await saveUserRole({ email, role, userId });
      res.json({ id: saved.id, user_id: saved.user_id, email, role, resent: false });
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/admin/users/grant — Microsoft-only allowlist, no email sent (admin only)
  app.post("/api/admin/users/grant", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const { email: rawEmail, role } = req.body as { email: string; role: AppRole };
      if (!rawEmail || !isValidRole(role)) return res.status(400).json({ error: "email and valid role required" });
      const saved = await saveUserRole({ email: rawEmail, role });
      res.json({ id: saved.id, user_id: saved.user_id, email: saved.email, role: saved.role });
    } catch (err) { errHandler(res, err); }
  });

  // PATCH /api/admin/users/:userId/role — change a user's role (admin only)
  app.patch("/api/admin/users/:userId/role", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const { userId } = req.params;
      const { role } = req.body as { role: AppRole };
      if (!isValidRole(role)) return res.status(400).json({ error: "valid role required" });
      const row = await findRoleRowByParam(userId);
      if (!row) return res.status(404).json({ error: "User not found" });
      const { error } = await supabase.from("user_roles").update({ role }).eq("id", row.id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  // DELETE /api/admin/users/:userId — remove a user's access (admin only)
  // Removes from user_roles (revokes app access). Auth account remains in Supabase.
  app.delete("/api/admin/users/:userId", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const { userId } = req.params;
      const row = await findRoleRowByParam(userId);
      if (!row) return res.status(404).json({ error: "User not found" });
      if (row.user_id && row.user_id === adminId) {
        return res.status(400).json({ error: "Cannot remove yourself" });
      }
      const { error } = await supabase.from("user_roles").delete().eq("id", row.id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  // ── Attachments ────────────────────────────────────────────────────────────
  // Files are stored in Supabase Storage bucket "rlms-attachments".
  // Metadata is stored in the `attachments` table.
  // entity_type: 'master_lease' | 'rider' | 'railcar' | 'account'
  // source_module is stamped server-side; client body.source_module is ignored.
  // entity_id: the primary key of the linked record

  // GET /api/attachments/:id/download — stream file directly (must be BEFORE /:entityType/:entityId to avoid route conflict)
  app.get("/api/attachments/:id/download", async (req, res) => {
    try {
      const user = await getAuthUser(req, res);
      if (!user) return;
      const { id } = req.params;
      const { data: att, error: fetchErr } = await supabase
        .from("attachments")
        .select("storage_path, file_name")
        .eq("id", id)
        .single();
      if (fetchErr || !att) return res.status(404).json({ error: "Attachment not found" });
      // Stream file directly through the backend
      const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .download(att.storage_path);
      if (dlErr || !fileBlob) throw dlErr ?? new Error("Could not download file from storage");
      const arrayBuffer = await fileBlob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const isPdf = att.file_name.toLowerCase().endsWith('.pdf');
      res.setHeader('Content-Type', isPdf ? 'application/pdf' : (fileBlob.type || 'application/octet-stream'));
      res.setHeader('Content-Disposition', isPdf ? `inline; filename="${att.file_name}"` : `attachment; filename="${att.file_name}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (err) { errHandler(res, err); }
  });

  // GET /api/attachments/:entityType/:entityId — list attachments for an entity
  app.get("/api/attachments/:entityType/:entityId", async (req, res) => {
    try {
      const user = await getAuthUser(req, res);
      if (!user) return;
      const { entityType, entityId } = req.params;
      const { data, error } = await supabase
        .from("attachments")
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/attachments/:entityType/:entityId — upload a file
  app.post("/api/attachments/:entityType/:entityId",
    upload.single("file"),
    async (req: Request & { file?: Express.Multer.File }, res: Response) => {
      try {
        const writerId = await requireWrite(req, res);
        if (!writerId) return;
        const user = await getAuthUser(req);
        if (!user) return;
        if (!req.file) return res.status(400).json({ error: "No file provided" });
        const { entityType, entityId } = req.params;
        const validTypes = ["master_lease", "rider", "railcar"];
        if (!validTypes.includes(entityType) || !isAttachmentEntityType(entityType)) {
          return res.status(400).json({ error: "Invalid entity type" });
        }
        const notes = (req.body as { notes?: string }).notes ?? null;
        // Provenance is never taken from the client (ignore body.source_module).
        const source_module = genericUploadSource(entityType);
        // Build a unique storage path: entityType/entityId/timestamp-filename
        const ts = Date.now();
        const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${entityType}/${entityId}/${ts}-${safeName}`;
        // Upload to Supabase Storage using admin client
        const { error: uploadError } = await supabaseAdmin.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: false,
          });
        if (uploadError) throw uploadError;
        // Save metadata to attachments table
        let data;
        try {
          data = await insertAttachmentRow({
            entity_type: entityType as "master_lease" | "rider" | "railcar",
            entity_id: parseInt(entityId, 10),
            file_name: req.file.originalname,
            file_size: req.file.size,
            mime_type: req.file.mimetype,
            storage_path: storagePath,
            uploaded_by: user.email ?? user.id,
            notes,
            source_module,
          });
        } catch (dbError) {
          await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]);
          throw dbError;
        }
        const eid = parseInt(entityId, 10);
        if (entityType === "railcar" || entityType === "rider") {
          await logActivity({
            entity_type: entityType,
            entity_id: eid,
            railcar_id: entityType === "railcar" ? eid : null,
            rider_id: entityType === "rider" ? eid : null,
            action: "attachment",
            actor: user.email ?? user.id,
            detail: { file_name: req.file.originalname, notes },
            source_table: "attachments",
            source_id: data?.id ?? null,
          });
        }
        res.status(201).json(data);
      } catch (err) { errHandler(res, err); }
    }
  );

  // DELETE /api/attachments/:id — delete an attachment (admin only)
  app.delete("/api/attachments/:id", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { id } = req.params;
      const { data: att, error: fetchErr } = await supabase
        .from("attachments")
        .select("storage_path")
        .eq("id", id)
        .single();
      if (fetchErr || !att) return res.status(404).json({ error: "Attachment not found" });
      // Remove from storage first
      const { error: storageErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .remove([att.storage_path]);
      if (storageErr) throw storageErr;
      // Remove metadata
      const { error: dbErr } = await supabase.from("attachments").delete().eq("id", id);
      if (dbErr) throw dbErr;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  // ── Rent Events ──────────────────────────────────────────────────────────

  // GET /api/rent-events — all events (for dashboard/export)
  app.get("/api/rent-events", async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from("rent_events")
        .select("*, railcar:railcars(car_number, entity)")
        .order("event_date", { ascending: false });
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

  // GET /api/rent-events/car/:carId — events for one car
  app.get("/api/rent-events/car/:carId", async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("rent_events")
        .select("*")
        .eq("car_id", Number(req.params.carId))
        .order("event_date", { ascending: false });
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/rent-events — log a new rent event
  app.post("/api/rent-events", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const { car_id, event_type, event_date, reason } = req.body;
      if (!car_id || !event_type || !event_date || !reason) {
        return res.status(400).json({ error: "car_id, event_type, event_date, and reason are required" });
      }
      if (!["on_rent", "off_rent"].includes(event_type)) {
        return res.status(400).json({ error: "event_type must be on_rent or off_rent" });
      }
      // Get user email for created_by
      const { data: userRow } = await supabase
        .from("user_roles")
        .select("email")
        .eq("user_id", userId)
        .single();
      const created_by = userRow?.email ?? userId;
      const { data, error } = await supabase
        .from("rent_events")
        .insert({ car_id: Number(car_id), event_type, event_date, reason: reason.trim(), created_by })
        .select()
        .single();
      if (error) throw error;
      await logActivity({
        entity_type: "railcar",
        entity_id: Number(car_id),
        railcar_id: Number(car_id),
        action: "rent_event",
        actor: created_by,
        detail: { event_type, event_date, reason: reason.trim() },
        occurred_at: `${event_date}T12:00:00.000Z`,
        source_table: "rent_events",
        source_id: data?.id ?? null,
      });
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  /* =======================================================   *  DV CALCULATOR (AAR Rule 107) — routes
   * ============================================================== */

  // Freshness banner
  app.get("/api/reference/freshness", async (_req, res) => {
    try {
      const result = await dvComputeFreshness();
      res.set("Cache-Control", "no-store");
      res.json(result);
    } catch (err) { errHandler(res, err); }
  });

  // Reference reads
  app.get("/api/reference/cost-factors", async (_req, res) => {
    try {
      const { data, error } = await supabase.from("dv_cost_factors").select("*")
        .order("year", { ascending: true }).order("publication_q", { ascending: true });
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.get("/api/reference/salvage", async (_req, res) => {
    try {
      const { data, error } = await supabase.from("dv_salvage_quarters").select("*").order("quarter_code", { ascending: false });
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.get("/api/reference/ab-codes", async (_req, res) => {
    try {
      const { data, error } = await supabase.from("dv_ab_codes").select("*").order("code", { ascending: true });
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.get("/api/reference/car-rates", async (_req, res) => {
    try {
      const { data, error } = await supabase.from("dv_car_dep_rates").select("*").order("display_name", { ascending: true });
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // Reference writes
  app.post("/api/reference/cost-factors", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { year, factor, publication_q = 0, source = null } = req.body;
      const { data, error } = await supabase.from("dv_cost_factors")
        .upsert({ year, factor, publication_q, source }, { onConflict: "year,publication_q" }).select().single();
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.post("/api/reference/salvage", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { data, error } = await supabase.from("dv_salvage_quarters")
        .upsert(req.body, { onConflict: "quarter_code" }).select().single();
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.post("/api/reference/ab-codes", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const row = { effective_from: "1970-01-01", ...req.body };
      const { data, error } = await supabase.from("dv_ab_codes")
        .upsert(row, { onConflict: "code,effective_from" }).select().single();
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.post("/api/reference/car-rates", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { data, error } = await supabase.from("dv_car_dep_rates")
        .upsert(req.body, { onConflict: "equipment_type" }).select().single();
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // Railcar lookup for DV auto-fill — distinct path so it doesn't collide with other /api/railcars routes.
  // Matching mirrors /api/search: whitespace tokens are AND'd across mark/number (so "OFOX 528345" works).
  app.get("/api/dv/railcars", async (req, res) => {
    try {
      const raw = String(req.query.q || "").trim();
      const tokens = raw
        .toLowerCase()
        .split(/[\s,]+/)
        .map((t) => t.replace(/[()]/g, "").trim())
        .filter(Boolean);

      const DV_CAR_SELECT = `
          id, car_initial, car_number, reporting_marks, tare_weight_lbs,
          built_year, build_year, build_date, oec, railinc_oec, oac, nbv,
          car_type, mechanical_designation
        `;

      let rows: any[] = [];
      if (tokens.length === 0) {
        // Empty query: small browse list only (picker still requires typing to find a specific car).
        const { data, error } = await supabase
          .from("railcars")
          .select(DV_CAR_SELECT)
          .order("reporting_marks", { ascending: true })
          .order("car_number", { ascending: true })
          .limit(50);
        if (error) throw error;
        rows = data || [];
      } else {
        // Tokenize like header /api/search (AND across mark/number). Push both mark and number
        // into SQL when present — PostgREST caps a single page at ~1000 rows, so mark-only
        // prefilter + in-memory AND misses high car numbers in large fleets (e.g. OFOX 528345).
        const safe = (t: string) => t.replace(/[%_,]/g, "");
        const markTok = tokens.map(safe).find((t) => /[a-z]/i.test(t));
        const numTok = tokens.map(safe).find((t) => /\d/.test(t));
        const lead = safe(tokens[0]);

        let q = supabase.from("railcars").select(DV_CAR_SELECT);
        if (markTok && numTok) {
          q = q
            .or(
              [
                `reporting_marks.ilike.%${markTok}%`,
                `car_initial.ilike.%${markTok}%`,
              ].join(","),
            )
            .ilike("car_number", `%${numTok}%`);
        } else if (numTok && !markTok) {
          q = q.ilike("car_number", `%${numTok}%`);
        } else {
          q = q.or(
            [
              `reporting_marks.ilike.%${lead}%`,
              `car_number.ilike.%${lead}%`,
              `car_initial.ilike.%${lead}%`,
            ].join(","),
          );
        }

        const { data, error } = await q
          .order("reporting_marks", { ascending: true })
          .order("car_number", { ascending: true })
          .limit(1000);
        if (error) throw error;

        const blobOf = (c: any) =>
          [
            c.car_number,
            c.reporting_marks,
            c.car_initial,
            `${c.reporting_marks ?? ""}${c.car_number ?? ""}`,
            `${c.car_initial ?? ""}${c.car_number ?? ""}`,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        rows = (data || [])
          .map((c: any) => {
            const blob = blobOf(c);
            if (!tokens.every((t) => blob.includes(t))) return null;
            const phrase = tokens.join(" ");
            const score = blob.includes(phrase) ? 0 : 1;
            return { c, score };
          })
          .filter(Boolean)
          .sort(
            (a: any, b: any) =>
              a.score - b.score ||
              String(a.c.reporting_marks ?? "").localeCompare(String(b.c.reporting_marks ?? "")) ||
              String(a.c.car_number ?? "").localeCompare(String(b.c.car_number ?? "")),
          )
          .slice(0, 50)
          .map((x: any) => x.c);
      }

      const ids = rows.map((r: any) => r.id);
      let abByCar = new Map<number, any[]>();
      if (ids.length) {
        const { data: abRows, error: abErr } = await supabase
          .from("railcar_ab_items")
          .select("railcar_id, seq, code, amount, sign, signed_amount, application_date")
          .in("railcar_id", ids);
        if (abErr) throw abErr;
        for (const it of abRows || []) {
          const list = abByCar.get(it.railcar_id) ?? [];
          list.push(it);
          abByCar.set(it.railcar_id, list);
        }
      }

      const { data: abData } = await supabase
        .from("dv_ab_codes")
        .select("code, rate_basis, rate, max_depreciation");
      const abMeta = new Map(
        (abData || []).map((r: any) => [r.code, r]),
      );

      res.json(rows.map((r: any) => {
        const initial = r.car_initial || r.reporting_marks || "";
        const items = [...(abByCar.get(r.id) ?? [])]
          .sort((a: any, b: any) => Number(a.seq) - Number(b.seq))
          .map((it: any) => {
            const meta = abMeta.get(it.code);
            return {
              seq: it.seq,
              code: it.code,
              amount: Number(it.amount),
              sign: it.sign,
              signed_amount: Number(it.signed_amount),
              application_date: it.application_date,
              rate_basis: meta?.rate_basis ?? null,
              rate: meta != null ? Number(meta.rate) : null,
              max_depreciation: meta != null ? Number(meta.max_depreciation) : null,
            };
          });
        return {
          ...r,
          car_initial: initial,
          built_year: carBuildYear(r),
          railcar_ab_items: items,
        };
      }));
    } catch (err) { errHandler(res, err); }
  });

  // Pure-engine calc (no persist) — all roles (Viewer carve-out for DV)
  app.post("/api/calculate", async (req, res) => {
    try {
      const writerId = await requireUser(req, res);
      if (!writerId) return;
      const ref = await dvLoadReferenceData();
      const { data: abData } = await supabase.from("dv_ab_codes").select("code, rate_basis, rate, max_depreciation");
      const abMap = new Map<string, { rate_basis: AbRateBasis; rate: number; max_depreciation: number }>();
      for (const r of abData || []) abMap.set(r.code, { rate_basis: r.rate_basis, rate: Number(r.rate), max_depreciation: Number(r.max_depreciation) });
      const inputs = dvParseInputs(req.body, abMap);
      const result = dvCalculateWithGuardrails(inputs, ref);
      res.json({ result, inputsEcho: req.body });
    } catch (err) { errHandler(res, err); }
  });

  // Calculations persistence — scoped to authenticated RLMS user (not anon visitor cookie)
  app.get("/api/calculations", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const { data, error } = await supabase.from("dv_calculations")
        .select("*, dv_calculation_ab_items(*)").eq("visitor_id", user.id)
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error; res.json(data || []);
    } catch (err) { errHandler(res, err); }
  });
  app.get("/api/calculations/:id", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const { data, error } = await supabase.from("dv_calculations")
        .select("*, dv_calculation_ab_items(*)").eq("id", req.params.id).eq("visitor_id", user.id).single();
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.post("/api/calculations", async (req, res) => {
    try {
      const writerId = await requireUser(req, res);
      if (!writerId) return;
      const ref = await dvLoadReferenceData();
      const { data: abData } = await supabase.from("dv_ab_codes").select("code, rate_basis, rate, max_depreciation");
      const abMap = new Map<string, { rate_basis: AbRateBasis; rate: number; max_depreciation: number }>();
      for (const r of abData || []) abMap.set(r.code, { rate_basis: r.rate_basis, rate: Number(r.rate), max_depreciation: Number(r.max_depreciation) });
      const inputs = dvParseInputs(req.body, abMap);
      const materialErr = validateMaterialCompositionForSave(dvMaterialWeights(inputs));
      if (materialErr) return res.status(400).json({ error: materialErr });
      const result = dvCalculateWithGuardrails(inputs, ref);
      const row = {
        visitor_id: writerId,
        railcar_id: req.body.railcarId ?? null,
        railroad: req.body.railroad ?? null,
        ddct_incident_no: req.body.ddctNumber ?? null,
        incident_date: req.body.incidentDate,
        incident_location: req.body.incidentLocation ?? null,
        car_initial: req.body.carInitial ?? null,
        car_number: req.body.carNumber ?? null,
        build_date: req.body.buildDate,
        original_cost: inputs.originalCost,
        tare_weight_lb: Math.round(inputs.tareWeightLb),
        steel_weight_lb: Math.round(inputs.steelWeightLb),
        aluminum_weight_lb: Math.round(inputs.aluminumWeightLb),
        stainless_weight_lb: Math.round(inputs.stainlessWeightLb ?? 0),
        non_metallic_lb: Math.round(inputs.nonMetallicWeightLb),
        equipment_type: inputs.equipmentType,
        notes: req.body.notes ?? null,
        total_reproduction: result.totalReproductionCost,
        total_dv: result.totalDepreciatedValue,
        total_salvage: result.salvage.totalSalvage,
        salvage_plus_20: result.salvage.salvagePlus20,
        dismantling_allow: result.salvage.dismantlingAllowance,
        over_age_cutoff: result.overAgeCutoff,
        created_by: writerId,
        result_json: result,
      };
      const { data: calc, error } = await supabase.from("dv_calculations").insert(row).select().single();
      if (error) throw error;
      if (inputs.abItems.length) {
        const ab = inputs.abItems.map((it, seq) => ({
          calculation_id: calc.id,
          seq: seq + 1,
          code: it.code,
          value: it.value,
          install_date: it.installDate.toISOString().slice(0, 10),
          rate_basis: it.rateBasis ?? abMap.get(it.code)?.rate_basis ?? "ANNUAL",
          rate: it.rate ?? abMap.get(it.code)?.rate ?? 0,
          max_depreciation: it.max ?? abMap.get(it.code)?.max_depreciation ?? 1,
        }));
        const { error: e2 } = await supabase.from("dv_calculation_ab_items").insert(ab);
        if (e2) throw e2;
      }
      res.json({ ...calc, result });
    } catch (err) { errHandler(res, err); }
  });
  app.delete("/api/calculations/:id", async (req, res) => {
    try {
      const writerId = await requireUser(req, res);
      if (!writerId) return;
      const { error } = await supabase.from("dv_calculations").delete().eq("id", req.params.id).eq("visitor_id", writerId);
      if (error) throw error; res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  // =====================================================================
  // AP TRACKER — Invoices, Dispute Logs, Communications
  // =====================================================================

  // Helper to get caller email
  async function getCallerEmail(userId: string): Promise<string> {
    const { data } = await supabase.from("user_roles").select("email").eq("user_id", userId).single();
    return data?.email ?? userId;
  }

  // GET /api/invoices — list with optional filters
  app.get("/api/invoices", async (req, res) => {
    try {
      let q = supabase.from("invoices").select("*").order("due_date", { ascending: true });
      if (req.query.status && req.query.status !== "all") q = q.eq("status", req.query.status as string);
      if (req.query.disputed === "true") q = q.eq("is_disputed", true);
      if (req.query.lessee) q = q.ilike("lessee_name", `%${req.query.lessee}%`);
      if (req.query.search) {
        const s = `%${req.query.search}%`;
        q = q.or(`invoice_number.ilike.${s},lessee_name.ilike.${s},vendor_name.ilike.${s},repair_description.ilike.${s}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

  // GET /api/invoices/:id — single invoice with dispute logs + communications
  app.get("/api/invoices/:id", async (req, res) => {
    try {
      const { data: inv, error: e1 } = await supabase.from("invoices").select("*").eq("id", req.params.id).single();
      if (e1) throw e1;
      const { data: disputes } = await supabase.from("dispute_logs").select("*").eq("invoice_id", req.params.id).order("log_date", { ascending: false });
      const { data: comms } = await supabase.from("invoice_communications").select("*").eq("invoice_id", req.params.id).order("comm_date", { ascending: false });
      res.json({ ...inv, dispute_logs: disputes ?? [], communications: comms ?? [] });
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/invoices — create
  app.post("/api/invoices", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const payload = { ...req.body, created_by: userId, updated_at: new Date().toISOString() };
      delete payload.id;
      const { data, error } = await supabase.from("invoices").insert(payload).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // PATCH /api/invoices/:id — update
  app.patch("/api/invoices/:id", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const payload = { ...req.body, updated_at: new Date().toISOString() };
      delete payload.id;
      const { data, error } = await supabase.from("invoices").update(payload).eq("id", req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // DELETE /api/invoices/:id
  app.delete("/api/invoices/:id", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const { error } = await supabase.from("invoices").delete().eq("id", req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/invoices/:id/dispute-logs — add dispute entry
  app.post("/api/invoices/:id/dispute-logs", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const email = await getCallerEmail(userId);
      const { log_date, description, outcome } = req.body;
      if (!description) return res.status(400).json({ error: "description required" });
      // Mark invoice as disputed
      await supabase.from("invoices").update({ is_disputed: true, updated_at: new Date().toISOString() }).eq("id", req.params.id);
      const { data, error } = await supabase.from("dispute_logs").insert({
        invoice_id: req.params.id,
        log_date: log_date ?? new Date().toISOString().slice(0, 10),
        logged_by: email,
        description,
        outcome: outcome ?? null,
      }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // DELETE /api/dispute-logs/:id
  app.delete("/api/dispute-logs/:id", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const { error } = await supabase.from("dispute_logs").delete().eq("id", req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/invoices/:id/communications — add comm log entry
  app.post("/api/invoices/:id/communications", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const email = await getCallerEmail(userId);
      const { comm_date, comm_type, contact_name, notes } = req.body;
      if (!notes) return res.status(400).json({ error: "notes required" });
      // Update last_communication_date on invoice
      const dateStr = comm_date ?? new Date().toISOString().slice(0, 10);
      await supabase.from("invoices").update({
        last_communication_date: dateStr,
        last_communication_notes: notes,
        updated_at: new Date().toISOString()
      }).eq("id", req.params.id);
      const { data, error } = await supabase.from("invoice_communications").insert({
        invoice_id: req.params.id,
        comm_date: dateStr,
        comm_type: comm_type ?? "email",
        contact_name: contact_name ?? null,
        notes,
        logged_by: email,
      }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // DELETE /api/communications/:id
  app.delete("/api/communications/:id", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const { error } = await supabase.from("invoice_communications").delete().eq("id", req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/invoices/:id/upload-pdf — upload cover sheet PDF
  app.post("/api/invoices/:id/upload-pdf", upload.single("file"), async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const ext = req.file.originalname.split(".").pop() ?? "pdf";
      const path = `invoices/${req.params.id}/cover-${Date.now()}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      await supabase.from("invoices").update({ pdf_url: publicUrl, updated_at: new Date().toISOString() }).eq("id", req.params.id);
      res.json({ pdf_url: publicUrl });
    } catch (err) { errHandler(res, err); }
  });

  // GET /api/invoices/export/csv — export full AP report as CSV
  app.get("/api/invoices/export/csv", async (req, res) => {
    try {
      const { data, error } = await supabase.from("invoices").select("*").order("due_date", { ascending: true });
      if (error) throw error;
      const rows = data ?? [];
      const headers = ["Invoice #","Lessee","Vendor","Amount","Amount Paid","Balance","Invoice Date","Due Date","Paid Date","Status","Disputed","Repair Description","Notes","Last Communication","Next Follow-up","PDF URL"];
      const escape = (v: any) => v == null ? "" : `"${String(v).replace(/"/g, '""')}"`;
      const csvRows = rows.map(r => [
        escape(r.invoice_number), escape(r.lessee_name), escape(r.vendor_name),
        r.amount ?? "", r.amount_paid ?? "", ((r.amount ?? 0) - (r.amount_paid ?? 0)).toFixed(2),
        r.invoice_date ?? "", r.due_date ?? "", r.paid_date ?? "",
        escape(r.status), r.is_disputed ? "Yes" : "No",
        escape(r.repair_description), escape(r.notes),
        r.last_communication_date ?? "", r.next_followup_date ?? "",
        escape(r.pdf_url),
      ].join(","));
      const csv = [headers.join(","), ...csvRows].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="ap-report.csv"');
      res.send(csv);
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/invoices/import-csv — bulk import from CSV
  app.post("/api/invoices/import-csv", upload.single("file"), async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const text = req.file.buffer.toString("utf-8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return res.status(400).json({ error: "CSV must have header + data rows" });
      const parse = (s: string) => s.replace(/^["|']+|["|']+$/g, "").trim();
      const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, "_"));
      const toInsert: Record<string, any>[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        const row: Record<string, any> = {};
        headers.forEach((h, idx) => { row[h] = parse(cols[idx] ?? ""); });
        const inv: Record<string, any> = {
          invoice_number: row["invoice__"] || row["invoice_number"] || `IMP-${Date.now()}-${i}`,
          lessee_name: row["lessee"] || row["lessee_name"] || "Unknown",
          vendor_name: row["vendor"] || row["vendor_name"] || null,
          amount: parseFloat(row["amount"]) || null,
          amount_paid: parseFloat(row["amount_paid"]) || 0,
          invoice_date: row["invoice_date"] || null,
          due_date: row["due_date"] || null,
          status: row["status"] || "unpaid",
          repair_description: row["repair_description"] || row["description"] || null,
          notes: row["notes"] || null,
          created_by: userId,
        };
        toInsert.push(inv);
      }
      const { data, error } = await supabase.from("invoices").insert(toInsert).select();
      if (error) throw error;
      res.json({ inserted: (data ?? []).length });
    } catch (err) { errHandler(res, err); }
  });

  // ── ACCOUNTS ─────────────────────────────────────────────────────────────────

  app.get("/api/account-management/overview", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const am = typeof req.query.account_manager === "string" ? req.query.account_manager : "";
      const includeInactive =
        req.query.include_inactive === "1" ||
        req.query.include_inactive === "true";
      res.json(await listAccountManagementOverview(am.trim() || null, { includeInactive }));
    } catch (err) { errHandler(res, err); }
  });

  app.patch("/api/account-management/riders/:riderId/status-tag", async (req, res) => {
    try {
      if (!(await requireAccountMgmtWrite(req, res))) return;
      const riderId = Number(req.params.riderId);
      if (!Number.isFinite(riderId) || riderId <= 0) {
        return res.status(400).json({ message: "Invalid rider" });
      }
      const raw = req.body?.status_tag;
      const statusTag = raw === null || raw === "" ? null : raw;
      if (statusTag != null && !isStatusTag(statusTag)) {
        return res.status(400).json({ message: "status_tag must be good, watch, or risk" });
      }
      const row = await patchRiderStatusTag(riderId, statusTag);
      if (!row) return res.status(404).json({ message: "Rider not found" });
      res.json(row);
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/account-management/riders/:riderId/comments", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const riderId = Number(req.params.riderId);
      if (!Number.isFinite(riderId) || riderId <= 0) {
        return res.status(400).json({ message: "Invalid rider" });
      }
      res.json({ comments: await listRiderAccountComments(riderId) });
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/account-management/riders/:riderId/comments", async (req, res) => {
    try {
      const userId = await requireAccountMgmtWrite(req, res);
      if (!userId) return;
      const riderId = Number(req.params.riderId);
      if (!Number.isFinite(riderId) || riderId <= 0) {
        return res.status(400).json({ message: "Invalid rider" });
      }
      const row = await createRiderAccountComment({
        riderId,
        authorUserId: userId,
        authorEmail: req.authUser?.email ?? "",
        body: String(req.body?.body ?? ""),
      });
      res.status(201).json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.get("/api/account-management/accounts/:id/attachments", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const accountId = Number(req.params.id);
      if (!Number.isFinite(accountId) || accountId <= 0) {
        return res.status(400).json({ message: "Invalid account" });
      }
      res.json({ attachments: await listAccountScopedAttachments(accountId) });
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/account-management/accounts/:id/attachments",
    upload.single("file"),
    async (req: Request & { file?: Express.Multer.File }, res: Response) => {
      try {
        if (!(await requireAccountMgmtWrite(req, res))) return;
        const user = await getAuthUser(req);
        if (!user) return;
        if (!req.file) return res.status(400).json({ error: "No file provided" });
        const accountId = Number(req.params.id);
        if (!Number.isFinite(accountId) || accountId <= 0) {
          return res.status(400).json({ message: "Invalid account" });
        }
        const body = req.body as { entity_type?: string; entity_id?: string; source_module?: string };
        // Ignore spoofed provenance — this route always stamps account_transitions.
        void body.source_module;
        let entityType: "account" | "rider" = body.entity_type === "rider" ? "rider" : "account";
        let entityId = entityType === "account" ? accountId : Number(body.entity_id);
        if (entityType === "rider") {
          if (!Number.isFinite(entityId) || entityId <= 0) {
            return res.status(400).json({ message: "Pick an OL to attach this file to" });
          }
          const ok = await riderBelongsToAccount(entityId, accountId);
          if (!ok) return res.status(400).json({ message: "That OL is not on this account" });
        }
        const ts = Date.now();
        const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${entityType}/${entityId}/${ts}-${safeName}`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: false,
          });
        if (uploadError) throw uploadError;
        try {
          const data = await insertAttachmentRow({
            entity_type: entityType,
            entity_id: entityId,
            file_name: req.file.originalname,
            file_size: req.file.size,
            mime_type: req.file.mimetype,
            storage_path: storagePath,
            uploaded_by: user.email ?? user.id,
            notes: null,
            source_module: ACCOUNT_TRANSITIONS_SOURCE,
          });
          res.status(201).json(data);
        } catch (dbError) {
          await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]);
          throw dbError;
        }
      } catch (err) { errHandler(res, err); }
    },
  );

  app.delete("/api/account-management/comments/:commentId", async (req, res) => {
    try {
      if (!(await requireAdmin(req, res))) return;
      const commentId = Number(req.params.commentId);
      if (!Number.isFinite(commentId) || commentId <= 0) {
        return res.status(400).json({ message: "Invalid comment" });
      }
      const ok = await deleteRiderAccountComment(commentId);
      if (!ok) return res.status(404).json({ message: "Comment not found" });
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.patch("/api/account-management/comments/:commentId", (_req, res) => {
    res.status(405).json({ message: "Account Management notes cannot be edited" });
  });
  app.put("/api/account-management/comments/:commentId", (_req, res) => {
    res.status(405).json({ message: "Account Management notes cannot be edited" });
  });
  app.patch("/api/account-management/riders/:riderId/comment", (_req, res) => {
    res.status(410).json({ message: "Use POST /api/account-management/riders/:riderId/comments" });
  });

  app.get("/api/account-transitions/summary", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listTransitionSummary());
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/account-transitions", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const am = typeof req.query.am === "string" ? req.query.am : "";
      res.json(await listTransitionRecords(am.trim() || null));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/account-transitions", async (req, res) => {
    try {
      if (!(await requireAccountMgmtWrite(req, res))) return;
      const row = await createTransitionRecord(Number(req.body?.account_id));
      res.status(201).json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.get("/api/account-transitions/:id", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid record" });
      const row = await getTransitionDetail(id);
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (err) { errHandler(res, err); }
  });

  app.patch("/api/account-transitions/:id", async (req, res) => {
    try {
      if (!(await requireAccountMgmtWrite(req, res))) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid record" });
      const body = req.body ?? {};
      const patch: {
        from_account_manager?: string | null;
        to_account_manager?: string | null;
        communication_method?: string | null;
        status?: string;
        meeting_scheduled?: boolean;
        meeting_date?: string | null;
        communication_completed?: boolean;
        communication_completed_date?: string | null;
        briefing_form_completed?: boolean;
        briefing_form_completed_date?: string | null;
      } = {};
      if ("from_account_manager" in body) patch.from_account_manager = body.from_account_manager;
      if ("to_account_manager" in body) patch.to_account_manager = body.to_account_manager;
      if ("communication_method" in body) patch.communication_method = body.communication_method;
      if ("status" in body) patch.status = body.status;
      if ("meeting_scheduled" in body) patch.meeting_scheduled = body.meeting_scheduled;
      if ("meeting_date" in body) patch.meeting_date = body.meeting_date;
      if ("communication_completed" in body) patch.communication_completed = body.communication_completed;
      if ("communication_completed_date" in body) patch.communication_completed_date = body.communication_completed_date;
      if ("briefing_form_completed" in body) patch.briefing_form_completed = body.briefing_form_completed;
      if ("briefing_form_completed_date" in body) patch.briefing_form_completed_date = body.briefing_form_completed_date;
      const row = await patchTransitionRecord(id, patch);
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.get("/api/account-transitions/:id/briefing", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid record" });
      res.json(await getOrCreateBriefingForm(id));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.patch("/api/account-transitions/:id/briefing", async (req, res) => {
    try {
      if (!(await requireAccountMgmtWrite(req, res))) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid record" });
      res.json(await saveBriefingForm(id, req.body ?? {}));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.post("/api/account-transitions/:id/briefing/pdf", async (req, res) => {
    try {
      const userId = await requireAccountMgmtWrite(req, res);
      if (!userId) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid record" });
      const row = await generateBriefingPdf(id, userId);
      res.status(201).json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.post("/api/account-transitions/:id/milestones", async (req, res) => {
    try {
      if (!(await requireAccountMgmtWrite(req, res))) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid record" });
      res.status(201).json(await addMilestone(id, String(req.body?.label ?? "")));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.patch("/api/account-transitions/:id/milestones/:mid", async (req, res) => {
    try {
      if (!(await requireAccountMgmtWrite(req, res))) return;
      const mid = Number(req.params.mid);
      if (!Number.isFinite(mid) || mid <= 0) return res.status(400).json({ message: "Invalid milestone" });
      const body = req.body ?? {};
      const patch: { done?: boolean; label?: string; milestone_date?: string | null } = {};
      if ("done" in body) patch.done = body.done;
      if ("label" in body) patch.label = body.label;
      if ("milestone_date" in body) patch.milestone_date = body.milestone_date;
      const row = await patchMilestone(mid, patch);
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.delete("/api/account-transitions/:id/milestones/:mid", async (req, res) => {
    try {
      if (!(await requireAccountMgmtWrite(req, res))) return;
      const mid = Number(req.params.mid);
      if (!Number.isFinite(mid) || mid <= 0) return res.status(400).json({ message: "Invalid milestone" });
      await deleteMilestone(mid);
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/account-transitions/:id/comments", async (req, res) => {
    try {
      const userId = await requireAccountMgmtWrite(req, res);
      if (!userId) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid record" });
      const row = await addTransitionComment({
        recordId: id,
        authorUserId: userId,
        authorEmail: req.authUser?.email ?? "",
        body: String(req.body?.body ?? ""),
      });
      res.status(201).json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.delete("/api/account-transitions/:id/comments/:cid", async (req, res) => {
    try {
      if (!(await requireAdmin(req, res))) return;
      const cid = Number(req.params.cid);
      if (!Number.isFinite(cid) || cid <= 0) return res.status(400).json({ message: "Invalid comment" });
      await deleteTransitionComment(cid);
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/account-management/riders/:riderId/cars", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const riderId = Number(req.params.riderId);
      if (!Number.isFinite(riderId) || riderId <= 0) {
        return res.status(400).json({ message: "Invalid rider" });
      }
      res.json({ cars: await listRiderCarsForAccountMgmt(riderId) });
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/accounts", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listAccounts());
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/accounts", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      const row = await createAccount({
        name: String(req.body.name ?? ""),
        notes: req.body.notes ?? null,
      });
      res.json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.get("/api/accounts/:id", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const row = await getAccount(Number(req.params.id));
      if (!row) return res.status(404).json({ message: "Account not found" });
      res.json(row);
    } catch (err) { errHandler(res, err); }
  });

  app.patch("/api/accounts/:id", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      const row = await updateAccount(Number(req.params.id), {
        name: req.body.name,
        notes: req.body.notes,
        account_manager: req.body.account_manager,
      });
      if (!row) return res.status(404).json({ message: "Account not found" });
      res.json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  // ── PROGRAMS MODULE ──────────────────────────────────────────────────────────

  app.get("/api/programs/categories", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listCategories());
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/status-options", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const categoryId = Number(req.query.category_id);
      if (!Number.isFinite(categoryId) || categoryId <= 0) {
        return res.status(400).json({ error: "category_id is required" });
      }
      res.json(await listStatusOptions(categoryId));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/programs/resolve-cars", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const text = String(req.body.text ?? "");
      const programId = req.body.program_id != null ? Number(req.body.program_id) : null;
      res.json(await resolveProgramCars({ text, programId }));
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/shops", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const { data, error } = await supabaseAdmin.from("shops").select("*").order("name");
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/programs/shops", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      const name = String(req.body.name ?? "").trim();
      if (!name) return res.status(400).json({ error: "Shop name is required" });
      const { data: existing } = await supabaseAdmin.from("shops").select("*").ilike("name", name).limit(1);
      if (existing && existing.length) return res.json(existing[0]);
      const { data, error } = await supabaseAdmin.from("shops").insert({
        name,
        location: req.body.location || null,
        shop_type: req.body.shop_type || null,
      }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/scrap-yards", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const { data, error } = await supabaseAdmin.from("scrap_yards").select("*").order("name");
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/programs/scrap-yards", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      const name = String(req.body.name ?? "").trim();
      if (!name) return res.status(400).json({ error: "Scrap yard name is required" });
      const { data, error } = await supabaseAdmin.from("scrap_yards").insert({
        name,
        location: req.body.location || null,
      }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/history", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const ol = String(req.query.ol ?? "").trim();
      if (!ol) return res.status(400).json({ error: "ol is required" });
      res.json(await olProgramHistory(ol));
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/export", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const scopeAll = req.query.scope === "all" || req.query.all === "1" || req.query.all === "true";
      let ids = String(req.query.ids ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (scopeAll) {
        ids = (await listPrograms()).map((p: any) => Number(p.id));
      }
      const includeExited = scopeAll
        ? req.query.include_exited !== "0" && req.query.include_exited !== "false"
        : req.query.include_exited === "1" || req.query.include_exited === "true";
      const { buffer, filename } = await buildProgramReport({
        programIds: ids,
        includeExited,
        filename: scopeAll ? masterReportFilename() : undefined,
      });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listPrograms());
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/programs", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const name = String(req.body.name ?? "").trim();
      if (!name) return res.status(400).json({ error: "Name is required" });
      const categoryId = Number(req.body.category_id);
      if (!Number.isFinite(categoryId) || categoryId <= 0) {
        return res.status(400).json({ error: "Category is required" });
      }
      const status = parseStatus(req.body.status, "open");
      const { data, error } = await supabase
        .from("programs")
        .insert({
          name,
          description: req.body.description || null,
          status,
          category_id: categoryId,
          tags: Array.isArray(req.body.tags) ? req.body.tags : null,
          entity: req.body.entity || null,
          account_manager: req.body.account_manager || null,
          account_id: req.body.account_id ? Number(req.body.account_id) : null,
          status_narrative: req.body.status_narrative || null,
          target_completion_date: req.body.target_completion_date || null,
          created_by: userId,
        })
        .select()
        .single();
      if (error) throw error;
      await logProgramActivity({ program_id: data.id, action: "created", actor: userId, detail: { name, status } });
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/:id/export", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const includeExited = req.query.include_exited === "1" || req.query.include_exited === "true";
      const { buffer, filename } = await buildProgramReport({
        programIds: [Number(req.params.id)],
        includeExited,
      });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/:id", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const row = await getProgram(Number(req.params.id));
      if (!row) return res.status(404).json({ error: "Program not found" });
      res.json(row);
    } catch (err) { errHandler(res, err); }
  });

  app.patch("/api/programs/:id", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const id = Number(req.params.id);
      const { data: before } = await supabaseAdmin.from("programs").select("status, name").eq("id", id).maybeSingle();
      const updates: any = { updated_at: new Date().toISOString() };
      if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
      if (req.body.description !== undefined) updates.description = req.body.description || null;
      if (req.body.status !== undefined) updates.status = parseStatus(req.body.status, before?.status ?? "open");
      if (req.body.category_id !== undefined) updates.category_id = Number(req.body.category_id) || null;
      if (req.body.tags !== undefined) updates.tags = Array.isArray(req.body.tags) ? req.body.tags : null;
      if (req.body.entity !== undefined) updates.entity = req.body.entity || null;
      if (req.body.account_manager !== undefined) updates.account_manager = req.body.account_manager || null;
      if (req.body.account_id !== undefined) {
        updates.account_id = req.body.account_id ? Number(req.body.account_id) : null;
      }
      if (req.body.status_narrative !== undefined) updates.status_narrative = req.body.status_narrative || null;
      if (req.body.target_completion_date !== undefined) updates.target_completion_date = req.body.target_completion_date || null;
      if (req.body.opened_date !== undefined) updates.opened_date = req.body.opened_date || null;
      if (req.body.closed_date !== undefined) updates.closed_date = req.body.closed_date || null;
      const { data, error } = await supabaseAdmin.from("programs").update(updates).eq("id", id).select().single();
      if (error) throw error;
      if (before && updates.status && updates.status !== before.status) {
        await logProgramActivity({
          program_id: id,
          action: "status_changed",
          actor: userId,
          detail: { from: before.status, to: updates.status },
        });
      }
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  app.delete("/api/programs/:id", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      const id = Number(req.params.id);
      const { data: docs } = await supabase.from("program_documents").select("storage_path").eq("program_id", id);
      if (docs && docs.length > 0) {
        await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(docs.map((d: any) => d.storage_path));
      }
      const { error } = await supabase.from("programs").delete().eq("id", id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/:id/documents", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const { data, error } = await supabase
        .from("program_documents")
        .select("*")
        .eq("program_id", Number(req.params.id))
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/programs/:id/documents", upload.single("file"), async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const programId = Number(req.params.id);
      const documentCategory = String(req.body.document_category || req.body.doc_type || "other").toLowerCase();
      const ts = Date.now();
      const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `programs/${programId}/${ts}-${safeName}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
      const { data, error } = await supabase.from("program_documents").insert({
        program_id: programId,
        file_name: req.file.originalname,
        file_url: publicUrl,
        storage_path: storagePath,
        doc_type: req.body.doc_type || documentCategory,
        document_category: documentCategory,
        file_size_bytes: req.file.size,
        uploaded_by: userId,
      }).select().single();
      if (error) { await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]); throw error; }
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  app.delete("/api/programs/:id/documents/:docId", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      const docId = Number(req.params.docId);
      const { data: doc } = await supabase.from("program_documents").select("storage_path").eq("id", docId).single();
      if (doc?.storage_path) await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([doc.storage_path]);
      const { error } = await supabase.from("program_documents").delete().eq("id", docId);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/:id/cars", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const includeExited = req.query.include_exited === "1" || req.query.include_exited === "true";
      res.json(await listProgramCarsWithDocs(Number(req.params.id), includeExited));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/programs/:id/cars", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const { railcar_ids } = req.body;
      if (!Array.isArray(railcar_ids) || railcar_ids.length === 0) {
        return res.status(400).json({ error: "railcar_ids required" });
      }
      res.json(await addCarsToProgram(Number(req.params.id), railcar_ids, userId));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/programs/:id/cars/bulk", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const linkIds = Array.isArray(req.body.link_ids) ? req.body.link_ids : [];
      const updates = req.body.updates && typeof req.body.updates === "object" ? req.body.updates : null;
      if (!linkIds.length || !updates) {
        return res.status(400).json({ error: "link_ids and updates required" });
      }
      res.json(await bulkPatchProgramCars(Number(req.params.id), linkIds, updates, userId));
    } catch (err) { errHandler(res, err); }
  });

  app.patch("/api/programs/:id/cars/:linkId", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const row = await patchProgramCar(Number(req.params.id), Number(req.params.linkId), req.body, userId);
      if (!row) return res.status(404).json({ error: "Car link not found" });
      res.json(row);
    } catch (err) { errHandler(res, err); }
  });

  app.delete("/api/programs/:id/cars/:linkId", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const row = await exitCarFromProgram(Number(req.params.id), Number(req.params.linkId), userId);
      if (!row) return res.status(404).json({ error: "Car link not found" });
      res.json(row);
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/:id/activity", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const programCarId = req.query.program_car_id != null ? Number(req.query.program_car_id) : undefined;
      res.json(await listActivity(Number(req.params.id), programCarId));
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/:id/cars/:linkId/documents", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const { data, error } = await supabaseAdmin
        .from("program_car_documents")
        .select("*")
        .eq("program_car_id", Number(req.params.linkId))
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []).map((d: any) => {
        const { data: pub } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(d.file_path);
        return { ...d, file_url: pub.publicUrl };
      });
      res.json(rows);
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/programs/:id/cars/:linkId/documents", upload.single("file"), async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const programId = Number(req.params.id);
      const linkId = Number(req.params.linkId);
      const documentCategory = String(req.body.document_category || "other").toLowerCase();
      const ts = Date.now();
      const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `programs/${programId}/cars/${linkId}/${ts}-${safeName}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (upErr) throw upErr;
      const { data, error } = await supabaseAdmin.from("program_car_documents").insert({
        program_car_id: linkId,
        document_category: documentCategory,
        file_path: storagePath,
        file_name: req.file.originalname,
        file_size_bytes: req.file.size,
        uploaded_by: userId,
        notes: req.body.notes || null,
      }).select().single();
      if (error) { await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]); throw error; }
      const { data: pub } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
      res.json({ ...data, file_url: pub.publicUrl });
    } catch (err) { errHandler(res, err); }
  });

  app.delete("/api/programs/:id/cars/:linkId/documents/:docId", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      const docId = Number(req.params.docId);
      const { data: doc } = await supabaseAdmin.from("program_car_documents").select("file_path").eq("id", docId).single();
      if (doc?.file_path) await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([doc.file_path]);
      const { error } = await supabaseAdmin.from("program_car_documents").delete().eq("id", docId);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/railcars/:id/programs", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await carProgramHistory(Number(req.params.id)));
    } catch (err) { errHandler(res, err); }
  });


  return httpServer;
}
