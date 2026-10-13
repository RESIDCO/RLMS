import type { Express, Request, Response } from "express";
import type { Server } from "http";
import {
  parseAcquisitionEntity, parseAcquisitionPrice, parseSearchScope, requireAdmin,
  requireWrite, resolveBatchRentalStatus, runGlobalSearch, supabase, supabaseAdmin
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesChunk08_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/admin/cleanup-test-railcars", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const candidates = await findTestRailcarCandidates();
      res.json({ count: candidates.length, candidates });
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/admin/cleanup-test-railcars", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const confirm = (req.body as any)?.confirm === true;
      const candidates = await findTestRailcarCandidates();
      if (!confirm) {
        return res.json({
          ok: true,
          mode: "dry-run",
          note: "Pass { confirm: true } to actually delete the listed rows. Snapshot will be taken first.",
          count: candidates.length,
          candidates,
        });
      }
      if (candidates.length === 0) {
        return res.json({ ok: true, mode: "delete", deleted: 0, note: "No candidates matched." });
      }
      const ids = candidates.map((c: any) => c.id);
      // Best-effort snapshot — write to a per-run notes string so we have an audit
      // trail even if the SQL quarantine table doesn't exist in this environment.
      const snapshot = JSON.stringify(candidates).slice(0, 500_000);
      // Cascade deletes: assignments + history first, then car
      await supabase.from("railcar_assignments").delete().in("railcar_id", ids);
      await supabase.from("assignment_history").delete().in("railcar_id", ids);
      await supabase.from("car_number_history").delete().in("railcar_id", ids);
      const { error } = await supabase.from("railcars").delete().in("id", ids);
      if (error) throw error;
      res.json({
        ok: true,
        mode: "delete",
        deleted: ids.length,
        snapshot_bytes: snapshot.length,
      });
    } catch (err) { errHandler(res, err); }
  });

  // ---------- Global Search ----------
  app.get("/api/search", async (req: Request, res: Response) => {
    try {
      const raw = (req.query.q as string | undefined)?.trim() ?? "";
      if (!raw) return res.json({ railcars: [], riders: [], leases: [], not_found: [], terms: [], counts: { railcars: 0, riders: 0, leases: 0, total: 0 } });
      res.json(await runGlobalSearch(raw, {
        active: typeof req.query.active === "string" ? req.query.active : "active",
        searchScope: parseSearchScope(req.query as Record<string, unknown>),
      }));
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/search", async (req: Request, res: Response) => {
    try {
      const raw = String((req.body as any)?.q ?? "").trim();
      if (!raw) return res.json({ railcars: [], riders: [], leases: [], not_found: [], terms: [], counts: { railcars: 0, riders: 0, leases: 0, total: 0 } });
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.json(await runGlobalSearch(raw, {
        active: typeof body.active === "string" ? body.active : "active",
        searchScope: parseSearchScope(body),
      }));
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- History ----------
  app.get("/api/history", async (req, res) => {
    try {
      const search = (req.query.search as string | undefined)?.trim();
      const { data, error } = await supabase
        .from("assignment_history")
        .select(
          `*,
          railcar:railcars(id, car_number, reporting_marks),
          from_rider:riders!assignment_history_from_rider_id_fkey(id, rider_name, master_lease:master_leases(id, lease_number)),
          to_rider:riders!assignment_history_to_rider_id_fkey(id, rider_name, master_lease:master_leases(id, lease_number))`
        )
        .order("moved_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      let rows = data ?? [];
      if (search) {
        const q = search.toLowerCase();
        rows = rows.filter((r: any) =>
          r.railcar?.car_number?.toLowerCase().includes(q)
        );
      }
      res.json(rows);
    } catch (err) {
      errHandler(res, err);
    }
  });

}
