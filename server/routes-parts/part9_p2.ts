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

export async function registerRoutesPart9_p2(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/programs/:id/cars/:linkId/documents", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const { data, error } = await supabaseAdmin
        .from("program_car_documents")
        .select("*")
        .eq("program_car_id", Number(req.params.linkId))
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []).map((d: any) => {
        const { data: pub } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(d.file_path);
        return { ...d, file_url: pub.publicUrl };
      });
      res.json(rows);
    } catch (err) { errHandler(res, err); }
  });

}
