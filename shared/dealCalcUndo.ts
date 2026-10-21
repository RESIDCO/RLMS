/**
 * In-memory undo for deal-calc scenarios.
 * The four rlms_ undo functions are not modified (md5 guard), and their
 * allowlist does not name these tables. applyUndo uses this helper for a
 * change group that only touches deal_calc_scenarios / deal_calc_assumption_sets.
 *
 * Pin groups restore newest-first, so the new pin drops before the old one
 * returns. A delete group records unpin first and deleted_at second. Undoing
 * that group clears deleted_at and then restores is_pinned only when the
 * slot is free. If another row was pinned later, the restored row stays
 * unpinned and the unique index holds.
 */

export type ScenarioSlot = {
  id: number;
  opportunityId: number | null;
  lineId: number | null;
  isPinned: boolean;
  deletedAt: string | null;
};

export type ScenarioPatch = {
  activityId: number;
  rowId: number;
  op: "insert" | "update";
  before: { isPinned?: boolean; deletedAt?: string | null; opportunityId?: number | null; lineId?: number | null };
  after: { isPinned?: boolean; deletedAt?: string | null; opportunityId?: number | null; lineId?: number | null };
};

function slotKey(row: Pick<ScenarioSlot, "opportunityId" | "lineId">): string {
  return `${row.opportunityId ?? "none"}:${row.lineId ?? 0}`;
}

function livePin(rows: ScenarioSlot[], row: ScenarioSlot): ScenarioSlot | undefined {
  const key = slotKey(row);
  return rows.find((item) => item.id !== row.id && !item.deletedAt && item.isPinned && slotKey(item) === key);
}

export function applyScenarioUndo(rows: ScenarioSlot[], patches: ScenarioPatch[]): ScenarioSlot[] {
  const next = rows.map((row) => ({ ...row }));
  const ordered = patches.slice().sort((a, b) => b.activityId - a.activityId);
  for (const patch of ordered) {
    if (patch.op === "insert") {
      const index = next.findIndex((row) => row.id === patch.rowId);
      if (index >= 0) next.splice(index, 1);
      continue;
    }
    const row = next.find((item) => item.id === patch.rowId);
    if (!row) continue;
    if (patch.before.deletedAt !== undefined) row.deletedAt = patch.before.deletedAt;
    if (patch.before.opportunityId !== undefined) row.opportunityId = patch.before.opportunityId;
    if (patch.before.lineId !== undefined) row.lineId = patch.before.lineId;
    if (row.opportunityId == null) row.isPinned = false;
    if (patch.before.isPinned !== undefined && row.opportunityId != null) {
      const wantsPin = patch.before.isPinned === true;
      if (wantsPin && livePin(next, row)) row.isPinned = false;
      else row.isPinned = patch.before.isPinned;
    }
  }
  return next;
}

export function planSoftDelete(row: ScenarioSlot, deletedAt: string, activityId: number): ScenarioPatch[] {
  const patches: ScenarioPatch[] = [];
  let nextActivity = activityId;
  if (row.isPinned) {
    patches.push({
      activityId: nextActivity,
      rowId: row.id,
      op: "update",
      before: { isPinned: true },
      after: { isPinned: false },
    });
    nextActivity += 1;
  }
  patches.push({
    activityId: nextActivity,
    rowId: row.id,
    op: "update",
    before: { deletedAt: null },
    after: { deletedAt },
  });
  return patches;
}

/** True when pinning this live row would not steal another row's pin. */
export function pinSlotFree(rows: ScenarioSlot[], rowId: number): boolean {
  const row = rows.find((item) => item.id === rowId);
  if (!row || row.deletedAt) return false;
  return !livePin(rows, row);
}

export function planPin(rows: ScenarioSlot[], targetId: number, activityId: number): ScenarioPatch[] {
  const target = rows.find((row) => row.id === targetId);
  if (!target) throw new Error("scenario not found");
  if (target.deletedAt) throw new Error("deleted scenario cannot be pinned");
  if (target.opportunityId == null) throw new Error("An unlinked scenario cannot be pinned");
  const current = rows.find((row) => row.id !== target.id && !row.deletedAt && row.isPinned && slotKey(row) === slotKey(target));
  const patches: ScenarioPatch[] = [];
  let nextActivity = activityId;
  if (current) {
    patches.push({
      activityId: nextActivity,
      rowId: current.id,
      op: "update",
      before: { isPinned: true },
      after: { isPinned: false },
    });
    nextActivity += 1;
  }
  if (!target.isPinned) {
    patches.push({
      activityId: nextActivity,
      rowId: target.id,
      op: "update",
      before: { isPinned: false },
      after: { isPinned: true },
    });
  }
  return patches;
}

export const CALC_CREATE_OPP_LINK = "calc_create_opp";

export type UndoLogSlice = {
  change_group?: string | null;
  table_name?: string | null;
  detail?: { link_kind?: unknown; linked_group?: unknown; op?: unknown } | null;
};

export type UndoRoute =
  | { kind: "wrapper"; calcGroup: string; coreGroup: string }
  | { kind: "deal_calc" }
  | { kind: "generic" };

/** A linked half is never undone by the generic or deal-calc RPC. */
export function directHalfUndoRefusal(): { status: 409; error: "linked_group" } {
  return { status: 409, error: "linked_group" };
}

function linkOf(row: UndoLogSlice): { kind: string; other: string } | null {
  const kind = row.detail?.link_kind;
  const other = row.detail?.linked_group;
  if (kind !== CALC_CREATE_OPP_LINK || typeof other !== "string" || !other) return null;
  return { kind, other };
}

/**
 * Groups stamped calc_create_opp go to the wrapper with both ids.
 * Calling the generic undo on one half is a 409, via directHalfUndoRefusal.
 */
export function routeUndoGroup(rows: UndoLogSlice[]): UndoRoute {
  const linked = rows.map(linkOf).find((item) => item != null);
  if (linked) {
    const requested = rows.find((row) => linkOf(row))?.change_group ?? "";
    const calcGroup = rows.some((row) => row.table_name === "deal_calc_scenarios") ? requested : linked.other;
    const coreGroup = calcGroup === requested ? linked.other : requested;
    return { kind: "wrapper", calcGroup, coreGroup };
  }
  if (rows.length > 0 && rows.every((row) => row.table_name === "deal_calc_scenarios" || row.table_name === "deal_calc_assumption_sets")) {
    return { kind: "deal_calc" };
  }
  return { kind: "generic" };
}

export function linkedUndoBlockedByFiles(attachmentIds: number[], inGroupIds: number[]): boolean {
  const inside = new Set(inGroupIds);
  return attachmentIds.some((id) => !inside.has(id));
}
