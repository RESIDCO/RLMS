import {
  INACTIVATE_BATCH_MAX,
  chooseInactivateIds,
  classifyInactivateRow,
  inactivateEndDateError,
  summarizeInactivate,
  type InactivateFacts,
  type InactivatePreview,
} from "@shared/inactivate-cars";
import { appendNotesInGroup, normalizeAppendNote, withNoteReport } from "./append-note";
import { withChangeGroupResult } from "./change-log";
import { supabaseAdmin } from "./supabase";

const CHUNK = 200;

type CarRow = {
  id: number;
  reporting_marks: string | null;
  car_number: string | null;
  status: string | null;
  active: boolean | null;
  rider_external_id: string | null;
};

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

async function loadCars(ids: number[]): Promise<Map<number, CarRow>> {
  const byId = new Map<number, CarRow>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from("railcars")
      .select("id, reporting_marks, car_number, status, active, rider_external_id")
      .in("id", slice);
    if (error) throw error;
    for (const row of data ?? []) byId.set(Number(row.id), row as CarRow);
  }
  return byId;
}

export async function previewInactivate(
  ids: number[],
  opts: { closeAssignment: boolean },
): Promise<InactivatePreview> {
  const unique = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0)));
  if (!unique.length) throw httpError(400, "ids required");
  if (unique.length > INACTIVATE_BATCH_MAX) {
    throw httpError(400, `At most ${INACTIVATE_BATCH_MAX} cars per batch`);
  }
  const cars = await loadCars(unique);

  const openAssignments = new Map<number, { ol: string | null; label: string | null }>();
  const rentStops = new Map<number, { type: string; stop_date: string }>();
  const programs = new Map<number, string[]>();
  const commitments = new Map<number, { type: string; name: string }>();

  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const [assignments, stops, memberships, deals] = await Promise.all([
      supabaseAdmin
        .from("assignment_history")
        .select("id, railcar_id, rider_external_id, assignment_label, end_date")
        .in("railcar_id", slice)
        .is("end_date", null)
        .order("id", { ascending: false }),
      supabaseAdmin
        .from("car_rent_stops")
        .select("id, railcar_id, type, stop_date, actual_resume_date")
        .in("railcar_id", slice)
        .is("actual_resume_date", null),
      supabaseAdmin
        .from("program_cars")
        .select("id, railcar_id, exited_date, program:programs(name)")
        .in("railcar_id", slice)
        .is("exited_date", null),
      supabaseAdmin
        .from("car_commitments")
        .select("id, railcar_id, type, name, cleared_at")
        .in("railcar_id", slice)
        .is("cleared_at", null),
    ]);
    if (assignments.error) throw assignments.error;
    if (stops.error) throw stops.error;
    if (memberships.error) throw memberships.error;
    if (deals.error) throw deals.error;
    for (const row of assignments.data ?? []) {
      const id = Number(row.railcar_id);
      if (openAssignments.has(id)) continue;
      openAssignments.set(id, {
        ol: row.rider_external_id ? String(row.rider_external_id) : null,
        label: row.assignment_label ? String(row.assignment_label) : null,
      });
    }
    for (const row of stops.data ?? []) {
      const id = Number(row.railcar_id);
      if (rentStops.has(id)) continue;
      rentStops.set(id, { type: String(row.type ?? "Rent stop"), stop_date: String(row.stop_date ?? "").slice(0, 10) });
    }
    for (const row of memberships.data ?? []) {
      const id = Number(row.railcar_id);
      const program = row.program as { name?: string } | { name?: string }[] | null;
      const name = Array.isArray(program) ? program[0]?.name : program?.name;
      const list = programs.get(id) ?? [];
      if (name) list.push(String(name));
      programs.set(id, list);
    }
    for (const row of deals.data ?? []) {
      const id = Number(row.railcar_id);
      if (commitments.has(id)) continue;
      commitments.set(id, { type: String(row.type ?? "commitment"), name: String(row.name ?? "") });
    }
  }

  const ols = new Set<string>();
  for (const id of unique) {
    const ol = openAssignments.get(id)?.ol || cars.get(id)?.rider_external_id || "";
    if (ol) ols.add(ol);
  }
  const activeOnOl = new Map<string, Set<number>>();
  const olList = Array.from(ols);
  for (let i = 0; i < olList.length; i += CHUNK) {
    const slice = olList.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from("railcars")
      .select("id, rider_external_id, active")
      .in("rider_external_id", slice)
      .eq("active", true);
    if (error) throw error;
    for (const row of data ?? []) {
      const ol = String(row.rider_external_id ?? "");
      if (!ol) continue;
      const set = activeOnOl.get(ol) ?? new Set<number>();
      set.add(Number(row.id));
      activeOnOl.set(ol, set);
    }
  }

  const facts: InactivateFacts[] = unique.map((id) => {
    const car = cars.get(id);
    const assignment = openAssignments.get(id) ?? null;
    const ol = assignment?.ol || car?.rider_external_id || null;
    const onOl = ol ? activeOnOl.get(ol) : undefined;
    const includesSelf = onOl?.has(id) ?? false;
    const other = onOl ? onOl.size - (includesSelf ? 1 : 0) : 0;
    return {
      id,
      reporting_marks: car?.reporting_marks ?? null,
      car_number: car?.car_number ?? null,
      car_status: car?.status ?? null,
      active: car?.active ?? null,
      assignment: assignment
        ? {
            ol: assignment.ol,
            label: assignment.label,
            last_active_on_ol: Boolean(ol) && includesSelf && other === 0,
            other_active_on_ol: other,
          }
        : null,
      rent_stop: rentStops.get(id) ?? null,
      programs: programs.get(id) ?? [],
      commitment: commitments.get(id) ?? null,
    };
  });
  const rows = facts.map((row) => classifyInactivateRow(row, opts));
  for (const row of rows) {
    if (cars.has(row.id)) continue;
    row.status = "already_inactive";
    row.blockers = ["already_inactive"];
    row.message = "Car not found. Left unchanged.";
  }
  return summarizeInactivate(rows);
}

export async function applyInactivate(opts: {
  ids: number[];
  mode: "all" | "good";
  reason: string;
  closeAssignment: boolean;
  endDate: string | null;
  actor: string;
  changedBy: string;
  appendNote?: unknown;
}): Promise<{ ok: true; change_group: string; applied: number; closed_assignments: number; note_change_group?: string; note_appended?: number[]; note_skipped?: { id: number; status: number; message: string }[] }> {
  const reason = opts.reason.trim();
  if (!reason) throw httpError(400, "A reason is required");
  const dateError = inactivateEndDateError(opts.closeAssignment, opts.endDate);
  if (dateError) throw httpError(400, dateError);
  const preview = await previewInactivate(opts.ids, { closeAssignment: opts.closeAssignment });
  const selected = chooseInactivateIds(preview, opts.mode);
  if (!selected.ok) throw httpError(400, selected.error);
  let noted: { appended: number[]; skipped: { id: number; status: number; message: string }[]; change_group: string } | null = null;
  if (normalizeAppendNote(opts.appendNote)) {
    noted = await withChangeGroupResult(opts.actor, async () =>
      appendNotesInGroup({
        entityType: "railcar",
        ids: selected.ids,
        note: opts.appendNote,
        actor: opts.actor,
      }),
    );
  }
  const endDate = opts.closeAssignment ? String(opts.endDate).slice(0, 10) : null;
  const { data, error } = await supabaseAdmin.rpc("inactivate_railcars", {
    p_ids: selected.ids,
    p_reason: reason,
    p_actor: opts.actor,
    p_changed_by: opts.changedBy,
    p_close_assignment: opts.closeAssignment,
    p_end_date: endDate,
  });
  if (error) {
    const message = String(error.message ?? error);
    if (/inactivate_railcars/i.test(message) && /schema cache|does not exist|could not find|function/i.test(message)) {
      throw httpError(503, "Inactivate is not available until migrations/20261114_inactivate_railcars.sql is applied.");
    }
    throw error;
  }
  const out = (data ?? {}) as { ok?: boolean; error?: string; change_group?: string; applied?: number; closed_assignments?: number };
  if (!out.ok) throw httpError(400, out.error || "Inactivate failed");
  const base = {
    ok: true as const,
    change_group: String(out.change_group),
    applied: Number(out.applied ?? selected.ids.length),
    closed_assignments: Number(out.closed_assignments ?? 0),
  };
  if (!noted) return base;
  return withNoteReport({ ...base, note_change_group: noted.change_group }, opts.appendNote, noted);
}
