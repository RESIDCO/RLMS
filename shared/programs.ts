import { splitCarNumber } from "./residco-import";

export const PROGRAM_STATUSES = ["open", "on_hold", "complete"] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export const PROGRAM_LIFECYCLES = ["draft", "active", "closed", "cancelled"] as const;
export type ProgramLifecycle = (typeof PROGRAM_LIFECYCLES)[number];

export const PROGRAM_TYPES = [
  "Acquisition",
  "Return",
  "Sale",
  "New Assignment",
  "Scrap",
  "Repair",
  "Inspection",
  "Quals",
  "Lining/Cleaning",
  "Other",
] as const;
export type ProgramType = (typeof PROGRAM_TYPES)[number];

export const PROGRAM_TYPE_FROM_CATEGORY: Record<string, ProgramType> = {
  Acquisition: "Acquisition",
  EOLR: "Return",
  NLD: "New Assignment",
  Sale: "Sale",
  Scrap: "Scrap",
  Remark: "Repair",
  Qualifications: "Quals",
  Inspection: "Inspection",
  Other: "Other",
};

export const TRAIL_MILESTONES = [
  "Enroute",
  "Work complete",
  "Arrived at industry",
  "Scrapped",
  "Sold",
  "Stored",
  "On rent",
] as const;

export const WORK_COMPLETE_MILESTONE = "Work complete";

export const PROGRAM_DONE_MILESTONES = ["On rent", "Scrapped", "Sold", "Stored"] as const;

export const TERMINAL_MILESTONES = PROGRAM_DONE_MILESTONES;

export const COMPLETION_LEVELS = ["not_started", "in_progress", "work_done", "program_done"] as const;
export type CompletionLevel = (typeof COMPLETION_LEVELS)[number];

export const COMPLETION_LABEL: Record<CompletionLevel, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  work_done: "Work done",
  program_done: "Program done",
};

export const MILESTONES_BY_TYPE: Record<ProgramType, string[]> = {
  Acquisition: ["Inspect", "Qualify", "Enroute", "Arrived at industry", "Deliver"],
  Return: ["Off lease", "Enroute", "Work complete", "Arrived at industry", "Inspect", "Shop", "Ready", "On rent"],
  Sale: ["Listed", "Offer", "Enroute", "Work complete", "Arrived at industry", "Closed", "Sold"],
  "New Assignment": ["Qualify", "Enroute", "Work complete", "Arrived at industry", "Deliver", "On rent"],
  Scrap: ["Enroute", "Work complete", "Arrived at industry", "Move to yard", "Scrapped"],
  Repair: ["Shop in", "Work complete", "Shop out"],
  Inspection: ["Scheduled", "Inspected"],
  Quals: ["Qualify", "Certified"],
  "Lining/Cleaning": ["Shop in", "Lined/cleaned", "Shop out"],
  Other: ["Started", "Enroute", "Arrived at industry", "Done"],
};

/** Program-car "done" is arrival at the committed destination, not the later terminal step. */
export function isArrivedMilestone(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return false;
  if (s.includes("arrived")) return true;
  if (s === "deliver" || s === "delivered" || s.startsWith("deliver ")) return true;
  return false;
}

export function isWorkCompleteMilestone(raw: string | null | undefined): boolean {
  return String(raw ?? "").trim().toLowerCase() === "work complete";
}

export function isProgramDoneMilestone(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim().toLowerCase();
  return (PROGRAM_DONE_MILESTONES as readonly string[]).some((m) => m.toLowerCase() === s);
}

export function isTerminalMilestone(raw: string | null | undefined): boolean {
  return isProgramDoneMilestone(raw);
}

export function deriveCompletionLevel(row: {
  active?: boolean | null;
  status?: string | null;
  milestone?: string | null;
  milestones?: { milestone?: string | null }[] | null;
  outcome_reached_at?: string | null;
  completed?: boolean | null;
}): CompletionLevel {
  if (row.active === false) return "program_done";
  if (row.completed === true) return "program_done";
  if (String(row.outcome_reached_at ?? "").trim()) return "program_done";
  const names = [
    ...(row.milestones ?? []).map((m) => m.milestone),
    row.milestone,
  ].filter((v) => String(v ?? "").trim()) as string[];
  if (names.some((n) => isProgramDoneMilestone(n))) return "program_done";
  if (names.some((n) => isWorkCompleteMilestone(n))) return "work_done";
  if (names.length || String(row.status ?? "").trim()) return "in_progress";
  return "not_started";
}

export function percentFromProgress(progress: {
  done?: number | null;
  total_open_links?: number | null;
} | null | undefined): number | null {
  const total = Number(progress?.total_open_links ?? 0);
  const done = Number(progress?.done ?? 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round((100 * done) / total);
}

export function trailDate(
  trail: { milestone?: string | null; milestone_date?: string | null }[] | null | undefined,
  pred: (milestone: string) => boolean,
): string | null {
  let found: string | null = null;
  for (const row of trail ?? []) {
    const name = String(row.milestone ?? "");
    if (!pred(name)) continue;
    const d = String(row.milestone_date ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) found = d;
  }
  return found;
}

export function putOnRentProgramTypes(): readonly ProgramType[] {
  return ["Return", "New Assignment"];
}

export const LIFECYCLE_LABEL: Record<ProgramLifecycle, string> = {
  draft: "Draft",
  active: "Active",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const LIFECYCLE_BADGE: Record<ProgramLifecycle, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  active: "bg-umler-teal/15 text-umler-teal border-umler-teal/30",
  closed: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  cancelled: "bg-umler-signal/15 text-umler-signal border-umler-signal/30",
};

export function isProgramType(v: string): v is ProgramType {
  return (PROGRAM_TYPES as readonly string[]).includes(v);
}

export function isProgramLifecycle(v: string): v is ProgramLifecycle {
  return (PROGRAM_LIFECYCLES as readonly string[]).includes(v);
}

/** Display overlay: closed_date wins. Stored draft/cancelled kept. Else active. */
export function overlayLifecycle(row: {
  closed_date?: string | null;
  lifecycle?: string | null;
}): ProgramLifecycle {
  if (row.closed_date) return "closed";
  const lc = String(row.lifecycle ?? "").trim();
  if (lc === "draft" || lc === "cancelled") return lc;
  return "active";
}

export function displayTypeFromCategory(categoryName: string | null | undefined): ProgramType | null {
  const n = String(categoryName ?? "").trim();
  if (!n) return null;
  if (n.toLowerCase().startsWith("acquisition")) return "Acquisition";
  if (n.toUpperCase().startsWith("EOLR")) return "Return";
  if (n.toUpperCase().startsWith("NLD")) return "New Assignment";
  if (n.toLowerCase().startsWith("sale")) return "Sale";
  if (n.toLowerCase().startsWith("scrap")) return "Scrap";
  if (n.toLowerCase().startsWith("remark")) return "Repair";
  if (n.toLowerCase().startsWith("qualif")) return "Quals";
  if (n.toLowerCase().startsWith("inspection")) return "Inspection";
  if (n.toLowerCase().startsWith("other")) return "Other";
  return null;
}

/** True when the car has reached the program end result (Program done). */
export function isCarDone(row: {
  active?: boolean | null;
  status?: string | null;
  milestone?: string | null;
  milestones?: { milestone?: string | null }[] | null;
  outcome_reached_at?: string | null;
  completed?: boolean | null;
}): boolean {
  return deriveCompletionLevel(row) === "program_done";
}

export function readyToClose(row: { lifecycle: string; remaining: number; total_open_links: number }): boolean {
  return row.lifecycle === "active" && row.remaining === 0 && row.total_open_links > 0;
}

export function isProgramStale(row: { lifecycle: string; target_completion_date?: string | null }, asOf = new Date()): boolean {
  if (row.lifecycle !== "active") return false;
  const d = String(row.target_completion_date ?? "").slice(0, 10);
  if (!d) return true;
  return d < asOf.toISOString().slice(0, 10);
}

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

  // Newlines separate rows (Excel paste). Tabs are mark/number columns, not car breaks.
  // Commas / semicolons on one line separate cars; a mark on that line scopes following bare numbers.
  for (const line of String(raw ?? "").split(/[\n\r]+/)) {
    if (!line.trim()) continue;
    const normalized = line.replace(/\t+/g, " ");
    let lineMark: string | null = null;
    for (const segment of normalized.split(/[,;]+/)) {
      const words = segment.trim().split(/\s+/).filter(Boolean);
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const next = words[i + 1];
        const isMark = /^[A-Za-z]{2,8}$/.test(w);
        const nextIsNum = next != null && /^\d/.test(next);
        if (isMark && nextIsNum) {
          lineMark = w.toUpperCase();
          push(`${w} ${next}`);
          i += 1;
          continue;
        }
        if (isMark) {
          lineMark = w.toUpperCase();
          continue;
        }
        if (/^\d/.test(w) && lineMark) {
          push(`${lineMark} ${w}`);
          continue;
        }
        push(w);
      }
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
