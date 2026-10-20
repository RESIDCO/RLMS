import type { Express, Request, Response } from "express";
import { requireUser, requireWrite } from "./auth";
import { registerBidImportRoutes } from "./crm-bid-import";
import { bidSummary, getBidOffering, listBidBoard, listBidTimeline, listOpportunityLines, presentLine, saveOpportunityLines } from "./crm-bid-lines";
import { CrmHttpError } from "./crm-error";

function sendError(res: Response, err: unknown) {
  if (err instanceof CrmHttpError) {
    return res.status(err.status).json({ message: err.message, ...err.body });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[crm-bid]", message, err);
  return res.status(500).json({ message });
}

function canSeeBidPrices(req: Request): boolean {
  return req.authRole === "admin" || req.authRole === "editor";
}

function positiveInt(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.trunc(n);
}

export function registerCrmBidRoutes(app: Express) {
  registerBidImportRoutes(app);

  app.get("/api/opportunities/bids/summary", async (req, res) => {
    try {
      const user = await requireWrite(req, res);
      if (!user) return;
      const year = positiveInt(req.query.year);
      res.json(await bidSummary({
        seller: positiveInt(req.query.seller),
        aar: typeof req.query.aar === "string" ? req.query.aar : undefined,
        year,
      }));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/opportunities/bids", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listBidBoard(canSeeBidPrices(req)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/opportunities/:id/bid", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await getBidOffering(Number(req.params.id), canSeeBidPrices(req)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/opportunities/:id/timeline", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listBidTimeline(Number(req.params.id), canSeeBidPrices(req)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/opportunities/:id/lines", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listOpportunityLines(Number(req.params.id), canSeeBidPrices(req)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/opportunities/:id/lines/batch", async (req, res) => {
    try {
      const user = await requireWrite(req, res);
      if (!user) return;
      const saved = await saveOpportunityLines(Number(req.params.id), (req.body ?? {}) as { lines?: unknown; delete_ids?: unknown }, user);
      res.status(201).json(saved);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/opportunities/:id/lines", async (req, res) => {
    try {
      const user = await requireWrite(req, res);
      if (!user) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const lines = Array.isArray(body.lines) ? body.lines : [body];
      const saved = await saveOpportunityLines(Number(req.params.id), { lines }, user);
      res.status(201).json({ ...saved, line: saved.lines[saved.lines.length - 1] ?? null });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.patch("/api/opportunities/:id/lines/:lineId", async (req, res) => {
    try {
      const user = await requireWrite(req, res);
      if (!user) return;
      const saved = await saveOpportunityLines(
        Number(req.params.id),
        { lines: [{ ...(req.body ?? {}), id: Number(req.params.lineId) }] },
        user,
      );
      const line = saved.lines.find((row) => row.id === Number(req.params.lineId)) ?? null;
      res.json({ ...saved, line: line ? presentLine(line, true) : null });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/opportunities/:id/lines/:lineId/delete", async (req, res) => {
    try {
      const user = await requireWrite(req, res);
      if (!user) return;
      const saved = await saveOpportunityLines(Number(req.params.id), { delete_ids: [Number(req.params.lineId)] }, user);
      res.json(saved);
    } catch (err) {
      sendError(res, err);
    }
  });
}
