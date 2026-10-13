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

export async function registerRoutesChunk01_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/railcars/ids", async (req: Request, res: Response) => {
    try {
      const params = parseRailcarListParams(req.query as Record<string, unknown>);
      const ids = await queryRailcarIds({ ...params, all: true });
      res.json({ ids, total_count: ids.length });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/railcars/bulk-fleet-status", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const idsRaw = Array.isArray(req.body?.ids) ? req.body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0) : [];
      const fleet_status = parseFleetStatus(req.body?.fleet_status);
      if (!fleet_status) {
        return res.status(400).json({ message: "fleet_status must be Leased, Idle, Sold, or Abatement" });
      }
      if (idsRaw.length === 0) {
        return res.status(400).json({ message: "ids required" });
      }
      if (idsRaw.length > 20_000) {
        return res.status(400).json({ message: "Too many cars in one request (max 20,000)" });
      }
      const uniqueIds = [...new Set(idsRaw)];
      const CHUNK = 200;
      const movedAt = effectiveDateToTimestamp(
        typeof req.body?.effective_date === "string" ? req.body.effective_date : null,
      );
      const movedBy = typeof req.body?.moved_by === "string" && req.body.moved_by.trim()
        ? req.body.moved_by.trim()
        : "bulk-action";
      let updated = 0;
      const historyRows: any[] = [];
      for (let i = 0; i < uniqueIds.length; i += CHUNK) {
        const slice = uniqueIds.slice(i, i + CHUNK);
        // Rental Status only — never touch active / active_status / status (Car Status).
        const { data, error } = await supabase
          .from("railcars")
          .update({ fleet_status, fleet_status_source: "manual" })
          .in("id", slice)
          .select("id");
        if (error) throw error;
        updated += data?.length ?? 0;

        const { data: assigns, error: aErr } = await supabase
          .from("railcar_assignments")
          .select("railcar_id, rider_id, fleet_name")
          .in("railcar_id", slice);
        if (aErr) throw aErr;
        const byCar = new Map<number, any>();
        for (const a of assigns ?? []) byCar.set(a.railcar_id, a);
        for (const carId of slice) {
          const prev = byCar.get(carId);
          historyRows.push({
            railcar_id: carId,
            from_rider_id: prev?.rider_id ?? null,
            to_rider_id: prev?.rider_id ?? null,
            from_fleet_name: prev?.fleet_name ?? null,
            to_fleet_name: prev?.fleet_name ?? null,
            moved_at: movedAt,
            moved_by: movedBy,
            reason: `Rental status set to ${fleet_status}`,
          });
        }
      }
      if (historyRows.length) {
        for (let i = 0; i < historyRows.length; i += CHUNK) {
          const { error: hErr } = await supabase
            .from("assignment_history")
            .insert(historyRows.slice(i, i + CHUNK));
          if (hErr) throw hErr;
        }
      }
      res.json({ ok: true, updated, fleet_status });
    } catch (err) {
      errHandler(res, err);
    }
  });

  /** Guarded Car Status change (Inactive / reactivate require reason + history). */
  app.post("/api/railcars/car-status", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const idsRaw = Array.isArray(req.body?.ids)
        ? req.body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
        : [];
      const status = String(req.body?.status ?? "").trim();
      const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
      if (!status) return res.status(400).json({ message: "status is required" });
      if (!idsRaw.length) return res.status(400).json({ message: "ids required" });
      if (idsRaw.length > 20_000) {
        return res.status(400).json({ message: "Too many cars in one request (max 20,000)" });
      }
      const result = await applyCarStatusChange({
        ids: idsRaw,
        status,
        reason,
        userId: writerId,
      });
      res.json({ ok: true, ...result, status });
    } catch (err: any) {
      if (err?.status === 400) return res.status(400).json({ message: err.message });
      errHandler(res, err);
    }
  });

}
