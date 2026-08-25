import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./fetch-all";
import { assertAccountImporterPatch } from "@shared/rider-import-guard";
import { countActiveCarsByRiderId } from "./rider-car-counts";

export type Account = {
  id: number;
  name: string;
  notes: string | null;
  account_manager: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountListRow = Account & {
  program_count: number;
};

export type LinkedProgram = {
  id: number;
  name: string;
  status: string | null;
  account_manager: string | null;
};

function isUniqueNameError(err: unknown) {
  const e = err as { code?: string; message?: string };
  return e?.code === "23505" || /accounts_name_uniq|duplicate key/i.test(String(e?.message ?? ""));
}

function escapeIlike(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export async function listAccounts(): Promise<AccountListRow[]> {
  const [accounts, programs] = await Promise.all([
    fetchAllRows<Account>((from, to) =>
      supabaseAdmin
        .from("accounts")
        .select("id, name, notes, account_manager, created_at, updated_at")
        .order("name", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<{ account_id: number | null }>((from, to) =>
      supabaseAdmin.from("programs").select("account_id").order("id", { ascending: true }).range(from, to)
    ).catch(async (err) => {
      if (!/account_id/i.test(String(err?.message ?? err))) throw err;
      return [];
    }),
  ]);

  const programCount = new Map<number, number>();
  for (const p of programs) {
    if (p.account_id == null) continue;
    programCount.set(p.account_id, (programCount.get(p.account_id) ?? 0) + 1);
  }

  return accounts.map((a) => ({
    ...a,
    program_count: programCount.get(a.id) ?? 0,
  }));
}

export async function createAccount(input: {
  name: string;
  notes?: string | null;
  account_manager?: string | null;
}) {
  const name = String(input.name ?? "").trim();
  if (!name) {
    const err = new Error("Name is required");
    (err as any).status = 400;
    throw err;
  }
  const row: Record<string, unknown> = {
    name,
    notes: input.notes?.trim() || null,
  };
  if (input.account_manager !== undefined) {
    row.account_manager = String(input.account_manager ?? "").trim() || null;
  }
  const { data, error } = await supabaseAdmin
    .from("accounts")
    .insert(row)
    .select("id, name, notes, account_manager, created_at, updated_at")
    .single();
  if (error) {
    if (isUniqueNameError(error)) {
      const err = new Error("An account with that name already exists");
      (err as any).status = 409;
      throw err;
    }
    throw error;
  }
  return data;
}

export async function updateAccount(
  id: number,
  input: { name?: string; notes?: string | null; account_manager?: string | null },
) {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) {
      const err = new Error("Name is required");
      (err as any).status = 400;
      throw err;
    }
    updates.name = name;
  }
  if (input.notes !== undefined) updates.notes = input.notes?.trim() || null;
  if (input.account_manager !== undefined) {
    updates.account_manager = String(input.account_manager ?? "").trim() || null;
  }
  const { data, error } = await supabaseAdmin
    .from("accounts")
    .update(updates)
    .eq("id", id)
    .select("id, name, notes, account_manager, created_at, updated_at")
    .maybeSingle();
  if (error) {
    if (isUniqueNameError(error)) {
      const err = new Error("An account with that name already exists");
      (err as any).status = 409;
      throw err;
    }
    throw error;
  }
  return data;
}

/**
 * Match or create an accounts row for a lessee name (same bootstrap as the
 * original seed). New accounts get account_manager = null. Importers must call
 * this instead of writing accounts.account_manager.
 */
export async function ensureAccountForLessee(lessee: string | null | undefined): Promise<number | null> {
  const name = String(lessee ?? "").trim();
  if (!name) return null;
  const payload = { name };
  assertAccountImporterPatch(payload);

  const { data: hits, error } = await supabaseAdmin
    .from("accounts")
    .select("id, name")
    .ilike("name", escapeIlike(name));
  if (error) throw error;
  const want = name.toLowerCase();
  const match = (hits ?? []).find((a) => String(a.name ?? "").trim().toLowerCase() === want);
  if (match) return match.id;

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("accounts")
    .insert(payload)
    .select("id")
    .single();
  if (insErr) {
    if (isUniqueNameError(insErr)) {
      const { data: again, error: againErr } = await supabaseAdmin
        .from("accounts")
        .select("id, name")
        .ilike("name", escapeIlike(name));
      if (againErr) throw againErr;
      const retry = (again ?? []).find((a) => String(a.name ?? "").trim().toLowerCase() === want);
      if (retry) return retry.id;
    }
    throw insErr;
  }
  return inserted.id;
}

export async function accountManagerByAccountIds(
  ids: number[],
): Promise<Map<number, string | null>> {
  const map = new Map<number, string | null>();
  const uniq = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  for (let i = 0; i < uniq.length; i += 200) {
    const slice = uniq.slice(i, i + 200);
    const { data, error } = await supabaseAdmin
      .from("accounts")
      .select("id, account_manager")
      .in("id", slice);
    if (error) throw error;
    for (const row of data ?? []) {
      const t = String(row.account_manager ?? "").trim();
      map.set(row.id, t || null);
    }
  }
  return map;
}

export const STATUS_TAGS = ["good", "watch", "risk"] as const;
export type StatusTag = (typeof STATUS_TAGS)[number];

export function isStatusTag(v: unknown): v is StatusTag {
  return typeof v === "string" && (STATUS_TAGS as readonly string[]).includes(v);
}

function expirationYear(iso: string | null | undefined): number | null {
  const s = String(iso ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return Number(s.slice(0, 4));
}

export type AccountOverviewRow = AccountListRow & {
  expire_years: number[];
  status_tags: StatusTag[];
};

export type AccountOverview = {
  managers: string[];
  expire_years: [number, number, number];
  kpis: {
    expiring: { year: number; count: number }[];
    status: { good: number; watch: number; risk: number };
  };
  /** Dashboard/History source of truth for OL expiration — not railcars.estimated_lease_expiry. */
  expiration_source: "riders.expiration_date";
  accounts: AccountOverviewRow[];
};

export async function listAccountManagementOverview(accountManager?: string | null): Promise<AccountOverview> {
  const nowYear = new Date().getFullYear();
  const expireYears: [number, number, number] = [nowYear, nowYear + 1, nowYear + 2];
  const wantAm = String(accountManager ?? "").trim();
  const wantUnassigned = wantAm.toLowerCase() === "unassigned";

  const [accounts, leases, riders] = await Promise.all([
    listAccounts(),
    fetchAllRows<{ id: number; account_id: number | null }>((from, to) =>
      supabaseAdmin
        .from("master_leases")
        .select("id, account_id")
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<{
      id: number;
      master_lease_id: number | null;
      expiration_date: string | null;
      status_tag: string | null;
    }>((from, to) =>
      supabaseAdmin
        .from("riders")
        .select("id, master_lease_id, expiration_date, status_tag")
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  const managers = [
    ...new Set(
      accounts
        .map((a) => String(a.account_manager ?? "").trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const accountIdByLease = new Map<number, number>();
  for (const l of leases) {
    if (l.account_id == null) continue;
    accountIdByLease.set(l.id, l.account_id);
  }

  const scopedAccountIds = new Set(
    accounts
      .filter((a) => {
        const am = String(a.account_manager ?? "").trim();
        if (!wantAm) return true;
        if (wantUnassigned) return !am;
        return am === wantAm;
      })
      .map((a) => a.id),
  );

  const expireYearsByAccount = new Map<number, Set<number>>();
  const tagsByAccount = new Map<number, Set<StatusTag>>();
  const expiringCounts = new Map<number, number>(expireYears.map((y) => [y, 0]));
  const statusCounts = { good: 0, watch: 0, risk: 0 };

  for (const r of riders) {
    if (r.master_lease_id == null) continue;
    const accountId = accountIdByLease.get(r.master_lease_id);
    if (accountId == null || !scopedAccountIds.has(accountId)) continue;
    const year = expirationYear(r.expiration_date);
    if (year != null) {
      const set = expireYearsByAccount.get(accountId) ?? new Set<number>();
      set.add(year);
      expireYearsByAccount.set(accountId, set);
      if (expiringCounts.has(year)) expiringCounts.set(year, (expiringCounts.get(year) ?? 0) + 1);
    }
    if (isStatusTag(r.status_tag)) {
      const set = tagsByAccount.get(accountId) ?? new Set<StatusTag>();
      set.add(r.status_tag);
      tagsByAccount.set(accountId, set);
      statusCounts[r.status_tag] += 1;
    }
  }

  const scopedAccounts: AccountOverviewRow[] = accounts
    .filter((a) => scopedAccountIds.has(a.id))
    .map((a) => ({
      ...a,
      expire_years: [...(expireYearsByAccount.get(a.id) ?? new Set())].sort(),
      status_tags: [...(tagsByAccount.get(a.id) ?? new Set())],
    }));

  return {
    managers,
    expire_years: expireYears,
    kpis: {
      expiring: expireYears.map((year) => ({ year, count: expiringCounts.get(year) ?? 0 })),
      status: statusCounts,
    },
    expiration_source: "riders.expiration_date",
    accounts: scopedAccounts,
  };
}

export type AccountOlRow = {
  id: number;
  rider_name: string;
  schedule_number: string | null;
  master_lease_id: number;
  lease_number: string | null;
  expiration_date: string | null;
  status_tag: StatusTag | null;
  active_car_count: number;
};

export async function getAccount(id: number) {
  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("id, name, notes, account_manager, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: leases, error: lErr } = await supabaseAdmin
    .from("master_leases")
    .select("id, lease_number, lessee")
    .eq("account_id", id)
    .order("lease_number");
  if (lErr) throw lErr;

  const leaseIds = (leases ?? []).map((l) => l.id);
  const leaseNumberById = new Map((leases ?? []).map((l) => [l.id, l.lease_number]));
  let riderRows: {
    id: number;
    rider_name: string;
    schedule_number: string | null;
    master_lease_id: number;
    expiration_date: string | null;
    status_tag: string | null;
  }[] = [];
  if (leaseIds.length) {
    const { data: riders, error: rErr } = await supabaseAdmin
      .from("riders")
      .select("id, rider_name, schedule_number, master_lease_id, expiration_date, status_tag")
      .in("master_lease_id", leaseIds)
      .order("schedule_number");
    if (rErr) throw rErr;
    riderRows = riders ?? [];
  }

  const activeByRider = await countActiveCarsByRiderId();
  const ols: AccountOlRow[] = riderRows.map((r) => ({
    id: r.id,
    rider_name: r.rider_name,
    schedule_number: r.schedule_number,
    master_lease_id: r.master_lease_id,
    lease_number: leaseNumberById.get(r.master_lease_id) ?? null,
    expiration_date: r.expiration_date,
    status_tag: isStatusTag(r.status_tag) ? r.status_tag : null,
    active_car_count: activeByRider.get(r.id) ?? 0,
  }));

  const { data: programs, error: pErr } = await supabaseAdmin
    .from("programs")
    .select("id, name, status, account_manager")
    .eq("account_id", id)
    .order("name");
  if (pErr) throw pErr;

  return {
    ...data,
    leases: leases ?? [],
    ols,
    counts: {
      mlas: (leases ?? []).length,
      ols: ols.length,
      active_cars: ols.reduce((n, r) => n + r.active_car_count, 0),
    },
    programs: (programs ?? []) as LinkedProgram[],
  };
}

export async function patchRiderStatusTag(riderId: number, statusTag: StatusTag | null) {
  const { data, error } = await supabaseAdmin
    .from("riders")
    .update({ status_tag: statusTag })
    .eq("id", riderId)
    .select("id, status_tag")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listRiderCarsForAccountMgmt(riderId: number) {
  const { data: assigns, error } = await supabaseAdmin
    .from("railcar_assignments")
    .select("railcar_id, railcars!inner(id, car_number, reporting_marks, car_type, active, estimated_lease_expiry, lease_expiry, lease_end_date)")
    .eq("rider_id", riderId)
    .eq("railcars.active", true);
  if (error) throw error;
  return (assigns ?? []).map((row: any) => {
    const c = Array.isArray(row.railcars) ? row.railcars[0] : row.railcars;
    return {
      id: c?.id ?? row.railcar_id,
      car_number: c?.car_number ?? null,
      reporting_marks: c?.reporting_marks ?? null,
      car_type: c?.car_type ?? null,
      expiration_date:
        c?.estimated_lease_expiry || c?.lease_expiry || c?.lease_end_date || null,
    };
  });
}

