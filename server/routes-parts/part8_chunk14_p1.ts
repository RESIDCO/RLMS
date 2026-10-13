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

export async function registerRoutesChunk14_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/account-transitions/:id/milestones", async (req, res) => {
    try {
      if (!(await requireAccountMgmtWrite(req, res))) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid record" });
      res.status(201).json(await addMilestone(id, String(req.body?.label ?? "")));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.patch("/api/account-transitions/:id/milestones/:mid", async (req, res) => {
    try {
      if (!(await requireAccountMgmtWrite(req, res))) return;
      const mid = Number(req.params.mid);
      if (!Number.isFinite(mid) || mid <= 0) return res.status(400).json({ message: "Invalid milestone" });
      const body = req.body ?? {};
      const patch: { done?: boolean; label?: string; milestone_date?: string | null } = {};
      if ("done" in body) patch.done = body.done;
      if ("label" in body) patch.label = body.label;
      if ("milestone_date" in body) patch.milestone_date = body.milestone_date;
      const row = await patchMilestone(mid, patch);
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.delete("/api/account-transitions/:id/milestones/:mid", async (req, res) => {
    try {
      if (!(await requireAccountMgmtWrite(req, res))) return;
      const mid = Number(req.params.mid);
      if (!Number.isFinite(mid) || mid <= 0) return res.status(400).json({ message: "Invalid milestone" });
      await deleteMilestone(mid);
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/account-transitions/:id/comments", async (req, res) => {
    try {
      const userId = await requireAccountMgmtWrite(req, res);
      if (!userId) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid record" });
      const row = await addTransitionComment({
        recordId: id,
        authorUserId: userId,
        authorEmail: req.authUser?.email ?? "",
        body: String(req.body?.body ?? ""),
      });
      res.status(201).json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.delete("/api/account-transitions/:id/comments/:cid", async (req, res) => {
    try {
      if (!(await requireAdmin(req, res))) return;
      const cid = Number(req.params.cid);
      if (!Number.isFinite(cid) || cid <= 0) return res.status(400).json({ message: "Invalid comment" });
      await deleteTransitionComment(cid);
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/territories/map", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await getTerritoryMap());
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/territories/history", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const county = typeof req.query.county === "string" ? req.query.county : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 40));
      res.json(await getTerritoryHistory({ county: county || undefined, state: state || undefined, limit }));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/territories/assign", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      const who = req.authUser?.email || req.authUser?.id || "unknown";
      try {
        res.json(await assignTerritories(req.body ?? {}, who));
      } catch (e: any) {
        if (e?.status) return res.status(e.status).json({ message: e.message });
        throw e;
      }
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/territories/revert", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      const who = req.authUser?.email || req.authUser?.id || "unknown";
      const id = String(req.body?.change_set_id ?? "").trim();
      if (!id) return res.status(400).json({ message: "change_set_id is required" });
      try {
        res.json(await revertTerritoryChangeSet(id, who));
      } catch (e: any) {
        if (e?.status) return res.status(e.status).json({ message: e.message });
        throw e;
      }
    } catch (err) { errHandler(res, err); }
  });

}
