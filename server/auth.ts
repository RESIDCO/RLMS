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

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

/**
 * Reject unauthenticated /api requests with 401.
 * Skips CORS preflight. No public data allowlist — every /api route needs a session.
 */
export async function requireApiAuth(req: Request, res: Response, next: NextFunction) {
  if (req.method === "OPTIONS") return next();
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.authUser = user;
    return next();
  } catch (err) {
    console.error("[requireApiAuth]", err);
    return res.status(401).json({ error: "Unauthorized" });
  }
}
