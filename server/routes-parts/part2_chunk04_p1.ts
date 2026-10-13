import type { Express } from "express";
import type { Server } from "http";
import {
  RIDER_DATE_KEYS, effectiveDateToTimestamp, ensureAccountForLessee, fetchAllRows,
  insertRiderSchema, listAllDirectoryLeasePeople, listCarsAssignedToRider,
  listContactsForRider, logActivity, moveCarsSchema, nullifyEmptyDateStrings,
  pointCurrentAssignmentAt, promoteLegacyRiderContacts, requireContactsWrite,
  requireUser, requireWrite, supabase
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesChunk04_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/assignments", async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from("railcar_assignments")
        .select(
          `*, railcar:railcars(id, car_number, reporting_marks, status),
           rider:riders(id, rider_name, schedule_number, master_lease:master_leases(id, lease_number))`
        )
        .order("assigned_at", { ascending: false });
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Move cars ----------
  app.post("/api/move", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const input = moveCarsSchema.parse(req.body);
      const { car_ids, to_rider_id, new_fleet_name, reason, moved_by, effective_date } = input;

      // verify destination rider exists
      const { data: toRider, error: rErr } = await supabase
        .from("riders")
        .select("id, rider_name")
        .eq("id", to_rider_id)
        .single();
      if (rErr) throw rErr;
      if (!toRider)
        return res.status(400).json({ message: "Destination rider not found" });

      // fetch current assignments for each car
      const { data: currentAssigns, error: caErr } = await supabase
        .from("railcar_assignments")
        .select("id, railcar_id, rider_id, fleet_name")
        .in("railcar_id", car_ids);
      if (caErr) throw caErr;
      const currentByCar = new Map<number, any>();
      for (const a of currentAssigns ?? []) currentByCar.set(a.railcar_id, a);

      const historyRows: any[] = [];
      const movedAt = effectiveDateToTimestamp(effective_date);

      for (const carId of car_ids) {
        const prev = currentByCar.get(carId);
        const fromRiderId = prev?.rider_id ?? null;
        const fromFleet = prev?.fleet_name ?? null;
        const targetFleet = new_fleet_name ?? fromFleet;

        if (prev) {
          const { error: uErr } = await supabase
            .from("railcar_assignments")
            .update({
              rider_id: to_rider_id,
              fleet_name: targetFleet,
              assigned_at: movedAt,
            })
            .eq("id", prev.id);
          if (uErr) throw uErr;
          await pointCurrentAssignmentAt(supabase, [{ id: prev.id, railcar_id: carId }]);
        } else {
          const { data: ins, error: iErr } = await supabase
            .from("railcar_assignments")
            .insert({
              railcar_id: carId,
              rider_id: to_rider_id,
              fleet_name: targetFleet,
              assigned_at: movedAt,
            })
            .select("id, railcar_id")
            .single();
          if (iErr) throw iErr;
          await pointCurrentAssignmentAt(supabase, ins ? [ins] : []);
        }

        historyRows.push({
          railcar_id: carId,
          from_rider_id: fromRiderId,
          to_rider_id: to_rider_id,
          from_fleet_name: fromFleet,
          to_fleet_name: targetFleet,
          moved_at: movedAt,
          moved_by: moved_by ?? "system",
          reason: reason ?? null,
        });
      }

      if (historyRows.length) {
        const { data: insertedHist, error: hErr } = await supabase
          .from("assignment_history")
          .insert(historyRows)
          .select("id, railcar_id, from_rider_id, to_rider_id, from_fleet_name, to_fleet_name, moved_at, moved_by, reason");
        if (hErr) throw hErr;
        const actor = moved_by ?? req.authUser?.email ?? "system";
        for (const h of insertedHist ?? []) {
          await logActivity({
            entity_type: "railcar",
            entity_id: h.railcar_id,
            railcar_id: h.railcar_id,
            rider_id: h.to_rider_id ?? null,
            action: "reassignment",
            actor,
            detail: {
              from_rider_id: h.from_rider_id,
              to_rider_id: h.to_rider_id,
              from_fleet: h.from_fleet_name,
              to_fleet: h.to_fleet_name,
              reason: h.reason,
            },
            occurred_at: h.moved_at,
            source_table: "assignment_history",
            source_id: h.id,
          });
        }
      }

      res.json({ ok: true, moved: car_ids.length });
    } catch (err) {
      errHandler(res, err);
    }
  });

  // GET /api/contacts — directory people linked to leases/OLs (plus leftover rider_contacts until promoted)
  app.get("/api/contacts", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listAllDirectoryLeasePeople());
    } catch (err) { errHandler(res, err); }
  });

}
