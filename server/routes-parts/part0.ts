import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import type { Server } from "http";
import multer from "multer";
import { supabase, supabaseAdmin } from "../supabase";
import { fetchAllRows, fetchAllRowsOrThrow } from "../fetch-all";
import { startVcfExportJob, getVcfExportJob, getVcfExportFile, recoverStaleExportJobs } from "../vcf-export-job";
import { pointCurrentAssignmentAt } from "../current-assignment";
import { queryRailcars, queryRailcarIds, parseRailcarListParams, parseSearchScope, attachAccountManagerInitials, listCarsAssignedToRider } from "../railcar-list";
import { conflictResponse, findCarNumberConflict, remarkConflictsHttp } from "../car-number-guard";
import { runGlobalSearch } from "../global-search";
import { listAccounts, getAccount, createAccount, updateAccount, ensureAccountForLessee, accountManagerByAccountIds, listAccountManagementOverview, isStatusTag, patchRiderStatusTag, listRiderCarsForAccountMgmt } from "../accounts";
import {
  attachLatestAmNotes,
  createRiderAccountComment,
  deleteRiderAccountComment,
  listRiderAccountComments,
} from "../rider-account-comments";
import {
  addComment as addTransitionComment,
  addMilestone,
  createTransitionRecord,
  deleteComment as deleteTransitionComment,
  deleteMilestone,
  deleteTransitionRecord,
  getTransitionDetail,
  listTransitionRecords,
  listTransitionSummary,
  patchMilestone,
  patchTransitionRecord,
} from "../account-transitions";
import {
  generateBriefingPdf,
  getOrCreateBriefingForm,
  saveBriefingForm,
} from "../account-transition-briefing";
import {
  assignTerritories,
  createTerritoryOwner,
  getTerritoryContacts,
  getTerritoryHistory,
  getTerritoryMap,
  listTerritoryContacts,
  patchTerritoryOwner,
  revertTerritoryChangeSet,
} from "../territories";
import {
  ACCOUNT_TRANSITIONS_SOURCE,
  genericUploadSource,
  insertAttachmentRow,
  isAttachmentEntityType,
  listAccountScopedAttachments,
  riderBelongsToAccount,
} from "../attachments";
import { persistOpsFlag, omitOpsFlagFields } from "../ops-flag-persist";
import {
  MASTER_LEASE_DATE_KEYS,
  RAILCAR_DATE_KEYS,
  RIDER_DATE_KEYS,
  nullifyEmptyDateStrings,
} from "../sanitize";
import { buildLeaseReport } from "../lease-export";
import { commitMarkContacts, previewMarkContacts } from "../mark-contacts-import";
import { directoryFacets, directorySearch, getCompany, listCompanies, listCompanyContacts, createCompany, updateCompany, deleteCompany, getCompanyContact, createCompanyContact, updateCompanyContact, deleteCompanyContact, listContactLeaseLinks, listCompanyLeaseLinks, listLeaseContactLinks, createContactLeaseLink, deleteContactLeaseLink, listContactsForRider, createContactOnRider, promoteLegacyRiderContacts, listAllDirectoryLeasePeople, listDirectoryPeopleForAccount, listLeaseLinkGaps, linkLesseeCompanyToLease, linkUniqueUnmatchedLesseeCompanies, unmatchedLesseeExportCsv } from "../directory";
import { applyDedupAction, backfillAgentAndFamilyCandidates, listDedupCandidates, dedupSummary } from "../directory-dedup";
import { addNote, listActivityLog, logActivity } from "../activity-log";
import { countActiveCarsByRiderId, countCarsByRiderId } from "../rider-car-counts";
import {
  applyCarStatusChange,
  assertInactivePatchAllowed,
  patchFieldsForStatusChange,
  writeCarStatusHistoryRow,
  syncCurrentAssignmentHistoryActive,
} from "../car-status-history";
import { crossesInactiveBoundary, fieldsImpliedByCarStatus, statusAlignedToActiveFlag } from "@shared/car-lifecycle-status";
import { fillBlankRiderMonthlyRent } from "../rider-rent-rollup";
import { applyCarFinancialsFromSummary, loadFinancialSummaryRows } from "../refresh-car-financials";
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
} from "../programs";
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
} from "../auth";
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
  normalizeStoredCarNumber,
  normalizeMarkAndNumber,
  deriveLeaseKey,
  synthesizeLeaseNumber,
} from "@shared/residco-import";
import {
  buildVcfReview,
  railcarPayloadFromCurrent,
  assignmentHistoryPayloadFromPeriod,
  carNumberHistoryNaturalKey,
  carNumberHistoryPayloadFromPeriod,
} from "@shared/vcf-import";
import {
  closeoutClosePatch,
  closeoutStats,
  planVcfAssignmentCloseout,
  skipVcfAssignmentWrites,
  type ExistingHistoryRow,
} from "@shared/vcf-assignment-closeout";
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
import { governLeaseDates } from "../govern-lease-dates";
import {
  MissingExpiryEstimateColumnsError,
  probeEstimatedLeaseExpiryColumns,
} from "../refresh-estimated-lease-expiry";
import { carBuildYear, turning50ByYear } from "@shared/build-year";
import { browseGroup, browseOl, browseTurning50, countInProgram } from "../browse";
import { buildTurning50Report } from "../turning50-export";
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
import {
  errHandler,
  upload,
  STORAGE_BUCKET,
  dvLoadReferenceData,
  dvCalculateWithGuardrails,
  dvParseInputs,
  dvComputeFreshness,
} from "../routes-lib";

export async function registerRoutesPart0(
  httpServer: Server,
  app: Express,
): Promise<void> {





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
          contact?: Record<string, unknown>;
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
          const num = normalizeStoredCarNumber(carObj.car_number);
          if (!num.ok) {
            return res.status(400).json({ message: num.message });
          }
          const marks = carObj.reporting_marks ?? null;
          const conflict = await findCarNumberConflict({
            car_number: num.car_number,
            reporting_marks: marks,
          });
          if (conflict) return res.status(400).json(conflictResponse(conflict));
          const { data: newCar, error: cErr } = await supabase
            .from("railcars")
            .insert({
              ...carObj,
              car_number: num.car_number,
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
              await pointCurrentAssignmentAt(supabase, [{ id: existingId, railcar_id: carId }]);
            } else {
              const { data: ins, error: iErr } = await supabase
                .from("railcar_assignments")
                .insert({ railcar_id: carId, rider_id: newRider.id, fleet_name: rp.fleet_name ?? null, assigned_at: now })
                .select("id, railcar_id")
                .single();
              if (iErr) throw iErr;
              await pointCurrentAssignmentAt(supabase, ins ? [ins] : []);
            }
          }
        }

        riderResults.push({ rider: newRider, car_count: carIds.length });

        const contactName = String(rp.contact?.name ?? "").trim();
        if (contactName) {
          await createContactOnRider(newRider.id, rp.contact ?? {}, writerId);
        }
      }

      res.json({ ok: true, mla: newMla, riders: riderResults });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  // ---------- Dashboard ----------

}
