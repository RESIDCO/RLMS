import { formatMoneyCell } from "./money";
import { formatProgramDate } from "./program-dates";
import { CAR_NUMBER_WIDTH, splitCarNumber } from "./residco-import";

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
  /** Fleet flag. Inactive cars stay listed; this does not mark the program row done. */
  active?: boolean | null;
  status?: string | null;
  milestone?: string | null;
  milestones?: { milestone?: string | null }[] | null;
  outcome_reached_at?: string | null;
  completed?: boolean | null;
  exited_date?: string | null;
}): CompletionLevel {
  if (row.completed === true) return "program_done";
  if (String(row.outcome_reached_at ?? "").trim()) return "program_done";
  if (String(row.exited_date ?? "").trim()) return "program_done";
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
  exited_date?: string | null;
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
  category_id: number | null;
  field_key: string;
  label: string;
  field_type: ProgramFieldType;
  section: string | null;
  sort_order: number;
  select_options: string[] | null;
  /** Global optional fields (category_id null) stay hidden until added from Columns. */
  is_optional?: boolean;
  /** Set when the column belongs to one program. Null is category-wide or global. */
  program_id?: number | null;
  /** Set when the column is retired. The definition and stored values stay. */
  retired_at?: string | null;
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
  if (type === "currency") return formatMoneyCell(v);
  if (type === "date") return formatProgramDate(v);
  if (type === "number") {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString("en-US") : String(v);
  }
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

/** TFOX 3297, TFOX\t3297, TFOX003297, and TFOX 0003297 all become TFOX 003297. */
export function canonicalPasteCarToken(token: string): string {
  const split = splitCarNumber(token);
  const digits = String(split.car_number ?? "").replace(/\D/g, "");
  if (!digits) {
    if (split.reporting_marks) return split.reporting_marks;
    return String(token ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  }
  const stripped = digits.replace(/^0+/, "") || "0";
  const num = stripped.length <= CAR_NUMBER_WIDTH ? stripped.padStart(CAR_NUMBER_WIDTH, "0") : stripped;
  const mark = split.reporting_marks;
  return mark ? `${mark} ${num}` : num;
}

/** A leading 0 before letters is the letter O, so "0FOX 815215" stays one car. */
export function normalizePasteWord(word: string): string {
  return word.replace(/^0(?=[A-Za-z])/, "O");
}

export type PasteRangeExpansion = { raw: string; count: number; from: string; to: string };
export type PasteRangeRejection = { raw: string; message: string };

export type ParsedCarPaste = {
  tokens: string[];
  expandedFrom: PasteRangeExpansion[];
  rejectedRanges: PasteRangeRejection[];
};

const RANGE_CONNECTOR = /^(?:thru|through|to|[-–—])$/i;
const HYPHEN_RANGE = /^(\d+)[-–—](\d+)$/;
const MARK_WORD = /^[A-Za-z]{2,8}$/;

function isRangeConnector(word: string): boolean {
  return RANGE_CONNECTOR.test(word);
}

/** THRU / THROUGH / TO are range words, never reporting marks. */
function isMarkWord(word: string): boolean {
  return MARK_WORD.test(word) && !/^(?:thru|through|to)$/i.test(word);
}

/**
 * When the end number is shorter, keep the start's leading digits.
 * `401-49` means 401–449. Same-length ends are used as written.
 */
export function expandRangeEnd(start: string, end: string): string {
  if (end.length < start.length) return start.slice(0, start.length - end.length) + end;
  return end;
}

function pushToken(seen: Set<string>, out: string[], token: string, canonicalize: boolean) {
  const t = canonicalize ? canonicalPasteCarToken(token) : token.trim().replace(/\s+/g, " ").toUpperCase();
  if (!t) return;
  const key = t.replace(/\s+/g, "");
  if (seen.has(key)) return;
  seen.add(key);
  out.push(t);
}

/**
 * Expand `MARK? N1 (-|–|thru|through|to) N2` before the token split.
 * A range is expanded when the end is ≥ the start and the span (end − start) is ≤ 500.
 * A mark earlier on the same line applies to a bare range. Descending ranges and
 * ranges over 500 stay as a single token and are flagged.
 * `parseCarPasteList` still returns `string[]` for existing callers.
 */
export function parseCarPasteListDetailed(raw: string): ParsedCarPaste {
  const seen = new Set<string>();
  const out: string[] = [];
  const expandedFrom: PasteRangeExpansion[] = [];
  const rejectedRanges: PasteRangeRejection[] = [];

  function push(token: string) {
    pushToken(seen, out, token, true);
  }

  function pushRaw(token: string) {
    pushToken(seen, out, token, false);
  }

  function takeRange(mark: string | null, start: string, endRaw: string, rawLabel: string): boolean {
    const label = rawLabel.replace(/\s+/g, " ").trim();
    const end = expandRangeEnd(start, endRaw);
    if (!/^\d+$/.test(start) || !/^\d+$/.test(end)) {
      rejectedRanges.push({ raw: label, message: `Range ${label} could not be read` });
      pushRaw(label);
      return true;
    }
    const a = BigInt(start);
    const b = BigInt(end);
    if (b < a) {
      const message = `Range ${label} runs backwards and was not expanded`;
      rejectedRanges.push({ raw: label, message });
      pushRaw(label);
      return true;
    }
    if (b - a > BigInt(500)) {
      const message = `Range ${label} is longer than 500 and was not expanded`;
      rejectedRanges.push({ raw: label, message });
      pushRaw(label);
      return true;
    }
    const width = Math.max(start.length, end.length);
    const count = Number(b - a + BigInt(1));
    for (let n = a; n <= b; n += BigInt(1)) {
      const num = n.toString().padStart(width, "0");
      push(mark ? `${mark} ${num}` : num);
    }
    expandedFrom.push({ raw: label, count, from: start, to: end });
    return true;
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
        const w = normalizePasteWord(words[i]);
        const next = words[i + 1];
        const next2 = words[i + 2];
        const next3 = words[i + 3];

        if (isMarkWord(w) && next && HYPHEN_RANGE.test(next)) {
          lineMark = w.toUpperCase();
          const m = HYPHEN_RANGE.exec(next)!;
          takeRange(lineMark, m[1], m[2], `${w} ${next}`);
          i += 1;
          continue;
        }
        if (
          isMarkWord(w) &&
          next &&
          /^\d+$/.test(next) &&
          next2 &&
          isRangeConnector(next2) &&
          next3 &&
          /^\d+$/.test(next3)
        ) {
          lineMark = w.toUpperCase();
          takeRange(lineMark, next, next3, `${w} ${next} ${next2} ${next3}`);
          i += 3;
          continue;
        }
        if (HYPHEN_RANGE.test(w)) {
          const m = HYPHEN_RANGE.exec(w)!;
          takeRange(lineMark, m[1], m[2], w);
          continue;
        }
        if (/^\d+$/.test(w) && next && isRangeConnector(next) && next2 && /^\d+$/.test(next2)) {
          takeRange(lineMark, w, next2, `${w} ${next} ${next2}`);
          i += 2;
          continue;
        }
        if (isRangeConnector(w)) continue;

        const nextIsNum = next != null && /^\d/.test(next) && !HYPHEN_RANGE.test(next);
        if (isMarkWord(w) && nextIsNum) {
          lineMark = w.toUpperCase();
          push(`${w} ${next}`);
          i += 1;
          continue;
        }
        if (isMarkWord(w)) {
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
  return { tokens: out, expandedFrom, rejectedRanges };
}

export function parseCarPasteList(raw: string): string[] {
  return parseCarPasteListDetailed(raw).tokens;
}

/** Stay under Search's 500-car paste cap, and under one oversized POST. */
export const PASTE_SEARCH_BATCH = 80;

export function pasteSearchBatches(raw: string, batchSize = PASTE_SEARCH_BATCH): {
  batches: string[];
  rejected: PasteRangeRejection[];
} {
  const detailed = parseCarPasteListDetailed(raw);
  const size = Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : PASTE_SEARCH_BATCH;
  const batches: string[] = [];
  for (let i = 0; i < detailed.tokens.length; i += size) {
    batches.push(detailed.tokens.slice(i, i + size).join("\n"));
  }
  return { batches, rejected: detailed.rejectedRanges };
}

export type PasteCarCandidate = {
  id: number;
  reporting_marks?: string | null;
  car_initial?: string | null;
  car_number?: string | null;
  active?: boolean | null;
};

export type PasteHitDecision =
  | { kind: "match"; car: PasteCarCandidate }
  | { kind: "ambiguous"; matches: PasteCarCandidate[]; reason: string }
  | { kind: "none" };

function strippedCarDigits(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/^0+/, "") || "0";
}

/**
 * A reporting mark resolves to that car, preferring the active row when an
 * inactive twin shares the mark. A bare number that hits two cars stays
 * ambiguous so the caller can ask which one.
 */
export function decidePastedCar(opts: {
  marks: string | null;
  number: string;
  cars: PasteCarCandidate[];
}): PasteHitDecision {
  const wantNum = strippedCarDigits(opts.number);
  if (!wantNum) return { kind: "none" };
  const numbered = opts.cars.filter((car) => strippedCarDigits(car.car_number) === wantNum);
  const wantMark = String(opts.marks ?? "").trim().toUpperCase();
  if (!wantMark) {
    if (numbered.length === 0) return { kind: "none" };
    if (numbered.length === 1) return { kind: "match", car: numbered[0] };
    return {
      kind: "ambiguous",
      matches: numbered,
      reason: "This number matches more than one car. Pick one.",
    };
  }
  const exact = numbered.filter((car) => String(car.reporting_marks ?? "").trim().toUpperCase() === wantMark);
  const hits = exact.length
    ? exact
    : numbered.filter((car) => {
        const marks = String(car.reporting_marks ?? "").trim();
        const initial = String(car.car_initial ?? "").trim().toUpperCase();
        return !marks && initial === wantMark;
      });
  if (hits.length === 0) return { kind: "none" };
  if (hits.length === 1) return { kind: "match", car: hits[0] };
  const active = hits.filter((car) => car.active !== false);
  if (active.length === 1) return { kind: "match", car: active[0] };
  return {
    kind: "ambiguous",
    matches: active.length > 1 ? active : hits,
    reason:
      active.length > 1
        ? "More than one active car has this mark and number. Pick one."
        : "More than one car has this mark and number. Pick one.",
  };
}

/** Current mark on the label, plus "(formerly KCS 310100)" when the paste used an older mark. */
export function labelWithFormerly(
  label: string,
  token: string,
  car: { reporting_marks?: string | null; car_initial?: string | null },
): string {
  const split = splitCarNumber(token);
  const current = String(car.car_initial || car.reporting_marks || "").trim().toUpperCase();
  if (!split.reporting_marks || split.reporting_marks === current) return label;
  return `${label} (formerly ${split.reporting_marks} ${split.car_number})`;
}

export function formerlyOnLabel(label: string, token: string): string {
  return labelWithFormerly(label, token, { reporting_marks: splitCarNumber(label).reporting_marks });
}

/**
 * The current fleet missed this token. One prior identity is that car.
 * Several prior identities stay a choice.
 */
export function decidePriorIdentityPaste(opts: {
  marks: string | null;
  number: string;
  cars: PasteCarCandidate[];
}): PasteHitDecision {
  if (!opts.cars.length) return { kind: "none" };
  const again = decidePastedCar(opts);
  if (again.kind !== "none") return again;
  if (opts.cars.length === 1) return { kind: "match", car: opts.cars[0] };
  return {
    kind: "ambiguous",
    matches: opts.cars,
    reason: opts.marks
      ? "More than one car has matched this mark and number. Pick one."
      : "This number matches more than one car. Pick one.",
  };
}

export type PasteMatchPreview = {
  matched: { token: string; railcar_id: number; label: string }[];
  not_found: { token: string; reason?: string }[];
  already_in_program: { token: string; railcar_id: number; label: string }[];
  ambiguous: {
    token: string;
    reason?: string;
    matches: { railcar_id: number; label: string; active?: boolean | null }[];
  }[];
};

export type SearchPastePage = {
  railcars?: PasteCarCandidate[];
  not_found?: string[];
  ambiguous?: {
    token?: string;
    reason?: string;
    matches?: { id?: number; railcar_id?: number; label?: string; active?: boolean | null }[];
  }[];
  already_in_program?: { railcar_id?: number; label?: string; token?: string }[];
  truncated?: boolean;
};

function pasteCarLabel(car: { reporting_marks?: string | null; car_number?: string | null; id?: number }): string {
  const label = [car.reporting_marks, car.car_number].filter(Boolean).join(" ");
  return label || (car.id != null ? String(car.id) : "");
}

/** Turn batched POST /api/search pages into the Add cars preview. */
export function programPickerFromSearch(
  pages: SearchPastePage[],
  rejected: PasteRangeRejection[] = [],
): PasteMatchPreview {
  const alreadyIds = new Set<number>();
  const already: PasteMatchPreview["already_in_program"] = [];
  const ambiguousIds = new Set<number>();
  const ambiguous: PasteMatchPreview["ambiguous"] = [];
  const notFound: PasteMatchPreview["not_found"] = [];
  const matched: PasteMatchPreview["matched"] = [];
  const seenMatch = new Set<number>();
  const seenMissing = new Set<string>();

  function pushMissing(token: string, reason?: string) {
    const key = `${token}\n${reason ?? ""}`;
    if (seenMissing.has(key)) return;
    seenMissing.add(key);
    notFound.push({ token, reason });
  }

  for (const page of pages) {
    for (const row of page.already_in_program ?? []) {
      const id = Number(row.railcar_id);
      if (!Number.isFinite(id) || id <= 0 || alreadyIds.has(id)) continue;
      alreadyIds.add(id);
      const label = String(row.label ?? row.token ?? id);
      already.push({ token: row.token || label, railcar_id: id, label });
    }
    for (const row of page.ambiguous ?? []) {
      const token = String(row.token ?? "").trim();
      if (!token) continue;
      const matches: PasteMatchPreview["ambiguous"][number]["matches"] = [];
      for (const match of row.matches ?? []) {
        const id = Number(match.railcar_id ?? match.id);
        if (!Number.isFinite(id) || id <= 0 || alreadyIds.has(id)) continue;
        ambiguousIds.add(id);
        matches.push({
          railcar_id: id,
          label: String(match.label ?? id),
          active: match.active !== false,
        });
      }
      if (matches.length) ambiguous.push({ token, reason: row.reason, matches });
    }
    for (const token of page.not_found ?? []) {
      const value = String(token ?? "").trim();
      if (value) pushMissing(value, "Not in the fleet.");
    }
    if (page.truncated) {
      pushMissing("Paste list", "Search cut this batch off at 500 cars. Shorten the list and match again.");
    }
  }

  for (const page of pages) {
    for (const car of page.railcars ?? []) {
      const id = Number(car.id);
      if (!Number.isFinite(id) || id <= 0 || seenMatch.has(id) || alreadyIds.has(id) || ambiguousIds.has(id)) continue;
      seenMatch.add(id);
      const label = pasteCarLabel(car);
      if (car.active === false) {
        pushMissing(label, "Inactive. Programs only add active cars.");
        continue;
      }
      matched.push({ token: label, railcar_id: id, label });
    }
  }

  for (const row of rejected) {
    pushMissing(row.raw, row.message);
  }

  return { matched, not_found: notFound, already_in_program: already, ambiguous };
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
