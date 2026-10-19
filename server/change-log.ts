import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { buildActivityLogRow, type ActivityEntityType, type ActivityLogInput } from "@shared/change-log";
import { supabaseAdmin } from "./supabase";

type GroupStore = { group: string; actor: string };

const als = new AsyncLocalStorage<GroupStore>();

export function currentChangeGroup(): string | null {
  return als.getStore()?.group ?? null;
}

export function currentChangeActor(): string | null {
  return als.getStore()?.actor ?? null;
}

/** One uuid per save / bulk apply. Nested calls reuse the outer group. */
export async function withChangeGroup<T>(actor: string, fn: (group: string) => Promise<T>): Promise<T> {
  const existing = als.getStore();
  if (existing) return fn(existing.group);
  const group = randomUUID();
  return als.run({ group, actor }, () => fn(group));
}

export async function withChangeGroupResult<T extends object>(
  actor: string,
  fn: (group: string) => Promise<T>,
): Promise<T & { change_group: string }> {
  return withChangeGroup(actor, async (group) => {
    const result = await fn(group);
    return { ...result, change_group: group };
  });
}

export type RecordChangeOpts = ActivityLogInput & { entity_type: ActivityEntityType };

export async function recordChange(opts: RecordChangeOpts): Promise<{ id: number; change_group: string } | null> {
  const written = await recordChanges([opts]);
  if (!written || written.ids.length === 0) return null;
  return { id: written.ids[0], change_group: written.change_group };
}

/** One activity_log insert for the whole list. Rows share change_group and the same payload shape as recordChange. */
export async function recordChanges(batch: RecordChangeOpts[]): Promise<{ ids: number[]; change_group: string } | null> {
  if (!batch.length) return null;
  const group = currentChangeGroup() ?? randomUUID();
  const actor = currentChangeActor();
  const occurred_at = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  for (const opts of batch) {
    const row = buildActivityLogRow(opts, { group, actor, occurred_at });
    if (row) rows.push(row);
  }
  if (!rows.length) return null;
  const { data, error } = await supabaseAdmin.from("activity_log").insert(rows).select("id");
  if (error) throw error;
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return { ids: list.map((row) => Number(row.id)), change_group: group };
}

export async function recordNonUndoable(opts: Omit<RecordChangeOpts, "undoable" | "before" | "after"> & {
  reason: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}): Promise<void> {
  await recordChange({
    ...opts,
    before: opts.before ?? {},
    after: opts.after ?? { reason: opts.reason },
    undoable: false,
    detail: { ...(opts.detail ?? {}), no_undo: opts.reason },
  });
}
