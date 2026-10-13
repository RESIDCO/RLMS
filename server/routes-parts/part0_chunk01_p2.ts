import type { Express, Request, Response } from "express";
import type { Server } from "http";
import {
  applyCarStatusChange, effectiveDateToTimestamp, getVcfExportFile, getVcfExportJob,
  parseFleetStatus, parseRailcarListParams, persistOpsFlag, queryRailcarIds,
  requireWrite, startVcfExportJob, supabase, supabaseAdmin
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesChunk01_p2(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/reports/v-valid-cars/jobs", async (_req, res) => {
    try {
      const started = await startVcfExportJob();
      if ("error" in started) {
        return res.status(started.status).json({ message: started.error });
      }
      res.status(202).json({ id: started.id, status: "running" });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/reports/v-valid-cars/jobs/:id", async (req, res) => {
    try {
      const job = await getVcfExportJob(String(req.params.id));
      if (!job) return res.status(404).json({ message: "Export job not found" });
      res.json(job);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/reports/v-valid-cars/jobs/:id/file", async (req, res) => {
    try {
      const file = await getVcfExportFile(String(req.params.id));
      if (!file.ok) return res.status(file.status).json({ message: file.message });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(file.buffer);
    } catch (err) {
      errHandler(res, err);
    }
  });

}
