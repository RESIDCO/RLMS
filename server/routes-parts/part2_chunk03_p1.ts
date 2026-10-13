import type { Express } from "express";
import type { Server } from "http";
import {
  MASTER_LEASE_DATE_KEYS, accountManagerByAccountIds, buildLeaseReport,
  countActiveCarsByRiderId, countCarsByRiderId, ensureAccountForLessee,
  insertMasterLeaseSchema, normalizeMarkAndNumber, nullifyEmptyDateStrings,
  remarkConflictsHttp, requireAdmin, requireUser, requireWrite, supabase,
  supabaseAdmin
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesChunk03_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/leases/export", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const scopeAll = req.query.scope === "all" || req.query.all === "1" || req.query.all === "true";
      let ids = String(req.query.ids ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (scopeAll) {
        const { data, error } = await supabase.from("master_leases").select("id").order("lease_number");
        if (error) throw error;
        ids = (data ?? []).map((r: any) => Number(r.id)).filter((n) => n > 0);
      }
      const { buffer, filename } = await buildLeaseReport({ leaseIds: ids });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/leases", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const parsed = insertMasterLeaseSchema.parse(req.body);
      nullifyEmptyDateStrings(parsed as Record<string, unknown>, [...MASTER_LEASE_DATE_KEYS]);
      if (parsed.lease_type != null && String(parsed.lease_type).trim() === "") {
        parsed.lease_type = null;
      }
      const accountId = await ensureAccountForLessee(parsed.lessee ?? null);
      const { data, error } = await supabase
        .from("master_leases")
        .insert({ ...parsed, account_id: accountId })
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.patch("/api/leases/:id", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const id = Number(req.params.id);
      const parsed = insertMasterLeaseSchema.partial().parse(req.body);
      nullifyEmptyDateStrings(parsed as Record<string, unknown>, [...MASTER_LEASE_DATE_KEYS]);
      if (parsed.lease_type != null && String(parsed.lease_type).trim() === "") {
        parsed.lease_type = null;
      }
      const leasePatch: Record<string, unknown> = { ...parsed };
      if (parsed.lessee !== undefined) {
        leasePatch.account_id = await ensureAccountForLessee(parsed.lessee ?? null);
      }
      const { data, error } = await supabase
        .from("master_leases")
        .update(leasePatch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.delete("/api/leases/:id", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const id = Number(req.params.id);
      const { data: riders } = await supabase
        .from("riders")
        .select("id")
        .eq("master_lease_id", id);
      if ((riders ?? []).length > 0) {
        return res
          .status(400)
          .json({ message: "Cannot delete: master lease has riders" });
      }
      const { error } = await supabase
        .from("master_leases")
        .delete()
        .eq("id", id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Riders ----------
  app.get("/api/riders", async (_req, res) => {
    try {
      const [ridersRes, countByRider] = await Promise.all([
        supabaseAdmin
          .from("riders")
          .select("*, master_lease:master_leases(id, lease_number)")
          .order("rider_name", { ascending: true }),
        countActiveCarsByRiderId(),
      ]);
      if (ridersRes.error) throw ridersRes.error;
      const out = (ridersRes.data ?? []).map((r: any) => ({
        ...r,
        car_count: countByRider.get(r.id) ?? 0,
        active_car_count: countByRider.get(r.id) ?? 0,
      }));
      res.json(out);
    } catch (err) {
      errHandler(res, err);
    }
  });

  /** Resolve a free-text OL/rider label to an existing rider, or create one under an Ad Hoc MLA. */

}
