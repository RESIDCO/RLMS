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

export async function registerRoutesChunk01_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/car-status-history/car/:carId", async (req, res) => {
    try {
      const carId = Number(req.params.carId);
      if (!Number.isFinite(carId) || carId <= 0) {
        return res.status(400).json({ message: "Invalid car id" });
      }
      const { data, error } = await supabaseAdmin
        .from("car_status_history")
        .select("*")
        .eq("car_id", carId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/railcars/bulk-needs-completion", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const idsRaw = Array.isArray(req.body?.ids) ? req.body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0) : [];
      if (idsRaw.length === 0) {
        return res.status(400).json({ message: "ids required" });
      }
      if (idsRaw.length > 20_000) {
        return res.status(400).json({ message: "Too many cars in one request (max 20,000)" });
      }
      const needs_completion = req.body?.needs_completion === true;
      const uniqueIds = [...new Set(idsRaw)];
      const CHUNK = 200;
      let updated = 0;
      for (let i = 0; i < uniqueIds.length; i += CHUNK) {
        const slice = uniqueIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("railcars")
          .update({ needs_completion })
          .in("id", slice)
          .select("id");
        if (error) throw error;
        updated += data?.length ?? 0;
      }
      res.json({ ok: true, updated, needs_completion });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/railcars/bulk-entity", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const idsRaw = Array.isArray(req.body?.ids) ? req.body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0) : [];
      const rawEntity = String(req.body?.entity ?? "").trim();
      const entity =
        rawEntity === "RPS" || rawEntity.toLowerCase() === "rps" || rawEntity === "Rail Partners Select"
          ? "Rail Partners Select"
          : rawEntity === "Main"
            ? "Main"
            : rawEntity === "Coal"
              ? "Coal"
              : null;
      if (!entity) {
        return res.status(400).json({ message: "entity must be Main, RPS, or Coal" });
      }
      if (idsRaw.length === 0) {
        return res.status(400).json({ message: "ids required" });
      }
      if (idsRaw.length > 20_000) {
        return res.status(400).json({ message: "Too many cars in one request (max 20,000)" });
      }
      const uniqueIds = [...new Set(idsRaw)];
      const CHUNK = 200;
      let updated = 0;
      for (let i = 0; i < uniqueIds.length; i += CHUNK) {
        const slice = uniqueIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("railcars")
          .update({ entity })
          .in("id", slice)
          .select("id");
        if (error) throw error;
        updated += data?.length ?? 0;
      }
      res.json({ ok: true, updated, entity });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/railcars/bulk-ops-flag", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const idsRaw = Array.isArray(req.body?.ids) ? req.body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0) : [];
      if (idsRaw.length === 0) {
        return res.status(400).json({ message: "ids required" });
      }
      if (idsRaw.length > 20_000) {
        return res.status(400).json({ message: "Too many cars in one request (max 20,000)" });
      }
      const raw = req.body?.ops_flag;
      const ops_flag = raw == null || String(raw).trim() === "" ? null : String(raw).trim().slice(0, 80);
      const uniqueIds = [...new Set(idsRaw)];
      const updated = await persistOpsFlag(uniqueIds, ops_flag);
      res.json({ ok: true, updated, ops_flag });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/acquisition-batches", async (_req, res) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("acquisition_batches")
        .select("id, label, acquisition_date, entity, default_rental_status, car_count, created_at")
        .order("created_at", { ascending: false });
      if (error) {
        if (/acquisition_batches/i.test(error.message) && /does not exist|schema cache/i.test(error.message)) {
          return res.json([]);
        }
        throw error;
      }
      res.json(data ?? []);
    } catch (err) {
      errHandler(res, err);
    }
  });

}
