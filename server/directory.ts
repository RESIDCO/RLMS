import { leftoverLegacyContacts, companyNameForRider, pickUniqueCompanyByCleanName, pickUniqueCompanyByPrefix, pickUniqueCompanyStartingWith, pickUniqueCompanyForLessee, directoryCleanName, directoryPhoneDigits, isPlaceholderLessee } from "@shared/directory-contacts";
import { supabaseAdmin } from "./supabase";
import { classifyAgentEmail } from "./directory-dedup";

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

  let q = supabaseAdmin
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
  const { data: company, error } = await supabaseAdmin
    .from("companies")
    .select("id, name, relationship_type, account_id, priority_tier, status, merged_into_id, source, notes, created_at, updated_at, reporting_marks, family_parent_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!company) return null;
  const [{ data: contacts, error: cErr }, { data: products, error: pErr }, { data: fleet, error: fErr }] = await Promise.all([
    supabaseAdmin
      .from("company_contacts")
      .select("id, company_id, name, title, department, email, phone, mobile, alt_phone, street, city, state, zip, linkedin_url, linkedin_job_title, function_role, is_primary, notes, custom_fields, source, created_at, updated_at, is_agent_contact, agent_organization_name, agent_home_company_id")
      .eq("company_id", id)
      .order("name"),
    supabaseAdmin.from("company_products").select("*").eq("company_id", id).order("id"),
    supabaseAdmin.from("company_fleet_stats").select("*").eq("company_id", id).order("car_type"),
  ]);
  if (cErr) throw cErr;
  if (pErr) throw pErr;
  if (fErr) throw fErr;
  const [{ data: children, error: chErr }, parentRes] = await Promise.all([
    supabaseAdmin.from("companies").select("id, name, reporting_marks, relationship_type, source").eq("family_parent_id", id).order("name"),
    company.family_parent_id
      ? supabaseAdmin.from("companies").select("id, name").eq("id", company.family_parent_id).maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
  ]);
  if (chErr) throw chErr;
  if (parentRes.error) throw parentRes.error;
  return {
    ...company,
    contacts: contacts ?? [],
    company_products: products ?? [],
    company_fleet_stats: fleet ?? [],
    family_children: children ?? [],
    family_parent: parentRes.data ?? null,
  };
}

export async function listCompanyContacts(query: Record<string, unknown>) {
  const page = Math.max(1, num(query.page, 1));
  const pageSize = Math.min(200, Math.max(1, num(query.pageSize, 50)));
  const search = str(query.search);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabaseAdmin
    .from("company_contacts")
    .select(
      "id, company_id, name, title, department, email, phone, mobile, city, state, zip, function_role, is_primary, source, created_at, is_agent_contact, agent_organization_name, agent_home_company_id, companies!company_contacts_company_id_fkey(id, name, relationship_type, reporting_marks, account_id, source)",
      { count: "exact" },
    )
    .order("name")
    .range(from, to);

  if (search) {
    const needle = `%${search.replace(/[%_,]/g, "")}%`;
    const digits = directoryPhoneDigits(search);
    const parts = [
      `name.ilike.${needle}`,
      `email.ilike.${needle}`,
      `phone.ilike.${needle}`,
      `mobile.ilike.${needle}`,
      `title.ilike.${needle}`,
    ];
    if (digits.length >= 4) parts.push(`phone_digits.ilike.%${digits}%`);
    q = q.or(parts.join(","));
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

  const { data, error } = await supabaseAdmin.rpc("directory_search", {
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
  const rows = await attachDirectoryLeaseLabels(data ?? []);
  const total_count = rows.length ? Number(rows[0].total_count ?? 0) : 0;
  return { rows, total_count, page, pageSize };
}

function asOneRow<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

/** Fill lessee / MLA / OL labels for directory hits that already have a rider_id. */
export async function attachDirectoryLeaseLabels<T extends { rider_id?: number | null }>(
  rows: T[],
): Promise<Array<T & { lease_lessee: string | null; lease_number: string | null; rider_name: string | null }>> {
  const ids = [...new Set(rows.map((r) => Number(r.rider_id)).filter((n) => Number.isFinite(n) && n > 0))];
  const labels = new Map<number, { lease_lessee: string | null; lease_number: string | null; rider_name: string | null }>();
  for (let i = 0; i < ids.length; i += 80) {
    const { data: riders, error: rErr } = await supabaseAdmin
      .from("riders")
      .select("id, rider_name, master_lease:master_leases(lessee, lease_number)")
      .in("id", ids.slice(i, i + 80));
    if (rErr) throw rErr;
    for (const r of riders ?? []) {
      const ml = asOneRow((r as { master_lease?: { lessee: string | null; lease_number: string | null } | { lessee: string | null; lease_number: string | null }[] }).master_lease);
      labels.set(Number(r.id), {
        rider_name: (r as { rider_name?: string | null }).rider_name ?? null,
        lease_lessee: ml?.lessee ?? null,
        lease_number: ml?.lease_number ?? null,
      });
    }
  }
  return rows.map((row) => {
    const hit = row.rider_id ? labels.get(Number(row.rider_id)) : undefined;
    return {
      ...row,
      lease_lessee: hit?.lease_lessee ?? null,
      lease_number: hit?.lease_number ?? null,
      rider_name: hit?.rider_name ?? null,
    };
  });
}

export async function directoryFacets() {
  const { data, error } = await supabaseAdmin.rpc("directory_facets");
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
  const { data, error } = await supabaseAdmin
    .from("company_contacts")
    .select("id, company_id, name, title, department, email, phone, mobile, alt_phone, street, city, state, zip, linkedin_url, linkedin_job_title, function_role, is_primary, notes, custom_fields, source, created_at, updated_at, is_agent_contact, agent_organization_name, agent_home_company_id")
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
  const { data, error } = await supabaseAdmin.from("company_contacts").insert(row).select("id, email").single();
  if (error) throw error;
  try { await classifyAgentEmail(data.email); } catch { /* classification is best-effort */ }
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
  const { data: before } = await supabaseAdmin.from("company_contacts").select("email").eq("id", id).maybeSingle();
  const { error } = await supabaseAdmin.from("company_contacts").update(patch).eq("id", id);
  if (error) throw error;
  try {
    if (patch.email !== undefined || patch.company_id !== undefined) {
      await classifyAgentEmail(String(patch.email ?? before?.email ?? ""));
      if (before?.email && patch.email && String(before.email) !== String(patch.email)) {
        await classifyAgentEmail(String(before.email));
      }
    }
  } catch { /* classification is best-effort */ }
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
      ? supabaseAdmin.from("master_leases").select("id, lease_number, lessee").in("id", mlaIds)
      : Promise.resolve({ data: [], error: null } as any),
    riderIds.length
      ? supabaseAdmin.from("riders").select("id, rider_name, schedule_number, master_lease_id").in("id", riderIds)
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
  const { data, error } = await supabaseAdmin
    .from("contact_lease_links")
    .select("*")
    .eq("company_contact_id", contactId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return hydrateLeaseLinks(data ?? []);
}

export async function listCompanyLeaseLinks(companyId: number) {
  const { data: contacts, error: cErr } = await supabaseAdmin
    .from("company_contacts")
    .select("id, name")
    .eq("company_id", companyId);
  if (cErr) throw cErr;
  const ids = (contacts ?? []).map((c: any) => c.id);
  const personLinks = ids.length
    ? await supabaseAdmin.from("contact_lease_links").select("*").in("company_contact_id", ids).order("created_at", { ascending: false })
    : { data: [], error: null as any };
  if (personLinks.error) throw personLinks.error;
  const companyLinks = await supabaseAdmin
    .from("contact_lease_links")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (companyLinks.error) throw companyLinks.error;
  const byId = new Map((contacts ?? []).map((c: any) => [c.id, c.name]));
  const rows = await hydrateLeaseLinks([...(personLinks.data ?? []), ...(companyLinks.data ?? [])]);
  return rows.map((r) => ({
    ...r,
    contact_name: r.company_contact_id ? byId.get(r.company_contact_id) ?? null : null,
    link_kind: r.company_id && !r.company_contact_id ? "company" : "contact",
  }));
}

export async function listLeaseContactLinks(opts: { masterLeaseId?: number; riderId?: number }) {
  let q = supabaseAdmin.from("contact_lease_links").select("*");
  if (opts.masterLeaseId) q = q.eq("master_lease_id", opts.masterLeaseId);
  if (opts.riderId) q = q.eq("rider_id", opts.riderId);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const contactIds = Array.from(new Set(rows.map((r: any) => r.company_contact_id).filter(Boolean)));
  const companyIds = Array.from(new Set(rows.map((r: any) => r.company_id).filter(Boolean)));
  const contacts = contactIds.length
    ? await supabaseAdmin
        .from("company_contacts")
        .select("id, name, title, email, phone, company_id, companies!company_contacts_company_id_fkey(id, name)")
        .in("id", contactIds)
    : { data: [], error: null as any };
  const companies = companyIds.length
    ? await supabaseAdmin.from("companies").select("id, name").in("id", companyIds)
    : { data: [], error: null as any };
  if (contacts.error) throw contacts.error;
  if (companies.error) throw companies.error;
  const cmap = new Map((contacts.data ?? []).map((c: any) => [c.id, c]));
  const coMap = new Map((companies.data ?? []).map((c: any) => [c.id, c]));
  const hydrated = await hydrateLeaseLinks(rows);
  return hydrated.map((r) => {
    const c = r.company_contact_id ? cmap.get(r.company_contact_id) : null;
    const co = r.company_id ? coMap.get(r.company_id) : null;
    return {
      ...r,
      link_kind: r.company_id && !r.company_contact_id ? "company" : "contact",
      contact_name: c?.name ?? null,
      contact_title: c?.title ?? null,
      contact_email: c?.email ?? null,
      contact_phone: c?.phone ?? null,
      company_id: r.company_id ?? c?.company_id ?? null,
      company_name: co?.name ?? (Array.isArray(c?.companies) ? c.companies[0]?.name : c?.companies?.name) ?? null,
    };
  });
}

export async function createContactLeaseLink(
  contactId: number | null,
  body: Record<string, unknown>,
  createdBy: string | null,
) {
  const master_lease_id = body.master_lease_id != null ? Number(body.master_lease_id) : null;
  const rider_id = body.rider_id != null ? Number(body.rider_id) : null;
  const company_id = body.company_id != null ? Number(body.company_id) : null;
  const cid = contactId != null && Number.isFinite(contactId) && contactId > 0 ? contactId : null;
  if (!master_lease_id && !rider_id) throw Object.assign(new Error("Pick an MLA or an OL"), { status: 400 });
  if ((cid && company_id) || (!cid && !company_id)) {
    throw Object.assign(new Error("Link either a contact or a company, not both"), { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from("contact_lease_links")
    .insert({
      company_contact_id: cid,
      company_id: Number.isFinite(company_id) && company_id! > 0 ? company_id : null,
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

async function findOrCreateCompanyByName(name: string): Promise<{ id: number; name: string }> {
  const needle = name.trim();
  if (!needle) throw Object.assign(new Error("Company name is required"), { status: 400 });
  const { data, error } = await supabaseAdmin
    .from("companies")
    .select("id, name")
    .is("merged_into_id", null)
    .ilike("name", needle)
    .limit(8);
  if (error) throw error;
  const exact = (data ?? []).find((c: { name: string }) => c.name.toLowerCase() === needle.toLowerCase());
  if (exact) return exact;
  const { data: all, error: allErr } = await supabaseAdmin
    .from("companies")
    .select("id, name")
    .is("merged_into_id", null)
    .limit(5000);
  if (allErr) throw allErr;
  const cleaned = pickUniqueCompanyByCleanName(needle, all ?? []);
  if (cleaned) return cleaned;
  const prefixed = pickUniqueCompanyByPrefix(needle, all ?? []);
  if (prefixed) return prefixed;
  const started = pickUniqueCompanyStartingWith(needle, all ?? []);
  if (started) return started;
  const created = await createCompany({ name: needle, relationship_type: "unclassified" });
  if (!created) throw Object.assign(new Error("Could not create company"), { status: 500 });
  return { id: created.id, name: created.name };
}

export async function linkLesseeCompanyToLease(
  masterLeaseId: number,
  lessee: string,
  createdBy: string | null,
) {
  if (!Number.isFinite(masterLeaseId) || masterLeaseId <= 0) {
    throw Object.assign(new Error("Invalid lease"), { status: 400 });
  }
  if (isPlaceholderLessee(lessee)) {
    throw Object.assign(new Error("This lessee name is a placeholder, not a company"), { status: 400 });
  }
  const company = await findOrCreateCompanyByName(lessee);
  const { data: existing, error } = await supabaseAdmin
    .from("contact_lease_links")
    .select("id")
    .eq("company_id", company.id)
    .eq("master_lease_id", masterLeaseId)
    .is("company_contact_id", null)
    .limit(1);
  if (error) throw error;
  if (existing && existing.length) return { company, already_linked: true };
  const link = await createContactLeaseLink(
    null,
    {
      company_id: company.id,
      master_lease_id: masterLeaseId,
      relationship_note: "Linked from lessee name",
    },
    createdBy,
  );
  return { company, link, already_linked: false };
}

export async function listContactsForRider(riderId: number) {
  const { data: rider, error: riderErr } = await supabaseAdmin
    .from("riders")
    .select("id, master_lease_id")
    .eq("id", riderId)
    .maybeSingle();
  if (riderErr) throw riderErr;
  const riderLinks = await listLeaseContactLinks({ riderId });
  const mlaLinks = rider?.master_lease_id
    ? (await listLeaseContactLinks({ masterLeaseId: rider.master_lease_id })).filter((l) => !l.rider_id)
    : [];
  const linked = [...riderLinks, ...mlaLinks];
  const directory = linked
    .filter((r) => r.company_contact_id)
    .map((r) => ({
      id: Number(r.company_contact_id),
      rider_id: riderId,
      name: r.contact_name || "Contact",
      title: r.contact_title ?? null,
      email: r.contact_email ?? null,
      phone: r.contact_phone ?? null,
      notes: r.relationship_note ?? null,
      source: "directory" as const,
      link_id: r.id,
      company_id: r.company_id ?? null,
      company_name: r.company_name ?? null,
      company_contact_id: Number(r.company_contact_id),
      via_company: false,
    }));
  const companyIds = [...new Set(linked.filter((r) => r.company_id && !r.company_contact_id).map((r) => Number(r.company_id)))];
  for (const companyId of companyIds) {
    const people = await listCompanyContacts({ company_id: String(companyId), page: 1, pageSize: 200 });
    const inheritedName = linked.find((l) => Number(l.company_id) === companyId)?.company_name ?? null;
    for (const p of people.rows as any[]) {
      if (directory.some((d) => d.company_contact_id === p.id)) continue;
      directory.push({
        id: p.id,
        rider_id: riderId,
        name: p.name,
        title: p.title ?? null,
        email: p.email ?? null,
        phone: p.phone ?? null,
        notes: null,
        source: "directory" as const,
        link_id: null,
        company_id: companyId,
        company_name: p.company_name ?? inheritedName,
        company_contact_id: p.id,
        via_company: true,
      });
    }
  }
  const { data: legacy, error } = await supabaseAdmin
    .from("rider_contacts")
    .select("*")
    .eq("rider_id", riderId)
    .order("name");
  if (error) throw error;
  const leftover = leftoverLegacyContacts(directory, legacy ?? []).map((c: any) => ({
      id: c.id,
      rider_id: riderId,
      name: c.name,
      title: c.title ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      notes: c.notes ?? null,
      created_at: c.created_at,
      updated_at: c.updated_at,
      source: "legacy" as const,
      link_id: null,
      company_id: null,
      company_name: null,
      company_contact_id: null,
      via_company: false,
    }));
  return [...directory, ...leftover].sort((a, b) => a.name.localeCompare(b.name));
}

export async function createContactOnRider(
  riderId: number,
  body: Record<string, unknown>,
  createdBy: string | null,
) {
  const name = str(body.name);
  if (!name) throw Object.assign(new Error("Contact name is required"), { status: 400 });
  const { data: rider, error: rErr } = await supabaseAdmin
    .from("riders")
    .select("id, rider_name, master_lease_id, master_lease:master_leases(id, lessee)")
    .eq("id", riderId)
    .maybeSingle();
  if (rErr) throw rErr;
  if (!rider) throw Object.assign(new Error("Rider not found"), { status: 404 });
  const lease = Array.isArray(rider.master_lease) ? rider.master_lease[0] : rider.master_lease;
  const companyName = companyNameForRider({
    companyName: str(body.company_name),
    lessee: str(lease?.lessee),
    riderName: str(rider.rider_name),
  });
  const company = await findOrCreateCompanyByName(companyName);
  const email = emptyToNull(body.email);
  let contactId: number | null = null;
  if (email) {
    const { data: existing, error: eErr } = await supabaseAdmin
      .from("company_contacts")
      .select("id")
      .eq("company_id", company.id)
      .ilike("email", email)
      .limit(1);
    if (eErr) throw eErr;
    if (existing?.[0]) contactId = existing[0].id;
  }
  if (!contactId) {
    const created = await createCompanyContact({
      company_id: company.id,
      name,
      title: body.title,
      email,
      phone: body.phone,
      notes: body.notes,
    });
    if (!created) throw Object.assign(new Error("Could not create contact"), { status: 500 });
    contactId = created.id;
  } else {
    await updateCompanyContact(contactId, {
      name,
      title: body.title,
      email,
      phone: body.phone,
      notes: body.notes,
    });
  }
  const { data: already } = await supabaseAdmin
    .from("contact_lease_links")
    .select("id")
    .eq("company_contact_id", contactId)
    .eq("rider_id", riderId)
    .limit(1);
  if (!already?.length) {
    await createContactLeaseLink(
      contactId,
      {
        rider_id: riderId,
        master_lease_id: rider.master_lease_id ?? lease?.id ?? null,
        relationship_note: body.notes,
      },
      createdBy,
    );
  }
  const mlaId = rider.master_lease_id ?? lease?.id ?? null;
  if (mlaId) {
    const { data: coLink } = await supabaseAdmin
      .from("contact_lease_links")
      .select("id")
      .eq("company_id", company.id)
      .eq("master_lease_id", mlaId)
      .is("company_contact_id", null)
      .limit(1);
    if (!coLink?.length) {
      await createContactLeaseLink(
        null,
        {
          company_id: company.id,
          master_lease_id: mlaId,
          relationship_note: "Linked when adding a contact on an OL",
        },
        createdBy,
      );
    }
  }
  const rows = await listContactsForRider(riderId);
  return rows.find((r) => r.company_contact_id === contactId) ?? rows[0];
}

export async function promoteLegacyRiderContacts(opts?: { riderId?: number; createdBy?: string | null }) {
  let q = supabaseAdmin.from("rider_contacts").select("id, rider_id, name, title, email, phone, notes");
  if (opts?.riderId) q = q.eq("rider_id", opts.riderId);
  const { data, error } = await q;
  if (error) throw error;
  let promoted = 0;
  let failed = 0;
  for (const row of data ?? []) {
    try {
      await createContactOnRider(
        Number(row.rider_id),
        {
          name: row.name,
          title: row.title,
          email: row.email,
          phone: row.phone,
          notes: row.notes,
        },
        opts?.createdBy ?? null,
      );
      const { error: delErr } = await supabaseAdmin.from("rider_contacts").delete().eq("id", row.id);
      if (delErr) throw delErr;
      promoted += 1;
    } catch {
      failed += 1;
    }
  }
  return { promoted, failed, scanned: (data ?? []).length };
}

async function peopleFromContactLeaseLinkRows(rows: any[]) {
  const personRows = rows.filter((r: any) => r.company_contact_id);
  const companyRows = rows.filter((r: any) => r.company_id && !r.company_contact_id);
  const contactIds = Array.from(new Set(personRows.map((r: any) => r.company_contact_id)));
  const companyIds = Array.from(new Set(companyRows.map((r: any) => r.company_id)));
  const contacts = contactIds.length
    ? await supabaseAdmin
        .from("company_contacts")
        .select("id, name, title, email, phone, notes, company_id, companies!company_contacts_company_id_fkey(id, name)")
        .in("id", contactIds)
    : { data: [] as any[], error: null as any };
  if (contacts.error) throw contacts.error;
  const staff = companyIds.length
    ? await supabaseAdmin
        .from("company_contacts")
        .select("id, name, title, email, phone, notes, company_id, companies!company_contacts_company_id_fkey(id, name)")
        .in("company_id", companyIds)
        .limit(2000)
    : { data: [] as any[], error: null as any };
  if (staff.error) throw staff.error;
  const cmap = new Map((contacts.data ?? []).map((c: any) => [c.id, c]));
  const byCompany = new Map<number, any[]>();
  for (const p of staff.data ?? []) {
    const list = byCompany.get(p.company_id) ?? [];
    list.push(p);
    byCompany.set(p.company_id, list);
  }
  const out: any[] = [];
  const seen = new Set<string>();
  const personHydrated = await hydrateLeaseLinks(personRows);
  for (const r of personHydrated) {
    const c = cmap.get(r.company_contact_id);
    const co = Array.isArray(c?.companies) ? c.companies[0] : c?.companies;
    const key = `${r.company_contact_id}:${r.master_lease_id ?? ""}:${r.rider_id ?? ""}`;
    seen.add(key);
    out.push({
      id: r.company_contact_id,
      name: c?.name ?? r.contact_name ?? "Contact",
      title: c?.title ?? null,
      email: c?.email ?? null,
      phone: c?.phone ?? null,
      notes: c?.notes ?? r.relationship_note ?? null,
      source: "directory",
      link_id: r.id,
      via_company: false,
      rider_id: r.rider_id,
      company_id: c?.company_id ?? null,
      company_name: co?.name ?? null,
      rider: r.rider,
      master_lease: r.master_lease,
    });
  }
  const companyHydrated = await hydrateLeaseLinks(companyRows);
  for (const r of companyHydrated) {
    const people = byCompany.get(Number(r.company_id)) ?? [];
    for (const p of people) {
      const key = `${p.id}:${r.master_lease_id ?? ""}:${r.rider_id ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const co = Array.isArray(p.companies) ? p.companies[0] : p.companies;
      out.push({
        id: p.id,
        name: p.name,
        title: p.title ?? null,
        email: p.email ?? null,
        phone: p.phone ?? null,
        notes: p.notes ?? r.relationship_note ?? null,
        source: "directory",
        link_id: null,
        via_company: true,
        rider_id: r.rider_id,
        company_id: p.company_id,
        company_name: co?.name ?? null,
        rider: r.rider,
        master_lease: r.master_lease,
      });
    }
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function fetchContactLeaseLinksIn(column: "master_lease_id" | "rider_id", ids: number[]) {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i + 80);
    const { data, error } = await supabaseAdmin.from("contact_lease_links").select("*").in(column, slice);
    if (error) throw error;
    out.push(...(data ?? []));
  }
  return out;
}

export async function listAllDirectoryLeasePeople() {
  const { data, error } = await supabaseAdmin.from("contact_lease_links").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return peopleFromContactLeaseLinkRows(data ?? []);
}

export async function listDirectoryPeopleForAccount(accountId: number) {
  if (!Number.isFinite(accountId) || accountId <= 0) return [];
  const { data: leases, error: lErr } = await supabaseAdmin
    .from("master_leases")
    .select("id")
    .eq("account_id", accountId);
  if (lErr) throw lErr;
  const leaseIds = (leases ?? []).map((l: { id: number }) => l.id).filter((id) => Number.isFinite(id) && id > 0);
  if (!leaseIds.length) return [];
  const riderIds: number[] = [];
  for (let i = 0; i < leaseIds.length; i += 80) {
    const { data: riders, error: rErr } = await supabaseAdmin
      .from("riders")
      .select("id")
      .in("master_lease_id", leaseIds.slice(i, i + 80));
    if (rErr) throw rErr;
    for (const r of riders ?? []) {
      if (Number.isFinite(r.id) && r.id > 0) riderIds.push(r.id);
    }
  }
  const [byMla, byRider] = await Promise.all([
    fetchContactLeaseLinksIn("master_lease_id", leaseIds),
    riderIds.length ? fetchContactLeaseLinksIn("rider_id", riderIds) : Promise.resolve([] as any[]),
  ]);
  const uniq = new Map<number, any>();
  for (const row of [...byMla, ...byRider]) {
    if (row?.id) uniq.set(row.id, row);
  }
  return peopleFromContactLeaseLinkRows([...uniq.values()]);
}

export async function listLeaseLinkGaps(limit = 80, otherOffset = 0) {
  const cap = Math.min(Math.max(Number(limit) || 80, 1), 200);
  const { data: links, error: lErr } = await supabaseAdmin
    .from("contact_lease_links")
    .select("master_lease_id")
    .not("company_id", "is", null);
  if (lErr) throw lErr;
  const linked = new Set((links ?? []).map((r: { master_lease_id: number | null }) => r.master_lease_id).filter(Boolean));
  const { data: mls, error: mErr } = await supabaseAdmin
    .from("master_leases")
    .select("id, lessee, lease_number")
    .not("lessee", "is", null)
    .limit(4000);
  if (mErr) throw mErr;
  const { data: companies, error: cErr } = await supabaseAdmin
    .from("companies")
    .select("id, name")
    .is("merged_into_id", null)
    .limit(5000);
  if (cErr) throw cErr;
  const { data: people, error: pErr } = await supabaseAdmin.from("company_contacts").select("company_id");
  if (pErr) throw pErr;
  const withPeople = new Set((people ?? []).map((p: { company_id: number }) => p.company_id));
  const comps = (companies ?? []).filter((c: { id: number }) => withPeople.has(c.id));
  const unmatchedMls = (mls ?? []).filter((ml: { id: number; lessee: string | null }) => !linked.has(ml.id) && String(ml.lessee ?? "").trim());
  const gaps: Array<{
    master_lease_id: number;
    lessee: string;
    lease_number: string | null;
    candidates: Array<{ id: number; name: string }>;
  }> = [];
  for (const ml of unmatchedMls) {
    const lessee = String(ml.lessee ?? "").trim();
    const key = directoryCleanName(lessee);
    if (!key || isPlaceholderLessee(lessee)) continue;
    const candidates = comps.filter((c: { name: string }) => {
      const ck = directoryCleanName(c.name);
      if (!ck) return false;
      if (ck.includes("leas") && !key.includes("leas")) return false;
      return ck.startsWith(key) || (key.length >= 6 && key.startsWith(ck));
    }).slice(0, 8);
    if (candidates.length === 0) continue;
    gaps.push({
      master_lease_id: ml.id,
      lessee,
      lease_number: ml.lease_number ?? null,
      candidates: candidates.map((c: { id: number; name: string }) => ({ id: c.id, name: c.name })),
    });
    if (gaps.length >= cap) break;
  }
  const gapIds = new Set(gaps.map((g) => g.master_lease_id));
  const otherAll = unmatchedMls.filter((ml: { id: number; lessee: string | null }) => {
    if (gapIds.has(ml.id)) return false;
    return !isPlaceholderLessee(String(ml.lessee ?? ""));
  });
  const otherFrom = Math.max(0, Number(otherOffset) || 0);
  return {
    rows: gaps,
    unmatched_other: otherAll.slice(otherFrom, otherFrom + 50).map((ml: { id: number; lessee: string | null; lease_number?: string | null }) => ({
      master_lease_id: ml.id,
      lessee: String(ml.lessee ?? "").trim(),
      lease_number: ml.lease_number ?? null,
      candidates: [] as Array<{ id: number; name: string }>,
    })),
    unmatched_other_total: otherAll.length,
    unmatched_other_offset: otherFrom,
    linked_leases: linked.size,
    unmatched_leases: unmatchedMls.length,
    suggestions: gaps.length,
  };
}

function csvCell(v: string | number | null | undefined) {
  const s = v == null ? "" : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** All unmatched non-placeholder lessees with any suggested directory companies (not paginated). */
export async function unmatchedLesseeExportCsv() {
  const { data: links, error: lErr } = await supabaseAdmin
    .from("contact_lease_links")
    .select("master_lease_id")
    .not("company_id", "is", null);
  if (lErr) throw lErr;
  const linked = new Set((links ?? []).map((r: { master_lease_id: number | null }) => r.master_lease_id).filter(Boolean));
  const { data: mls, error: mErr } = await supabaseAdmin
    .from("master_leases")
    .select("id, lessee, lease_number")
    .not("lessee", "is", null)
    .limit(4000);
  if (mErr) throw mErr;
  const { data: companies, error: cErr } = await supabaseAdmin
    .from("companies")
    .select("id, name")
    .is("merged_into_id", null)
    .limit(5000);
  if (cErr) throw cErr;
  const { data: people, error: pErr } = await supabaseAdmin.from("company_contacts").select("company_id");
  if (pErr) throw pErr;
  const withPeople = new Set((people ?? []).map((p: { company_id: number }) => p.company_id));
  const comps = (companies ?? []).filter((c: { id: number }) => withPeople.has(c.id));
  const lines = ["master_lease_id,lessee,lease_number,suggested_companies"];
  for (const ml of mls ?? []) {
    if (linked.has(ml.id)) continue;
    const lessee = String(ml.lessee ?? "").trim();
    if (!lessee || isPlaceholderLessee(lessee)) continue;
    const key = directoryCleanName(lessee);
    const suggested = key
      ? comps.filter((c: { name: string }) => {
          const ck = directoryCleanName(c.name);
          if (!ck) return false;
          if (ck.includes("leas") && !key.includes("leas")) return false;
          return ck.startsWith(key) || (key.length >= 6 && key.startsWith(ck));
        }).slice(0, 8).map((c: { name: string }) => c.name).join("; ")
      : "";
    lines.push([csvCell(ml.id), csvCell(lessee), csvCell(ml.lease_number), csvCell(suggested)].join(","));
  }
  return lines.join("\n") + "\n";
}

/** Link unmatched MLAs whose lessee uniquely matches an existing directory company. Does not create companies. */
export async function linkUniqueUnmatchedLesseeCompanies(createdBy: string | null) {
  const { data: links, error: lErr } = await supabaseAdmin
    .from("contact_lease_links")
    .select("master_lease_id")
    .not("company_id", "is", null);
  if (lErr) throw lErr;
  const linked = new Set(
    (links ?? []).map((r: { master_lease_id: number | null }) => r.master_lease_id).filter(Boolean) as number[],
  );
  const { data: mls, error: mErr } = await supabaseAdmin
    .from("master_leases")
    .select("id, lessee")
    .not("lessee", "is", null)
    .limit(4000);
  if (mErr) throw mErr;
  const { data: companies, error: cErr } = await supabaseAdmin
    .from("companies")
    .select("id, name")
    .is("merged_into_id", null)
    .limit(5000);
  if (cErr) throw cErr;
  const comps = companies ?? [];
  const applied: Array<{ master_lease_id: number; lessee: string; company_id: number; company_name: string }> = [];
  for (const ml of mls ?? []) {
    const id = Number(ml.id);
    if (!Number.isFinite(id) || linked.has(id)) continue;
    const lessee = String(ml.lessee ?? "").trim();
    if (!lessee || isPlaceholderLessee(lessee)) continue;
    const company = pickUniqueCompanyForLessee(lessee, comps);
    if (!company) continue;
    const { data: existing, error: eErr } = await supabaseAdmin
      .from("contact_lease_links")
      .select("id")
      .eq("company_id", company.id)
      .eq("master_lease_id", id)
      .is("company_contact_id", null)
      .limit(1);
    if (eErr) throw eErr;
    if (existing?.length) {
      linked.add(id);
      continue;
    }
    await createContactLeaseLink(
      null,
      {
        company_id: company.id,
        master_lease_id: id,
        relationship_note: "Unique directory match",
      },
      createdBy,
    );
    linked.add(id);
    applied.push({
      master_lease_id: id,
      lessee,
      company_id: company.id,
      company_name: company.name,
    });
  }
  return { linked: applied.length, applied };
}

