import type { Express, Request, Response } from "express";
import type { Server } from "http";
import {
  genericUploadSource, getAuthUser, insertAttachmentRow, isAttachmentEntityType,
  isValidRole, logActivity, requireAdmin, requireContactsWrite, requireWrite, supabase,
  supabaseAdmin
} from "../routes-deps";
import {
  STORAGE_BUCKET, dvComputeFreshness, errHandler, upload
} from "../routes-lib";

export async function registerRoutesChunk10_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.patch("/api/admin/users/:userId/role", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const { userId } = req.params;
      const { role } = req.body as { role: AppRole };
      if (!isValidRole(role)) return res.status(400).json({ error: "valid role required" });
      const row = await findRoleRowByParam(userId);
      if (!row) return res.status(404).json({ error: "User not found" });
      const { error } = await supabase.from("user_roles").update({ role }).eq("id", row.id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  // DELETE /api/admin/users/:userId — remove a user's access (admin only)
  // Removes from user_roles (revokes app access). Auth account remains in Supabase.
  app.delete("/api/admin/users/:userId", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const { userId } = req.params;
      const row = await findRoleRowByParam(userId);
      if (!row) return res.status(404).json({ error: "User not found" });
      if (row.user_id && row.user_id === adminId) {
        return res.status(400).json({ error: "Cannot remove yourself" });
      }
      const { error } = await supabase.from("user_roles").delete().eq("id", row.id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  // ── Attachments ────────────────────────────────────────────────────────────
  // Files are stored in Supabase Storage bucket "rlms-attachments".
  // Metadata is stored in the `attachments` table.
  // entity_type: 'master_lease' | 'rider' | 'railcar' | 'account'
  // source_module is stamped server-side; client body.source_module is ignored.
  // entity_id: the primary key of the linked record

  // GET /api/attachments/:id/download — stream file directly (must be BEFORE /:entityType/:entityId to avoid route conflict)
  app.get("/api/attachments/:id/download", async (req, res) => {
    try {
      const user = await getAuthUser(req, res);
      if (!user) return;
      const { id } = req.params;
      const { data: att, error: fetchErr } = await supabase
        .from("attachments")
        .select("storage_path, file_name")
        .eq("id", id)
        .single();
      if (fetchErr || !att) return res.status(404).json({ error: "Attachment not found" });
      // Stream file directly through the backend
      const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .download(att.storage_path);
      if (dlErr || !fileBlob) throw dlErr ?? new Error("Could not download file from storage");
      const arrayBuffer = await fileBlob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const isPdf = att.file_name.toLowerCase().endsWith('.pdf');
      res.setHeader('Content-Type', isPdf ? 'application/pdf' : (fileBlob.type || 'application/octet-stream'));
      res.setHeader('Content-Disposition', isPdf ? `inline; filename="${att.file_name}"` : `attachment; filename="${att.file_name}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (err) { errHandler(res, err); }
  });

  // GET /api/attachments/:entityType/:entityId — list attachments for an entity
  app.get("/api/attachments/:entityType/:entityId", async (req, res) => {
    try {
      const user = await getAuthUser(req, res);
      if (!user) return;
      const { entityType, entityId } = req.params;
      const { data, error } = await supabase
        .from("attachments")
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/attachments/:entityType/:entityId — upload a file
}
