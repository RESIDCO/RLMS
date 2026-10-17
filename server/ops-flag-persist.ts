import { encodeOpsFlagFallback, formatOpsFlag } from "@shared/ops-flag";
import { pickRow } from "@shared/change-log";
import { currentChangeActor, recordChange } from "./change-log";
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

const OPS_FLAG_KEYS = ["ops_flag", "ops_flag_set_at"] as const;
const OPS_FLAG_FALLBACK_KEYS = ["ops_flag", "ops_flag_set_at", "comment_event_note"] as const;

/** Write ops_flag when the column exists; otherwise encode it on comment_event_note. */
export async function persistOpsFlag(ids: number[], rawFlag: string | null): Promise<number> {
  const ops_flag = formatOpsFlag(rawFlag);
  const ops_flag_set_at = ops_flag ? new Date().toISOString() : null;
  const unique = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))];
  const CHUNK = 200;
  let updated = 0;
  let useFallback = false;
  const actor = currentChangeActor();

  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const { data: priors, error: pErr } = await supabaseAdmin
      .from("railcars")
      .select("id, ops_flag, ops_flag_set_at, comment_event_note")
      .in("id", slice);
    if (pErr && missingOpsFlagColumn(pErr)) {
      useFallback = true;
    } else if (pErr) {
      throw pErr;
    }

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
        const byId = new Map((priors ?? []).map((r: any) => [Number(r.id), r as Record<string, unknown>]));
        for (const row of data ?? []) {
          const prior = byId.get(Number(row.id));
          await recordChange({
            table: "railcars",
            pk: Number(row.id),
            before: pickRow(prior ?? null, [...OPS_FLAG_KEYS]),
            after: { ops_flag, ops_flag_set_at },
            action: "ops_flag",
            entity_type: "railcar",
            entity_id: Number(row.id),
            railcar_id: Number(row.id),
            actor,
          });
        }
        continue;
      }
    }
    updated += await persistOpsFlagFallback(slice, ops_flag, ops_flag_set_at, actor, priors ?? []);
  }
  return updated;
}

async function persistOpsFlagFallback(
  ids: number[],
  ops_flag: string | null,
  ops_flag_set_at: string | null,
  actor: string | null,
  alreadyLoaded: any[],
): Promise<number> {
  let rows = alreadyLoaded.filter((r) => ids.includes(Number(r.id)));
  const missing = ids.filter((id) => !rows.some((r) => Number(r.id) === id));
  if (missing.length) {
    const { data, error } = await supabaseAdmin
      .from("railcars")
      .select("id, comment_event_note")
      .in("id", missing);
    if (error) throw error;
    rows = rows.concat(data ?? []);
  }
  let n = 0;
  for (const row of rows) {
    const next = encodeOpsFlagFallback(row.comment_event_note, ops_flag);
    const { error: uErr } = await supabaseAdmin
      .from("railcars")
      .update({ comment_event_note: next })
      .eq("id", row.id);
    if (uErr) throw uErr;
    await recordChange({
      table: "railcars",
      pk: Number(row.id),
      before: pickRow(row as Record<string, unknown>, [...OPS_FLAG_FALLBACK_KEYS]),
      after: { ops_flag, ops_flag_set_at, comment_event_note: next },
      action: "ops_flag",
      entity_type: "railcar",
      entity_id: Number(row.id),
      railcar_id: Number(row.id),
      actor,
    });
    n += 1;
  }
  return n;
}
