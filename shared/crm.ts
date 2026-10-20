import { isPlaceholderLessee } from "./lease-mgmt";

/**
 * CRM Phase 1 types and pure rules.
 * Renewal selection matches the generator: an active rider (see isActiveRider),
 * non-placeholder, at least one on-rent non-Sold Leased car, governed expiry
 * inside [today, today+months).
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
  "negotiating",
  "won",
  "lost",
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const OPPORTUNITY_SOURCES = ["auto_expiry", "manual", "trinity", "handoff", "umler", "referral", "inbound"] as const;
export type OpportunitySourcePreset = (typeof OPPORTUNITY_SOURCES)[number];
/** Preset key or free text. `auto_expiry` is written only by the renewal generator. */
export type OpportunitySource = string;

export const OPPORTUNITY_SOURCE_LABEL: Record<OpportunitySourcePreset, string> = {
  auto_expiry: "Auto expiry",
  manual: "Manual",
  trinity: "Trinity book",
  handoff: "Handoff",
  umler: "UMLER prospecting",
  referral: "Referral",
  inbound: "Inbound",
};

export const OPPORTUNITY_SOURCE_MAX = 60;
export const AUTO_EXPIRY_SOURCE_ERROR = "auto_expiry is reserved for generated renewals";
export const AUTO_EXPIRY_CHANGE_ERROR = "Source cannot change to or from auto_expiry";

export function opportunitySourceLabel(source: string): string {
  if ((OPPORTUNITY_SOURCES as readonly string[]).includes(source)) {
    return OPPORTUNITY_SOURCE_LABEL[source as OpportunitySourcePreset];
  }
  return source;
}

export function collapseSourceWhitespace(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

/** Case, space, and underscore insensitive match of the reserved key or its label. */
export function isReservedAutoExpiryInput(input: string): boolean {
  const folded = collapseSourceWhitespace(input).toLowerCase().replace(/[\s_]+/g, "");
  return folded === "autoexpiry";
}

export function normalizeOpportunitySource(input: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof input !== "string") return { ok: false, error: "Source must be between 1 and 60 characters" };
  const value = collapseSourceWhitespace(input);
  if (!value || value.length > OPPORTUNITY_SOURCE_MAX) {
    return { ok: false, error: "Source must be between 1 and 60 characters" };
  }
  if (isReservedAutoExpiryInput(value)) return { ok: false, error: AUTO_EXPIRY_SOURCE_ERROR };
  const lower = value.toLowerCase();
  for (const key of OPPORTUNITY_SOURCES) {
    if (key === "auto_expiry") continue;
    const label = OPPORTUNITY_SOURCE_LABEL[key];
    if (lower === key || lower === label.toLowerCase()) return { ok: true, value: key };
  }
  return { ok: true, value };
}

/**
 * Create never stores auto_expiry. A patch may resubmit the same auto_expiry
 * value and may not move to or from it.
 */
export function resolveOpportunitySourceWrite(
  input: unknown,
  mode: "create" | "patch",
  previous: string | null,
): { ok: true; value: string } | { ok: false; error: string } {
  const raw = input == null || input === "" ? "manual" : input;
  if (mode === "patch" && previous === "auto_expiry" && typeof raw === "string" && isReservedAutoExpiryInput(raw)) {
    return { ok: true, value: "auto_expiry" };
  }
  const norm = normalizeOpportunitySource(raw);
  if (!norm.ok) return norm;
  if (mode === "patch" && previous === "auto_expiry" && norm.value !== previous) {
    return { ok: false, error: AUTO_EXPIRY_CHANGE_ERROR };
  }
  if (mode === "create") return norm;
  if (mode === "patch") return norm;
  const unreachable: never = mode;
  return unreachable;
}

/** Sources offered when someone types a deal. Generated renewals keep auto_expiry. */
export const MANUAL_OPPORTUNITY_SOURCES = ["manual", "trinity", "referral", "inbound", "umler", "handoff"] as const;

export type SourceSuggestion = { value: string; label: string };

/** Presets except auto_expiry, then distinct free-text sources, deduped case-insensitively. */
export function mergeSourceSuggestions(stored: readonly string[]): SourceSuggestion[] {
  const presets: SourceSuggestion[] = MANUAL_OPPORTUNITY_SOURCES.map((value) => ({
    value,
    label: OPPORTUNITY_SOURCE_LABEL[value],
  }));
  const seen = new Set(presets.map((row) => row.value.toLowerCase()));
  const free = new Map<string, string>();
  for (const raw of stored) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value || isReservedAutoExpiryInput(value)) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    const current = free.get(key);
    if (current == null || value < current) free.set(key, value);
  }
  const extras = [...free.values()]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: opportunitySourceLabel(value) }));
  return [...presets, ...extras];
}

export const LESSEE_ROLES = ["lessee", "sublessee"] as const;
export type LesseeRole = (typeof LESSEE_ROLES)[number];

export const OPPORTUNITY_CONTACT_ROLES = ["primary", "decision_maker", "influencer", "billing", "contact"] as const;
export type OpportunityContactRole = (typeof OPPORTUNITY_CONTACT_ROLES)[number];

export const OPPORTUNITY_CONTACT_ROLE_LABEL: Record<OpportunityContactRole, string> = {
  primary: "Primary",
  decision_maker: "Decision maker",
  influencer: "Influencer",
  billing: "Billing",
  contact: "Contact",
};

/** Quick-create types. Values are companies.relationship_type. */
export const PROSPECT_COMPANY_TYPES = [
  { value: "prospect", label: "Shipper/lessee" },
  { value: "railroad", label: "Railroad" },
  { value: "lessor", label: "Lessor/competitor" },
  { value: "broker", label: "Broker" },
  { value: "other", label: "Other" },
] as const;
export type ProspectCompanyType = (typeof PROSPECT_COMPANY_TYPES)[number]["value"];

export const PARTY_KINDS = ["client", "prospect", "former", "company", "contact"] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

export const PARTY_KIND_LABEL: Record<PartyKind, string> = {
  client: "Client",
  prospect: "Prospect",
  former: "Former client",
  company: "Company",
  contact: "Contact",
};

export const PARTY_KIND_RANK: Record<PartyKind, number> = {
  client: 1,
  prospect: 2,
  former: 3,
  company: 4,
  contact: 5,
};

export const CAR_TYPE_SUGGESTIONS = ["Covered Hopper", "Tank", "Box", "Gondola", "Flat", "Autorack", "Centerbeam", "Hopper"] as const;

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

/** Informational only. Finance leases are long-term, NET, and defined upfront. */
export const FINANCE_LEASE_TAG = "Finance lease (FL)";

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
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
};

export type OpportunityRow = {
  id: number;
  account_id: number;
  master_lease_id: number | null;
  rider_id: number | null;
  /** Read-model only. Loaded from riders.rider_name; not an opportunities column. */
  rider_name?: string | null;
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
  lessee_role: LesseeRole;
  tags: string[];
  referral_note: string | null;
  notes: string | null;
  account_name?: string | null;
  next_step?: "setup_lessee" | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  flavor: "portfolio_bid" | null;
  outcome: "won" | "lost" | "passed" | null;
  bid_substage: "inspection" | "final" | null;
  seller_company_id: number | null;
  broker_company_id: number | null;
  offering_name: string | null;
  received_date: string | null;
  bid_due_prelim: string | null;
  bid_due_final: string | null;
  award_date: string | null;
  seller_name?: string | null;
  broker_name?: string | null;
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

export function isOpportunitySource(value: unknown): value is OpportunitySourcePreset {
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

export type ActiveRiderInput = {
  lifecycle_status: string | null;
  is_placeholder: boolean;
  /**
   * Active, on-rent, non-Sold, fleet_status Leased cars.
   * Sold, idle, and off-rent cars are not counted.
   */
  on_rent_nonsold_leased: number;
};

/**
 * One rule for the renewal generator, Account 360 OL count, and watch lists.
 * A rider is active when lifecycle_status is 'active', or when lifecycle_status
 * is null and it has at least one on-rent non-Sold Leased car on a
 * non-placeholder lessee. off_lease_pending_remarketing never counts. Any other
 * status does not count. Null riders that only sit in Sold, idle, or off-rent
 * buckets stay excluded.
 */
export function isActiveRider(row: ActiveRiderInput): boolean {
  if (row.lifecycle_status === "active") return true;
  if (row.lifecycle_status == null) {
    return !row.is_placeholder && row.on_rent_nonsold_leased >= 1;
  }
  return false;
}

/** OL numbers that start with FL. Display tag only; the generator does not write a note. */
export function financeLeaseTag(olNumber: string | null | undefined): typeof FINANCE_LEASE_TAG | null {
  const code = String(olNumber ?? "").trim();
  return code.startsWith("FL") ? FINANCE_LEASE_TAG : null;
}

/** Generator note. Finance leases are tagged in the UI and do not get a note. */
export function renewalAutoNotes(expirationSource: string | null | undefined): string | null {
  if (expirationSource === "asset_report_multi_term") return MULTI_TERM_RENEWAL_NOTE;
  return null;
}

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
  if (!isActiveRider(row)) return "lifecycle";
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
  bucket: "holdover" | "check_date" | "off_lease" | "unclassified";
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

export type AwaitingLesseeRow = {
  opportunity_id: number;
  account_id: number;
  account_name: string;
  type: OpportunityType;
  closed_at: string | null;
  aged: boolean;
  owner: string | null;
};

export type OpportunityContactLink = {
  id?: number;
  contact_id: number;
  role: string;
};

export type OpportunityContactRow = {
  id: number;
  opportunity_id: number;
  contact_id: number;
  role: OpportunityContactRole;
  name: string | null;
  email: string | null;
};

const LESSEE_ROLE_SET = new Set<string>(LESSEE_ROLES);
const CONTACT_ROLE_SET = new Set<string>(OPPORTUNITY_CONTACT_ROLES);
const PROSPECT_TYPE_SET = new Set<string>(PROSPECT_COMPANY_TYPES.map((row) => row.value));

export function isLesseeRole(value: unknown): value is LesseeRole {
  return typeof value === "string" && LESSEE_ROLE_SET.has(value);
}

export function isOpportunityContactRole(value: unknown): value is OpportunityContactRole {
  return typeof value === "string" && CONTACT_ROLE_SET.has(value);
}

export function isProspectCompanyType(value: unknown): value is ProspectCompanyType {
  return typeof value === "string" && PROSPECT_TYPE_SET.has(value);
}

/**
 * Picker kind for an account. Placeholder buckets are excluded.
 * A real lessee flagged is_placeholder is excluded even when the name would pass.
 * A name with no lessee is excluded only when isPlaceholderLessee says so
 * (Xcel Energy and DTE stay visible).
 */
export function classifyAccountParty(input: {
  hasLessee: boolean;
  allPlaceholderLessee: boolean;
  isClient: boolean;
  name: string;
}): PartyKind | "excluded" {
  if (input.hasLessee && input.allPlaceholderLessee) return "excluded";
  if (!input.hasLessee && isPlaceholderLessee(input.name)) return "excluded";
  if (!input.hasLessee) return "prospect";
  if (input.isClient) return "client";
  return "former";
}

export function parseReportingMarks(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
  const marks: string[] = [];
  for (const item of items) {
    const mark = String(item).trim().toUpperCase();
    if (!mark || marks.includes(mark)) continue;
    marks.push(mark);
  }
  return marks;
}

export type TagNormalizeResult = { ok: true; tags: string[] } | { ok: false; error: string };

/** Trim, lowercase, unique. At most 10 tags, each at most 30 characters. */
export function normalizeTags(raw: unknown): TagNormalizeResult {
  if (raw == null) return { ok: true, tags: [] };
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : null;
  if (!items) return { ok: false, error: "Tags must be a list" };
  const tags: string[] = [];
  for (const item of items) {
    const tag = String(item).trim().toLowerCase();
    if (!tag) continue;
    if (tag.length > 30) return { ok: false, error: "Each tag must be 30 characters or fewer" };
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > 10) return { ok: false, error: "At most 10 tags" };
  return { ok: true, tags };
}

export function contactBelongsToAccount(contactCompanyAccountId: number | null | undefined, accountId: number): boolean {
  return contactCompanyAccountId != null && contactCompanyAccountId === accountId;
}

export function wonProspectNextStep(input: {
  type: string | null | undefined;
  stage: string | null | undefined;
  isProspect: boolean;
}): "setup_lessee" | null {
  if (!input.isProspect || input.stage !== "won") return null;
  if (input.type !== "new_business" && input.type !== "expansion") return null;
  return "setup_lessee";
}

/**
 * A prospect deal marked Won makes the linked directory company a customer.
 * Already-won deals and companies that are already customers stay as they are.
 */
export function wonProspectBecomesCustomer(input: {
  stage: string | null | undefined;
  previousStage: string | null | undefined;
  isProspect: boolean;
  relationshipType: string | null | undefined;
}): boolean {
  if (!input.isProspect || input.stage !== "won" || input.previousStage === "won") return false;
  return input.relationshipType !== "customer";
}

export function wonRiderBelongsToAccount(riderAccountId: number | null | undefined, accountId: number): boolean {
  return riderAccountId != null && riderAccountId === accountId;
}

const AWAITING_LESSEE_MS = 30 * 24 * 60 * 60 * 1000;

export function isAwaitingLesseeAged(closedAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!closedAt) return false;
  const closed = new Date(closedAt).getTime();
  if (!Number.isFinite(closed)) return false;
  return nowMs - closed > AWAITING_LESSEE_MS;
}

/** Drop trigger-maintained columns so undo diffs stay about the edit itself. */
export function changeCaptureRow(row: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!row) return out;
  for (const [key, value] of Object.entries(row)) {
    if (key === "updated_at" || key === "search_vector" || key.endsWith("_search_vector")) continue;
    out[key] = value;
  }
  return out;
}

export function diffOpportunityContacts(
  before: OpportunityContactLink[],
  after: OpportunityContactLink[],
): { deleteIds: number[]; insert: { contact_id: number; role: string }[] } {
  const beforeByContact = new Map(before.map((row) => [row.contact_id, row]));
  const deleteIds: number[] = [];
  const insert: { contact_id: number; role: string }[] = [];
  for (const row of before) {
    if (row.id == null) continue;
    const next = after.find((item) => item.contact_id === row.contact_id);
    if (!next || next.role !== row.role) deleteIds.push(row.id);
  }
  for (const row of after) {
    const prev = beforeByContact.get(row.contact_id);
    if (!prev || prev.role !== row.role) insert.push({ contact_id: row.contact_id, role: row.role });
  }
  return { deleteIds, insert };
}

export function exactNameMatch<T extends { name: string }>(rows: T[], name: string): T | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  return rows.find((row) => row.name.trim().toLowerCase() === want) ?? null;
}

/** Bigram Dice coefficient, close enough to pg_trgm for the in-memory party tests. */
export function nameSimilarity(left: string, right: string): number {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (value: string) => {
    const counts = new Map<string, number>();
    const padded = `  ${value} `;
    for (let i = 0; i < padded.length - 2; i += 1) {
      const gram = padded.slice(i, i + 3);
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    return counts;
  };
  const ag = grams(a);
  const bg = grams(b);
  let aCount = 0;
  let bCount = 0;
  let shared = 0;
  for (const count of Array.from(ag.values())) aCount += count;
  for (const count of Array.from(bg.values())) bCount += count;
  for (const [gram, count] of Array.from(ag.entries())) shared += Math.min(count, bg.get(gram) ?? 0);
  if (aCount + bCount === 0) return 0;
  return (2 * shared) / (aCount + bCount);
}

export {
  acquiredLeaseTable,
  BID_STAGE_OPTIONS,
  bidStageId,
  bidStageLabel,
  bidStageOption,
  bidWinRate,
  formatWinRate,
  leaseWizardHref,
  lineBidTotal,
  nextBidDeadline,
  portfolioBidRequiresPurchase,
  PURCHASE_TYPE,
  rollupBidLines,
  type BidStageId,
} from "./crm-bid";
