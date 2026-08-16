/**
 * Application-layer API auth (Bearer Supabase JWT).
 * Separate from database RLS — this blocks unauthenticated HTTP access to /api/*.
 */
import type { Request, Response, NextFunction } from "express";
import { supabase, supabaseAdmin } from "./supabase";

export type AuthUser = { id: string; email: string };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getAuthUser(req: Request): Promise<AuthUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  if (!token) return null;
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return { id: user.id, email: user.email ?? "" };
}

/**
 * Resolve the app role from user_roles. Microsoft (and invite) users are
 * authorized by email; user_id is tried first so existing password accounts
 * stay on the fast path. Never inserts a row.
 */
export async function getUserRole(user: { id: string; email?: string | null }): Promise<string | null> {
  const { data: byId } = await supabase
    .from("user_roles")
    .select("id, role, user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (byId?.role) return byId.role;

  const email = user.email ? normalizeEmail(user.email) : "";
  if (!email) return null;

  const { data: rows } = await supabase
    .from("user_roles")
    .select("id, role, user_id")
    .ilike("email", email)
    .limit(1);
  const row = rows?.[0];
  if (!row?.role) return null;

  // First Microsoft sign-in against a Grant-access row: attach auth.users.id.
  if (!row.user_id) {
    await supabaseAdmin
      .from("user_roles")
      .update({ user_id: user.id, email })
      .eq("id", row.id)
      .is("user_id", null);
  }
  return row.role;
}

function isAuthMeRequest(req: Request): boolean {
  const p = (req.originalUrl || req.url || req.path).split("?")[0];
  return p === "/api/auth/me" || p === "/auth/me" || p.endsWith("/auth/me");
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      authRole?: string | null;
    }
  }
}

/**
 * Reject unauthenticated /api requests with 401.
 * Requests other than GET /api/auth/me also need a user_roles row (403 if missing).
 * /api/auth/me is allowed through with no role so the client can sign the user out
 * and show the not-authorized message — it must not create a user_roles row.
 */
export async function requireApiAuth(req: Request, res: Response, next: NextFunction) {
  if (req.method === "OPTIONS") return next();
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.authUser = user;
    req.authRole = await getUserRole(user);
    if (!isAuthMeRequest(req) && !req.authRole) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  } catch (err) {
    console.error("[requireApiAuth]", err);
    return res.status(401).json({ error: "Unauthorized" });
  }
}
