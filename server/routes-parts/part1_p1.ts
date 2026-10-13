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

export async function registerRoutesPart1_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.patch("/api/railcars/:id", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const id = Number(req.params.id);
      const inactiveReason =
        typeof req.body?.inactive_change_reason === "string"
          ? req.body.inactive_change_reason
          : null;
      const parsed = insertRailcarSchema.partial().parse(req.body);
      nullifyEmptyDateStrings(parsed as Record<string, unknown>, [...RAILCAR_DATE_KEYS]);
      const flag = parsed.ops_flag;
      const updateRow: Record<string, unknown> = omitOpsFlagFields({ ...parsed });
      // Identity changes go through POST /change-number only. Echoing an unchanged
      // (or unpadded) car_number on Edit would fire the pad trigger and collide.
      delete updateRow.car_number;
      delete updateRow.reporting_marks;
      delete updateRow.car_initial;

      // Rental Status must never flip active / active_status / Car Status as a side effect.
      if (parsed.fleet_status) {
        updateRow.fleet_status = parsed.fleet_status;
        updateRow.fleet_status_source = "manual";
      }

      let priorStatus: string | null | undefined;
      let priorActive: boolean | null | undefined;
      let crossedInactive = false;

      // Never let casual PATCH bodies flip fleet membership except via Car Status save.
      delete updateRow.active;
      delete updateRow.active_status;
      delete updateRow.active_source;

      if (parsed.status !== undefined) {
        const { data: current, error: curErr } = await supabase
          .from("railcars")
          .select("status, active")
          .eq("id", id)
          .single();
        if (curErr) throw curErr;
        priorStatus = current?.status;
        priorActive = current?.active;
        try {
          assertInactivePatchAllowed({
            currentStatus: priorStatus,
            nextStatus: parsed.status,
            reason: inactiveReason,
          });
        } catch (e: any) {
          if (e?.status === 400) return res.status(400).json({ message: e.message });
          throw e;
        }
        crossedInactive = crossesInactiveBoundary(priorStatus, parsed.status);
        Object.assign(updateRow, patchFieldsForStatusChange(priorStatus, String(parsed.status ?? "")));
      }

      const { data, error } = await supabase
        .from("railcars")
        .update(updateRow)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      if (parsed.status !== undefined && updateRow.active !== undefined && priorActive !== updateRow.active) {
        await syncCurrentAssignmentHistoryActive(id, updateRow.active === true);
      }

      if (crossedInactive && String(inactiveReason ?? "").trim()) {
        await writeCarStatusHistoryRow({
          carId: id,
          fromStatus: priorStatus,
          toStatus: String((updateRow.status as string) ?? parsed.status),
          reason: String(inactiveReason),
          userId: writerId,
        });
      }

      if (flag !== undefined) await persistOpsFlag([id], flag);
      res.json(hydrateOpsFlag({ ...data, ops_flag: flag !== undefined ? flag : (data as any).ops_flag }));
    } catch (err) {
      errHandler(res, err);
    }
  });

  // Remark: retire old identity, insert new active identity (one DB transaction).
  // Editor/admin only (requireWrite). RPC is service_role-only; viewers cannot call it.
}
