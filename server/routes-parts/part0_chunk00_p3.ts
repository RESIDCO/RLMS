import type { Express, Request, Response } from "express";
import type { Server } from "http";
import {
  browseGroup, browseOl, browseTurning50, buildTurning50Report, conflictResponse,
  createContactOnRider, deriveFleetStatus, ensureAccountForLessee, fetchAllRows,
  fieldsImpliedByCarStatus, findCarNumberConflict, governLeaseDates,
  isOperatingFleetCar, normalizeStoredCarNumber, parseFleetStatus,
  parseRailcarListParams, pointCurrentAssignmentAt, queryRailcars, requireUser,
  requireWrite, supabase, supabaseAdmin
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";
import { handle_get_api_dashboard } from "../routes-handlers/handle_get_api_dashboard";
import { handle_post_api_import_commit } from "../routes-handlers/handle_post_api_import_commit";
import { handle_post_api_import_vcf_commit } from "../routes-handlers/handle_post_api_import_vcf_commit";

export async function registerRoutesChunk00_p3(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/browse/turning50/export", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      const year = Number(req.query.year);
      if (!Number.isFinite(year) || year < 1900 || year > 2100) {
        return res.status(400).json({ message: "year is required" });
      }
      const ols = String(req.query.ols ?? req.query.ol ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const carIds = String(req.query.ids ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      const { buffer, filename } = await buildTurning50Report({
        year,
        ols: ols.length ? ols : undefined,
        carIds: carIds.length ? carIds : undefined,
      });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      errHandler(res, err);
    }
  });

  /** Refresh riders.expiration_date + car lease dates: Asset Report first, V_Valid fallback. */
  app.post("/api/riders/sync-expirations", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const result = await governLeaseDates(supabase);
      res.json(result);
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Railcars ----------
  app.get("/api/railcars", async (req: Request, res: Response) => {
    try {
      const params = parseRailcarListParams(req.query as Record<string, unknown>);
      const result = await queryRailcars(params);
      if (params.all) {
        res.json(result.rows);
        return;
      }
      res.json(result);
    } catch (err) {
      errHandler(res, err);
    }
  });

}
