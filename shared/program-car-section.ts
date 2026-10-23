import { PROGRAM_KEEP_OPEN_CF, frozenProgramCarAcceptsPatch, programCarKeepOpen } from "./programs";
import { formatProgramDate, parseProgramDateInput } from "./program-dates";
import { isCompleteProgramStatus, statusLeavesComplete } from "./program-status";

/** Program-car row fields the side panel can diff into a patch. */
export type ProgramCarSectionSource = {
  status?: string | null;
  notes?: string | null;
  milestone?: string | null;
  milestone_at?: string | null;
  shop_id?: number | null;
  outcome_reached_at?: string | null;
  completed?: boolean;
  custom_fields?: Record<string, unknown> | null;
  exited_date?: string | null;
  railcar?: {
    active?: boolean | null;
    status?: string | null;
    ops_flag?: string | null;
    scrapped_at?: string | null;
  } | null;
};

export type ProgramCarSectionEdit = {
  status: string;
  notes: string;
  milestone: string;
  milestoneAt: string;
  shopId: number | null;
  outcomeReached: boolean;
  keepOpen: boolean;
};

export type ProgramCarActionMode = "expanded" | "collapsed";
export type CommitmentScope = "car" | "program" | "default";

const UPDATE_LABELS: Record<string, string> = {
  status: "Status",
  notes: "Notes",
  milestone: "Milestone",
  milestone_at: "Milestone date",
  shop_id: "Shop / yard",
  outcome_reached: "Outcome",
  completed: "Outcome",
  flag_tag: "Flag",
};

/**
 * True when the side panel is holding edits that switching cars, or closing
 * the sheet, would throw away. The same car does not discard.
 */
export function programCarSectionSwitchBlocked(
  currentCarId: number | null,
  dirty: boolean,
  nextCarId: number | null,
): boolean {
  if (!dirty || currentCarId == null) return false;
  return nextCarId !== currentCarId;
}

/** The program block renders only when a program and its car row are both present. */
export function programCarSectionVisible(
  context: { programId?: number | null; car?: unknown } | null | undefined,
): boolean {
  if (!context || context.car == null) return false;
  const programId = Number(context.programId);
  return Number.isFinite(programId) && programId > 0;
}

/**
 * Status, milestone, shop, notes, and outcome follow the grid:
 * viewers and exited rows are read-only, and a frozen fleet car stays
 * read-only until Keep open is already on.
 */
export function programCarFieldsEditable(input: {
  canEdit: boolean;
  exited: boolean;
  active?: boolean | null;
  railcarStatus?: string | null;
  customFields?: unknown;
}): boolean {
  if (!input.canEdit || input.exited) return false;
  return frozenProgramCarAcceptsPatch(
    {
      active: input.active,
      railcar_status: input.railcarStatus,
      custom_fields: input.customFields,
    },
    null,
  );
}

/** Keep open stays available on a frozen car. An exited row does not. */
export function programCarKeepOpenEditable(input: { canEdit: boolean; exited: boolean }): boolean {
  return input.canEdit && !input.exited;
}

export function programCarSectionCanSave(input: { canEdit: boolean; exited: boolean }): boolean {
  return programCarKeepOpenEditable(input);
}

/** Opened from a program, car-level Rent start and Move stay behind an expander. */
export function programCarActionMode(fromProgram: boolean): ProgramCarActionMode {
  return fromProgram ? "collapsed" : "expanded";
}

export function commitmentScopeLabel(scope: CommitmentScope): string {
  switch (scope) {
    case "car":
      return "Car commitment";
    case "program":
      return "Program commitment";
    case "default":
      return "Commitment";
    default: {
      const _never: never = scope;
      return _never;
    }
  }
}

export function programCarSectionEdit(source: ProgramCarSectionSource): ProgramCarSectionEdit {
  return {
    status: source.status ?? "",
    notes: source.notes ?? "",
    milestone: source.milestone ?? "",
    milestoneAt: formatProgramDate(source.milestone_at),
    shopId: source.shop_id ?? null,
    outcomeReached: Boolean(source.outcome_reached_at || source.completed),
    keepOpen: programCarKeepOpen(source.custom_fields),
  };
}

/** Changes when the stored row changes, so the open panel remounts after a save. */
export function programCarSectionVersion(source: ProgramCarSectionSource): string {
  return [
    source.status ?? "",
    source.notes ?? "",
    source.milestone ?? "",
    String(source.milestone_at ?? "").slice(0, 10),
    source.shop_id ?? "",
    source.outcome_reached_at ?? "",
    source.completed ? "1" : "0",
    programCarKeepOpen(source.custom_fields) ? "1" : "0",
  ].join("|");
}

function sameText(next: string, prior: string | null | undefined): boolean {
  return next.trim() === String(prior ?? "").trim();
}

function sameDate(next: string, prior: string | null | undefined): boolean {
  const left = parseProgramDateInput(next);
  const right = parseProgramDateInput(String(prior ?? ""));
  if (left === undefined || right === undefined) return next.trim() === String(prior ?? "").trim();
  return (left ?? "") === (right ?? "");
}

type SaveGate = {
  canEdit: boolean;
  exited: boolean;
  active?: boolean | null;
  railcarStatus?: string | null;
  customFields?: unknown;
};

/**
 * Patch that the Save button is allowed to preview.
 * Viewers and exited rows save nothing. A frozen car can save Keep open only.
 */
export function programCarSectionSavePatch(
  source: ProgramCarSectionSource,
  edit: ProgramCarSectionEdit,
  gate: SaveGate,
): Record<string, unknown> | null {
  if (!programCarSectionCanSave(gate)) return null;
  const full = programCarSectionPatch(source, edit);
  if (!full) return null;
  if (programCarFieldsEditable(gate)) return full;
  const fields = full.custom_fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
  return { custom_fields: fields };
}

/**
 * Diff the panel form against the last saved program-car row.
 * Empty means there is nothing to preview. Scrap flag, scrapped date,
 * completion, active, KPI, and the program commitment are not patch fields.
 */
export function programCarSectionPatch(
  source: ProgramCarSectionSource,
  edit: ProgramCarSectionEdit,
): Record<string, unknown> | null {
  const updates: Record<string, unknown> = {};
  const status = edit.status.trim();
  const priorStatus = String(source.status ?? "");
  if (status !== priorStatus.trim()) {
    updates.status = status;
    if (isCompleteProgramStatus(priorStatus) && statusLeavesComplete(status)) {
      updates.outcome_reached = false;
      updates.completed = false;
    }
  }
  if (!sameText(edit.notes, source.notes)) updates.notes = edit.notes;
  if (!sameText(edit.milestone, source.milestone)) updates.milestone = edit.milestone;
  if (!sameDate(edit.milestoneAt, source.milestone_at)) updates.milestone_at = edit.milestoneAt.trim();
  if ((edit.shopId ?? null) !== (source.shop_id ?? null)) updates.shop_id = edit.shopId;
  const priorOutcome = Boolean(source.outcome_reached_at || source.completed);
  if (updates.outcome_reached === undefined && edit.outcomeReached !== priorOutcome) {
    updates.outcome_reached = edit.outcomeReached;
  }
  if (edit.keepOpen !== programCarKeepOpen(source.custom_fields)) {
    updates.custom_fields = { [PROGRAM_KEEP_OPEN_CF]: edit.keepOpen };
  }
  return Object.keys(updates).length ? updates : null;
}

/** Body for POST /api/programs/:id/cars/patch/preview. One car, one updates object. */
export function programCarPatchBody(linkId: number, updates: Record<string, unknown>): {
  items: { link_id: number; updates: Record<string, unknown> }[];
} {
  return { items: [{ link_id: linkId, updates }] };
}

export function programCarPatchPreviewPath(programId: number): string {
  return `/api/programs/${programId}/cars/patch/preview`;
}

export function programCarPatchApplyPath(programId: number): string {
  return `/api/programs/${programId}/cars/patch/apply`;
}

function shownValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (value === true) return "Yes";
  if (value === false) return "No";
  return String(value);
}

/** Lines for the preview dialog. One entry per changed field. */
export function describeProgramCarUpdates(updates: Record<string, unknown> | null | undefined): string[] {
  if (!updates) return [];
  const lines: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key === "custom_fields" && value && typeof value === "object" && !Array.isArray(value)) {
      const fields = value as Record<string, unknown>;
      if (PROGRAM_KEEP_OPEN_CF in fields) {
        lines.push(`Keep open: ${fields[PROGRAM_KEEP_OPEN_CF] ? "Yes" : "No"}`);
      }
      for (const [fieldKey, fieldValue] of Object.entries(fields)) {
        if (fieldKey === PROGRAM_KEEP_OPEN_CF) continue;
        lines.push(`${fieldKey}: ${shownValue(fieldValue)}`);
      }
      continue;
    }
    lines.push(`${UPDATE_LABELS[key] ?? key}: ${shownValue(value)}`);
  }
  return lines;
}
