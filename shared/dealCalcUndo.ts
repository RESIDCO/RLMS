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
  opportunityId: number;
  lineId: number | null;
  isPinned: boolean;
  deletedAt: string | null;
};

export type ScenarioPatch = {
  activityId: number;
  rowId: number;
  op: "insert" | "update";
  before: { isPinned?: boolean; deletedAt?: string | null };
  after: { isPinned?: boolean; deletedAt?: string | null };
};

function slotKey(row: Pick<ScenarioSlot, "opportunityId" | "lineId">): string {
  return `${row.opportunityId}:${row.lineId ?? 0}`;
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
    if (patch.before.isPinned !== undefined) {
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
