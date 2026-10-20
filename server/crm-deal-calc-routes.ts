import type { Express, Request, Response } from "express";
import { requireAdmin, requireUser, requireWrite } from "./auth";
import {
  applyScenarioPrice,
  createScenario,
  deleteScenario,
  getCompanyDefault,
  getScenario,
  listScenarios,
  patchAssumptionSet,
  pinScenario,
  updateScenario,
} from "./crm-deal-calc";
import { CrmHttpError } from "./crm-error";

function sendError(res: Response, err: unknown) {
  if (err instanceof CrmHttpError) {
    return res.status(err.status).json({ message: err.message, ...err.body });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[crm-deal-calc]", message, err);
  return res.status(500).json({ message });
}

function canSeeNumbers(req: Request): boolean {
  return req.authRole === "admin" || req.authRole === "editor";
}

export function registerCrmDealCalcRoutes(app: Express) {
  app.get("/api/opportunities/:id/scenarios", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listScenarios(Number(req.params.id), canSeeNumbers(req)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/opportunities/:id/scenarios/:sid", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      res.json(await getScenario(Number(req.params.id), Number(req.params.sid)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/opportunities/:id/scenarios", async (req, res) => {
    try {
      const user = await requireWrite(req, res);
      if (!user) return;
      const saved = await createScenario(Number(req.params.id), (req.body ?? {}) as Record<string, unknown>, user);
      res.status(201).json(saved);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.patch("/api/opportunities/:id/scenarios/:sid", async (req, res) => {
    try {
      const user = await requireWrite(req, res);
      if (!user) return;
      res.json(await updateScenario(Number(req.params.id), Number(req.params.sid), (req.body ?? {}) as Record<string, unknown>, user));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/opportunities/:id/scenarios/:sid/delete", async (req, res) => {
    try {
      const user = await requireWrite(req, res);
      if (!user) return;
      res.json(await deleteScenario(Number(req.params.id), Number(req.params.sid), user));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/opportunities/:id/scenarios/:sid/pin", async (req, res) => {
    try {
      const user = await requireWrite(req, res);
      if (!user) return;
      res.json(await pinScenario(Number(req.params.id), Number(req.params.sid), user));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/opportunities/:id/scenarios/:sid/apply-price", async (req, res) => {
    try {
      const user = await requireWrite(req, res);
      if (!user) return;
      res.json(await applyScenarioPrice(Number(req.params.id), Number(req.params.sid), (req.body ?? {}) as { field?: unknown; which?: unknown }, user));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/calc/defaults", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      res.json(await getCompanyDefault());
    } catch (err) {
      sendError(res, err);
    }
  });

  app.patch("/api/calc/assumption-sets/:id", async (req, res) => {
    try {
      const user = await requireAdmin(req, res);
      if (!user) return;
      res.json(await patchAssumptionSet(Number(req.params.id), (req.body ?? {}) as Record<string, unknown>, user));
    } catch (err) {
      sendError(res, err);
    }
  });
}
