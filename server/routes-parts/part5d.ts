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

export async function registerRoutesPart5d(
  httpServer: Server,
  app: Express,
): Promise<void> {
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


}
