import { supabase, supabaseAdmin } from "./supabase";

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function bool(v: unknown): boolean {
  if (v === true || v === "true" || v === "1") return true;
  return false;
}

export async function listCompanies(query: Record<string, unknown>) {
  const page = Math.max(1, num(query.page, 1));
  const pageSize = Math.min(200, Math.max(1, num(query.pageSize, 50)));
  const search = str(query.search);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabase
    .from("companies")
    .select(
      "id, name, relationship_type, priority_tier, status, reporting_marks, account_id, source, created_at, company_contacts(count)",
      { count: "exact" },
    )
    .is("merged_into_id", null)
    .order("name")
    .range(from, to);

  if (search) {
    const needle = `%${search.replace(/[%_]/g, "")}%`;
    q = q.ilike("name", needle);
  }
  if (str(query.relationship_type)) q = q.eq("relationship_type", str(query.relationship_type)!);
  if (str(query.priority_tier)) q = q.eq("priority_tier", str(query.priority_tier)!);
  if (str(query.status)) q = q.eq("status", str(query.status)!);
  if (str(query.source)) q = q.eq("source", str(query.source)!);

  const { data, error, count } = await q;
  if (error) throw error;
  const rows = (data ?? []).map((row: any) => {
    const contact_count = Array.isArray(row.company_contacts)
      ? Number(row.company_contacts[0]?.count ?? 0)
      : 0;
    const { company_contacts: _c, ...rest } = row;
    return { ...rest, contact_count };
  });
  return { rows, total_count: count ?? 0, page, pageSize };
}

export async function getCompany(id: number) {
  const { data: company, error } = await supabase
    .from("companies")
    .select("id, name, relationship_type, account_id, priority_tier, status, merged_into_id, source, notes, created_at, updated_at, reporting_marks")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!company) return null;
  const [{ data: contacts, error: cErr }, { data: products, error: pErr }, { data: fleet, error: fErr }] = await Promise.all([
    supabase
      .from("company_contacts")
      .select("id, company_id, name, title, department, email, phone, mobile, alt_phone, street, city, state, zip, linkedin_url, linkedin_job_title, function_role, is_primary, notes, custom_fields, source, created_at, updated_at")
      .eq("company_id", id)
      .order("name"),
    supabase.from("company_products").select("*").eq("company_id", id).order("id"),
    supabase.from("company_fleet_stats").select("*").eq("company_id", id).order("car_type"),
  ]);
  if (cErr) throw cErr;
  if (pErr) throw pErr;
  if (fErr) throw fErr;
  return {
    ...company,
    contacts: contacts ?? [],
    company_products: products ?? [],
    company_fleet_stats: fleet ?? [],
  };
}

export async function listCompanyContacts(query: Record<string, unknown>) {
  const page = Math.max(1, num(query.page, 1));
  const pageSize = Math.min(200, Math.max(1, num(query.pageSize, 50)));
  const search = str(query.search);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabase
    .from("company_contacts")
    .select(
      "id, company_id, name, title, department, email, phone, mobile, city, state, zip, function_role, is_primary, source, created_at, companies!inner(id, name, relationship_type, reporting_marks, account_id, source)",
      { count: "exact" },
    )
    .order("name")
    .range(from, to);

  if (search) {
    const needle = `%${search.replace(/[%_,]/g, "")}%`;
    q = q.or(`name.ilike.${needle},email.ilike.${needle}`);
  }
  if (str(query.company_id)) q = q.eq("company_id", Number(query.company_id));
  if (str(query.source)) q = q.eq("source", str(query.source)!);

  const { data, error, count } = await q;
  if (error) throw error;
  const rows = (data ?? []).map((row: any) => {
    const company = row.companies;
    const { companies: _c, ...rest } = row;
    return {
      ...rest,
      company_name: company?.name ?? null,
      relationship_type: company?.relationship_type ?? null,
      reporting_marks: company?.reporting_marks ?? [],
      account_id: company?.account_id ?? null,
    };
  });
  return { rows, total_count: count ?? 0, page, pageSize };
}

export async function directorySearch(query: Record<string, unknown>) {
  const page = Math.max(1, num(query.page, 1));
  const pageSize = Math.min(200, Math.max(1, num(query.pageSize, 50)));
  const includeIndustry =
    bool(query.include_industry) ||
    str(query.relationship_type) === "lessor" ||
    str(query.relationship_type) === "railroad";

  const { data, error } = await supabase.rpc("directory_search", {
    p_q: str(query.q) ?? str(query.search),
    p_include_industry: includeIndustry,
    p_relationship_type: str(query.relationship_type),
    p_priority_tier: str(query.priority_tier),
    p_status: str(query.status),
    p_source: str(query.source),
    p_state: str(query.state),
    p_page: page,
    p_page_size: pageSize,
  });
  if (error) throw error;
  const rows = data ?? [];
  const total_count = rows.length ? Number(rows[0].total_count ?? 0) : 0;
  return { rows, total_count, page, pageSize };
}

export async function directoryFacets() {
  const { data, error } = await supabase.rpc("directory_facets");
  if (error) throw error;
  return (
    data ?? {
      relationship_type: [],
      priority_tier: [],
      status: [],
      source: [],
      state: [],
    }
  );
}

const REL_TYPES = new Set(["unclassified", "prospect", "lessor", "railroad", "vendor", "other", "customer"]);
const STATUSES = new Set(["target", "contacted", "in_discussion", "lost", "won"]);
const TIERS = new Set(["A", "B", "C", "D"]);

function emptyToNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export async function createCompany(body: Record<string, unknown>) {
  const name = str(body.name);
  if (!name) throw Object.assign(new Error("Company name is required"), { status: 400 });
  const relationship_type = str(body.relationship_type) || "unclassified";
  if (!REL_TYPES.has(relationship_type) || relationship_type === "customer") {
    throw Object.assign(new Error("Invalid relationship_type"), { status: 400 });
  }
  const patch: Record<string, unknown> = {
    name,
    relationship_type,
    source: "manual",
    account_id: null,
    notes: emptyToNull(body.notes),
  };
  if (str(body.priority_tier) && TIERS.has(str(body.priority_tier)!)) patch.priority_tier = str(body.priority_tier);
  if (str(body.status) && STATUSES.has(str(body.status)!)) patch.status = str(body.status);
  const { data, error } = await supabaseAdmin.from("companies").insert(patch).select("id").single();
  if (error) throw error;
  return getCompany(data.id);
}

export async function updateCompany(id: number, body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = str(body.name);
    if (!name) throw Object.assign(new Error("Company name is required"), { status: 400 });
    patch.name = name;
  }
  if (body.relationship_type !== undefined) {
    const rt = str(body.relationship_type) || "unclassified";
    if (!REL_TYPES.has(rt)) throw Object.assign(new Error("Invalid relationship_type"), { status: 400 });
    if (rt === "customer") throw Object.assign(new Error("Use Convert-to-Account to mark a customer"), { status: 400 });
    patch.relationship_type = rt;
  }
  if (body.priority_tier !== undefined) {
    const t = str(body.priority_tier);
    patch.priority_tier = t && TIERS.has(t) ? t : null;
  }
  if (body.status !== undefined) {
    const s = str(body.status);
    if (s && !STATUSES.has(s)) throw Object.assign(new Error("Invalid status"), { status: 400 });
    patch.status = s || "target";
  }
  if (body.notes !== undefined) patch.notes = emptyToNull(body.notes);
  if (!Object.keys(patch).length) return getCompany(id);
  const { error } = await supabaseAdmin.from("companies").update(patch).eq("id", id);
  if (error) throw error;
  return getCompany(id);
}

export async function deleteCompany(id: number) {
  const { error } = await supabaseAdmin.from("companies").delete().eq("id", id);
  if (error) throw error;
}

const CONTACT_FIELDS = [
  "name", "title", "department", "email", "phone", "mobile", "alt_phone",
  "street", "city", "state", "zip", "linkedin_url", "linkedin_job_title",
  "function_role", "notes",
] as const;

export async function getCompanyContact(id: number) {
  const { data, error } = await supabase
    .from("company_contacts")
    .select("id, company_id, name, title, department, email, phone, mobile, alt_phone, street, city, state, zip, linkedin_url, linkedin_job_title, function_role, is_primary, notes, custom_fields, source, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const company = await getCompany(data.company_id);
  return { ...data, company };
}

export async function createCompanyContact(body: Record<string, unknown>) {
  const company_id = Number(body.company_id);
  const name = str(body.name);
  if (!Number.isFinite(company_id) || company_id <= 0) throw Object.assign(new Error("company_id is required"), { status: 400 });
  if (!name) throw Object.assign(new Error("Contact name is required"), { status: 400 });
  const row: Record<string, unknown> = { company_id, name, source: "manual", is_primary: false };
  for (const k of CONTACT_FIELDS) {
    if (k === "name") continue;
    if (body[k] !== undefined) row[k] = emptyToNull(body[k]);
  }
  const { data, error } = await supabaseAdmin.from("company_contacts").insert(row).select("id").single();
  if (error) throw error;
  return getCompanyContact(data.id);
}

export async function updateCompanyContact(id: number, body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const k of CONTACT_FIELDS) {
    if (body[k] === undefined) continue;
    if (k === "name") {
      const name = str(body.name);
      if (!name) throw Object.assign(new Error("Contact name is required"), { status: 400 });
      patch.name = name;
    } else {
      patch[k] = emptyToNull(body[k]);
    }
  }
  if (!Object.keys(patch).length) return getCompanyContact(id);
  const { error } = await supabaseAdmin.from("company_contacts").update(patch).eq("id", id);
  if (error) throw error;
  return getCompanyContact(id);
}

export async function deleteCompanyContact(id: number) {
  const { error } = await supabaseAdmin.from("company_contacts").delete().eq("id", id);
  if (error) throw error;
}

async function hydrateLeaseLinks(rows: any[]) {
  const mlaIds = Array.from(new Set(rows.map((r) => r.master_lease_id).filter(Boolean)));
  const riderIds = Array.from(new Set(rows.map((r) => r.rider_id).filter(Boolean)));
  const [mlas, riders] = await Promise.all([
    mlaIds.length
      ? supabase.from("master_leases").select("id, lease_number, lessee").in("id", mlaIds)
      : Promise.resolve({ data: [], error: null } as any),
    riderIds.length
      ? supabase.from("riders").select("id, rider_name, schedule_number, master_lease_id").in("id", riderIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);
  if (mlas.error) throw mlas.error;
  if (riders.error) throw riders.error;
  const mlaMap = new Map((mlas.data ?? []).map((m: any) => [m.id, m]));
  const riderMap = new Map((riders.data ?? []).map((r: any) => [r.id, r]));
  return rows.map((r) => ({
    ...r,
    master_lease: r.master_lease_id ? mlaMap.get(r.master_lease_id) ?? null : null,
    rider: r.rider_id ? riderMap.get(r.rider_id) ?? null : null,
  }));
}

export async function listContactLeaseLinks(contactId: number) {
  const { data, error } = await supabase
    .from("contact_lease_links")
    .select("*")
    .eq("company_contact_id", contactId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return hydrateLeaseLinks(data ?? []);
}

export async function listCompanyLeaseLinks(companyId: number) {
  const { data: contacts, error: cErr } = await supabase
    .from("company_contacts")
    .select("id, name")
    .eq("company_id", companyId);
  if (cErr) throw cErr;
  const ids = (contacts ?? []).map((c: any) => c.id);
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("contact_lease_links")
    .select("*")
    .in("company_contact_id", ids)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const byId = new Map((contacts ?? []).map((c: any) => [c.id, c.name]));
  const rows = await hydrateLeaseLinks(data ?? []);
  return rows.map((r) => ({ ...r, contact_name: byId.get(r.company_contact_id) ?? null }));
}

export async function listLeaseContactLinks(opts: { masterLeaseId?: number; riderId?: number }) {
  let q = supabase.from("contact_lease_links").select("*");
  if (opts.masterLeaseId) q = q.eq("master_lease_id", opts.masterLeaseId);
  if (opts.riderId) q = q.eq("rider_id", opts.riderId);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const contactIds = Array.from(new Set(rows.map((r: any) => r.company_contact_id)));
  const contacts = contactIds.length
    ? await supabase
        .from("company_contacts")
        .select("id, name, title, email, phone, company_id, companies(id, name)")
        .in("id", contactIds)
    : { data: [], error: null as any };
  if (contacts.error) throw contacts.error;
  const cmap = new Map((contacts.data ?? []).map((c: any) => [c.id, c]));
  const hydrated = await hydrateLeaseLinks(rows);
  return hydrated.map((r) => {
    const c = cmap.get(r.company_contact_id);
    return {
      ...r,
      contact_name: c?.name ?? null,
      contact_title: c?.title ?? null,
      contact_email: c?.email ?? null,
      contact_phone: c?.phone ?? null,
      company_id: c?.company_id ?? null,
      company_name: (Array.isArray(c?.companies) ? c.companies[0]?.name : c?.companies?.name) ?? null,
    };
  });
}

export async function createContactLeaseLink(
  contactId: number,
  body: Record<string, unknown>,
  createdBy: string | null,
) {
  const master_lease_id = body.master_lease_id != null ? Number(body.master_lease_id) : null;
  const rider_id = body.rider_id != null ? Number(body.rider_id) : null;
  if (!master_lease_id && !rider_id) throw Object.assign(new Error("Pick an MLA or an OL"), { status: 400 });
  const { data, error } = await supabaseAdmin
    .from("contact_lease_links")
    .insert({
      company_contact_id: contactId,
      master_lease_id: Number.isFinite(master_lease_id) && master_lease_id! > 0 ? master_lease_id : null,
      rider_id: Number.isFinite(rider_id) && rider_id! > 0 ? rider_id : null,
      relationship_note: emptyToNull(body.relationship_note),
      created_by: createdBy,
    })
    .select("*")
    .single();
  if (error) throw error;
  const [row] = await hydrateLeaseLinks([data]);
  return row;
}

export async function deleteContactLeaseLink(id: number) {
  const { error } = await supabaseAdmin.from("contact_lease_links").delete().eq("id", id);
  if (error) throw error;
}

