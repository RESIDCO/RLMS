import { isFrozenRailcar } from "./car-lifecycle-status";
import { formatUsDateTimeEt } from "./display-date";

export const INACTIVE_CAR_NOTE_MESSAGE =
  "Inactive cars are read-only. An admin can reactivate them with a reason.";

export type NoteWriteDecision =
  | { ok: true }
  | { ok: false; status: 404 | 409; message: string };

/** Lineage notes refuse a missing car and an inactive car before any write. */
export function noteWriteDecision(car: {
  id?: number | null;
  active?: boolean | null;
  status?: string | null;
} | null | undefined): NoteWriteDecision {
  if (!car || !Number.isFinite(Number(car.id)) || Number(car.id) <= 0) {
    return { ok: false, status: 404, message: "Car not found" };
  }
  if (isFrozenRailcar(car)) {
    return { ok: false, status: 409, message: INACTIVE_CAR_NOTE_MESSAGE };
  }
  return { ok: true };
}

/** Append a timestamped line. The previous text stays. */
export type LastNote = {
  text: string;
  /** Activity timestamp, or the stamp already written on the notes line. */
  at: string | null;
};

const STAMPED_LINE = /^\[([^\]]+)\]\s*(.*)$/;

/** Last non-empty line of railcars.notes. A `[stamp] text` line keeps the stamp. */
export function lastNoteFromNotes(notes: string | null | undefined): LastNote | null {
  const lines = String(notes ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = STAMPED_LINE.exec(lines[i]);
    if (match) {
      const text = match[2].trim();
      if (text) return { text, at: match[1].trim() || null };
      continue;
    }
    return { text: lines[i], at: null };
  }
  return null;
}

/**
 * Prefer the latest activity `note` body. Otherwise the last line of railcars.notes,
 * which addNote() keeps in sync.
 */
export function resolveLastNote(input: {
  notes?: string | null;
  activityBody?: string | null;
  activityAt?: string | null;
}): LastNote | null {
  const body = String(input.activityBody ?? "").trim();
  if (body) {
    const at = String(input.activityAt ?? "").trim();
    return { text: body, at: at || null };
  }
  return lastNoteFromNotes(input.notes);
}

export function lastNoteForRow(row: {
  notes?: string | null;
  latest_note?: string | null;
  latest_note_at?: string | null;
} | null | undefined): LastNote | null {
  if (!row) return null;
  return resolveLastNote({
    notes: row.notes,
    activityBody: row.latest_note,
    activityAt: row.latest_note_at,
  });
}

export function formatLastNoteWhen(at: string | null | undefined): string {
  const raw = String(at ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return formatUsDateTimeEt(raw);
  return raw;
}

function sortableStamp(at: string | null): string {
  const raw = String(at ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
  if (!match) return raw;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

/** ISO-like date first so column sort is chronological, then the note text. */
export function lastNoteSortKey(note: LastNote | null): string {
  if (!note) return "";
  return `${sortableStamp(note.at)}\t${note.text}`;
}

export function appendTimestampedNote(
  existing: string | null | undefined,
  body: string,
  stamp: string,
): string {
  const text = String(body ?? "").trim();
  if (!text) {
    throw Object.assign(new Error("Note text is required"), { status: 400 });
  }
  const when = String(stamp ?? "").trim() || "undated";
  const line = `[${when}] ${text}`;
  const prev = String(existing ?? "").trim();
  return prev ? `${prev}\n${line}` : line;
}

export type ActivityNoiseRow = {
  action?: string | null;
  actor?: string | null;
  source?: string | null;
  detail?: { reason?: string | null } | null;
};

export function isVcfAssignmentNoise(row: ActivityNoiseRow): boolean {
  if (row.action !== "reassignment") return false;
  const actor = String(row.actor ?? "");
  const source = String(row.source ?? "");
  const reason = String(row.detail?.reason ?? "");
  return source === "vcf-import" || actor === "vcf-import" || /V_VALID_CARS assignment period/i.test(reason);
}

/**
 * Drop VCF assignment noise first, then apply the row cap.
 * Capping the raw page and filtering afterward would hide real events
 * that sit just past a noisy head of the log.
 */
export function capActivityEvents<T>(
  rows: readonly T[],
  limit: number,
  includeVcfNoise: boolean,
  isNoise: (row: T) => boolean = (row) => isVcfAssignmentNoise(row as ActivityNoiseRow),
): T[] {
  const cap = Math.min(Math.max(Math.floor(limit) || 1, 1), 1000);
  const kept: T[] = [];
  for (const row of rows) {
    if (!includeVcfNoise && isNoise(row)) continue;
    kept.push(row);
    if (kept.length >= cap) break;
  }
  return kept;
}
