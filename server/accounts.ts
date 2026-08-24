import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./fetch-all";

export type Account = {
  id: number;
  name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountListRow = Account & {
  account_managers: string;
  program_count: number;
};

export type LinkedProgram = {
  id: number;
  name: string;
  status: string | null;
  account_manager: string | null;
};

function rollupManagers(values: (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = String(v ?? "").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.sort((a, b) => a.localeCompare(b)).join(", ");
}

function isUniqueNameError(err: unknown) {
  const e = err as { code?: string; message?: string };
  return e?.code === "23505" || /accounts_name_uniq|duplicate key/i.test(String(e?.message ?? ""));
}

export async function listAccounts(): Promise<AccountListRow[]> {
  const [accounts, leases, riders, programs] = await Promise.all([
    fetchAllRows<Account>((from, to) =>
      supabaseAdmin
        .from("accounts")
        .select("id, name, notes, created_at, updated_at")
        .order("name", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<{ id: number; lessee: string | null }>((from, to) =>
      supabaseAdmin.from("master_leases").select("id, lessee").order("id", { ascending: true }).range(from, to)
    ),
    fetchAllRows<{ master_lease_id: number | null; account_manager: string | null }>((from, to) =>
      supabaseAdmin
        .from("riders")
        .select("master_lease_id, account_manager")
        .order("id", { ascending: true })
        .range(from, to)
    ).catch(async (err) => {
      if (!/account_manager/i.test(String(err?.message ?? err))) throw err;
      return fetchAllRows<{ master_lease_id: number | null; account_manager: string | null }>((from, to) =>
        supabaseAdmin
          .from("riders")
          .select("master_lease_id")
          .order("id", { ascending: true })
          .range(from, to)
      ).then((rows) => rows.map((r) => ({ ...r, account_manager: null })));
    }),
    fetchAllRows<{ account_id: number | null }>((from, to) =>
      supabaseAdmin.from("programs").select("account_id").order("id", { ascending: true }).range(from, to)
    ).catch(async (err) => {
      if (!/account_id/i.test(String(err?.message ?? err))) throw err;
      return [];
    }),
  ]);

  const leaseIdsByAccount = new Map<number, number[]>();
  const accountByLessee = new Map<string, number>();
  for (const a of accounts) {
    accountByLessee.set(a.name.trim().toLowerCase(), a.id);
  }
  for (const l of leases) {
    const key = String(l.lessee ?? "").trim().toLowerCase();
    if (!key) continue;
    const aid = accountByLessee.get(key);
    if (!aid) continue;
    const list = leaseIdsByAccount.get(aid) ?? [];
    list.push(l.id);
    leaseIdsByAccount.set(aid, list);
  }

  const managersByLease = new Map<number, string[]>();
  for (const r of riders) {
    if (r.master_lease_id == null) continue;
    const list = managersByLease.get(r.master_lease_id) ?? [];
    list.push(r.account_manager ?? "");
    managersByLease.set(r.master_lease_id, list);
  }

  const programCount = new Map<number, number>();
  for (const p of programs) {
    if (p.account_id == null) continue;
    programCount.set(p.account_id, (programCount.get(p.account_id) ?? 0) + 1);
  }

  return accounts.map((a) => {
    const collected: string[] = [];
    for (const lid of leaseIdsByAccount.get(a.id) ?? []) {
      collected.push(...(managersByLease.get(lid) ?? []));
    }
    return {
      ...a,
      account_managers: rollupManagers(collected),
      program_count: programCount.get(a.id) ?? 0,
    };
  });
}

export async function getAccount(id: number) {
  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("id, name, notes, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const want = data.name.trim().toLowerCase();
  const { data: leases, error: lErr } = await supabaseAdmin
    .from("master_leases")
    .select("id, lease_number, lessee");
  if (lErr) throw lErr;
  const leaseIds = (leases ?? [])
    .filter((l) => String(l.lessee ?? "").trim().toLowerCase() === want)
    .map((l) => l.id);
  let managers: string[] = [];
  if (leaseIds.length) {
    const { data: riders, error: rErr } = await supabaseAdmin
      .from("riders")
      .select("account_manager")
      .in("master_lease_id", leaseIds);
    if (rErr) throw rErr;
    managers = (riders ?? []).map((r) => r.account_manager);
  }

  const { data: programs, error: pErr } = await supabaseAdmin
    .from("programs")
    .select("id, name, status, account_manager")
    .eq("account_id", id)
    .order("name");
  if (pErr) throw pErr;

  return {
    ...data,
    account_managers: rollupManagers(managers),
    programs: (programs ?? []) as LinkedProgram[],
  };
}

export async function createAccount(input: { name: string; notes?: string | null }) {
  const name = String(input.name ?? "").trim();
  if (!name) {
    const err = new Error("Name is required");
    (err as any).status = 400;
    throw err;
  }
  const { data, error } = await supabaseAdmin
    .from("accounts")
    .insert({ name, notes: input.notes?.trim() || null })
    .select("id, name, notes, created_at, updated_at")
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
  input: { name?: string; notes?: string | null },
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
  const { data, error } = await supabaseAdmin
    .from("accounts")
    .update(updates)
    .eq("id", id)
    .select("id, name, notes, created_at, updated_at")
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
