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

export async function registerRoutesChunk03_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/railcars/bulk-change-number", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const itemsIn = Array.isArray(req.body?.items) ? req.body.items : [];
      const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
      const changed_by = typeof req.body?.changed_by === "string" ? req.body.changed_by : null;
      const items: { id: number; reporting_marks: string; car_number: string }[] = [];
      for (const raw of itemsIn) {
        const id = Number(raw?.id);
        const parsed = normalizeMarkAndNumber(raw?.new_car_number ?? `${raw?.reporting_marks ?? ""} ${raw?.car_number ?? ""}`);
        if (!Number.isFinite(id) || id <= 0) {
          return res.status(400).json({ message: "Each item needs a railcar id" });
        }
        if (!parsed.ok) return res.status(400).json({ message: parsed.message });
        if (!parsed.reporting_marks) {
          return res.status(400).json({ message: "Enter a mark and number (e.g. OFCX 349699)" });
        }
        items.push({ id, reporting_marks: parsed.reporting_marks, car_number: parsed.car_number });
      }
      if (!items.length) return res.status(400).json({ message: "No cars to remark" });
      const { data, error } = await supabaseAdmin.rpc("remark_railcars", {
        p_items: items,
        p_reason: reason,
        p_changed_by: changed_by ?? req.authUser?.email ?? "system",
      });
      if (error) throw error;
      const out = data as {
        ok?: boolean;
        error?: string;
        conflicts?: Parameters<typeof remarkConflictsHttp>[0];
        results?: unknown[];
      };
      if (!out?.ok) {
        if (out?.conflicts?.length) {
          const http = remarkConflictsHttp(out.conflicts);
          return res.status(http.status).json(http.body);
        }
        return res.status(400).json({ message: out?.error || "Remark failed" });
      }
      res.json({ ok: true, results: out.results ?? [] });
    } catch (err) { errHandler(res, err); }
  });

  app.delete("/api/railcars/:id", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const id = Number(req.params.id);
      const { data: assignments, error: aErr } = await supabase
        .from("railcar_assignments")
        .select("id")
        .eq("railcar_id", id);
      if (aErr) throw aErr;
      if ((assignments ?? []).length > 0) {
        return res
          .status(400)
          .json({ message: "Cannot delete: railcar has an active assignment" });
      }
      const { error } = await supabase.from("railcars").delete().eq("id", id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Leases (Master + nested riders) ----------
  app.get("/api/leases", async (_req, res) => {
    try {
      const [leasesRes, ridersRes, countByRider, activeByRider] = await Promise.all([
        supabase.from("master_leases").select("*").order("lease_number"),
        supabase.from("riders").select("*").order("rider_name"),
        countCarsByRiderId(),
        countActiveCarsByRiderId(),
      ]);
      if (leasesRes.error) throw leasesRes.error;
      if (ridersRes.error) throw ridersRes.error;

      const riders = (ridersRes.data ?? []).map((r) => {
        const car_count = countByRider.get(r.id) ?? 0;
        const active_car_count = activeByRider.get(r.id) ?? 0;
        const { account_manager: _deprecatedRiderAm, ...rest } = r as any;
        return {
          ...rest,
          car_count,
          active_car_count,
          is_inactive: active_car_count === 0,
        };
      });

      const amByAccount = await accountManagerByAccountIds(
        (leasesRes.data ?? []).map((l: any) => Number(l.account_id)).filter((n) => n > 0),
      );

      const result = (leasesRes.data ?? []).map((l) => {
        const leaseRiders = riders.filter((r) => r.master_lease_id === l.id);
        const active_car_count = leaseRiders.reduce(
          (acc, r) => acc + (r.active_car_count ?? 0),
          0
        );
        const total_car_count = leaseRiders.reduce(
          (acc, r) => acc + (r.car_count ?? 0),
          0
        );
        const is_inactive =
          leaseRiders.length === 0 || leaseRiders.every((r) => r.is_inactive);
        const accountId = (l as any).account_id ?? null;
        return {
          ...l,
          account_manager: accountId ? amByAccount.get(accountId) ?? null : null,
          riders: leaseRiders,
          car_count: active_car_count,
          active_car_count,
          total_car_count,
          is_inactive,
        };
      });

      res.json(result);
    } catch (err) {
      errHandler(res, err);
    }
  });

}
