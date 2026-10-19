/**
 * Editable fleet-search aliases. Bruce can correct these later.
 * A pattern ending in * is a prefix (C* → car types starting with C).
 * Patterns without * are exact, case-insensitive matches.
 */

export type CarTypeAlias = {
  id: string;
  /** Whole-query phrases, compared case-insensitively. */
  phrases: string[];
  /** Shown in the UI so the match is never a black box. */
  label: string;
  carTypes: string[];
  mechanical: string[];
  aar: string[];
};

export const CAR_TYPE_ALIASES: CarTypeAlias[] = [
  {
    id: "covered-hopper",
    phrases: ["covered hopper", "covered hoppers"],
    label: "covered hopper → mechanical LO or car type C*",
    carTypes: ["C*"],
    mechanical: ["LO"],
    aar: [],
  },
  {
    id: "tub-gon",
    phrases: ["tub gon", "tub gondola", "tub gondolas"],
    label: "tub gon → car type J31*",
    carTypes: ["J31*"],
    mechanical: [],
    aar: [],
  },
  {
    id: "gondola",
    phrases: ["gon", "gondola", "gondolas"],
    label: "gondola → car type G* or J*, mechanical GB* or GT*",
    carTypes: ["G*", "J*"],
    mechanical: ["GB*", "GT*"],
    aar: [],
  },
  {
    id: "tank",
    phrases: ["tank", "tanks"],
    label: "tank → car type T*",
    carTypes: ["T*"],
    mechanical: [],
    aar: [],
  },
];

export type FleetQueryClass =
  | { kind: "alias"; rule: CarTypeAlias }
  | { kind: "car_type"; code: string }
  | { kind: "mechanical"; code: string }
  | { kind: "text" };

export function normalizeFleetPhrase(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Longest exact phrase wins. "tub gon" does not fall through to "gon". */
export function matchCarTypeAlias(raw: string): CarTypeAlias | null {
  const q = normalizeFleetPhrase(raw);
  if (!q) return null;
  let best: { rule: CarTypeAlias; len: number } | null = null;
  for (const rule of CAR_TYPE_ALIASES) {
    for (const phrase of rule.phrases) {
      const norm = normalizeFleetPhrase(phrase);
      if (q === norm && (!best || norm.length > best.len)) {
        best = { rule, len: norm.length };
      }
    }
  }
  return best?.rule ?? null;
}

export function classifyFleetQuery(raw: string): FleetQueryClass {
  const q = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!q) return { kind: "text" };
  const rule = matchCarTypeAlias(q);
  if (rule) return { kind: "alias", rule };
  if (/^[A-Za-z]\d{3}$/.test(q)) return { kind: "car_type", code: q.toUpperCase() };
  if (/^[A-Za-z]{1,4}$/.test(q)) return { kind: "mechanical", code: q.toUpperCase() };
  return { kind: "text" };
}

/** Turn a stored pattern into an ILIKE value. `C*` → `C%`, `LO` → `LO`. */
export function fleetPatternToLike(pattern: string): string {
  const original = String(pattern ?? "").trim();
  const star = original.endsWith("*");
  const clean = original.replace(/[%_,()"\\*]/g, "").trim();
  if (!clean) return "";
  return star ? `${clean}%` : clean;
}

function quoteLike(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

/** PostgREST `or` clause. Empty string when the rule has no patterns. */
export function fleetOrClause(cls: Exclude<FleetQueryClass, { kind: "text" }>): string {
  const parts: string[] = [];
  const push = (column: string, pattern: string) => {
    const like = fleetPatternToLike(pattern);
    if (!like) return;
    parts.push(`${column}.ilike.${quoteLike(like)}`);
  };
  switch (cls.kind) {
    case "car_type":
      push("car_type", cls.code);
      push("equipment_type_code", cls.code);
      break;
    case "mechanical":
      push("mechanical_designation", cls.code);
      break;
    case "alias":
      for (const pattern of cls.rule.carTypes) {
        push("car_type", pattern);
        push("equipment_type_code", pattern);
      }
      for (const pattern of cls.rule.mechanical) push("mechanical_designation", pattern);
      for (const pattern of cls.rule.aar) push("aar_designation", pattern);
      break;
    default: {
      const _never: never = cls;
      return _never;
    }
  }
  return parts.join(",");
}

export function fleetMatchLabel(cls: Exclude<FleetQueryClass, { kind: "text" }>, activeCount?: number): string {
  const count = activeCount != null ? ` (${activeCount.toLocaleString()} active)` : "";
  switch (cls.kind) {
    case "car_type":
      return `Matched car type ${cls.code}${count}`;
    case "mechanical":
      return `Matched mechanical designation ${cls.code}${count}`;
    case "alias":
      return `Matched rule: ${cls.rule.label}`;
    default: {
      const _never: never = cls;
      return _never;
    }
  }
}
