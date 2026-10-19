import type { ProgramFieldType } from "./programs";

export const MANAGE_COLUMN_TYPES = ["text", "number", "currency", "date", "checkbox", "select"] as const;
export type ManageColumnType = (typeof MANAGE_COLUMN_TYPES)[number];

export const MANAGE_COLUMN_SCOPES = ["program", "global"] as const;
export type ManageColumnScope = (typeof MANAGE_COLUMN_SCOPES)[number];

export type ManagedFieldDef = {
  field_key: string;
  label: string;
  field_type?: string | null;
  category_id?: number | null;
  program_id?: number | null;
  retired_at?: string | null;
  is_optional?: boolean | null;
};

export function isManageColumnType(raw: string): raw is ManageColumnType {
  return (MANAGE_COLUMN_TYPES as readonly string[]).includes(raw);
}

export function fieldTypeForColumn(type: ManageColumnType): ProgramFieldType {
  switch (type) {
    case "checkbox":
      return "boolean";
    case "text":
    case "number":
    case "currency":
    case "date":
    case "select":
      return type;
    default: {
      const exhaustive: never = type;
      throw new Error(`Unknown column type ${String(exhaustive)}`);
    }
  }
}

export function columnTypeFromField(fieldType: string | null | undefined): ManageColumnType {
  if (fieldType === "boolean") return "checkbox";
  if (isManageColumnType(String(fieldType ?? ""))) return fieldType as ManageColumnType;
  return "text";
}

export function fieldKeyFromLabel(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return base || "column";
}

/** Stable key. A rename never calls this again, so existing custom_fields stay linked. */
export function uniqueFieldKey(label: string, taken: Iterable<string>): string {
  const base = fieldKeyFromLabel(label);
  const used = new Set(Array.from(taken, (key) => key.toLowerCase()));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  const suffix = `_${n}`;
  return `${base.slice(0, Math.max(1, 48 - suffix.length))}${suffix}`;
}

export function normalizeSelectOptions(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : String(raw ?? "").split(/\r?\n|,/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const value = String(part ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function isRetiredField(def: { retired_at?: string | null }): boolean {
  return String(def.retired_at ?? "").trim() !== "";
}

/** Grid, column picker, and export omit retired definitions. Show retired is a separate list. */
export function activeFieldDefs<T extends { retired_at?: string | null }>(defs: readonly T[]): T[] {
  return defs.filter((def) => !isRetiredField(def));
}

export function fieldScope(def: ManagedFieldDef): ManageColumnScope | "category" {
  if (def.program_id != null) return "program";
  if (def.category_id != null) return "category";
  return "global";
}

function scopeRank(def: ManagedFieldDef): number {
  if (def.program_id != null) return 3;
  if (def.category_id != null) return 2;
  return 1;
}

/** An active definition wins over a retired one. Otherwise the narrower scope wins. */
export function preferFieldDef(candidate: ManagedFieldDef, current: ManagedFieldDef): boolean {
  const candidateRetired = isRetiredField(candidate);
  const currentRetired = isRetiredField(current);
  if (candidateRetired !== currentRetired) return !candidateRetired;
  return scopeRank(candidate) > scopeRank(current);
}

export function fieldDefsForProgram<T extends ManagedFieldDef & { id?: number; sort_order?: number | null }>(
  rows: readonly T[],
  programId: number,
  categoryId: number | null,
): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    if (!defVisibleOnProgram(row, programId, categoryId)) continue;
    const existing = byKey.get(row.field_key);
    if (!existing || preferFieldDef(row, existing)) byKey.set(row.field_key, row);
  }
  return Array.from(byKey.values()).sort(
    (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0),
  );
}

export function defVisibleOnProgram(
  def: ManagedFieldDef,
  programId: number,
  categoryId: number | null,
): boolean {
  if (def.program_id != null) return Number(def.program_id) === programId;
  if (def.category_id != null) return categoryId != null && Number(def.category_id) === categoryId;
  return true;
}
