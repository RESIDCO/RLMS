/** Watch / exception flags on a railcar. Independent of rental status and active. */

export const OPS_FLAG_PRESETS = [
  "Scrap",
  "Shop",
  "Wreck",
  "Bad Order",
  "Lost",
  "Program",
  "Interchange",
] as const;

export type OpsFlagPreset = (typeof OPS_FLAG_PRESETS)[number];

export function formatOpsFlag(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

export function opsFlagFamily(raw: string | null | undefined): OpsFlagPreset | "Other" | null {
  const s = formatOpsFlag(raw);
  if (!s) return null;
  if (/^interchange\b/i.test(s)) return "Interchange";
  const hit = OPS_FLAG_PRESETS.find((p) => p.toLowerCase() === s.toLowerCase());
  return hit ?? "Other";
}

export function interchangeRoad(raw: string | null | undefined): string {
  const s = formatOpsFlag(raw);
  if (!s || !/^interchange\b/i.test(s)) return "";
  return s.replace(/^interchange\s*/i, "").trim();
}

export function composeOpsFlag(preset: string, extra?: string): string | null {
  const p = String(preset ?? "").trim();
  if (!p || p === "none" || p === "None") return null;
  if (p === "Interchange") {
    const road = String(extra ?? "").trim();
    return road ? `Interchange ${road}` : "Interchange";
  }
  if (p === "Other" || p === "Custom") {
    const custom = String(extra ?? "").trim();
    return custom || null;
  }
  return p;
}

/** Stored in comment_event_note until railcars.ops_flag exists. */
export const OPS_FLAG_FALLBACK_PREFIX = "#RLMSFLAG ";
export const OPS_FLAG_FALLBACK_SUFFIX = "#";

export function parseOpsFlagFallback(comment: string | null | undefined): { flag: string | null; rest: string } {
  const s = String(comment ?? "");
  if (!s.startsWith(OPS_FLAG_FALLBACK_PREFIX)) return { flag: null, rest: s };
  const end = s.indexOf(OPS_FLAG_FALLBACK_SUFFIX, OPS_FLAG_FALLBACK_PREFIX.length);
  if (end < 0) return { flag: null, rest: s };
  const flag = s.slice(OPS_FLAG_FALLBACK_PREFIX.length, end).trim() || null;
  let rest = s.slice(end + OPS_FLAG_FALLBACK_SUFFIX.length);
  if (rest.startsWith("\n")) rest = rest.slice(1);
  return { flag, rest };
}

export function encodeOpsFlagFallback(comment: string | null | undefined, flag: string | null | undefined): string | null {
  const rest = parseOpsFlagFallback(comment).rest;
  const formatted = formatOpsFlag(flag);
  if (!formatted) return rest.trim() ? rest : null;
  const line = `${OPS_FLAG_FALLBACK_PREFIX}${formatted}${OPS_FLAG_FALLBACK_SUFFIX}`;
  return rest.trim() ? `${line}\n${rest}` : line;
}

export function hydrateOpsFlag<T extends Record<string, unknown>>(row: T): T & { ops_flag: string | null } {
  const parsed = parseOpsFlagFallback(row.comment_event_note as string | null | undefined);
  const ops_flag = formatOpsFlag(row.ops_flag as string | null | undefined) ?? parsed.flag;
  return {
    ...row,
    ops_flag,
    comment_event_note: parsed.rest || null,
  };
}

export function opsFlagMatchesFilter(value: string | null | undefined, filter: string | undefined): boolean {
  if (!filter || filter === "all") return true;
  const formatted = formatOpsFlag(value);
  if (filter === "none") return !formatted;
  if (filter === "any") return Boolean(formatted);
  if (filter.toLowerCase() === "interchange") {
    return Boolean(formatted && /^interchange\b/i.test(formatted));
  }
  return (formatted ?? "").toLowerCase() === filter.toLowerCase();
}
