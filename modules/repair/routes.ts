/**
 * Repair module HTTP routes.
 * Public token routes MUST register BEFORE app.use("/api", requireApiAuth).
 */
import type { Express, Request, Response } from "express";
import multer from "multer";
import { requireVcfCar } from "./services/vcf";
import { listStatuses, listTransitions } from "./services/status-machine";
import { createBadOrder, getEvent, listDemoShop } from "./services/bo";
import {
  createShop,
  deactivateShop,
  getShopMaster,
  getShopRecentActivity,
  listBillingRoads,
  listShopDocuments,
  listShopMaster,
  updateShop,
  uploadShopDocument,
} from "./services/shops";
import {
  formatRailroadLabel,
  listRailroads,
  seedRailroadsFromNarn,
} from "./services/railroads";
import { listShopMapPins, streamRailLinesGeoJson } from "./services/shop-map";
import { seedPlacesFromBundle } from "./services/places";
import {
  deactivateCatalogItem,
  listCatalog,
  upsertCatalogItem,
  type CatalogKind,
} from "./services/shop-catalog";
import {
  correctEventEntity,
  getEventEntitySnapshot,
  listOwnerEntityTags,
  lookupCarEntity,
  resolveEntitySnapshot,
  workspaceTitle,
} from "./services/entity";
import {
  listBoRules,
  createBoRule,
  updateBoRule,
  deactivateBoRule,
} from "./services/bo-rules";
import {
  queryBadOrderGrid,
  exportBadOrderGridCsv,
  listStccCodes,
  findOpenBadOrdersForCar,
  type BoGridDateField,
  DEFAULT_BO_STATUSES,
} from "./services/bo-grid";
import { getContactsProvider } from "./providers/contacts";
import {
  listDistributionEntries,
  addDistributionEntry,
  removeDistributionEntry,
} from "./services/distribution-list";
import {
  DATA_FILE_HEADER_FIELDS,
  editHeaderField,
  listHeaderEdits,
} from "./services/header-edits";
import {
  issueEventLink,
  revokeEventLink,
  reissueEventLink,
  resolveActiveLink,
} from "./services/event-links";
import { shopReject, shopOnHand } from "./services/shop-actions";
import {
  shopAcknowledge,
  shopDeclineWork,
  shopArrivalDate,
  bulkCreateBadOrders,
  voidEstimate,
} from "./services/bo-lifecycle";
import {
  uploadEstimate,
  listRevisions,
  getRevisionLines,
  submitForApproval,
  requestRevision,
  approveEstimate,
  listEstimatesForEvent,
  uploadEventDocument,
} from "./services/estimates";
import {
  linkEventDocumentRefs,
  listTemplateDocumentRefs,
} from "./services/bo-template";
import {
  loadEstimateAar,
  decideEstimateLoadWarnings,
  getEstimateLoadRun,
  loadEstimateFromInboundEmail,
} from "./services/estimate-load";
import { addComment, listComments, compareRevisions } from "./services/comments";
import {
  setTankCarDocGate,
  getTankCarDocGate,
  shopMarkTankDocsComplete,
  ownerDecideTankDocs,
  listTankDocPendingQueue,
  ensureTankPacket,
} from "./services/tank-docs";
import {
  saveInternalCorrection,
  restoreVoidedEstimate,
  listVoidedEstimates,
  softDeleteDocument,
  restoreDocument,
  softDeleteComment,
  restoreComment,
  cropImportPhase2Stub,
  getCorrectionEditorPayload,
  recategorizeDocument,
  canManageAttachments,
} from "./services/gap-lifecycle-06";
import { lookupRefCode, getRefDataCounts } from "./services/ref-lookup";
import {
  listComponentIdRules,
  upsertComponentIdRule,
  softDeleteComponentIdRule,
  validateComponentIds,
} from "./services/component-id-rules";
import {
  listRefTableMeta,
  listRefRows,
  upsertRefRow,
  retireRefRow,
  restoreRefRow,
  listRefHistory,
  dryRunRefImport,
  confirmRefImport,
  exportRefCsv,
  checkRefCodeForNewLine,
  canManageRefData,
} from "./services/ref-data-admin";
import {
  previewCarryForward,
  applyCarryForwardSelections,
  auditCarryForwardPreview,
} from "./services/carry-forward";
import { previewTaxProrate } from "./services/responsibility-split";
import { importRefData } from "./dev/import-ref-data";
import {
  listAttachmentCategories,
  listEventDocuments,
  downloadAllDocuments,
  markDocumentShared,
  setTargetOutboundBulk,
  setActualOutbound,
  listDispoQueue,
  emailLesseeDispo,
  linkInvoiceToEstimates,
  queryEstimateGrid,
  exportEstimateGridCsv,
  bulkApproveEstimates,
  exportBrcDetail,
  ACTIONABLE_ESTIMATE_STATUSES,
  setUserEmailOptOut,
  setNotificationRuleMinAmount,
  buildMonthlyBillSummary,
  getPhase2Hooks,
  type EstimateGridDateField,
} from "./services/ops-grid";
import {
  assertAttachmentAllowed,
  shopRequestDeleteEstimate,
  approveDeleteToVoid,
  bulkSubmitForApproval,
  shopRequestTerminate,
  requestDispo,
  updateResponsibility,
  exportEstimatesAar500,
  setActualOutboundAndComplete,
  runRailincValidation,
  setEventTankCar,
} from "./services/gap-lifecycle-05";
import { ownerVerifyTankDocsFirst } from "./services/tank-docs";
import { listResponsibilityCodes } from "./services/categories";
import {
  buildEstimateReviewPayload,
  setBillingCategory,
  submitResponsibilityUpdates,
  summarizeByResp,
} from "./services/estimate-review";
// previewTaxProrate imported above from responsibility-split
import {
  sendLesseeApprovalRequest,
  approveViaLesseeLink,
  ingestLesseeReply,
  confirmLesseeReply,
  getLesseeViewForToken,
  getLesseeAttachmentForToken,
  getLesseeDownloadForToken,
  getOwnerLesseePanel,
  flagLesseeOverdueIfNeeded,
  recordManualLesseeDecision,
  assertLesseeTokenEstimateAccess,
} from "./services/lessee-approval";
import {
  buildSendLesseePreview,
  sendLesseeFromPreview,
  previewAttachmentContent,
  listSendLesseeHistory,
} from "./services/send-lessee";
import { buildBrcPdf, type BrcAudience } from "./services/brc-pdf";
import {
  listViewerDocuments,
  getDocumentContent,
  decodeAar500Preview,
  zipViewerDocuments,
  attachDocumentsToSendLessee,
  setDocumentOwnerOnly,
  previewKindFor,
} from "./services/documents-viewer";
import { enterPodErd, listPodDates, latestPodErd, runPodReminders } from "./services/pod";
import { setCompletedDate, rollbackCompletedDate } from "./services/completion";
import { submitShopInvoice, listInvoicesForEvent, approveInvoiceMatch } from "./services/invoices";
import {
  submitShopCrbInvoice,
  ingestCrbInvoiceFromInboundEmail,
  decideInvoiceReview,
  listPrepayChecks,
  listInvoiceReviewQueue,
  setInvoiceNumberByReviewer,
  reauditInvoiceTotals,
} from "./services/inbound-invoice-audit";
import { relayDispo, listDispo } from "./services/dispo";
import {
  createWreckEvent,
  getWreckEvent,
  getWreckEventByEventId,
  updateWreckEvent,
  clearWreckFlags,
} from "./services/wreck-events";
import {
  computeSettlementGauge,
  saveSettlementCalc,
  omitOwnerDv,
} from "./services/wreck-settlement";
import { validateWreckLoad } from "./services/wreck-validate";
import { parseAarFile } from "./services/aar-parser";
import {
  listContacts,
  upsertContact,
  softDeleteContact,
  listAdhocEmails,
  addAdhocEmails,
  listNotificationRules,
  updateNotificationRule,
} from "./services/contacts";
import { issueStepOtp, isOtpRequired, setShopOtpStepFlag, getShopOtpSteps } from "./services/otp";
import { maybeMarkReadyToClose, closeEvent } from "./services/close";
import {
  runMonthlyClose,
  collectRebillEvents,
  listCloseRuns,
  ensureBillingPeriod,
} from "./services/monthly-close";
import { validateCripBytes } from "./services/crb-validate";
import {
  listBilledPartyMappings,
  listBilledPartyMappingHistory,
  upsertBilledPartyMapping,
  softDeleteBilledPartyMapping,
  getCarOwnerMark,
  resolveInboundShopMarks,
} from "./services/billed-party-map";
import { getEmailProvider } from "./providers/email";
import { getInboundEmailProvider } from "./providers/inbound-email";
import { getStorageProvider } from "./providers/storage";
import { DEFAULT_TENANT_ID, q } from "./db";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export type RepairRouteDeps = {
  requireUser?: (req: Request, res: Response) => Promise<string | null>;
};

async function maybeRequireUser(
  deps: RepairRouteDeps,
  req: Request,
  res: Response,
): Promise<string | null> {
  if (process.env.REPAIR_DEV_BYPASS_AUTH === "1") {
    return "dev-bypass";
  }
  if (!deps.requireUser) {
    res.status(501).json({ error: "Auth not wired; set REPAIR_DEV_BYPASS_AUTH=1 for local" });
    return null;
  }
  return deps.requireUser(req, res);
}

function actorFrom(req: Request): string {
  return (
    (req as Request & { authUser?: { email?: string } }).authUser?.email ||
    String(req.headers["x-repair-actor"] || "user")
  );
}

function roleFrom(req: Request): string {
  if (process.env.REPAIR_DEV_BYPASS_AUTH === "1") {
    return String(req.headers["x-repair-role"] || req.body?.actorRole || "dev-bypass");
  }
  return String(
    req.headers["x-repair-role"] ||
      req.body?.actorRole ||
      req.query.actorRole ||
      "reviewer",
  );
}

/** Call BEFORE global /api auth middleware. */
export function registerRepairPublicRoutes(app: Express, _deps: RepairRouteDeps = {}): void {
  app.get("/api/repair/health", (_req, res) => {
    res.json({
      ok: true,
      module: "repair",
      phase: "1-slice-inbound-invoice-audit",
      db: Boolean(process.env.DATABASE_URL || process.env.REPAIR_DATABASE_URL),
      providers: {
        email: "LogEmailProvider",
        storage: "LocalDiskStorageProvider",
        inbound: "DevInboundEmailProvider",
      },
    });
  });

  app.get("/api/repair/public/vcf-check", async (req, res) => {
    try {
      const carMark = String(req.query.carMark ?? req.query.mark ?? "");
      const carNumber = String(req.query.carNumber ?? req.query.number ?? "");
      const result = await requireVcfCar(carMark, carNumber);
      if (!result.ok) {
        return res.status(422).json({
          ok: false,
          error: result.reason,
          carMark: result.carMark,
          carNumber: result.carNumber,
        });
      }
      return res.json({ ok: true, car: result.car });
    } catch (err) {
      console.error("[repair/public/vcf-check]", err);
      return res.status(500).json({ error: "VCF check failed" });
    }
  });

  app.post("/api/repair/public/inbound-dev", async (req, res) => {
    try {
      const body = req.body ?? {};
      const attachments = Array.isArray(body.attachments)
        ? body.attachments.map((a: Record<string, unknown>) => ({
            filename: String(a.filename ?? "attachment.bin"),
            mime: a.mime ? String(a.mime) : undefined,
            contentBase64: a.contentBase64 ? String(a.contentBase64) : undefined,
          }))
        : undefined;
      const result = await getInboundEmailProvider().ingest({
        from: String(body.from ?? ""),
        to: String(body.to ?? ""),
        subject: String(body.subject ?? ""),
        raw: String(body.raw ?? body.body ?? ""),
        receivedAt: new Date().toISOString(),
        messageId: body.messageId ? String(body.messageId) : undefined,
        eventToken: body.eventToken ? String(body.eventToken) : undefined,
        eventId: body.eventId ? String(body.eventId) : undefined,
        attachments,
      });

      // purpose=estimate → estimate 500-byte load; else invoice CRB pre-pay when attachment present
      const purpose = String(body.purpose ?? "").toLowerCase();
      let invoiceIntake: unknown = null;
      let estimateIntake: unknown = null;
      const shopAtt = result.attachments.find(
        (a) =>
          result.parsed.shopInvoiceAttachment &&
          a.filename === result.parsed.shopInvoiceAttachment.filename,
      ) ?? result.attachments[0];

      const toAddr = String(body.to ?? "");
      const looksEstimate =
        purpose === "estimate" ||
        /(?:shop-estimate|estimate)\+/i.test(toAddr);

      if (looksEstimate && shopAtt) {
        estimateIntake = await loadEstimateFromInboundEmail({
          toAddress: toAddr,
          fromAddress: String(body.from ?? "shop@inbound.dev"),
          subject: String(body.subject ?? ""),
          textBody: String(body.raw ?? body.body ?? ""),
          attachments: [
            {
              filename: shopAtt.filename,
              contentType: shopAtt.mime,
              contentBase64: shopAtt.bytes.toString("base64"),
            },
          ],
          eventToken:
            result.eventToken ?? (body.eventToken ? String(body.eventToken) : undefined),
        });
      } else if (shopAtt && (result.eventToken || result.eventId || body.eventToken || body.eventId)) {
        invoiceIntake = await ingestCrbInvoiceFromInboundEmail({
          bytes: shopAtt.bytes,
          filename: shopAtt.filename,
          mime: shopAtt.mime,
          actorEmail: String(body.from ?? "shop@inbound.dev"),
          eventToken: result.eventToken ?? (body.eventToken ? String(body.eventToken) : undefined),
          eventId: result.eventId ?? (body.eventId ? String(body.eventId) : undefined),
          inboundEmailId: result.id,
        });
      }

      return res.status(202).json({
        id: result.id,
        parsed: result.parsed,
        eventToken: result.eventToken,
        eventId: result.eventId,
        attachmentCount: result.attachments.length,
        invoiceIntake,
        estimateIntake,
        note: estimateIntake
          ? "Estimate 500-byte attachment routed to estimate load (ERRORS/WARNINGS)."
          : invoiceIntake
            ? "Shop invoice attachment routed to CRB pre-pay audit (human review)."
            : "Parsed decision is advisory until a reviewer confirms.",
      });
    } catch (err) {
      console.error("[repair/public/inbound-dev]", err);
      return res.status(500).json({ error: "Inbound ingest failed" });
    }
  });

  app.get("/api/repair/e/:token", async (req, res) => {
    try {
      const resolved = await resolveActiveLink(String(req.params.token), "SHOP");
      if (!resolved) {
        return res.status(401).json({ error: "Invalid, expired, or revoked link" });
      }
      const eventId = String(resolved.event.id);
      const tenantId = String(resolved.event.tenant_id ?? DEFAULT_TENANT_ID);
      const estimates = await listEstimatesForEvent(eventId);
      let revisions: unknown[] = [];
      if (estimates[0]) {
        revisions = await listRevisions(estimates[0].id);
      }
      const pod = await latestPodErd(eventId, tenantId);
      const invoices = await listInvoicesForEvent(eventId, tenantId);
      const dispo = await listDispo(eventId, tenantId);
      const shopId = resolved.event.shop_id ? String(resolved.event.shop_id) : null;
      const otpInvoice = await isOtpRequired("invoice_submit", { shopId, eventId, tenantId });
      const otpCompleted = await isOtpRequired("completed_date", { shopId, eventId, tenantId });
      return res.json({
        link: resolved.link,
        event: resolved.event,
        nextActions: nextShopActions(String(resolved.event.status_code), {
          hasPod: Boolean(pod.POD || pod.ERD),
          estimateLocked: Boolean(estimates[0]?.locked),
          estimateStatus: estimates[0]?.status_code as string | undefined,
        }),
        estimates,
        revisions,
        pod,
        invoices,
        dispo,
        otpRequired: { invoice_submit: otpInvoice, completed_date: otpCompleted },
      });
    } catch (err) {
      console.error("[repair/e/:token]", err);
      return res.status(500).json({ error: "Failed to load event link" });
    }
  });

  /** Lessee login-free link (Resp 6 primary path). Shows Resp 6 portion only. */
  app.get("/api/repair/lessee/:token", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      const view = await getLesseeViewForToken(String(req.params.token));
      if (!view) {
        return res.status(401).json({ error: "Invalid, expired, or revoked link" });
      }
      return res.json(view);
    } catch (err) {
      console.error("[repair/lessee/:token]", err);
      return res.status(500).json({ error: "Failed to load lessee link" });
    }
  });

  app.post("/api/repair/lessee/:token/decide", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const decision =
        String(req.body?.decision ?? "").toUpperCase() === "REJECT" ? "REJECT" : "APPROVE";
      const forwarded = String(req.headers["x-forwarded-for"] ?? "");
      const ip =
        forwarded.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        undefined;
      const result = await approveViaLesseeLink({
        rawToken: String(req.params.token),
        decision,
        comment: req.body?.comment ? String(req.body.comment) : undefined,
        respondentName: req.body?.name ? String(req.body.name) : undefined,
        respondentEmail: req.body?.email ? String(req.body.email) : undefined,
        respondentIp: ip,
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json(result);
    } catch (err) {
      console.error("[repair/lessee/:token/decide]", err);
      return res.status(500).json({ error: "Lessee decision failed" });
    }
  });

  /** §E Document Viewer in lessee mode — granted docs only (login-free). */
  app.get("/api/repair/lessee/:token/documents-viewer", async (req, res) => {
    try {
      const view = await getLesseeViewForToken(String(req.params.token));
      if (!view) {
        return res.status(401).json({ error: "Invalid, expired, or superseded link" });
      }
      const granted = ((view.documents as Array<{ id: string }>) ?? []).map((d) =>
        String(d.id),
      );
      const { listViewerDocuments } = await import("./services/documents-viewer");
      const result = await listViewerDocuments({
        estimateId: String(view.estimate.id),
        eventId: String(view.event.id),
        actorRole: "lessee",
        grantedDocumentIds: granted,
        categoryCode: req.query.category ? String(req.query.category) : undefined,
        search: req.query.q ? String(req.query.q) : undefined,
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json({
        ...result,
        lesseeMode: true,
        token: req.params.token,
        canDecide: view.canDecide,
      });
    } catch (err) {
      console.error("[repair/lessee/:token/documents-viewer]", err);
      return res.status(500).json({ error: "Lessee document viewer failed" });
    }
  });

  app.get("/api/repair/lessee/:token/downloads/:kind", async (req, res) => {
    try {
      const kind =
        String(req.params.kind) === "resp6-data" ? "resp6-data" : "resp6-pdf";
      const result = await getLesseeDownloadForToken({
        rawToken: String(req.params.token),
        kind,
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      res.setHeader("content-type", result.mime);
      res.setHeader(
        "content-disposition",
        `attachment; filename="${result.filename}"`,
      );
      return res.send(result.bytes);
    } catch (err) {
      console.error("[repair/lessee/:token/downloads]", err);
      return res.status(500).json({ error: "Download failed" });
    }
  });

  /** Lessee may download only attachments granted on send. */
  app.get("/api/repair/lessee/:token/attachments/:documentId", async (req, res) => {
    try {
      const result = await getLesseeAttachmentForToken({
        rawToken: String(req.params.token),
        documentId: String(req.params.documentId),
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      res.setHeader(
        "content-type",
        result.document.mime || "application/octet-stream",
      );
      res.setHeader(
        "content-disposition",
        `inline; filename="${result.document.original_filename || result.document.kind}"`,
      );
      return res.send(result.bytes);
    } catch (err) {
      console.error("[repair/lessee/:token/attachments]", err);
      return res.status(500).json({ error: "Failed to load attachment" });
    }
  });

  /** Lessee token probing another estimate → 403. */
  app.get("/api/repair/lessee/:token/estimates/:estimateId", async (req, res) => {
    const access = await assertLesseeTokenEstimateAccess({
      rawToken: String(req.params.token),
      estimateId: String(req.params.estimateId),
    });
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    return res.json({ ok: true, estimateId: req.params.estimateId });
  });

  app.post("/api/repair/e/:token/accept", async (req, res) => {
    const email = String(req.body?.email ?? "shop@unknown");
    const result = await shopAcknowledge(String(req.params.token), email);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/e/:token/acknowledge", async (req, res) => {
    const email = String(req.body?.email ?? "shop@unknown");
    const result = await shopAcknowledge(String(req.params.token), email);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/e/:token/reject", async (req, res) => {
    const email = String(req.body?.email ?? "shop@unknown");
    const reason = String(req.body?.reason ?? req.body?.comment ?? "");
    if (reason.trim()) {
      const declined = await shopDeclineWork(String(req.params.token), email, reason);
      if (!declined.ok) return res.status(declined.status).json({ error: declined.error });
      return res.json(declined);
    }
    const result = await shopReject(
      String(req.params.token),
      email,
      req.body?.comment ? String(req.body.comment) : undefined,
    );
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/e/:token/decline", async (req, res) => {
    const email = String(req.body?.email ?? "shop@unknown");
    const result = await shopDeclineWork(
      String(req.params.token),
      email,
      String(req.body?.reason ?? ""),
    );
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/e/:token/on-hand", async (req, res) => {
    const email = String(req.body?.email ?? "shop@unknown");
    if (req.body?.arrivalDate) {
      const result = await shopArrivalDate(
        String(req.params.token),
        email,
        String(req.body.arrivalDate),
      );
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json(result);
    }
    const result = await shopOnHand(String(req.params.token), email);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/e/:token/arrival", async (req, res) => {
    const email = String(req.body?.email ?? "shop@unknown");
    const result = await shopArrivalDate(
      String(req.params.token),
      email,
      String(req.body?.arrivalDate ?? req.body?.date ?? ""),
    );
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post(
    "/api/repair/e/:token/estimate-aar",
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file?.buffer?.length) {
          return res.status(400).json({ error: "500-byte estimate file required" });
        }
        const result = await loadEstimateAar({
          bytes: req.file.buffer,
          filename: req.file.originalname || "estimate.dat",
          mime: req.file.mimetype || "text/plain",
          source: "SHOP_LINK",
          rawToken: String(req.params.token),
          actor: String(req.body?.email ?? "shop@unknown"),
          actorName: String(req.body?.actorName ?? req.body?.email ?? "shop"),
          comment: req.body?.comment ? String(req.body.comment) : undefined,
        });
        if (!result.ok) {
          return res.status(result.status).json(result);
        }
        return res.status(result.pendingWarnings ? 202 : 201).json(result);
      } catch (err) {
        console.error("[repair/e/estimate-aar]", err);
        return res.status(500).json({ error: "Estimate load failed" });
      }
    },
  );

  app.post("/api/repair/e/:token/tank-docs/complete", async (req, res) => {
    const result = await shopMarkTankDocsComplete({
      rawToken: String(req.params.token),
      actor: String(req.body?.email ?? "shop@unknown"),
      documentIds: Array.isArray(req.body?.documentIds)
        ? req.body.documentIds.map(String)
        : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post(
    "/api/repair/e/:token/estimates",
    upload.single("file"),
    async (req, res) => {
      try {
        let lines: unknown = undefined;
        if (req.body?.lines) {
          lines =
            typeof req.body.lines === "string"
              ? JSON.parse(req.body.lines)
              : req.body.lines;
        }
        const file = req.file
          ? {
              filename: req.file.originalname || "estimate.bin",
              mime: req.file.mimetype || "application/octet-stream",
              bytes: req.file.buffer,
            }
          : undefined;
        const result = await uploadEstimate({
          rawToken: String(req.params.token),
          actorName: String(req.body?.actorName ?? req.body?.email ?? "shop"),
          actorEmail: String(req.body?.email ?? "shop@unknown"),
          via: "event_link",
          comment: req.body?.comment ? String(req.body.comment) : undefined,
          lines: lines as undefined,
          file,
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(201).json(result);
      } catch (err) {
        console.error("[repair/e/:token/estimates]", err);
        return res.status(500).json({ error: "Estimate upload failed" });
      }
    },
  );

  app.post("/api/repair/e/:token/pod", async (req, res) => {
    try {
      const kind = String(req.body?.kind ?? "POD").toUpperCase() === "ERD" ? "ERD" : "POD";
      const result = await enterPodErd({
        rawToken: String(req.params.token),
        kind,
        dateValue: String(req.body?.dateValue ?? req.body?.date ?? ""),
        enteredBy: String(req.body?.email ?? "shop@unknown"),
        reason: req.body?.reason ? String(req.body.reason) : undefined,
        via: "event_link",
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.status(201).json(result);
    } catch (err) {
      console.error("[repair/e/:token/pod]", err);
      return res.status(500).json({ error: "POD/ERD entry failed" });
    }
  });

  app.post("/api/repair/e/:token/complete", async (req, res) => {
    try {
      const result = await setCompletedDate({
        rawToken: String(req.params.token),
        completedAt: String(req.body?.completedAt ?? req.body?.date ?? new Date().toISOString()),
        actor: String(req.body?.email ?? "shop@unknown"),
        comment: req.body?.comment ? String(req.body.comment) : undefined,
        otpCode: req.body?.otpCode ? String(req.body.otpCode) : undefined,
      });
      if (!result.ok) {
        return res.status(result.status).json({
          error: result.error,
          otpRequired: "otpRequired" in result ? result.otpRequired : undefined,
        });
      }
      return res.json(result);
    } catch (err) {
      console.error("[repair/e/:token/complete]", err);
      return res.status(500).json({ error: "Complete failed" });
    }
  });

  app.post(
    "/api/repair/e/:token/invoice",
    upload.single("file"),
    async (req, res) => {
      try {
        const file = req.file
          ? {
              filename: req.file.originalname || "invoice.pdf",
              mime: req.file.mimetype || "application/pdf",
              bytes: req.file.buffer,
            }
          : undefined;
        const result = await submitShopInvoice({
          rawToken: String(req.params.token),
          invoiceNo: String(req.body?.invoiceNo ?? ""),
          total: Number(req.body?.total),
          actorEmail: String(req.body?.email ?? "shop@unknown"),
          otpCode: req.body?.otpCode ? String(req.body.otpCode) : undefined,
          file,
        });
        if (!result.ok) {
          return res.status(result.status).json({
            error: result.error,
            otpRequired: "otpRequired" in result ? result.otpRequired : undefined,
          });
        }
        return res.status(201).json(result);
      } catch (err) {
        console.error("[repair/e/:token/invoice]", err);
        return res.status(500).json({ error: "Invoice submit failed" });
      }
    },
  );

  /** Shop event-link upload of a 500-byte AAR/CRB invoice (OTP if shop-enabled). */
  app.post(
    "/api/repair/e/:token/invoice-aar",
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file?.buffer?.length) {
          return res.status(400).json({ error: "500-byte invoice file required" });
        }
        const result = await submitShopCrbInvoice({
          rawToken: String(req.params.token),
          bytes: req.file.buffer,
          filename: req.file.originalname || "shop-invoice.txt",
          mime: req.file.mimetype || "text/plain",
          actorEmail: String(req.body?.email ?? "shop@unknown"),
          otpCode: req.body?.otpCode ? String(req.body.otpCode) : undefined,
        });
        if (!result.ok) {
          return res.status(result.status).json({
            error: result.error,
            otpRequired: "otpRequired" in result ? result.otpRequired : undefined,
            carMark: "carMark" in result ? result.carMark : undefined,
            carNumber: "carNumber" in result ? result.carNumber : undefined,
          });
        }
        return res.status(201).json(result);
      } catch (err) {
        console.error("[repair/e/:token/invoice-aar]", err);
        return res.status(500).json({ error: "CRB invoice intake failed" });
      }
    },
  );

  app.post("/api/repair/e/:token/otp", async (req, res) => {
    try {
      const resolved = await resolveActiveLink(String(req.params.token), "SHOP");
      if (!resolved) return res.status(401).json({ error: "Invalid or revoked link" });
      const step = String(req.body?.step ?? "invoice_submit");
      const result = await issueStepOtp({
        eventId: String(resolved.event.id),
        step,
        email: String(req.body?.email ?? "shop@unknown"),
        tenantId: String(resolved.event.tenant_id ?? DEFAULT_TENANT_ID),
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.status(201).json(result);
    } catch (err) {
      console.error("[repair/e/:token/otp]", err);
      return res.status(500).json({ error: "OTP issue failed" });
    }
  });

  app.post("/api/repair/e/:token/dispo", async (req, res) => {
    try {
      const direction =
        String(req.body?.direction ?? "from_shop") === "to_shop" ? "to_shop" : "from_shop";
      const result = await relayDispo({
        rawToken: String(req.params.token),
        direction,
        instructions: String(req.body?.instructions ?? req.body?.comment ?? ""),
        actor: String(req.body?.email ?? "shop@unknown"),
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.status(201).json(result);
    } catch (err) {
      console.error("[repair/e/:token/dispo]", err);
      return res.status(500).json({ error: "Dispo relay failed" });
    }
  });

  app.post(
    "/api/repair/e/:token/documents",
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "file required" });
        const result = await uploadEventDocument({
          rawToken: String(req.params.token),
          kind: String(req.body?.kind ?? "photo"),
          actorEmail: String(req.body?.email ?? "shop@unknown"),
          file: {
            filename: req.file.originalname || "upload.bin",
            mime: req.file.mimetype || "application/octet-stream",
            bytes: req.file.buffer,
          },
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(201).json(result);
      } catch (err) {
        console.error("[repair/e/:token/documents]", err);
        return res.status(500).json({ error: "Document upload failed" });
      }
    },
  );

  app.post("/api/repair/e/:token/request-delete", async (req, res) => {
    const result = await shopRequestDeleteEstimate({
      rawToken: String(req.params.token),
      actor: String(req.body?.email ?? "shop@unknown"),
      reason: req.body?.reason ? String(req.body.reason) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/e/:token/request-terminate", async (req, res) => {
    const result = await shopRequestTerminate({
      rawToken: String(req.params.token),
      actor: String(req.body?.email ?? "shop@unknown"),
      reason: req.body?.reason ? String(req.body.reason) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });
}

function nextShopActions(
  statusCode: string,
  ctx: { hasPod?: boolean; estimateLocked?: boolean; estimateStatus?: string } = {},
): string[] {
  const actions: string[] = [];
  switch (statusCode) {
    case "SHOP_ASSIGNED":
      return ["accept", "reject"];
    case "ACCEPTED":
      actions.push("on-hand", "upload-estimate");
      break;
    case "ON_HAND":
      actions.push("upload-estimate", "pod");
      break;
    case "IN_REPAIR":
      actions.push("pod", "complete", "invoice", "dispo", "upload-document");
      if (!ctx.estimateLocked) actions.push("upload-estimate");
      break;
    case "COMPLETE":
      actions.push("invoice", "dispo", "upload-document");
      break;
    case "READY_TO_CLOSE":
    case "CLOSED":
      actions.push("upload-document");
      break;
    default:
      actions.push("upload-estimate", "pod", "upload-document");
  }
  if (ctx.estimateStatus === "APPROVED" && !ctx.estimateLocked) {
    if (!actions.includes("complete")) actions.push("complete");
    if (!actions.includes("pod")) actions.push("pod");
  }
  return actions;
}

/** Call AFTER requireApiAuth (or with REPAIR_DEV_BYPASS_AUTH=1). */
export function registerRepairAuthedRoutes(app: Express, deps: RepairRouteDeps = {}): void {
  app.get("/api/repair/statuses", async (req, res) => {
    try {
      const uid = await maybeRequireUser(deps, req, res);
      if (!uid) return;
      const entity = String(req.query.entity ?? "ESTIMATE").toUpperCase();
      if (entity !== "EVENT" && entity !== "ESTIMATE") {
        return res.status(400).json({ error: "entity must be EVENT or ESTIMATE" });
      }
      const tenantId = String(req.query.tenantId ?? DEFAULT_TENANT_ID);
      const statuses = await listStatuses(tenantId, entity);
      const transitions = await listTransitions(tenantId, entity);
      return res.json({ tenantId, entity, statuses, transitions });
    } catch (err) {
      console.error("[repair/statuses]", err);
      return res.status(500).json({ error: "Failed to load statuses" });
    }
  });

  /** Active shops for dropdowns — empty until owner creates at least one. */
  app.get("/api/repair/shops", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const master = String(req.query.master ?? "") === "1";
    if (master) {
      const activeOnly = String(req.query.activeOnly ?? "1") !== "0";
      const shops = await listShopMaster({
        activeOnly,
        search: req.query.q ? String(req.query.q) : undefined,
      });
      return res.json({ shops, workspaceTitle: await workspaceTitle() });
    }
    return res.json({
      shops: await listDemoShop(),
      workspaceTitle: await workspaceTitle(),
    });
  });

  /** Shop map pins — geocoded City/ST or lat/lng override. Local places only. */
  app.get("/api/repair/shops/map", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await listShopMapPins({
      activeOnly: String(req.query.activeOnly ?? "1") !== "0",
      railroadMark: req.query.railroad
        ? String(req.query.railroad)
        : undefined,
      capabilityId: req.query.capability
        ? String(req.query.capability)
        : undefined,
      carTypeId: req.query.carType ? String(req.query.carType) : undefined,
    });
    return res.json({
      ...result,
      workspaceTitle: await workspaceTitle(),
    });
  });

  /** Simplified NARN rail lines GeoJSON (bundled; no runtime BTS calls). */
  app.get("/api/repair/map/rail-lines", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return streamRailLinesGeoJson(res);
  });

  /** Dev/local: re-seed places geocode table (idempotent). */
  app.post("/api/repair/map/places/seed", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await seedPlacesFromBundle();
    return res.json(result);
  });

  app.get("/api/repair/shops/:id", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    // Avoid colliding with /shops/:id/otp-steps — only UUID-like ids
    if (String(req.params.id) === "otp-steps") return;
    if (String(req.params.id) === "map") return;
    const shop = await getShopMaster(String(req.params.id));
    if (!shop) return res.status(404).json({ error: "Shop not found" });
    const recent = await getShopRecentActivity(String(req.params.id));
    return res.json({ shop, recent, workspaceTitle: await workspaceTitle() });
  });

  /** Operating railroads (NARN) — delivering-line type-ahead. Not billing_roads. */
  app.get("/api/repair/railroads", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const roads = await listRailroads(undefined, {
      q: req.query.q ? String(req.query.q) : undefined,
      activeOnly: String(req.query.activeOnly ?? "1") !== "0",
      limit: req.query.limit ? Number(req.query.limit) : 40,
    });
    return res.json({
      railroads: roads.map((r) => ({
        ...r,
        label: formatRailroadLabel(r),
      })),
    });
  });

  /** Dev/local: re-seed NARN railroads (idempotent). */
  app.post("/api/repair/railroads/seed", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await seedRailroadsFromNarn();
    return res.json(result);
  });

  app.post("/api/repair/shops", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const body = req.body ?? {};
    const result = await createShop({
      legalName: String(body.legalName ?? body.name ?? ""),
      city: String(body.city ?? ""),
      state: String(body.state ?? ""),
      splc: String(body.splc ?? ""),
      billingRoad: body.billingRoad != null ? String(body.billingRoad) : null,
      shopMark: body.shopMark != null ? String(body.shopMark) : null,
      website: body.website != null ? String(body.website) : null,
      hoursNotes: body.hoursNotes != null ? String(body.hoursNotes) : null,
      latOverride:
        body.latOverride !== undefined
          ? body.latOverride == null || body.latOverride === ""
            ? null
            : Number(body.latOverride)
          : null,
      lngOverride:
        body.lngOverride !== undefined
          ? body.lngOverride == null || body.lngOverride === ""
            ? null
            : Number(body.lngOverride)
          : null,
      deliveringLines: Array.isArray(body.deliveringLines)
        ? body.deliveringLines
        : undefined,
      capabilityIds: Array.isArray(body.capabilityIds)
        ? body.capabilityIds.map(String)
        : undefined,
      carTypeIds: Array.isArray(body.carTypeIds)
        ? body.carTypeIds.map(String)
        : undefined,
      certifications: Array.isArray(body.certifications)
        ? body.certifications
        : undefined,
      active: body.active !== false,
      contacts: Array.isArray(body.contacts) ? body.contacts : undefined,
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(result);
  });

  app.patch("/api/repair/shops/:id", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const body = req.body ?? {};
    const result = await updateShop({
      shopId: String(req.params.id),
      legalName: body.legalName != null ? String(body.legalName) : undefined,
      city: body.city != null ? String(body.city) : undefined,
      state: body.state != null ? String(body.state) : undefined,
      splc: body.splc != null ? String(body.splc) : undefined,
      billingRoad:
        body.billingRoad !== undefined
          ? body.billingRoad == null
            ? null
            : String(body.billingRoad)
          : undefined,
      shopMark:
        body.shopMark !== undefined
          ? body.shopMark == null
            ? null
            : String(body.shopMark)
          : undefined,
      website:
        body.website !== undefined
          ? body.website == null
            ? null
            : String(body.website)
          : undefined,
      hoursNotes:
        body.hoursNotes !== undefined
          ? body.hoursNotes == null
            ? null
            : String(body.hoursNotes)
          : undefined,
      latOverride:
        body.latOverride !== undefined
          ? body.latOverride == null || body.latOverride === ""
            ? null
            : Number(body.latOverride)
          : undefined,
      lngOverride:
        body.lngOverride !== undefined
          ? body.lngOverride == null || body.lngOverride === ""
            ? null
            : Number(body.lngOverride)
          : undefined,
      deliveringLines: Array.isArray(body.deliveringLines)
        ? body.deliveringLines
        : undefined,
      capabilityIds: Array.isArray(body.capabilityIds)
        ? body.capabilityIds.map(String)
        : undefined,
      carTypeIds: Array.isArray(body.carTypeIds)
        ? body.carTypeIds.map(String)
        : undefined,
      certifications: Array.isArray(body.certifications)
        ? body.certifications
        : undefined,
      active: body.active != null ? Boolean(body.active) : undefined,
      contacts: Array.isArray(body.contacts) ? body.contacts : undefined,
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/shops/:id/deactivate", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await deactivateShop({
      shopId: String(req.params.id),
      actor: actorFrom(req),
      reason: req.body?.reason ? String(req.body.reason) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.get("/api/repair/shops/:id/documents", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({
      documents: await listShopDocuments(String(req.params.id)),
    });
  });

  app.post(
    "/api/repair/shops/:id/documents",
    upload.single("file"),
    async (req, res) => {
      try {
        const uid = await maybeRequireUser(deps, req, res);
        if (!uid) return;
        if (!req.file) return res.status(400).json({ error: "file required" });
        const result = await uploadShopDocument({
          shopId: String(req.params.id),
          kind: String(req.body?.kind ?? "shop_attachment"),
          actor: actorFrom(req),
          file: {
            filename: req.file.originalname || "upload.bin",
            mime: req.file.mimetype || "application/octet-stream",
            bytes: req.file.buffer,
          },
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(201).json(result);
      } catch (err) {
        console.error("[repair/shops/:id/documents]", err);
        return res.status(500).json({ error: "Shop document upload failed" });
      }
    },
  );

  /** Billing roads — validation lookup only (not the shop list). */
  app.get("/api/repair/billing-roads", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const roads = await listBillingRoads(undefined, {
      q: req.query.q ? String(req.query.q) : undefined,
      activeOnly: String(req.query.activeOnly ?? "1") !== "0",
    });
    return res.json({ billingRoads: roads });
  });

  /** Admin gear — shop capability / car-type / cert-type catalogs. */
  app.get("/api/repair/admin/shop-catalog/:kind", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const kind = String(req.params.kind) as CatalogKind;
    if (!["capability", "car_type", "cert_type"].includes(kind)) {
      return res.status(400).json({ error: "kind must be capability|car_type|cert_type" });
    }
    const items = await listCatalog(kind, {
      activeOnly: String(req.query.activeOnly ?? "1") !== "0",
    });
    return res.json({ kind, items });
  });

  app.post("/api/repair/admin/shop-catalog/:kind", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const kind = String(req.params.kind) as CatalogKind;
    if (!["capability", "car_type", "cert_type"].includes(kind)) {
      return res.status(400).json({ error: "kind must be capability|car_type|cert_type" });
    }
    const body = req.body ?? {};
    const result = await upsertCatalogItem({
      kind,
      code: String(body.code ?? ""),
      displayName: String(body.displayName ?? body.display_name ?? ""),
      sortOrder: body.sortOrder != null ? Number(body.sortOrder) : undefined,
      active: body.active != null ? Boolean(body.active) : true,
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(result);
  });

  app.post("/api/repair/admin/shop-catalog/:kind/:id/deactivate", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const kind = String(req.params.kind) as CatalogKind;
    if (!["capability", "car_type", "cert_type"].includes(kind)) {
      return res.status(400).json({ error: "kind must be capability|car_type|cert_type" });
    }
    const result = await deactivateCatalogItem({
      kind,
      id: String(req.params.id),
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.get("/api/repair/workspace", async (_req, res) => {
    return res.json({
      title: await workspaceTitle(),
      entityTags: await listOwnerEntityTags(),
    });
  });

  app.get("/api/repair/entity-tags", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({
      tags: await listOwnerEntityTags(undefined, {
        includeInactive: String(req.query.includeInactive ?? "") === "1",
      }),
    });
  });

  app.get("/api/repair/events/:id/entity", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const snap = await getEventEntitySnapshot(String(req.params.id));
    if (!snap) return res.status(404).json({ error: "Event not found" });
    return res.json({ entity: snap });
  });

  app.post("/api/repair/events/:id/entity-correct", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const body = req.body ?? {};
    const result = await correctEventEntity({
      eventId: String(req.params.id),
      newCode: String(body.newCode ?? body.entityCode ?? ""),
      reason: String(body.reason ?? ""),
      actor: actorFrom(req),
      estimateId: body.estimateId ? String(body.estimateId) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.get("/api/repair/bo-rules", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const activeOnly = String(req.query.activeOnly ?? "1") !== "0";
    return res.json({
      rules: await listBoRules({ activeOnly }),
      label: "Bad Order Reason",
    });
  });

  app.post("/api/repair/bo-rules", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const body = req.body ?? {};
    const eventRuleRaw = String(body.eventRule ?? "RULE_1").toUpperCase();
    const eventRule =
      eventRuleRaw === "RULE_107"
        ? ("RULE_107" as const)
        : eventRuleRaw === "OTHER"
          ? ("OTHER" as const)
          : ("RULE_1" as const);
    const result = await createBoRule({
      code: body.code != null ? String(body.code) : undefined,
      shortName:
        body.shortName != null
          ? String(body.shortName)
          : body.code != null
            ? String(body.code)
            : undefined,
      description: String(body.description ?? body.name ?? ""),
      eventRule,
      isRuleBased: Boolean(body.isRuleBased),
      requiresOtherText:
        body.requiresOtherText != null
          ? Boolean(body.requiresOtherText)
          : undefined,
      allowsAdditionalDetail: body.allowsAdditionalDetail !== false,
      sortOrder: body.sortOrder != null ? Number(body.sortOrder) : undefined,
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(result);
  });

  app.patch("/api/repair/bo-rules/:id", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const body = req.body ?? {};
    const eventRuleRaw =
      body.eventRule != null ? String(body.eventRule).toUpperCase() : null;
    const eventRule =
      eventRuleRaw == null
        ? undefined
        : eventRuleRaw === "RULE_107"
          ? ("RULE_107" as const)
          : eventRuleRaw === "OTHER"
            ? ("OTHER" as const)
            : ("RULE_1" as const);
    const result = await updateBoRule({
      id: String(req.params.id),
      description:
        body.description != null
          ? String(body.description)
          : body.name != null
            ? String(body.name)
            : undefined,
      shortName:
        body.shortName !== undefined
          ? body.shortName == null
            ? null
            : String(body.shortName)
          : undefined,
      active: body.active != null ? Boolean(body.active) : undefined,
      requiresOtherText:
        body.requiresOtherText != null ? Boolean(body.requiresOtherText) : undefined,
      allowsAdditionalDetail:
        body.allowsAdditionalDetail != null
          ? Boolean(body.allowsAdditionalDetail)
          : undefined,
      isRuleBased:
        body.isRuleBased != null ? Boolean(body.isRuleBased) : undefined,
      eventRule,
      sortOrder: body.sortOrder != null ? Number(body.sortOrder) : undefined,
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/bo-rules/:id/deactivate", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await deactivateBoRule({
      id: String(req.params.id),
      actor: actorFrom(req),
      reason: req.body?.reason ? String(req.body.reason) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.get("/api/repair/stcc", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const activeOnly = String(req.query.activeOnly ?? "1") !== "0";
    return res.json({ codes: await listStccCodes({ activeOnly }) });
  });

  app.get("/api/repair/cars/entity", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const carMark = String(req.query.carMark ?? "").trim();
    const carNumber = String(req.query.carNumber ?? "").trim();
    if (!carMark || !carNumber) {
      return res.status(400).json({ error: "carMark and carNumber required" });
    }
    const snap = await resolveEntitySnapshot({ carMark, carNumber });
    const lookup = await lookupCarEntity({ carMark, carNumber });
    return res.json({ entity: snap, lookup });
  });

  app.get("/api/repair/bad-orders/open", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const carMark = String(req.query.carMark ?? "").trim();
    const carNumber = String(req.query.carNumber ?? "").trim();
    if (!carMark || !carNumber) {
      return res.status(400).json({ error: "carMark and carNumber required" });
    }
    return res.json({
      open: await findOpenBadOrdersForCar({ carMark, carNumber }),
    });
  });

  app.get("/api/repair/bad-orders/grid", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const statusCodes = req.query.status
      ? String(req.query.status).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const shopIds = req.query.shopId
      ? String(req.query.shopId).split(",").map((s) => s.trim()).filter(Boolean)
      : req.query.shopIds
        ? String(req.query.shopIds).split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
    const dateFieldRaw = req.query.dateField
      ? String(req.query.dateField)
      : "ignore";
    const dateField = (
      ["ignore", "bo_date", "arrival", "incident", "yard_arrival", "created"].includes(
        dateFieldRaw,
      )
        ? dateFieldRaw
        : "ignore"
    ) as BoGridDateField;
    const grid = await queryBadOrderGrid({
      statusCodes,
      shopIds,
      carMark: req.query.carMark ? String(req.query.carMark) : undefined,
      carNumber: req.query.carNumber ? String(req.query.carNumber) : undefined,
      fromDate: req.query.from ? String(req.query.from) : undefined,
      toDate: req.query.to ? String(req.query.to) : undefined,
      dateField,
      limit: req.query.limit != null ? Number(req.query.limit) : undefined,
      offset: req.query.offset != null ? Number(req.query.offset) : undefined,
      sortBy: req.query.sortBy ? String(req.query.sortBy) : undefined,
      sortDir: req.query.sortDir === "asc" ? "asc" : "desc",
    });
    return res.json({
      ...grid,
      defaultStatuses: [...DEFAULT_BO_STATUSES],
    });
  });

  app.get("/api/repair/bad-orders/grid/export", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const statusCodes = req.query.status
      ? String(req.query.status).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const shopIds = req.query.shopId
      ? String(req.query.shopId).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const exported = await exportBadOrderGridCsv({
      statusCodes,
      shopIds,
      carMark: req.query.carMark ? String(req.query.carMark) : undefined,
      carNumber: req.query.carNumber ? String(req.query.carNumber) : undefined,
      fromDate: req.query.from ? String(req.query.from) : undefined,
      toDate: req.query.to ? String(req.query.to) : undefined,
      dateField: req.query.dateField
        ? (String(req.query.dateField) as BoGridDateField)
        : "ignore",
      sortBy: req.query.sortBy ? String(req.query.sortBy) : undefined,
      sortDir: req.query.sortDir === "asc" ? "asc" : "desc",
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=bad-orders-grid.csv",
    );
    return res.send(exported.csv);
  });

  app.get("/api/repair/contacts", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const partyType = req.query.partyType
      ? (String(req.query.partyType) as "shop" | "lessee" | "other")
      : undefined;
    const contacts = await getContactsProvider().list({
      partyType,
      activeOnly: String(req.query.activeOnly ?? "1") !== "0",
    });
    return res.json({ contacts });
  });

  app.get("/api/repair/distribution-list", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({ entries: await listDistributionEntries() });
  });

  app.post("/api/repair/distribution-list", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await addDistributionEntry({
      email: String(req.body?.email ?? ""),
      name: req.body?.name ? String(req.body.name) : undefined,
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(result);
  });

  app.post("/api/repair/distribution-list/:id/remove", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await removeDistributionEntry({
      id: String(req.params.id),
      actor: actorFrom(req),
      reason: req.body?.reason ? String(req.body.reason) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/bad-orders", async (req, res) => {
    try {
      const uid = await maybeRequireUser(deps, req, res);
      if (!uid) return;
      const body = req.body ?? {};
      const carLoadRaw = String(body.carLoad ?? "").toUpperCase();
      const result = await createBadOrder({
        carMark: String(body.carMark ?? ""),
        carNumber: String(body.carNumber ?? ""),
        boRuleCode: body.boRuleCode
          ? String(body.boRuleCode)
          : body.rule
            ? String(body.rule)
            : undefined,
        boRuleOtherText: body.boRuleOtherText
          ? String(body.boRuleOtherText)
          : body.otherText
            ? String(body.otherText)
            : undefined,
        rule: body.rule === "RULE_107" ? "RULE_107" : body.rule === "RULE_1" ? "RULE_1" : undefined,
        source:
          body.source === "DDCT" || body.source === "EMAIL_DOC"
            ? body.source
            : "INTERNAL",
        shoppingReason: body.shoppingReason ? String(body.shoppingReason) : undefined,
        damagingRoad: body.damagingRoad
          ? String(body.damagingRoad)
          : body.reportingRoad
            ? String(body.reportingRoad)
            : undefined,
        reportingRoad: body.reportingRoad ? String(body.reportingRoad) : undefined,
        dcRoad: body.dcRoad ? String(body.dcRoad) : undefined,
        stcc: body.stcc ? String(body.stcc) : undefined,
        routing: body.routing ? String(body.routing) : undefined,
        lastContents: body.lastContents ? String(body.lastContents) : undefined,
        carLoad: carLoadRaw === "LOADED" || carLoadRaw === "EMPTY" ? carLoadRaw : undefined,
        cleaned: Boolean(body.cleaned),
        travelOnOwnWheels:
          body.travelOnOwnWheels == null ? true : Boolean(body.travelOnOwnWheels),
        incidentDate: body.incidentDate ? String(body.incidentDate) : undefined,
        comments: body.comments ? String(body.comments) : undefined,
        arrivalDate: body.arrivalDate ? String(body.arrivalDate) : undefined,
        billingRoad: body.billingRoad ? String(body.billingRoad) : undefined,
        billingRoadOverrideReason: body.billingRoadOverrideReason
          ? String(body.billingRoadOverrideReason)
          : undefined,
        ddctEventId: body.ddctEventId ? String(body.ddctEventId) : undefined,
        ddctIncidentId: body.ddctIncidentId ? String(body.ddctIncidentId) : undefined,
        shopId: body.shopId ? String(body.shopId) : undefined,
        isWreck: Boolean(body.isWreck),
        wreckEstimate: Boolean(body.wreckEstimate),
        boDate: body.boDate ? String(body.boDate) : undefined,
        boCity: body.boCity ? String(body.boCity) : undefined,
        boState: body.boState ? String(body.boState) : undefined,
        destCity: body.destCity ? String(body.destCity) : undefined,
        destState: body.destState ? String(body.destState) : undefined,
        allowDuplicates:
          body.allowDuplicates == null ? false : Boolean(body.allowDuplicates),
        multiCarGroupId: body.multiCarGroupId
          ? String(body.multiCarGroupId)
          : undefined,
        isTankCar: Boolean(body.isTankCar),
        actor: actorFrom(req),
      });
      if (!result.ok) {
        return res.status(result.status).json({
          error: result.error,
          openBadOrders: "openBadOrders" in result ? result.openBadOrders : undefined,
        });
      }
      return res.status(201).json(result);
    } catch (err) {
      console.error("[repair/bad-orders]", err);
      return res.status(500).json({ error: "BO create failed" });
    }
  });

  /** BO / event attachments (same storage as estimate; delete → VOIDED). */
  app.post(
    "/api/repair/events/:id/documents",
    upload.single("file"),
    async (req, res) => {
      try {
        const uid = await maybeRequireUser(deps, req, res);
        if (!uid) return;
        if (!req.file) return res.status(400).json({ error: "file required" });
        const categoryCode = String(
          req.body?.categoryCode ?? req.body?.category ?? req.body?.kind ?? "other",
        );
        const result = await uploadEventDocument({
          eventId: String(req.params.id),
          kind: String(req.body?.kind ?? categoryCode ?? "bo_attachment"),
          categoryCode,
          comment: req.body?.comment != null ? String(req.body.comment) : undefined,
          actorEmail: actorFrom(req),
          file: {
            filename: req.file.originalname || "upload.bin",
            mime: req.file.mimetype || "application/octet-stream",
            bytes: req.file.buffer,
          },
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(201).json(result);
      } catch (err) {
        console.error("[repair/events/:id/documents]", err);
        return res.status(500).json({ error: "Document upload failed" });
      }
    },
  );

  /**
   * Template carry-over: list source BO document refs (client stages checkboxes).
   * Prefer this lightweight listing when filling "New from existing…".
   */
  app.get("/api/repair/events/:id/documents/template-refs", async (req, res) => {
    try {
      const uid = await maybeRequireUser(deps, req, res);
      if (!uid) return;
      const documents = await listTemplateDocumentRefs({
        eventId: String(req.params.id),
      });
      return res.json({ documents });
    } catch (err) {
      console.error("[repair/events/:id/documents/template-refs]", err);
      return res.status(500).json({ error: "Document list failed" });
    }
  });

  /**
   * Link existing stored files onto a new BO event (copy document row / storage
   * reference — do not duplicate file bytes). Used by Start-from-previous template.
   */
  app.post("/api/repair/events/:id/documents/link", async (req, res) => {
    try {
      const uid = await maybeRequireUser(deps, req, res);
      if (!uid) return;
      const body = req.body ?? {};
      const ids = Array.isArray(body.documentIds)
        ? body.documentIds.map((x: unknown) => String(x))
        : Array.isArray(body.sourceDocumentIds)
          ? body.sourceDocumentIds.map((x: unknown) => String(x))
          : [];
      const result = await linkEventDocumentRefs({
        eventId: String(req.params.id),
        sourceDocumentIds: ids,
        actor: actorFrom(req),
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.status(201).json(result);
    } catch (err) {
      console.error("[repair/events/:id/documents/link]", err);
      return res.status(500).json({ error: "Document link failed" });
    }
  });

  /** Single-document viewer / download — server-side ACL (§E). */
  app.get("/api/repair/documents/:id/content", async (req, res) => {
    try {
      const uid = await maybeRequireUser(deps, req, res);
      if (!uid) return;
      const role = String(
        req.query.role ?? req.headers["x-repair-role"] ?? roleFrom(req),
      );
      const grantedRaw = req.query.granted;
      const grantedDocumentIds = grantedRaw
        ? String(grantedRaw)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      const result = await getDocumentContent({
        documentId: String(req.params.id),
        actorRole: role,
        grantedDocumentIds,
        actor: actorFrom(req),
        audit: String(req.query.audit ?? "1") !== "0",
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      const filename = String(
        result.document.original_filename || result.document.kind || "document",
      );
      const disposition =
        String(req.query.download ?? "") === "1" ? "attachment" : "inline";
      res.setHeader(
        "Content-Type",
        String(result.document.mime || "application/octet-stream"),
      );
      res.setHeader(
        "Content-Disposition",
        `${disposition}; filename="${filename.replace(/"/g, "")}"`,
      );
      res.setHeader("X-Repair-Preview-Kind", previewKindFor(result.document));
      return res.send(result.bytes);
    } catch (err) {
      console.error("[repair/documents/:id/content]", err);
      return res.status(500).json({ error: "Document download failed" });
    }
  });

  /** §E Document Viewer payload (estimate / BO event / wreck). */
  app.get("/api/repair/documents/viewer", async (req, res) => {
    try {
      const uid = await maybeRequireUser(deps, req, res);
      if (!uid) return;
      const role = String(
        req.query.role ?? req.headers["x-repair-role"] ?? roleFrom(req),
      );
      const grantedRaw = req.query.granted;
      const result = await listViewerDocuments({
        estimateId: req.query.estimateId
          ? String(req.query.estimateId)
          : undefined,
        eventId: req.query.eventId ? String(req.query.eventId) : undefined,
        wreckEventId: req.query.wreckEventId
          ? String(req.query.wreckEventId)
          : undefined,
        actorRole: role,
        showVoided: String(req.query.showVoided ?? "") === "1",
        grantedDocumentIds: grantedRaw
          ? String(grantedRaw)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        categoryCode: req.query.category
          ? String(req.query.category)
          : undefined,
        revisionId: req.query.revisionId
          ? String(req.query.revisionId)
          : undefined,
        uploaderRole: req.query.uploader
          ? String(req.query.uploader)
          : undefined,
        dateFrom: req.query.dateFrom ? String(req.query.dateFrom) : undefined,
        dateTo: req.query.dateTo ? String(req.query.dateTo) : undefined,
        search: req.query.q ? String(req.query.q) : undefined,
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json(result);
    } catch (err) {
      console.error("[repair/documents/viewer]", err);
      return res.status(500).json({ error: "Document viewer load failed" });
    }
  });

  /** 500-byte decoded field grid (+ raw). */
  app.get("/api/repair/documents/:id/aar-preview", async (req, res) => {
    try {
      const uid = await maybeRequireUser(deps, req, res);
      if (!uid) return;
      const role = String(
        req.query.role ?? req.headers["x-repair-role"] ?? roleFrom(req),
      );
      const grantedRaw = req.query.granted;
      const result = await decodeAar500Preview({
        documentId: String(req.params.id),
        actorRole: role,
        grantedDocumentIds: grantedRaw
          ? String(grantedRaw)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json(result);
    } catch (err) {
      console.error("[repair/documents/:id/aar-preview]", err);
      return res.status(500).json({ error: "AAR preview failed" });
    }
  });

  /** Bulk zip download (audited). */
  app.post("/api/repair/documents/zip", async (req, res) => {
    try {
      const uid = await maybeRequireUser(deps, req, res);
      if (!uid) return;
      const role = String(
        req.body?.actorRole ?? req.headers["x-repair-role"] ?? roleFrom(req),
      );
      const ids = Array.isArray(req.body?.documentIds)
        ? req.body.documentIds.map(String)
        : [];
      const result = await zipViewerDocuments({
        documentIds: ids,
        eventId: req.body?.eventId ? String(req.body.eventId) : undefined,
        estimateId: req.body?.estimateId
          ? String(req.body.estimateId)
          : undefined,
        actorRole: role,
        grantedDocumentIds: Array.isArray(req.body?.grantedDocumentIds)
          ? req.body.grantedDocumentIds.map(String)
          : undefined,
        actor: actorFrom(req),
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${result.filename}"`,
      );
      res.setHeader("X-Repair-Zip-Count", String(result.count));
      res.setHeader("X-Repair-Zip-Sha256", result.sha256);
      return res.send(result.bytes);
    } catch (err) {
      console.error("[repair/documents/zip]", err);
      return res.status(500).json({ error: "Zip download failed" });
    }
  });

  /** Owner: attach selected docs to Send Lessee staging. */
  app.post("/api/repair/documents/attach-send-lessee", async (req, res) => {
    try {
      const uid = await maybeRequireUser(deps, req, res);
      if (!uid) return;
      const role = String(
        req.body?.actorRole ?? req.headers["x-repair-role"] ?? roleFrom(req),
      );
      const result = await attachDocumentsToSendLessee({
        estimateId: String(req.body?.estimateId ?? ""),
        documentIds: Array.isArray(req.body?.documentIds)
          ? req.body.documentIds.map(String)
          : [],
        actor: actorFrom(req),
        actorRole: role,
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json(result);
    } catch (err) {
      console.error("[repair/documents/attach-send-lessee]", err);
      return res.status(500).json({ error: "Attach Send Lessee failed" });
    }
  });

  app.post("/api/repair/documents/:id/owner-only", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await setDocumentOwnerOnly({
      documentId: String(req.params.id),
      ownerOnly: req.body?.ownerOnly !== false,
      actor: actorFrom(req),
      actorRole: String(req.body?.actorRole ?? roleFrom(req)),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  /** Shop link soft-delete / recategorize stay 403 (add only). */
  app.post("/api/repair/e/:token/documents/:id/recategorize", async (_req, res) => {
    return res.status(403).json({
      error: "Shop cannot delete, void, or recategorize attachments (add only)",
    });
  });

  app.get("/api/repair/events/:id", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const event = await getEvent(String(req.params.id));
    if (!event) return res.status(404).json({ error: "Not found" });
    const estimates = await listEstimatesForEvent(String(req.params.id));
    return res.json({ event, estimates });
  });

  app.post("/api/repair/events/:id/links", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const scope = String(req.body?.scope ?? "SHOP").toUpperCase();
    if (scope !== "SHOP" && scope !== "LESSEE") {
      return res.status(400).json({ error: "scope must be SHOP or LESSEE" });
    }
    const issued = await issueEventLink({
      eventId: String(req.params.id),
      scope,
      partyRef: req.body?.partyRef ? String(req.body.partyRef) : undefined,
      actor: actorFrom(req),
    });
    return res.status(201).json({
      link: issued.link,
      token: issued.token,
      shopUrlPath: `/repair/e/${issued.token}`,
      note: "Raw token shown once; only hash is stored.",
    });
  });

  app.post("/api/repair/links/:id/revoke", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const row = await revokeEventLink({
      linkId: String(req.params.id),
      actor: actorFrom(req),
    });
    if (!row) return res.status(404).json({ error: "Link not found or already revoked" });
    return res.json({ link: row });
  });

  app.post("/api/repair/links/:id/reissue", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const issued = await reissueEventLink({
      linkId: String(req.params.id),
      actor: actorFrom(req),
    });
    if (!issued) return res.status(404).json({ error: "Link not found" });
    return res.status(201).json({
      link: issued.link,
      token: issued.token,
      shopUrlPath: `/repair/e/${issued.token}`,
    });
  });

  app.get("/api/repair/estimates/:id/revisions", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const revisions = await listRevisions(String(req.params.id));
    return res.json({ revisions });
  });

  app.get("/api/repair/revisions/:id/lines", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({ lines: await getRevisionLines(String(req.params.id)) });
  });

  app.post("/api/repair/estimates/:id/submit", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await submitForApproval({
      estimateId: String(req.params.id),
      actor: actorFrom(req),
      comment: req.body?.comment ? String(req.body.comment) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/estimates/:id/request-revision", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await requestRevision({
      estimateId: String(req.params.id),
      actor: actorFrom(req),
      comment: req.body?.comment ? String(req.body.comment) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/estimates/:id/approve", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await approveEstimate({
      estimateId: String(req.params.id),
      actor: actorFrom(req),
      comment: req.body?.comment ? String(req.body.comment) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.get("/api/repair/resp-codes", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const tenantId = String(req.query.tenantId ?? DEFAULT_TENANT_ID);
    return res.json({ codes: await listResponsibilityCodes(tenantId) });
  });

  /** Review payload (§D): compact context, RS line fields, optional any-two-rev compare. */
  app.get("/api/repair/estimates/:id/review", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const estimateId = String(req.params.id);
    const fromQ = req.query.fromRev != null ? Number(req.query.fromRev) : undefined;
    const toQ = req.query.toRev != null ? Number(req.query.toRev) : undefined;
    const result = await buildEstimateReviewPayload({
      estimateId,
      compareFromRev: Number.isFinite(fromQ) ? fromQ : undefined,
      compareToRev: Number.isFinite(toQ) ? toQ : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/estimates/:id/billing-category", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await setBillingCategory({
      estimateId: String(req.params.id),
      billingCategory: String(req.body?.billingCategory ?? ""),
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/estimates/:id/header-edit", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await editHeaderField({
      estimateId: String(req.params.id),
      fieldKey: String(req.body?.fieldKey ?? ""),
      newValue: String(req.body?.newValue ?? ""),
      reason: String(req.body?.reason ?? ""),
      actor: actorFrom(req),
      actorRole: req.body?.actorRole ? String(req.body.actorRole) : "reviewer",
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(result);
  });

  app.get("/api/repair/estimates/:id/header-edits", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({ edits: await listHeaderEdits({ estimateId: String(req.params.id) }) });
  });

  app.post("/api/repair/estimates/:id/lessee-approval", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const body = req.body ?? {};
    const estimateId = String(req.params.id);
    const { rows } = await q(
      `SELECT e.id AS estimate_id, e.event_id, e.current_revision,
              r.id AS revision_id
       FROM repair.estimates e
       JOIN repair.estimate_revisions r
         ON r.estimate_id = e.id AND r.rev_no = e.current_revision
       WHERE e.id = $1 AND e.deleted_at IS NULL`,
      [estimateId],
    );
    if (!rows[0]) return res.status(404).json({ error: "Estimate/revision not found" });
    const docs = Array.isArray(body.documentIds)
      ? body.documentIds.map(String)
      : body.documentId
        ? [String(body.documentId)]
        : [];
    const extraTo = Array.isArray(body.extraTo) ? body.extraTo.map(String) : [];
    const result = await sendLesseeApprovalRequest({
      eventId: String(rows[0].event_id),
      estimateId,
      revisionId: String(rows[0].revision_id),
      lesseeEmail: body.lesseeEmail ? String(body.lesseeEmail) : undefined,
      extraTo,
      documentIds: docs,
      actor: actorFrom(req),
      note: body.note ? String(body.note) : undefined,
      subject: body.subject ? String(body.subject) : undefined,
      bodyText: body.bodyText ? String(body.bodyText) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(result);
  });

  app.get("/api/repair/estimates/:id/send-lessee", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await buildSendLesseePreview({
      estimateId: String(req.params.id),
      actor: actorFrom(req),
      actorEmail: actorFrom(req),
    });
    if (!result.ok) {
      return res.status(result.status ?? 400).json({ error: result.error });
    }
    return res.json(result);
  });

  /** Billing Repair Card PDF — audience=owner|lessee|shop (default owner). */
  app.get("/api/repair/estimates/:id/brc-pdf", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const raw = String(req.query.audience ?? "owner").toLowerCase();
    const audience: BrcAudience =
      raw === "lessee" || raw === "shop" || raw === "owner" ? raw : "owner";
    const result = await buildBrcPdf({
      estimateId: String(req.params.id),
      audience,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    const name = `${result.doc.carCompact || "estimate"}_BRC_${audience}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    return res.send(result.bytes);
  });

  /** §F Owner: lessee status / due / history on Estimate Review. */
  app.get("/api/repair/estimates/:id/lessee-status", async (req, res) => {
    try {
      // Never cache — Accept/Reject must surface on poll / refresh (r2 root-cause).
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      const uid = await maybeRequireUser(deps, req, res);
      if (!uid) return;
      const panel = await getOwnerLesseePanel({
        estimateId: String(req.params.id),
      });
      return res.json(panel);
    } catch (err) {
      console.error("[repair/estimates/:id/lessee-status]", err);
      return res.status(500).json({ error: "Failed to load lessee status" });
    }
  });

  app.post("/api/repair/estimates/:id/lessee-manual", async (req, res) => {
    try {
      const uid = await maybeRequireUser(deps, req, res);
      if (!uid) return;
      const body = req.body ?? {};
      const decision =
        String(body.decision ?? "").toUpperCase() === "REJECT" ? "REJECT" : "APPROVE";
      const result = await recordManualLesseeDecision({
        estimateId: String(req.params.id),
        decision,
        note: String(body.note ?? ""),
        actor: String(body.actor ?? uid),
        lesseeEmail: body.lesseeEmail ? String(body.lesseeEmail) : undefined,
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json(result);
    } catch (err) {
      console.error("[repair/estimates/:id/lessee-manual]", err);
      return res.status(500).json({ error: "Manual lessee decision failed" });
    }
  });

  app.post("/api/repair/estimates/:id/lessee-flag-overdue", async (req, res) => {
    try {
      const uid = await maybeRequireUser(deps, req, res);
      if (!uid) return;
      const result = await flagLesseeOverdueIfNeeded({
        estimateId: String(req.params.id),
      });
      return res.json(result);
    } catch (err) {
      console.error("[repair/estimates/:id/lessee-flag-overdue]", err);
      return res.status(500).json({ error: "Overdue flag failed" });
    }
  });

  app.get("/api/repair/estimates/:id/send-lessee/history", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json(
      await listSendLesseeHistory({ estimateId: String(req.params.id) }),
    );
  });

  app.get("/api/repair/estimates/:id/send-lessee/attachment-preview", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const kindRaw = String(req.query.kind ?? "");
    const kind =
      kindRaw === "pdf" || kindRaw === "data" ? (kindRaw as "pdf" | "data") : undefined;
    const result = await previewAttachmentContent({
      estimateId: String(req.params.id),
      documentId: req.query.documentId ? String(req.query.documentId) : undefined,
      kind,
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/estimates/:id/send-lessee", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const body = req.body ?? {};
    const recipients = Array.isArray(body.recipients)
      ? body.recipients.map(String)
      : body.lesseeEmail
        ? [String(body.lesseeEmail)]
        : [];
    const docs = Array.isArray(body.documentIds)
      ? body.documentIds.map(String)
      : [];
    const cc = Array.isArray(body.cc) ? body.cc.map(String) : undefined;
    const result = await sendLesseeFromPreview({
      estimateId: String(req.params.id),
      recipients,
      subject: String(body.subject ?? ""),
      body: String(body.body ?? body.bodyText ?? ""),
      documentIds: docs,
      includePdf: body.includePdf !== false,
      includeDataFile: body.includeDataFile !== false,
      note: body.note ? String(body.note) : undefined,
      actor: actorFrom(req),
      actorEmail: actorFrom(req),
      cc,
      confirm: Boolean(body.confirm),
    });
    if (!result.ok) return res.status(result.status ?? 400).json({ error: result.error });
    return res.status(201).json(result);
  });

  app.post("/api/repair/lessee-approvals/:id/ingest-reply", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await ingestLesseeReply({
      approvalId: String(req.params.id),
      bodyText: String(req.body?.bodyText ?? req.body?.raw ?? ""),
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/lessee-approvals/:id/confirm-reply", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await confirmLesseeReply({
      approvalId: String(req.params.id),
      accept: Boolean(req.body?.accept ?? true),
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.get("/api/repair/events/:id/audit", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const { rows } = await q(
      `SELECT id, entity, entity_id, action, before_json, after_json, actor, via, at
       FROM repair.audit_events
       WHERE tenant_id = $1
         AND (
           (entity = 'event' AND entity_id = $2::uuid)
           OR (entity = 'estimate' AND entity_id IN (
             SELECT id FROM repair.estimates WHERE event_id = $2::uuid
           ))
           OR (entity = 'event_link' AND entity_id IN (
             SELECT id FROM repair.event_links WHERE event_id = $2::uuid
           ))
         )
       ORDER BY at ASC`,
      [DEFAULT_TENANT_ID, req.params.id],
    );
    return res.json({ audit: rows });
  });

  app.post("/api/repair/dev/email-probe", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await getEmailProvider().send({
      tenantId: DEFAULT_TENANT_ID,
      type: "dev_probe",
      to: [String(req.body?.to ?? "dev@example.invalid")],
      subject: String(req.body?.subject ?? "repair module email probe"),
      bodyText: String(req.body?.body ?? "Log-only probe; not sent."),
    });
    return res.json(result);
  });

  app.post("/api/repair/dev/storage-probe", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const text = String(req.body?.text ?? "repair-storage-probe");
    const stored = await getStorageProvider().put({
      tenantId: DEFAULT_TENANT_ID,
      kind: "probe",
      filename: "probe.txt",
      mime: "text/plain",
      bytes: Buffer.from(text, "utf8"),
    });
    const ok = await getStorageProvider().verify(stored.storageKey, stored.sha256);
    return res.json({ stored, verified: ok });
  });

  // ── POD / completion / invoice / dispo / contacts (authed) ──

  app.post("/api/repair/events/:id/pod", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const kind = String(req.body?.kind ?? "POD").toUpperCase() === "ERD" ? "ERD" : "POD";
    const result = await enterPodErd({
      eventId: String(req.params.id),
      kind,
      dateValue: String(req.body?.dateValue ?? req.body?.date ?? ""),
      enteredBy: actorFrom(req),
      reason: req.body?.reason ? String(req.body.reason) : undefined,
      via: "UI",
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(result);
  });

  app.get("/api/repair/events/:id/pod", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({
      history: await listPodDates(String(req.params.id)),
      latest: await latestPodErd(String(req.params.id)),
    });
  });

  app.post("/api/repair/estimates/:id/complete", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await setCompletedDate({
      estimateId: String(req.params.id),
      completedAt: String(req.body?.completedAt ?? new Date().toISOString()),
      actor: actorFrom(req),
      actorRole: String(req.body?.actorRole ?? "reviewer"),
      comment: req.body?.comment ? String(req.body.comment) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/estimates/:id/rollback-complete", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await rollbackCompletedDate({
      estimateId: String(req.params.id),
      actor: actorFrom(req),
      actorRole: String(req.body?.actorRole ?? "reviewer"),
      comment: req.body?.comment ? String(req.body.comment) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.get("/api/repair/events/:id/invoices", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({ invoices: await listInvoicesForEvent(String(req.params.id)) });
  });

  app.post("/api/repair/invoices/:id/approve", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await approveInvoiceMatch({
      invoiceId: String(req.params.id),
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  /** Pre-pay review queue (CRB inbound invoices awaiting ACH approve / reject). */
  app.get("/api/repair/invoices/prepay-queue", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({ invoices: await listInvoiceReviewQueue() });
  });

  app.get("/api/repair/invoices/:id/prepay-checks", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({
      checks: await listPrepayChecks(String(req.params.id)),
    });
  });

  /**
   * Reviewer decision: APPROVED_FOR_ACH (payment outside RLMS) or REJECTED (reason required).
   * Q20: MISMATCH cannot APPROVED_FOR_ACH — no override; re-audits vs approved estimate.
   * Append-only decision row; original file remains immutable.
   */
  app.post("/api/repair/invoices/:id/prepay-decision", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const decision = String(req.body?.decision ?? "");
    if (decision !== "APPROVED_FOR_ACH" && decision !== "REJECTED") {
      return res.status(400).json({
        error: "decision must be APPROVED_FOR_ACH or REJECTED",
      });
    }
    const result = await decideInvoiceReview({
      invoiceId: String(req.params.id),
      decision,
      reason: req.body?.reason ? String(req.body.reason) : undefined,
      actor: actorFrom(req),
    });
    if (!result.ok) {
      return res.status(result.status).json({
        error: result.error,
        ...("matchStatus" in result ? { matchStatus: result.matchStatus } : {}),
        ...("check" in result ? { check: result.check } : {}),
      });
    }
    return res.json(result);
  });

  /** Q18: reviewer enters real invoice_no when shop file left it blank. */
  app.post("/api/repair/invoices/:id/invoice-no", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await setInvoiceNumberByReviewer({
      invoiceId: String(req.params.id),
      invoiceNo: String(req.body?.invoiceNo ?? ""),
      actor: actorFrom(req),
    });
    if (!result.ok) {
      return res.status(result.status).json({
        error: result.error,
        ...("conflictingInvoiceIds" in result
          ? { conflictingInvoiceIds: result.conflictingInvoiceIds }
          : {}),
      });
    }
    return res.json(result);
  });

  /**
   * Q20: re-audit TOTAL_MATCH vs current approved final estimate
   * (after shop revision or approved Adjustment).
   */
  app.post("/api/repair/invoices/:id/prepay-reaudit", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await reauditInvoiceTotals({
      invoiceId: String(req.params.id),
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/events/:id/dispo", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const direction =
      String(req.body?.direction ?? "to_shop") === "from_shop" ? "from_shop" : "to_shop";
    const result = await relayDispo({
      eventId: String(req.params.id),
      direction,
      instructions: String(req.body?.instructions ?? ""),
      actor: actorFrom(req),
      via: "UI",
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(result);
  });

  app.get("/api/repair/events/:id/dispo", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({ dispo: await listDispo(String(req.params.id)) });
  });

  app.get("/api/repair/contacts", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const partyType = req.query.partyType
      ? (String(req.query.partyType) as "shop" | "lessee" | "other")
      : undefined;
    return res.json({
      contacts: await listContacts({
        partyType:
          partyType === "shop" || partyType === "lessee" || partyType === "other"
            ? partyType
            : undefined,
      }),
    });
  });

  app.post("/api/repair/contacts", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const body = req.body ?? {};
    const partyType = String(body.partyType ?? "other");
    if (partyType !== "shop" && partyType !== "lessee" && partyType !== "other") {
      return res.status(400).json({ error: "partyType must be shop|lessee|other" });
    }
    const result = await upsertContact({
      id: body.id ? String(body.id) : undefined,
      partyType,
      partyRef: body.partyRef ? String(body.partyRef) : undefined,
      name: String(body.name ?? ""),
      email: body.email ? String(body.email) : undefined,
      active: body.active === undefined ? undefined : Boolean(body.active),
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(body.id ? 200 : 201).json(result);
  });

  app.delete("/api/repair/contacts/:id", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await softDeleteContact({
      id: String(req.params.id),
      actor: actorFrom(req),
      reason: req.body?.reason ? String(req.body.reason) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.get("/api/repair/events/:id/adhoc-emails", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({ emails: await listAdhocEmails(String(req.params.id)) });
  });

  app.post("/api/repair/events/:id/adhoc-emails", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const emails = Array.isArray(req.body?.emails)
      ? req.body.emails.map(String)
      : String(req.body?.emails ?? "")
          .split(/[,;\s]+/)
          .filter(Boolean);
    const result = await addAdhocEmails({
      eventId: String(req.params.id),
      emails,
      notificationType: req.body?.notificationType
        ? String(req.body.notificationType)
        : null,
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(result);
  });

  app.get("/api/repair/notification-rules", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({ rules: await listNotificationRules() });
  });

  app.patch("/api/repair/notification-rules/:type", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await updateNotificationRule({
      notificationType: String(req.params.type),
      includeRoles: Array.isArray(req.body?.includeRoles)
        ? req.body.includeRoles.map(String)
        : undefined,
      excludeRoles: Array.isArray(req.body?.excludeRoles)
        ? req.body.excludeRoles.map(String)
        : undefined,
      active: req.body?.active === undefined ? undefined : Boolean(req.body.active),
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/reminders/pod-sweep", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json(await runPodReminders());
  });

  /** Per-shop OTP flags (Q3). Body: { shopId, step, enabled } */
  app.post("/api/repair/settings/otp-steps", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const shopId = String(req.body?.shopId ?? "");
    if (!shopId) {
      return res.status(400).json({
        error: "shopId required — OTP is configured per shop (default off)",
      });
    }
    const step = String(req.body?.step ?? "invoice_submit");
    const enabled = Boolean(req.body?.enabled);
    return res.json(
      await setShopOtpStepFlag({ shopId, step, enabled }),
    );
  });

  app.get("/api/repair/shops/:id/otp-steps", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json(await getShopOtpSteps({ shopId: String(req.params.id) }));
  });

  /** Evaluate Ready-to-Close conditions (invoice MATCHED + dispo). */
  app.post("/api/repair/events/:id/ready-to-close", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await maybeMarkReadyToClose({
      eventId: String(req.params.id),
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  /** Reviewer one-click close from READY_TO_CLOSE (audited). */
  app.post("/api/repair/events/:id/close", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await closeEvent({
      eventId: String(req.params.id),
      actor: actorFrom(req),
      actorRole: String(req.body?.actorRole ?? "reviewer"),
      comment: req.body?.comment ? String(req.body.comment) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  /** Preview CLOSED events with unlocked Resp 6/3 for monthly rebill. */
  app.get("/api/repair/billing/lessee-rebill-candidates", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const collected = await collectRebillEvents({});
    if (!collected.ok) {
      return res.status(collected.status).json(collected);
    }
    return res.json({ groups: collected.groups, count: collected.groups.length });
  });

  app.get("/api/repair/billing/close-runs", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({ runs: await listCloseRuns() });
  });

  app.post("/api/repair/billing/periods", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await ensureBillingPeriod({
      accountMonth: String(req.body?.accountMonth ?? ""),
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(result);
  });

  /**
   * Monthly close: collect CLOSED+Resp6/3 events, bulk rebuttal invoices,
   * write local CRIPYYMM file (no FTP), validate, audit, lock events.
   * Outbound billing party = tenant carOwnerMark; billed party from mapping.
   */
  app.post("/api/repair/billing/monthly-close", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await runMonthlyClose({
      accountMonth: req.body?.accountMonth
        ? String(req.body.accountMonth)
        : undefined,
      actor: actorFrom(req),
      exportDir: req.body?.exportDir ? String(req.body.exportDir) : undefined,
      dryRun: Boolean(req.body?.dryRun),
    });
    if (!result.ok) {
      return res.status(result.status).json(result);
    }
    return res.status(201).json(result);
  });

  /** Validate a CRB/CRIP buffer (dev/smoke). Body: { text } or multipart file. */
  app.post("/api/repair/billing/validate-crip", upload.single("file"), async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    let bytes: Buffer | null = null;
    if (req.file?.buffer) bytes = req.file.buffer;
    else if (typeof req.body?.text === "string") {
      bytes = Buffer.from(req.body.text, "latin1");
    }
    if (!bytes) {
      return res.status(400).json({ error: "Provide file or text body" });
    }
    try {
      return res.json(validateCripBytes(bytes));
    } catch (err) {
      return res.status(422).json({
        ok: false,
        error: err instanceof Error ? err.message : "Validation failed",
      });
    }
  });

  /** Q14 helper: parse inbound shop Format-1 marks (billing=shop, billed=owner). */
  app.post("/api/repair/billing/inbound-marks", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const line = String(req.body?.rawLine ?? "");
    const marks = resolveInboundShopMarks(line);
    if (!marks) {
      return res.status(400).json({ error: "Provide a 500-char Format 1 rawLine" });
    }
    const owner = await getCarOwnerMark();
    return res.json({
      direction: "inbound_shop_invoice",
      ...marks,
      tenantCarOwnerMark: owner.ok ? owner.mark : null,
      note: "Inbound: billing=shop mark (cols 2-5), billed=car owner (cols 6-9) from shop file.",
    });
  });

  app.get("/api/repair/billing/car-owner-mark", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const owner = await getCarOwnerMark();
    if (!owner.ok) return res.status(422).json({ error: owner.error });
    return res.json({ carOwnerMark: owner.mark });
  });

  app.get("/api/repair/billed-party-mappings", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const role = req.query.partyRole
      ? (String(req.query.partyRole).toUpperCase() as "LESSEE" | "RAILROAD")
      : undefined;
    if (role && role !== "LESSEE" && role !== "RAILROAD") {
      return res.status(400).json({ error: "partyRole must be LESSEE or RAILROAD" });
    }
    return res.json({
      mappings: await listBilledPartyMappings({
        partyRole: role,
        includeInactive: String(req.query.includeInactive ?? "") === "1",
      }),
    });
  });

  app.get("/api/repair/billed-party-mappings/:id/history", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({
      history: await listBilledPartyMappingHistory(String(req.params.id)),
    });
  });

  app.post("/api/repair/billed-party-mappings", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const body = req.body ?? {};
    const result = await upsertBilledPartyMapping({
      id: body.id ? String(body.id) : undefined,
      carMark: body.carMark != null ? String(body.carMark) : null,
      carNumber: body.carNumber != null ? String(body.carNumber) : null,
      leaseRider: body.leaseRider != null ? String(body.leaseRider) : null,
      partyRole: String(body.partyRole ?? "LESSEE").toUpperCase() as "LESSEE" | "RAILROAD",
      billedPartyMark: String(body.billedPartyMark ?? ""),
      paymentTermsDays:
        body.paymentTermsDays === undefined || body.paymentTermsDays === null
          ? null
          : Number(body.paymentTermsDays),
      notes: body.notes != null ? String(body.notes) : null,
      active: body.active === undefined ? undefined : Boolean(body.active),
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(body.id ? 200 : 201).json(result);
  });

  app.delete("/api/repair/billed-party-mappings/:id", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await softDeleteBilledPartyMapping({
      id: String(req.params.id),
      actor: actorFrom(req),
      reason: req.body?.reason ? String(req.body.reason) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  // ── Estimate load / statuses / BO / collab / tank / ops (gap slice) ──

  app.post("/api/repair/bad-orders/bulk", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const body = req.body ?? {};
    const carLoadRaw = String(body.carLoad ?? "").toUpperCase();
    const result = await bulkCreateBadOrders({
      pastedCars: String(body.cars ?? body.pastedCars ?? ""),
      headerInitials: body.headerInitials
        ? String(body.headerInitials)
        : undefined,
      shopId: body.shopId ? String(body.shopId) : undefined,
      rule: body.rule === "RULE_107" ? "RULE_107" : "RULE_1",
      boRuleCode: body.boRuleCode ? String(body.boRuleCode) : undefined,
      boRuleOtherText: body.boRuleOtherText
        ? String(body.boRuleOtherText)
        : undefined,
      shoppingReason: body.shoppingReason
        ? String(body.shoppingReason)
        : undefined,
      boCity: body.boCity ? String(body.boCity) : undefined,
      boState: body.boState ? String(body.boState) : undefined,
      destCity: body.destCity ? String(body.destCity) : undefined,
      destState: body.destState ? String(body.destState) : undefined,
      allowDuplicates:
        body.allowDuplicates == null ? false : Boolean(body.allowDuplicates),
      shared: {
        reportingRoad: body.reportingRoad ? String(body.reportingRoad) : undefined,
        dcRoad: body.dcRoad ? String(body.dcRoad) : undefined,
        stcc: body.stcc ? String(body.stcc) : undefined,
        routing: body.routing ? String(body.routing) : undefined,
        lastContents: body.lastContents ? String(body.lastContents) : undefined,
        carLoad:
          carLoadRaw === "LOADED" || carLoadRaw === "EMPTY" ? carLoadRaw : undefined,
        cleaned: Boolean(body.cleaned),
        travelOnOwnWheels:
          body.travelOnOwnWheels == null ? true : Boolean(body.travelOnOwnWheels),
        incidentDate: body.incidentDate ? String(body.incidentDate) : undefined,
        comments: body.comments ? String(body.comments) : undefined,
        arrivalDate: body.arrivalDate ? String(body.arrivalDate) : undefined,
        billingRoad: body.billingRoad ? String(body.billingRoad) : undefined,
        billingRoadOverrideReason: body.billingRoadOverrideReason
          ? String(body.billingRoadOverrideReason)
          : undefined,
        ddctEventId: body.ddctEventId ? String(body.ddctEventId) : undefined,
        ddctIncidentId: body.ddctIncidentId
          ? String(body.ddctIncidentId)
          : undefined,
        boDate: body.boDate ? String(body.boDate) : undefined,
        isWreck: Boolean(body.isWreck),
        wreckEstimate: Boolean(body.wreckEstimate),
      },
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(result);
  });

  app.get("/api/repair/estimate-loads/:id", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const run = await getEstimateLoadRun(String(req.params.id));
    if (!run) return res.status(404).json({ error: "Load run not found" });
    return res.json(run);
  });

  app.post("/api/repair/estimate-loads/:id/decide-warnings", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const decision = String(req.body?.decision ?? "").toUpperCase();
    if (decision !== "ACCEPT_WARNINGS" && decision !== "REJECT_WARNINGS") {
      return res.status(400).json({ error: "decision must be ACCEPT_WARNINGS or REJECT_WARNINGS" });
    }
    const result = await decideEstimateLoadWarnings({
      loadRunId: String(req.params.id),
      decision: decision as "ACCEPT_WARNINGS" | "REJECT_WARNINGS",
      actor: actorFrom(req),
      reason: req.body?.reason ? String(req.body.reason) : undefined,
    });
    if (!result.ok) return res.status(result.status ?? 400).json(result);
    return res.json(result);
  });

  app.post(
    "/api/repair/estimates/load-aar",
    upload.single("file"),
    async (req, res) => {
      const uid = await maybeRequireUser(deps, req, res);
      if (!uid) return;
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: "500-byte file required" });
      }
      const result = await loadEstimateAar({
        bytes: req.file.buffer,
        filename: req.file.originalname || "estimate.dat",
        mime: req.file.mimetype || "text/plain",
        source: "UI",
        eventId: req.body?.eventId ? String(req.body.eventId) : undefined,
        actor: actorFrom(req),
        comment: req.body?.comment ? String(req.body.comment) : undefined,
      });
      if (!result.ok) return res.status(result.status).json(result);
      return res.status(result.pendingWarnings ? 202 : 201).json(result);
    },
  );

  app.post("/api/repair/estimates/:id/void", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await voidEstimate({
      estimateId: String(req.params.id),
      actor: actorFrom(req),
      reason: req.body?.reason ? String(req.body.reason) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.get("/api/repair/events/:id/comments", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({
      comments: await listComments({ eventId: String(req.params.id) }),
    });
  });

  app.post("/api/repair/events/:id/comments", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await addComment({
      eventId: String(req.params.id),
      estimateId: req.body?.estimateId ? String(req.body.estimateId) : undefined,
      revisionId: req.body?.revisionId ? String(req.body.revisionId) : undefined,
      lineId: req.body?.lineId ? String(req.body.lineId) : undefined,
      parentId: req.body?.parentId ? String(req.body.parentId) : undefined,
      body: String(req.body?.body ?? ""),
      subject: req.body?.subject ? String(req.body.subject) : undefined,
      issue: req.body?.issue ? String(req.body.issue) : undefined,
      author: actorFrom(req),
      // Manual_Gap #8: opt-in (default false)
      notify: req.body?.notify === true,
      notifyEmails: Array.isArray(req.body?.notifyEmails)
        ? req.body.notifyEmails.map(String)
        : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(result);
  });

  app.get("/api/repair/revisions/compare", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const left = String(req.query.left ?? "");
    const right = String(req.query.right ?? "");
    if (!left || !right) {
      return res.status(400).json({ error: "left and right revision ids required" });
    }
    return res.json(await compareRevisions({ leftRevisionId: left, rightRevisionId: right }));
  });

  app.post("/api/repair/settings/tank-doc-gate", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const byCarType =
      req.body?.byCarType && typeof req.body.byCarType === "object"
        ? (req.body.byCarType as Record<string, boolean>)
        : undefined;
    const result = await setTankCarDocGate({
      enabled: Boolean(req.body?.enabled),
      byCarType,
      actor: actorFrom(req),
    });
    return res.json(result);
  });

  app.get("/api/repair/settings/tank-doc-gate", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json(await getTankCarDocGate());
  });

  app.post("/api/repair/events/:id/tank-docs/ensure", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await ensureTankPacket({
      eventId: String(req.params.id),
      estimateId: req.body?.estimateId ? String(req.body.estimateId) : undefined,
      actor: actorFrom(req),
    });
    return res.json(result);
  });

  app.get("/api/repair/tank-docs/pending", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({ queue: await listTankDocPendingQueue() });
  });

  app.post("/api/repair/tank-docs/:id/decide", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const decision = String(req.body?.decision ?? "").toUpperCase();
    if (decision !== "VERIFY" && decision !== "REJECT") {
      return res.status(400).json({ error: "decision must be VERIFY or REJECT" });
    }
    const result = await ownerDecideTankDocs({
      packetId: String(req.params.id),
      decision: decision as "VERIFY" | "REJECT",
      actor: actorFrom(req),
      reason: req.body?.reason ? String(req.body.reason) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.get("/api/repair/attachment-categories", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({ categories: await listAttachmentCategories() });
  });

  app.get("/api/repair/events/:id/documents", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({
      documents: await listEventDocuments({
        eventId: String(req.params.id),
        categoryCode: req.query.category ? String(req.query.category) : undefined,
        sharedOnly: String(req.query.shared ?? "") === "1" ? true : undefined,
      }),
    });
  });

  app.get("/api/repair/events/:id/documents/download-all", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const pack = await downloadAllDocuments({ eventId: String(req.params.id) });
    return res.json({
      count: pack.files.length,
      files: pack.files.map((f) => ({
        filename: f.filename,
        mime: f.mime,
        sha256: f.sha256,
        size: f.bytes.length,
        contentBase64: f.bytes.toString("base64"),
      })),
    });
  });

  app.post("/api/repair/documents/:id/share", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await markDocumentShared({
      documentId: String(req.params.id),
      shared: req.body?.shared !== false,
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/outbound/target-bulk", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const eventIds = Array.isArray(req.body?.eventIds)
      ? req.body.eventIds.map(String)
      : [];
    const result = await setTargetOutboundBulk({
      eventIds,
      targetDate: String(req.body?.targetDate ?? ""),
      note: req.body?.note ? String(req.body.note) : undefined,
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(result);
  });

  app.post("/api/repair/events/:id/outbound/actual", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await setActualOutbound({
      eventId: String(req.params.id),
      actualDate: String(req.body?.actualDate ?? ""),
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.get("/api/repair/dispo/queue", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({ queue: await listDispoQueue() });
  });

  app.post("/api/repair/events/:id/dispo/email-lessee", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await emailLesseeDispo({
      eventId: String(req.params.id),
      actor: actorFrom(req),
      extraTo: Array.isArray(req.body?.extraTo) ? req.body.extraTo.map(String) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/invoices/:id/link-estimates", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const estimateIds = Array.isArray(req.body?.estimateIds)
      ? req.body.estimateIds.map(String)
      : [];
    const result = await linkInvoiceToEstimates({
      invoiceId: String(req.params.id),
      estimateIds,
      actor: actorFrom(req),
    });
    return res.json(result);
  });

  app.get("/api/repair/estimates/grid", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const statusCodes = req.query.status
      ? String(req.query.status).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const dateFieldRaw = req.query.dateField
      ? String(req.query.dateField)
      : "ignore";
    const dateField = (
      [
        "ignore",
        "yard_arrival",
        "approval_requested",
        "approved",
        "outbound_target",
        "outbound_date",
        "created",
        "terminated",
      ].includes(dateFieldRaw)
        ? dateFieldRaw
        : "ignore"
    ) as EstimateGridDateField;
    const entityCodes = req.query.entity
      ? String(req.query.entity)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const grid = await queryEstimateGrid({
      statusCodes,
      shopId: req.query.shopId ? String(req.query.shopId) : undefined,
      carMark: req.query.carMark ? String(req.query.carMark) : undefined,
      carNumber: req.query.carNumber ? String(req.query.carNumber) : undefined,
      fromDate: req.query.from ? String(req.query.from) : undefined,
      toDate: req.query.to ? String(req.query.to) : undefined,
      dateField,
      entityCodes,
      minTotal: req.query.minTotal != null ? Number(req.query.minTotal) : undefined,
      maxTotal: req.query.maxTotal != null ? Number(req.query.maxTotal) : undefined,
      includeHidden: String(req.query.includeHidden ?? "") === "1",
      includeShopDraft: String(req.query.includeShopDraft ?? "") === "1",
      limit: req.query.limit != null ? Number(req.query.limit) : undefined,
      offset: req.query.offset != null ? Number(req.query.offset) : undefined,
      sortBy: req.query.sortBy ? String(req.query.sortBy) : undefined,
      sortDir: req.query.sortDir === "asc" ? "asc" : "desc",
    });
    return res.json({
      ...grid,
      actionableStatuses: [...ACTIONABLE_ESTIMATE_STATUSES],
    });
  });

  app.get("/api/repair/estimates/grid/export", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const statusCodes = req.query.status
      ? String(req.query.status).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const entityCodes = req.query.entity
      ? String(req.query.entity)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const exported = await exportEstimateGridCsv({
      statusCodes,
      shopId: req.query.shopId ? String(req.query.shopId) : undefined,
      carMark: req.query.carMark ? String(req.query.carMark) : undefined,
      carNumber: req.query.carNumber ? String(req.query.carNumber) : undefined,
      fromDate: req.query.from ? String(req.query.from) : undefined,
      toDate: req.query.to ? String(req.query.to) : undefined,
      dateField: req.query.dateField
        ? (String(req.query.dateField) as EstimateGridDateField)
        : "ignore",
      entityCodes,
      includeHidden: String(req.query.includeHidden ?? "") === "1",
      sortBy: req.query.sortBy ? String(req.query.sortBy) : undefined,
      sortDir: req.query.sortDir === "asc" ? "asc" : "desc",
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=estimates-grid.csv");
    return res.send(exported.csv);
  });

  app.post("/api/repair/estimates/bulk-approve", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const ids = Array.isArray(req.body?.estimateIds)
      ? req.body.estimateIds.map(String)
      : [];
    return res.json(
      await bulkApproveEstimates({ estimateIds: ids, actor: actorFrom(req) }),
    );
  });

  app.post("/api/repair/estimates/brc-export", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const ids = Array.isArray(req.body?.estimateIds)
      ? req.body.estimateIds.map(String)
      : [];
    // PDF path: single estimate + audience → Billing Repair Card
    if (req.body?.format === "pdf" && ids.length === 1) {
      const raw = String(req.body?.audience ?? "owner").toLowerCase();
      const audience: BrcAudience =
        raw === "lessee" || raw === "shop" || raw === "owner" ? raw : "owner";
      const pdf = await buildBrcPdf({ estimateId: ids[0]!, audience });
      if (!pdf.ok) return res.status(pdf.status).json({ error: pdf.error });
      const name = `${pdf.doc.carCompact || "estimate"}_BRC_${audience}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
      return res.send(pdf.bytes);
    }
    const result = await exportBrcDetail({
      estimateIds: ids,
      format: req.body?.format === "json" ? "json" : "csv",
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    if ("csv" in result && result.csv) {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=brc-detail.csv");
      return res.send(result.csv);
    }
    return res.json(result);
  });

  app.post("/api/repair/estimates/bulk-validate", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const ids = Array.isArray(req.body?.estimateIds)
      ? req.body.estimateIds.map(String)
      : [];
    const results = [];
    for (const id of ids) {
      results.push({
        estimateId: id,
        ...(await runRailincValidation({ estimateId: id })),
      });
    }
    return res.json({ ok: true, results });
  });

  app.post("/api/repair/settings/email-opt-out", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await setUserEmailOptOut({
      email: String(req.body?.email ?? ""),
      optedOut: Boolean(req.body?.optedOut),
      optOutTypes: Array.isArray(req.body?.optOutTypes)
        ? req.body.optOutTypes.map(String)
        : undefined,
      actor: actorFrom(req),
    });
    return res.json(result);
  });

  app.patch("/api/repair/notification-rules/:type/min-amount", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const cents =
      req.body?.minAmountCents === null || req.body?.minAmountCents === undefined
        ? null
        : Number(req.body.minAmountCents);
    const result = await setNotificationRuleMinAmount({
      notificationType: String(req.params.type),
      minAmountCents: cents,
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/billing/monthly-summary", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await buildMonthlyBillSummary({
      accountMonth: String(req.body?.accountMonth ?? ""),
      closeRunId: req.body?.closeRunId ? String(req.body.closeRunId) : undefined,
      actor: actorFrom(req),
    });
    return res.json(result);
  });

  app.get("/api/repair/phase2-hooks", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({
      hooks: await getPhase2Hooks(),
      note: "Phase 2 design hooks only — carMARQS/CROP not built in Phase 1",
    });
  });

  // ── Manual_Gap_Review lifecycle-05 reconciliations ──

  app.post("/api/repair/estimates/bulk-submit", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const ids = Array.isArray(req.body?.estimateIds)
      ? req.body.estimateIds.map(String)
      : [];
    return res.json(
      await bulkSubmitForApproval({ estimateIds: ids, actor: actorFrom(req) }),
    );
  });

  app.post("/api/repair/estimates/:id/request-delete", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await shopRequestDeleteEstimate({
      estimateId: String(req.params.id),
      actor: actorFrom(req),
      reason: req.body?.reason ? String(req.body.reason) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/estimates/:id/approve-delete", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await approveDeleteToVoid({
      estimateId: String(req.params.id),
      actor: actorFrom(req),
      reason: req.body?.reason ? String(req.body.reason) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/estimates/:id/request-terminate", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await shopRequestTerminate({
      estimateId: String(req.params.id),
      actor: actorFrom(req),
      reason: req.body?.reason ? String(req.body.reason) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/dispo/request", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const eventIds = Array.isArray(req.body?.eventIds)
      ? req.body.eventIds.map(String)
      : req.body?.eventId
        ? [String(req.body.eventId)]
        : [];
    const result = await requestDispo({
      eventIds,
      actor: actorFrom(req),
      instructions: req.body?.instructions
        ? String(req.body.instructions)
        : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/estimates/:id/update-responsibility", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const lineUpdates = Array.isArray(req.body?.lineUpdates)
      ? req.body.lineUpdates.map((u: { lineId?: string; respCode?: string }) => ({
          lineId: String(u.lineId ?? ""),
          respCode: String(u.respCode ?? ""),
        }))
      : [];
    const splits = Array.isArray(req.body?.splits)
      ? req.body.splits.map(
          (s: {
            lineId?: string;
            percent?: number;
            fixedCents?: number;
            fixedDollars?: number | string;
            respCode?: string;
            remainderRespCode?: string;
          }) => ({
            lineId: String(s.lineId ?? ""),
            percent: s.percent != null ? Number(s.percent) : undefined,
            fixedCents: s.fixedCents != null ? Number(s.fixedCents) : undefined,
            fixedDollars: s.fixedDollars,
            respCode: String(s.respCode ?? ""),
            remainderRespCode: s.remainderRespCode
              ? String(s.remainderRespCode)
              : undefined,
          }),
        )
      : [];
    const unsplitGroupIds = Array.isArray(req.body?.unsplitGroupIds)
      ? req.body.unsplitGroupIds.map(String)
      : [];
    // Prefer §D submit path (splits + cents); fall back to legacy updater when no splits.
    if (
      splits.length > 0 ||
      unsplitGroupIds.length > 0 ||
      req.body?.useOwnerUiD === true
    ) {
      const result = await submitResponsibilityUpdates({
        estimateId: String(req.params.id),
        lineUpdates,
        splits,
        unsplitGroupIds,
        responsibleParty: req.body?.responsibleParty
          ? String(req.body.responsibleParty)
          : undefined,
        actor: actorFrom(req),
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json(result);
    }
    const result = await updateResponsibility({
      estimateId: String(req.params.id),
      lineUpdates,
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/estimates/:id/responsibility-summary", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    return res.json({ summary: summarizeByResp(lines) });
  });

  app.post("/api/repair/estimates/export-aar", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const ids = Array.isArray(req.body?.estimateIds)
      ? req.body.estimateIds.map(String)
      : [];
    return res.json(await exportEstimatesAar500({ estimateIds: ids }));
  });

  app.get("/api/repair/estimates/:id/railinc-validate", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await runRailincValidation({
      estimateId: String(req.params.id),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/events/:id/tank-car", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await setEventTankCar({
      eventId: String(req.params.id),
      isTankCar: Boolean(req.body?.isTankCar),
      actor: actorFrom(req),
    });
    return res.json(result);
  });

  app.post("/api/repair/events/:id/tank-docs/verify-first", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await ownerVerifyTankDocsFirst({
      eventId: String(req.params.id),
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status ?? 400).json(result);
    return res.json(result);
  });

  app.post("/api/repair/events/:id/outbound/actual-complete", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await setActualOutboundAndComplete({
      eventId: String(req.params.id),
      actualDate: String(req.body?.actualDate ?? ""),
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/attachments/assert-allowed", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await assertAttachmentAllowed({
      filename: String(req.body?.filename ?? ""),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  // ── MG1–MG4 lifecycle-06 ──

  app.get("/api/repair/estimates/:id/correction-editor", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await getCorrectionEditorPayload({
      estimateId: String(req.params.id),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  /** MG1 — internal-only correction (admin/reviewer). Never shop link. */
  app.post("/api/repair/estimates/:id/internal-correction", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const mapped = lines.map(
      (
        l: {
          lineNo?: number;
          aarJobCode?: string;
          qualifier?: string;
          whyMade?: string;
          conditionCode?: string;
          respCode?: string;
          labor?: number;
          material?: number;
          total?: number;
          repairCategory?: string;
          subCategory?: string;
        },
        i: number,
      ) => ({
        lineNo: l.lineNo ?? i + 1,
        aarJobCode: l.aarJobCode,
        qualifier: l.qualifier,
        whyMade: l.whyMade,
        conditionCode: l.conditionCode,
        respCode: l.respCode,
        labor: Number(l.labor ?? 0),
        material: Number(l.material ?? 0),
        total: Number(l.total ?? Number(l.labor ?? 0) + Number(l.material ?? 0)),
        repairCategory: l.repairCategory,
        subCategory: l.subCategory,
      }),
    );
    const result = await saveInternalCorrection({
      estimateId: String(req.params.id),
      actor: actorFrom(req),
      actorRole: req.body?.actorRole ? String(req.body.actorRole) : "reviewer",
      reason: String(req.body?.reason ?? ""),
      header: req.body?.header && typeof req.body.header === "object" ? req.body.header : {},
      lines: mapped,
      asAdjustment: req.body?.asAdjustment === true,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(result);
  });

  /** MG2 — admin restore VOIDED */
  app.get("/api/repair/estimates/voided", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({ estimates: await listVoidedEstimates() });
  });

  app.post("/api/repair/estimates/:id/restore", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await restoreVoidedEstimate({
      estimateId: String(req.params.id),
      actor: actorFrom(req),
      actorRole: req.body?.actorRole ? String(req.body.actorRole) : "admin",
      reason: String(req.body?.reason ?? ""),
      toStatus: req.body?.toStatus ? String(req.body.toStatus) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/documents/:id/soft-delete", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await softDeleteDocument({
      documentId: String(req.params.id),
      actor: actorFrom(req),
      actorRole: String(req.body?.actorRole ?? "reviewer"),
      reason: String(req.body?.reason ?? ""),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/documents/:id/recategorize", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await recategorizeDocument({
      documentId: String(req.params.id),
      categoryCode: String(req.body?.categoryCode ?? req.body?.category ?? ""),
      comment: req.body?.comment ? String(req.body.comment) : undefined,
      actor: actorFrom(req),
      actorRole: String(req.body?.actorRole ?? "reviewer"),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  /** Shop link must never void/recategorize — enforce even if client calls authed path with shop role. */
  app.post("/api/repair/e/:token/documents/:id/soft-delete", async (_req, res) => {
    return res.status(403).json({
      error: "Shop cannot delete, void, or recategorize attachments (add only)",
    });
  });

  /**
   * Ref code hover lookup — public GET (codes are not secrets) so lessee
   * login-free pages and shop grids can hover Loc/WM/C/Resp without auth.
   */
  app.get("/api/repair/ref/lookup", async (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    const kind = String(req.query.kind ?? "job") as
      | "job"
      | "qualifier"
      | "removed_qualifier"
      | "why_made"
      | "location"
      | "condition"
      | "responsibility"
      | "car_part"
      | "category";
    const hit = await lookupRefCode({
      kind,
      code: String(req.query.code ?? ""),
      qualifier: req.query.qualifier != null ? String(req.query.qualifier) : null,
    });
    // Normalize not-found copy for hover: "<code> – not in reference table"
    if (!hit.found) {
      return res.json({
        ...hit,
        description: "not in reference table",
        warning: `${String(req.query.code ?? "").trim() || "—"} – not in reference table`,
      });
    }
    return res.json(hit);
  });

  app.get("/api/repair/ref/counts", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({ counts: await getRefDataCounts() });
  });

  app.post("/api/repair/ref-data/import", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await importRefData({
      actor: actorFrom(req),
      dir: req.body?.dir ? String(req.body.dir) : undefined,
    });
    return res.json(result);
  });

  // ── Reference Data admin (owner / system manager) ─────────────────
  app.get("/api/repair/admin/ref-data/tables", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    if (!canManageRefData(roleFrom(req))) {
      return res.status(403).json({ error: "Owner or system manager only" });
    }
    return res.json({ tables: listRefTableMeta() });
  });

  app.post("/api/repair/admin/ref-data/check-new-line", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await checkRefCodeForNewLine({
      tableKey: String(req.body?.tableKey ?? "job_codes") as
        | "job_codes"
        | "why_made"
        | "condition"
        | "location"
        | "qualifiers",
      code: String(req.body?.code ?? ""),
      qualifier: req.body?.qualifier != null ? String(req.body.qualifier) : null,
      jobCode: req.body?.jobCode != null ? String(req.body.jobCode) : null,
      rejectRetired: Boolean(req.body?.rejectRetired),
    });
    return res.json(result);
  });

  app.get("/api/repair/admin/ref-data/:tableKey/history", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    if (!canManageRefData(roleFrom(req))) {
      return res.status(403).json({ error: "Owner or system manager only" });
    }
    const result = await listRefHistory({
      tableKey: String(req.params.tableKey),
      rowId: req.query.rowId != null ? String(req.query.rowId) : undefined,
      limit: req.query.limit != null ? Number(req.query.limit) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.get("/api/repair/admin/ref-data/:tableKey/export", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    if (!canManageRefData(roleFrom(req))) {
      return res.status(403).json({ error: "Owner or system manager only" });
    }
    const result = await exportRefCsv({
      tableKey: String(req.params.tableKey),
      activeOnly: req.query.activeOnly === "1",
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`,
    );
    return res.send(result.csv);
  });

  app.post("/api/repair/admin/ref-data/:tableKey/import/dry-run", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const csvText =
      req.body?.csvText != null
        ? String(req.body.csvText)
        : req.body?.csv != null
          ? String(req.body.csv)
          : "";
    const result = await dryRunRefImport({
      tableKey: String(req.params.tableKey),
      csvText,
      edition: req.body?.edition != null ? String(req.body.edition) : undefined,
      quarter: req.body?.quarter != null ? String(req.body.quarter) : undefined,
      actor: actorFrom(req),
      actorRole: roleFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/admin/ref-data/:tableKey/import/confirm", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const csvText =
      req.body?.csvText != null
        ? String(req.body.csvText)
        : req.body?.csv != null
          ? String(req.body.csv)
          : "";
    const result = await confirmRefImport({
      tableKey: String(req.params.tableKey),
      csvText,
      dryRunId: req.body?.dryRunId != null ? String(req.body.dryRunId) : undefined,
      edition: req.body?.edition != null ? String(req.body.edition) : undefined,
      quarter: req.body?.quarter != null ? String(req.body.quarter) : undefined,
      reason: String(req.body?.reason ?? "Quarterly AAR import"),
      actor: actorFrom(req),
      actorRole: roleFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.get("/api/repair/admin/ref-data/:tableKey", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    if (!canManageRefData(roleFrom(req))) {
      return res.status(403).json({ error: "Owner or system manager only" });
    }
    const result = await listRefRows({
      tableKey: String(req.params.tableKey),
      q: req.query.q != null ? String(req.query.q) : undefined,
      activeOnly: req.query.activeOnly === "1" || req.query.activeOnly === "true",
      sort: req.query.sort != null ? String(req.query.sort) : undefined,
      dir: req.query.dir === "desc" ? "desc" : "asc",
      limit: req.query.limit != null ? Number(req.query.limit) : undefined,
      offset: req.query.offset != null ? Number(req.query.offset) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/admin/ref-data/:tableKey", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await upsertRefRow({
      tableKey: String(req.params.tableKey),
      id: req.body?.id ? String(req.body.id) : undefined,
      values: (req.body?.values ?? req.body ?? {}) as Record<string, unknown>,
      reason: String(req.body?.reason ?? ""),
      actor: actorFrom(req),
      actorRole: roleFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/admin/ref-data/:tableKey/:id/retire", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await retireRefRow({
      tableKey: String(req.params.tableKey),
      id: String(req.params.id),
      reason: String(req.body?.reason ?? ""),
      actor: actorFrom(req),
      actorRole: roleFrom(req),
      effectiveTo: req.body?.effectiveTo != null ? String(req.body.effectiveTo) : undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/admin/ref-data/:tableKey/:id/restore", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await restoreRefRow({
      tableKey: String(req.params.tableKey),
      id: String(req.params.id),
      reason: String(req.body?.reason ?? ""),
      actor: actorFrom(req),
      actorRole: roleFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.get("/api/repair/component-id-rules", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({ rules: await listComponentIdRules() });
  });

  app.post("/api/repair/component-id-rules", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await upsertComponentIdRule({
      id: req.body?.id ? String(req.body.id) : undefined,
      jobCode: req.body?.jobCode != null ? String(req.body.jobCode) : null,
      qualifier: req.body?.qualifier != null ? String(req.body.qualifier) : null,
      jobCodePrefix:
        req.body?.jobCodePrefix != null ? String(req.body.jobCodePrefix) : null,
      label: req.body?.label != null ? String(req.body.label) : null,
      requireOn: req.body?.requireOn ? String(req.body.requireOn) : undefined,
      active: req.body?.active != null ? Boolean(req.body.active) : undefined,
      notes: req.body?.notes != null ? String(req.body.notes) : null,
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/component-id-rules/:id/soft-delete", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await softDeleteComponentIdRule({
      id: String(req.params.id),
      actor: actorFrom(req),
      reason: String(req.body?.reason ?? ""),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/estimates/:id/validate-component-ids", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const review = await buildEstimateReviewPayload({
      estimateId: String(req.params.id),
    });
    if (!review.ok) return res.status(review.status).json({ error: review.error });
    const lines =
      review.revisions[review.revisions.length - 1]?.lines.map((l) => ({
        id: String(l.id ?? ""),
        line_no: Number(l.line_no),
        aar_job_code: (l.aar_job_code as string) ?? null,
        qualifier: (l.qualifier as string) ?? null,
        aar_component_id: (l.aar_component_id as string) ?? null,
      })) ?? [];
    const stage = String(req.body?.stage ?? "FINAL").toUpperCase() as
      | "FINAL"
      | "INVOICE"
      | "REVIEW";
    return res.json(await validateComponentIds({ lines, stage }));
  });

  app.get("/api/repair/estimates/:id/carry-forward", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const fromQ = Number(req.query.fromRev);
    const preview = await previewCarryForward({
      estimateId: String(req.params.id),
      fromRevNo: Number.isFinite(fromQ) ? fromQ : undefined,
    });
    await auditCarryForwardPreview({
      estimateId: String(req.params.id),
      actor: actorFrom(req),
      preview,
    });
    return res.json(preview);
  });

  app.post("/api/repair/estimates/:id/carry-forward/apply-preview", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    // Never auto-commit — returns lineUpdates for the client to confirm via update-responsibility
    const preview = await previewCarryForward({
      estimateId: String(req.params.id),
      fromRevNo: req.body?.fromRevNo != null ? Number(req.body.fromRevNo) : undefined,
    });
    const applied = applyCarryForwardSelections({
      items: preview.items,
      applyStatuses: Array.isArray(req.body?.applyStatuses)
        ? req.body.applyStatuses
        : undefined,
    });
    await auditCarryForwardPreview({
      estimateId: String(req.params.id),
      actor: actorFrom(req),
      preview,
      applied: applied.applied,
    });
    return res.json({
      ...preview,
      lineUpdates: applied.lineUpdates,
      applied: applied.applied,
      autoCommit: false,
    });
  });

  app.post("/api/repair/estimates/:id/tax-prorate-preview", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const taxCents = Number(req.body?.taxCents ?? 0);
    return res.json(
      previewTaxProrate({
        lines: lines.map(
          (l: {
            respCode?: string;
            amountCents?: number;
            isTaxLine?: boolean;
          }) => ({
            respCode: String(l.respCode ?? ""),
            amountCents: Number(l.amountCents ?? 0),
            isTaxLine: Boolean(l.isTaxLine),
          }),
        ),
        taxCents,
      }),
    );
  });

  app.get("/api/repair/attachments/permissions", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const role = String(req.query.role ?? req.body?.actorRole ?? "reviewer");
    return res.json({
      role,
      canAdd: true,
      canRemove: canManageAttachments(role),
      canRecategorize: canManageAttachments(role),
      canVoid: canManageAttachments(role),
    });
  });

  app.post("/api/repair/documents/:id/restore", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await restoreDocument({
      documentId: String(req.params.id),
      actor: actorFrom(req),
      reason: String(req.body?.reason ?? ""),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/comments/:id/soft-delete", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await softDeleteComment({
      commentId: String(req.params.id),
      actor: actorFrom(req),
      reason: String(req.body?.reason ?? ""),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/comments/:id/restore", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await restoreComment({
      commentId: String(req.params.id),
      actor: actorFrom(req),
      reason: String(req.body?.reason ?? ""),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  /** MG4 — Phase 2 CROP import stub */
  app.post("/api/repair/phase2/crop-import", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await cropImportPhase2Stub({ actor: actorFrom(req) });
    return res.status(501).json(result);
  });

  // ── Wreck dual-track (owner-only DV / settlement) ───────────────────
  app.post("/api/repair/wreck-events", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const body = req.body ?? {};
    const result = await createWreckEvent({
      actor: actorFrom(req),
      carMark: String(body.carMark ?? ""),
      carNumber: String(body.carNumber ?? ""),
      shopId: body.shopId ?? null,
      badOrderId: body.badOrderId ?? null,
      eventId: body.eventId ?? null,
      ddctIncidentId: String(body.ddctIncidentId ?? ""),
      incidentDate: body.incidentDate ?? null,
      splc: body.splc ?? null,
      damagingRoad: body.damagingRoad ?? null,
      handlingRoad: body.handlingRoad ?? null,
      ruleBasis: body.ruleBasis ?? "107",
      fm95aCondition: body.fm95aCondition ?? null,
      lastCommodity: body.lastCommodity ?? null,
      stcc: body.stcc ?? null,
      disposition: body.disposition ?? null,
      shopArrivalDate: body.shopArrivalDate ?? null,
      jicType: body.jicType ?? "STANDARD",
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    const full = await getWreckEvent(result.wreckEventId);
    return res.status(201).json({ ...result, wreck: full });
  });

  app.get("/api/repair/wreck-events/:id", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const wreck = await getWreckEvent(String(req.params.id));
    if (!wreck) return res.status(404).json({ error: "Wreck event not found" });
    const gauge = await computeSettlementGauge({ wreckEventId: String(req.params.id) });
    return res.json({ wreck, gauge });
  });

  app.get("/api/repair/events/:eventId/wreck", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const wreck = await getWreckEventByEventId(String(req.params.eventId));
    if (!wreck) return res.status(404).json({ error: "No wreck event for this event" });
    const gauge = await computeSettlementGauge({ wreckEventId: String(wreck.id) });
    return res.json({ wreck, gauge });
  });

  app.patch("/api/repair/wreck-events/:id", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const result = await updateWreckEvent({
      wreckEventId: String(req.params.id),
      actor: actorFrom(req),
      patch: req.body ?? {},
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    const wreck = await getWreckEvent(String(req.params.id));
    return res.json({ ok: true, wreck });
  });

  app.post("/api/repair/wreck-events/:id/clear-flags", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const body = req.body ?? {};
    const result = await clearWreckFlags({
      wreckEventId: String(req.params.id),
      estimateId: body.estimateId ?? undefined,
      flagIds: body.flagIds ?? undefined,
      actor: actorFrom(req),
      actorRole: String(body.actorRole ?? "owner"),
      reason: String(body.reason ?? ""),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/wreck-events/:id/settlement", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const body = req.body ?? {};
    const result = await saveSettlementCalc({
      wreckEventId: String(req.params.id),
      actor: actorFrom(req),
      originalCostCents:
        body.originalCostCents != null ? Number(body.originalCostCents) : null,
      reproductionCents:
        body.reproductionCents != null ? Number(body.reproductionCents) : null,
      depreciatedValueCents:
        body.depreciatedValueCents != null
          ? Number(body.depreciatedValueCents)
          : null,
      salvageCents: body.salvageCents != null ? Number(body.salvageCents) : null,
      settlementBasis: body.settlementBasis ?? null,
      settlementCapCents:
        body.settlementCapCents != null ? Number(body.settlementCapCents) : null,
      exhibitEdition: body.exhibitEdition ?? null,
      overrideReason: body.overrideReason ?? null,
      inputsJson: body.inputsJson ?? undefined,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.get("/api/repair/wreck-events/:id/settlement-gauge", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const gauge = await computeSettlementGauge({
      wreckEventId: String(req.params.id),
    });
    if (!gauge) return res.status(404).json({ error: "Wreck event not found" });
    return res.json({ gauge });
  });

  /** Dry-run wreck file validation (owner review). */
  app.post(
    "/api/repair/wreck/validate-file",
    upload.single("file"),
    async (req, res) => {
      const uid = await maybeRequireUser(deps, req, res);
      if (!uid) return;
      const file = req.file;
      if (!file?.buffer?.length) {
        return res.status(400).json({ error: "500-byte file required" });
      }
      const parsed = parseAarFile(file.buffer);
      const result = await validateWreckLoad({
        lines: parsed.lines,
        track: (req.body?.track as "OWNER_CONTRACT" | "R107_RESP3") ?? "UNKNOWN",
        mode: req.body?.mode === "FINAL_INVOICE" ? "FINAL_INVOICE" : "ESTIMATE",
        isWreckEvent: true,
      });
      return res.json(result);
    },
  );

  /** Shop/lessee must never receive owner DV — helper for token payloads. */
  app.get("/api/repair/wreck-events/:id/public-safe", async (req, res) => {
    // Still requires auth in authed router; shop token routes omit DV separately.
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const wreck = await getWreckEvent(String(req.params.id));
    if (!wreck) return res.status(404).json({ error: "Wreck event not found" });
    return res.json({
      wreck: omitOwnerDv(wreck as unknown as Record<string, unknown>),
    });
  });
}
