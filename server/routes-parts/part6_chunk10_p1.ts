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

export async function registerRoutesChunk10_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/attachments/:entityType/:entityId",
    upload.single("file"),
    async (req: Request & { file?: Express.Multer.File }, res: Response) => {
      try {
        const { entityType, entityId } = req.params;
        const writerId = (entityType === "company" || entityType === "company_contact")
          ? await requireContactsWrite(req, res)
          : await requireWrite(req, res);
        if (!writerId) return;
        const user = await getAuthUser(req);
        if (!user) return;
        if (!req.file) return res.status(400).json({ error: "No file provided" });
        const validTypes = ["master_lease", "rider", "railcar", "company", "company_contact"];
        if (!validTypes.includes(entityType) || !isAttachmentEntityType(entityType)) {
          return res.status(400).json({ error: "Invalid entity type" });
        }
        const notes = (req.body as { notes?: string }).notes ?? null;
        // Provenance is never taken from the client (ignore body.source_module).
        const source_module = genericUploadSource(entityType);
        // Build a unique storage path: entityType/entityId/timestamp-filename
        const ts = Date.now();
        const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${entityType}/${entityId}/${ts}-${safeName}`;
        // Upload to Supabase Storage using admin client
        const { error: uploadError } = await supabaseAdmin.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: false,
          });
        if (uploadError) throw uploadError;
        // Save metadata to attachments table
        let data;
        try {
          data = await insertAttachmentRow({
            entity_type: entityType as any,
            entity_id: parseInt(entityId, 10),
            file_name: req.file.originalname,
            file_size: req.file.size,
            mime_type: req.file.mimetype,
            storage_path: storagePath,
            uploaded_by: user.email ?? user.id,
            notes,
            source_module,
          });
        } catch (dbError) {
          await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]);
          throw dbError;
        }
        const eid = parseInt(entityId, 10);
        if (entityType === "railcar" || entityType === "rider") {
          await logActivity({
            entity_type: entityType,
            entity_id: eid,
            railcar_id: entityType === "railcar" ? eid : null,
            rider_id: entityType === "rider" ? eid : null,
            action: "attachment",
            actor: user.email ?? user.id,
            detail: { file_name: req.file.originalname, notes },
            source_table: "attachments",
            source_id: data?.id ?? null,
          });
        }
        res.status(201).json(data);
      } catch (err) { errHandler(res, err); }
    }
  );

  // DELETE /api/attachments/:id — delete an attachment (admin only)
  app.delete("/api/attachments/:id", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { id } = req.params;
      const { data: att, error: fetchErr } = await supabase
        .from("attachments")
        .select("storage_path")
        .eq("id", id)
        .single();
      if (fetchErr || !att) return res.status(404).json({ error: "Attachment not found" });
      // Remove from storage first
      const { error: storageErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .remove([att.storage_path]);
      if (storageErr) throw storageErr;
      // Remove metadata
      const { error: dbErr } = await supabase.from("attachments").delete().eq("id", id);
      if (dbErr) throw dbErr;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  // ── Rent Events ────────────────────────────────────────────────────────────

  // GET /api/rent-events — all events (for dashboard/export)
  app.get("/api/rent-events", async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from("rent_events")
        .select("*, railcar:railcars(car_number, entity)")
        .order("event_date", { ascending: false });
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

  // GET /api/rent-events/car/:carId — events for one car
  app.get("/api/rent-events/car/:carId", async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("rent_events")
        .select("*")
        .eq("car_id", Number(req.params.carId))
        .order("event_date", { ascending: false });
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/rent-events — log a new rent event
}
