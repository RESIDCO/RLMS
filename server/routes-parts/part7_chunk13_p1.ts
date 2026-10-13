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

export async function registerRoutesChunk13_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/account-management/riders/:riderId/comments", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const riderId = Number(req.params.riderId);
      if (!Number.isFinite(riderId) || riderId <= 0) {
        return res.status(400).json({ message: "Invalid rider" });
      }
      res.json({ comments: await listRiderAccountComments(riderId) });
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/account-management/riders/:riderId/comments", async (req, res) => {
    try {
      const userId = await requireAccountMgmtWrite(req, res);
      if (!userId) return;
      const riderId = Number(req.params.riderId);
      if (!Number.isFinite(riderId) || riderId <= 0) {
        return res.status(400).json({ message: "Invalid rider" });
      }
      const row = await createRiderAccountComment({
        riderId,
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

  app.get("/api/account-management/accounts/:id/attachments", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const accountId = Number(req.params.id);
      if (!Number.isFinite(accountId) || accountId <= 0) {
        return res.status(400).json({ message: "Invalid account" });
      }
      res.json({ attachments: await listAccountScopedAttachments(accountId) });
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/account-management/accounts/:id/attachments",
    upload.single("file"),
    async (req: Request & { file?: Express.Multer.File }, res: Response) => {
      try {
        if (!(await requireAccountMgmtWrite(req, res))) return;
        const user = await getAuthUser(req);
        if (!user) return;
        if (!req.file) return res.status(400).json({ error: "No file provided" });
        const accountId = Number(req.params.id);
        if (!Number.isFinite(accountId) || accountId <= 0) {
          return res.status(400).json({ message: "Invalid account" });
        }
        const body = req.body as { entity_type?: string; entity_id?: string; source_module?: string };
        // Ignore spoofed provenance — this route always stamps account_transitions.
        void body.source_module;
        let entityType: "account" | "rider" = body.entity_type === "rider" ? "rider" : "account";
        let entityId = entityType === "account" ? accountId : Number(body.entity_id);
        if (entityType === "rider") {
          if (!Number.isFinite(entityId) || entityId <= 0) {
            return res.status(400).json({ message: "Pick an OL to attach this file to" });
          }
          const ok = await riderBelongsToAccount(entityId, accountId);
          if (!ok) return res.status(400).json({ message: "That OL is not on this account" });
        }
        const ts = Date.now();
        const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${entityType}/${entityId}/${ts}-${safeName}`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: false,
          });
        if (uploadError) throw uploadError;
        try {
          const data = await insertAttachmentRow({
            entity_type: entityType,
            entity_id: entityId,
            file_name: req.file.originalname,
            file_size: req.file.size,
            mime_type: req.file.mimetype,
            storage_path: storagePath,
            uploaded_by: user.email ?? user.id,
            notes: null,
            source_module: ACCOUNT_TRANSITIONS_SOURCE,
          });
          res.status(201).json(data);
        } catch (dbError) {
          await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]);
          throw dbError;
        }
      } catch (err) { errHandler(res, err); }
    },
  );

}
