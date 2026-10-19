import type { Express, Request, Response } from "express";
import { supabaseAdmin } from "./supabase";
import { getAuthUser, getUserRole } from "./auth";
import {
  coalesceViewName,
  normalizeListKey,
  parsePrefsPayload,
} from "@shared/column-views";
import { categoryCarsListKey } from "@shared/program-tracker-sync";

type PrefRow = {
  id: number;
  user_id: string;
  page: string;
  list_key: string;
  view_name: string;
  is_default: boolean;
  is_shared: boolean;
  visible_cols: unknown;
  updated_at: string | null;
};

function errHandler(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
  res.status(status).json({ error: e.message ?? "Server error" });
}

function prefsOk(visible_cols: unknown): boolean {
  return (
    Array.isArray(visible_cols) ||
    (visible_cols != null &&
      typeof visible_cols === "object" &&
      Array.isArray((visible_cols as { cols?: unknown }).cols))
  );
}

async function loadMapped(listKey: string, userId?: string, sharedOnly = false): Promise<PrefRow[]> {
  let q = supabaseAdmin.from("v_user_column_prefs").select(
    "id, user_id, page, list_key, view_name, is_default, is_shared, visible_cols, updated_at",
  ).eq("list_key", listKey);
  if (sharedOnly) q = q.eq("is_shared", true);
  else if (userId) q = q.eq("user_id", userId).eq("is_shared", false);
  const { data, error } = await q.order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PrefRow[];
}

function pickRow(userRows: PrefRow[], sharedRows: PrefRow[], requested?: string): PrefRow | null {
  const name = requested ? coalesceViewName(requested) : "";
  if (name) {
    const hit =
      userRows.find((r) => coalesceViewName(r.view_name) === name) ??
      sharedRows.find((r) => coalesceViewName(r.view_name) === name);
    if (hit) return hit;
  }
  const userDefault = userRows.find((r) => r.is_default);
  if (userDefault) return userDefault;
  const sharedDefault = sharedRows.find((r) => r.is_default) ?? sharedRows[0] ?? null;
  if (sharedDefault) return sharedDefault;
  return userRows[0] ?? null;
}

function pageForListKey(listKey: string): string {
  return listKey.startsWith("program_cars") ? "program_cars" : listKey;
}

function viewMeta(rows: PrefRow[]) {
  const seen = new Set<string>();
  const out: { view_name: string; is_default: boolean; is_shared: boolean; updated_at: string | null }[] = [];
  for (const r of rows) {
    const view_name = coalesceViewName(r.view_name);
    const key = `${r.is_shared ? "s" : "u"}:${view_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      view_name,
      is_default: Boolean(r.is_default),
      is_shared: Boolean(r.is_shared),
      updated_at: r.updated_at,
    });
  }
  return out;
}

async function clearUserDefaults(userId: string, listKey: string, exceptId?: number) {
  const rows = await loadMapped(listKey, userId);
  const ids = rows.filter((r) => r.is_default && r.id !== exceptId).map((r) => r.id);
  if (!ids.length) return;
  const { error } = await supabaseAdmin.from("user_column_prefs").update({ is_default: false }).in("id", ids);
  if (error) throw error;
}

export function registerColumnPrefRoutes(app: Express) {
  app.get("/api/prefs/columns", async (req: Request, res: Response) => {
    try {
      const user = req.authUser ?? (await getAuthUser(req));
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const listKey = normalizeListKey(String(req.query.list_key ?? req.query.page ?? "").trim());
      if (!listKey) return res.status(400).json({ error: "list_key or page required" });
      const requested = req.query.view_name != null ? String(req.query.view_name) : "";
      const userRows = await loadMapped(listKey, user.id);
      let sharedRows = await loadMapped(listKey, undefined, true);
      const programScoped = /^program_cars:[0-9]+$/.test(listKey);
      if (programScoped && userRows.length === 0 && sharedRows.length === 0) {
        const categoryId = Number(req.query.category_id);
        if (Number.isFinite(categoryId) && categoryId > 0) {
          sharedRows = await loadMapped(categoryCarsListKey(categoryId), undefined, true);
        }
        if (sharedRows.length === 0) {
          sharedRows = await loadMapped("program_cars", undefined, true);
        }
      }
      const row = pickRow(userRows, sharedRows, requested || undefined);
      const sharedDefault = sharedRows.find((r) => r.is_default) ?? sharedRows[0] ?? null;
      res.json({
        list_key: listKey,
        view_name: row ? coalesceViewName(row.view_name) : "Default",
        visible_cols: row?.visible_cols ?? null,
        is_shared_source: Boolean(row?.is_shared),
        views: viewMeta([...userRows, ...sharedRows]),
        shared_default: sharedDefault
          ? { view_name: coalesceViewName(sharedDefault.view_name), visible_cols: sharedDefault.visible_cols }
          : null,
      });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.put("/api/prefs/columns", async (req: Request, res: Response) => {
    try {
      const user = req.authUser ?? (await getAuthUser(req));
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const body = req.body as { page?: string; list_key?: string; view_name?: string; visible_cols?: unknown; is_default?: boolean };
      const listKey = normalizeListKey(String(body.list_key ?? body.page ?? "").trim());
      if (!listKey) return res.status(400).json({ error: "list_key or page required" });
      if (!prefsOk(body.visible_cols)) {
        return res.status(400).json({ error: "visible_cols must be an array or { cols, order, widths }" });
      }
      const viewName = coalesceViewName(body.view_name);
      const userRows = await loadMapped(listKey, user.id);
      const existing = userRows.find((r) => coalesceViewName(r.view_name) === viewName);
      const now = new Date().toISOString();
      if (existing) {
        if (body.is_default) await clearUserDefaults(user.id, listKey, existing.id);
        const patch: Record<string, unknown> = { visible_cols: body.visible_cols, updated_at: now };
        if (body.is_default) patch.is_default = true;
        const { error } = await supabaseAdmin.from("user_column_prefs").update(patch).eq("id", existing.id);
        if (error) throw error;
      } else {
        if (body.is_default) await clearUserDefaults(user.id, listKey);
        const { error } = await supabaseAdmin.from("user_column_prefs").insert({
          user_id: user.id,
          page: pageForListKey(listKey),
          list_key: listKey,
          view_name: viewName,
          is_default: Boolean(body.is_default),
          is_shared: false,
          visible_cols: body.visible_cols,
          updated_at: now,
        });
        if (error) throw error;
      }
      res.json({ ok: true, list_key: listKey, view_name: viewName });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/prefs/columns/views", async (req: Request, res: Response) => {
    try {
      const user = req.authUser ?? (await getAuthUser(req));
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const body = req.body as { list_key?: string; page?: string; view_name?: string; visible_cols?: unknown; is_default?: boolean };
      const listKey = normalizeListKey(String(body.list_key ?? body.page ?? "").trim());
      const viewName = coalesceViewName(body.view_name);
      if (!listKey) return res.status(400).json({ error: "list_key required" });
      if (!String(body.view_name ?? "").trim()) return res.status(400).json({ error: "view_name required" });
      if (!prefsOk(body.visible_cols)) return res.status(400).json({ error: "visible_cols required" });
      const userRows = await loadMapped(listKey, user.id);
      if (userRows.some((r) => coalesceViewName(r.view_name) === viewName)) {
        return res.status(409).json({ error: "A view with that name already exists" });
      }
      if (body.is_default) await clearUserDefaults(user.id, listKey);
      const { error } = await supabaseAdmin.from("user_column_prefs").insert({
        user_id: user.id,
        page: pageForListKey(listKey),
        list_key: listKey,
        view_name: viewName,
        is_default: Boolean(body.is_default),
        is_shared: false,
        visible_cols: body.visible_cols,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      res.json({ ok: true, list_key: listKey, view_name: viewName });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.patch("/api/prefs/columns/views", async (req: Request, res: Response) => {
    try {
      const user = req.authUser ?? (await getAuthUser(req));
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const body = req.body as { list_key?: string; view_name?: string; new_name?: string };
      const listKey = normalizeListKey(String(body.list_key ?? "").trim());
      const viewName = coalesceViewName(body.view_name);
      const newName = String(body.new_name ?? "").trim();
      if (!listKey || !newName) return res.status(400).json({ error: "list_key, view_name, and new_name required" });
      const userRows = await loadMapped(listKey, user.id);
      const existing = userRows.find((r) => coalesceViewName(r.view_name) === viewName);
      if (!existing) return res.status(404).json({ error: "View not found" });
      if (userRows.some((r) => r.id !== existing.id && coalesceViewName(r.view_name) === newName)) {
        return res.status(409).json({ error: "A view with that name already exists" });
      }
      const { error } = await supabaseAdmin
        .from("user_column_prefs")
        .update({ view_name: newName, list_key: listKey, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .eq("user_id", user.id);
      if (error) throw error;
      res.json({ ok: true, view_name: newName });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.delete("/api/prefs/columns/views", async (req: Request, res: Response) => {
    try {
      const user = req.authUser ?? (await getAuthUser(req));
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const listKey = normalizeListKey(String(req.query.list_key ?? "").trim());
      const viewName = coalesceViewName(req.query.view_name);
      if (!listKey) return res.status(400).json({ error: "list_key required" });
      const userRows = await loadMapped(listKey, user.id);
      const existing = userRows.find((r) => coalesceViewName(r.view_name) === viewName);
      if (!existing) return res.status(404).json({ error: "View not found" });
      const { error } = await supabaseAdmin
        .from("user_column_prefs")
        .delete()
        .eq("id", existing.id)
        .eq("user_id", user.id)
        .eq("is_shared", false);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/prefs/columns/default", async (req: Request, res: Response) => {
    try {
      const user = req.authUser ?? (await getAuthUser(req));
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const body = req.body as { list_key?: string; view_name?: string };
      const listKey = normalizeListKey(String(body.list_key ?? "").trim());
      const viewName = coalesceViewName(body.view_name);
      if (!listKey) return res.status(400).json({ error: "list_key required" });
      const userRows = await loadMapped(listKey, user.id);
      const existing = userRows.find((r) => coalesceViewName(r.view_name) === viewName);
      if (!existing) return res.status(404).json({ error: "View not found" });
      await clearUserDefaults(user.id, listKey, existing.id);
      const { error } = await supabaseAdmin
        .from("user_column_prefs")
        .update({ is_default: true, list_key: listKey, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .eq("user_id", user.id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/prefs/columns/publish", async (req: Request, res: Response) => {
    try {
      const user = req.authUser ?? (await getAuthUser(req));
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const role = req.authRole ?? (await getUserRole(user));
      if (role !== "admin") return res.status(403).json({ error: "Admin only" });
      const body = req.body as { list_key?: string; view_name?: string; visible_cols?: unknown };
      const listKey = normalizeListKey(String(body.list_key ?? "").trim());
      const viewName = coalesceViewName(body.view_name);
      if (!listKey) return res.status(400).json({ error: "list_key required" });
      if (!prefsOk(body.visible_cols) && parsePrefsPayload(body.visible_cols) == null) {
        return res.status(400).json({ error: "visible_cols required" });
      }
      const sharedRows = await loadMapped(listKey, undefined, true);
      const ids = sharedRows.filter((r) => r.is_default).map((r) => r.id);
      if (ids.length) {
        const { error } = await supabaseAdmin.from("user_column_prefs").update({ is_default: false }).in("id", ids);
        if (error) throw error;
      }
      const existing = sharedRows.find((r) => coalesceViewName(r.view_name) === viewName);
      const now = new Date().toISOString();
      if (existing) {
        const { error } = await supabaseAdmin
          .from("user_column_prefs")
          .update({ visible_cols: body.visible_cols, is_default: true, is_shared: true, list_key: listKey, updated_at: now })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabaseAdmin.from("user_column_prefs").insert({
          user_id: user.id,
          page: pageForListKey(listKey),
          list_key: listKey,
          view_name: viewName,
          is_default: true,
          is_shared: true,
          visible_cols: body.visible_cols,
          updated_at: now,
        });
        if (error) throw error;
      }
      res.json({ ok: true, list_key: listKey, view_name: viewName, is_shared: true });
    } catch (err) {
      errHandler(res, err);
    }
  });
}
