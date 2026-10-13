import type { Express } from "express";
import type { Server } from "http";
import {
  addCarsToProgram, buildProgramReport, bulkPatchProgramCars, exitCarFromProgram,
  getProgram, listActivity, listProgramCarsWithDocs, logProgramActivity, parseStatus,
  patchProgramCar, requireUser, requireWrite, supabase, supabaseAdmin
} from "../routes-deps";
import {
  STORAGE_BUCKET, errHandler, upload
} from "../routes-lib";

export async function registerRoutesPart9_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/programs/:id/documents", upload.single("file"), async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const programId = Number(req.params.id);
      const documentCategory = String(req.body.document_category || req.body.doc_type || "other").toLowerCase();
      const ts = Date.now();
      const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `programs/${programId}/${ts}-${safeName}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
      const { data, error } = await supabase.from("program_documents").insert({
        program_id: programId,
        file_name: req.file.originalname,
        file_url: publicUrl,
        storage_path: storagePath,
        doc_type: req.body.doc_type || documentCategory,
        document_category: documentCategory,
        file_size_bytes: req.file.size,
        uploaded_by: userId,
      }).select().single();
      if (error) { await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]); throw error; }
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  app.delete("/api/programs/:id/documents/:docId", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      const docId = Number(req.params.docId);
      const { data: doc } = await supabase.from("program_documents").select("storage_path").eq("id", docId).single();
      if (doc?.storage_path) await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([doc.storage_path]);
      const { error } = await supabase.from("program_documents").delete().eq("id", docId);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/:id/cars", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const includeExited = req.query.include_exited === "1" || req.query.include_exited === "true";
      res.json(await listProgramCarsWithDocs(Number(req.params.id), includeExited));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/programs/:id/cars", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const { railcar_ids } = req.body;
      if (!Array.isArray(railcar_ids) || railcar_ids.length === 0) {
        return res.status(400).json({ error: "railcar_ids required" });
      }
      res.json(await addCarsToProgram(Number(req.params.id), railcar_ids, userId));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/programs/:id/cars/bulk", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const linkIds = Array.isArray(req.body.link_ids) ? req.body.link_ids : [];
      const updates = req.body.updates && typeof req.body.updates === "object" ? req.body.updates : null;
      if (!linkIds.length || !updates) {
        return res.status(400).json({ error: "link_ids and updates required" });
      }
      res.json(await bulkPatchProgramCars(Number(req.params.id), linkIds, updates, userId));
    } catch (err) { errHandler(res, err); }
  });

  app.patch("/api/programs/:id/cars/:linkId", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const row = await patchProgramCar(Number(req.params.id), Number(req.params.linkId), req.body, userId);
      if (!row) return res.status(404).json({ error: "Car link not found" });
      res.json(row);
    } catch (err) { errHandler(res, err); }
  });

  app.delete("/api/programs/:id/cars/:linkId", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const row = await exitCarFromProgram(Number(req.params.id), Number(req.params.linkId), userId);
      if (!row) return res.status(404).json({ error: "Car link not found" });
      res.json(row);
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/:id/activity", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const programCarId = req.query.program_car_id != null ? Number(req.query.program_car_id) : undefined;
      res.json(await listActivity(Number(req.params.id), programCarId));
    } catch (err) { errHandler(res, err); }
  });

}
