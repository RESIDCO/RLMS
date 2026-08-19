import { splitCarNumber } from "./residco-import";

export const PROGRAM_STATUSES = ["open", "on_hold", "complete"] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export const PROGRAM_DOC_CATEGORIES = [
  { value: "sow", label: "SOW" },
  { value: "car_drawing", label: "Car Drawing" },
  { value: "contract", label: "Contract" },
  { value: "report", label: "Report" },
  { value: "photo", label: "Photo" },
  { value: "other", label: "Other" },
] as const;

export const PROGRAM_CAR_DOC_CATEGORIES = [
  { value: "inspection_report", label: "Inspection Report" },
  { value: "photo", label: "Photo" },
  { value: "estimate", label: "Estimate" },
  { value: "invoice", label: "Invoice" },
  { value: "other", label: "Other" },
] as const;

export const PROGRAM_ENTITIES = ["Main", "Rail Partners Select", "Coal"] as const;

export type ProgramFieldType = "text" | "number" | "currency" | "date" | "boolean" | "select";

export type ProgramFieldDef = {
  id: number;
  category_id: number;
  field_key: string;
  label: string;
  field_type: ProgramFieldType;
  section: string | null;
  sort_order: number;
  select_options: string[] | null;
};

export const CATEGORY_BADGE: Record<string, string> = {
  Acquisition: "bg-umler-teal/15 text-umler-teal border-umler-teal/30",
  "EOLR (End-of-Lease Return)": "bg-umler-signal/15 text-umler-signal border-umler-signal/30",
  "NLD (New Lessee Delivery)": "bg-umler-steel/15 text-umler-steel border-umler-steel/30",
  "Sale / Partial Sale": "bg-umler-amber/15 text-umler-amber border-umler-amber/30",
  Scrap: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  Remark: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  Qualifications: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Inspection: "bg-umler-faint/15 text-umler-faint border-umler-faint/30",
  Other: "bg-muted text-muted-foreground border-border",
};

export const CATEGORY_SHORT: Record<string, string> = {
  "EOLR (End-of-Lease Return)": "EOLR",
  "NLD (New Lessee Delivery)": "NLD",
  "Sale / Partial Sale": "Sale",
};

export function categoryShortName(name: string): string {
  return CATEGORY_SHORT[name] ?? name;
}

export const STATUS_BADGE: Record<ProgramStatus, string> = {
  open: "bg-umler-teal/15 text-umler-teal border-umler-teal/30",
  on_hold: "bg-umler-amber/15 text-umler-amber border-umler-amber/30",
  complete: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

export const STATUS_LABEL: Record<ProgramStatus, string> = {
  open: "Open",
  on_hold: "On Hold",
  complete: "Complete",
};

export function isProgramStatus(v: string): v is ProgramStatus {
  return (PROGRAM_STATUSES as readonly string[]).includes(v);
}

export function customFieldValue(fields: Record<string, unknown> | null | undefined, key: string): unknown {
  if (!fields || typeof fields !== "object") return null;
  return fields[key] ?? null;
}

export function isCustomFieldPopulated(v: unknown): boolean {
  if (v == null) return false;
  if (v === "") return false;
  if (v === false) return true;
  if (typeof v === "number" && Number.isFinite(v)) return true;
  return String(v).trim() !== "";
}

export function formatCustomField(v: unknown, type: ProgramFieldType): string {
  if (v == null || v === "") return "";
  if (type === "boolean") return v === true || v === "true" ? "Yes" : v === false || v === "false" ? "No" : "";
  if (type === "currency") {
    const n = Number(v);
    return Number.isFinite(n)
      ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
      : String(v);
  }
  if (type === "date") return String(v).slice(0, 10);
  return String(v);
}

export function excelSheetName(raw: string, used: Set<string>): string {
  let s = String(raw ?? "")
    .replace(/[:\\/?*[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);
  if (!s) s = "Program";
  let out = s;
  let n = 2;
  while (used.has(out.toLowerCase())) {
    const suffix = ` (${n})`;
    out = `${s.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    n += 1;
  }
  used.add(out.toLowerCase());
  return out;
}

export function reportFilename(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `RLMS_Program_Status_Report_${y}${m}${day}.xlsx`;
}

/** Bruce's original workbook: Master_Fleet_Project_Status_Report_8112026.xlsx
 *  Month unpadded, day always 2 digits, year 4 digits, no separators. */
export function masterReportFilename(d = new Date()): string {
  const m = String(d.getMonth() + 1);
  const day = String(d.getDate()).padStart(2, "0");
  const y = d.getFullYear();
  return `Master_Fleet_Project_Status_Report_${m}${day}${y}.xlsx`;
}

export const FLAG_TAG_HINTS = ["Watch", "Priority", "Issue", "Hold"] as const;

export function parseCarPasteList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  function push(token: string) {
    const t = token.trim();
    if (!t) return;
    const key = t.replace(/\s+/g, "").toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  }

  // Comma / semicolon / newline / tab separate cars. Spaces inside a record pair
  // MARK + NUMBER (e.g. "TFOX 901745") into one unit before a bare-number fallback.
  for (const record of String(raw ?? "").split(/[\n\r,;\t]+/)) {
    const words = record.trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const next = words[i + 1];
      const isMark = /^[A-Za-z]{2,8}$/.test(w);
      const nextIsNum = next != null && /^\d/.test(next);
      if (isMark && nextIsNum) {
        push(`${w} ${next}`);
        i += 1;
        continue;
      }
      push(w);
    }
  }
  return out;
}

export function looksLikeCarToken(token: string): boolean {
  const s = splitCarNumber(token);
  return Boolean(s.car_number && /^\d/.test(s.car_number));
}

/** Two or more car-like tokens (Excel column, commas, MARK NUMBER pairs). */
export function carListSearchTokens(raw: string): string[] | null {
  const tokens = parseCarPasteList(raw);
  if (tokens.length < 2) return null;
  const cars = tokens.filter(looksLikeCarToken);
  if (cars.length < 2) return null;
  if (cars.length < tokens.length * 0.5) return null;
  return cars;
}

export function programPath(id: number): string {
  return `/programs/${id}`;
}
