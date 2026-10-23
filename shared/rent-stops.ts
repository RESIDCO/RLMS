/**
 * Rent-stop reasons and the per-car off-rent paste.
 * Stored `reason` is the database check constraint. "Scrap / uneconomical to repair"
 * is kept in `reason_other` so recording scrap does not need a migration.
 */

export const STORED_RENT_STOP_REASONS = ["quality repair", "goodwill", "damage", "dispute", "other"] as const;
export type StoredRentStopReason = (typeof STORED_RENT_STOP_REASONS)[number];

export const SCRAP_STOP_REASON = "Scrap / uneconomical to repair";

/** Choices shown on the rent-stop forms, including the scrap label. */
export const RENT_STOP_REASON_CHOICES = [...STORED_RENT_STOP_REASONS, SCRAP_STOP_REASON] as const;

export const OFF_RENT_PASTE_STORAGE_KEY = "rlms-off-rent-paste";

const STORED = new Set<string>(STORED_RENT_STOP_REASONS);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isStoredRentStopReason(value: unknown): value is StoredRentStopReason {
  return STORED.has(String(value));
}

export function isScrapStopReason(value: unknown): boolean {
  const raw = String(value ?? "").trim();
  return raw === SCRAP_STOP_REASON || raw.toLowerCase() === "scrap";
}

export type RentStopReasonFields = {
  reason: StoredRentStopReason;
  reason_other: string | null;
  note: string | null;
};

/**
 * Map a form choice onto columns the check constraint allows.
 * A named reason keeps its code. Scrap is `other` plus the scrap label.
 * A free-text detail on "other" stays in `reason_other`. Any other detail is the stop note.
 */
export function rentStopReasonFields(
  body: { reason?: unknown; reason_other?: unknown; note?: unknown },
  opts?: { strict?: boolean },
): RentStopReasonFields {
  const raw = String(body.reason ?? "").trim();
  const other = String(body.reason_other ?? "").trim();
  const note = String(body.note ?? "").trim();
  const scrap = isScrapStopReason(raw) || other === SCRAP_STOP_REASON;
  if (scrap) {
    const detail = other && other !== SCRAP_STOP_REASON ? other : "";
    return {
      reason: "other",
      reason_other: SCRAP_STOP_REASON,
      note: note || detail || null,
    };
  }
  if (isStoredRentStopReason(raw)) {
    if (raw === "other") return { reason: raw, reason_other: other || null, note: note || null };
    return { reason: raw, reason_other: null, note: note || other || null };
  }
  if (opts?.strict) {
    throw Object.assign(new Error("invalid reason"), { status: 400 });
  }
  return { reason: "other", reason_other: other || raw || null, note: note || null };
}

export type OffRentPasteRow = {
  car: string;
  stop_date: string | null;
  note: string | null;
};

function isoIn(value: string): string | null {
  const found = value.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return found && ISO_DATE.test(found[1]) ? found[1] : null;
}

/**
 * One car per line: `MARK NUMBER, YYYY-MM-DD[, note]`.
 * Tabs work the same way. A line with no date is kept so the caller can use a fallback date.
 */
export function parseOffRentPaste(text: string): OffRentPasteRow[] {
  const out: OffRentPasteRow[] = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    if (/^car\b/i.test(raw) && /\bdate\b/i.test(raw)) continue;
    const tabs = raw.split("\t").map((part) => part.trim()).filter((part) => part.length > 0);
    const commas = raw.split(",").map((part) => part.trim());
    let car = "";
    let stopDate: string | null = null;
    let note: string | null = null;
    if (tabs.length >= 2 && isoIn(tabs[1])) {
      car = tabs[0];
      stopDate = isoIn(tabs[1]);
      note = tabs.slice(2).join(" ").trim() || null;
    } else if (commas.length >= 2 && isoIn(commas[1] ?? "")) {
      car = commas[0];
      stopDate = isoIn(commas[1] ?? "");
      note = commas.slice(2).join(", ").trim() || null;
    } else {
      const found = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (found && found.index != null) {
        stopDate = found[1];
        car = raw.slice(0, found.index).replace(/[\s,;]+$/g, "").trim();
        note = raw.slice(found.index + found[1].length).replace(/^[\s,;]+/g, "").trim() || null;
      } else {
        car = raw;
      }
    }
    if (!car) continue;
    out.push({ car, stop_date: stopDate, note });
  }
  return out;
}

/** Per-row date wins. The form date fills a row that omitted one. */
export function offRentRowStopDate(rowDate: string | null | undefined, fallback: string | null | undefined): string {
  const per = String(rowDate ?? "").slice(0, 10);
  if (ISO_DATE.test(per)) return per;
  const form = String(fallback ?? "").slice(0, 10);
  return ISO_DATE.test(form) ? form : "";
}
