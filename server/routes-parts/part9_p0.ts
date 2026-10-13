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

export async function registerRoutesPart9_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/programs/:id/export", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const includeExited = req.query.include_exited === "1" || req.query.include_exited === "true";
      const { buffer, filename } = await buildProgramReport({
        programIds: [Number(req.params.id)],
        includeExited,
      });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/:id", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const row = await getProgram(Number(req.params.id));
      if (!row) return res.status(404).json({ error: "Program not found" });
      res.json(row);
    } catch (err) { errHandler(res, err); }
  });

  app.patch("/api/programs/:id", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const id = Number(req.params.id);
      const { data: before } = await supabaseAdmin.from("programs").select("status, name").eq("id", id).maybeSingle();
      const updates: any = { updated_at: new Date().toISOString() };
      if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
      if (req.body.description !== undefined) updates.description = req.body.description || null;
      if (req.body.status !== undefined) updates.status = parseStatus(req.body.status, before?.status ?? "open");
      if (req.body.category_id !== undefined) updates.category_id = Number(req.body.category_id) || null;
      if (req.body.tags !== undefined) updates.tags = Array.isArray(req.body.tags) ? req.body.tags : null;
      if (req.body.entity !== undefined) updates.entity = req.body.entity || null;
      if (req.body.account_manager !== undefined) updates.account_manager = req.body.account_manager || null;
      if (req.body.account_id !== undefined) {
        updates.account_id = req.body.account_id ? Number(req.body.account_id) : null;
      }
      if (req.body.status_narrative !== undefined) updates.status_narrative = req.body.status_narrative || null;
      if (req.body.target_completion_date !== undefined) updates.target_completion_date = req.body.target_completion_date || null;
      if (req.body.opened_date !== undefined) updates.opened_date = req.body.opened_date || null;
      if (req.body.closed_date !== undefined) updates.closed_date = req.body.closed_date || null;
      const { data, error } = await supabaseAdmin.from("programs").update(updates).eq("id", id).select().single();
      if (error) throw error;
      if (before && updates.status && updates.status !== before.status) {
        await logProgramActivity({
          program_id: id,
          action: "status_changed",
          actor: userId,
          detail: { from: before.status, to: updates.status },
        });
      }
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  app.delete("/api/programs/:id", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      const id = Number(req.params.id);
      const { data: docs } = await supabase.from("program_documents").select("storage_path").eq("program_id", id);
      if (docs && docs.length > 0) {
        await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(docs.map((d: any) => d.storage_path));
      }
      const { error } = await supabase.from("programs").delete().eq("id", id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/:id/documents", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const { data, error } = await supabase
        .from("program_documents")
        .select("*")
        .eq("program_id", Number(req.params.id))
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

}
