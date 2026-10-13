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

export async function registerRoutesChunk04_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/riders/resolve", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const raw = String(req.body?.label ?? req.body?.rider_name ?? "").trim();
      if (!raw) return res.status(400).json({ message: "label is required" });

      const riders = await fetchAllRows((from, to) =>
        supabase
          .from("riders")
          .select("id, rider_name, schedule_number, master_lease_id")
          .order("id", { ascending: true })
          .range(from, to)
      );
      const upper = raw.toUpperCase();
      const asId = Number(raw);
      const match =
        (Number.isFinite(asId) && asId > 0
          ? riders.find((r: any) => r.id === asId)
          : undefined) ??
        riders.find(
          (r: any) =>
            String(r.rider_name ?? "").trim().toUpperCase() === upper ||
            String(r.schedule_number ?? "").trim().toUpperCase() === upper
        );
      if (match) {
        return res.json({ id: match.id, rider_name: match.rider_name, created: false });
      }

      const AD_HOC_LEASE = "AD-HOC-OL";
      let { data: mla } = await supabase
        .from("master_leases")
        .select("id")
        .eq("lease_number", AD_HOC_LEASE)
        .maybeSingle();
      if (!mla) {
        const { data: created, error: mErr } = await supabase
          .from("master_leases")
          .insert({
            lease_number: AD_HOC_LEASE,
            lessor: "RESIDCO",
            lessee: "Ad Hoc / Free-text OL",
            account_id: await ensureAccountForLessee("Ad Hoc / Free-text OL"),
            // lease_type left null — set in Lease Management
          })
          .select("id")
          .single();
        if (mErr) throw mErr;
        mla = created;
      }

      const { data: inserted, error: rErr } = await supabase
        .from("riders")
        .insert({
          master_lease_id: mla!.id,
          rider_name: raw,
          schedule_number: raw,
          // riders.account_manager is deprecated / unused
        })
        .select("id, rider_name")
        .single();
      if (rErr) throw rErr;
      res.json({ id: inserted.id, rider_name: inserted.rider_name, created: true });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/riders", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const parsed = insertRiderSchema.parse(req.body);
      nullifyEmptyDateStrings(parsed as Record<string, unknown>, [...RIDER_DATE_KEYS]);
      delete (parsed as { account_manager?: unknown }).account_manager;
      delete (parsed as { status_tag?: unknown }).status_tag;
      delete (parsed as { account_mgmt_comment?: unknown }).account_mgmt_comment;
      const { data, error } = await supabase
        .from("riders")
        .insert(parsed)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.patch("/api/riders/:id", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const id = Number(req.params.id);
      const parsed = insertRiderSchema.partial().parse(req.body);
      nullifyEmptyDateStrings(parsed as Record<string, unknown>, [...RIDER_DATE_KEYS]);
      delete (parsed as { account_manager?: unknown }).account_manager;
      delete (parsed as { status_tag?: unknown }).status_tag;
      delete (parsed as { account_mgmt_comment?: unknown }).account_mgmt_comment;
      const { data, error } = await supabase
        .from("riders")
        .update(parsed)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.delete("/api/riders/:id", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const id = Number(req.params.id);
      const { data: assigns } = await supabase
        .from("railcar_assignments")
        .select("id")
        .eq("rider_id", id);
      if ((assigns ?? []).length > 0) {
        return res
          .status(400)
          .json({ message: "Cannot delete: rider has cars assigned" });
      }
      const { error } = await supabase.from("riders").delete().eq("id", id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Assignments ----------
}
