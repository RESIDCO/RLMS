import { firstObjectText } from "@shared/canonical-json";
import { UNDO_ALLOWED_TABLES } from "@shared/undo";

const TABLES = new Set<string>([...UNDO_ALLOWED_TABLES, "activity_log", "railcars"]);

function restBase(): string {
  const url = process.env.SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE service configuration");
  return `${url.replace(/\/$/, "")}/rest/v1`;
}

function serviceHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing SUPABASE service configuration");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    ...extra,
  };
}

function assertTable(table: string): void {
  if (!TABLES.has(table)) throw new Error("canonical read refused");
}

function assertId(id: number): void {
  if (!Number.isInteger(id) || id <= 0) throw new Error("invalid row id");
}

async function errorFrom(res: Response, text: string, fallback: string): Promise<Error> {
  let message = `${fallback} (${res.status})`;
  try {
    const body = JSON.parse(text) as { message?: unknown; details?: unknown };
    if (typeof body.message === "string" && body.message.trim()) {
      message = typeof body.details === "string" && body.details.trim() ? `${body.message} (${body.details})` : body.message;
    }
  } catch {
    // The status line is enough when the body is not JSON.
  }
  const err = new Error(message) as Error & { status?: number };
  if (res.status >= 400 && res.status < 600) err.status = res.status;
  return err;
}

export async function fetchCanonicalObject(table: string, id: number): Promise<string | null> {
  assertTable(table);
  assertId(id);
  const res = await fetch(`${restBase()}/${table}?id=eq.${id}&select=*`, { headers: serviceHeaders() });
  const text = await res.text();
  if (!res.ok) throw await errorFrom(res, text, "canonical read failed");
  return firstObjectText(text);
}

export async function fetchCanonicalQuery(table: string, query: string): Promise<string> {
  assertTable(table);
  if (!/^[\w.=,&()\-:%*]+$/.test(query)) throw new Error("invalid canonical query");
  const res = await fetch(`${restBase()}/${table}?${query}`, { headers: serviceHeaders() });
  const text = await res.text();
  if (!res.ok) throw await errorFrom(res, text, "canonical read failed");
  return text;
}

/** PATCH whose response body is the stored row, numeric scale included. */
export async function patchReturning(
  table: string,
  id: number,
  patch: Record<string, unknown>,
): Promise<{ raw: string; row: Record<string, unknown> }> {
  assertTable(table);
  assertId(id);
  const res = await fetch(`${restBase()}/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: serviceHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(patch),
  });
  const text = await res.text();
  if (!res.ok) throw await errorFrom(res, text, "update failed");
  const raw = firstObjectText(text);
  if (!raw) {
    const missing = new Error("Railcar not found") as Error & { status?: number };
    missing.status = 404;
    throw missing;
  }
  return { raw, row: JSON.parse(raw) as Record<string, unknown> };
}

export async function insertActivityLog(body: string): Promise<{ id: number }> {
  const res = await fetch(`${restBase()}/activity_log`, {
    method: "POST",
    headers: serviceHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body,
  });
  const text = await res.text();
  if (!res.ok) throw await errorFrom(res, text, "activity log insert failed");
  const raw = firstObjectText(text);
  if (!raw) throw new Error("activity log insert returned no row");
  const row = JSON.parse(raw) as { id?: number };
  return { id: Number(row.id) };
}
