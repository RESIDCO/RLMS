import { isFrozenRailcar } from "./car-lifecycle-status";

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
