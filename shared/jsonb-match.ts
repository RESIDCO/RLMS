/** Text comparison used by public.rlms_jsonb_key_matches. Numbers keep their jsonb text, so 0 and 0.00 differ. */

function arrowText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** One key that is present on the logged `after` object. */
export function jsonbKeyMatches(current: unknown, expected: unknown): boolean {
  if (expected == null) {
    const cur = arrowText(current);
    return cur == null || cur === "";
  }
  if (typeof expected === "boolean") {
    const cur = arrowText(current) ?? "";
    return expected ? cur === "true" || cur === "t" : cur === "false" || cur === "f";
  }
  const cur = arrowText(current) ?? "";
  const exp = arrowText(expected) ?? "";
  return cur.slice(0, 10) === exp.slice(0, 10) || cur === exp;
}

/** First logged key whose current text does not match, or null when undo can proceed. */
export function firstChangedSinceKey(
  current: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string | null {
  if (!after) return null;
  const cur = current ?? {};
  for (const [key, expected] of Object.entries(after)) {
    if (!jsonbKeyMatches(cur[key], expected)) return key;
  }
  return null;
}
