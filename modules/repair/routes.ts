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
} from "./services/estimates";
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
      phase: "1-slice-bo-shop-estimate",
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
      const estimates = await listEstimatesForEvent(String(resolved.event.id));
      let revisions: unknown[] = [];
      if (estimates[0]) {
        revisions = await listRevisions(estimates[0].id);
      }
      return res.json({
        link: resolved.link,
        event: resolved.event,
        nextActions: nextShopActions(String(resolved.event.status_code)),
        estimates,
        revisions,
      });
    } catch (err) {
      console.error("[repair/e/:token]", err);
      return res.status(500).json({ error: "Failed to load event link" });
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
          comment: req.body?.comment ? String(req.body.comment),
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
}

function nextShopActions(statusCode: string): string[] {
  switch (statusCode) {
    case "SHOP_ASSIGNED":
      return ["accept", "reject"];
    case "ACCEPTED":
      return ["on-hand", "upload-estimate"];
    case "ON_HAND":
    case "IN_REPAIR":
      return ["upload-estimate"];
    default:
      return ["upload-estimate"];
  }
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
}
