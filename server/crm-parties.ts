import { changeCaptureRow, exactNameMatch, isProspectCompanyType, parseReportingMarks } from "@shared/crm";
import type { ActivityEntityType } from "@shared/change-log";
import { isPlaceholderLessee } from "@shared/lease-mgmt";
import { recordChange, withChangeGroup, withChangeGroupResult } from "./change-log";
import { CrmHttpError } from "./crm-error";
import {
  cleanProspectName,
  type DedupHit,
  type PartyHit,
  type ProspectResult,
  type ProspectWriteInput,
} from "./crm-parties-core";
import { supabaseAdmin } from "./supabase";

function escapeIlike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function httpError(status: number, message: string, body: Record<string, unknown> = {}): CrmHttpError {
  return new CrmHttpError(status, message, body);
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function asRecord(row: unknown): Record<string, unknown> {
  return row && typeof row === "object" ? (row as Record<string, unknown>) : {};
}

async function logRow(opts: {
  table: string;
  row: Record<string, unknown>;
  before: Record<string, unknown>;
  action: string;
  entityType: ActivityEntityType;
  actor: string;
}) {
  const pk = Number(opts.row.id);
  await recordChange({
    table: opts.table,
    pk,
    before: Object.keys(opts.before).length ? changeCaptureRow(opts.before) : {},
    after: changeCaptureRow(opts.row),
    action: opts.action,
    entity_type: opts.entityType,
    entity_id: pk,
    actor: opts.actor,
  });
}

async function findExactAccount(name: string): Promise<{ id: number; name: string } | null> {
  const { data, error } = await supabaseAdmin.from("accounts").select("id, name").ilike("name", escapeIlike(name));
  if (error) throw error;
  const rows = (data ?? []).map((row) => ({ id: Number(row.id), name: String(row.name ?? "") }));
  return exactNameMatch(rows, name);
}

async function companyForAccount(accountId: number): Promise<{ id: number; name: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("companies")
    .select("id, name")
    .eq("account_id", accountId)
    .is("merged_into_id", null)
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  return row ? { id: Number(row.id), name: String(row.name ?? "") } : null;
}

async function insertAccount(name: string, actor: string): Promise<{ id: number; name: string }> {
  const { data, error } = await supabaseAdmin.from("accounts").insert({ name }).select("*").single();
  if (error) {
    if (error.code === "23505") {
      const again = await findExactAccount(name);
      if (again) {
        const company = await companyForAccount(again.id);
        throw httpError(409, "An account with this name already exists", {
          account_id: again.id,
          company_id: company?.id ?? null,
        });
      }
    }
    throw error;
  }
  const row = asRecord(data);
  await logRow({ table: "accounts", row, before: {}, action: "create_account", entityType: "account", actor });
  return { id: Number(row.id), name: String(row.name ?? name) };
}

export async function searchCrmParties(q: string, limit: number): Promise<PartyHit[]> {
  const cap = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 20, 50));
  const { data, error } = await supabaseAdmin.rpc("crm_search_parties", { p_q: q, p_limit: cap });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    entity: String(row.entity) as PartyHit["entity"],
    entity_id: Number(row.entity_id),
    account_id: row.account_id == null ? null : Number(row.account_id),
    company_id: row.company_id == null ? null : Number(row.company_id),
    contact_id: row.contact_id == null ? null : Number(row.contact_id),
    label: String(row.label ?? ""),
    kind: String(row.kind) as PartyHit["kind"],
    reporting_marks: Array.isArray(row.reporting_marks) ? row.reporting_marks.map(String) : null,
    account_manager: textOrNull(row.account_manager),
  }));
}

export async function dedupCrmProspects(name: string, marks: unknown): Promise<DedupHit[]> {
  const parsed = parseReportingMarks(marks);
  const { data, error } = await supabaseAdmin.rpc("crm_prospect_dedup", { p_name: name, p_marks: parsed });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    source: String(row.source) as DedupHit["source"],
    id: Number(row.id),
    label: String(row.label ?? ""),
    kind: row.kind == null ? null : String(row.kind),
    reason: String(row.reason) === "Reporting mark" ? "Reporting mark" : "Similar name",
    reporting_marks: Array.isArray(row.reporting_marks) ? row.reporting_marks.map(String) : [],
  }));
}

async function createProspectWrites(body: ProspectWriteInput, actor: string): Promise<ProspectResult> {
  const use = body.use_existing;
  if (use && use.kind != null) {
    const id = Number(use.id);
    if (!Number.isFinite(id) || id <= 0) throw httpError(400, "Invalid existing party");
    if (use.kind === "account") return reuseAccount(id);
    if (use.kind === "company") return promoteCompany(id, actor);
    throw httpError(400, "Invalid existing party");
  }

  const name = cleanProspectName(body.name);
  if (!isProspectCompanyType(body.company_type)) throw httpError(400, "Invalid company type");
  const marks = parseReportingMarks(body.reporting_marks);
  const existing = await findExactAccount(name);
  if (existing) {
    const company = await companyForAccount(existing.id);
    throw httpError(409, "An account with this name already exists", {
      account_id: existing.id,
      company_id: company?.id ?? null,
    });
  }

  const account = await insertAccount(name, actor);
  const { data, error } = await supabaseAdmin
    .from("companies")
    .insert({
      name,
      account_id: account.id,
      relationship_type: body.company_type,
      status: "target",
      source: "crm_quick_create",
      reporting_marks: marks,
    })
    .select("*")
    .single();
  if (error) throw error;
  const company = asRecord(data);
  await logRow({ table: "companies", row: company, before: {}, action: "create_company", entityType: "company", actor });
  const contactId = await insertContact(Number(company.id), body.contact, actor);
  return { account_id: account.id, company_id: Number(company.id), contact_id: contactId, name };
}

async function reuseAccount(accountId: number): Promise<ProspectResult> {
  const { data, error } = await supabaseAdmin.from("accounts").select("id, name").eq("id", accountId).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "Account not found");
  if (isPlaceholderLessee(String(data.name ?? ""))) throw httpError(400, "That name is a placeholder bucket");
  const company = await companyForAccount(accountId);
  return { account_id: accountId, company_id: company?.id ?? null, contact_id: null, name: String(data.name ?? "") };
}

async function promoteCompany(companyId: number, actor: string): Promise<ProspectResult> {
  const { data, error } = await supabaseAdmin.from("companies").select("*").eq("id", companyId).maybeSingle();
  if (error) throw error;
  if (!data || data.merged_into_id != null) throw httpError(404, "Company not found");
  if (data.account_id != null) {
    const account = await reuseAccount(Number(data.account_id));
    return { ...account, company_id: companyId, contact_id: null };
  }
  const name = cleanProspectName(data.name);
  const existing = await findExactAccount(name);
  let accountId: number;
  let accountName = name;
  if (existing) {
    const other = await companyForAccount(existing.id);
    if (other && other.id !== companyId) {
      throw httpError(409, `Already linked to ${other.name}`, { account_id: existing.id, company_id: other.id });
    }
    accountId = existing.id;
    accountName = existing.name;
  } else {
    const created = await insertAccount(name, actor);
    accountId = created.id;
    accountName = created.name;
  }
  const before = asRecord(data);
  const { data: updated, error: updErr } = await supabaseAdmin
    .from("companies")
    .update({ account_id: accountId })
    .eq("id", companyId)
    .select("*")
    .single();
  if (updErr) throw updErr;
  await logRow({
    table: "companies",
    row: asRecord(updated),
    before,
    action: "link_company",
    entityType: "company",
    actor,
  });
  return { account_id: accountId, company_id: companyId, contact_id: null, name: accountName };
}

async function insertContact(
  companyId: number,
  contact: ProspectWriteInput["contact"],
  actor: string,
): Promise<number | null> {
  const name = textOrNull(contact?.name);
  if (!name) return null;
  const { data, error } = await supabaseAdmin
    .from("company_contacts")
    .insert({
      company_id: companyId,
      name,
      email: textOrNull(contact?.email),
      phone: textOrNull(contact?.phone),
      title: textOrNull(contact?.title),
      source: "crm_quick_create",
    })
    .select("*")
    .single();
  if (error) throw error;
  const row = asRecord(data);
  await logRow({
    table: "company_contacts",
    row,
    before: {},
    action: "create_contact",
    entityType: "company_contact",
    actor,
  });
  return Number(row.id);
}

export async function createCrmProspect(
  body: Record<string, unknown>,
  actor: string,
): Promise<ProspectResult & { change_group: string }> {
  return withChangeGroupResult(actor, async () => createProspectWrites(body as ProspectWriteInput, actor));
}

export async function resolveCrmParty(
  party: { entity?: unknown; entity_id?: unknown },
  actor: string,
): Promise<ProspectResult> {
  return withChangeGroup(actor, async () => {
    const entity = String(party.entity ?? "");
    const id = Number(party.entity_id);
    if (!Number.isFinite(id) || id <= 0) throw httpError(400, "Invalid party");
    if (entity === "account") return reuseAccount(id);
    if (entity === "company") return promoteCompany(id, actor);
    if (entity === "contact") {
      const { data, error } = await supabaseAdmin
        .from("company_contacts")
        .select("id, company_id")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw httpError(404, "Contact not found");
      const promoted = await promoteCompany(Number(data.company_id), actor);
      return { ...promoted, contact_id: Number(data.id) };
    }
    throw httpError(400, "Invalid party");
  });
}

export async function ensureCompanyForAccount(accountId: number, actor: string): Promise<number> {
  return withChangeGroup(actor, async () => {
    const existing = await companyForAccount(accountId);
    if (existing) return existing.id;
    const { data: account, error } = await supabaseAdmin.from("accounts").select("id, name").eq("id", accountId).maybeSingle();
    if (error) throw error;
    if (!account) throw httpError(404, "Account not found");
    const { data, error: insErr } = await supabaseAdmin
      .from("companies")
      .insert({
        name: String(account.name ?? ""),
        account_id: accountId,
        relationship_type: "customer",
        status: "target",
        source: "crm_quick_create",
      })
      .select("*")
      .single();
    if (insErr) throw insErr;
    const row = asRecord(data);
    await logRow({ table: "companies", row, before: {}, action: "create_company", entityType: "company", actor });
    return Number(row.id);
  });
}
