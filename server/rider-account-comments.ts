import { supabaseAdmin } from "./supabase";
import { asOne } from "@shared/lease-type";

export type RiderAccountComment = {
  id: number;
  rider_id: number;
  author_user_id: string | null;
  author_email: string;
  body: string;
  created_at: string;
};

export type AmNoteSummary = {
  author_email: string;
  created_at: string;
  body: string;
  count: number;
};

const SELECT = "id, rider_id, author_user_id, author_email, body, created_at";

export function riderIdFromCar(row: { assignment?: unknown; rider_id?: unknown }): number | null {
  const assignment = asOne(row.assignment as any);
  const fromAssign = Number(assignment?.rider_id);
  if (Number.isFinite(fromAssign) && fromAssign > 0) return fromAssign;
  const fromRider = Number(asOne(assignment?.rider)?.id);
  if (Number.isFinite(fromRider) && fromRider > 0) return fromRider;
  const direct = Number(row.rider_id);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return null;
}

export async function listRiderAccountComments(riderId: number): Promise<RiderAccountComment[]> {
  const { data, error } = await supabaseAdmin
    .from("rider_account_comments")
    .select(SELECT)
    .eq("rider_id", riderId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RiderAccountComment[];
}

export async function commentsByRiderIds(
  riderIds: number[],
): Promise<Map<number, RiderAccountComment[]>> {
  const map = new Map<number, RiderAccountComment[]>();
  const uniq = [...new Set(riderIds.filter((id) => Number.isFinite(id) && id > 0))];
  for (let i = 0; i < uniq.length; i += 200) {
    const slice = uniq.slice(i, i + 200);
    const { data, error } = await supabaseAdmin
      .from("rider_account_comments")
      .select(SELECT)
      .in("rider_id", slice)
      .order("created_at", { ascending: false });
    if (error) throw error;
    for (const row of (data ?? []) as RiderAccountComment[]) {
      const list = map.get(row.rider_id) ?? [];
      list.push(row);
      map.set(row.rider_id, list);
    }
  }
  return map;
}

export async function latestAmNotesByRiderIds(
  riderIds: number[],
): Promise<Map<number, AmNoteSummary>> {
  const grouped = await commentsByRiderIds(riderIds);
  const out = new Map<number, AmNoteSummary>();
  for (const [id, list] of grouped) {
    const latest = list[0];
    if (!latest) continue;
    out.set(id, {
      author_email: latest.author_email,
      created_at: latest.created_at,
      body: latest.body,
      count: list.length,
    });
  }
  return out;
}

export async function attachLatestAmNotes<T extends { assignment?: unknown }>(
  rows: T[],
): Promise<(T & { am_note: AmNoteSummary | null })[]> {
  const ids = rows.map((r) => riderIdFromCar(r)).filter((id): id is number => id != null);
  const notes = await latestAmNotesByRiderIds(ids);
  return rows.map((r) => {
    const id = riderIdFromCar(r);
    return { ...r, am_note: id != null ? notes.get(id) ?? null : null };
  });
}

export async function createRiderAccountComment(input: {
  riderId: number;
  authorUserId: string;
  authorEmail: string;
  body: string;
}): Promise<RiderAccountComment> {
  const body = String(input.body ?? "").trim();
  if (!body) {
    const err = new Error("Comment body is required");
    (err as any).status = 400;
    throw err;
  }
  const email = String(input.authorEmail ?? "").trim();
  if (!email) {
    const err = new Error("Authenticated user has no email");
    (err as any).status = 400;
    throw err;
  }
  const { data: rider, error: rErr } = await supabaseAdmin
    .from("riders")
    .select("id")
    .eq("id", input.riderId)
    .maybeSingle();
  if (rErr) throw rErr;
  if (!rider) {
    const err = new Error("Rider not found");
    (err as any).status = 404;
    throw err;
  }
  const { data, error } = await supabaseAdmin
    .from("rider_account_comments")
    .insert({
      rider_id: input.riderId,
      author_user_id: input.authorUserId,
      author_email: email,
      body,
    })
    .select(SELECT)
    .single();
  if (error) throw error;
  return data as RiderAccountComment;
}

export async function deleteRiderAccountComment(commentId: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("rider_account_comments")
    .delete()
    .eq("id", commentId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
