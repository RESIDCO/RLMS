import { recordChange, withChangeGroupResult } from "./change-log";
import { crmActivityPermission, type CrmActivityRole } from "./crm-activity-access";
import { CrmHttpError } from "./crm-error";
import { supabaseAdmin } from "./supabase";
import { changeCaptureRow, isCrmActivityKind, type CrmActivityKind, type CrmActivityRow } from "@shared/crm";

export type ActivityFilters = {
  account_id?: number;
  opportunity_id?: number;
  rider_id?: number;
  company_id?: number;
  contact_id?: number;
  kind?: string;
};

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function dateOnly(value: unknown): string | null {
  if (value == null || value === "") return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function httpError(status: number, message: string): CrmHttpError {
  return new CrmHttpError(status, message);
}

function mapActivity(row: Record<string, unknown>): CrmActivityRow {
  return {
    id: Number(row.id),
    account_id: positiveInt(row.account_id),
    opportunity_id: positiveInt(row.opportunity_id),
    rider_id: positiveInt(row.rider_id),
    company_id: positiveInt(row.company_id),
    contact_id: positiveInt(row.contact_id),
    kind: String(row.kind) as CrmActivityKind,
    body: String(row.body ?? ""),
    due_date: dateOnly(row.due_date),
    done_at: row.done_at == null ? null : String(row.done_at),
    actor: String(row.actor ?? ""),
    occurred_at: String(row.occurred_at ?? ""),
    created_at: String(row.created_at ?? ""),
  };
}

export async function listCrmActivities(filters: ActivityFilters): Promise<CrmActivityRow[]> {
  let query = supabaseAdmin.from("crm_activities").select("*").order("occurred_at", { ascending: false }).limit(200);
  if (filters.account_id) query = query.eq("account_id", filters.account_id);
  if (filters.opportunity_id) query = query.eq("opportunity_id", filters.opportunity_id);
  if (filters.rider_id) query = query.eq("rider_id", filters.rider_id);
  if (filters.company_id) query = query.eq("company_id", filters.company_id);
  if (filters.contact_id) query = query.eq("contact_id", filters.contact_id);
  if (filters.kind) query = query.eq("kind", filters.kind);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => mapActivity(row as Record<string, unknown>));
}

export async function createCrmActivity(
  body: Record<string, unknown>,
  actor: string,
  role: CrmActivityRole,
): Promise<CrmActivityRow & { change_group: string }> {
  const allowed = crmActivityPermission({ role, action: "create", actorId: actor });
  if (!allowed.ok) throw httpError(allowed.status, allowed.message);
  if (!isCrmActivityKind(body.kind)) throw httpError(400, "Invalid activity kind");
  const text = String(body.body ?? "").trim();
  if (!text) throw httpError(400, "Activity body is required");
  let accountId = positiveInt(body.account_id);
  const opportunityId = positiveInt(body.opportunity_id);
  const riderId = positiveInt(body.rider_id);
  const companyId = positiveInt(body.company_id);
  const contactId = positiveInt(body.contact_id);
  if (opportunityId && accountId == null) {
    const { data, error } = await supabaseAdmin.from("opportunities").select("account_id, rider_id").eq("id", opportunityId).maybeSingle();
    if (error) throw error;
    if (!data) throw httpError(400, "Opportunity not found");
    accountId = positiveInt(data.account_id);
  }
  if (accountId == null && opportunityId == null && riderId == null && companyId == null && contactId == null) {
    throw httpError(400, "Activity needs an account, opportunity, OL, company, or contact");
  }
  const payload = {
    account_id: accountId,
    opportunity_id: opportunityId,
    rider_id: riderId,
    company_id: companyId,
    contact_id: contactId,
    kind: body.kind,
    body: text,
    due_date: dateOnly(body.due_date),
    done_at: body.done_at ? new Date(String(body.done_at)).toISOString() : null,
    actor,
    occurred_at: body.occurred_at ? new Date(String(body.occurred_at)).toISOString() : new Date().toISOString(),
  };
  const result = await withChangeGroupResult(actor, async () => {
    const { data, error } = await supabaseAdmin.from("crm_activities").insert(payload).select("*").single();
    if (error) throw error;
    await recordChange({
      table: "crm_activities",
      pk: Number(data.id),
      before: {},
      after: changeCaptureRow(data as Record<string, unknown>),
      action: "create_crm_activity",
      entity_type: "crm_activity",
      entity_id: Number(data.id),
      rider_id: riderId,
      actor,
      detail: { kind: data.kind },
    });
    return mapActivity(data as Record<string, unknown>);
  });
  return result;
}

export async function patchCrmActivity(
  id: number,
  body: Record<string, unknown>,
  actor: string,
  role: CrmActivityRole,
): Promise<CrmActivityRow & { change_group: string }> {
  if (!Number.isFinite(id) || id <= 0) throw httpError(400, "Invalid activity");
  const { data: before, error: beforeErr } = await supabaseAdmin.from("crm_activities").select("*").eq("id", id).maybeSingle();
  if (beforeErr) throw beforeErr;
  if (!before) throw httpError(404, "Activity not found");
  const allowed = crmActivityPermission({
    role,
    action: "patch",
    actorId: actor,
    rowActor: String(before.actor ?? ""),
    patchKeys: Object.keys(body),
  });
  if (!allowed.ok) throw httpError(allowed.status, allowed.message);
  const patch: Record<string, unknown> = {};
  if ("kind" in body) {
    if (!isCrmActivityKind(body.kind)) throw httpError(400, "Invalid activity kind");
    patch.kind = body.kind;
  }
  if ("body" in body) {
    const text = String(body.body ?? "").trim();
    if (!text) throw httpError(400, "Activity body is required");
    patch.body = text;
  }
  if ("due_date" in body) patch.due_date = dateOnly(body.due_date);
  if ("done_at" in body) patch.done_at = body.done_at ? new Date(String(body.done_at)).toISOString() : null;
  if ("occurred_at" in body && body.occurred_at) patch.occurred_at = new Date(String(body.occurred_at)).toISOString();
  const result = await withChangeGroupResult(actor, async () => {
    const { data, error } = await supabaseAdmin.from("crm_activities").update(patch).eq("id", id).select("*").single();
    if (error) throw error;
    await recordChange({
      table: "crm_activities",
      pk: id,
      before: changeCaptureRow(before as Record<string, unknown>),
      after: changeCaptureRow(data as Record<string, unknown>),
      action: "update_crm_activity",
      entity_type: "crm_activity",
      entity_id: id,
      rider_id: positiveInt(data.rider_id),
      actor,
      detail: { kind: data.kind },
    });
    return mapActivity(data as Record<string, unknown>);
  });
  return result;
}

/** Viewers can never delete. No role can delete an activity in AM-1. */
export async function deleteCrmActivity(id: number, actor: string, role: CrmActivityRole): Promise<never> {
  void id;
  const allowed = crmActivityPermission({ role, action: "delete", actorId: actor });
  if (!allowed.ok) throw httpError(allowed.status, allowed.message);
  throw httpError(403, "Deleting activities is not available");
}
