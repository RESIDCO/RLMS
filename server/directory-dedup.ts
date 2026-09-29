import { supabaseAdmin } from "./supabase";
import {
  classifyCompanyPair,
  classifySharedEmail,
  type SharedAppearance,
} from "@shared/agent-contact-dedup";

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function classifyAgentEmail(emailRaw: string | null | undefined) {
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return { skipped: true as const };

  const { data, error } = await supabaseAdmin
    .from("company_contacts")
    .select("id, company_id, email, companies!company_contacts_company_id_fkey(id, name)")
    .ilike("email", email);
  if (error) throw error;
  const appearances: SharedAppearance[] = (data ?? []).map((row: any) => ({
    contactId: row.id,
    companyId: row.company_id,
    companyName: row.companies?.name ?? "",
  }));
  const result = classifySharedEmail(email, appearances);
  if (!result) {
    await supabaseAdmin
      .from("company_contacts")
      .update({ is_agent_contact: false, agent_organization_name: null, agent_home_company_id: null })
      .ilike("email", email);
    return { skipped: true as const, uniqueCompany: true as const };
  }

  if (result.outcome === "ambiguous") {
    const { data: existing } = await supabaseAdmin
      .from("contact_company_dedup_candidates")
      .select("id")
      .eq("kind", "agent_contact")
      .eq("email", email)
      .in("status", ["pending_review", "approved"])
      .limit(1);
    if (!existing?.length) {
      await supabaseAdmin.from("contact_company_dedup_candidates").insert({
        kind: "agent_contact",
        email,
        company_id_a: result.matchingCompanyIds[0] ?? null,
        company_id_b: result.matchingCompanyIds[1] ?? null,
        signal: "domain_name_match_ambiguous",
        confidence: 0,
        note: `Matches companies: ${result.matchingCompanyIds.join(", ")}`,
        status: "pending_review",
        agent_organization_name: result.orgName,
      });
    }
    return { skipped: false as const, outcome: result.outcome, pending: true as const };
  }

  const homeId = result.outcome === "single_home" ? result.homeCompanyId : null;
  const org = result.orgName;
  if (result.tagContactIds.length) {
    const { error: uErr } = await supabaseAdmin
      .from("company_contacts")
      .update({
        is_agent_contact: true,
        agent_organization_name: org,
        agent_home_company_id: homeId,
      })
      .in("id", result.tagContactIds);
    if (uErr) throw uErr;
  }
  if (result.leaveContactIds.length) {
    await supabaseAdmin
      .from("company_contacts")
      .update({ is_agent_contact: false, agent_organization_name: null, agent_home_company_id: null })
      .in("id", result.leaveContactIds);
  }

  const rows = result.tagContactIds.map((id) => ({
    kind: "agent_contact" as const,
    company_contact_id: id,
    agent_organization_name: org,
    agent_home_company_id: homeId,
    email,
    signal: result.outcome === "single_home" ? "domain_name_match" : "agent_domain_no_home_row",
    confidence: result.outcome === "single_home" ? 0.9 : 0.8,
    status: "auto_applied" as const,
  }));
  if (rows.length) {
    await supabaseAdmin
      .from("contact_company_dedup_candidates")
      .delete()
      .eq("kind", "agent_contact")
      .eq("email", email)
      .eq("status", "auto_applied");
    await supabaseAdmin.from("contact_company_dedup_candidates").insert(rows);
  }
  return { skipped: false as const, outcome: result.outcome, tagged: result.tagContactIds.length };
}

export async function backfillAgentAndFamilyCandidates() {
  const { data: contacts, error } = await supabaseAdmin
    .from("company_contacts")
    .select("id, company_id, email");
  if (error) throw error;
  const emailCompanies = new Map<string, Set<number>>();
  for (const c of contacts ?? []) {
    const em = String(c.email || "").trim().toLowerCase();
    if (!em) continue;
    if (!emailCompanies.has(em)) emailCompanies.set(em, new Set());
    emailCompanies.get(em)!.add(c.company_id);
  }
  let agent = { single: 0, zero: 0, ambiguous: 0, skipped: 0 };
  for (const [em, cos] of Array.from(emailCompanies.entries())) {
    if (cos.size <= 1) {
      agent.skipped += 1;
      continue;
    }
    const r = await classifyAgentEmail(em);
    if (r.skipped) agent.skipped += 1;
    else if ((r as any).outcome === "single_home") agent.single += 1;
    else if ((r as any).outcome === "zero_home") agent.zero += 1;
    else if ((r as any).outcome === "ambiguous") agent.ambiguous += 1;
  }

  const { data: companies, error: cErr } = await supabaseAdmin
    .from("companies")
    .select("id, name, reporting_marks, merged_into_id, family_parent_id")
    .is("merged_into_id", null);
  if (cErr) throw cErr;
  const list = companies ?? [];
  let family = 0;
  let dup = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const cls = classifyCompanyPair({
        nameA: a.name,
        nameB: b.name,
        marksA: a.reporting_marks,
        marksB: b.reporting_marks,
      });
      if (!cls.kind) continue;
      const { data: existing } = await supabaseAdmin
        .from("contact_company_dedup_candidates")
        .select("id")
        .eq("kind", cls.kind)
        .eq("company_id_a", a.id)
        .eq("company_id_b", b.id)
        .limit(1);
      if (existing?.length) continue;
      await supabaseAdmin.from("contact_company_dedup_candidates").insert({
        kind: cls.kind,
        company_id_a: a.id,
        company_id_b: b.id,
        signal: cls.kind === "company_duplicate" ? "trigram_name_similarity_marks" : "trigram_name_similarity_distinct_marks",
        confidence: cls.sim,
        status: "pending_review",
        note: `${a.name} ↔ ${b.name}`,
      });
      if (cls.kind === "company_family") family += 1;
      else dup += 1;
    }
  }
  return { agent, family_candidates: family, duplicate_candidates: dup };
}

export async function listDedupCandidates(query: Record<string, unknown>) {
  const status = String(query.status || "pending_review");
  const kind = query.kind ? String(query.kind) : null;
  let q = supabaseAdmin
    .from("contact_company_dedup_candidates")
    .select("*")
    .order("confidence", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(300);
  if (status === "auto_applied") q = q.eq("status", "auto_applied");
  else if (status === "all") {
    /* no filter */
  } else q = q.eq("status", status);
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data ?? [];
  const companyIds = Array.from(
    new Set(rows.flatMap((r: any) => [r.company_id_a, r.company_id_b, r.agent_home_company_id]).filter(Boolean)),
  );
  const contactIds = Array.from(new Set(rows.map((r: any) => r.company_contact_id).filter(Boolean)));
  const [cos, cts] = await Promise.all([
    companyIds.length
      ? supabaseAdmin.from("companies").select("id, name, reporting_marks, family_parent_id").in("id", companyIds)
      : Promise.resolve({ data: [], error: null } as any),
    contactIds.length
      ? supabaseAdmin.from("company_contacts").select("id, name, email, title, company_id, is_agent_contact").in("id", contactIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);
  if (cos.error) throw cos.error;
  if (cts.error) throw cts.error;
  const cmap = new Map((cos.data ?? []).map((c: any) => [c.id, c]));
  const pmap = new Map((cts.data ?? []).map((c: any) => [c.id, c]));
  return rows.map((r: any) => ({
    ...r,
    company_a: r.company_id_a ? cmap.get(r.company_id_a) ?? null : null,
    company_b: r.company_id_b ? cmap.get(r.company_id_b) ?? null : null,
    home_company: r.agent_home_company_id ? cmap.get(r.agent_home_company_id) ?? null : null,
    contact: r.company_contact_id ? pmap.get(r.company_contact_id) ?? null : null,
  }));
}

export async function setFamilyParent(childId: number, parentId: number | null) {
  if (parentId && parentId === childId) throw Object.assign(new Error("A company cannot be its own family parent"), { status: 400 });
  const { error } = await supabaseAdmin.from("companies").update({ family_parent_id: parentId }).eq("id", childId);
  if (error) throw error;
}

export async function mergeCompanies(survivorId: number, loserId: number) {
  if (survivorId === loserId) throw Object.assign(new Error("Cannot merge a company into itself"), { status: 400 });
  const { data: loser, error: lErr } = await supabaseAdmin.from("companies").select("id, merged_into_id").eq("id", loserId).maybeSingle();
  if (lErr) throw lErr;
  if (!loser) throw Object.assign(new Error("Company not found"), { status: 404 });
  await supabaseAdmin.from("company_contacts").update({ company_id: survivorId }).eq("company_id", loserId);
  await supabaseAdmin.from("company_products").update({ company_id: survivorId }).eq("company_id", loserId);
  await supabaseAdmin.from("company_fleet_stats").update({ company_id: survivorId }).eq("company_id", loserId);
  await supabaseAdmin.from("contact_lease_links").update({ company_id: survivorId }).eq("company_id", loserId);
  await supabaseAdmin.from("companies").update({ family_parent_id: null }).eq("family_parent_id", loserId);
  const { error } = await supabaseAdmin.from("companies").update({ merged_into_id: survivorId, family_parent_id: null }).eq("id", loserId);
  if (error) throw error;
}

export async function applyDedupAction(
  id: number,
  body: Record<string, unknown>,
  reviewerId: string | null,
) {
  const { data: row, error } = await supabaseAdmin
    .from("contact_company_dedup_candidates")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw Object.assign(new Error("Candidate not found"), { status: 404 });
  const action = String(body.action || "");
  const now = new Date().toISOString();

  if (action === "undo") {
    if (row.kind === "agent_contact" && row.company_contact_id) {
      await supabaseAdmin
        .from("company_contacts")
        .update({ is_agent_contact: false, agent_organization_name: null, agent_home_company_id: null })
        .eq("id", row.company_contact_id);
    }
    if (row.kind === "company_family" && row.company_id_b) {
      await supabaseAdmin.from("companies").update({ family_parent_id: null }).eq("id", row.company_id_b);
      if (row.company_id_a) await supabaseAdmin.from("companies").update({ family_parent_id: null }).eq("id", row.company_id_a);
    }
    await supabaseAdmin
      .from("contact_company_dedup_candidates")
      .update({ status: "rejected", reviewed_by: reviewerId, reviewed_at: now, note: "Undone" })
      .eq("id", id);
    return { ok: true };
  }

  if (action === "reject" || action === "dismiss") {
    await supabaseAdmin
      .from("contact_company_dedup_candidates")
      .update({ status: "rejected", reviewed_by: reviewerId, reviewed_at: now })
      .eq("id", id);
    return { ok: true };
  }

  if (row.kind === "agent_contact") {
    if (action === "not_agent") {
      if (row.company_contact_id) {
        await supabaseAdmin
          .from("company_contacts")
          .update({ is_agent_contact: false, agent_organization_name: null, agent_home_company_id: null })
          .eq("id", row.company_contact_id);
      }
      await supabaseAdmin
        .from("contact_company_dedup_candidates")
        .update({ status: "rejected", reviewed_by: reviewerId, reviewed_at: now })
        .eq("id", id);
      return { ok: true };
    }
    const homeId = num(body.home_company_id);
    const org = String(body.agent_organization_name || row.agent_organization_name || "").trim() || null;
    if (row.company_contact_id) {
      await supabaseAdmin
        .from("company_contacts")
        .update({
          is_agent_contact: true,
          agent_organization_name: org,
          agent_home_company_id: homeId,
        })
        .eq("id", row.company_contact_id);
    } else if (row.email && homeId) {
      const { data: people } = await supabaseAdmin
        .from("company_contacts")
        .select("id, company_id")
        .ilike("email", row.email);
      const homeName = org;
      for (const p of people ?? []) {
        const isHome = p.company_id === homeId;
        await supabaseAdmin.from("company_contacts").update({
          is_agent_contact: !isHome,
          agent_organization_name: isHome ? null : homeName,
          agent_home_company_id: isHome ? null : homeId,
        }).eq("id", p.id);
      }
    }
    await supabaseAdmin
      .from("contact_company_dedup_candidates")
      .update({
        status: "approved",
        reviewed_by: reviewerId,
        reviewed_at: now,
        agent_home_company_id: homeId,
        agent_organization_name: org,
      })
      .eq("id", id);
    return { ok: true };
  }

  if (action === "group_family") {
    const parentId = num(body.parent_company_id) ?? num(row.company_id_a);
    const childId = num(body.child_company_id) ?? num(row.company_id_b);
    if (!parentId || !childId) throw Object.assign(new Error("Pick a parent and child company"), { status: 400 });
    await setFamilyParent(childId, parentId);
    await supabaseAdmin
      .from("contact_company_dedup_candidates")
      .update({ status: "approved", reviewed_by: reviewerId, reviewed_at: now })
      .eq("id", id);
    return { ok: true };
  }

  if (action === "merge_duplicate") {
    const survivor = num(body.survivor_company_id) ?? num(row.company_id_a);
    const loser = num(body.loser_company_id) ?? num(row.company_id_b);
    if (!survivor || !loser) throw Object.assign(new Error("Pick survivor and company to merge"), { status: 400 });
    await mergeCompanies(survivor, loser);
    await supabaseAdmin
      .from("contact_company_dedup_candidates")
      .update({ status: "approved", reviewed_by: reviewerId, reviewed_at: now })
      .eq("id", id);
    return { ok: true };
  }

  throw Object.assign(new Error("Unknown action"), { status: 400 });
}

export async function dedupSummary() {
  const { data, error } = await supabaseAdmin.from("contact_company_dedup_candidates").select("status, kind");
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const r of data ?? []) {
    const k = `${r.status}:${r.kind}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}
