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

export async function registerRoutesChunk00_p2(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/dashboard/lessee", async (req: Request, res: Response) => {
    try {
      const name = String(req.query.name ?? "").trim();
      if (!name) return res.status(400).json({ message: "name is required" });

      const cars = await fetchAllRows((from, to) =>
        supabaseAdmin
          .from("railcars")
          .select(
            "id, car_number, reporting_marks, car_type, status, fleet_status, entity, active, lessee_name, rider_external_id, assignment_label, managed_category, sold_to"
          )
          .eq("active", true)
          .eq("lessee_name", name)
          .order("id", { ascending: true })
          .range(from, to)
      );
      const operating = cars.filter((r: any) =>
        isOperatingFleetCar({
          active: r.active,
          fleet_status: r.fleet_status,
          rider_external_id: r.rider_external_id,
          assignment_label: r.assignment_label,
          managed_category: r.managed_category,
        })
      );
      res.json({
        fleet_name: name,
        count: operating.length,
        cars: operating
          .map((c: any) => ({
            id: c.id,
            car_number: c.car_number,
            reporting_marks: c.reporting_marks,
            car_type: c.car_type,
            status: c.status,
            entity: c.entity,
            active: c.active,
            rider_external_id: c.rider_external_id,
            assignment_label: c.assignment_label,
            managed_category: c.managed_category,
            fleet_status: parseFleetStatus(c.fleet_status) ?? deriveFleetStatus({
              active: c.active,
              fleet_status: c.fleet_status,
              rider_external_id: c.rider_external_id,
              assignment_label: c.assignment_label,
              managed_category: c.managed_category,
            }),
          }))
          .sort((a: any, b: any) => String(a.car_number).localeCompare(String(b.car_number))),
      });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/browse/group", async (req: Request, res: Response) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const kind = String(req.query.kind ?? "").trim();
      const key = String(req.query.key ?? "").trim();
      if (kind !== "lessee" && kind !== "entity") {
        return res.status(400).json({ message: "kind must be lessee or entity" });
      }
      if (!key) return res.status(400).json({ message: "key is required" });
      res.json(await browseGroup(kind, key));
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/browse/ol", async (req: Request, res: Response) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const code = String(req.query.code ?? "").trim();
      if (!code) return res.status(400).json({ message: "code is required" });
      const lessee = String(req.query.lessee ?? "").trim() || undefined;
      const entity = String(req.query.entity ?? "").trim() || undefined;
      res.json(await browseOl(code, { lessee, entity }));
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/browse/turning50", async (req: Request, res: Response) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const year = Number(req.query.year);
      if (!Number.isFinite(year) || year < 1900 || year > 2100) {
        return res.status(400).json({ message: "year is required" });
      }
      const ol = String(req.query.ol ?? "").trim() || undefined;
      res.json(await browseTurning50(year, ol));
    } catch (err) {
      errHandler(res, err);
    }
  });

}
