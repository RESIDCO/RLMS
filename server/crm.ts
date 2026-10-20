import type { Express, Request, Response } from "express";
import { requireUser, requireWrite } from "./auth";
import { getAccount360, listCrmSummary } from "./account-360";
import { createCrmActivity, listCrmActivities, patchCrmActivity } from "./crm-activities";
import { CrmHttpError } from "./crm-error";
import { createCrmProspect, dedupCrmProspects, searchCrmParties } from "./crm-parties";
import {
  addOpportunityContact,
  createOpportunity,
  deleteOpportunityContact,
  generateRenewals,
  listOpportunities,
  listOpportunityContacts,
  listOpportunityWatch,
  patchOpportunity,
} from "./crm-opportunities";
import { registerCrmBidRoutes } from "./crm-bid-routes";

function sendError(res: Response, err: unknown) {
  if (err instanceof CrmHttpError) {
    return res.status(err.status).json({ message: err.message, ...err.body });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[crm]", message, err);
  return res.status(500).json({ message });
}

function queryInt(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.trunc(n);
}

function queryText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text : undefined;
}

async function actor(req: Request, res: Response, write: boolean): Promise<string | null> {
  return write ? requireWrite(req, res) : requireUser(req, res);
}

export function registerCrmRoutes(app: Express) {
  registerCrmBidRoutes(app);

  app.get("/api/accounts/crm-summary", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listCrmSummary());
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/accounts/:id/360", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid account" });
      const row = await getAccount360(id);
      if (!row) return res.status(404).json({ message: "Account not found" });
      res.json(row);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/opportunities/watch", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listOpportunityWatch());
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/opportunities/generate-renewals", async (req, res) => {
    try {
      const user = await actor(req, res, true);
      if (!user) return;
      const months = queryInt(req.query.months) ?? 12;
      const dryRun = req.query.dry_run === "1" || req.query.dry_run === "true";
      res.json(await generateRenewals({ months, dryRun, actor: user }));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/opportunities", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(
        await listOpportunities({
          account_id: queryInt(req.query.account_id),
          rider_id: queryInt(req.query.rider_id),
          owner: queryText(req.query.owner),
          stage: queryText(req.query.stage),
          type: queryText(req.query.type),
          open: req.query.open === "1" || req.query.open === "true",
          contact_id: queryInt(req.query.contact_id),
          company_id: queryInt(req.query.company_id),
          tag: queryText(req.query.tag),
        }),
      );
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/crm/parties", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const limit = queryInt(req.query.limit) ?? 20;
      res.json(await searchCrmParties(queryText(req.query.q) ?? "", limit));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/crm/prospect-dedup", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const marks = queryText(req.query.marks);
      res.json(await dedupCrmProspects(queryText(req.query.name) ?? "", marks ? marks.split(",") : []));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/crm/prospects", async (req, res) => {
    try {
      const user = await actor(req, res, true);
      if (!user) return;
      const row = await createCrmProspect((req.body ?? {}) as Record<string, unknown>, user);
      res.status(201).json(row);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/opportunities/:id/contacts", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listOpportunityContacts(Number(req.params.id)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/opportunities/:id/contacts", async (req, res) => {
    try {
      const user = await actor(req, res, true);
      if (!user) return;
      const row = await addOpportunityContact(Number(req.params.id), (req.body ?? {}) as Record<string, unknown>, user);
      res.status(201).json(row);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete("/api/opportunities/:id/contacts/:contactId", async (req, res) => {
    try {
      const user = await actor(req, res, true);
      if (!user) return;
      res.json(await deleteOpportunityContact(Number(req.params.id), Number(req.params.contactId), user));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/opportunities", async (req, res) => {
    try {
      const user = await actor(req, res, true);
      if (!user) return;
      const row = await createOpportunity((req.body ?? {}) as Record<string, unknown>, user);
      res.status(201).json(row);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.patch("/api/opportunities/:id", async (req, res) => {
    try {
      const user = await actor(req, res, true);
      if (!user) return;
      const row = await patchOpportunity(Number(req.params.id), (req.body ?? {}) as Record<string, unknown>, user);
      res.json(row);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/crm-activities", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(
        await listCrmActivities({
          account_id: queryInt(req.query.account_id),
          opportunity_id: queryInt(req.query.opportunity_id),
          rider_id: queryInt(req.query.rider_id),
          company_id: queryInt(req.query.company_id),
          contact_id: queryInt(req.query.contact_id),
          kind: queryText(req.query.kind),
        }),
      );
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/crm-activities", async (req, res) => {
    try {
      const user = await actor(req, res, true);
      if (!user) return;
      const row = await createCrmActivity((req.body ?? {}) as Record<string, unknown>, user);
      res.status(201).json(row);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.patch("/api/crm-activities/:id", async (req, res) => {
    try {
      const user = await actor(req, res, true);
      if (!user) return;
      const row = await patchCrmActivity(Number(req.params.id), (req.body ?? {}) as Record<string, unknown>, user);
      res.json(row);
    } catch (err) {
      sendError(res, err);
    }
  });
}
