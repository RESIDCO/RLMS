/** Diff helpers for activity_log before/after payloads. Undo (PR U2) restores only these keys. */

export type ActivityEntityType =
  | "railcar"
  | "rider"
  | "program"
  | "program_car"
  | "master_lease"
  | "account"
  | "opportunity"
  | "crm_activity";

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return true;
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    try {
      return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
    } catch {
      return false;
    }
  }
  if (a instanceof Date || b instanceof Date) {
    return String(a) === String(b);
  }
  return false;
}

function canonicalize(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = canonicalize(obj[k]);
  return out;
}

export function changedKeys(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const left = before && typeof before === "object" ? before : {};
  const right = after && typeof after === "object" ? after : {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const outBefore: Record<string, unknown> = {};
  const outAfter: Record<string, unknown> = {};
  for (const key of keys) {
    const lv = key in left ? left[key] : null;
    const rv = key in right ? right[key] : null;
    if (jsonEqual(lv, rv)) continue;
    outBefore[key] = lv ?? null;
    outAfter[key] = rv ?? null;
  }
  return { before: outBefore, after: outAfter };
}

export function pickRow(row: Record<string, unknown> | null | undefined, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!row) return out;
  for (const key of keys) {
    if (key in row) out[key] = row[key] ?? null;
  }
  return out;
}
