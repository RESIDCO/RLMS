import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./fetch-all";
import {
  MARK_CONTACTS_SOURCE,
  buildMarkContactsPreview,
  matchExistingCompanyId,
  type MarkPreview,
} from "@shared/mark-contacts-import";

export async function assertReportingMarksColumn(): Promise<void> {
  const { error } = await supabaseAdmin.from("companies").select("reporting_marks").limit(1);
  if (error) {
    throw new Error(
      "companies.reporting_marks is missing. Apply migrations/20260923_companies_reporting_marks.sql before this import.",
    );
  }
}

export async function previewMarkContacts(rows: Record<string, unknown>[]): Promise<MarkPreview> {
  await assertReportingMarksColumn();
  const preview = buildMarkContactsPreview(rows);
  const existing = await fetchAllRows((from, to) =>
    supabaseAdmin
      .from("companies")
      .select("id, name, reporting_marks, source")
      .eq("source", MARK_CONTACTS_SOURCE)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const existingRows = existing as Array<{ id: number; name: string; reporting_marks?: string[] | null }>;

  const existingContacts = existing.length
    ? await fetchAllRows((from, to) =>
        supabaseAdmin
          .from("company_contacts")
          .select("id, company_id, name, email, source")
          .eq("source", MARK_CONTACTS_SOURCE)
          .order("id", { ascending: true })
          .range(from, to),
      )
    : [];
  const contactKeys = new Set(
    (existingContacts as any[]).map(
      (p) => `${p.company_id}|${String(p.name || "").trim().toLowerCase()}|${String(p.email || "").trim().toLowerCase()}`,
    ),
  );

  let companiesAlready = 0;
  let contactsAlready = 0;
  let companiesToCreate = 0;
  let contactsToCreate = 0;
  for (const co of preview.companies) {
    const id = matchExistingCompanyId(co, existingRows);
    if (id) {
      companiesAlready += 1;
      for (const p of co.contacts) {
        const ck = `${id}|${p.name.trim().toLowerCase()}|${String(p.email || "").trim().toLowerCase()}`;
        if (contactKeys.has(ck)) contactsAlready += 1;
        else contactsToCreate += 1;
      }
    } else {
      companiesToCreate += 1;
      contactsToCreate += co.contacts.length;
    }
  }

  return {
    ...preview,
    companiesToCreate,
    contactsToCreate,
    companiesAlreadyPresent: companiesAlready,
    contactsAlreadyPresent: contactsAlready,
  };
}

export async function commitMarkContacts(rows: Record<string, unknown>[]) {
  await assertReportingMarksColumn();
  const preview = await previewMarkContacts(rows);

  const existing = await fetchAllRows((from, to) =>
    supabaseAdmin
      .from("companies")
      .select("id, name, reporting_marks, source")
      .eq("source", MARK_CONTACTS_SOURCE)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const existingRows = existing as Array<{ id: number; name: string; reporting_marks?: string[] | null }>;

  const existingContacts = existing.length
    ? await fetchAllRows((from, to) =>
        supabaseAdmin
          .from("company_contacts")
          .select("id, company_id, name, email, source")
          .eq("source", MARK_CONTACTS_SOURCE)
          .order("id", { ascending: true })
          .range(from, to),
      )
    : [];

  let companiesCreated = 0;
  let contactsCreated = 0;
  let companiesSkipped = 0;
  let contactsSkipped = 0;

  const existingPeopleByCompany = new Map<number, Set<string>>();
  for (const p of existingContacts as any[]) {
    const set = existingPeopleByCompany.get(p.company_id) || new Set<string>();
    set.add(`${String(p.name || "").trim().toLowerCase()}|${String(p.email || "").trim().toLowerCase()}`);
    existingPeopleByCompany.set(p.company_id, set);
  }

  for (const co of preview.companies) {
    let companyId = matchExistingCompanyId(co, existingRows);
    if (!companyId) {
      const { data, error } = await supabaseAdmin
        .from("companies")
        .insert({
          name: co.name,
          relationship_type: "unclassified",
          account_id: null,
          source: MARK_CONTACTS_SOURCE,
          reporting_marks: co.reporting_marks,
        })
        .select("id")
        .single();
      if (error) throw error;
      companyId = data.id;
      existingRows.push({ id: companyId, name: co.name, reporting_marks: co.reporting_marks });
      companiesCreated += 1;
    } else {
      companiesSkipped += 1;
    }

    const people = existingPeopleByCompany.get(companyId!) || new Set<string>();

    const toInsert = co.contacts.filter((p) => {
      const k = `${p.name.trim().toLowerCase()}|${String(p.email || "").trim().toLowerCase()}`;
      if (people.has(k)) {
        contactsSkipped += 1;
        return false;
      }
      people.add(k);
      return true;
    });
    existingPeopleByCompany.set(companyId!, people);

    for (let i = 0; i < toInsert.length; i += 200) {
      const chunk = toInsert.slice(i, i + 200).map((p) => ({
        company_id: companyId,
        name: p.name,
        title: p.title,
        department: p.department,
        email: p.email,
        phone: p.phone,
        mobile: p.mobile,
        alt_phone: p.alt_phone,
        street: p.street,
        city: p.city,
        state: p.state,
        zip: p.zip,
        function_role: p.function_role,
        is_primary: false,
        custom_fields: p.custom_fields,
        source: MARK_CONTACTS_SOURCE,
      }));
      const { error } = await supabaseAdmin.from("company_contacts").insert(chunk);
      if (error) throw error;
      contactsCreated += chunk.length;
    }
  }

  return {
    ok: true,
    companiesCreated,
    contactsCreated,
    companiesSkippedExisting: companiesSkipped,
    contactsSkippedExisting: contactsSkipped,
    skippedSource: preview.skipped.length,
    skipped: preview.skipped,
    markConflictCount: preview.markConflictGroups.length,
  };
}
