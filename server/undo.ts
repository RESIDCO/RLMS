import { viewUndoNameConflict } from "@shared/saved-views";
import { supabaseAdmin } from "./supabase";
import { syncCurrentAssignmentHistoryActive } from "./car-status-history";
import { clearViewCountCache } from "./saved-views";
import {
  UNDO_WINDOW_HOURS,
  currentMatchesAfter,
  isUndoAllowedTable,
  nonUndoableMessage,
  opOf,
  REFERENCED_SINCE_MESSAGE,
  REFERENCED_SINCE_TABLES,
  referencedSinceBlocksUndo,
  summarizeUndoRows,
  type UndoConflict,
  type UndoLogRow,
} from "@shared/undo";

function asRows(data: unknown): UndoLogRow[] {
  return ((data ?? []) as any[]).map((r) => ({
    id: Number(r.id),
    change_group: r.change_group ?? null,
    table_name: r.table_name ?? null,
    row_pk: r.row_pk != null ? Number(r.row_pk) : null,
    before: r.before && typeof r.before === "object" ? r.before : {},
    after: r.after && typeof r.after === "object" ? r.after : {},
    undoable: r.undoable,
    undone_at: r.undone_at ?? null,
    actor: r.actor ?? null,
    action: r.action ?? null,
    occurred_at: r.occurred_at ?? null,
    detail: r.detail && typeof r.detail === "object" ? r.detail : {},
    entity_type: r.entity_type ?? null,
    entity_id: r.entity_id != null ? Number(r.entity_id) : null,
    railcar_id: r.railcar_id != null ? Number(r.railcar_id) : null,
  }));
}

export async function loadChangeGroup(group: string): Promise<UndoLogRow[]> {
  const { data, error } = await supabaseAdmin
    .from("activity_log")
    .select("*")
    .eq("change_group", group)
    .order("id", { ascending: true });
  if (error) throw error;
  return asRows(data);
}

export async function resolveUndoGroup(body: { change_group?: string; activity_id?: number }): Promise<string | null> {
  const g = String(body.change_group ?? "").trim();
  if (g) return g;
  const id = Number(body.activity_id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const { data, error } = await supabaseAdmin
    .from("activity_log")
    .select("change_group")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data?.change_group ? String(data.change_group) : null;
}

async function fetchCurrent(table: string, pk: number): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin.from(table).select("*").eq("id", pk).maybeSingle();
  if (error) throw error;
  return (data as Record<string, unknown>) ?? null;
}

export async function previewUndo(group: string, actor: string) {
  const rows = await loadChangeGroup(group);
  if (!rows.length) {
    const err: any = new Error("Change group not found");
    err.status = 404;
    throw err;
  }
  const first = rows[0];
  if (rows.some((r) => r.undoable === false)) {
    const err: any = new Error(nonUndoableMessage(rows.find((r) => r.undoable === false)?.action));
    err.status = 400;
    throw err;
  }
  if (rows.some((r) => r.undone_at)) {
    const err: any = new Error("Already undone");
    err.status = 409;
    throw err;
  }
  if (String(first.actor ?? "") !== actor) {
    const err: any = new Error("Only the original actor can undo this change");
    err.status = 403;
    throw err;
  }
  const occurred = first.occurred_at ? new Date(first.occurred_at).getTime() : 0;
  if (occurred && Date.now() - occurred > UNDO_WINDOW_HOURS * 3600 * 1000) {
    const err: any = new Error("Undo window is 24 hours");
    err.status = 403;
    throw err;
  }

  const conflicts: UndoConflict[] = [];
  for (const r of rows) {
    if (!r.table_name || r.row_pk == null) {
      conflicts.push({ activity_id: r.id, table_name: r.table_name, row_pk: r.row_pk, reason: "missing table_name or row_pk" });
      continue;
    }
    if (!isUndoAllowedTable(r.table_name)) {
      conflicts.push({ activity_id: r.id, table_name: r.table_name, row_pk: r.row_pk, reason: "table not undoable" });
      continue;
    }
    const op = opOf(r);
    if (op === "insert") {
      if ((REFERENCED_SINCE_TABLES as readonly string[]).includes(r.table_name)) {
        const { data: outside, error: outsideErr } = await supabaseAdmin.rpc("rlms_referenced_outside_group", {
          p_table: r.table_name,
          p_id: r.row_pk,
          p_group: group,
        });
        if (outsideErr) throw outsideErr;
        if (referencedSinceBlocksUndo({ table: r.table_name, op, outside: outside === true })) {
          const err: any = new Error(REFERENCED_SINCE_MESSAGE);
          err.status = 409;
          throw err;
        }
      }
      continue;
    }
    const cur = await fetchCurrent(r.table_name, r.row_pk);
    if (!currentMatchesAfter(cur, r.after)) {
      conflicts.push({
        activity_id: r.id,
        table_name: r.table_name,
        row_pk: r.row_pk,
        reason: "changed since",
      });
    }
  }

  const summary = summarizeUndoRows(rows);
  return {
    change_group: group,
    actor: first.actor,
    occurred_at: first.occurred_at,
    count: summary.count,
    lines: summary.lines,
    conflicts,
    ok: conflicts.length === 0,
  };
}

export async function applyUndo(group: string, actor: string) {
  const preview = await previewUndo(group, actor);
  if (!preview.ok) {
    const err: any = new Error("Changed since — undo refused");
    err.status = 409;
    err.conflicts = preview.conflicts;
    throw err;
  }
  const { data, error } = await supabaseAdmin.rpc("rlms_undo_change_group", {
    p_group: group,
    p_actor: actor,
  });
  if (error) {
    const conflict = viewUndoNameConflict(error);
    if (conflict) {
      const err: any = new Error(conflict);
      err.status = 409;
      throw err;
    }
    throw error;
  }
  const result = (data ?? {}) as Record<string, unknown>;
  if (result.ok === false) {
    const status = Number(result.status) || 400;
    const err: any = new Error(String(result.message ?? result.error ?? "undo failed"));
    err.status = status;
    err.conflicts = result.conflicts;
    throw err;
  }

  const rows = await loadChangeGroup(group);
  const storagePaths = rows
    .filter((r) => r.table_name === "attachments")
    .map((r) => String(r.after?.storage_path ?? r.detail?.storage_path ?? ""))
    .filter(Boolean);
  if (storagePaths.length) {
    await supabaseAdmin.storage.from("rlms-attachments").remove(storagePaths);
  }
  for (const r of rows) {
    if (r.table_name === "railcars" && r.railcar_id && r.before && "active" in r.before) {
      await syncCurrentAssignmentHistoryActive(r.railcar_id, r.before.active === true);
    }
  }
  if (rows.some((r) => r.table_name === "car_lists" || r.table_name === "car_list_members")) {
    clearViewCountCache();
  }
  return { ...result, preview };
}

export async function eligibleUndo(opts: {
  actor: string;
  railcarId?: number;
  programId?: number;
}) {
  const since = new Date(Date.now() - UNDO_WINDOW_HOURS * 3600 * 1000).toISOString();
  const base = () =>
    supabaseAdmin
      .from("activity_log")
      .select("id, change_group, action, occurred_at, undoable, undone_at, actor, table_name, row_pk")
      .eq("actor", opts.actor)
      .eq("undoable", true)
      .is("undone_at", null)
      .gte("occurred_at", since)
      .not("change_group", "is", null)
      .order("occurred_at", { ascending: false })
      .limit(40);

  let data: any[] = [];
  if (opts.railcarId) {
    const r = await base().eq("railcar_id", opts.railcarId);
    if (r.error) throw r.error;
    data = r.data ?? [];
  } else if (opts.programId) {
    const { data: links, error: lErr } = await supabaseAdmin
      .from("program_cars")
      .select("id")
      .eq("program_id", opts.programId);
    if (lErr) throw lErr;
    const linkIds = (links ?? []).map((x: any) => Number(x.id)).filter(Boolean);
    const prog = await base().eq("entity_type", "program").eq("entity_id", opts.programId);
    if (prog.error) throw prog.error;
    data = prog.data ?? [];
    if (linkIds.length) {
      const cars = await base().eq("entity_type", "program_car").in("entity_id", linkIds.slice(0, 80));
      if (cars.error) throw cars.error;
      data = [...data, ...(cars.data ?? [])].sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
    }
  } else {
    const r = await base();
    if (r.error) throw r.error;
    data = r.data ?? [];
  }
  const group = data.find((r) => r.change_group)?.change_group;
  if (!group) return null;
  const members = await loadChangeGroup(String(group));
  return {
    change_group: group,
    count: members.length,
    occurred_at: members[0]?.occurred_at,
    action: members[0]?.action,
  };
}
