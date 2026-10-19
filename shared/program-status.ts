/** One status list for the per-car dropdown and the bulk bar. */

export type StatusCatalogRow = { value: string; sort_order?: number | null };

export function isCompleteProgramStatus(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return false;
  return s.startsWith("complete") || s === "program done" || s === "done";
}

/** A status that is not a Complete/Program done label. Empty is not complete. */
export function statusLeavesComplete(nextStatus: string | null | undefined): boolean {
  return !isCompleteProgramStatus(nextStatus);
}

/**
 * Catalog order first, then statuses already on cars in this program.
 * Both controls render this list, so a value Bruce can pick on one car
 * is the same value the bulk bar offers.
 */
export function mergeProgramStatusOptions(
  catalog: readonly StatusCatalogRow[],
  inUse: readonly (string | null | undefined)[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const catalogSorted = [...catalog].sort(
    (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || a.value.localeCompare(b.value),
  );
  for (const row of catalogSorted) {
    const value = String(row.value ?? "").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  const extras = inUse
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  for (const value of extras) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}
