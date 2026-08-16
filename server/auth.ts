/**
 * Application-layer API auth (Bearer Supabase JWT).
 * Separate from database RLS — this blocks unauthenticated HTTP access to /api/*.
 */
import type { Request, Response, NextFunction } from "express";
import { supabase } from "./supabase";

export type AuthUser = { id: string; email: string };

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
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (byId?.role) return byId.role;

  const email = user.email?.trim();
  if (!email) return null;

  const { data: rows } = await supabase
    .from("user_roles")
    .select("role")
    .ilike("email", email)
    .limit(1);
  return rows?.[0]?.role ?? null;
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
