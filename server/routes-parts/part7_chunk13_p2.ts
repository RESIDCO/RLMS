import type { Express, Request, Response } from "express";
import type { Server } from "http";
import {
  ACCOUNT_TRANSITIONS_SOURCE, createRiderAccountComment, createTransitionRecord,
  deleteRiderAccountComment, getAuthUser, insertAttachmentRow, isStatusTag,
  listAccountManagementOverview, listAccountScopedAttachments,
  listRiderAccountComments, listTransitionRecords, listTransitionSummary,
  patchRiderStatusTag, requireAccountMgmtWrite, requireAdmin, requireUser,
  requireWrite, riderBelongsToAccount, supabase, supabaseAdmin
} from "../routes-deps";
import {
  STORAGE_BUCKET, errHandler, upload
} from "../routes-lib";

export async function registerRoutesChunk13_p2(_httpServer: Server,
  app: Express,): Promise<void> {

  app.delete("/api/account-management/comments/:commentId", async (req, res) => {
    try {
      if (!(await requireAdmin(req, res))) return;
      const commentId = Number(req.params.commentId);
      if (!Number.isFinite(commentId) || commentId <= 0) {
        return res.status(400).json({ message: "Invalid comment" });
      }
      const ok = await deleteRiderAccountComment(commentId);
      if (!ok) return res.status(404).json({ message: "Comment not found" });
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.patch("/api/account-management/comments/:commentId", (_req, res) => {
    res.status(405).json({ message: "Account Management notes cannot be edited" });
  });
  app.put("/api/account-management/comments/:commentId", (_req, res) => {
    res.status(405).json({ message: "Account Management notes cannot be edited" });
  });
  app.patch("/api/account-management/riders/:riderId/comment", (_req, res) => {
    res.status(410).json({ message: "Use POST /api/account-management/riders/:riderId/comments" });
  });

  app.get("/api/account-transitions/summary", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listTransitionSummary());
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/account-transitions", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const am = typeof req.query.am === "string" ? req.query.am : "";
      res.json(await listTransitionRecords(am.trim() || null));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/account-transitions", async (req, res) => {
    try {
      if (!(await requireAccountMgmtWrite(req, res))) return;
      const row = await createTransitionRecord(Number(req.body?.account_id));
      res.status(201).json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

}
