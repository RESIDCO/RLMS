/** Parse JSON while keeping numeric tokens such as 0.00, which JSON.parse collapses to 0. */

export type Canon =
  | { kind: "null"; raw: string }
  | { kind: "bool"; raw: string }
  | { kind: "num"; raw: string }
  | { kind: "str"; raw: string; value: string }
  | { kind: "arr"; raw: string; elements: Canon[] }
  | { kind: "obj"; raw: string; fields: Array<{ key: string; value: Canon }> };

const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

function skipWs(text: string, index: number): number {
  let i = index;
  while (i < text.length && text[i] !== undefined && /\s/.test(text[i]!)) i += 1;
  return i;
}

function scanString(text: string, start: number): { value: string; i: number } {
  if (text[start] !== '"') throw new Error("canonical string");
  let i = start + 1;
  let value = "";
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') return { value, i: i + 1 };
    if (ch !== "\\") {
      value += ch;
      i += 1;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) throw new Error("canonical escape");
    if (next === "u") {
      const hex = text.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error("canonical unicode");
      value += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    if (!(next in ESCAPES)) throw new Error("canonical escape");
    value += ESCAPES[next];
    i += 2;
  }
  throw new Error("unterminated canonical string");
}

function parseAt(text: string, start: number): { node: Canon; i: number } {
  const head = skipWs(text, start);
  const ch = text[head];
  if (ch === undefined) throw new Error("canonical json ended early");
  if (text.startsWith("null", head)) return { node: { kind: "null", raw: "null" }, i: head + 4 };
  if (text.startsWith("true", head)) return { node: { kind: "bool", raw: "true" }, i: head + 4 };
  if (text.startsWith("false", head)) return { node: { kind: "bool", raw: "false" }, i: head + 5 };
  if (ch === '"') {
    const scanned = scanString(text, head);
    return { node: { kind: "str", raw: text.slice(head, scanned.i), value: scanned.value }, i: scanned.i };
  }
  if (ch === "-" || (ch >= "0" && ch <= "9")) {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(head));
    if (!match) throw new Error("invalid canonical number");
    return { node: { kind: "num", raw: match[0] }, i: head + match[0].length };
  }
  if (ch === "{") {
    let i = head + 1;
    const fields: Array<{ key: string; value: Canon }> = [];
    i = skipWs(text, i);
    if (text[i] === "}") return { node: { kind: "obj", raw: text.slice(head, i + 1), fields }, i: i + 1 };
    while (i < text.length) {
      i = skipWs(text, i);
      const key = scanString(text, i);
      i = skipWs(text, key.i);
      if (text[i] !== ":") throw new Error("canonical object colon");
      const value = parseAt(text, i + 1);
      fields.push({ key: key.value, value: value.node });
      i = skipWs(text, value.i);
      if (text[i] === ",") {
        i += 1;
        continue;
      }
      if (text[i] === "}") return { node: { kind: "obj", raw: text.slice(head, i + 1), fields }, i: i + 1 };
      throw new Error("canonical object");
    }
    throw new Error("canonical object");
  }
  if (ch === "[") {
    let i = head + 1;
    const elements: Canon[] = [];
    i = skipWs(text, i);
    if (text[i] === "]") return { node: { kind: "arr", raw: text.slice(head, i + 1), elements }, i: i + 1 };
    while (i < text.length) {
      const value = parseAt(text, i);
      elements.push(value.node);
      i = skipWs(text, value.i);
      if (text[i] === ",") {
        i += 1;
        continue;
      }
      if (text[i] === "]") return { node: { kind: "arr", raw: text.slice(head, i + 1), elements }, i: i + 1 };
      throw new Error("canonical array");
    }
    throw new Error("canonical array");
  }
  throw new Error("canonical json");
}

export function parseCanonical(text: string): Canon {
  const parsed = parseAt(text, 0);
  if (skipWs(text, parsed.i) !== text.length) throw new Error("trailing canonical json");
  return parsed.node;
}

export function canonicalValue(node: Canon): unknown {
  switch (node.kind) {
    case "null":
      return null;
    case "bool":
      return node.raw === "true";
    case "num":
      return node.raw;
    case "str":
      return node.value;
    case "arr":
      return node.elements.map(canonicalValue);
    case "obj": {
      const out: Record<string, unknown> = {};
      for (const field of node.fields) out[field.key] = canonicalValue(field.value);
      return out;
    }
    default: {
      const neverKind: never = node;
      return neverKind;
    }
  }
}

/** PostgREST returns a one-element array. Postgres `to_jsonb(row)::text` is one object. */
export function firstObjectText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const node = parseCanonical(trimmed);
  if (node.kind === "arr") {
    const first = node.elements[0];
    if (!first) return null;
    if (first.kind !== "obj") throw new Error("canonical row is not an object");
    return first.raw;
  }
  if (node.kind === "obj") return node.raw;
  throw new Error("canonical row is not an object");
}

export function canonicalRows(text: string): Record<string, unknown>[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const node = parseCanonical(trimmed);
  if (node.kind === "obj") return [canonicalValue(node) as Record<string, unknown>];
  if (node.kind !== "arr") throw new Error("expected rows");
  return node.elements.map((element) => {
    const value = canonicalValue(element);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("row is not an object");
    return value as Record<string, unknown>;
  });
}

function fieldMap(objectText: string): Map<string, Canon> {
  const node = parseCanonical(objectText);
  if (node.kind !== "obj") throw new Error("expected object");
  const map = new Map<string, Canon>();
  for (const field of node.fields) map.set(field.key, field.value);
  return map;
}

export function projectCanonical(objectText: string, keys: readonly string[]): string {
  const map = fieldMap(objectText);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${map.get(key)?.raw ?? "null"}`).join(",")}}`;
}

/** Keys whose database jsonb text actually changed. Unchanged numeric scale is not a change. */
export function canonicalChangePair(
  beforeText: string,
  afterText: string,
  keys: readonly string[],
): { keys: string[]; beforeJson: string; afterJson: string } | null {
  const before = fieldMap(beforeText);
  const after = fieldMap(afterText);
  const changed = keys.filter((key) => (before.get(key)?.raw ?? "null") !== (after.get(key)?.raw ?? "null"));
  if (!changed.length) return null;
  return {
    keys: changed,
    beforeJson: projectCanonical(beforeText, changed),
    afterJson: projectCanonical(afterText, changed),
  };
}

/** Activity-log insert body. before/after keep the database's numeric tokens. */
export function activityInsertBody(
  row: Record<string, unknown>,
  beforeJson: string,
  afterJson: string,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (key === "before" || key === "after" || value === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
  }
  parts.push(`"before":${beforeJson}`, `"after":${afterJson}`);
  return `{${parts.join(",")}}`;
}
