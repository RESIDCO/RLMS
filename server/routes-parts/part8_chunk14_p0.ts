import type { Express } from "express";
import type { Server } from "http";
import {
  addMilestone, addTransitionComment, assignTerritories, deleteMilestone,
  deleteTransitionComment, deleteTransitionRecord, generateBriefingPdf,
  getOrCreateBriefingForm, getTerritoryContacts, getTerritoryHistory, getTerritoryMap,
  getTransitionDetail, patchMilestone, patchTransitionRecord, requireAccountMgmtWrite,
  requireAdmin, requireUser, requireWrite, revertTerritoryChangeSet, saveBriefingForm
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesChunk14_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/account-transitions/:id", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid record" });
      const row = await getTransitionDetail(id);
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (err) { errHandler(res, err); }
  });

  app.patch("/api/account-transitions/:id", async (req, res) => {
    try {
      if (!(await requireAccountMgmtWrite(req, res))) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid record" });
      const body = req.body ?? {};
      const patch: {
        from_account_manager?: string | null;
        to_account_manager?: string | null;
        communication_method?: string | null;
        status?: string;
        meeting_scheduled?: boolean;
        meeting_date?: string | null;
        communication_completed?: boolean;
        communication_completed_date?: string | null;
        briefing_form_completed?: boolean;
        briefing_form_completed_date?: string | null;
      } = {};
      if ("from_account_manager" in body) patch.from_account_manager = body.from_account_manager;
      if ("to_account_manager" in body) patch.to_account_manager = body.to_account_manager;
      if ("communication_method" in body) patch.communication_method = body.communication_method;
      if ("status" in body) patch.status = body.status;
      if ("meeting_scheduled" in body) patch.meeting_scheduled = body.meeting_scheduled;
      if ("meeting_date" in body) patch.meeting_date = body.meeting_date;
      if ("communication_completed" in body) patch.communication_completed = body.communication_completed;
      if ("communication_completed_date" in body) patch.communication_completed_date = body.communication_completed_date;
      if ("briefing_form_completed" in body) patch.briefing_form_completed = body.briefing_form_completed;
      if ("briefing_form_completed_date" in body) patch.briefing_form_completed_date = body.briefing_form_completed_date;
      const row = await patchTransitionRecord(id, patch);
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.delete("/api/account-transitions/:id", async (req, res) => {
    try {
      if (!(await requireAccountMgmtWrite(req, res))) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid record" });
      const ok = await deleteTransitionRecord(id);
      if (!ok) return res.status(404).json({ message: "Not found" });
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/account-transitions/:id/briefing", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid record" });
      res.json(await getOrCreateBriefingForm(id));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.patch("/api/account-transitions/:id/briefing", async (req, res) => {
    try {
      if (!(await requireAccountMgmtWrite(req, res))) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid record" });
      res.json(await saveBriefingForm(id, req.body ?? {}));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.post("/api/account-transitions/:id/briefing/pdf", async (req, res) => {
    try {
      const userId = await requireAccountMgmtWrite(req, res);
      if (!userId) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid record" });
      const row = await generateBriefingPdf(id, userId);
      res.status(201).json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

}
