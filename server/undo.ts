import { canonicalRows } from "@shared/canonical-json";
import { viewUndoNameConflict } from "@shared/saved-views";
import { labelActors } from "./actor-label";
import { supabaseAdmin } from "./supabase";
import { syncCurrentAssignmentHistoryActive } from "./car-status-history";
import { clearViewCountCache } from "./saved-views";
import { fetchCanonicalObject, fetchCanonicalQuery } from "./postgrest-raw";
import {
  UNDO_WINDOW_HOURS,
  changedSinceReason,
  nonUndoableMessage,
  opOf,
  REFERENCED_SINCE_MESSAGE,
  REFERENCED_SINCE_TABLES,
  referencedSinceBlocksUndo,
  summarizeUndoRows,
  type UndoConflict,
  type UndoLogRow,
} from "@shared/undo";
import { assertLineInsertUndoHasNoOutsideFiles } from "./crm-bid-attachments";
import { isDealCalcOnlyGroup } from "./crm-deal-calc";
import { routeUndoGroup } from "@shared/dealCalcUndo";
import {
  REMARK_OUTSIDE_REFS,
  REMARK_REFERENCED_MESSAGE,
  firstOutsideRecordId,
  frozenFkOutsideUnchecked,
  isRemarkRetireGroup,
  remarkOutsideUndoMessage,
  remarkUndoTableAllowed,
} from "@shared/remark-group";

const CHANGE_GROUP_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toUndoRow(row: Record<string, unknown>): UndoLogRow {
  const detail = row.detail && typeof row.detail === "object" && !Array.isArray(row.detail) ? row.detail as Record<string, unknown> : {};
  const before = row.before && typeof row.before === "object" && !Array.isArray(row.before) ? row.before as Record<string, unknown> : {};
  const after = row.after && typeof row.after === "object" && !Array.isArray(row.after) ? row.after as Record<string, unknown> : {};
  return {
    id: Number(row.id),
    change_group: row.change_group == null ? null : String(row.change_group),
    table_name: row.table_name == null ? null : String(row.table_name),
    row_pk: row.row_pk == null || row.row_pk === "" ? null : Number(row.row_pk),
    before,
    after,
    undoable: typeof row.undoable === "boolean" ? row.undoable : row.undoable == null ? null : row.undoable === "true",
    undone_at: row.undone_at == null ? null : String(row.undone_at),
    actor: row.actor == null ? null : String(row.actor),
    action: row.action == null ? null : String(row.action),
    occurred_at: row.occurred_at == null ? null : String(row.occurred_at),
    detail,
    entity_type: row.entity_type == null ? null : String(row.entity_type),
    entity_id: row.entity_id == null || row.entity_id === "" ? null : Number(row.entity_id),
    railcar_id: row.railcar_id == null || row.railcar_id === "" ? null : Number(row.railcar_id),
  };
}

export async function loadChangeGroup(group: string): Promise<UndoLogRow[]> {
  if (!CHANGE_GROUP_UUID.test(group)) return [];
  const text = await fetchCanonicalQuery("activity_log", `change_group=eq.${group}&select=*&order=id.asc`);
  return canonicalRows(text).map(toUndoRow);
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
  const raw = await fetchCanonicalObject(table, pk);
  if (!raw) return null;
  return canonicalRows(raw)[0] ?? null;
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

  await assertLineInsertUndoHasNoOutsideFiles(rows, group);

  const outsideMessage = await remarkOutsideUndoMessageForGroup(group, rows);
  if (outsideMessage) {
    const err: any = new Error(outsideMessage);
    err.status = 409;
    throw err;
  }

  const conflicts: UndoConflict[] = [];
  for (const r of rows) {
    if (!r.table_name || r.row_pk == null) {
      conflicts.push({ activity_id: r.id, table_name: r.table_name, row_pk: r.row_pk, reason: "missing table_name or row_pk" });
      continue;
    }
    if (!remarkUndoTableAllowed(r.table_name, rows)) {
      conflicts.push({ activity_id: r.id, table_name: r.table_name, row_pk: r.row_pk, reason: "table not undoable" });
      continue;
    }
    const op = opOf(r);
    if (op === "insert" && !(isRemarkRetireGroup(rows) && r.table_name === "railcars")) {
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
    const reason = changedSinceReason(cur, r.after);
    if (reason) {
      conflicts.push({
        activity_id: r.id,
        table_name: r.table_name,
        row_pk: r.row_pk,
        reason,
      });
    }
  }

  const summary = summarizeUndoRows(rows);
  const rawActor = first.actor == null ? "" : String(first.actor).trim();
  const labels = await labelActors([first.actor]);
  return {
    change_group: group,
    actor: first.actor,
    actor_label: rawActor ? (labels.get(rawActor) ?? rawActor) : null,
    occurred_at: first.occurred_at,
    count: summary.count,
    lines: summary.lines,
    conflicts,
    ok: conflicts.length === 0,
  };
}

/**
 * Refuse remark undo in preview when a row outside the group still points at
 * the new car. Calls the frozen reference functions, then reads the child
 * row when that function does not cover the table.
 */
async function remarkOutsideUndoMessageForGroup(group: string, rows: UndoLogRow[]): Promise<string | null> {
  if (!isRemarkRetireGroup(rows)) return null;
  const newIds = rows
    .filter((row) => row.table_name === "railcars" && opOf(row) === "insert" && row.row_pk != null)
    .map((row) => Number(row.row_pk));
  for (const id of newIds) {
    const referenced = await supabaseAdmin.rpc("rlms_referenced_outside_group", {
      p_table: "railcars",
      p_id: id,
      p_group: group,
    });
    if (referenced.error) throw referenced.error;
    if (referenced.data === true) return REMARK_REFERENCED_MESSAGE;
    for (const spec of REMARK_OUTSIDE_REFS) {
      const fk = await supabaseAdmin.rpc("rlms_fk_outside_group", {
        p_table: spec.table,
        p_column: spec.column,
        p_id: id,
        p_group: group,
      });
      let mustScan = false;
      if (fk.error) {
        if (!frozenFkOutsideUnchecked(String(fk.error.message ?? ""))) throw fk.error;
        mustScan = true;
      } else if (fk.data === true) {
        mustScan = true;
      }
      if (!mustScan) continue;
      const logged = rows
        .filter((row) => row.table_name === spec.table && row.row_pk != null)
        .map((row) => Number(row.row_pk));
      let query = supabaseAdmin.from(spec.table).select("id").eq(spec.column, id);
      if (spec.table === "attachments") query = query.eq("entity_type", "railcar");
      if (logged.length) query = query.not("id", "in", `(${logged.join(",")})`);
      const found = await query.limit(1);
      if (found.error) throw found.error;
      const recordId = firstOutsideRecordId(
        (found.data ?? []).map((row) => Number((row as { id: number }).id)),
        logged,
      );
      if (recordId != null) return remarkOutsideUndoMessage(spec.label, recordId);
      if (fk.data === true) return remarkOutsideUndoMessage(spec.label, id);
    }
  }
  return null;
}

/** Storage is removed only when the undone activity is an attachments insert. */
export function attachmentStoragePathsRemovedOnUndo(rows: Array<{
  table_name?: string | null;
  detail?: { op?: unknown; storage_path?: unknown } | null;
  after?: { storage_path?: unknown } | null;
}>): string[] {
  return rows
    .filter((row) => row.table_name === "attachments" && row.detail?.op === "insert")
    .map((row) => String(row.after?.storage_path ?? row.detail?.storage_path ?? ""))
    .filter(Boolean);
}

export async function applyUndo(group: string, actor: string) {
  const preview = await previewUndo(group, actor);
  if (!preview.ok) {
    const err: any = new Error("Changed since — undo refused");
    err.status = 409;
    err.conflicts = preview.conflicts;
    throw err;
  }
  const rowsBefore = await loadChangeGroup(group);
  const route = routeUndoGroup(rowsBefore);
  if (route.kind === "wrapper") {
    const otherGroup = route.calcGroup === group ? route.coreGroup : route.calcGroup;
    const otherPreview = await previewUndo(otherGroup, actor);
    if (!otherPreview.ok) {
      const err: any = new Error("Changed since — undo refused");
      err.status = 409;
      err.conflicts = otherPreview.conflicts;
      throw err;
    }
    const { data, error } = await supabaseAdmin.rpc("rlms_undo_calc_create_opp", {
      p_calc: route.calcGroup,
      p_core: route.coreGroup,
      p_actor: actor,
    });
    if (error) throw error;
    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok === false) {
      const status = Number(result.status) || 400;
      const err: any = new Error(String(result.message ?? result.error ?? "undo failed"));
      err.status = status;
      err.conflicts = result.conflicts;
      throw err;
    }
    return { ...result, preview, otherPreview };
  }
  const rpcName = isDealCalcOnlyGroup(rowsBefore)
    ? "rlms_undo_deal_calc_group"
    : isRemarkRetireGroup(rowsBefore)
      ? "rlms_undo_remark_group"
      : "rlms_undo_change_group";
  // Undo identity stays the raw caller id. actor_label is not sent to the RPC.
  const { data, error } = await supabaseAdmin.rpc(rpcName, {
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
  // Only an undone insert created the object. Delete and recategorize keep it,
  // so Undo can put the row back and the file still downloads. Lease-contract
  // loads record detail.op = "insert", so those undos still remove the object.
  const storagePaths = attachmentStoragePathsRemovedOnUndo(rows);
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
  const actor = members[0]?.actor == null ? null : String(members[0].actor);
  const rawActor = actor == null ? "" : actor.trim();
  const labels = await labelActors([actor]);
  return {
    change_group: group,
    count: members.length,
    occurred_at: members[0]?.occurred_at,
    action: members[0]?.action,
    actor,
    actor_label: rawActor ? (labels.get(rawActor) ?? rawActor) : null,
  };
}
