import { supabaseAdmin } from "./supabase";
import {
  ACCOUNT_TRANSITIONS_SOURCE,
  stampGenericAttachmentSource,
  type AttachmentSourceModule,
} from "@shared/attachment-source";

export const STORAGE_BUCKET = "rlms-attachments";

export const ATTACHMENT_ENTITY_TYPES = ["master_lease", "rider", "railcar", "account"] as const;
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

export function isAttachmentEntityType(v: string): v is AttachmentEntityType {
  return (ATTACHMENT_ENTITY_TYPES as readonly string[]).includes(v);
}

export async function insertAttachmentRow(row: {
  entity_type: AttachmentEntityType;
  entity_id: number;
  file_name: string;
  file_size: number;
  mime_type: string;
  storage_path: string;
  uploaded_by: string | null;
  notes: string | null;
  source_module: AttachmentSourceModule;
}) {
  const { data, error } = await supabaseAdmin
    .from("attachments")
    .insert({
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      file_name: row.file_name,
      file_size: row.file_size,
      mime_type: row.mime_type,
      storage_path: row.storage_path,
      uploaded_by: row.uploaded_by,
      notes: row.notes,
      source_module: row.source_module,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function genericUploadSource(entityType: string): AttachmentSourceModule {
  return stampGenericAttachmentSource(entityType);
}

export async function riderBelongsToAccount(riderId: number, accountId: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("riders")
    .select("id, master_lease:master_leases(id, account_id)")
    .eq("id", riderId)
    .maybeSingle();
  if (error) throw error;
  const mla = (data as any)?.master_lease;
  const lease = Array.isArray(mla) ? mla[0] : mla;
  return Number(lease?.account_id) === accountId;
}

export async function listAccountScopedAttachments(accountId: number) {
  const { data: leases, error: lErr } = await supabaseAdmin
    .from("master_leases")
    .select("id, lease_number")
    .eq("account_id", accountId);
  if (lErr) throw lErr;
  const leaseIds = (leases ?? []).map((l) => Number(l.id));
  const leaseLabel = new Map((leases ?? []).map((l) => [Number(l.id), String(l.lease_number ?? "")]));

  let riders: { id: number; rider_name: string; schedule_number: string | null; master_lease_id: number }[] = [];
  if (leaseIds.length) {
    const { data, error } = await supabaseAdmin
      .from("riders")
      .select("id, rider_name, schedule_number, master_lease_id")
      .in("master_lease_id", leaseIds);
    if (error) throw error;
    riders = data ?? [];
  }
  const riderIds = riders.map((r) => Number(r.id));
  const riderLabel = new Map(
    riders.map((r) => [Number(r.id), String(r.schedule_number || r.rider_name || `OL ${r.id}`)]),
  );

  const { data: accountAtt, error: aErr } = await supabaseAdmin
    .from("attachments")
    .select("*")
    .eq("entity_type", "account")
    .eq("entity_id", accountId);
  if (aErr) throw aErr;

  let riderAtt: any[] = [];
  if (riderIds.length) {
    const { data, error } = await supabaseAdmin
      .from("attachments")
      .select("*")
      .eq("entity_type", "rider")
      .in("entity_id", riderIds);
    if (error) throw error;
    riderAtt = data ?? [];
  }

  let mlaAtt: any[] = [];
  if (leaseIds.length) {
    const { data, error } = await supabaseAdmin
      .from("attachments")
      .select("*")
      .eq("entity_type", "master_lease")
      .in("entity_id", leaseIds);
    if (error) throw error;
    mlaAtt = data ?? [];
  }

  const rows = [
    ...(accountAtt ?? []).map((a) => ({ ...a, target_label: "Account" })),
    ...riderAtt.map((a) => ({ ...a, target_label: riderLabel.get(Number(a.entity_id)) ?? "OL" })),
    ...mlaAtt.map((a) => ({
      ...a,
      target_label: leaseLabel.get(Number(a.entity_id)) ? `MLA ${leaseLabel.get(Number(a.entity_id))}` : "MLA",
    })),
  ].sort((a, b) => String(b.uploaded_at ?? "").localeCompare(String(a.uploaded_at ?? "")));

  return rows;
}

export { ACCOUNT_TRANSITIONS_SOURCE };
