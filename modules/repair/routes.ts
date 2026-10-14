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
} from "./services/gap-lifecycle-06";
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
  setUserEmailOptOut,
  setNotificationRuleMinAmount,
  buildMonthlyBillSummary,
  getPhase2Hooks,
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
  sendLesseeApprovalRequest,
  approveViaLesseeLink,
  ingestLesseeReply,
  confirmLesseeReply,
  getLesseeViewForToken,
} from "./services/lessee-approval";
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
      const decision =
        String(req.body?.decision ?? "").toUpperCase() === "REJECT" ? "REJECT" : "APPROVE";
      const result = await approveViaLesseeLink({
        rawToken: String(req.params.token),
        decision,
        comment: req.body?.comment ? String(req.body.comment) : undefined,
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json(result);
    } catch (err) {
      console.error("[repair/lessee/:token/decide]", err);
      return res.status(500).json({ error: "Lessee decision failed" });
    }
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

  app.get("/api/repair/shops", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    return res.json({ shops: await listDemoShop() });
  });

  app.post("/api/repair/bad-orders", async (req, res) => {
    try {
      const uid = await maybeRequireUser(deps, req, res);
      if (!uid) return;
      const body = req.body ?? {};
      const result = await createBadOrder({
        carMark: String(body.carMark ?? ""),
        carNumber: String(body.carNumber ?? ""),
        rule: body.rule === "RULE_107" ? "RULE_107" : "RULE_1",
        source:
          body.source === "DDCT" || body.source === "EMAIL_DOC"
            ? body.source
            : "INTERNAL",
        shoppingReason: body.shoppingReason ? String(body.shoppingReason) : undefined,
        damagingRoad: body.damagingRoad ? String(body.damagingRoad) : undefined,
        ddctEventId: body.ddctEventId ? String(body.ddctEventId) : undefined,
        ddctIncidentId: body.ddctIncidentId ? String(body.ddctIncidentId) : undefined,
        shopId: body.shopId ? String(body.shopId) : undefined,
        isWreck: Boolean(body.isWreck),
        actor: actorFrom(req),
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.status(201).json(result);
    } catch (err) {
      console.error("[repair/bad-orders]", err);
      return res.status(500).json({ error: "BO create failed" });
    }
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

  /** Review payload: revisions + lines grouped by resp code + compare. */
  app.get("/api/repair/estimates/:id/review", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const estimateId = String(req.params.id);
    const revisions = await listRevisions(estimateId);
    const withLines = [];
    for (const rev of revisions) {
      const lines = await getRevisionLines(String(rev.id));
      const byResp: Record<string, typeof lines> = {};
      for (const line of lines) {
        const key = String(line.resp_code ?? "(none)");
        (byResp[key] ??= []).push(line);
      }
      withLines.push({ revision: rev, lines, byResp });
    }
    let compare: { from: number; to: number; added: number; removed: number; changed: number } | null =
      null;
    if (withLines.length >= 2) {
      const prev = withLines[withLines.length - 2];
      const curr = withLines[withLines.length - 1];
      const prevMap = new Map(prev.lines.map((l) => [l.line_no, l]));
      const currMap = new Map(curr.lines.map((l) => [l.line_no, l]));
      let added = 0;
      let removed = 0;
      let changed = 0;
      for (const [n, line] of currMap) {
        const p = prevMap.get(n);
        if (!p) added++;
        else if (
          String(p.aar_job_code) !== String(line.aar_job_code) ||
          Number(p.labor) !== Number(line.labor) ||
          Number(p.material) !== Number(line.material) ||
          String(p.resp_code) !== String(line.resp_code)
        ) {
          changed++;
        }
      }
      for (const n of prevMap.keys()) {
        if (!currMap.has(n)) removed++;
      }
      compare = {
        from: Number(prev.revision.rev_no),
        to: Number(curr.revision.rev_no),
        added,
        removed,
        changed,
      };
    }
    return res.json({ estimateId, revisions: withLines, compare });
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
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
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
    const result = await bulkCreateBadOrders({
      pastedCars: String(req.body?.cars ?? req.body?.pastedCars ?? ""),
      headerInitials: req.body?.headerInitials
        ? String(req.body.headerInitials)
        : undefined,
      shopId: req.body?.shopId ? String(req.body.shopId) : undefined,
      rule: req.body?.rule === "RULE_107" ? "RULE_107" : "RULE_1",
      shoppingReason: req.body?.shoppingReason
        ? String(req.body.shoppingReason)
        : undefined,
      boCity: req.body?.boCity ? String(req.body.boCity) : undefined,
      boState: req.body?.boState ? String(req.body.boState) : undefined,
      destCity: req.body?.destCity ? String(req.body.destCity) : undefined,
      destState: req.body?.destState ? String(req.body.destState) : undefined,
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
    const grid = await queryEstimateGrid({
      statusCodes,
      shopId: req.query.shopId ? String(req.query.shopId) : undefined,
      carMark: req.query.carMark ? String(req.query.carMark) : undefined,
      carNumber: req.query.carNumber ? String(req.query.carNumber) : undefined,
      fromDate: req.query.from ? String(req.query.from) : undefined,
      toDate: req.query.to ? String(req.query.to) : undefined,
      minTotal: req.query.minTotal != null ? Number(req.query.minTotal) : undefined,
      maxTotal: req.query.maxTotal != null ? Number(req.query.maxTotal) : undefined,
      includeHidden: String(req.query.includeHidden ?? "") === "1",
      limit: req.query.limit != null ? Number(req.query.limit) : undefined,
      offset: req.query.offset != null ? Number(req.query.offset) : undefined,
    });
    return res.json(grid);
  });

  app.get("/api/repair/estimates/grid/export", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const statusCodes = req.query.status
      ? String(req.query.status).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const exported = await exportEstimateGridCsv({
      statusCodes,
      shopId: req.query.shopId ? String(req.query.shopId) : undefined,
      includeHidden: String(req.query.includeHidden ?? "") === "1",
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=estimates-grid.csv");
    return res.send(exported.csv);
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
    const result = await updateResponsibility({
      estimateId: String(req.params.id),
      lineUpdates,
      actor: actorFrom(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
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
      reason: String(req.body?.reason ?? ""),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
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
}
