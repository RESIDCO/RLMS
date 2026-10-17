import { pickRow } from "@shared/change-log";
import { supabaseAdmin } from "./supabase";
import { annotateKpiDelta } from "./kpi-delta";
import { recordChange, withChangeGroupResult } from "./change-log";
import { formatCarId } from "@shared/residco-import";
import {
  getPreview,
  putPreview,
  setCommitment,
  clearCommitment,
  matchCarsFromIds,
  upsertOpenCommitment,
} from "./commitment";
import {
  overlayLifecycle,
  isProgramType,
  type ProgramLifecycle,
  type ProgramType,
} from "@shared/programs";
import {
  COMMITMENT_TYPES,
  pickEarliestOpenProgram,
  shouldCreateProgramCommitment,
  type CommitmentType,
} from "@shared/commitment";
import { logProgramActivity, resolveProgramCars } from "./programs";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function actorUuid(actor: string | null | undefined): string | null {
  const s = String(actor ?? "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

export async function loadProgramRow(id: number) {
  const { data, error } = await supabaseAdmin.from("programs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("Program not found"), { status: 404 });
  return { ...data, overlay_lifecycle: overlayLifecycle(data) as ProgramLifecycle };
}

export async function loadProgress(id: number) {
  const { data, error } = await supabaseAdmin.from("v_program_progress").select("*").eq("program_id", id).maybeSingle();
  if (error) throw error;
  return data;
}

function assertWritable(program: { overlay_lifecycle: string }, action: string) {
  if (program.overlay_lifecycle === "closed" || program.overlay_lifecycle === "cancelled") {
    throw Object.assign(new Error(`Closed/cancelled programs are read-only (${action})`), { status: 400 });
  }
}

async function kpiFlags(ids: number[]) {
  if (!ids.length) return new Map<number, any>();
  const { data, error } = await supabaseAdmin
    .from("v_rlms_kpi_car_rows")
    .select("railcar_id, active, is_op, off_rent, on_rent, derived_status, status_tag, commitment, current_lease")
    .in("railcar_id", ids);
  if (error) throw error;
  return new Map((data ?? []).map((r: any) => [Number(r.railcar_id), r]));
}

async function openProgramLinksForCars(ids: number[]) {
  if (!ids.length) return [] as any[];
  const { data, error } = await supabaseAdmin
    .from("v_program_open_links")
    .select("link_id, program_id, railcar_id, joined_date, program_name")
    .in("railcar_id", ids);
  if (error) throw error;
  return data ?? [];
}

async function openCommitment(railcarId: number) {
  const { data, error } = await supabaseAdmin
    .from("car_commitments")
    .select("*")
    .eq("railcar_id", railcarId)
    .is("cleared_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function syncProgramCommitment(railcarId: number, actor: string) {
  const { data: car } = await supabaseAdmin.from("railcars").select("id, active").eq("id", railcarId).maybeSingle();
  if (!car || car.active !== true) return { skipped: "inactive" as const };
  const flags = (await kpiFlags([railcarId])).get(railcarId);
  const links = (await openProgramLinksForCars([railcarId])).map((l: any) => ({
    program_id: Number(l.program_id),
    joined_date: l.joined_date,
    id: Number(l.link_id),
    program_name: l.program_name,
  }));
  const existing = await openCommitment(railcarId);
  if (!links.length) {
    if (existing?.type === "program") {
      await clearCommitment(railcarId, actor);
      return { cleared: true as const };
    }
    return { skipped: "no_open_program" as const };
  }
  const earliest = pickEarliestOpenProgram(links)!;
  const { data: prog } = await supabaseAdmin
    .from("programs")
    .select("id, name, target_completion_date")
    .eq("id", earliest.program_id)
    .maybeSingle();
  if (!shouldCreateProgramCommitment({ active: true, is_op: flags?.is_op, off_rent: flags?.off_rent })) {
    return { skipped: "not_off_rent_op" as const, in_programs: links.length };
  }
  if (existing) {
    if (existing.type === "program" && Number(existing.program_id) === Number(earliest.program_id)) {
      return { skipped: "already_pointed" as const, in_programs: links.length };
    }
    if (existing.type === "program") {
      const after = {
        program_id: earliest.program_id,
        name: prog?.name ?? existing.name,
        target_date: prog?.target_completion_date ?? existing.target_date,
      };
      await supabaseAdmin
        .from("car_commitments")
        .update({
          ...after,
          set_by: actor,
          set_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .is("cleared_at", null);
      await recordChange({
        table: "car_commitments",
        pk: Number(existing.id),
        before: pickRow(existing, ["program_id", "name", "target_date"]),
        after,
        action: "commitment_repoint",
        entity_type: "railcar",
        entity_id: railcarId,
        railcar_id: railcarId,
        actor,
      });
      return { repointed: true as const, program_id: earliest.program_id, in_programs: links.length };
    }
    return { skipped: "other_commitment" as const, in_programs: links.length };
  }
  await setCommitment(
    railcarId,
    {
      type: "program",
      name: prog?.name ?? "Program",
      program_id: earliest.program_id,
      target_date: prog?.target_completion_date ?? null,
    },
    actor,
    { overwrite: false },
  );
  return { created: true as const, program_id: earliest.program_id, in_programs: links.length };
}

export async function previewAddProgramCars(
  programId: number,
  body: { text?: string; railcar_ids?: number[] },
) {
  const program = await loadProgramRow(programId);
  assertWritable(program, "add cars");
  let resolved = {
    matched: [] as { token: string; railcar_id: number; label: string }[],
    not_found: [] as { token: string }[],
    already_in_program: [] as { token: string; railcar_id: number; label: string }[],
    ambiguous: [] as { token: string; matches: { railcar_id: number; label: string }[] }[],
  };
  if (Array.isArray(body.railcar_ids) && body.railcar_ids.length) {
    const { matched, notFound, inactive } = await matchCarsFromIds(body.railcar_ids);
    resolved.matched = matched.map((c: any) => ({
      token: formatCarId(c),
      railcar_id: c.id,
      label: formatCarId(c),
      _car: c,
    })) as any;
    resolved.not_found = notFound.map((n) => ({ token: n.raw }));
    (resolved as any).inactive_from_ids = inactive;
  } else {
    resolved = await resolveProgramCars({ text: String(body.text ?? ""), programId });
  }

  const matchedIds = resolved.matched.map((m) => m.railcar_id);
  const { data: cars } = matchedIds.length
    ? await supabaseAdmin
        .from("railcars")
        .select("id, reporting_marks, car_number, entity, active")
        .in("id", matchedIds)
    : { data: [] as any[] };
  const byId = new Map((cars ?? []).map((c: any) => [Number(c.id), c]));
  const flags = await kpiFlags(matchedIds);
  const otherLinks = await openProgramLinksForCars(matchedIds);
  const otherBy = new Map<number, any[]>();
  for (const l of otherLinks) {
    const id = Number(l.railcar_id);
    if (Number(l.program_id) === programId) continue;
    otherBy.set(id, [...(otherBy.get(id) ?? []), l]);
  }

  const inactive: any[] = (resolved as any).inactive_from_ids
    ? (resolved as any).inactive_from_ids.map((c: any) => ({
        token: formatCarId(c),
        railcar_id: c.id,
        label: formatCarId(c),
        skipped: "inactive",
      }))
    : [];
  const matched: any[] = [];
  const onRent: any[] = [];
  const inOther: any[] = [];
  for (const m of resolved.matched) {
    const car = byId.get(m.railcar_id);
    if (!car) continue;
    if (car.active !== true) {
      inactive.push({ ...m, skipped: "inactive" });
      continue;
    }
    const k = flags.get(m.railcar_id);
    const others = otherBy.get(m.railcar_id) ?? [];
    const row = {
      ...m,
      entity: car.entity,
      is_op: k?.is_op ?? null,
      off_rent: k?.off_rent ?? null,
      on_rent: k?.on_rent ?? null,
      will_create_commitment: shouldCreateProgramCommitment({
        active: true,
        is_op: k?.is_op,
        off_rent: k?.off_rent,
      }),
      other_programs: others.map((o) => ({ program_id: o.program_id, name: o.program_name })),
      in_multiple_warning: others.length > 0,
    };
    if (others.length) inOther.push(row);
    if (k?.on_rent) onRent.push(row);
    matched.push(row);
  }

  const commitIds = matched.filter((r) => r.will_create_commitment && !r.in_multiple_warning).map((r) => r.railcar_id);
  const kpi_delta = await annotateKpiDelta(commitIds, { kind: "commitment", action: "set" });
  const snapshot = {
    action: "add_cars",
    program_id: programId,
    program_name: program.name,
    matched,
    inactive,
    not_found: resolved.not_found,
    already_in_program: resolved.already_in_program,
    in_another_open_program: inOther,
    on_rent: onRent,
    ambiguous: resolved.ambiguous,
    kpi_delta,
  };
  return { preview_token: await putPreview("program", snapshot), ...snapshot };
}

export async function applyAddProgramCars(token: string, actor: string) {
  return withChangeGroupResult(actor, async () => {
  const preview = await getPreview("program", token);
  if (preview.action !== "add_cars") throw Object.assign(new Error("Wrong preview kind"), { status: 400 });
  const program = await loadProgramRow(Number(preview.program_id));
  assertWritable(program, "add cars");
  const today = todayIso();
  const added = [];
  for (const row of preview.matched ?? []) {
    const { data: car } = await supabaseAdmin
      .from("railcars")
      .select("id, active, rider_external_id")
      .eq("id", row.railcar_id)
      .eq("active", true)
      .maybeSingle();
    if (!car) continue;
    const { data: existing } = await supabaseAdmin
      .from("program_cars")
      .select("id")
      .eq("program_id", program.id)
      .eq("railcar_id", car.id)
      .is("exited_date", null)
      .maybeSingle();
    if (existing) continue;
    const { data: link, error } = await supabaseAdmin
      .from("program_cars")
      .insert({
        program_id: program.id,
        railcar_id: car.id,
        joined_date: today,
        rider_external_id_snapshot: car.rider_external_id ?? null,
        custom_fields: {},
      })
      .select("id, railcar_id")
      .single();
    if (error) throw error;
    await logProgramActivity({
      program_id: program.id,
      action: "car_added",
      actor,
      program_car_id: link.id,
      railcar_id: link.railcar_id,
      before: {},
      after: { id: link.id, railcar_id: link.railcar_id, joined_date: today },
    });
    if (program.overlay_lifecycle === "active") {
      await syncProgramCommitment(link.railcar_id, actor);
    }
    added.push(link);
  }
  await supabaseAdmin.from("programs").update({ updated_at: new Date().toISOString() }).eq("id", program.id);
  return { preview, added: added.length };
  });
}

export async function previewRemoveProgramCars(
  programId: number,
  body: { link_ids?: number[]; text?: string; reason?: string | null },
) {
  const program = await loadProgramRow(programId);
  assertWritable(program, "remove cars");
  let linkIds = Array.isArray(body.link_ids) ? body.link_ids.map(Number).filter((n) => n > 0) : [];
  if (!linkIds.length && body.text) {
    const resolved = await resolveProgramCars({ text: String(body.text), programId });
    const ids = resolved.already_in_program.map((r) => r.railcar_id);
    if (ids.length) {
      const { data } = await supabaseAdmin
        .from("program_cars")
        .select("id, railcar_id")
        .eq("program_id", programId)
        .is("exited_date", null)
        .in("railcar_id", ids);
      linkIds = (data ?? []).map((r: any) => Number(r.id));
    }
  }
  const { data: links, error } = await supabaseAdmin
    .from("program_cars")
    .select("id, railcar_id, exited_date, railcar:railcars(id, reporting_marks, car_number, active)")
    .eq("program_id", programId)
    .in("id", linkIds.length ? linkIds : [0]);
  if (error) throw error;
  const rows = (links ?? []).filter((l: any) => !l.exited_date).map((l: any) => {
    const rc = Array.isArray(l.railcar) ? l.railcar[0] : l.railcar;
    return {
      link_id: l.id,
      railcar_id: l.railcar_id,
      label: rc ? formatCarId(rc) : String(l.railcar_id),
      active: rc?.active === true,
    };
  });
  const activeIds = rows.filter((r) => r.active).map((r) => r.railcar_id);
  const kpi_delta = await annotateKpiDelta(activeIds, { kind: "commitment", action: "clear" });
  const snapshot = {
    action: "remove_cars",
    program_id: programId,
    reason: body.reason ?? null,
    rows,
    skipped_inactive: rows.filter((r) => !r.active),
    kpi_delta,
  };
  return { preview_token: await putPreview("program", snapshot), ...snapshot };
}

export async function applyRemoveProgramCars(token: string, actor: string) {
  return withChangeGroupResult(actor, async () => {
  const preview = await getPreview("program", token);
  if (preview.action !== "remove_cars") throw Object.assign(new Error("Wrong preview kind"), { status: 400 });
  const program = await loadProgramRow(Number(preview.program_id));
  assertWritable(program, "remove cars");
  const today = todayIso();
  let updated = 0;
  for (const row of preview.rows ?? []) {
    if (!row.active) continue;
    const { data: prior } = await supabaseAdmin
      .from("program_cars")
      .select("*")
      .eq("id", row.link_id)
      .maybeSingle();
    const { data, error } = await supabaseAdmin
      .from("program_cars")
      .update({
        exited_date: today,
        exit_reason: preview.reason ?? null,
        exited_by: actorUuid(actor),
      })
      .eq("id", row.link_id)
      .eq("program_id", program.id)
      .is("exited_date", null)
      .select("id, railcar_id, exited_date, exit_reason")
      .maybeSingle();
    if (error) throw error;
    if (!data) continue;
    await logProgramActivity({
      program_id: program.id,
      action: "car_removed",
      actor,
      program_car_id: data.id,
      railcar_id: data.railcar_id,
      detail: { exited_date: today, reason: preview.reason ?? null },
      before: pickRow(prior, ["exited_date", "exit_reason"]),
      after: pickRow(data, ["exited_date", "exit_reason"]),
    });
    await syncProgramCommitment(data.railcar_id, actor);
    updated += 1;
  }
  await supabaseAdmin.from("programs").update({ updated_at: new Date().toISOString() }).eq("id", program.id);
  return { preview, updated };
  });
}

export async function previewPatchProgramCars(
  programId: number,
  body: { link_ids: number[]; updates: Record<string, unknown> },
) {
  const program = await loadProgramRow(programId);
  assertWritable(program, "patch cars");
  const ids = [...new Set((body.link_ids ?? []).map(Number).filter((n) => n > 0))];
  const { data: links, error } = await supabaseAdmin
    .from("program_cars")
    .select("id, railcar_id, exited_date, railcar:railcars(id, active, reporting_marks, car_number)")
    .eq("program_id", programId)
    .in("id", ids.length ? ids : [0]);
  if (error) throw error;
  const writable = [];
  const readonly_inactive = [];
  for (const l of links ?? []) {
    const rc = Array.isArray((l as any).railcar) ? (l as any).railcar[0] : (l as any).railcar;
    const row = { link_id: l.id, railcar_id: l.railcar_id, label: rc ? formatCarId(rc) : String(l.railcar_id) };
    if (rc?.active === true && !l.exited_date) writable.push(row);
    else readonly_inactive.push(row);
  }
  const snapshot = {
    action: "patch_cars",
    program_id: programId,
    updates: body.updates ?? {},
    writable,
    readonly_inactive,
  };
  return { preview_token: await putPreview("program", snapshot), ...snapshot };
}

function patchColumns(updates: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (updates.milestone !== undefined) out.milestone = updates.milestone === "" ? null : String(updates.milestone);
  if (updates.milestone_at !== undefined) {
    const d = String(updates.milestone_at ?? "").slice(0, 10);
    out.milestone_at = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  }
  if (updates.status !== undefined) out.status = updates.status === "" ? null : String(updates.status);
  if (updates.notes !== undefined) out.notes = updates.notes === "" ? null : updates.notes;
  if (updates.shop_id !== undefined) out.shop_id = updates.shop_id == null || updates.shop_id === "" ? null : Number(updates.shop_id);
  if (updates.scrap_yard_id !== undefined) {
    out.scrap_yard_id = updates.scrap_yard_id == null || updates.scrap_yard_id === "" ? null : Number(updates.scrap_yard_id);
  }
  if (updates.outcome_reached === true || updates.outcome_reached === "true") {
    out.outcome_reached_at = todayIso();
  }
  if (updates.outcome_reached === false || updates.outcome_reached === "false") {
    out.outcome_reached_at = null;
  }
  return out;
}

function commitmentPatch(updates: Record<string, unknown>): { type: CommitmentType; name: string } | null {
  const raw = updates.commitment;
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const type = String(c.type ?? "");
  const name = String(c.name ?? "").trim();
  if (!(COMMITMENT_TYPES as readonly string[]).includes(type) || !name) return null;
  return { type: type as CommitmentType, name };
}

export async function applyPatchProgramCars(token: string, actor: string) {
  return withChangeGroupResult(actor, async () => {
  const preview = await getPreview("program", token);
  if (preview.action !== "patch_cars") throw Object.assign(new Error("Wrong preview kind"), { status: 400 });
  const program = await loadProgramRow(Number(preview.program_id));
  assertWritable(program, "patch cars");
  const cols = patchColumns(preview.updates ?? {});
  const commitment = commitmentPatch(preview.updates ?? {});
  let updated = 0;
  let commitments_written = 0;
  for (const row of preview.writable ?? []) {
    const { data: car } = await supabaseAdmin.from("railcars").select("id, active").eq("id", row.railcar_id).maybeSingle();
    if (car?.active !== true) continue;
    if (!Object.keys(cols).length && !commitment) continue;
    let wrote = false;
    if (Object.keys(cols).length) {
      const { data: prior, error: priorErr } = await supabaseAdmin
        .from("program_cars")
        .select("*")
        .eq("id", row.link_id)
        .maybeSingle();
      if (priorErr) throw priorErr;
      const { data, error } = await supabaseAdmin
        .from("program_cars")
        .update(cols)
        .eq("id", row.link_id)
        .eq("program_id", program.id)
        .select("*")
        .single();
      if (error) throw error;
      const keys = Object.keys(cols);
      await logProgramActivity({
        program_id: program.id,
        action: "car_patched",
        actor,
        program_car_id: row.link_id,
        railcar_id: row.railcar_id,
        detail: cols,
        before: pickRow(prior, keys),
        after: pickRow(data, keys),
      });
      wrote = true;
    }
    if (commitment) {
      await upsertOpenCommitment(
        Number(row.railcar_id),
        { type: commitment.type, name: commitment.name, program_id: program.id },
        actor,
      );
      await logProgramActivity({
        program_id: program.id,
        action: "commitment_set",
        actor,
        program_car_id: row.link_id,
        railcar_id: row.railcar_id,
        detail: { type: commitment.type, name: commitment.name },
        before: {},
        after: { type: commitment.type, name: commitment.name },
      });
      commitments_written += 1;
      wrote = true;
    }
    if (wrote) updated += 1;
  }
  await supabaseAdmin.from("programs").update({ updated_at: new Date().toISOString() }).eq("id", program.id);
  return { preview, updated, commitments_written };
  });
}

export async function previewCloseProgram(programId: number) {
  const program = await loadProgramRow(programId);
  if (program.overlay_lifecycle !== "active") {
    throw Object.assign(new Error("Only active programs can be closed"), { status: 400 });
  }
  const { data: links } = await supabaseAdmin
    .from("program_cars")
    .select("id, railcar_id, railcar:railcars(id, reporting_marks, car_number, active)")
    .eq("program_id", programId)
    .is("exited_date", null);
  const remainingActive = (links ?? [])
    .map((l: any) => {
      const rc = Array.isArray(l.railcar) ? l.railcar[0] : l.railcar;
      return { link_id: l.id, railcar_id: l.railcar_id, label: rc ? formatCarId(rc) : String(l.railcar_id), active: rc?.active === true };
    })
    .filter((r) => r.active);
  const { data: commits } = await supabaseAdmin
    .from("car_commitments")
    .select("id, railcar_id, type, name")
    .eq("program_id", programId)
    .is("cleared_at", null);
  const releaseIds = (commits ?? []).map((c: any) => Number(c.railcar_id));
  const kpi_delta = await annotateKpiDelta(releaseIds, { kind: "commitment", action: "clear" });
  const snapshot = {
    action: "close",
    program_id: programId,
    remaining_active: remainingActive,
    commitments_released: commits ?? [],
    links_kept: true,
    kpi_delta,
  };
  return { preview_token: await putPreview("program", snapshot), ...snapshot };
}

export async function applyCloseProgram(token: string, actor: string) {
  return withChangeGroupResult(actor, async () => {
  const preview = await getPreview("program", token);
  if (preview.action !== "close") throw Object.assign(new Error("Wrong preview kind"), { status: 400 });
  const program = await loadProgramRow(Number(preview.program_id));
  if (program.overlay_lifecycle !== "active") {
    throw Object.assign(new Error("Program is no longer active"), { status: 400 });
  }
  const today = todayIso();
  const { error } = await supabaseAdmin
    .from("programs")
    .update({
      closed_date: today,
      lifecycle: "closed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", program.id);
  if (error) throw error;
  await recordChange({
    table: "programs",
    pk: Number(program.id),
    before: pickRow(program, ["lifecycle", "closed_date"]),
    after: { lifecycle: "closed", closed_date: today },
    action: "closed",
    entity_type: "program",
    entity_id: Number(program.id),
    actor,
  });
  const { data: commits } = await supabaseAdmin
    .from("car_commitments")
    .select("id, railcar_id, cleared_at, cleared_by")
    .eq("program_id", program.id)
    .is("cleared_at", null);
  const commitmentIds: number[] = [];
  for (const c of commits ?? []) {
    const cleared_at = new Date().toISOString();
    await supabaseAdmin
      .from("car_commitments")
      .update({ cleared_at, cleared_by: actor })
      .eq("id", c.id);
    commitmentIds.push(Number(c.id));
    await recordChange({
      table: "car_commitments",
      pk: Number(c.id),
      before: pickRow(c, ["cleared_at", "cleared_by"]),
      after: { cleared_at, cleared_by: actor },
      action: "commitment_clear",
      entity_type: "railcar",
      entity_id: Number(c.railcar_id),
      railcar_id: Number(c.railcar_id),
      actor,
    });
    await syncProgramCommitment(c.railcar_id, actor);
  }
  await logProgramActivity({
    program_id: program.id,
    action: "closed",
    actor,
    detail: {
      closed_date: today,
      commitments_released: commits?.length ?? 0,
      commitment_ids: commitmentIds,
      links_kept: true,
    },
    before: pickRow(program, ["lifecycle", "closed_date"]),
    after: { lifecycle: "closed", closed_date: today },
  });
  return { preview, closed: true, commitments_released: commits?.length ?? 0 };
  });
}

export async function previewActivateProgram(programId: number) {
  const program = await loadProgramRow(programId);
  if (program.overlay_lifecycle !== "draft" && program.overlay_lifecycle !== "closed") {
    throw Object.assign(new Error("Activate/reopen is for draft or closed programs"), { status: 400 });
  }
  const { data: links } = await supabaseAdmin
    .from("program_cars")
    .select("railcar_id")
    .eq("program_id", programId)
    .is("exited_date", null);
  const ids = (links ?? []).map((l: any) => Number(l.railcar_id));
  const flags = await kpiFlags(ids);
  const willCreate = ids.filter((id) => {
    const k = flags.get(id);
    return k?.active === true && shouldCreateProgramCommitment(k);
  });
  const kpi_delta = await annotateKpiDelta(willCreate, { kind: "commitment", action: "set" });
  const snapshot = {
    action: program.overlay_lifecycle === "closed" ? "reopen" : "activate",
    program_id: programId,
    commitment_ids: willCreate,
    kpi_delta,
  };
  return { preview_token: await putPreview("program", snapshot), ...snapshot };
}

export async function applyActivateProgram(token: string, actor: string) {
  return withChangeGroupResult(actor, async () => {
  const preview = await getPreview("program", token);
  if (preview.action !== "activate" && preview.action !== "reopen") {
    throw Object.assign(new Error("Wrong preview kind"), { status: 400 });
  }
  const program = await loadProgramRow(Number(preview.program_id));
  const after = {
    lifecycle: "active",
    closed_date: null,
    cancelled_at: null,
    cancelled_by: null,
  };
  const { error } = await supabaseAdmin
    .from("programs")
    .update({
      ...after,
      updated_at: new Date().toISOString(),
    })
    .eq("id", program.id);
  if (error) throw error;
  await recordChange({
    table: "programs",
    pk: Number(program.id),
    before: pickRow(program, ["lifecycle", "closed_date", "cancelled_at", "cancelled_by"]),
    after,
    action: preview.action,
    entity_type: "program",
    entity_id: Number(program.id),
    actor,
  });
  let created = 0;
  const commitmentIds: number[] = [];
  for (const id of preview.commitment_ids ?? []) {
    const r = await syncProgramCommitment(Number(id), actor);
    if ((r as any).created) {
      created += 1;
      commitmentIds.push(Number(id));
    } else if ((r as any).repointed) {
      commitmentIds.push(Number(id));
    }
  }
  await logProgramActivity({
    program_id: program.id,
    action: preview.action,
    actor,
    detail: { commitments_created: created, commitment_ids: commitmentIds },
    before: pickRow(program, ["lifecycle", "closed_date", "cancelled_at", "cancelled_by"]),
    after,
  });
  return { preview, lifecycle: "active", commitments_created: created };
  });
}

export async function previewCancelProgram(programId: number) {
  const program = await loadProgramRow(programId);
  if (program.overlay_lifecycle !== "draft") {
    throw Object.assign(new Error("Cancel is draft-only"), { status: 400 });
  }
  const snapshot = { action: "cancel", program_id: programId, name: program.name };
  return { preview_token: await putPreview("program", snapshot), ...snapshot };
}

export async function applyCancelProgram(token: string, actor: string) {
  return withChangeGroupResult(actor, async () => {
  const preview = await getPreview("program", token);
  if (preview.action !== "cancel") throw Object.assign(new Error("Wrong preview kind"), { status: 400 });
  const program = await loadProgramRow(Number(preview.program_id));
  if (program.overlay_lifecycle !== "draft") {
    throw Object.assign(new Error("Cancel is draft-only"), { status: 400 });
  }
  const after = {
    lifecycle: "cancelled",
    cancelled_at: new Date().toISOString(),
    cancelled_by: actorUuid(actor),
  };
  const { error } = await supabaseAdmin
    .from("programs")
    .update({
      ...after,
      updated_at: new Date().toISOString(),
    })
    .eq("id", program.id);
  if (error) throw error;
  await recordChange({
    table: "programs",
    pk: Number(program.id),
    before: pickRow(program, ["lifecycle", "cancelled_at", "cancelled_by"]),
    after,
    action: "cancelled",
    entity_type: "program",
    entity_id: Number(program.id),
    actor,
  });
  await logProgramActivity({
    program_id: program.id,
    action: "cancelled",
    actor,
    before: pickRow(program, ["lifecycle", "cancelled_at", "cancelled_by"]),
    after,
  });
  return { preview, cancelled: true };
  });
}

export async function previewCommitmentBackfill() {
  const { data, error } = await supabaseAdmin.from("v_program_commitment_backfill").select("*");
  if (error) throw error;
  const rows = data ?? [];
  const needs = rows.filter((r: any) => r.needs_commitment);
  const multi = rows.filter((r: any) => r.in_multiple_programs);
  const kpi_delta = await annotateKpiDelta(
    needs.map((r: any) => Number(r.railcar_id)),
    { kind: "commitment", action: "set" },
  );
  const snapshot = {
    action: "backfill",
    rows,
    needs_commitment: needs.length,
    in_multiple_programs: multi.length,
    kpi_delta,
  };
  return { preview_token: await putPreview("program", snapshot), ...snapshot };
}

export async function applyCommitmentBackfill(token: string, actor: string) {
  return withChangeGroupResult(actor, async () => {
  const preview = await getPreview("program", token);
  if (preview.action !== "backfill") throw Object.assign(new Error("Wrong preview kind"), { status: 400 });
  let created = 0;
  for (const row of preview.rows ?? []) {
    if (!row.needs_commitment) continue;
    const railcarId = Number(row.railcar_id);
    const r = await syncProgramCommitment(railcarId, actor);
    if ((r as any).created) created += 1;
    if ((r as any).created || (r as any).repointed || (r as any).cleared) {
      await recordChange({
        table: "railcars",
        pk: railcarId,
        before: {},
        after: r as Record<string, unknown>,
        action: "commitment_backfill",
        entity_type: "railcar",
        entity_id: railcarId,
        railcar_id: railcarId,
        actor,
        force: true,
      });
    }
  }
  return { preview, created };
  });
}

export async function createProgramV2(
  body: Record<string, unknown>,
  actor: string,
): Promise<{ program: any; add_preview?: any; change_group: string }> {
  return withChangeGroupResult(actor, async () => {
  const name = String(body.name ?? body.title ?? "").trim();
  if (!name) throw Object.assign(new Error("Title is required"), { status: 400 });
  const draft = body.as_draft === true || body.lifecycle === "draft";
  const typeRaw = body.type != null && body.type !== "" ? String(body.type) : null;
  if (typeRaw && !isProgramType(typeRaw)) throw Object.assign(new Error("Invalid type"), { status: 400 });
  const target = String(body.target_completion_date ?? "").slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("programs")
    .insert({
      name,
      description: body.description || null,
      status: "open",
      lifecycle: draft ? "draft" : "active",
      type: typeRaw,
      type_other: typeRaw === "Other" ? String(body.type_other ?? "").trim() || null : null,
      category_id: body.category_id ? Number(body.category_id) : null,
      entity: body.entity || null,
      account_manager: body.account_manager || null,
      account_id: body.account_id ? Number(body.account_id) : null,
      target_completion_date: /^\d{4}-\d{2}-\d{2}$/.test(target) ? target : null,
      created_by: actorUuid(actor),
    })
    .select()
    .single();
  if (error) throw error;
  await recordChange({
    table: "programs",
    pk: Number(data.id),
    before: {},
    after: data,
    action: "created",
    entity_type: "program",
    entity_id: Number(data.id),
    actor,
  });
  await logProgramActivity({
    program_id: data.id,
    action: "created",
    actor,
    detail: { name, lifecycle: data.lifecycle },
    before: {},
    after: { id: data.id, name, lifecycle: data.lifecycle },
  });
  let add_preview;
  const ids = Array.isArray(body.railcar_ids) ? body.railcar_ids : [];
  const text = String(body.cars_text ?? "");
  if (ids.length || text.trim()) {
    add_preview = await previewAddProgramCars(data.id, { railcar_ids: ids, text });
  }
  return { program: data, add_preview };
  });
}

export type { ProgramType };
