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
