import type { Express, Request, Response } from "express";
import type { Server } from "http";
import {
  addNote, getAuthUser, getUserRole, isValidRole, listActivityLog, normalizeEmail,
  requireAdmin, requireUser, requireWrite, supabase, supabaseAdmin, type AppRole
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesPart5_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/activity", async (req, res) => {
    try {
      const railcarId = req.query.railcar_id ? Number(req.query.railcar_id) : undefined;
      const riderId = req.query.rider_id ? Number(req.query.rider_id) : undefined;
      const qRaw = req.query.q;
      const q = qRaw == null || qRaw === ""
        ? undefined
        : String(Array.isArray(qRaw) ? qRaw[0] : qRaw).trim() || undefined;
      const includeVcf = req.query.include_vcf === "1" || req.query.include_vcf === "true";
      const result = await listActivityLog({
        railcarId: Number.isFinite(railcarId) ? railcarId : undefined,
        riderId: Number.isFinite(riderId) ? riderId : undefined,
        q,
        includeVcfNoise: includeVcf,
        limit: Number.isFinite(riderId) && !Number.isFinite(railcarId) ? 80 : undefined,
      });
      res.json(result);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/activity/notes", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const entity_type = req.body?.entity_type === "rider" ? "rider" : "railcar";
      const entity_id = Number(req.body?.entity_id);
      const body = String(req.body?.body ?? "");
      if (!Number.isFinite(entity_id) || entity_id <= 0) {
        return res.status(400).json({ message: "entity_id is required" });
      }
      const row = await addNote({
        entity_type,
        entity_id,
        body,
        actor: req.authUser?.email ?? "system",
      });
      res.status(201).json(row);
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // AUTH ROUTES
  // ─────────────────────────────────────────────────────────────

  // Role helpers (requireAdmin / requireWrite / requireUser / contacts) live in ./auth

  const VALID_ROLES = ["admin", "editor", "viewer"] as const;
  type AppRole = (typeof VALID_ROLES)[number];
  // isValidRole imported from ./auth

  /** Insert or update user_roles by email (lowercase). Never creates a duplicate. */
  async function saveUserRole(opts: {
    email: string;
    role: AppRole;
    userId?: string | null;
  }): Promise<{ id: string; email: string; role: AppRole; user_id: string | null }> {
    const email = normalizeEmail(opts.email);
    const { data: existing, error: findErr } = await supabaseAdmin
      .from("user_roles")
      .select("id, user_id, role, email")
      .ilike("email", email)
      .maybeSingle();
    if (findErr) throw findErr;

    if (existing) {
      const patch: Record<string, unknown> = { role: opts.role, email };
      if (opts.userId) patch.user_id = opts.userId;
      const { error } = await supabaseAdmin.from("user_roles").update(patch).eq("id", existing.id);
      if (error) throw error;
      return {
        id: existing.id,
        email,
        role: opts.role,
        user_id: (opts.userId ?? existing.user_id) as string | null,
      };
    }

    const insert: Record<string, unknown> = { email, role: opts.role, user_id: opts.userId ?? null };
    const { data: created, error } = await supabaseAdmin
      .from("user_roles")
      .insert(insert)
      .select("id, user_id, role, email")
      .single();
    if (error) throw error;
    return {
      id: created.id,
      email: created.email,
      role: created.role,
      user_id: created.user_id,
    };
  }

  async function findRoleRowByParam(param: string) {
    const { data: byPk } = await supabase
      .from("user_roles")
      .select("id, user_id, email, role")
      .eq("id", param)
      .maybeSingle();
    if (byPk) return byPk;
    const { data: byUser } = await supabase
      .from("user_roles")
      .select("id, user_id, email, role")
      .eq("user_id", param)
      .maybeSingle();
    return byUser;
  }

  // GET /api/auth/me — returns current user's role
  app.get("/api/auth/me", async (req, res) => {
    try {
      const user = req.authUser ?? (await getAuthUser(req));
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const role = req.authRole ?? (await getUserRole(user));
      res.json({ id: user.id, email: user.email, role: role ?? null });
    } catch (err) { errHandler(res, err); }
  });

  // ---------- Column Preferences ----------
  // GET /api/prefs/columns?page=<page> — returns visible_cols array for the current user + page
}
