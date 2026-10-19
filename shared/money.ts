/**
 * One USD formatter for the programs grid.
 * Display only: callers keep the stored number. Null and blank stay blank.
 */

export const USD_EXCEL_NUM_FMT = "$#,##0.00";

/**
 * Money columns found by auditing program_field_defs and the program-car
 * repair column. Date fields that mention Code 6 (approval / request) are
 * not in this list. Resp 6 costs and spend are matched by label so a column
 * added under those names formats even before its type is currency.
 */
export const AUDITED_PROGRAM_MONEY_KEYS = [
  "original_code6",
  "original_code7",
  "original_brc_total",
  "final_code6",
  "final_code7",
  "final_brc_total",
  "cost_of_exterior_paint",
  "cost_of_interior_paint",
  "cost_of_cleaning",
  "b_o_estimate_cost",
  "settlement_amount",
  "repair_cost_total",
  "repair",
] as const;

const MONEY_KEYS = new Set<string>(AUDITED_PROGRAM_MONEY_KEYS);

export type MoneyFieldLike = {
  field_key?: string | null;
  field_type?: string | null;
  label?: string | null;
};

export function moneyNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** $12,686.96. Empty when the value is null, blank, or not a number. */
export function formatUsd(value: unknown): string {
  const n = moneyNumber(value);
  if (n == null) return "";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Grid readout. Uses formatUsd. A non-numeric leftover is shown as text. */
export function formatMoneyCell(value: unknown): string {
  if (value == null || value === "") return "";
  return formatUsd(value) || String(value);
}

/** Empty input clears the cell. Invalid text returns undefined so the caller keeps the stored value. */
export function parseUsdInput(raw: string): number | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  const n = moneyNumber(s);
  return n == null ? undefined : n;
}

export function excelMoneyValue(value: unknown): { value: number | null; numFmt: string | null } {
  const n = moneyNumber(value);
  if (n == null) return { value: null, numFmt: null };
  return { value: n, numFmt: USD_EXCEL_NUM_FMT };
}

function labelIsMoney(label: string): boolean {
  const s = label.trim().toLowerCase();
  if (!s || /approval|\bdate\b|request/.test(s)) return false;
  if (s === "spend" || /\bspend\b/.test(s)) return true;
  return /resp(?:onsibility)?\s*6/.test(s);
}

export function isProgramMoneyField(field?: MoneyFieldLike | null, columnKey?: string | null): boolean {
  if (String(field?.field_type ?? "") === "currency") return true;
  const key = String(
    field?.field_key ?? (columnKey?.startsWith("cf:") ? columnKey.slice(3) : columnKey ?? ""),
  );
  if (key && MONEY_KEYS.has(key)) return true;
  const label = String(field?.label ?? "");
  if (!labelIsMoney(label)) return false;
  const type = String(field?.field_type ?? "");
  return type === "" || type === "number" || type === "currency" || type === "text";
}
