import type { Express } from "express";
import type { Server } from "http";
import {
  requireUser, requireWrite, supabase, supabaseAdmin,
  validateMaterialCompositionForSave
} from "../routes-deps";
import {
  STORAGE_BUCKET, dvCalculateWithGuardrails, dvLoadReferenceData, dvMaterialWeights,
  dvParseInputs, errHandler, upload
} from "../routes-lib";

export async function registerRoutesChunk12_p2(_httpServer: Server,
  app: Express,): Promise<void> {

  app.delete("/api/communications/:id", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const { error } = await supabase.from("invoice_communications").delete().eq("id", req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/invoices/:id/upload-pdf — upload cover sheet PDF
  app.post("/api/invoices/:id/upload-pdf", upload.single("file"), async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const ext = req.file.originalname.split(".").pop() ?? "pdf";
      const path = `invoices/${req.params.id}/cover-${Date.now()}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      await supabase.from("invoices").update({ pdf_url: publicUrl, updated_at: new Date().toISOString() }).eq("id", req.params.id);
      res.json({ pdf_url: publicUrl });
    } catch (err) { errHandler(res, err); }
  });

  // GET /api/invoices/export/csv — export full AP report as CSV

}
