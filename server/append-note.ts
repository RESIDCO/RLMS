import { addNote } from "./activity-log";

export const ADD_NOTE_PLACEHOLDER =
  "Added to the Activity timeline with a timestamp; earlier notes are kept";

export function normalizeAppendNote(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/** Drop a raw notes column so a PATCH cannot overwrite railcars.notes or riders.notes. */
export function stripNotesField<T extends Record<string, unknown>>(row: T): T {
  if (row && Object.prototype.hasOwnProperty.call(row, "notes")) delete row.notes;
  return row;
}

export type NoteSkip = { id: number; status: number; message: string };

export type NoteAppendReport = { appended: number[]; skipped: NoteSkip[] };

export type NoteWriter = (opts: {
  entity_type: "railcar" | "rider";
  entity_id: number;
  body: string;
  actor?: string | null;
}) => Promise<unknown>;

/**
 * Append one timestamped note per id by calling addNote().
 * Call this inside an existing withChangeGroupResult: addNote joins that group,
 * so one Undo reverses the edit and the note together.
 * Empty text is skipped. An inactive car (409) is skipped and reported.
 */
export async function appendNotesInGroup(
  opts: {
    entityType: "railcar" | "rider";
    ids: number[];
    note: unknown;
    actor?: string | null;
  },
  write: NoteWriter = addNote,
): Promise<NoteAppendReport> {
  const body = normalizeAppendNote(opts.note);
  if (!body) return { appended: [], skipped: [] };
  const appended: number[] = [];
  const skipped: NoteSkip[] = [];
  const seen = new Set<number>();
  for (const raw of opts.ids) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    try {
      await write({
        entity_type: opts.entityType,
        entity_id: id,
        body,
        actor: opts.actor ?? null,
      });
      appended.push(id);
    } catch (err) {
      const status = Number((err as { status?: number })?.status) || 0;
      if (status === 409) {
        skipped.push({
          id,
          status: 409,
          message: err instanceof Error ? err.message : "Inactive cars are read-only",
        });
        continue;
      }
      throw err;
    }
  }
  return { appended, skipped };
}

/** Attach the note report only when the caller sent a note, so empty saves stay unchanged. */
export function withNoteReport<T extends object>(
  result: T,
  note: unknown,
  report: NoteAppendReport,
): T & { note_appended?: number[]; note_skipped?: NoteSkip[] } {
  if (!normalizeAppendNote(note)) return result;
  return { ...result, note_appended: report.appended, note_skipped: report.skipped };
}
