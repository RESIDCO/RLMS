import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { changedKeys, type ActivityEntityType } from "@shared/change-log";
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

export type RecordChangeOpts = {
  table: string;
  pk: number | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  action: string;
  entity_type: ActivityEntityType;
  entity_id: number;
  railcar_id?: number | null;
  rider_id?: number | null;
  actor?: string | null;
  undoable?: boolean;
  source?: string;
  source_table?: string | null;
  source_id?: number | null;
  detail?: Record<string, unknown>;
  occurred_at?: string;
  /** Write even when before/after keys are identical (timeline-only events). */
  force?: boolean;
};

export async function recordChange(opts: RecordChangeOpts): Promise<{ id: number; change_group: string } | null> {
  const diff = changedKeys(opts.before ?? {}, opts.after ?? {});
  const isInsert = !opts.before || Object.keys(opts.before).length === 0;
  const isDelete = !opts.after || Object.keys(opts.after).length === 0;
  if (!opts.force && !isInsert && !isDelete && Object.keys(diff.before).length === 0) return null;

  const group = currentChangeGroup() ?? randomUUID();
  const actor = opts.actor ?? currentChangeActor();
  const before = isInsert ? {} : isDelete ? diff.before : diff.before;
  const after = isDelete ? {} : isInsert ? (opts.after ?? {}) : diff.after;

  const payload: Record<string, unknown> = {
    entity_type: opts.entity_type,
    entity_id: opts.entity_id,
    action: opts.action,
    actor: actor ?? null,
    railcar_id:
      opts.railcar_id !== undefined
        ? opts.railcar_id
        : opts.entity_type === "railcar"
          ? opts.entity_id
          : null,
    rider_id:
      opts.rider_id !== undefined
        ? opts.rider_id
        : opts.entity_type === "rider"
          ? opts.entity_id
          : null,
    detail: {
      ...(opts.detail ?? {}),
      op: isInsert ? "insert" : isDelete ? "delete" : "update",
    },
    source: opts.source ?? "ui",
    occurred_at: opts.occurred_at ?? new Date().toISOString(),
    source_table: opts.source_table ?? null,
    source_id: opts.source_id ?? null,
    change_group: group,
    table_name: opts.table,
    row_pk: opts.pk,
    before,
    after,
    undoable: opts.undoable !== false,
  };

  const { data, error } = await supabaseAdmin.from("activity_log").insert(payload).select("id").single();
  if (error) throw error;
  return { id: Number(data.id), change_group: group };
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
