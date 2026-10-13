import type { Express, Request, Response } from "express";
import type { Server } from "http";
import {
  createCompany, createCompanyContact, createContactLeaseLink, deleteCompany,
  deleteCompanyContact, deleteContactLeaseLink, getCompany, getCompanyContact,
  listCompanies, listCompanyContacts, listCompanyLeaseLinks, listContactLeaseLinks,
  listLeaseContactLinks, requireContactsDelete, requireContactsWrite, requireUser,
  requireWrite, supabaseAdmin, updateCompany, updateCompanyContact
} from "../routes-deps";
import {
  STORAGE_BUCKET, errHandler, upload
} from "../routes-lib";

export async function registerRoutesChunk17_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/programs/:id/cars/:linkId/documents", upload.single("file"), async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const programId = Number(req.params.id);
      const linkId = Number(req.params.linkId);
      const documentCategory = String(req.body.document_category || "other").toLowerCase();
      const ts = Date.now();
      const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `programs/${programId}/cars/${linkId}/${ts}-${safeName}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (upErr) throw upErr;
      const { data, error } = await supabaseAdmin.from("program_car_documents").insert({
        program_car_id: linkId,
        document_category: documentCategory,
        file_path: storagePath,
        file_name: req.file.originalname,
        file_size_bytes: req.file.size,
        uploaded_by: userId,
        notes: req.body.notes || null,
      }).select().single();
      if (error) { await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]); throw error; }
      const { data: pub } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
      res.json({ ...data, file_url: pub.publicUrl });
    } catch (err) { errHandler(res, err); }
  });

  app.delete("/api/programs/:id/cars/:linkId/documents/:docId", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      const docId = Number(req.params.docId);
      const { data: doc } = await supabaseAdmin.from("program_car_documents").select("file_path").eq("id", docId).single();
      if (doc?.file_path) await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([doc.file_path]);
      const { error } = await supabaseAdmin.from("program_car_documents").delete().eq("id", docId);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/companies", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listCompanies(req.query as Record<string, unknown>));
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/companies/:id", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid company" });
      const row = await getCompany(id);
      if (!row) return res.status(404).json({ message: "Company not found" });
      res.json(row);
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/companies", async (req: Request, res: Response) => {
    try {
      if (!(await requireContactsWrite(req, res))) return;
      res.status(201).json(await createCompany((req.body ?? {}) as Record<string, unknown>));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.patch("/api/companies/:id", async (req: Request, res: Response) => {
    try {
      if (!(await requireContactsWrite(req, res))) return;
      const id = Number(req.params.id);
      const row = await updateCompany(id, (req.body ?? {}) as Record<string, unknown>);
      if (!row) return res.status(404).json({ message: "Company not found" });
      res.json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.delete("/api/companies/:id", async (req: Request, res: Response) => {
    try {
      if (!(await requireContactsDelete(req, res))) return;
      await deleteCompany(Number(req.params.id));
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

}
