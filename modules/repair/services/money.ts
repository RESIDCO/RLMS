/**
 * Money helpers — integer cents for all arithmetic.
 * Never sum floating-point dollars (e.g. 123×(cents/100) → 36732.04000000001).
 * Convert to dollars only once for numeric(14,2) storage or display.
 */

/**
 * Normalize a user money string: strip `$`, commas, spaces.
 * Keeps leading sign. Empty / non-numeric → null (caller decides 0 vs blank).
 */
export function normalizeMoneyInput(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  let t = String(value).trim();
  if (!t) return null;
  t = t.replace(/[$,\s]/g, "");
  if (!t || t === "-" || t === "+" || t === "." || t === "-." || t === "+.") {
    return null;
  }
  return t;
}

/**
 * Parse user dollars (`$48,250.00`, `48250`, `48,250.5`) → integer cents.
 * Blank / unparseable → null (optional fields). Use dollarsToCents for 0-default.
 */
export function parseDollarsToCents(
  value: number | string | null | undefined,
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

/** Parse dollars (number or decimal string) to integer cents. Blank → 0. */
export function dollarsToCents(value: number | string | null | undefined): number {
  return parseDollarsToCents(value) ?? 0;
}

/** Single conversion after integer math — safe for numeric(14,2) / display. */
export function centsToDollars(cents: number): number {
  return Number((Math.trunc(cents) / 100).toFixed(2));
}

/** Display / log formatting (always exactly 2 decimals, no thousands sep). */
export function formatCentsAsDollars(cents: number): string {
  return (Math.trunc(cents) / 100).toFixed(2);
}

/**
 * Display dollars with thousands separators (e.g. `36,732.04`).
 * Use for UI only — inputs stay plain numbers via formatCentsAsDollars / parse.
 */
export function formatCentsWithCommas(cents: number): string {
  const n = Math.trunc(cents) / 100;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Always `$` + 2 decimals with thousands separators (e.g. `$36,732.04`). */
export function formatCentsAsMoney(cents: number): string {
  const n = Math.trunc(cents);
  const sign = n < 0 ? "-" : "";
  return `${sign}$${formatCentsWithCommas(Math.abs(n))}`;
}

/** UI pair: dollar string + integer cents underneath. */
export function formatMoneyParts(cents: number): {
  dollars: string;
  cents: number;
  centsLabel: string;
} {
  const c = Math.trunc(cents);
  return {
    dollars: formatCentsAsMoney(c),
    cents: c,
    centsLabel: String(c),
  };
}

export function formatDollars(value: number | string | null | undefined): string {
  return formatCentsAsDollars(dollarsToCents(value));
}

/** Line labor in cents (prefer laborCents; else dollars). */
export function lineLaborCents(line: {
  labor?: number | string | null;
  laborCents?: number | null;
}): number {
  if (line.laborCents != null && Number.isFinite(Number(line.laborCents))) {
    return Math.trunc(Number(line.laborCents));
  }
  return dollarsToCents(line.labor);
}

/** Line material in cents (prefer materialCents; else dollars). */
export function lineMaterialCents(line: {
  material?: number | string | null;
  materialCents?: number | null;
}): number {
  if (line.materialCents != null && Number.isFinite(Number(line.materialCents))) {
    return Math.trunc(Number(line.materialCents));
  }
  return dollarsToCents(line.material);
}

/** Line total in cents (prefer explicit total; else labor+material). */
export function lineTotalCents(line: {
  labor?: number | string | null;
  material?: number | string | null;
  total?: number | string | null;
  laborCents?: number | null;
  materialCents?: number | null;
}): number {
  if (line.total != null && line.total !== "") {
    // If cents columns present, prefer summing them over float total
    if (line.laborCents != null || line.materialCents != null) {
      return lineLaborCents(line) + lineMaterialCents(line);
    }
    return dollarsToCents(line.total);
  }
  return lineLaborCents(line) + lineMaterialCents(line);
}

export type MoneyTotals = {
  laborCents: number;
  materialCents: number;
  totalCents: number;
  labor: number;
  material: number;
  total: number;
};

/** Sum lines in integer cents, convert dollars once. */
export function sumLineMoney(
  lines: Array<{
    labor?: number | string | null;
    material?: number | string | null;
    total?: number | string | null;
    laborCents?: number | null;
    materialCents?: number | null;
  }>,
): MoneyTotals {
  let laborCents = 0;
  let materialCents = 0;
  for (const line of lines) {
    laborCents += lineLaborCents(line);
    materialCents += lineMaterialCents(line);
  }
  const totalCents = laborCents + materialCents;
  return {
    laborCents,
    materialCents,
    totalCents,
    labor: centsToDollars(laborCents),
    material: centsToDollars(materialCents),
    total: centsToDollars(totalCents),
  };
}

/**
 * Smoke / invariant: a money total must not show more than 2 decimal places
 * (catches float-sum bugs like 36732.04000000001).
 */
export function assertAtMostTwoDecimals(
  label: string,
  value: number | string | null | undefined,
): void {
  if (value == null || value === "") return;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${label}: non-finite money value (${value})`);
  }
  const asString = typeof value === "string" ? value.trim() : String(n);
  // Scientific notation or long fraction → fail
  if (/e/i.test(asString)) {
    throw new Error(`${label}: unexpected scientific notation (${asString})`);
  }
  const frac = asString.includes(".") ? asString.split(".")[1] ?? "" : "";
  // Strip trailing zeros from string form of numbers like "10.50"
  const fracSig = frac.replace(/0+$/, "");
  if (fracSig.length > 2) {
    throw new Error(
      `${label}: more than 2 decimal places (${asString}) — use integer cents`,
    );
  }
  // Also catch Number that stringifies cleanly but isn't 2-dp exact vs cents
  const cents = dollarsToCents(n);
  const roundTrip = centsToDollars(cents);
  if (Math.abs(n - roundTrip) > 1e-9) {
    throw new Error(
      `${label}: not exact to 2 decimals (${asString} vs ${roundTrip})`,
    );
  }
}
