import { handoffScoreParts, type HandoffScoreInput } from "./account-transitions";

export const TIER_VALUES = ["track_1", "track_2", "track_3"] as const;
export type AccountTier = (typeof TIER_VALUES)[number];

export const TIER_LABEL: Record<AccountTier, string> = {
  track_1: "Track 1",
  track_2: "Track 2",
  track_3: "Track 3",
};

export const TIER_DEFAULT_CADENCE: Record<AccountTier, number> = {
  track_1: 30,
  track_2: 60,
  track_3: 90,
};

export type TouchStatus = "overdue" | "due_soon" | "ok" | "never" | "untiered";

export type RentRoll = {
  total: number;
  snapshot_month: string | null;
  riders_without_summary: number;
};

export type AccountBookSegment = "mybook" | "client" | "former" | "prospect" | "all";

export type AccountBookRow = {
  account_id: number;
  name: string;
  kind: "client" | "former" | "prospect";
  owner_of_record: string | null;
  incoming_owner: string | null;
  effective_owner: string | null;
  handoff_pct: number | null;
  tier: string | null;
  cadence_days: number | null;
  on_rent_cars: number;
  rent_roll: RentRoll | null;
  next_expiry: string | null;
  renewal_riders_6mo: number;
  open_opps: number;
  last_touch_at: string | null;
  next_touch_due: string | null;
  touch_status: TouchStatus;
};

export type AccountBookAttention = {
  renewals_6mo: number;
  touch_overdue: number;
  never_touched_tiered: number;
  handoffs_incoming: number;
  unowned_clients: { account_id: number; name: string }[];
  untiered: number;
};

export type UnmatchedRentRow = {
  rider_name: string;
  monthly_rent_total: number;
  snapshot_month: string | null;
};

export type AccountBookResponse = {
  segment: AccountBookSegment;
  owner: string;
  tier: string;
  q: string;
  counts: { client: number; former: number; prospect: number };
  attention: AccountBookAttention;
  unmatched_import: UnmatchedRentRow[];
  rows: AccountBookRow[];
};

export type AccountBrief = {
  tier_track: string | null;
  overall_account_health: string | null;
  renewal_risk_retention: string | null;
  growth_potential_pipeline: string | null;
  landmines: string | null;
  credit_payment_history: string | null;
  completed_at: string | null;
  outgoing_signature_name: string | null;
};

const TIER_SET = new Set<string>(TIER_VALUES);

export function isAccountTier(value: unknown): value is AccountTier {
  return typeof value === "string" && TIER_SET.has(value);
}

export function tierLabel(tier: string | null | undefined): string {
  if (!isAccountTier(tier)) return "No tier";
  return TIER_LABEL[tier];
}

/** Briefing "Track N…" maps to a tier. Anything else, including null, stays unset. */
export function tierFromBriefingTrack(text: string | null | undefined): AccountTier | null {
  const raw = String(text ?? "");
  if (/^\s*track\s*1/i.test(raw)) return "track_1";
  if (/^\s*track\s*2/i.test(raw)) return "track_2";
  if (/^\s*track\s*3/i.test(raw)) return "track_3";
  return null;
}

export function effectiveCadence(tier: string | null | undefined, override: number | null | undefined): number | null {
  if (override != null && Number.isFinite(Number(override))) return Number(override);
  if (isAccountTier(tier)) return TIER_DEFAULT_CADENCE[tier];
  return null;
}

export function isTouchActivity(row: { kind?: string | null; done_at?: string | null }): boolean {
  const kind = String(row.kind ?? "");
  if (kind === "call" || kind === "meeting" || kind === "email" || kind === "note") return true;
  if (kind === "task" && row.done_at) return true;
  return false;
}

function dateOnly(iso: string): string | null {
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function addDaysIso(isoDate: string, days: number): string | null {
  const day = dateOnly(isoDate);
  if (!day || !Number.isFinite(days)) return null;
  const [year, month, date] = day.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function daysUntil(today: string, due: string): number | null {
  const start = dateOnly(today);
  const end = dateOnly(due);
  if (!start || !end) return null;
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Null when there is no cadence or no touch yet. */
export function nextTouchDue(lastTouchIso: string | null | undefined, cadenceDays: number | null | undefined): string | null {
  if (cadenceDays == null || !Number.isFinite(cadenceDays) || cadenceDays <= 0) return null;
  if (!lastTouchIso) return null;
  return addDaysIso(lastTouchIso, cadenceDays);
}

export function touchStatus(input: {
  tier: string | null | undefined;
  cadenceDays: number | null | undefined;
  lastTouchIso: string | null | undefined;
  today: string;
}): TouchStatus {
  if (!isAccountTier(input.tier)) return "untiered";
  const due = nextTouchDue(input.lastTouchIso, input.cadenceDays);
  if (!due) return "never";
  const until = daysUntil(input.today, due);
  if (until == null) return "never";
  if (until < 0) return "overdue";
  if (until <= 7) return "due_soon";
  return "ok";
}

function blankToNull(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

/** Incoming owner wins while a handoff is open. Mirrors v_account_owner_effective. */
export function effectiveOwner(input: {
  owner_of_record?: string | null;
  incoming_owner?: string | null;
}): string | null {
  return blankToNull(input.incoming_owner) ?? blankToNull(input.owner_of_record);
}

export function renewalOwnerFields(input: {
  owner_of_record?: string | null;
  incoming_owner?: string | null;
}): { owner: string | null; owner_of_record: string | null; incoming_owner: string | null } {
  const owner_of_record = blankToNull(input.owner_of_record);
  const incoming_owner = blankToNull(input.incoming_owner);
  return {
    owner: effectiveOwner({ owner_of_record, incoming_owner }),
    owner_of_record,
    incoming_owner,
  };
}

export function handoffPct(input: HandoffScoreInput | null | undefined, handoffId: number | null | undefined): number | null {
  if (handoffId == null) return null;
  return handoffScoreParts({
    to_account_manager: input?.to_account_manager,
    meeting_scheduled: input?.meeting_scheduled,
    communication_completed: input?.communication_completed,
    briefing_form_completed: input?.briefing_form_completed,
  }).pct;
}

export type RentRiderKey = {
  rider_name: string | null;
  account_id: number | null;
  is_placeholder?: boolean | null;
};

export type RentImportSlice = {
  /** rider_financial_summary.rider_id: the rider name, such as OL1919. */
  rider_id: string;
  monthly_rent_total: number | string | null;
  former_deal?: string | null;
};

/**
 * Same key as v_account_rent_roll: sum every slice whose rider_id equals
 * riders.rider_name. A numeric riders.id never matches. Names with no rider
 * row are returned as unmatched instead of being dropped.
 */
export function accountRentRoll(riders: RentRiderKey[], slices: RentImportSlice[]): {
  accounts: { account_id: number; monthly_rent_total: number; riders_in_import: number; riders_without_summary: number }[];
  unmatched: { rider_name: string; monthly_rent_total: number; slices: number }[];
} {
  const knownNames = new Set<string>();
  const namesByAccount = new Map<number, Set<string>>();
  for (const rider of riders) {
    const name = rider.rider_name == null ? "" : String(rider.rider_name);
    if (!name.trim()) continue;
    knownNames.add(name);
    if (rider.is_placeholder === true || rider.account_id == null) continue;
    const names = namesByAccount.get(rider.account_id) ?? new Set<string>();
    names.add(name);
    namesByAccount.set(rider.account_id, names);
  }
  const slicesByName = new Map<string, { total: number; count: number }>();
  for (const slice of slices) {
    const name = String(slice.rider_id);
    const prev = slicesByName.get(name) ?? { total: 0, count: 0 };
    prev.total += Number(slice.monthly_rent_total ?? 0);
    prev.count += 1;
    slicesByName.set(name, prev);
  }
  const accounts = Array.from(namesByAccount.entries()).map(([account_id, names]) => {
    let monthly_rent_total = 0;
    let riders_in_import = 0;
    let riders_without_summary = 0;
    for (const name of Array.from(names)) {
      const hit = slicesByName.get(name);
      if (!hit) riders_without_summary += 1;
      else {
        monthly_rent_total += hit.total;
        riders_in_import += 1;
      }
    }
    return { account_id, monthly_rent_total, riders_in_import, riders_without_summary };
  });
  const unmatched: { rider_name: string; monthly_rent_total: number; slices: number }[] = [];
  for (const entry of Array.from(slicesByName.entries())) {
    if (knownNames.has(entry[0])) continue;
    unmatched.push({ rider_name: entry[0], monthly_rent_total: entry[1].total, slices: entry[1].count });
  }
  unmatched.sort((a, b) => a.rider_name.localeCompare(b.rider_name));
  return { accounts, unmatched };
}

export function rentRollLabel(snapshotMonth: string | null | undefined): string {
  const day = snapshotMonth ? dateOnly(String(snapshotMonth)) : null;
  return `per import as of ${day ?? "—"}`;
}

export function touchStatusClass(status: TouchStatus): string {
  switch (status) {
    case "overdue":
      return "text-red-700";
    case "due_soon":
      return "text-amber-700";
    case "ok":
      return "text-emerald-700";
    case "never":
      return "text-muted-foreground";
    case "untiered":
      return "text-muted-foreground";
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}
