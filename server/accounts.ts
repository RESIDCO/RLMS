import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./fetch-all";
import { assertAccountImporterPatch } from "@shared/rider-import-guard";

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

  const { data: programs, error: pErr } = await supabaseAdmin
    .from("programs")
    .select("id, name, status, account_manager")
    .eq("account_id", id)
    .order("name");
  if (pErr) throw pErr;

  return {
    ...data,
    leases: leases ?? [],
    programs: (programs ?? []) as LinkedProgram[],
  };
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

