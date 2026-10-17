/** Diff a general program PATCH against the stored row. Close/reopen/cancel dates stay off this path. */

export const PROGRAM_PATCH_ALLOWED = [
  "name",
  "description",
  "status",
  "category_id",
  "tags",
  "entity",
  "account_manager",
  "account_id",
  "status_narrative",
  "target_completion_date",
  "type",
  "type_other",
  "pending_note",
] as const;

export type ProgramPatchKey = (typeof PROGRAM_PATCH_ALLOWED)[number];

export const PROGRAM_PATCH_BLOCKED = [
  "opened_date",
  "closed_date",
  "lifecycle",
  "id",
  "updated_at",
  "created_at",
] as const;

export function normalizeProgramPatchValue(key: string, raw: unknown): unknown {
  if (key === "tags") {
    if (raw == null || raw === "") return null;
    if (!Array.isArray(raw)) return null;
    const tags = raw.map((t) => String(t).trim()).filter(Boolean);
    return tags.length ? tags : null;
  }
  if (key === "target_completion_date") {
    const d = String(raw ?? "").trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  }
  if (key === "category_id" || key === "account_id") {
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (raw == null) return null;
  if (typeof raw === "string") return raw.trim() || null;
  return raw;
}

function samePatchValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffProgramPatch(
  before: Record<string, unknown> | null | undefined,
  body: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const src = body ?? {};
  const prev = before ?? {};
  const out: Record<string, unknown> = {};
  for (const key of PROGRAM_PATCH_ALLOWED) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    if (src[key] === undefined) continue;
    const next = normalizeProgramPatchValue(key, src[key]);
    const old = normalizeProgramPatchValue(key, prev[key]);
    if (!samePatchValue(old, next)) out[key] = next;
  }
  return out;
}
