import { tierFromBriefingTrack, type AccountTier } from "../shared/account-mgmt";

/** Official-owner assignments Bruce signed off. Accounts 29 and 244 stay unowned. */
export const AM1_OWNER_ASSIGNMENTS = [
  { account_id: 118, name: "Alpek Polyester (xTrinity)", owner: "BH" },
  { account_id: 121, name: "Befesa", owner: "BH" },
  { account_id: 13, name: "Carmeuse Lime & Stone", owner: "BH" },
  { account_id: 176, name: "Case Farms", owner: "BH" },
  { account_id: 189, name: "Formosa Plastics Corporation", owner: "BH" },
  { account_id: 174, name: "GCC Rio Grande, Inc.", owner: "BH" },
  { account_id: 47, name: "M.H.F. Services", owner: "BH" },
  { account_id: 180, name: "Nouryon Pulp & Performance Chemicals (fka EKA)", owner: "BH" },
  { account_id: 82, name: "Swenson Granite", owner: "BH" },
  { account_id: 254, name: "Scoular", owner: "FF" },
  { account_id: 122, name: "Triple M (US) Inc.", owner: "FF" },
  { account_id: 102, name: "US Gypsum", owner: "FF" },
] as const;

export const AM1_STAY_UNOWNED = [
  { account_id: 29, name: "TotalEnergies Petrochemicals" },
  { account_id: 244, name: "Waelz Sustainable Products" },
] as const;

const STAY_IDS = new Set<number>(AM1_STAY_UNOWNED.map((row) => row.account_id));

export type OwnerLive = {
  current_owner: string | null;
  handoff_status: string | null;
  to_account_manager: string | null;
};

export type OwnerPlan = {
  account_id: number;
  name: string;
  current: string;
  next: string;
  action: "set" | "skip";
  reason: string;
};

export type TierLive = {
  account_id: number;
  name: string;
  current_tier: string | null;
  briefing_track: string | null;
  segment: "client" | "former" | "prospect" | "other";
};

export type TierPlan = {
  account_id: number;
  name: string;
  segment: TierLive["segment"];
  current: string | null;
  next: AccountTier | null;
  action: "set" | "skip" | "unmapped";
  reason: string;
};

export type CsvRow = {
  account_id: number;
  name: string;
  field: string;
  before: string;
  after: string;
  reason: string;
};

function blank(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function showBlank(value: string | null | undefined): string {
  return blank(value) ?? "(blank)";
}

export function planOwnerRow(assignment: { account_id: number; name: string; owner: string }, live: OwnerLive): OwnerPlan {
  const current = blank(live.current_owner);
  const target = assignment.owner;
  const base = {
    account_id: assignment.account_id,
    name: assignment.name,
    current: showBlank(current),
    next: target,
  };
  if (STAY_IDS.has(assignment.account_id)) {
    return { ...base, action: "skip", reason: "skipped: protected unowned account" };
  }
  if (current != null) {
    return { ...base, action: "skip", reason: "skipped: already set" };
  }
  const incoming = blank(live.to_account_manager);
  const open = live.handoff_status === "open";
  if (!open || incoming !== target) {
    return { ...base, action: "skip", reason: "skipped: incoming owner does not match target" };
  }
  return { ...base, action: "set", reason: "set official owner" };
}

export function planOwnerAssignments(liveById: Map<number, OwnerLive>): OwnerPlan[] {
  return AM1_OWNER_ASSIGNMENTS.map((row) => planOwnerRow(row, liveById.get(row.account_id) ?? {
    current_owner: null,
    handoff_status: null,
    to_account_manager: null,
  }));
}

export function planTierRow(row: TierLive): TierPlan {
  const next = tierFromBriefingTrack(row.briefing_track);
  const current = blank(row.current_tier);
  if (STAY_IDS.has(row.account_id)) {
    return {
      account_id: row.account_id,
      name: row.name,
      segment: row.segment,
      current,
      next,
      action: "skip",
      reason: "skipped: protected unowned account",
    };
  }
  if (!next) {
    return {
      account_id: row.account_id,
      name: row.name,
      segment: row.segment,
      current,
      next: null,
      action: "unmapped",
      reason: "unmapped briefing track left blank",
    };
  }
  if (current != null) {
    return {
      account_id: row.account_id,
      name: row.name,
      segment: row.segment,
      current,
      next,
      action: "skip",
      reason: "skipped: already set",
    };
  }
  return {
    account_id: row.account_id,
    name: row.name,
    segment: row.segment,
    current,
    next,
    action: "set",
    reason: "seed tier from briefing",
  };
}

export function ownerSignoffTable(plans: OwnerPlan[]): string {
  const header = ["account_id", "account", "current", "new", "action", "reason"].join("\t");
  const lines = plans.map((row) => [row.account_id, row.name, row.current, row.next, row.action, row.reason].join("\t"));
  return [header, ...lines].join("\n");
}

export function previewCsvRows(owners: OwnerPlan[], tiers: TierPlan[]): CsvRow[] {
  const rows: CsvRow[] = [];
  for (const row of owners) {
    rows.push({
      account_id: row.account_id,
      name: row.name,
      field: "account_manager",
      before: row.current === "(blank)" ? "" : row.current,
      after: row.action === "set" ? row.next : row.current === "(blank)" ? "" : row.current,
      reason: row.reason,
    });
  }
  for (const row of tiers) {
    rows.push({
      account_id: row.account_id,
      name: row.name,
      field: "tier",
      before: row.current ?? "",
      after: row.action === "set" ? row.next ?? "" : row.current ?? "",
      reason: row.reason,
    });
  }
  return rows;
}

export function toCsv(rows: CsvRow[]): string {
  const headers = ["account_id", "name", "field", "before", "after", "reason"];
  const esc = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((key) => esc(row[key as keyof CsvRow])).join(","))].join("\n") + "\n";
}

export function assertAm1ApplyAllowed(apply: boolean, env: { AM1_APPLY_OK?: string }): void {
  if (!apply) return;
  if (env.AM1_APPLY_OK !== "bruce") {
    throw new Error("Refusing --apply without AM1_APPLY_OK=bruce");
  }
}

export type PlannedWrite = {
  group: "owners" | "tiers";
  account_id: number;
  patch: { account_manager?: string; tier?: AccountTier };
};

export function parseAm1Part(argv: string[]): "owners" | "tiers" | "all" {
  const index = argv.indexOf("--part");
  const part = index === -1 ? "owners" : argv[index + 1];
  if (part !== "owners" && part !== "tiers" && part !== "all") {
    throw new Error("--part must be owners, tiers, or all");
  }
  return part;
}

export function writesForPart(writes: PlannedWrite[], part: "owners" | "tiers" | "all"): PlannedWrite[] {
  if (part === "all") return writes;
  return writes.filter((row) => row.group === part);
}

export function plannedWrites(owners: OwnerPlan[], tiers: TierPlan[]): PlannedWrite[] {
  const writes: PlannedWrite[] = [];
  for (const row of owners) {
    if (row.action !== "set") continue;
    if (STAY_IDS.has(row.account_id)) continue;
    writes.push({ group: "owners", account_id: row.account_id, patch: { account_manager: row.next } });
  }
  for (const row of tiers) {
    if (row.action !== "set" || !row.next) continue;
    if (STAY_IDS.has(row.account_id)) continue;
    writes.push({ group: "tiers", account_id: row.account_id, patch: { tier: row.next } });
  }
  return writes;
}

export async function executeAm1Plans(opts: {
  apply: boolean;
  env: { AM1_APPLY_OK?: string };
  writes: PlannedWrite[];
  write: (group: "owners" | "tiers", write: PlannedWrite) => Promise<{ change_group: string }>;
}): Promise<{ applied: boolean; groups: { name: "owners" | "tiers"; change_group: string | null; count: number }[] }> {
  const groups = (["owners", "tiers"] as const).map((name) => ({
    name,
    change_group: null as string | null,
    count: opts.writes.filter((row) => row.group === name).length,
  }));
  if (!opts.apply) return { applied: false, groups };
  assertAm1ApplyAllowed(true, opts.env);
  for (const group of groups) {
    const rows = opts.writes.filter((row) => row.group === group.name);
    for (const row of rows) {
      if (STAY_IDS.has(row.account_id)) throw new Error(`Refusing to write protected account ${row.account_id}`);
      const saved = await opts.write(group.name, row);
      group.change_group = saved.change_group;
    }
  }
  return { applied: true, groups };
}
