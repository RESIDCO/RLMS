import type { Express } from "express";
import type { Server } from "http";
import {
  buildProgramReport, createAccount, createTerritoryOwner, getAccount, listAccounts,
  listCategories, listDirectoryPeopleForAccount, listPrograms,
  listRiderCarsForAccountMgmt, listStatusOptions, listTerritoryContacts,
  logProgramActivity, masterReportFilename, olProgramHistory, parseStatus,
  patchTerritoryOwner, requireAdmin, requireUser, requireWrite, resolveProgramCars,
  supabase, supabaseAdmin, updateAccount
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesChunk15_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/territories/contacts/list", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listTerritoryContacts({
        relationship_type: typeof req.query.relationship_type === "string" ? req.query.relationship_type : undefined,
        priority_tier: typeof req.query.priority_tier === "string" ? req.query.priority_tier : undefined,
        pipeline_status: typeof req.query.pipeline_status === "string" ? req.query.pipeline_status : undefined,
        owner: typeof req.query.owner === "string" ? req.query.owner : undefined,
        q: typeof req.query.q === "string" ? req.query.q : undefined,
        linked_to_ol: req.query.linked_to_ol === "true" || req.query.linked_to_ol === "1",
        location_status: typeof req.query.location_status === "string" ? req.query.location_status : undefined,
        county: typeof req.query.county === "string" ? req.query.county : undefined,
        state: typeof req.query.state === "string" ? req.query.state : undefined,
        offset: Number(req.query.offset) || 0,
        limit: Number(req.query.limit) || 80,
      }));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/territories/owners", async (req, res) => {
    try {
      if (!(await requireAdmin(req, res))) return;
      try {
        const row = await createTerritoryOwner(req.body ?? {});
        res.status(201).json(row);
      } catch (e: any) {
        if (e?.status) return res.status(e.status).json({ message: e.message });
        throw e;
      }
    } catch (err) { errHandler(res, err); }
  });

  app.patch("/api/territories/owners/:initials", async (req, res) => {
    try {
      if (!(await requireAdmin(req, res))) return;
      try {
        res.json(await patchTerritoryOwner(String(req.params.initials ?? ""), req.body ?? {}));
      } catch (e: any) {
        if (e?.status) return res.status(e.status).json({ message: e.message });
        throw e;
      }
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/account-management/riders/:riderId/cars", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const riderId = Number(req.params.riderId);
      if (!Number.isFinite(riderId) || riderId <= 0) {
        return res.status(400).json({ message: "Invalid rider" });
      }
      res.json({ cars: await listRiderCarsForAccountMgmt(riderId) });
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/accounts", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listAccounts());
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/accounts", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      const row = await createAccount({
        name: String(req.body.name ?? ""),
        notes: req.body.notes ?? null,
      });
      res.json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.get("/api/accounts/:id", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const row = await getAccount(Number(req.params.id));
      if (!row) return res.status(404).json({ message: "Account not found" });
      res.json(row);
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/accounts/:id/contacts", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const accountId = Number(req.params.id);
      if (!Number.isFinite(accountId) || accountId <= 0) {
        return res.status(400).json({ message: "Invalid account" });
      }
      res.json(await listDirectoryPeopleForAccount(accountId));
    } catch (err) { errHandler(res, err); }
  });

  app.patch("/api/accounts/:id", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      const row = await updateAccount(Number(req.params.id), {
        name: req.body.name,
        notes: req.body.notes,
        account_manager: req.body.account_manager,
      });
      if (!row) return res.status(404).json({ message: "Account not found" });
      res.json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  // ── PROGRAMS MODULE ──────────────────────────────────────────────────────────

  app.get("/api/programs/categories", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listCategories());
    } catch (err) { errHandler(res, err); }
  });

}
