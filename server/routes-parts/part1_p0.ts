import type { Express } from "express";
import type { Server } from "http";
import {
  RAILCAR_DATE_KEYS, asOne, assertInactivePatchAllowed, attachAccountManagerInitials,
  attachLatestAmNotes, autoFleetStatusFromLegacyText, changeCarNumberSchema,
  conflictResponse, crossesInactiveBoundary, fieldsImpliedByCarStatus,
  findCarNumberConflict, hydrateOpsFlag, insertRailcarSchema, normalizeMarkAndNumber,
  nullifyEmptyDateStrings, omitOpsFlagFields, patchFieldsForStatusChange,
  persistOpsFlag, remarkConflictsHttp, requireWrite, supabase, supabaseAdmin,
  syncCurrentAssignmentHistoryActive, writeCarStatusHistoryRow
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesPart1_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/railcars/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { data: car, error } = await supabase
        .from("railcars")
        .select(
          `*,
          assignment:railcar_assignments(
            *,
            rider:riders(*, master_lease:master_leases(*))
          )`
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;

      const [histRes, numHistRes, abRes] = await Promise.all([
        supabase
          .from("assignment_history")
          .select(
            `*,
            from_rider:riders!assignment_history_from_rider_id_fkey(id, rider_name, master_lease:master_leases(id, lease_number)),
            to_rider:riders!assignment_history_to_rider_id_fkey(id, rider_name, master_lease:master_leases(id, lease_number))`
          )
          .eq("railcar_id", id)
          .order("moved_at", { ascending: false }),
        supabase
          .from("car_number_history")
          .select("*")
          .eq("railcar_id", id)
          .order("changed_at", { ascending: false }),
        supabase
          .from("railcar_ab_items")
          .select("seq, code, amount, sign, signed_amount, application_date")
          .eq("railcar_id", id)
          .order("seq", { ascending: true }),
      ]);
      if (histRes.error) throw histRes.error;
      if (numHistRes.error) throw numHistRes.error;

      if (!car) return res.status(404).json({ message: "Railcar not found" });
      const assignmentRaw = asOne(car.assignment);
      const rider = asOne(assignmentRaw?.rider);
      const [normalized] = await attachLatestAmNotes(await attachAccountManagerInitials([
        hydrateOpsFlag({
          ...car,
          assignment: assignmentRaw
            ? { ...assignmentRaw, rider: rider ? { ...rider, master_lease: asOne(rider.master_lease) } : null }
            : null,
          railcar_ab_items: abRes.error ? [] : (abRes.data ?? []),
        }),
      ]));
      res.json({ railcar: normalized, history: histRes.data ?? [], number_history: numHistRes.data ?? [] });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/railcars", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const parsed = insertRailcarSchema.parse(req.body);
      nullifyEmptyDateStrings(parsed as Record<string, unknown>, [...RAILCAR_DATE_KEYS]);
      const createConflict = await findCarNumberConflict({
        car_number: String(parsed.car_number),
        reporting_marks: parsed.reporting_marks ?? null,
      });
      if (createConflict) return res.status(400).json(conflictResponse(createConflict));
      const flag = parsed.ops_flag;
      const insertRow: Record<string, unknown> = omitOpsFlagFields({ ...parsed });
      if (parsed.fleet_status) {
        insertRow.fleet_status = parsed.fleet_status;
        insertRow.fleet_status_source = "manual";
      } else {
        insertRow.fleet_status = autoFleetStatusFromLegacyText(parsed);
        insertRow.fleet_status_source = "auto";
      }
      Object.assign(insertRow, fieldsImpliedByCarStatus(String(parsed.status ?? "Active/In-Service")));
      const { data, error } = await supabase
        .from("railcars")
        .insert(insertRow)
        .select()
        .single();
      if (error) {
        const raced = await findCarNumberConflict({
          car_number: String(parsed.car_number),
          reporting_marks: parsed.reporting_marks ?? null,
        });
        if (raced) return res.status(400).json(conflictResponse(raced));
        throw error;
      }
      if (flag) await persistOpsFlag([data.id], flag);
      res.json(hydrateOpsFlag({ ...data, ops_flag: flag ?? null }));
    } catch (err) {
      errHandler(res, err);
    }
  });

}
