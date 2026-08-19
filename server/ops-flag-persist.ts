import { encodeOpsFlagFallback, formatOpsFlag } from "@shared/ops-flag";
import { supabaseAdmin } from "./supabase";

export function missingOpsFlagColumn(err: unknown) {
  const msg = String((err as any)?.message ?? err ?? "");
  return /ops_flag/i.test(msg) && /column|schema cache|does not exist|could not find/i.test(msg);
}

export function omitOpsFlagFields<T extends Record<string, unknown>>(row: T): Omit<T, "ops_flag" | "ops_flag_set_at"> {
  const { ops_flag: _f, ops_flag_set_at: _t, ...rest } = row as T & {
    ops_flag?: unknown;
    ops_flag_set_at?: unknown;
  };
  return rest;
}

/** Write ops_flag when the column exists; otherwise encode it on comment_event_note. */
export async function persistOpsFlag(ids: number[], rawFlag: string | null): Promise<number> {
  const ops_flag = formatOpsFlag(rawFlag);
  const ops_flag_set_at = ops_flag ? new Date().toISOString() : null;
  const unique = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))];
  const CHUNK = 200;
  let updated = 0;
  let useFallback = false;

  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    if (!useFallback) {
      const { data, error } = await supabaseAdmin
        .from("railcars")
        .update({ ops_flag, ops_flag_set_at })
        .in("id", slice)
        .select("id");
      if (error && missingOpsFlagColumn(error)) {
        useFallback = true;
      } else if (error) {
        throw error;
      } else {
        updated += data?.length ?? 0;
        continue;
      }
    }
    updated += await persistOpsFlagFallback(slice, ops_flag);
  }
  return updated;
}

async function persistOpsFlagFallback(ids: number[], ops_flag: string | null): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("railcars")
    .select("id, comment_event_note")
    .in("id", ids);
  if (error) throw error;
  let n = 0;
  for (const row of data ?? []) {
    const next = encodeOpsFlagFallback(row.comment_event_note, ops_flag);
    const { error: uErr } = await supabaseAdmin
      .from("railcars")
      .update({ comment_event_note: next })
      .eq("id", row.id);
    if (uErr) throw uErr;
    n += 1;
  }
  return n;
}
