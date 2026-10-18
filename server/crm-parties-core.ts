import { CrmHttpError } from "./crm-error";
import {
  changeCaptureRow,
  classifyAccountParty,
  exactNameMatch,
  isProspectCompanyType,
  nameSimilarity,
  parseReportingMarks,
  PARTY_KIND_RANK,
  type PartyKind,
} from "@shared/crm";
import { isPlaceholderLessee } from "@shared/lease-mgmt";

export type ProspectContactInput = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
};

export type ProspectWriteInput = {
  name?: unknown;
  company_type?: unknown;
  reporting_marks?: unknown;
  contact?: ProspectContactInput | null;
  use_existing?: { kind?: unknown; id?: unknown } | null;
};

export type PartyEntity = "account" | "company" | "contact";

export type PartyHit = {
  entity: PartyEntity;
  entity_id: number;
  account_id: number | null;
  company_id: number | null;
  contact_id: number | null;
  label: string;
  kind: PartyKind;
  reporting_marks: string[] | null;
  account_manager: string | null;
};

export type DedupHit = {
  source: "account" | "company" | "umler";
  id: number;
  label: string;
  kind: string | null;
  reason: "Similar name" | "Reporting mark";
  reporting_marks: string[];
};

export type MemoryAccount = { id: number; name: string; account_manager: string | null };
export type MemoryCompany = {
  id: number;
  name: string;
  account_id: number | null;
  relationship_type: string;
  status: string;
  source: string | null;
  reporting_marks: string[];
  merged_into_id: number | null;
};
export type MemoryContact = {
  id: number;
  company_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  source: string | null;
};
export type MemoryUmler = {
  id: number;
  reporting_mark: string;
  owner_group: string | null;
  umler_owner: string | null;
};
export type MemoryChange = {
  id: number;
  group: string;
  table: string;
  pk: number;
  op: "insert" | "update";
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

export type PartyMemory = {
  seq: number;
  logSeq: number;
  accounts: MemoryAccount[];
  companies: MemoryCompany[];
  contacts: MemoryContact[];
  leases: { account_id: number; is_placeholder: boolean }[];
  clientAccountIds: number[];
  umler: MemoryUmler[];
  log: MemoryChange[];
};

export function emptyPartyMemory(): PartyMemory {
  return {
    seq: 1,
    logSeq: 1,
    accounts: [],
    companies: [],
    contacts: [],
    leases: [],
    clientAccountIds: [],
    umler: [],
    log: [],
  };
}

function httpError(status: number, message: string, body: Record<string, unknown> = {}): CrmHttpError {
  return new CrmHttpError(status, message, body);
}

export function cleanProspectName(raw: unknown): string {
  const name = String(raw ?? "").trim();
  if (!name) throw httpError(400, "Name is required");
  if (isPlaceholderLessee(name)) throw httpError(400, "That name is a placeholder bucket");
  return name;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function nextId(db: PartyMemory): number {
  const id = db.seq;
  db.seq += 1;
  return id;
}

function logChange(
  db: PartyMemory,
  group: string,
  table: string,
  pk: number,
  op: "insert" | "update",
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  db.log.push({
    id: db.logSeq,
    group,
    table,
    pk,
    op,
    before: op === "insert" ? {} : changeCaptureRow(before),
    after: changeCaptureRow(after),
  });
  db.logSeq += 1;
}

function companyForAccount(db: PartyMemory, accountId: number): MemoryCompany | null {
  return db.companies.find((row) => row.account_id === accountId && row.merged_into_id == null) ?? null;
}

function accountKind(db: PartyMemory, account: MemoryAccount): PartyKind | "excluded" {
  const leases = db.leases.filter((row) => row.account_id === account.id);
  const hasLessee = leases.length > 0;
  const allPlaceholderLessee = hasLessee && leases.every((row) => row.is_placeholder);
  return classifyAccountParty({
    hasLessee,
    allPlaceholderLessee,
    isClient: db.clientAccountIds.includes(account.id),
    name: account.name,
  });
}

function marksOverlap(left: string[] | null | undefined, right: string[]): boolean {
  if (!right.length) return false;
  const want = new Set(right);
  return (left ?? []).some((mark) => want.has(mark.trim().toUpperCase()));
}

export function searchPartiesInMemory(db: PartyMemory, q: string, limit = 20): PartyHit[] {
  const raw = q.trim();
  const mark = raw.toUpperCase();
  const cap = Math.max(1, Math.min(limit || 20, 50));
  const hits: Array<PartyHit & { score: number }> = [];

  for (const account of db.accounts) {
    const kind = accountKind(db, account);
    if (kind === "excluded") continue;
    const company = companyForAccount(db, account.id);
    const label = account.name;
    const score = scoreHit(raw, mark, label, company?.reporting_marks ?? null, null);
    if (score == null) continue;
    hits.push({
      entity: "account",
      entity_id: account.id,
      account_id: account.id,
      company_id: company?.id ?? null,
      contact_id: null,
      label,
      kind,
      reporting_marks: company?.reporting_marks ?? null,
      account_manager: account.account_manager,
      score,
    });
  }

  for (const company of db.companies) {
    if (company.account_id != null || company.merged_into_id != null) continue;
    if (isPlaceholderLessee(company.name)) continue;
    const score = scoreHit(raw, mark, company.name, company.reporting_marks, null);
    if (score == null) continue;
    hits.push({
      entity: "company",
      entity_id: company.id,
      account_id: null,
      company_id: company.id,
      contact_id: null,
      label: company.name,
      kind: "company",
      reporting_marks: company.reporting_marks,
      account_manager: null,
      score,
    });
  }

  for (const contact of db.contacts) {
    const company = db.companies.find((row) => row.id === contact.company_id);
    if (!company || company.merged_into_id != null) continue;
    const account = company.account_id == null ? null : db.accounts.find((row) => row.id === company.account_id) ?? null;
    if (account && accountKind(db, account) === "excluded") continue;
    const leases = account ? db.leases.filter((row) => row.account_id === account.id) : [];
    const hasReal = leases.some((row) => !row.is_placeholder);
    if (!hasReal && isPlaceholderLessee(company.name)) continue;
    const label = `${contact.name} — ${company.name}`;
    const score = scoreHit(raw, mark, label, company.reporting_marks, contact.email);
    if (score == null) continue;
    hits.push({
      entity: "contact",
      entity_id: contact.id,
      account_id: company.account_id,
      company_id: company.id,
      contact_id: contact.id,
      label,
      kind: "contact",
      reporting_marks: company.reporting_marks,
      account_manager: null,
      score,
    });
  }

  hits.sort((a, b) => PARTY_KIND_RANK[a.kind] - PARTY_KIND_RANK[b.kind] || b.score - a.score || a.label.localeCompare(b.label));
  return hits.slice(0, cap).map(({ score: _score, ...hit }) => hit);
}

function scoreHit(
  raw: string,
  mark: string,
  label: string,
  marks: string[] | null,
  email: string | null,
): number | null {
  if (!raw) return 0;
  const similar = nameSimilarity(label, raw);
  const markHit = mark !== "" && (marks ?? []).some((item) => item.trim().toUpperCase() === mark);
  const emailHit = email != null && email.toLowerCase() === raw.toLowerCase();
  const loose = label.toLowerCase().includes(raw.toLowerCase());
  if (!loose && similar <= 0.2 && !markHit && !emailHit) return null;
  return Math.max(similar, markHit || emailHit ? 1 : 0);
}

export function dedupProspectsInMemory(db: PartyMemory, name: string, marksRaw: unknown): DedupHit[] {
  const raw = String(name ?? "").trim();
  const marks = parseReportingMarks(marksRaw);
  const hits: DedupHit[] = [];
  for (const account of db.accounts) {
    const kind = accountKind(db, account);
    if (kind === "excluded") continue;
    const company = companyForAccount(db, account.id);
    const byMark = marksOverlap(company?.reporting_marks, marks);
    const similar = raw !== "" && nameSimilarity(account.name, raw) >= 0.4;
    if (!similar && !byMark) continue;
    hits.push({
      source: "account",
      id: account.id,
      label: account.name,
      kind,
      reason: byMark ? "Reporting mark" : "Similar name",
      reporting_marks: company?.reporting_marks ?? [],
    });
  }
  for (const company of db.companies) {
    if (company.account_id != null || company.merged_into_id != null) continue;
    if (isPlaceholderLessee(company.name)) continue;
    const byMark = marksOverlap(company.reporting_marks, marks);
    const similar = raw !== "" && nameSimilarity(company.name, raw) >= 0.4;
    if (!similar && !byMark) continue;
    hits.push({
      source: "company",
      id: company.id,
      label: company.name,
      kind: "company",
      reason: byMark ? "Reporting mark" : "Similar name",
      reporting_marks: company.reporting_marks,
    });
  }
  for (const row of db.umler) {
    const byMark = marks.includes(row.reporting_mark.trim().toUpperCase());
    const label = (row.owner_group || row.umler_owner || row.reporting_mark).trim();
    const similar =
      raw !== "" &&
      (nameSimilarity(row.owner_group ?? "", raw) >= 0.4 || nameSimilarity(row.umler_owner ?? "", raw) >= 0.4);
    if (!similar && !byMark) continue;
    hits.push({
      source: "umler",
      id: row.id,
      label,
      kind: null,
      reason: byMark ? "Reporting mark" : "Similar name",
      reporting_marks: row.reporting_mark ? [row.reporting_mark] : [],
    });
  }
  return hits.slice(0, 20);
}

export type ProspectResult = {
  account_id: number;
  company_id: number | null;
  contact_id: number | null;
  name: string;
};

export function createProspectInMemory(db: PartyMemory, input: ProspectWriteInput, group: string): ProspectResult {
  const use = input.use_existing;
  if (use && use.kind != null) {
    const kind = String(use.kind);
    const id = Number(use.id);
    if (!Number.isFinite(id) || id <= 0) throw httpError(400, "Invalid existing party");
    if (kind === "account") return reuseAccount(db, id);
    if (kind === "company") return promoteCompanyInMemory(db, id, group);
    throw httpError(400, "Invalid existing party");
  }

  const name = cleanProspectName(input.name);
  if (!isProspectCompanyType(input.company_type)) throw httpError(400, "Invalid company type");
  const companyType = input.company_type;
  const marks = parseReportingMarks(input.reporting_marks);
  const existing = exactNameMatch(db.accounts, name);
  if (existing) {
    const company = companyForAccount(db, existing.id);
    throw httpError(409, "An account with this name already exists", {
      account_id: existing.id,
      company_id: company?.id ?? null,
    });
  }

  const accountId = nextId(db);
  const account: MemoryAccount = { id: accountId, name, account_manager: null };
  db.accounts.push(account);
  logChange(db, group, "accounts", accountId, "insert", {}, { ...account, updated_at: "noise", search_vector: "noise" });

  const companyId = nextId(db);
  const company: MemoryCompany = {
    id: companyId,
    name,
    account_id: accountId,
    relationship_type: companyType,
    status: "target",
    source: "crm_quick_create",
    reporting_marks: marks,
    merged_into_id: null,
  };
  db.companies.push(company);
  logChange(db, group, "companies", companyId, "insert", {}, { ...company, updated_at: "noise", search_vector: "noise" });

  const contact = optionalContact(db, group, companyId, input.contact);
  return { account_id: accountId, company_id: companyId, contact_id: contact, name };
}

function reuseAccount(db: PartyMemory, accountId: number): ProspectResult {
  const account = db.accounts.find((row) => row.id === accountId);
  if (!account) throw httpError(404, "Account not found");
  if (isPlaceholderLessee(account.name)) throw httpError(400, "That name is a placeholder bucket");
  const company = companyForAccount(db, account.id);
  return { account_id: account.id, company_id: company?.id ?? null, contact_id: null, name: account.name };
}

export function promoteCompanyInMemory(db: PartyMemory, companyId: number, group: string): ProspectResult {
  const company = db.companies.find((row) => row.id === companyId);
  if (!company || company.merged_into_id != null) throw httpError(404, "Company not found");
  if (company.account_id != null) {
    const account = db.accounts.find((row) => row.id === company.account_id);
    return {
      account_id: company.account_id,
      company_id: company.id,
      contact_id: null,
      name: account?.name ?? company.name,
    };
  }
  const name = cleanProspectName(company.name);
  const existing = exactNameMatch(db.accounts, name);
  let accountId: number;
  if (existing) {
    const other = companyForAccount(db, existing.id);
    if (other && other.id !== company.id) {
      throw httpError(409, `Already linked to ${other.name}`, { account_id: existing.id, company_id: other.id });
    }
    accountId = existing.id;
  } else {
    accountId = nextId(db);
    const account: MemoryAccount = { id: accountId, name, account_manager: null };
    db.accounts.push(account);
    logChange(db, group, "accounts", accountId, "insert", {}, { ...account });
  }
  const before = { ...company };
  company.account_id = accountId;
  logChange(db, group, "companies", company.id, "update", before, { ...company, updated_at: "noise", search_vector: "noise" });
  const account = db.accounts.find((row) => row.id === accountId);
  return { account_id: accountId, company_id: company.id, contact_id: null, name: account?.name ?? name };
}

function optionalContact(
  db: PartyMemory,
  group: string,
  companyId: number,
  contact: ProspectContactInput | null | undefined,
): number | null {
  const name = textOrNull(contact?.name);
  if (!name) return null;
  const row: MemoryContact = {
    id: nextId(db),
    company_id: companyId,
    name,
    email: textOrNull(contact?.email),
    phone: textOrNull(contact?.phone),
    title: textOrNull(contact?.title),
    source: "crm_quick_create",
  };
  db.contacts.push(row);
  logChange(db, group, "company_contacts", row.id, "insert", {}, { ...row, updated_at: "noise", search_vector: "noise" });
  return row.id;
}

export function resolvePartyInMemory(
  db: PartyMemory,
  party: { entity?: unknown; entity_id?: unknown },
  group: string,
): ProspectResult & { contact_id: number | null } {
  const entity = String(party.entity ?? "");
  const id = Number(party.entity_id);
  if (!Number.isFinite(id) || id <= 0) throw httpError(400, "Invalid party");
  if (entity === "account") return { ...reuseAccount(db, id), contact_id: null };
  if (entity === "company") return promoteCompanyInMemory(db, id, group);
  if (entity === "contact") {
    const contact = db.contacts.find((row) => row.id === id);
    if (!contact) throw httpError(404, "Contact not found");
    const promoted = promoteCompanyInMemory(db, contact.company_id, group);
    return { ...promoted, contact_id: contact.id };
  }
  throw httpError(400, "Invalid party");
}

export function ensureCustomerCompanyInMemory(db: PartyMemory, accountId: number, group: string): MemoryCompany {
  const existing = companyForAccount(db, accountId);
  if (existing) return existing;
  const account = db.accounts.find((row) => row.id === accountId);
  if (!account) throw httpError(404, "Account not found");
  const company: MemoryCompany = {
    id: nextId(db),
    name: account.name,
    account_id: accountId,
    relationship_type: "customer",
    status: "target",
    source: "crm_quick_create",
    reporting_marks: [],
    merged_into_id: null,
  };
  db.companies.push(company);
  logChange(db, group, "companies", company.id, "insert", {}, { ...company });
  return company;
}

/** One change group: account, company, contact, opportunity, opportunity contact. */
export function createQuickDealInMemory(
  db: PartyMemory,
  input: ProspectWriteInput & { opportunity?: boolean },
  group: string,
): ProspectResult & { opportunity_id: number | null } {
  const created = createProspectInMemory(db, input, group);
  if (!input.opportunity) return { ...created, opportunity_id: null };
  const opportunityId = nextId(db);
  logChange(db, group, "opportunities", opportunityId, "insert", {}, {
    id: opportunityId,
    account_id: created.account_id,
    type: "new_business",
    stage: "identified",
  });
  if (created.contact_id != null) {
    const linkId = nextId(db);
    logChange(db, group, "opportunity_contacts", linkId, "insert", {}, {
      id: linkId,
      opportunity_id: opportunityId,
      contact_id: created.contact_id,
      role: "primary",
    });
  }
  return { ...created, opportunity_id: opportunityId };
}
