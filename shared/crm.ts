/**
 * CRM Phase 1 types and pure rules.
 * Renewal selection matches the generator: active, non-placeholder, at least one
 * on-rent non-Sold Leased car, governed expiry inside [today, today+months).
 */

export const OPPORTUNITY_TYPES = [
  "renewal",
  "relet",
  "new_business",
  "expansion",
  "purchase",
  "sale",
  "sale_leaseback",
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export const OPPORTUNITY_STAGES = [
  "identified",
  "qualified",
  "priced",
  "in_review",
  "proposal",
  "docs",
  "won",
  "lost",
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const OPPORTUNITY_SOURCES = ["auto_expiry", "manual", "trinity", "handoff", "umler"] as const;
export type OpportunitySource = (typeof OPPORTUNITY_SOURCES)[number];

export const LOSS_REASONS = [
  "rate",
  "term",
  "competitor",
  "car_type",
  "credit",
  "timing",
  "returned",
  "other",
] as const;
export type LossReason = (typeof LOSS_REASONS)[number];

export const CRM_ACTIVITY_KINDS = ["call", "meeting", "email", "note", "task"] as const;
export type CrmActivityKind = (typeof CRM_ACTIVITY_KINDS)[number];

export const GOVERNED_EXPIRY_SOURCES = ["asset_report", "asset_report_multi_term"] as const;
export type GovernedExpirySource = (typeof GOVERNED_EXPIRY_SOURCES)[number];

export const MULTI_TERM_RENEWAL_NOTE = "multi-term: check car groups";

export const OPPORTUNITY_TYPE_LABEL: Record<OpportunityType, string> = {
  renewal: "Renewal",
  relet: "Re-lease",
  new_business: "New business",
  expansion: "Expansion",
  purchase: "Purchase",
  sale: "Sale",
  sale_leaseback: "Sale-leaseback",
};

export const OPPORTUNITY_STAGE_LABEL: Record<OpportunityStage, string> = {
  identified: "Identified",
  qualified: "Qualified",
  priced: "Priced",
  in_review: "In review",
  proposal: "Proposal",
  docs: "Docs",
  won: "Won",
  lost: "Lost",
};

export type OpportunityRow = {
  id: number;
  account_id: number;
  master_lease_id: number | null;
  rider_id: number | null;
  company_id: number | null;
  type: OpportunityType;
  stage: OpportunityStage;
  owner: string | null;
  source: OpportunitySource;
  car_type: string | null;
  car_count: number | null;
  current_rate: number | null;
  target_rate: number | null;
  term_months: number | null;
  est_value: number | null;
  expiry_date: string | null;
  new_expiry_date: string | null;
  expected_close: string | null;
  won_rider_id: number | null;
  sublessee_note: string | null;
  competitor: string | null;
  loss_reason: LossReason | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type CrmActivityRow = {
  id: number;
  account_id: number | null;
  opportunity_id: number | null;
  rider_id: number | null;
  company_id: number | null;
  contact_id: number | null;
  kind: CrmActivityKind;
  body: string;
  due_date: string | null;
  done_at: string | null;
  actor: string;
  occurred_at: string;
  created_at: string;
};

const TYPE_SET = new Set<string>(OPPORTUNITY_TYPES);
const STAGE_SET = new Set<string>(OPPORTUNITY_STAGES);
const SOURCE_SET = new Set<string>(OPPORTUNITY_SOURCES);
const LOSS_SET = new Set<string>(LOSS_REASONS);
const KIND_SET = new Set<string>(CRM_ACTIVITY_KINDS);
const GOVERNED_SET = new Set<string>(GOVERNED_EXPIRY_SOURCES);

export function isOpportunityType(value: unknown): value is OpportunityType {
  return typeof value === "string" && TYPE_SET.has(value);
}

export function isOpportunityStage(value: unknown): value is OpportunityStage {
  return typeof value === "string" && STAGE_SET.has(value);
}

export function isOpportunitySource(value: unknown): value is OpportunitySource {
  return typeof value === "string" && SOURCE_SET.has(value);
}

export function isLossReason(value: unknown): value is LossReason {
  return typeof value === "string" && LOSS_SET.has(value);
}

export function isCrmActivityKind(value: unknown): value is CrmActivityKind {
  return typeof value === "string" && KIND_SET.has(value);
}

export function isOpenStage(stage: string | null | undefined): boolean {
  return stage != null && stage !== "won" && stage !== "lost";
}

export function isGovernedExpirySource(value: string | null | undefined): value is GovernedExpirySource {
  return value != null && GOVERNED_SET.has(value);
}

/** Postgres `date + interval 'n months'`, clamped to the last day of the target month. */
export function addMonthsIso(isoDate: string, months: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`Invalid date: ${isoDate}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthIndex = month - 1 + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return new Date(Date.UTC(targetYear, targetMonth, targetDay)).toISOString().slice(0, 10);
}

/** Half-open window [today, today+months). ISO dates compare lexicographically. */
export function inRenewalWindow(expiry: string, today: string, months: number): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  if (!Number.isFinite(months) || months <= 0) return false;
  const end = addMonthsIso(today, months);
  return expiry >= today && expiry < end;
}

export type RenewalExclusion =
  | "placeholder"
  | "lifecycle"
  | "on_rent"
  | "expiry_source"
  | "window"
  | "open_renewal";

export type RenewalRiderInput = {
  lifecycle_status: string | null;
  is_placeholder: boolean;
  expiration_date: string | null;
  expiration_source: string | null;
  /** On-rent, non-Sold, fleet_status Leased cars. Sold cars must not be counted. */
  on_rent_nonsold_leased: number;
  has_open_renewal: boolean;
};

export function renewalExclusion(row: RenewalRiderInput, opts: { today: string; months: number }): RenewalExclusion | null {
  if (row.is_placeholder) return "placeholder";
  if (row.lifecycle_status !== "active") return "lifecycle";
  if (!(row.on_rent_nonsold_leased >= 1)) return "on_rent";
  if (!isGovernedExpirySource(row.expiration_source)) return "expiry_source";
  if (!row.expiration_date || !inRenewalWindow(row.expiration_date, opts.today, opts.months)) return "window";
  if (row.has_open_renewal) return "open_renewal";
  return null;
}

export function isRenewalCandidate(row: RenewalRiderInput, opts: { today: string; months: number }): boolean {
  return renewalExclusion(row, opts) === null;
}

/** Lost stage requires a reason. Mirrors opportunities.lost_needs_reason. */
export function lostNeedsReason(stage: string | null | undefined, lossReason: string | null | undefined): boolean {
  if (stage !== "lost") return false;
  return lossReason == null || String(lossReason).trim() === "";
}

export function wonReletNeedsRemarket(input: {
  type: string | null | undefined;
  stage: string | null | undefined;
  won_rider_id: number | null | undefined;
}): boolean {
  return input.type === "relet" && input.stage === "won" && (input.won_rider_id == null || !Number.isFinite(Number(input.won_rider_id)));
}

export function remarketRiderUrl(riderId: number | null | undefined): string | null {
  const id = Number(riderId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return `#/leases/rider/${id}`;
}

/** Most common non-blank value. Ties break alphabetically so the result is stable. */
export function mostCommonValue(values: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of Array.from(counts.entries())) {
    if (count > bestCount || (count === bestCount && (best == null || value < best))) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export function ownerLabel(owner: string | null | undefined): string {
  const text = String(owner ?? "").trim();
  return text || "Unassigned";
}

export type RenewalPreviewRow = {
  rider_id: number;
  rider_name: string | null;
  master_lease_id: number;
  account_id: number;
  account_name: string | null;
  company_id: number | null;
  owner: string | null;
  car_count: number;
  car_type: string | null;
  current_rate: number | null;
  expiry_date: string;
  expiration_source: string;
  notes: string | null;
};

export type RenewalRunResult = {
  dry_run: boolean;
  months: number;
  today: string;
  riders: number;
  cars: number;
  accounts: number;
  created: number;
  rows: RenewalPreviewRow[];
  change_group: string | null;
};

export type WatchRow = {
  rider_id: number;
  rider_name: string | null;
  master_lease_id: number | null;
  lessee: string | null;
  account_id: number | null;
  account_name: string | null;
  owner: string | null;
  expiration_date: string | null;
  expiration_source: string | null;
  lease_status: string | null;
  on_rent_cars: number;
  unsold_cars: number;
  bucket: "holdover" | "check_date" | "off_lease";
  reason: string;
};

export type Account360Ol = {
  rider_id: number;
  rider_name: string | null;
  master_lease_id: number;
  lessee: string | null;
  lifecycle_status: string | null;
  expiration_date: string | null;
  expiration_source: string | null;
  on_rent_cars: number;
  monthly_rent_per_car: number | null;
  open_opportunity_id: number | null;
};

export type Account360Contact = {
  id: number;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  company_id: number | null;
  company_name: string | null;
  function_role: string | null;
};

export type Account360TimelineItem = {
  id: string;
  occurred_at: string;
  source: "crm" | "system";
  label: string;
  body: string;
  actor: string | null;
};

export type Account360Payload = {
  account: {
    id: number;
    name: string;
    account_manager: string | null;
    notes: string | null;
    kind: "client" | "prospect";
  };
  counts: {
    lessees: number;
    ols: number;
    on_rent_cars: number;
    off_lease: number;
    open_opps: number;
    est_value: number;
  };
  next_expiry: string | null;
  last_activity_at: string | null;
  expiry_bars: { month: string; cars: number }[];
  ols: Account360Ol[];
  contacts: { role: string; people: Account360Contact[] }[];
  opportunities: OpportunityRow[];
  timeline: Account360TimelineItem[];
  transition: { id: number; status: string | null } | null;
};
