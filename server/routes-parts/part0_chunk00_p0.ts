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

export async function registerRoutesChunk00_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/dashboard", async (req, res) => {
    await handle_get_api_dashboard(req, res);
  });

  app.post("/api/import/commit", async (req, res) => {
    await handle_post_api_import_commit(req, res);
  });

  app.post("/api/import/vcf/commit", async (req, res) => {
    await handle_post_api_import_vcf_commit(req, res);
  });

  // ---------- Batch Lease Setup (wizard) ----------
  // Creates MLA + riders + new railcars + assignments in one atomic-ish call.
  // Each rider may carry an optional `cars` array of car objects to create & assign.
}
