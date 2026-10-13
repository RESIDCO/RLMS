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

export async function registerRoutesPart1_p2(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/railcars/:id/change-number", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const id = Number(req.params.id);
      const { new_car_number, reason, changed_by } = changeCarNumberSchema.parse(req.body);
      const split = normalizeMarkAndNumber(new_car_number);
      if (!split.ok) {
        return res.status(400).json({ message: split.message });
      }
      if (!split.reporting_marks) {
        return res.status(400).json({ message: "Enter a mark and number (e.g. OFCX 349699)" });
      }
      const { data, error } = await supabaseAdmin.rpc("remark_railcars", {
        p_items: [{ id, reporting_marks: split.reporting_marks, car_number: split.car_number }],
        p_reason: reason ?? null,
        p_changed_by: changed_by ?? req.authUser?.email ?? "system",
      });
      if (error) throw error;
      const out = data as {
        ok?: boolean;
        error?: string;
        conflicts?: Parameters<typeof remarkConflictsHttp>[0];
        results?: Array<Record<string, unknown>>;
      };
      if (!out?.ok) {
        if (out?.conflicts?.length) {
          const http = remarkConflictsHttp(out.conflicts);
          return res.status(http.status).json(http.body);
        }
        return res.status(400).json({ message: out?.error || "Remark failed" });
      }
      const row = out.results?.[0] ?? {};
      res.json({
        ok: true,
        old_id: row.old_id,
        new_id: row.new_id,
        old_car_initial: row.old_car_initial,
        old_car_number: row.old_car_number,
        new_car_initial: row.new_car_initial,
        new_car_number: row.new_car_number,
      });
    } catch (err) { errHandler(res, err); }
  });

  // Bulk remark: same RPC, all-or-none. One optional shared comment. Editor/admin only.

}
