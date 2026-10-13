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
import { shopAccept, shopReject, shopOnHand } from "./services/shop-actions";
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
import { listResponsibilityCodes } from "./services/categories";
import {
  sendLesseeApprovalRequest,
  approveViaLesseeLink,
  ingestLesseeReply,
  confirmLesseeReply,
} from "./services/lessee-approval";
import { enterPodErd, listPodDates, latestPodErd, runPodReminders } from "./services/pod";
import { setCompletedDate, rollbackCompletedDate } from "./services/completion";
import { submitShopInvoice, listInvoicesForEvent, approveInvoiceMatch } from "./services/invoices";
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
import { issueStepOtp, isOtpRequired, setOtpStepFlag } from "./services/otp";
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
      phase: "1-slice-pod-invoice-contacts",
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
      const result = await getInboundEmailProvider().ingest({
        from: String(body.from ?? ""),
        to: String(body.to ?? ""),
        subject: String(body.subject ?? ""),
        raw: String(body.raw ?? body.body ?? ""),
        receivedAt: new Date().toISOString(),
        messageId: body.messageId ? String(body.messageId) : undefined,
      });
      return res.status(202).json({
        ...result,
        note: "Parsed decision is advisory until a reviewer confirms.",
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
      const otpInvoice = await isOtpRequired("invoice_submit", tenantId);
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
        otpRequired: { invoice_submit: otpInvoice },
      });
    } catch (err) {
      console.error("[repair/e/:token]", err);
      return res.status(500).json({ error: "Failed to load event link" });
    }
  });

  /** Lessee login-free link (Resp 6 primary path). */
  app.get("/api/repair/lessee/:token", async (req, res) => {
    try {
      const resolved = await resolveActiveLink(String(req.params.token), "LESSEE");
      if (!resolved) {
        return res.status(401).json({ error: "Invalid, expired, or revoked link" });
      }
      const estimates = await listEstimatesForEvent(String(resolved.event.id));
      const estimate = estimates[0];
      let revisions: unknown[] = [];
      let lines: unknown[] = [];
      if (estimate) {
        revisions = await listRevisions(estimate.id);
        const latest = revisions[revisions.length - 1] as { id?: string } | undefined;
        if (latest?.id) lines = await getRevisionLines(String(latest.id));
      }
      return res.json({
        link: resolved.link,
        event: resolved.event,
        estimate,
        revisions,
        lines,
        note: "Approve via this link (primary). Email reply requires reviewer confirmation.",
      });
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
    const result = await shopAccept(String(req.params.token), email);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/e/:token/reject", async (req, res) => {
    const email = String(req.body?.email ?? "shop@unknown");
    const result = await shopReject(
      String(req.params.token),
      email,
      req.body?.comment ? String(req.body.comment) : undefined,
    );
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.post("/api/repair/e/:token/on-hand", async (req, res) => {
    const email = String(req.body?.email ?? "shop@unknown");
    const result = await shopOnHand(String(req.params.token), email);
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
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
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
    const result = await sendLesseeApprovalRequest({
      eventId: String(rows[0].event_id),
      estimateId,
      revisionId: String(rows[0].revision_id),
      lesseeEmail: String(body.lesseeEmail ?? ""),
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

  app.post("/api/repair/settings/otp-steps", async (req, res) => {
    const uid = await maybeRequireUser(deps, req, res);
    if (!uid) return;
    const step = String(req.body?.step ?? "invoice_submit");
    const enabled = Boolean(req.body?.enabled);
    return res.json(await setOtpStepFlag({ step, enabled }));
  });
}
