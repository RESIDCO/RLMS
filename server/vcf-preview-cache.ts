import type { SupabaseClient } from "@supabase/supabase-js";
import type { VcfRawRow } from "@shared/vcf-import";

const TTL_HOURS = 24;

export async function putVcfPreview(
  db: SupabaseClient,
  writerId: string,
  rows: VcfRawRow[],
  fileName?: string | null
): Promise<string> {
  const id = crypto.randomUUID();
  await db.from("vcf_preview_cache").delete().eq("loaded_by", writerId);
  const { error } = await db.from("vcf_preview_cache").insert({
    id,
    loaded_by: writerId,
    file_name: fileName ?? null,
    rows,
  });
  if (error) throw error;
  const cutoff = new Date(Date.now() - TTL_HOURS * 60 * 60 * 1000).toISOString();
  await db.from("vcf_preview_cache").delete().lt("created_at", cutoff);
  return id;
}

export async function getVcfPreview(
  db: SupabaseClient,
  id: string,
  writerId: string
): Promise<{ rows: VcfRawRow[]; fileName: string | null } | null> {
  const { data, error } = await db
    .from("vcf_preview_cache")
    .select("rows, loaded_by, created_at, file_name")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  if (String(data.loaded_by) !== writerId) return null;
  const age = Date.now() - new Date(data.created_at).getTime();
  if (age > TTL_HOURS * 60 * 60 * 1000) return null;
  if (!Array.isArray(data.rows) || data.rows.length === 0) return null;
  return { rows: data.rows as VcfRawRow[], fileName: (data.file_name as string | null) ?? null };
}

export async function deleteVcfPreview(
  db: SupabaseClient,
  id: string,
  writerId: string
): Promise<void> {
  await db.from("vcf_preview_cache").delete().eq("id", id).eq("loaded_by", writerId);
}
