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

export async function registerRoutesChunk00_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/setup-lease", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { mla, riders: riderPayloads } = req.body as {
        mla: Record<string, any>;
        riders: Array<{
          rider: Record<string, any>;
          cars: Array<Record<string, any>>; // new car objects to create
          existing_car_ids: number[];        // already-in-DB cars to assign
          fleet_name?: string;
          contact?: Record<string, unknown>;
        }>;
      };

      // 1. Create MLA (lease_type only if human set it in the wizard — never invent a default)
      const mlaRow = { ...mla };
      delete mlaRow.account_id;
      if (mlaRow.lease_type != null && String(mlaRow.lease_type).trim() === "") {
        mlaRow.lease_type = null;
      }
      mlaRow.account_id = await ensureAccountForLessee(mlaRow.lessee ?? null);
      const { data: newMla, error: mlaErr } = await supabase
        .from("master_leases")
        .insert(mlaRow)
        .select()
        .single();
      if (mlaErr) throw mlaErr;

      const now = new Date().toISOString();
      const riderResults: any[] = [];

      for (const rp of riderPayloads ?? []) {
        // 2. Create rider under this MLA (do not write deprecated riders.account_manager)
        const riderInsert = { ...rp.rider, master_lease_id: newMla.id };
        delete riderInsert.account_manager;
        const { data: newRider, error: rErr } = await supabase
          .from("riders")
          .insert(riderInsert)
          .select()
          .single();
        if (rErr) throw rErr;

        const carIds: number[] = [...(rp.existing_car_ids ?? [])];

        // 3. Create new railcars
        for (const carObj of rp.cars ?? []) {
          const num = normalizeStoredCarNumber(carObj.car_number);
          if (!num.ok) {
            return res.status(400).json({ message: num.message });
          }
          const marks = carObj.reporting_marks ?? null;
          const conflict = await findCarNumberConflict({
            car_number: num.car_number,
            reporting_marks: marks,
          });
          if (conflict) return res.status(400).json(conflictResponse(conflict));
          const { data: newCar, error: cErr } = await supabase
            .from("railcars")
            .insert({
              ...carObj,
              car_number: num.car_number,
              ...fieldsImpliedByCarStatus(carObj.status ?? "Active/In-Service"),
            })
            .select()
            .single();
          if (cErr) throw cErr;
          carIds.push(newCar.id);
        }

        // 4. Assign all cars to this rider
        if (carIds.length > 0) {
          // Fetch existing assignments so we can upsert
          const { data: existingAssigns } = await supabase
            .from("railcar_assignments")
            .select("id, railcar_id")
            .in("railcar_id", carIds);
          const alreadyAssigned = new Map<number, number>(
            (existingAssigns ?? []).map((a: any) => [a.railcar_id, a.id])
          );

          for (const carId of carIds) {
            const existingId = alreadyAssigned.get(carId);
            if (existingId) {
              await supabase
                .from("railcar_assignments")
                .update({ rider_id: newRider.id, fleet_name: rp.fleet_name ?? null, assigned_at: now })
                .eq("id", existingId);
              await pointCurrentAssignmentAt(supabase, [{ id: existingId, railcar_id: carId }]);
            } else {
              const { data: ins, error: iErr } = await supabase
                .from("railcar_assignments")
                .insert({ railcar_id: carId, rider_id: newRider.id, fleet_name: rp.fleet_name ?? null, assigned_at: now })
                .select("id, railcar_id")
                .single();
              if (iErr) throw iErr;
              await pointCurrentAssignmentAt(supabase, ins ? [ins] : []);
            }
          }
        }

        riderResults.push({ rider: newRider, car_count: carIds.length });

        const contactName = String(rp.contact?.name ?? "").trim();
        if (contactName) {
          await createContactOnRider(newRider.id, rp.contact ?? {}, writerId);
        }
      }

      res.json({ ok: true, mla: newMla, riders: riderResults });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  // ---------- Dashboard ----------

}
