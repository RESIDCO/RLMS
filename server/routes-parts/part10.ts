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

export async function registerRoutesPart10(
  httpServer: Server,
  app: Express,
): Promise<void> {
  app.delete("/api/contact-lease-links/:id", async (req: Request, res: Response) => {
    try {
      if (!(await requireContactsWrite(req, res))) return;
      await deleteContactLeaseLink(Number(req.params.id));
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/leases/:id/contact-links", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listLeaseContactLinks({ masterLeaseId: Number(req.params.id) }));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/leases/:id/contact-links", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const body = (req.body as any) ?? {};
      const contactId = Number(body.company_contact_id);
      res.status(201).json(await createContactLeaseLink(
        Number.isFinite(contactId) && contactId > 0 ? contactId : null,
        { master_lease_id: Number(req.params.id), relationship_note: body.relationship_note, company_id: body.company_id },
        writerId,
      ));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.delete("/api/leases/:id/contact-links/:linkId", async (req: Request, res: Response) => {
    try {
      if (!(await requireWrite(req, res))) return;
      await deleteContactLeaseLink(Number(req.params.linkId));
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/riders/:id/contact-links", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listLeaseContactLinks({ riderId: Number(req.params.id) }));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/riders/:id/contact-links", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const body = (req.body as any) ?? {};
      const contactId = Number(body.company_contact_id);
      res.status(201).json(await createContactLeaseLink(
        Number.isFinite(contactId) && contactId > 0 ? contactId : null,
        { rider_id: Number(req.params.id), relationship_note: body.relationship_note, company_id: body.company_id },
        writerId,
      ));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.delete("/api/riders/:id/contact-links/:linkId", async (req: Request, res: Response) => {
    try {
      if (!(await requireWrite(req, res))) return;
      await deleteContactLeaseLink(Number(req.params.linkId));
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/directory-lease-gaps/apply-unique", async (req: Request, res: Response) => {
    try {
      const writerId = await requireContactsWrite(req, res);
      if (!writerId) return;
      res.json(await linkUniqueUnmatchedLesseeCompanies(writerId));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.post("/api/directory-lease-gaps/link", async (req: Request, res: Response) => {
    try {
      const writerId = await requireContactsWrite(req, res);
      if (!writerId) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const masterLeaseId = Number(body.master_lease_id);
      const lessee = String(body.lessee ?? "");
      res.json(await linkLesseeCompanyToLease(masterLeaseId, lessee, writerId));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.get("/api/directory-lease-gaps/export", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      const csv = await unmatchedLesseeExportCsv();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"unmatched-lessees.csv\"");
      res.send(csv);
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/directory-lease-gaps", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      const limit = Number(req.query.limit);
      const otherOffset = Number(req.query.other_offset);
      res.json(await listLeaseLinkGaps(
        Number.isFinite(limit) ? limit : 80,
        Number.isFinite(otherOffset) ? otherOffset : 0,
      ));
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/directory-dedup", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listDedupCandidates(req.query as Record<string, unknown>));
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/directory-dedup/summary", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await dedupSummary());
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/directory-dedup/backfill", async (req: Request, res: Response) => {
    try {
      if (!(await requireWrite(req, res))) return;
      res.json(await backfillAgentAndFamilyCandidates());
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/directory-dedup/:id", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      res.json(await applyDedupAction(Number(req.params.id), (req.body ?? {}) as Record<string, unknown>, writerId));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.get("/api/directory-search", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await directorySearch(req.query as Record<string, unknown>));
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/directory-facets", async (_req: Request, res: Response) => {
    try {
      if (!(await requireUser(_req, res))) return;
      res.json(await directoryFacets());
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/railcars/:id/programs", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await carProgramHistory(Number(req.params.id)));
    } catch (err) { errHandler(res, err); }
  });


  app.post("/api/import/mark-contacts/preview", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { rows } = req.body as { rows: Record<string, unknown>[] };
      if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ message: "No rows provided" });
      const preview = await previewMarkContacts(rows);
      const { companies: _omit, ...rest } = preview;
      res.json(rest);
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/import/mark-contacts/commit", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { rows } = req.body as { rows: Record<string, unknown>[] };
      if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ message: "No rows provided" });
      const result = await commitMarkContacts(rows);
      res.json(result);
    } catch (err) { errHandler(res, err); }
  });

}
