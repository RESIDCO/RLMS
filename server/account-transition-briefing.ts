import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { supabaseAdmin } from "./supabase";
import { getAccount } from "./accounts";
import { patchTransitionRecord } from "./account-transitions";
import { ACCOUNT_TRANSITIONS_SOURCE, insertAttachmentRow, STORAGE_BUCKET } from "./attachments";
import { formatCalendarDate } from "@shared/lease-authority";

const FORM_SELECT =
  "id, record_id, tier_track, effective_date, mailing_address, target_completion, relationship_tenure_history, political_dynamics, background_commercial_history, credit_payment_history, notable_past_negotiations, overall_account_health, growth_potential_pipeline, renewal_risk_retention, whats_worked_hasnt, landmines, outgoing_signature_name, outgoing_signature_date, incoming_signature_name, incoming_signature_date, status, completed_at, created_at, updated_at";

export const BRIEFING_PDF_NOTE = "handoff_briefing_pdf";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function clean(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

function isoDate(v: unknown): string | null {
  if (v == null || String(v).trim() === "") return null;
  const s = String(v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const err: any = new Error("Date must be YYYY-MM-DD");
    err.status = 400;
    throw err;
  }
  return s;
}

export type BriefingContact = {
  name: string | null;
  title: string | null;
  role_function: string | null;
  authority: string | null;
  phone: string | null;
  email: string | null;
  comm_pref: string | null;
};

export type BriefingOlRow = {
  ol_number: string;
  car_type: string | null;
  qty: number;
  rent: number | null;
  lease_exp: string | null;
  monthly_maint: string | null;
  notes: string | null;
};

async function liveOlRows(accountId: number, notesByOl: Map<string, string>): Promise<BriefingOlRow[]> {
  const account = await getAccount(accountId);
  if (!account) return [];
  const ids = account.ols.map((o) => o.id);
  const extra = new Map<number, { car_type: string | null; monthly_rent_per_car: number | null }>();
  if (ids.length) {
    const { data, error } = await supabaseAdmin
      .from("riders")
      .select("id, car_type, monthly_rent_per_car")
      .in("id", ids);
    if (!error) {
      for (const r of data ?? []) {
        extra.set(Number(r.id), {
          car_type: r.car_type ?? null,
          monthly_rent_per_car: r.monthly_rent_per_car != null ? Number(r.monthly_rent_per_car) : null,
        });
      }
    }
  }
  return account.ols.map((ol) => {
    const olNumber = String(ol.schedule_number || ol.rider_name || `OL ${ol.id}`);
    const x = extra.get(ol.id);
    return {
      ol_number: olNumber,
      car_type: x?.car_type ?? null,
      qty: ol.active_car_count,
      rent: x?.monthly_rent_per_car ?? null,
      lease_exp: ol.expiration_date ?? null,
      monthly_maint: null,
      notes: notesByOl.get(olNumber) ?? null,
    };
  });
}

async function loadFormByRecord(recordId: number) {
  const { data, error } = await supabaseAdmin
    .from("account_transition_briefing_forms")
    .select(FORM_SELECT)
    .eq("record_id", recordId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getOrCreateBriefingForm(recordId: number) {
  const { data: rec, error: rErr } = await supabaseAdmin
    .from("account_transition_records")
    .select("id, account_id, from_account_manager, to_account_manager")
    .eq("id", recordId)
    .maybeSingle();
  if (rErr) throw rErr;
  if (!rec) {
    const err: any = new Error("Not found");
    err.status = 404;
    throw err;
  }

  let form = await loadFormByRecord(recordId);
  if (!form) {
    const { data, error } = await supabaseAdmin
      .from("account_transition_briefing_forms")
      .insert({ record_id: recordId, status: "draft" })
      .select(FORM_SELECT)
      .single();
    if (error) throw error;
    form = data;
  }

  const [{ data: contacts }, { data: olNotes }, account] = await Promise.all([
    supabaseAdmin
      .from("account_transition_briefing_contacts")
      .select("id, name, title, role_function, authority, phone, email, comm_pref, sort_order")
      .eq("form_id", form.id)
      .order("sort_order")
      .order("id"),
    supabaseAdmin
      .from("account_transition_briefing_ol_notes")
      .select("ol_number, notes")
      .eq("form_id", form.id),
    getAccount(Number(rec.account_id)),
  ]);
  if (!account) {
    const err: any = new Error("Account not found");
    err.status = 404;
    throw err;
  }
  const notesByOl = new Map((olNotes ?? []).map((n) => [String(n.ol_number), n.notes ?? ""]));
  const ols = await liveOlRows(Number(rec.account_id), notesByOl);
  return {
    form,
    contacts: contacts ?? [],
    ols,
    header: {
      account_id: Number(rec.account_id),
      account_name: account.name,
      outgoing_rep: rec.from_account_manager,
      incoming_rep: rec.to_account_manager,
    },
  };
}

export async function saveBriefingForm(
  recordId: number,
  body: {
    form?: Record<string, unknown>;
    contacts?: BriefingContact[];
    ol_notes?: { ol_number: string; notes: string | null }[];
  },
) {
  const current = await getOrCreateBriefingForm(recordId);
  const f = body.form ?? {};
  const nextStatus = f.status != null ? String(f.status) : current.form.status;
  if (nextStatus !== "draft" && nextStatus !== "completed") {
    const err: any = new Error("status must be draft or completed");
    err.status = 400;
    throw err;
  }
  const wasCompleted = current.form.status === "completed";
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    tier_track: f.tier_track !== undefined ? clean(f.tier_track) : current.form.tier_track,
    effective_date: f.effective_date !== undefined ? isoDate(f.effective_date) : current.form.effective_date,
    mailing_address: f.mailing_address !== undefined ? clean(f.mailing_address) : current.form.mailing_address,
    target_completion: f.target_completion !== undefined ? isoDate(f.target_completion) : current.form.target_completion,
    relationship_tenure_history:
      f.relationship_tenure_history !== undefined ? clean(f.relationship_tenure_history) : current.form.relationship_tenure_history,
    political_dynamics: f.political_dynamics !== undefined ? clean(f.political_dynamics) : current.form.political_dynamics,
    background_commercial_history:
      f.background_commercial_history !== undefined
        ? clean(f.background_commercial_history)
        : current.form.background_commercial_history,
    credit_payment_history:
      f.credit_payment_history !== undefined ? clean(f.credit_payment_history) : current.form.credit_payment_history,
    notable_past_negotiations:
      f.notable_past_negotiations !== undefined ? clean(f.notable_past_negotiations) : current.form.notable_past_negotiations,
    overall_account_health:
      f.overall_account_health !== undefined ? clean(f.overall_account_health) : current.form.overall_account_health,
    growth_potential_pipeline:
      f.growth_potential_pipeline !== undefined ? clean(f.growth_potential_pipeline) : current.form.growth_potential_pipeline,
    renewal_risk_retention:
      f.renewal_risk_retention !== undefined ? clean(f.renewal_risk_retention) : current.form.renewal_risk_retention,
    whats_worked_hasnt: f.whats_worked_hasnt !== undefined ? clean(f.whats_worked_hasnt) : current.form.whats_worked_hasnt,
    landmines: f.landmines !== undefined ? clean(f.landmines) : current.form.landmines,
    outgoing_signature_name:
      f.outgoing_signature_name !== undefined ? clean(f.outgoing_signature_name) : current.form.outgoing_signature_name,
    outgoing_signature_date:
      f.outgoing_signature_date !== undefined ? isoDate(f.outgoing_signature_date) : current.form.outgoing_signature_date,
    incoming_signature_name:
      f.incoming_signature_name !== undefined ? clean(f.incoming_signature_name) : current.form.incoming_signature_name,
    incoming_signature_date:
      f.incoming_signature_date !== undefined ? isoDate(f.incoming_signature_date) : current.form.incoming_signature_date,
    status: nextStatus,
  };
  if (nextStatus === "completed" && !wasCompleted) {
    patch.completed_at = new Date().toISOString();
  }
  if (nextStatus === "draft") {
    patch.completed_at = current.form.completed_at;
  }

  const { error: uErr } = await supabaseAdmin
    .from("account_transition_briefing_forms")
    .update(patch)
    .eq("id", current.form.id);
  if (uErr) throw uErr;

  if (Array.isArray(body.contacts)) {
    const { error: dErr } = await supabaseAdmin
      .from("account_transition_briefing_contacts")
      .delete()
      .eq("form_id", current.form.id);
    if (dErr) throw dErr;
    const rows = body.contacts
      .map((c, i) => ({
        form_id: current.form.id,
        name: clean(c.name),
        title: clean(c.title),
        role_function: clean(c.role_function),
        authority: clean(c.authority),
        phone: clean(c.phone),
        email: clean(c.email),
        comm_pref: clean(c.comm_pref),
        sort_order: i,
      }))
      .filter((c) => c.name || c.title || c.role_function || c.authority || c.phone || c.email || c.comm_pref);
    if (rows.length) {
      const { error: iErr } = await supabaseAdmin.from("account_transition_briefing_contacts").insert(rows);
      if (iErr) throw iErr;
    }
  }

  if (Array.isArray(body.ol_notes)) {
    for (const n of body.ol_notes) {
      const ol = String(n.ol_number ?? "").trim();
      if (!ol) continue;
      const { error: nErr } = await supabaseAdmin.from("account_transition_briefing_ol_notes").upsert(
        { form_id: current.form.id, ol_number: ol, notes: clean(n.notes) },
        { onConflict: "form_id,ol_number" },
      );
      if (nErr) throw nErr;
    }
  }

  if (nextStatus === "completed" && !wasCompleted) {
    await patchTransitionRecord(recordId, {
      briefing_form_completed: true,
      briefing_form_completed_date: todayIso(),
    });
  }

  return getOrCreateBriefingForm(recordId);
}

function money(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export async function generateBriefingPdf(recordId: number, uploadedBy: string | null) {
  const payload = await getOrCreateBriefingForm(recordId);
  const { form, contacts, ols, header } = payload;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 40;
  let y = 48;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Account Handoff Briefing Form", margin, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const meta = [
    `Account: ${header.account_name}`,
    `Tier / Track: ${form.tier_track || ""}`,
    `Effective Date: ${formatCalendarDate(form.effective_date) === "—" ? "" : formatCalendarDate(form.effective_date)}`,
    `Outgoing Rep: ${header.outgoing_rep || ""}`,
    `Incoming Rep: ${header.incoming_rep || ""}`,
    `Target Completion: ${formatCalendarDate(form.target_completion) === "—" ? "" : formatCalendarDate(form.target_completion)}`,
  ];
  for (const line of meta) {
    doc.text(line, margin, y);
    y += 12;
  }
  if (form.mailing_address) {
    const lines = doc.splitTextToSize(`Mailing Address: ${form.mailing_address}`, 530);
    doc.text(lines, margin, y);
    y += 12 * lines.length;
  }
  y += 8;

  const block = (title: string, body: string | null) => {
    if (y > 720) {
      doc.addPage();
      y = 48;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(title, margin, y);
    y += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const text = String(body ?? "").trim() || " ";
    const lines = doc.splitTextToSize(text, 530);
    doc.text(lines, margin, y);
    y += 12 * lines.length + 8;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("1. Key Contacts", margin, y);
  y += 14;
  block("Relationship tenure & history", form.relationship_tenure_history);
  block("Political dynamics / sensitivities", form.political_dynamics);
  autoTable(doc, {
    startY: y,
    head: [["Name", "Title", "Role/Function", "Authority", "Phone", "Email", "Comm. Pref."]],
    body: (contacts.length ? contacts : [{}]).map((c: any) => [
      c.name || "",
      c.title || "",
      c.role_function || "",
      c.authority || "",
      c.phone || "",
      c.email || "",
      c.comm_pref || "",
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    margin: { left: margin, right: margin },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  if (y > 720) {
    doc.addPage();
    y = 48;
  }
  doc.text("2. Account History", margin, y);
  y += 14;
  block("Background & Commercial History", form.background_commercial_history);
  block("Credit & Payment History", form.credit_payment_history);
  block("Notable Past Negotiations", form.notable_past_negotiations);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("3. Active OL#'s", margin, y);
  y += 8;
  autoTable(doc, {
    startY: y,
    head: [["OL #", "Car Type", "Qty", "Rent", "Lease Exp", "Mthly Maint.", "Notes"]],
    body: ols.map((o) => [
      o.ol_number,
      o.car_type || "",
      String(o.qty ?? ""),
      money(o.rent),
      formatCalendarDate(o.lease_exp) === "—" ? "" : formatCalendarDate(o.lease_exp),
      "n/a",
      o.notes || "",
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    margin: { left: margin, right: margin },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("4. Account Performance", margin, y);
  y += 14;
  block("Overall Account Health", form.overall_account_health);
  block("Growth Potential & Active Pipeline", form.growth_potential_pipeline);
  block("Renewal Risk & Retention", form.renewal_risk_retention);
  block("What's Worked & What Hasn't", form.whats_worked_hasnt);
  block("Landmines", form.landmines);

  block("Outgoing Rep Signature / Date", `${form.outgoing_signature_name || ""}  ${form.outgoing_signature_date || ""}`);
  block("Incoming Rep Signature / Date", `${form.incoming_signature_name || ""}  ${form.incoming_signature_date || ""}`);

  const pdf = Buffer.from(doc.output("arraybuffer"));
  const safeName = String(header.account_name || "Account").replace(/[^\w.\- ]+/g, "").slice(0, 60);
  const fileName = `Handoff Briefing — ${safeName}.pdf`;
  const accountId = header.account_id;

  const { data: existing } = await supabaseAdmin
    .from("attachments")
    .select("id, storage_path")
    .eq("entity_type", "account")
    .eq("entity_id", accountId)
    .eq("source_module", ACCOUNT_TRANSITIONS_SOURCE)
    .eq("notes", BRIEFING_PDF_NOTE);
  for (const a of existing ?? []) {
    if (a.storage_path) await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([a.storage_path]);
    await supabaseAdmin.from("attachments").delete().eq("id", a.id);
  }

  const storagePath = `account-transitions/briefing/${recordId}/${Date.now()}.pdf`;
  const { error: upErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(storagePath, pdf, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (upErr) throw upErr;
  const row = await insertAttachmentRow({
    entity_type: "account",
    entity_id: accountId,
    file_name: fileName,
    file_size: pdf.length,
    mime_type: "application/pdf",
    storage_path: storagePath,
    uploaded_by: uploadedBy,
    notes: BRIEFING_PDF_NOTE,
    source_module: ACCOUNT_TRANSITIONS_SOURCE,
  });
  return row;
}
