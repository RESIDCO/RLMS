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

export async function registerRoutesPart7c(
  httpServer: Server,
  app: Express,
): Promise<void> {
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

}
