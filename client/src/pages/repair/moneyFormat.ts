/**
 * Client money helpers for owner repair UI.
 * Display dollars with $ / commas; store integer cents. Never ask users for cents.
 */

/** Strip `$`, commas, spaces; keep sign. Blank → null. */
export function normalizeMoneyInput(value: string | null | undefined): string | null {
  if (value == null) return null;
  let t = String(value).trim();
  if (!t) return null;
  t = t.replace(/[$,\s]/g, "");
  if (!t || t === "-" || t === "+" || t === "." || t === "-." || t === "+.") {
    return null;
  }
  return t;
}

/** Parse user dollars → integer cents. Blank / unparseable → null. */
export function parseDollarsToCents(
  value: string | number | null | undefined,
): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
  }
  const normalized = normalizeMoneyInput(value);
  if (normalized == null) return null;
  const neg = normalized.startsWith("-");
  const s = neg
    ? normalized.slice(1)
    : normalized.startsWith("+")
      ? normalized.slice(1)
      : normalized;
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (m) {
    const whole = Number.parseInt(m[1], 10);
    const fracRaw = m[2] ?? "";
    const frac = (fracRaw + "00").slice(0, 2);
    const third = fracRaw.length > 2 ? Number.parseInt(fracRaw[2] ?? "0", 10) : 0;
    let cents = whole * 100 + Number.parseInt(frac, 10);
    if (third >= 5) cents += 1;
    return neg ? -cents : cents;
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round((neg ? -n : n) * 100);
}

/** `$48,250.00` from integer cents. */
export function formatCentsAsMoney(cents: number): string {
  const n = Math.trunc(cents);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n) / 100;
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Format cents for an input value (with $ and commas). Blank cents → "". */
export function centsToMoneyInput(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return formatCentsAsMoney(Math.trunc(cents));
}

/**
 * While typing: allow digits, one `.`, optional leading `$` / commas / `-`.
 * Does not force format until blur.
 */
export function sanitizeMoneyTyping(raw: string): string {
  // Keep $, commas, digits, one leading -, and at most one decimal point
  let out = "";
  let seenDot = false;
  let seenDigit = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "$" || ch === "," || ch === " ") {
      out += ch;
      continue;
    }
    if (ch === "-" && !seenDigit && !out.includes("-")) {
      out += ch;
      continue;
    }
    if (ch === "." && !seenDot) {
      seenDot = true;
      out += ch;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      seenDigit = true;
      out += ch;
    }
  }
  return out;
}

/** On blur: reformat to `$X,XXX.XX` or "" if blank/invalid. */
export function formatMoneyInputOnBlur(raw: string): string {
  const cents = parseDollarsToCents(raw);
  if (cents == null) return "";
  return formatCentsAsMoney(cents);
}
