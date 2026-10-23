import { changedKeys, jsonEqual, pickRow } from "@shared/change-log";
import { formatProgramDate, parseProgramDateInput } from "@shared/program-dates";
import { patchColumns } from "@shared/program-car-patch";
import { moneyNumber, parseUsdInput } from "@shared/money";

/** Pending edits for the Program Detail cars grid, keyed by program_cars id. */
export type CarDraftMap = Record<number, Record<string, unknown>>;

export type CarBaseline = {
  milestone?: string | null;
  milestone_at?: string | null;
  status?: string | null;
  notes?: string | null;
  flag_tag?: string | null;
  shop_id?: number | null;
  scrap_yard_id?: number | null;
  repair_cost_total?: number | null;
  outcome_reached_at?: string | null;
  completed?: boolean;
  custom_fields?: Record<string, unknown> | null;
};

export type SaveCarItem = { link_id: number; updates: Record<string, unknown> };

export type CarSavePlan = {
  items: SaveCarItem[];
  /** Cars whose patch would write. Includes cars the grid filter is hiding. */
  count: number;
  /** Draft map with no-op patches removed. */
  retained: CarDraftMap;
};

export type SaveCountPhase = "confirm" | "saving" | "saved";

export type FlushResult = "queued" | "unchanged" | "invalid";

export type SaveOutcome = "saved" | "no_changes" | "error";

export function mergeCarPatch(cur: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...cur, ...patch };
  if (patch.custom_fields && typeof patch.custom_fields === "object") {
    next.custom_fields = {
      ...((cur.custom_fields && typeof cur.custom_fields === "object" ? cur.custom_fields : {}) as Record<string, unknown>),
      ...(patch.custom_fields as Record<string, unknown>),
    };
  }
  return next;
}

function baselineRow(car: CarBaseline): Record<string, unknown> {
  return {
    milestone: car.milestone ?? null,
    milestone_at: car.milestone_at ?? null,
    status: car.status ?? null,
    notes: car.notes ?? null,
    flag_tag: car.flag_tag ?? null,
    shop_id: car.shop_id ?? null,
    scrap_yard_id: car.scrap_yard_id ?? null,
    repair_cost_total: car.repair_cost_total ?? null,
    outcome_reached_at: car.outcome_reached_at ?? null,
    custom_fields: car.custom_fields && typeof car.custom_fields === "object" ? car.custom_fields : {},
  };
}

function commitmentPending(patch: Record<string, unknown>): boolean {
  const raw = patch.commitment;
  if (!raw || typeof raw !== "object") return false;
  return String((raw as { name?: unknown }).name ?? "").trim().length > 0;
}

/**
 * True when this patch would change the loaded car the way the save endpoint
 * decides "updated". Patches that only repeat the loaded row are not dirty,
 * so the Saving N cars count cannot include them.
 */
export function draftDiffers(car: CarBaseline, patch: Record<string, unknown> | undefined): boolean {
  if (!patch || Object.keys(patch).length === 0) return false;
  const prior = baselineRow(car);
  const cols = patchColumns(patch, prior);
  const keys = Object.keys(cols);
  if (keys.length) {
    const diff = changedKeys(pickRow(prior, keys), pickRow({ ...prior, ...cols }, keys));
    if (Object.keys(diff.before).length > 0) return true;
  }
  return commitmentPending(patch);
}

/**
 * Ids whose draft would change the loaded row. A draft with no loaded row
 * still counts, so hiding exited cars cannot drop it from Save or the leave guard.
 */
export function unsavedDraftIds(
  drafts: CarDraftMap,
  baselines: ReadonlyMap<number, CarBaseline>,
): number[] {
  const ids = Object.keys(drafts)
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id))
    .sort((a, b) => a - b);
  const unsaved: number[] = [];
  for (const linkId of ids) {
    const updates = drafts[linkId];
    if (!updates || Object.keys(updates).length === 0) continue;
    const baseline = baselines.get(linkId);
    if (baseline && !draftDiffers(baseline, updates)) continue;
    unsaved.push(linkId);
  }
  return unsaved;
}

/** Every differing draft is saved. Visibility is not an input. */
export function planCarSave(
  drafts: CarDraftMap,
  baselines: ReadonlyMap<number, CarBaseline>,
): CarSavePlan {
  const retained: CarDraftMap = {};
  const items: SaveCarItem[] = [];
  for (const linkId of unsavedDraftIds(drafts, baselines)) {
    const updates = drafts[linkId];
    if (!updates) continue;
    retained[linkId] = updates;
    items.push({ link_id: linkId, updates });
  }
  return { items, count: items.length, retained };
}

export function saveCarCountLabel(count: number, phase: SaveCountPhase): string {
  const noun = `${count} car${count === 1 ? "" : "s"}`;
  switch (phase) {
    case "confirm":
      return `Save ${noun}?`;
    case "saving":
      return `Saving ${noun}…`;
    case "saved":
      return `Saved ${noun}`;
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}

/**
 * Dirty rows stay on the grid. Text search, the paste list, and the completion
 * chips can hide a clean row only.
 */
export function programCarStaysVisible(input: {
  matchesText: boolean;
  pasteActive: boolean;
  matchesPaste: boolean;
  applyLevelFilter: boolean;
  levelSelected: boolean;
  dirty: boolean;
}): boolean {
  if (input.dirty) return true;
  if (!input.matchesText) return false;
  if (input.pasteActive && !input.matchesPaste) return false;
  if (input.applyLevelFilter && !input.levelSelected) return false;
  return true;
}

/** Keep every draft unless the server actually stored the patch we sent. */
export function draftsAfterSave(drafts: CarDraftMap, sent: readonly SaveCarItem[], outcome: SaveOutcome): CarDraftMap {
  switch (outcome) {
    case "no_changes":
    case "error":
      return drafts;
    case "saved": {
      const next: CarDraftMap = { ...drafts };
      for (const item of sent) {
        const current = next[item.link_id];
        if (!current) continue;
        if (jsonEqual(current, item.updates)) delete next[item.link_id];
      }
      return next;
    }
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

export function patchApplyMadeNoChanges(applied: {
  no_changes?: boolean;
  updated?: number;
  commitments_written?: number;
}): boolean {
  if (applied.no_changes === true) return true;
  return Number(applied.updated ?? 0) === 0 && Number(applied.commitments_written ?? 0) === 0;
}

export function saveFailureToast(message: unknown): { title: string; description: string; variant: "destructive" } {
  const detail = typeof message === "string" && message.trim() ? message.trim() : "The cars were not saved.";
  return {
    title: "Save failed",
    description: `${detail} Your edits are still on the grid.`,
    variant: "destructive",
  };
}

export function keptEditsToast(): { title: string; description: string } {
  return {
    title: "No changes saved",
    description: "Your edits are still on the grid.",
  };
}

export function emptySaveToast(invalid: boolean): { title: string; description?: string } {
  if (invalid) {
    return {
      title: "Couldn't read the value you're editing",
      description: "That text is still in the cell.",
    };
  }
  return { title: "No changes" };
}

/** Value to store for a money cell, or a sentinel when the keystrokes are not a new amount. */
export function moneyPatchValue(current: unknown, raw: string): number | null | "invalid" | "unchanged" {
  const parsed = parseUsdInput(raw);
  if (parsed === undefined) return "invalid";
  if (parsed === moneyNumber(current)) return "unchanged";
  return parsed;
}

export function datePatchValue(
  current: unknown,
  raw: string,
  allowMonthOnly: boolean,
): string | null | "invalid" | "unchanged" {
  const parsed = parseProgramDateInput(raw);
  if (parsed === undefined) return "invalid";
  if (parsed && !allowMonthOnly && parsed.length !== 10) return "invalid";
  const currentShown = formatProgramDate(current);
  if ((parsed == null && !currentShown) || formatProgramDate(parsed) === currentShown) return "unchanged";
  return parsed;
}

export function textPatchValue(current: string, raw: string): string | "unchanged" {
  if (raw === current) return "unchanged";
  return raw;
}

type DraftSnapshot = { drafts: CarDraftMap; editorPending: boolean };

export type ProgramCarDraftSession = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => DraftSnapshot;
  getDrafts: () => CarDraftMap;
  queue: (linkId: number, patch: Record<string, unknown>) => void;
  replaceDrafts: (next: CarDraftMap) => void;
  clearLinks: (ids: readonly number[]) => void;
  register: (id: number, flush: () => FlushResult) => () => void;
  setPending: (id: number, pending: boolean) => void;
  flushEditors: () => { invalid: boolean };
  beginSave: () => boolean;
  endSave: () => void;
  commitSave: (sent: readonly SaveCarItem[], outcome: SaveOutcome) => void;
};

export function createProgramCarDraftSession(): ProgramCarDraftSession {
  let drafts: CarDraftMap = {};
  let snapshot: DraftSnapshot = { drafts, editorPending: false };
  let saving = false;
  const listeners = new Set<() => void>();
  const editors = new Map<number, () => FlushResult>();
  const pendingIds = new Set<number>();

  function publish() {
    snapshot = { drafts, editorPending: pendingIds.size > 0 };
    for (const listener of Array.from(listeners)) listener();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    getDrafts() {
      return drafts;
    },
    queue(linkId, patch) {
      drafts = { ...drafts, [linkId]: mergeCarPatch(drafts[linkId] ?? {}, patch) };
      publish();
    },
    replaceDrafts(next) {
      drafts = next;
      publish();
    },
    clearLinks(ids) {
      if (!ids.length) return;
      const next = { ...drafts };
      let changed = false;
      for (const id of ids) {
        if (Object.prototype.hasOwnProperty.call(next, id)) {
          delete next[id];
          changed = true;
        }
      }
      if (!changed) return;
      drafts = next;
      publish();
    },
    register(id, flush) {
      editors.set(id, flush);
      return () => {
        if (editors.get(id) === flush) editors.delete(id);
        if (pendingIds.delete(id)) publish();
      };
    },
    setPending(id, pending) {
      const had = pendingIds.has(id);
      if (pending) pendingIds.add(id);
      else pendingIds.delete(id);
      if (had !== pending) publish();
    },
    flushEditors() {
      let invalid = false;
      for (const flush of Array.from(editors.values())) {
        const result = flush();
        if (result === "invalid") invalid = true;
      }
      return { invalid };
    },
    beginSave() {
      if (saving) return false;
      saving = true;
      return true;
    },
    endSave() {
      saving = false;
    },
    commitSave(sent, outcome) {
      const next = draftsAfterSave(drafts, sent, outcome);
      if (next === drafts) return;
      drafts = next;
      publish();
    },
  };
}

