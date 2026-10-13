import type { Express, Request, Response } from "express";
import type { Server } from "http";
import {
  addNote, getAuthUser, getUserRole, isValidRole, listActivityLog, normalizeEmail,
  requireAdmin, requireUser, requireWrite, supabase, supabaseAdmin, type AppRole
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesPart5_p2(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/admin/users/invite", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const { email: rawEmail, role } = req.body as { email: string; role: AppRole };
      if (!rawEmail || !isValidRole(role)) return res.status(400).json({ error: "email and valid role required" });
      const email = normalizeEmail(rawEmail);
      // Public app origin for invite/magic-link redirects — never use VITE_API_BASE
      // (that is often "" for same-origin API and previously fell back to a stale host).
      const appUrl =
        process.env.APP_URL ||
        process.env.SITE_URL ||
        "https://rlms-d6kb.onrender.com";

      // Try the standard invite first
      const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: appUrl,
      });

      // If user already exists in auth, fall back to generateLink (resend)
      if (inviteErr) {
        const isAlreadyRegistered =
          inviteErr.message.toLowerCase().includes("already registered") ||
          inviteErr.message.toLowerCase().includes("already been invited") ||
          inviteErr.message.toLowerCase().includes("user already exists") ||
          inviteErr.status === 422;

        if (!isAlreadyRegistered) {
          return res.status(400).json({ error: `Invite failed: ${inviteErr.message}` });
        }

        // User already exists — generate a fresh magic link and email it
        const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: { redirectTo: appUrl },
        });
        if (linkErr) {
          return res.status(400).json({ error: `Resend failed: ${linkErr.message}` });
        }
        const saved = await saveUserRole({ email, role, userId: linkData.user?.id ?? null });
        return res.json({ id: saved.id, user_id: saved.user_id, email, role, resent: true });
      }

      const userId = inviteData.user?.id;
      if (!userId) return res.status(500).json({ error: "User ID missing after invite" });
      const saved = await saveUserRole({ email, role, userId });
      res.json({ id: saved.id, user_id: saved.user_id, email, role, resent: false });
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/admin/users/grant — Microsoft-only allowlist, no email sent (admin only)
  app.post("/api/admin/users/grant", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const { email: rawEmail, role } = req.body as { email: string; role: AppRole };
      if (!rawEmail || !isValidRole(role)) return res.status(400).json({ error: "email and valid role required" });
      const saved = await saveUserRole({ email: rawEmail, role });
      res.json({ id: saved.id, user_id: saved.user_id, email: saved.email, role: saved.role });
    } catch (err) { errHandler(res, err); }
  });

  // PATCH /api/admin/users/:userId/role — change a user's role (admin only)

}
