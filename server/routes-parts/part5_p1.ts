import type { Express, Request, Response } from "express";
import type { Server } from "http";
import {
  addNote, getAuthUser, getUserRole, isValidRole, listActivityLog, normalizeEmail,
  requireAdmin, requireUser, requireWrite, supabase, supabaseAdmin, type AppRole
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesPart5_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/prefs/columns", async (req: Request, res: Response) => {
    try {
      const user = req.authUser ?? (await getAuthUser(req));
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const page = String(req.query.page ?? "").trim();
      if (!page) return res.status(400).json({ error: "page param required" });

      const { data } = await supabase
        .from("user_column_prefs")
        .select("visible_cols")
        .eq("user_id", user.id)
        .eq("page", page)
        .single();

      res.json({ visible_cols: data?.visible_cols ?? null });
    } catch (err) { errHandler(res, err); }
  });

  // PUT /api/prefs/columns — upsert visible_cols for the current user + page
  app.put("/api/prefs/columns", async (req: Request, res: Response) => {
    try {
      const user = req.authUser ?? (await getAuthUser(req));
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const { page, visible_cols } = req.body as { page: string; visible_cols: unknown };
      if (!page) return res.status(400).json({ error: "page required" });
      const prefsOk =
        Array.isArray(visible_cols) ||
        (visible_cols != null &&
          typeof visible_cols === "object" &&
          Array.isArray((visible_cols as { cols?: unknown }).cols));
      if (!prefsOk) return res.status(400).json({ error: "visible_cols must be an array or { cols, order, widths }" });

      const { error } = await supabase
        .from("user_column_prefs")
        .upsert(
          { user_id: user.id, page, visible_cols, updated_at: new Date().toISOString() },
          { onConflict: "user_id,page" }
        );
      if (error) throw error;

      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  // GET /api/admin/users — list all users with roles (admin only)
  app.get("/api/admin/users", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      // Join user_roles with auth.users email via a view-friendly RPC approach
      // We store email in user_roles at invite time so we can query it directly
      const { data, error } = await supabase
        .from("user_roles")
        .select("id, user_id, role, email, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      res.json((data ?? []).map((r: any) => ({
        id: r.id,
        user_id: r.user_id ?? null,
        email: r.email ?? "unknown",
        role: r.role,
        created_at: r.created_at,
      })));
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/admin/users/invite — invite a new user OR resend invite to existing (admin only)
}
