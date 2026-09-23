import { supabase } from "./supabase";

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

  if (search) q = q.textSearch("search_vector", search, { type: "plain", config: "english" });
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
  const [{ data: contacts, error: cErr }, { data: products, error: pErr }] = await Promise.all([
    supabase
      .from("company_contacts")
      .select("id, company_id, name, title, department, email, phone, mobile, alt_phone, street, city, state, zip, linkedin_url, linkedin_job_title, function_role, is_primary, notes, custom_fields, source, created_at, updated_at")
      .eq("company_id", id)
      .order("name"),
    supabase.from("company_products").select("*").eq("company_id", id).order("id"),
  ]);
  if (cErr) throw cErr;
  if (pErr) throw pErr;
  return {
    ...company,
    contacts: contacts ?? [],
    company_products: products ?? [],
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

  if (search) q = q.textSearch("search_vector", search, { type: "plain", config: "english" });
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
