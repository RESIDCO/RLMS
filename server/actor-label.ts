import { isActorUuid } from "@shared/actor-label";
import { supabaseAdmin } from "./supabase";

/** One minute. A role email change shows up on the next request after this. */
export const ACTOR_LABEL_TTL_MS = 60_000;

const ROLE_BATCH = 100;
const AUTH_CONCURRENCY = 8;

export type ActorLabelSource = {
  /** user_roles batch. Throw to skip the table and try auth for every id. */
  rolesByUserId: (ids: readonly string[]) => Promise<ReadonlyArray<{ user_id: string; email: string | null }>>;
  /** auth.admin.getUserById email. Null is a miss. */
  authEmail: (id: string) => Promise<string | null>;
  now?: () => number;
};

type CacheEntry = { at: number; label: string };

const cache = new Map<string, CacheEntry>();

export function clearActorLabelCache(): void {
  cache.clear();
}

/** Auth users expose email only. Names in user_metadata stay on the server. */
export function emailFromAuthUser(user: { email?: string | null } | null | undefined): string | null {
  const email = String(user?.email ?? "").trim();
  return email || null;
}

function trimmed(value: unknown): string {
  return String(value ?? "").trim();
}

function cacheKey(id: string): string {
  return isActorUuid(id) ? id.toLowerCase() : id;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return "error";
}

async function defaultSource(): Promise<ActorLabelSource> {
  return {
    rolesByUserId: async (ids) => {
      const rows: { user_id: string; email: string | null }[] = [];
      for (let i = 0; i < ids.length; i += ROLE_BATCH) {
        const slice = ids.slice(i, i + ROLE_BATCH);
        const { data, error } = await supabaseAdmin.from("user_roles").select("user_id, email").in("user_id", slice);
        if (error) throw error;
        for (const row of data ?? []) {
          const record = row as { user_id?: unknown; email?: unknown };
          rows.push({
            user_id: trimmed(record.user_id),
            email: record.email == null ? null : String(record.email),
          });
        }
      }
      return rows;
    },
    authEmail: async (id) => {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
      if (error) return null;
      return emailFromAuthUser(data.user);
    },
  };
}

async function mapLimited(ids: readonly string[], fn: (id: string) => Promise<void>): Promise<void> {
  if (!ids.length) return;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(AUTH_CONCURRENCY, ids.length) }, async () => {
    while (cursor < ids.length) {
      const index = cursor;
      cursor += 1;
      await fn(ids[index]);
    }
  });
  await Promise.all(workers);
}

/**
 * Map actor ids to display labels.
 * Only UUID-looking strings are looked up. Emails and system labels
 * (vcf-import, contract-loader, legacy, user, and anything else) pass through.
 * user_roles is a single batched read. auth.admin.getUserById runs only for
 * misses, on the service-role client. A miss stays the raw value.
 */
export async function labelActors(
  ids: readonly (string | null | undefined)[],
  source?: ActorLabelSource,
): Promise<Map<string, string>> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = trimmed(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }

  const out = new Map<string, string>();
  const lookup = source ?? (await defaultSource());
  const now = lookup.now?.() ?? Date.now();
  const pending: string[] = [];
  for (const id of unique) {
    if (!isActorUuid(id)) {
      out.set(id, id);
      continue;
    }
    const hit = cache.get(cacheKey(id));
    if (hit && now - hit.at < ACTOR_LABEL_TTL_MS) {
      out.set(id, hit.label);
      continue;
    }
    pending.push(id);
  }
  if (!pending.length) return out;

  const fromRoles = new Map<string, string>();
  try {
    const rows = await lookup.rolesByUserId(pending);
    for (const row of rows) {
      const userId = trimmed(row.user_id);
      const email = trimmed(row.email);
      if (!userId || !email) continue;
      fromRoles.set(cacheKey(userId), email);
    }
  } catch (error) {
    console.log(`[actor-label] user_roles lookup skipped: ${messageOf(error)}`);
  }

  const authMisses = pending.filter((id) => !fromRoles.has(cacheKey(id)));
  const fromAuth = new Map<string, string>();
  await mapLimited(authMisses, async (id) => {
    try {
      const email = trimmed(await lookup.authEmail(id));
      if (email) fromAuth.set(cacheKey(id), email);
    } catch (error) {
      console.log(`[actor-label] auth lookup skipped: ${messageOf(error)}`);
    }
  });

  for (const id of pending) {
    const key = cacheKey(id);
    const label = fromRoles.get(key) || fromAuth.get(key) || id;
    cache.set(key, { at: now, label });
    out.set(id, label);
  }
  return out;
}

/** Keep the raw actor field. Add actor_label beside it. Null actor stays null. */
export async function annotateActorLabels<T extends object>(
  rows: readonly T[],
  readActor: (row: T) => unknown,
  source?: ActorLabelSource,
): Promise<Array<T & { actor_label: string | null }>> {
  const raws = rows.map((row) => {
    const value = readActor(row);
    return value == null ? "" : trimmed(value);
  });
  const labels = await labelActors(raws, source);
  return rows.map((row, index) => {
    const raw = raws[index];
    return { ...row, actor_label: raw ? (labels.get(raw) ?? raw) : null };
  });
}
