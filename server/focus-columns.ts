import {
  daysStopped,
  openStopReason,
  pickOpenPrograms,
  pickOpenStop,
  type OpenStopRow,
  type ProgramJoinRow,
} from "@shared/saved-views";
import { supabaseAdmin } from "./supabase";

export type FocusFields = {
  open_stop_type: string | null;
  open_stop_since: string | null;
  open_stop_days: number | null;
  open_stop_expected: string | null;
  open_stop_reason: string | null;
  open_stop_note: string | null;
  program_name: string | null;
  program_extra: number;
  program_status: string | null;
  program_milestone: string | null;
  program_milestone_at: string | null;
  program_note: string | null;
  latest_note: string | null;
  latest_note_at: string | null;
  latest_note_actor: string | null;
  tags: string[];
  view_note: string | null;
};

const EMPTY: FocusFields = {
  open_stop_type: null,
  open_stop_since: null,
  open_stop_days: null,
  open_stop_expected: null,
  open_stop_reason: null,
  open_stop_note: null,
  program_name: null,
  program_extra: 0,
  program_status: null,
  program_milestone: null,
  program_milestone_at: null,
  program_note: null,
  latest_note: null,
  latest_note_at: null,
  latest_note_actor: null,
  tags: [],
  view_note: null,
};

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function inBatches<T>(ids: number[], run: (slice: number[]) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for (const slice of chunks(ids, 200)) {
    rows.push(...(await run(slice)));
  }
  return rows;
}

async function loadOpenPrograms(ids: number[]): Promise<(ProgramJoinRow & { railcar_id: number })[]> {
  const cars = await inBatches<{
    railcar_id: number;
    program_id: number | null;
    status: string | null;
    milestone: string | null;
    milestone_at: string | null;
    notes: string | null;
    added_at: string | null;
    exited_date: string | null;
  }>(ids, async (slice) => {
    const { data, error } = await supabaseAdmin
      .from("program_cars")
      .select("railcar_id, program_id, status, milestone, milestone_at, notes, added_at, exited_date")
      .in("railcar_id", slice)
      .is("exited_date", null);
    if (error) throw error;
    return (data ?? []) as {
      railcar_id: number;
      program_id: number | null;
      status: string | null;
      milestone: string | null;
      milestone_at: string | null;
      notes: string | null;
      added_at: string | null;
      exited_date: string | null;
    }[];
  });
  const programIds = Array.from(new Set(cars.map((row) => Number(row.program_id)).filter((id) => id > 0)));
  const names = new Map<number, string>();
  for (const slice of chunks(programIds, 200)) {
    const { data, error } = await supabaseAdmin.from("programs").select("id, name").in("id", slice);
    if (error) throw error;
    for (const row of data ?? []) names.set(Number(row.id), String(row.name ?? ""));
  }
  return cars.map((row) => ({
    railcar_id: Number(row.railcar_id),
    status: row.status,
    milestone: row.milestone,
    milestone_at: row.milestone_at,
    notes: row.notes,
    added_at: row.added_at,
    exited_date: row.exited_date,
    name: row.program_id ? names.get(Number(row.program_id)) ?? null : null,
  }));
}

/**
 * Open rent stops, latest open program, latest note, and tags for the rows
 * already being returned. Closed rent stops are never attached.
 */
export async function attachFocusColumns<T extends { id: number; notes?: string | null }>(
  rows: T[],
  opts?: { viewId?: number | null },
): Promise<(T & FocusFields)[]> {
  if (!rows.length) return [];
  const ids = Array.from(new Set(rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0)));
  const started = Date.now();
  const [stops, programs, notes, tags, viewNotes] = await Promise.all([
    inBatches<OpenStopRow & { railcar_id: number }>(ids, async (slice) => {
      const { data, error } = await supabaseAdmin
        .from("car_rent_stops")
        .select("railcar_id, type, stop_date, expected_resume_date, actual_resume_date, reason, reason_other, note")
        .in("railcar_id", slice)
        .is("actual_resume_date", null);
      if (error) throw error;
      return (data ?? []) as (OpenStopRow & { railcar_id: number })[];
    }),
    loadOpenPrograms(ids),
    inBatches<{ railcar_id: number; detail: { body?: string } | null; occurred_at: string | null; actor: string | null }>(ids, async (slice) => {
      const { data, error } = await supabaseAdmin
        .from("activity_log")
        .select("railcar_id, detail, occurred_at, actor")
        .eq("action", "note")
        .in("railcar_id", slice)
        .order("occurred_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as { railcar_id: number; detail: { body?: string } | null; occurred_at: string | null; actor: string | null }[];
    }),
    inBatches<{ railcar_id: number; tag: string }>(ids, async (slice) => {
      const { data, error } = await supabaseAdmin
        .from("car_tags")
        .select("railcar_id, tag")
        .in("railcar_id", slice);
      if (error) throw error;
      return (data ?? []) as { railcar_id: number; tag: string }[];
    }),
    opts?.viewId
      ? inBatches<{ railcar_id: number; note: string | null }>(ids, async (slice) => {
          const { data, error } = await supabaseAdmin
            .from("car_list_members")
            .select("railcar_id, note")
            .eq("list_id", opts.viewId)
            .is("removed_at", null)
            .in("railcar_id", slice);
          if (error) {
            if (/removed_at|schema cache|does not exist|could not find/i.test(error.message)) return [];
            throw error;
          }
          return (data ?? []) as { railcar_id: number; note: string | null }[];
        })
      : Promise.resolve([]),
  ]);

  const stopByCar = new Map<number, OpenStopRow[]>();
  for (const stop of stops) {
    const id = Number(stop.railcar_id);
    const list = stopByCar.get(id) ?? [];
    list.push(stop);
    stopByCar.set(id, list);
  }
  const programByCar = new Map<number, ProgramJoinRow[]>();
  for (const row of programs) {
    const id = Number(row.railcar_id);
    const list = programByCar.get(id) ?? [];
    list.push(row);
    programByCar.set(id, list);
  }
  const noteByCar = new Map<number, { body: string; at: string | null; actor: string | null }>();
  for (const row of notes) {
    const id = Number(row.railcar_id);
    if (noteByCar.has(id)) continue;
    const body = String(row.detail?.body ?? "").trim();
    if (!body) continue;
    noteByCar.set(id, { body, at: row.occurred_at, actor: row.actor });
  }
  const tagsByCar = new Map<number, string[]>();
  for (const row of tags) {
    const id = Number(row.railcar_id);
    const tag = String(row.tag ?? "").trim();
    if (!tag) continue;
    const list = tagsByCar.get(id) ?? [];
    if (!list.includes(tag)) list.push(tag);
    tagsByCar.set(id, list);
  }
  const viewNoteByCar = new Map<number, string | null>();
  for (const row of viewNotes) viewNoteByCar.set(Number(row.railcar_id), row.note ?? null);

  const ms = Date.now() - started;
  console.log(`[search] focus cars=${ids.length} ms=${ms}`);
  return rows.map((row) => {
    const open = pickOpenStop(stopByCar.get(row.id) ?? []);
    const reason = openStopReason(open);
    const program = pickOpenPrograms(programByCar.get(row.id) ?? []);
    const latest = noteByCar.get(row.id);
    const fallback = String(row.notes ?? "").trim();
    const milestone = String(program.latest?.milestone ?? "").trim();
    return {
      ...row,
      ...EMPTY,
      open_stop_type: open ? String(open.type ?? "").trim() || null : null,
      open_stop_since: open?.stop_date ? String(open.stop_date).slice(0, 10) : null,
      open_stop_days: open ? daysStopped(open.stop_date) : null,
      open_stop_expected: open?.expected_resume_date ? String(open.expected_resume_date).slice(0, 10) : null,
      open_stop_reason: reason.text || null,
      open_stop_note: reason.note || null,
      program_name: program.latest?.name ? String(program.latest.name) : null,
      program_extra: program.extra,
      program_status: program.latest?.status ? String(program.latest.status) : null,
      program_milestone: milestone || null,
      program_milestone_at: program.latest?.milestone_at ? String(program.latest.milestone_at).slice(0, 10) : null,
      program_note: program.latest?.notes ? String(program.latest.notes) : null,
      latest_note: latest?.body || fallback || null,
      latest_note_at: latest?.at ?? null,
      latest_note_actor: latest?.actor ?? null,
      tags: tagsByCar.get(row.id) ?? [],
      view_note: viewNoteByCar.get(row.id) ?? null,
    };
  });
}
