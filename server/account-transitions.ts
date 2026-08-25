import { supabaseAdmin } from "./supabase";
import { getAccount } from "./accounts";
import {
  isCommunicationMethod,
  isFlaggedTransition,
  isTransitionStatus,
  transitionPct,
  type TransitionStatus,
} from "@shared/account-transitions";

const RECORD_SELECT =
  "id, account_id, from_account_manager, to_account_manager, communication_method, status, completed_at, created_at, updated_at";

export type TransitionRecord = {
  id: number;
  account_id: number;
  from_account_manager: string | null;
  to_account_manager: string | null;
  communication_method: string | null;
  status: TransitionStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapRecord(row: any): TransitionRecord {
  return {
    id: Number(row.id),
    account_id: Number(row.account_id),
    from_account_manager: row.from_account_manager ?? null,
    to_account_manager: row.to_account_manager ?? null,
    communication_method: row.communication_method ?? null,
    status: isTransitionStatus(String(row.status ?? "open")) ? row.status : "open",
    completed_at: row.completed_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function cleanAm(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

export async function listTransitionSummary() {
  const { data, error } = await supabaseAdmin.from("account_transition_records").select("status, to_account_manager");
  if (error) throw error;
  const flagged = (data ?? []).filter((r) => isFlaggedTransition(r.to_account_manager));
  const complete = flagged.filter((r) => r.status === "complete").length;
  return {
    flagged: flagged.length,
    complete,
    pct: transitionPct(complete, flagged.length),
  };
}

export async function listTransitionRecords(amFilter: string | null) {
  const { data, error } = await supabaseAdmin
    .from("account_transition_records")
    .select(RECORD_SELECT)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const records = (data ?? []).map(mapRecord);
  const pillsMap = new Map<string, number>();
  for (const r of records) {
    for (const am of [r.from_account_manager, r.to_account_manager]) {
      const n = String(am ?? "").trim();
      if (!n) continue;
      pillsMap.set(n, (pillsMap.get(n) ?? 0) + 1);
    }
  }
  const pills = [...pillsMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const want = String(amFilter ?? "").trim();
  const filtered = want
    ? records.filter(
        (r) => String(r.from_account_manager ?? "").trim() === want || String(r.to_account_manager ?? "").trim() === want,
      )
    : records;

  const accountIds = [...new Set(filtered.map((r) => r.account_id))];
  const names = new Map<number, string>();
  if (accountIds.length) {
    const { data: accts, error: aErr } = await supabaseAdmin.from("accounts").select("id, name").in("id", accountIds);
    if (aErr) throw aErr;
    for (const a of accts ?? []) names.set(Number(a.id), String(a.name ?? ""));
  }

  return {
    pills,
    all_count: records.length,
    records: filtered.map((r) => ({
      ...r,
      account_name: names.get(r.account_id) ?? `Account ${r.account_id}`,
      flagged: isFlaggedTransition(r.to_account_manager),
    })),
  };
}

export async function createTransitionRecord(accountId: number) {
  if (!Number.isFinite(accountId) || accountId <= 0) {
    const err: any = new Error("Pick an account");
    err.status = 400;
    throw err;
  }
  const { data: existing } = await supabaseAdmin
    .from("account_transition_records")
    .select(RECORD_SELECT)
    .eq("account_id", accountId)
    .maybeSingle();
  if (existing) return mapRecord(existing);

  const { data: acct, error: aErr } = await supabaseAdmin
    .from("accounts")
    .select("id, account_manager")
    .eq("id", accountId)
    .maybeSingle();
  if (aErr) throw aErr;
  if (!acct) {
    const err: any = new Error("Account not found");
    err.status = 404;
    throw err;
  }

  const { data, error } = await supabaseAdmin
    .from("account_transition_records")
    .insert({
      account_id: accountId,
      from_account_manager: cleanAm(acct.account_manager),
      to_account_manager: null,
      status: "open",
    })
    .select(RECORD_SELECT)
    .single();
  if (error) throw error;
  return mapRecord(data);
}

export async function getTransitionDetail(recordId: number) {
  const { data, error } = await supabaseAdmin
    .from("account_transition_records")
    .select(RECORD_SELECT)
    .eq("id", recordId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const record = mapRecord(data);
  const [account, milestones, comments] = await Promise.all([
    getAccount(record.account_id),
    listMilestones(record.id),
    listComments(record.id),
  ]);
  if (!account) return null;
  return { record, account, milestones, comments };
}

export async function patchTransitionRecord(
  recordId: number,
  patch: {
    from_account_manager?: string | null;
    to_account_manager?: string | null;
    communication_method?: string | null;
    status?: string;
  },
) {
  const next: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.from_account_manager !== undefined) next.from_account_manager = cleanAm(patch.from_account_manager);
  if (patch.to_account_manager !== undefined) next.to_account_manager = cleanAm(patch.to_account_manager);
  if (patch.communication_method !== undefined) {
    const raw = cleanAm(patch.communication_method);
    if (raw && !isCommunicationMethod(raw)) {
      const err: any = new Error("communication_method must be in_person, call, email, phone, meeting, teams, or other");
      err.status = 400;
      throw err;
    }
    next.communication_method = raw;
  }
  if (patch.status !== undefined && patch.status != null) {
    if (!isTransitionStatus(patch.status)) {
      const err: any = new Error("status must be open or complete");
      err.status = 400;
      throw err;
    }
    next.status = patch.status;
    next.completed_at = patch.status === "complete" ? new Date().toISOString() : null;
  }
  const { data, error } = await supabaseAdmin
    .from("account_transition_records")
    .update(next)
    .eq("id", recordId)
    .select(RECORD_SELECT)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRecord(data) : null;
}

export async function listMilestones(recordId: number) {
  const { data, error } = await supabaseAdmin
    .from("account_transition_milestones")
    .select("id, record_id, label, done, milestone_date, sort_order, created_at")
    .eq("record_id", recordId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addMilestone(recordId: number, label: string) {
  const text = String(label ?? "").trim();
  if (!text) {
    const err: any = new Error("Milestone label is required");
    err.status = 400;
    throw err;
  }
  const existing = await listMilestones(recordId);
  const sort_order = existing.length ? Math.max(...existing.map((m: any) => Number(m.sort_order) || 0)) + 1 : 0;
  const { data, error } = await supabaseAdmin
    .from("account_transition_milestones")
    .insert({ record_id: recordId, label: text, done: false, sort_order })
    .select()
    .single();
  if (error) throw error;
  return data;
}

function parseMilestoneDate(v: unknown): string | null {
  if (v == null || String(v).trim() === "") return null;
  const s = String(v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const err: any = new Error("milestone_date must be YYYY-MM-DD");
    err.status = 400;
    throw err;
  }
  return s;
}

export async function patchMilestone(id: number, patch: { done?: boolean; label?: string; milestone_date?: string | null }) {
  const next: Record<string, unknown> = {};
  if (typeof patch.done === "boolean") next.done = patch.done;
  if (patch.milestone_date !== undefined) next.milestone_date = parseMilestoneDate(patch.milestone_date);
  if (patch.label != null) {
    const text = String(patch.label).trim();
    if (!text) {
      const err: any = new Error("Milestone label is required");
      err.status = 400;
      throw err;
    }
    next.label = text;
  }
  const { data, error } = await supabaseAdmin
    .from("account_transition_milestones")
    .update(next)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteMilestone(id: number) {
  const { error } = await supabaseAdmin.from("account_transition_milestones").delete().eq("id", id);
  if (error) throw error;
}

export async function listComments(recordId: number) {
  const { data, error } = await supabaseAdmin
    .from("account_transition_comments")
    .select("id, record_id, author_email, body, created_at")
    .eq("record_id", recordId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addComment(opts: {
  recordId: number;
  authorUserId: string;
  authorEmail: string;
  body: string;
}) {
  const body = String(opts.body ?? "").trim();
  if (!body) {
    const err: any = new Error("Comment is required");
    err.status = 400;
    throw err;
  }
  const { data, error } = await supabaseAdmin
    .from("account_transition_comments")
    .insert({
      record_id: opts.recordId,
      author_user_id: opts.authorUserId,
      author_email: String(opts.authorEmail ?? "").trim() || "unknown",
      body,
    })
    .select("id, record_id, author_email, body, created_at")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteComment(id: number) {
  const { error } = await supabaseAdmin.from("account_transition_comments").delete().eq("id", id);
  if (error) throw error;
}
