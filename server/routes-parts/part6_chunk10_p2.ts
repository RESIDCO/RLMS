import type { Express, Request, Response } from "express";
import type { Server } from "http";
import {
  genericUploadSource, getAuthUser, insertAttachmentRow, isAttachmentEntityType,
  isValidRole, logActivity, requireAdmin, requireContactsWrite, requireWrite, supabase,
  supabaseAdmin
} from "../routes-deps";
import {
  STORAGE_BUCKET, dvComputeFreshness, errHandler, upload
} from "../routes-lib";

export async function registerRoutesChunk10_p2(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/rent-events", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const { car_id, event_type, event_date, reason } = req.body;
      if (!car_id || !event_type || !event_date || !reason) {
        return res.status(400).json({ error: "car_id, event_type, event_date, and reason are required" });
      }
      if (!["on_rent", "off_rent"].includes(event_type)) {
        return res.status(400).json({ error: "event_type must be on_rent or off_rent" });
      }
      // Get user email for created_by
      const { data: userRow } = await supabase
        .from("user_roles")
        .select("email")
        .eq("user_id", userId)
        .single();
      const created_by = userRow?.email ?? userId;
      const { data, error } = await supabase
        .from("rent_events")
        .insert({ car_id: Number(car_id), event_type, event_date, reason: reason.trim(), created_by })
        .select()
        .single();
      if (error) throw error;
      await logActivity({
        entity_type: "railcar",
        entity_id: Number(car_id),
        railcar_id: Number(car_id),
        action: "rent_event",
        actor: created_by,
        detail: { event_type, event_date, reason: reason.trim() },
        occurred_at: `${event_date}T12:00:00.000Z`,
        source_table: "rent_events",
        source_id: data?.id ?? null,
      });
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  /* =======================================================   *  DV CALCULATOR (AAR Rule 107) \u2014 routes
   * ============================================================== */

  // Freshness banner
  app.get("/api/reference/freshness", async (_req, res) => {
    try {
      const result = await dvComputeFreshness();
      res.set("Cache-Control", "no-store");
      res.json(result);
    } catch (err) { errHandler(res, err); }
  });

  // Reference reads

}
