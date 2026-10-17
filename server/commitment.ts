import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { supabaseAdmin } from "./supabase";
import {
  COMMITMENT_TYPES,
  carNumberLookupValues,
  derivedFleetStatus,
  implicitAwaitingLabel,
  isOffRentLink,
  isOnOl,
  isOnRentOlRider,
  parseCarListText,
  shouldCreateProgramCommitment,
  xLesseeName,
  type CommitmentType,
} from "@shared/commitment";
import { fetchAllRows } from "./fetch-all";
import { logActivity } from "./activity-log";
import { annotateKpiDelta } from "./kpi-delta";
import { formatCarId } from "@shared/residco-import";

const RECOMPUTE_STATUS = process.env.RLMS_RECOMPUTE_FLEET_STATUS === "1";
const PREVIEW_TTL_MS = 30 * 60 * 1000;
export type PreviewKind = "commitment" | "return" | "sold" | "rent_start" | "unsold" | "classify" | "buyer" | "program";
const previewStore = new Map<string, { kind: PreviewKind; expires: number; snapshot: any }>();

export async function purgeExpiredPreviews() {
  const now = Date.now();
  for (const [token, row] of Array.from(previewStore.entries())) {
    if (row.expires < now) previewStore.delete(token);
  }
  const { error } = await supabaseAdmin.from("rlms_preview_tokens").delete().lt("expires_at", new Date().toISOString());
  if (error) console.warn("[preview] expire cleanup skipped:", error.message);
}

export async function putPreview(kind: PreviewKind, snapshot: unknown): Promise<string> {
  await purgeExpiredPreviews();
  const token = randomUUID();
  const expires = Date.now() + PREVIEW_TTL_MS;
  previewStore.set(token, { kind, expires, snapshot });
  const { error } = await supabaseAdmin.from("rlms_preview_tokens").insert({
    token,
    kind,
    snapshot,
    expires_at: new Date(expires).toISOString(),
  });
  if (error) console.warn("[preview] table persist skipped:", error.message);
  return token;
}

export async function getPreview(kind: PreviewKind, token: string): Promise<any> {
  await purgeExpiredPreviews();
  const mem = previewStore.get(String(token ?? ""));
  if (mem && mem.kind === kind && mem.expires >= Date.now()) return mem.snapshot;
  const { data, error } = await supabaseAdmin
    .from("rlms_preview_tokens")
    .select("kind, snapshot, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (error || !data || data.kind !== kind || new Date(data.expires_at).getTime() < Date.now()) {
    throw Object.assign(new Error("Preview expired or missing. Run preview again."), { status: 400 });
  }
  previewStore.set(token, { kind, expires: new Date(data.expires_at).getTime(), snapshot: data.snapshot });
  return data.snapshot;
}

const CAR_SEL =
  "id, reporting_marks, car_initial, car_number, entity, active, fleet_status, lessee_name, assignment_label, rider_external_id";

function isCommitmentType(v: unknown): v is CommitmentType {
  return COMMITMENT_TYPES.includes(String(v) as CommitmentType);
}

async function latestAssignment(railcarId: number) {
  const { data, error } = await supabaseAdmin
    .from("railcar_assignments")
    .select("id, rider_id, fleet_name, rent_start_date, assigned_at, rider:riders(id, rider_name, lease_status, expiration_date)")
    .eq("railcar_id", railcarId)
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw error;
  const a = (data ?? [])[0] ?? null;
  const rider = Array.isArray((a as any)?.rider) ? (a as any).rider[0] : (a as any)?.rider;
  return { assignment: a, rider };
}

async function linkForCar(railcarId: number) {
  return latestAssignment(railcarId);
}

let enforcedCache: { value: boolean; at: number } | null = null;

export async function rentStartEnforced(): Promise<boolean> {
  if (enforcedCache && Date.now() - enforcedCache.at < 30_000) return enforcedCache.value;
  const { data, error } = await supabaseAdmin
    .from("rlms_app_settings")
    .select("value")
    .eq("key", "rent_start_enforced")
    .maybeSingle();
  const value = error
    ? false
    : ["true", "1", "t", "yes"].includes(String(data?.value ?? "false").trim().toLowerCase());
  enforcedCache = { value, at: Date.now() };
  return value;
}

function linkInput(car: any, riderName: string | null | undefined, assignment: any, enforced?: boolean) {
  return {
    hasAssignment: Boolean(assignment),
    rider: riderName,
    lesseeName: car?.lessee_name,
    assignmentLabel: car?.assignment_label,
    rentStartDate: assignment?.rent_start_date ?? null,
    fleetStatus: car?.fleet_status ?? null,
    rentStartEnforced: enforced,
  };
}

async function offRentOf(car: any, riderName: string | null | undefined, assignment: any) {
  return isOffRentLink(linkInput(car, riderName, assignment, await rentStartEnforced()));
}

export async function recomputeStatus(railcarId: number) {
  if (!RECOMPUTE_STATUS) return null;
  const { data, error } = await supabaseAdmin.rpc("rlms_recompute_fleet_status", {
    p_railcar_id: railcarId,
  });
  if (error) throw error;
  return data as string | null;
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

export async function setCommitment(
  railcarId: number,
  body: {
    type: CommitmentType;
    name: string;
    program_id?: number | null;
    target_date?: string | null;
    note?: string | null;
  },
  actor: string,
  opts?: { overwrite?: boolean },
) {
  const { data: car, error: cErr } = await supabaseAdmin.from("railcars").select(CAR_SEL).eq("id", railcarId).maybeSingle();
  if (cErr) throw cErr;
  if (!car) throw Object.assign(new Error("Car not found"), { status: 404 });
  if (car.active !== true) throw Object.assign(new Error("rejected: inactive"), { status: 400, code: "inactive" });
  const { rider, assignment } = await linkForCar(railcarId);
  const off = await offRentOf(car, rider?.rider_name, assignment);
  if (!off) throw Object.assign(new Error("On-rent cars cannot take a Commitment"), { status: 400, code: "on_rent" });

  const existing = await openCommitment(railcarId);
  if (existing && !opts?.overwrite) {
    throw Object.assign(new Error("Car already has an open Commitment"), {
      status: 409,
      code: "already_committed",
      existing,
    });
  }
  if (existing && opts?.overwrite) {
    const { error } = await supabaseAdmin
      .from("car_commitments")
      .update({ cleared_at: new Date().toISOString(), cleared_by: actor })
      .eq("id", existing.id);
    if (error) throw error;
  }
  const { data, error } = await supabaseAdmin
    .from("car_commitments")
    .insert({
      railcar_id: railcarId,
      type: body.type,
      name: body.name.trim(),
      program_id: body.program_id ?? null,
      target_date: body.target_date || null,
      note: body.note ?? null,
      set_by: actor,
    })
    .select()
    .single();
  if (error) throw error;
  await recomputeStatus(railcarId);
  return data;
}

export async function clearCommitment(railcarId: number, actor: string) {
  const existing = await openCommitment(railcarId);
  if (!existing) return null;
  const { data, error } = await supabaseAdmin
    .from("car_commitments")
    .update({ cleared_at: new Date().toISOString(), cleared_by: actor })
    .eq("id", existing.id)
    .select()
    .single();
  if (error) throw error;
  await recomputeStatus(railcarId);
  return data;
}

export async function ensureProgramCommitment(railcarId: number, program: { id: number; name: string; target_completion_date?: string | null }, actor: string) {
  const { data: car } = await supabaseAdmin.from("railcars").select(CAR_SEL).eq("id", railcarId).maybeSingle();
  if (!car || car.active !== true) return { skipped: "inactive" as const };
  const { data: kpi } = await supabaseAdmin
    .from("v_rlms_kpi_car_rows")
    .select("railcar_id, active, is_op, off_rent")
    .eq("railcar_id", railcarId)
    .maybeSingle();
  if (!shouldCreateProgramCommitment(kpi ?? { active: car.active, is_op: false, off_rent: false })) {
    return { skipped: "not_off_rent_op" as const };
  }
  const existing = await openCommitment(railcarId);
  if (existing) return { skipped: "already_committed" as const, existing };
  await setCommitment(
    railcarId,
    { type: "program", name: program.name, program_id: program.id, target_date: program.target_completion_date ?? null },
    actor,
    { overwrite: false },
  );
  return { created: true as const };
}

async function matchCarsFromText(text: string) {
  const tokens = parseCarListText(text);
  const matched: any[] = [];
  const notFound: { raw: string }[] = [];
  for (const t of tokens) {
    if (!t.initial || !t.number) {
      notFound.push({ raw: t.raw });
      continue;
    }
    const nums = carNumberLookupValues(t.number);
    const { data, error } = await supabaseAdmin
      .from("railcars")
      .select(CAR_SEL)
      .in("car_number", nums)
      .limit(20);
    if (error) throw error;
    const hits = (data ?? []).filter((c: any) => {
      const rm = String(c.reporting_marks ?? c.car_initial ?? "").trim().toUpperCase();
      return rm === t.initial;
    });
    if (hits.length === 1) matched.push({ ...hits[0], raw: t.raw });
    else if (hits.length === 0) notFound.push({ raw: `${t.initial} ${t.number}` });
    else notFound.push({ raw: `${t.initial} ${t.number} (ambiguous)` });
  }
  const inactive = matched.filter((c) => c.active !== true);
  return {
    tokens,
    matched: matched.filter((c) => c.active === true),
    notFound,
    inactive,
  };
}

export async function matchCarsFromIds(idsRaw: number[]) {
  const ids = Array.from(new Set(idsRaw.filter((n) => Number.isFinite(n) && n > 0)));
  if (!ids.length) return { matched: [] as any[], notFound: [] as { raw: string }[], inactive: [] as any[] };
  const { data, error } = await supabaseAdmin.from("railcars").select(CAR_SEL).in("id", ids);
  if (error) throw error;
  const found = new Set((data ?? []).map((r: any) => r.id));
  const notFound = ids.filter((id) => !found.has(id)).map((id) => ({ raw: String(id) }));
  const inactive = (data ?? []).filter((c: any) => c.active !== true);
  const matched = (data ?? []).filter((c: any) => c.active === true);
  return { matched, notFound, inactive };
}

async function classifyMatched(cars: any[]) {
  const ids = cars.map((c) => c.id);
  const { data: assigns } = ids.length
    ? await supabaseAdmin
        .from("railcar_assignments")
        .select("id, railcar_id, rider_id, fleet_name, rent_start_date, assigned_at, rider:riders(id, rider_name, lease_status)")
        .in("railcar_id", ids)
        .order("id", { ascending: false })
    : { data: [] as any[] };
  const { data: commits } = ids.length
    ? await supabaseAdmin.from("car_commitments").select("*").in("railcar_id", ids).is("cleared_at", null)
    : { data: [] as any[] };
  const aBy = new Map<number, any>();
  for (const a of assigns ?? []) {
    if (!aBy.has(a.railcar_id)) aBy.set(a.railcar_id, a);
  }
  const cBy = new Map<number, any>();
  for (const c of commits ?? []) cBy.set(c.railcar_id, c);
  const enforced = await rentStartEnforced();
  return cars.map((car) => {
    const a = aBy.get(car.id);
    const rider = Array.isArray(a?.rider) ? a.rider[0] : a?.rider;
    const off = isOffRentLink(linkInput(car, rider?.rider_name, a, enforced));
    return {
      car,
      rider,
      assignment: a,
      off_rent: off,
      on_rent: !off,
      commitment: cBy.get(car.id) ?? null,
    };
  });
}

export async function previewBulkCommitment(
  text: string,
  body: {
    action: "set" | "clear";
    type?: CommitmentType;
    name?: string;
    program_id?: number | null;
    target_date?: string | null;
    note?: string | null;
    overwrite?: boolean;
    ids?: number[];
    bucket?: string | null;
  },
) {
  const { matched, notFound, inactive } = Array.isArray(body.ids) && body.ids.length
    ? await matchCarsFromIds(body.ids)
    : await matchCarsFromText(text);
  const rows = await classifyMatched(matched);
  const snapshot = {
    action: body.action,
    type: body.type ?? null,
    name: body.name ?? null,
    program_id: body.program_id ?? null,
    target_date: body.target_date ?? null,
    note: body.note ?? null,
    overwrite: Boolean(body.overwrite),
    matched: rows.filter((r) => r.off_rent).map((r) => ({
      id: r.car.id,
      marks: r.car.reporting_marks,
      car_number: r.car.car_number,
      entity: r.car.entity,
      link: r.rider?.rider_name ?? null,
      commitment: r.commitment,
    })),
    already_committed: rows.filter((r) => r.off_rent && r.commitment).map((r) => ({
      id: r.car.id,
      marks: r.car.reporting_marks,
      car_number: r.car.car_number,
      commitment: r.commitment,
    })),
    on_rent: rows.filter((r) => r.on_rent).map((r) => ({
      id: r.car.id,
      marks: r.car.reporting_marks,
      car_number: r.car.car_number,
      link: r.rider?.rider_name ?? null,
      rejected: true,
    })),
    not_found: notFound,
    rejected_inactive: (inactive ?? []).map((r: any) => ({
      id: r.id,
      marks: r.reporting_marks,
      car_number: r.car_number,
      rejected: "inactive",
    })),
  };
  const writeIds =
    body.action === "clear"
      ? snapshot.matched.map((m) => m.id)
      : snapshot.matched.filter((m) => !m.commitment || snapshot.overwrite).map((m) => m.id);
  (snapshot as any).kpi_delta = await annotateKpiDelta(
    writeIds,
    { kind: "commitment", action: body.action },
    body.bucket,
  );
  const preview_token = await putPreview("commitment", snapshot);
  return { preview_token, ...snapshot };
}

export async function applyBulkCommitment(previewToken: string, actor: string) {
  const preview = await getPreview("commitment", previewToken);
  if (preview.action === "clear") {
    const ids = (preview.matched ?? []).map((m: any) => m.id);
    const cleared = [];
    for (const id of ids) {
      const row = await clearCommitment(id, actor);
      if (row) cleared.push(row);
    }
    return { preview, cleared: cleared.length };
  }
  if (!preview.type || !String(preview.name ?? "").trim()) {
    throw Object.assign(new Error("type and name required"), { status: 400 });
  }
  const eligible = (preview.matched ?? []).filter((m: any) => !m.commitment || preview.overwrite);
  const skipped = (preview.matched ?? []).filter((m: any) => m.commitment && !preview.overwrite);
  const set = [];
  for (const m of eligible) {
    const row = await setCommitment(
      m.id,
      {
        type: preview.type,
        name: preview.name,
        program_id: preview.program_id,
        target_date: preview.target_date,
        note: preview.note,
      },
      actor,
      { overwrite: true },
    );
    set.push(row);
  }
  return { preview, set: set.length, skipped: skipped.length, rejected_on_rent: (preview.on_rent ?? []).length };
}

function eaNameFromOl(ol: string | null | undefined): string | null {
  const s = String(ol ?? "").trim();
  const m = /^OL(\d+)/i.exec(s);
  if (!m) return null;
  return `EA${m[1]}`;
}

export async function previewBulkReturn(
  text: string,
  opts: {
    ea_rider_id?: number | null;
    commitment?: {
      type: CommitmentType;
      name: string;
      target_date?: string | null;
      note?: string | null;
      overwrite?: boolean;
    } | null;
  },
) {
  const { matched, notFound, inactive } = await matchCarsFromText(text);
  const rows = await classifyMatched(matched);
  let ea: any = null;
  if (opts.ea_rider_id) {
    const { data, error } = await supabaseAdmin
      .from("riders")
      .select("id, rider_name, master_lease_id")
      .eq("id", opts.ea_rider_id)
      .limit(1);
    if (error) throw error;
    ea = (data ?? [])[0] ?? null;
  }
  const suggested = [];
  for (const r of rows) {
    const from = r.rider?.rider_name ?? r.car.rider_external_id ?? null;
    const sold = r.car.fleet_status === "Sold";
    const onOl = isOnRentOlRider(from);
    const want = ea?.rider_name ?? eaNameFromOl(from);
    let dest = ea;
    if (!dest && want) {
      const { data, error } = await supabaseAdmin
        .from("riders")
        .select("id, rider_name, master_lease_id")
        .ilike("rider_name", want)
        .limit(1);
      if (error) throw error;
      dest = (data ?? [])[0] ?? null;
    }
    const reject = sold
      ? "sold"
      : !onOl
        ? "not_on_ol"
        : r.off_rent
          ? "already_off_rent"
          : !dest
            ? "missing_ea"
            : null;
    suggested.push({
      id: r.car.id,
      marks: r.car.reporting_marks,
      car_number: r.car.car_number,
      entity: r.car.entity,
      from_link: from,
      from_lessee: r.car.lessee_name,
      to_link: dest?.rider_name ?? want,
      to_rider_id: dest?.id ?? null,
      to_label: xLesseeName(r.car.lessee_name),
      resulting_status: r.commitment || opts.commitment ? "Idle" : "Unassigned",
      missing_ea: !dest,
      already_off_rent: r.off_rent,
      eligible: !reject,
      reject,
    });
  }
  const snapshot = {
    commitment: opts.commitment ?? null,
    not_found: notFound,
    rejected_inactive: (inactive ?? []).map((r: any) => ({
      id: r.id,
      marks: r.reporting_marks,
      car_number: r.car_number,
      rejected: "inactive",
    })),
    rows: suggested,
    ea_rider: ea,
    eligible_ids: suggested.filter((s) => s.eligible).map((s) => s.id),
  };
  const preview_token = await putPreview("return", snapshot);
  return { preview_token, ...snapshot };
}

export async function applyBulkReturn(previewToken: string, actor: string) {
  const preview = await getPreview("return", previewToken);
  const moved = [];
  const failed = [];
  for (const row of preview.rows ?? []) {
    if (!row.eligible) continue;
    if (!row.to_rider_id) {
      failed.push({ ...row, error: "EA rider not found" });
      continue;
    }
    const { assignment: prev, error: aErr } = await (async () => {
      const { data, error } = await supabaseAdmin
        .from("railcar_assignments")
        .select("id, rider_id, fleet_name")
        .eq("railcar_id", row.id)
        .order("id", { ascending: false })
        .limit(1);
      return { assignment: (data ?? [])[0] ?? null, error };
    })();
    if (aErr) {
      failed.push({ ...row, error: aErr.message });
      continue;
    }
    const targetFleet = row.to_label;
    if (prev) {
      const { error } = await supabaseAdmin
        .from("railcar_assignments")
        .update({
          rider_id: row.to_rider_id,
          fleet_name: targetFleet,
          assigned_at: new Date().toISOString(),
          rent_start_date: null,
          rent_start_set_by: null,
          rent_start_set_at: null,
        })
        .eq("id", prev.id);
      if (error) {
        failed.push({ ...row, error: error.message });
        continue;
      }
    } else {
      const { error } = await supabaseAdmin.from("railcar_assignments").insert({
        railcar_id: row.id,
        rider_id: row.to_rider_id,
        fleet_name: targetFleet,
        assigned_at: new Date().toISOString(),
        rent_start_date: null,
      });
      if (error) {
        failed.push({ ...row, error: error.message });
        continue;
      }
    }
    const { error: hErr } = await supabaseAdmin.from("assignment_history").insert({
      railcar_id: row.id,
      from_rider_id: prev?.rider_id ?? null,
      to_rider_id: row.to_rider_id,
      from_fleet_name: prev?.fleet_name ?? null,
      to_fleet_name: targetFleet,
      moved_at: new Date().toISOString(),
      moved_by: actor,
      reason: "Bulk return OL → EA",
    });
    if (hErr) {
      failed.push({ ...row, error: `assignment_history: ${hErr.message}` });
      continue;
    }
    const { error: uErr } = await supabaseAdmin
      .from("railcars")
      .update({
        rider_external_id: row.to_link,
        assignment_label: targetFleet,
        lessee_name: row.to_label,
      })
      .eq("id", row.id);
    if (uErr) {
      failed.push({ ...row, error: uErr.message });
      continue;
    }
    if (preview.commitment) {
      try {
        await setCommitment(row.id, preview.commitment, actor, { overwrite: Boolean(preview.commitment.overwrite) });
      } catch (e: any) {
        failed.push({ ...row, error: e.message });
        continue;
      }
    } else {
      await recomputeStatus(row.id);
    }
    moved.push(row.id);
  }
  return { preview, moved: moved.length, failed };
}

export async function listStale() {
  const { data: commits, error } = await supabaseAdmin
    .from("car_commitments")
    .select(
      "*, railcar:railcars(id, reporting_marks, car_number, entity, fleet_status, lessee_name, rider_external_id)",
    )
    .is("cleared_at", null)
    .order("set_at", { ascending: true });
  if (error) throw error;
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  const items = (commits ?? []).filter((c: any) => {
    if (!c.target_date) return true;
    if (String(c.target_date).slice(0, 10) < today) return true;
    if (c.set_at && c.set_at < cutoff) return true;
    return false;
  }).map((c: any) => ({
    kind: "commitment" as const,
    reason: !c.target_date ? "no_date" : String(c.target_date).slice(0, 10) < today ? "past_date" : "older_90",
    ...c,
  }));
  const { data: programs, error: pErr } = await supabaseAdmin
    .from("programs")
    .select("id, name, status, target_completion_date, closed_date")
    .is("closed_date", null);
  if (pErr) throw pErr;
  const stalePrograms = (programs ?? [])
    .filter((p: any) => p.target_completion_date && String(p.target_completion_date).slice(0, 10) < today)
    .filter((p: any) => !["closed", "complete", "completed"].includes(String(p.status ?? "").toLowerCase()))
    .map((p: any) => ({ kind: "program" as const, reason: "program_past_end", ...p }));
  return { items, programs: stalePrograms };
}

export async function listWatch() {
  const rows = await fetchAllRows<any>((from, to) =>
    supabaseAdmin
      .from("v_rlms_car_kpi")
      .select(
        "railcar_id, reporting_marks, car_number, entity, link_rider, lessee_name, rider_expiration_date, lease_end_date, lease_status",
      )
      .eq("is_op", true)
      .eq("off_rent", false)
      .eq("no_assignment", false)
      .order("railcar_id", { ascending: true })
      .range(from, to),
  );
  const today = new Date().toISOString().slice(0, 10);
  return (rows ?? []).filter((r) => {
    const st = String(r.lease_status ?? "").toUpperCase();
    if (/\bMTM\b|MONTH\s*TO\s*MONTH/.test(st)) return false;
    const exp = String(r.rider_expiration_date ?? "").slice(0, 10);
    const end = String(r.lease_end_date ?? "").slice(0, 10);
    const past = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < today;
    return past(exp) || past(end);
  }).map((r) => {
    const end = [r.rider_expiration_date, r.lease_end_date]
      .map((d) => String(d ?? "").slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()[0];
    const days = end ? Math.floor((Date.now() - new Date(end + "T00:00:00").getTime()) / 86400000) : null;
    return {
      id: r.railcar_id,
      marks: r.reporting_marks,
      car_number: r.car_number,
      ol: r.link_rider,
      lessee: r.lessee_name,
      end_date: end,
      days_past: days,
    };
  });
}

export async function closeProgram(programId: number, actor: string) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: prog, error: pErr } = await supabaseAdmin.from("programs").select("*").eq("id", programId).maybeSingle();
  if (pErr) throw pErr;
  if (!prog) throw Object.assign(new Error("Program not found"), { status: 404 });
  await supabaseAdmin
    .from("programs")
    .update({ closed_date: today, status: "closed", updated_at: new Date().toISOString() })
    .eq("id", programId);
  const { data: cars } = await supabaseAdmin
    .from("program_cars")
    .select("id, railcar_id")
    .eq("program_id", programId)
    .is("exited_date", null);
  if (cars?.length) {
    await supabaseAdmin
      .from("program_cars")
      .update({ exited_date: today })
      .eq("program_id", programId)
      .is("exited_date", null);
  }
  const { data: commits } = await supabaseAdmin
    .from("car_commitments")
    .select("id, railcar_id")
    .eq("program_id", programId)
    .is("cleared_at", null);
  for (const c of commits ?? []) {
    await supabaseAdmin
      .from("car_commitments")
      .update({ cleared_at: new Date().toISOString(), cleared_by: actor })
      .eq("id", c.id);
    await recomputeStatus(c.railcar_id);
  }
  return { closed: true, cars_exited: cars?.length ?? 0, commitments_cleared: commits?.length ?? 0 };
}

export async function extendCommitment(id: number, target_date: string, note: string | null, actor: string) {
  const { data, error } = await supabaseAdmin
    .from("car_commitments")
    .update({
      target_date,
      note: note ?? undefined,
      set_by: actor,
      set_at: new Date().toISOString(),
    })
    .eq("id", id)
    .is("cleared_at", null)
    .select()
    .single();
  if (error) throw error;
  return data;
}

function errHandler(res: Response, err: any) {
  const status = err?.status || 500;
  res.status(status).json({ message: err?.message ?? String(err), code: err?.code });
}

export async function previewMarkSold(idsRaw: number[], opts?: { sold_to?: string | null; bucket?: string | null }) {
  const ids = Array.from(new Set(idsRaw.filter((n) => Number.isFinite(n) && n > 0)));
  if (!ids.length) throw Object.assign(new Error("ids required"), { status: 400 });
  const { data, error } = await supabaseAdmin
    .from("railcars")
    .select("id, reporting_marks, car_number, entity, fleet_status, active, sold_to")
    .in("id", ids);
  if (error) throw error;
  const found = new Set((data ?? []).map((r: any) => r.id));
  const inactive = (data ?? []).filter((r: any) => r.active !== true);
  const activeCars = (data ?? []).filter((r: any) => r.active === true);
  const { data: rows } = await supabaseAdmin
    .from("v_rlms_kpi_car_rows")
    .select("railcar_id, buyer, current_lease")
    .in("railcar_id", activeCars.map((c: any) => c.id));
  const buyerBy = new Map((rows ?? []).map((r: any) => [r.railcar_id, r]));
  const cars = activeCars.map((c: any) => ({
    ...c,
    proposed_sold_to: opts?.sold_to || c.sold_to || buyerBy.get(c.id)?.buyer || null,
  }));
  const snapshot = {
    ids: cars.map((r: any) => r.id),
    cars,
    not_found: ids.filter((id) => !found.has(id)),
    already_sold: cars.filter((r: any) => r.fleet_status === "Sold"),
    rejected_inactive: inactive.map((r: any) => ({
      id: r.id,
      marks: r.reporting_marks,
      car_number: r.car_number,
      rejected: "inactive",
    })),
  };
  (snapshot as any).kpi_delta = await annotateKpiDelta(
    snapshot.ids,
    {
      kind: "sold",
      buyerById: new Map(cars.map((c: any) => [c.id, c.proposed_sold_to ?? null])),
    },
    opts?.bucket,
  );
  return { preview_token: await putPreview("sold", snapshot), ...snapshot };
}

export async function applyMarkSold(
  previewToken: string,
  actor: string,
  opts: { sold_to?: string | null; effective_date?: string | null },
) {
  const preview = await getPreview("sold", previewToken);
  const movedAt = opts.effective_date
    ? `${String(opts.effective_date).slice(0, 10)}T12:00:00.000Z`
    : new Date().toISOString();
  let updated = 0;
  for (const car of preview.cars ?? []) {
    const id = car.id;
    const soldTo = opts.sold_to ?? car.proposed_sold_to ?? car.sold_to ?? null;
    const patch: Record<string, unknown> = {
      fleet_status: "Sold",
      fleet_status_source: "manual",
    };
    if (soldTo) patch.sold_to = soldTo;
    const { error } = await supabaseAdmin.from("railcars").update(patch).eq("id", id).eq("active", true);
    if (error) throw error;
    const { assignment } = await latestAssignment(id);
    const { error: hErr } = await supabaseAdmin.from("assignment_history").insert({
      railcar_id: id,
      from_rider_id: assignment?.rider_id ?? null,
      to_rider_id: assignment?.rider_id ?? null,
      from_fleet_name: assignment?.fleet_name ?? null,
      to_fleet_name: assignment?.fleet_name ?? null,
      moved_at: movedAt,
      moved_by: actor,
      reason: "Rental status set to Sold",
    });
    if (hErr) throw hErr;
    await logActivity({
      entity_type: "railcar",
      entity_id: id,
      action: "marked_sold",
      actor,
      railcar_id: id,
      detail: { preview_token: previewToken, sold_to: soldTo, active_unchanged: true },
    });
    updated += 1;
  }
  return { preview, updated, fleet_status: "Sold" };
}

export async function previewRemoveSold(idsRaw: number[], bucket?: string | null) {
  const { matched, notFound, inactive } = await matchCarsFromIds(idsRaw);
  const snapshot = {
    ids: matched.filter((c) => c.fleet_status === "Sold").map((c) => c.id),
    cars: matched.filter((c) => c.fleet_status === "Sold"),
    not_sold: matched.filter((c) => c.fleet_status !== "Sold"),
    not_found: notFound,
    rejected_inactive: inactive.map((r) => ({
      id: r.id,
      marks: r.reporting_marks,
      car_number: r.car_number,
      rejected: "inactive",
    })),
  };
  (snapshot as any).kpi_delta = await annotateKpiDelta(snapshot.ids, { kind: "unsold" }, bucket);
  return { preview_token: await putPreview("unsold", snapshot), ...snapshot };
}

export async function applyRemoveSold(previewToken: string, actor: string) {
  const preview = await getPreview("unsold", previewToken);
  let updated = 0;
  for (const id of preview.ids ?? []) {
    const { error } = await supabaseAdmin
      .from("railcars")
      .update({ fleet_status: "Leased", fleet_status_source: "manual" })
      .eq("id", id)
      .eq("active", true)
      .eq("fleet_status", "Sold");
    if (error) throw error;
    await supabaseAdmin.from("assignment_history").insert({
      railcar_id: id,
      moved_at: new Date().toISOString(),
      moved_by: actor,
      reason: "Sold tag removed (preview sign-off)",
    });
    await logActivity({
      entity_type: "railcar",
      entity_id: id,
      action: "sold_tag_removed",
      actor,
      railcar_id: id,
      detail: { preview_token: previewToken },
    });
    updated += 1;
  }
  return { preview, updated };
}

export async function previewClassifySale(
  idsRaw: number[],
  klass: "external" | "intercompany" | "unclear",
  note?: string | null,
) {
  if (!["external", "intercompany", "unclear"].includes(klass)) {
    throw Object.assign(new Error("class must be external, intercompany, or unclear"), { status: 400 });
  }
  const { matched, notFound, inactive } = await matchCarsFromIds(idsRaw);
  const { data: rows } = await supabaseAdmin
    .from("v_rlms_kpi_car_rows")
    .select("railcar_id, current_lease, master_lease_id, rider_id, sale_class, buyer")
    .in("railcar_id", matched.map((c) => c.id));
  const byRider = new Map<number, { rider_id: number; master_lease_id: number | null; current_lease: string }>();
  for (const row of rows ?? []) {
    if (!row.rider_id) continue;
    if (!byRider.has(row.rider_id)) {
      byRider.set(row.rider_id, {
        rider_id: row.rider_id,
        master_lease_id: row.master_lease_id ?? null,
        current_lease: row.current_lease ?? `rider ${row.rider_id}`,
      });
    }
  }
  const leases = [];
  for (const lease of byRider.values()) {
    const { count, error } = await supabaseAdmin
      .from("v_rlms_kpi_car_rows")
      .select("railcar_id", { count: "exact", head: true })
      .eq("active", true)
      .eq("rider_id", lease.rider_id);
    if (error) throw error;
    const n = count ?? 0;
    const ol = lease.current_lease;
    leases.push({
      ...lease,
      active_cars: n,
      message: `affects ${n} active cars on ${ol}`,
    });
  }
  const snapshot = {
    class: klass,
    note: note ?? null,
    cars: rows ?? [],
    leases,
    summary: leases.map((l) => l.message),
    not_found: notFound,
    rejected_inactive: inactive.map((r) => ({ id: r.id, rejected: "inactive" })),
  };
  return { preview_token: await putPreview("classify", snapshot), ...snapshot };
}

export async function applyClassifySale(previewToken: string, actor: string) {
  const preview = await getPreview("classify", previewToken);
  const scopes =
    preview.leases?.length
      ? preview.leases
      : Array.from(
          new Map(
            (preview.cars ?? [])
              .filter((row: any) => row.rider_id || row.master_lease_id)
              .map((row: any) => [row.rider_id ?? `mla:${row.master_lease_id}`, row]),
          ).values(),
        );
  let written = 0;
  for (const row of scopes) {
    if (!row.rider_id && !row.master_lease_id) continue;
    if (row.rider_id) {
      await supabaseAdmin.from("rlms_sale_classification").delete().eq("rider_id", row.rider_id);
    } else {
      await supabaseAdmin
        .from("rlms_sale_classification")
        .delete()
        .eq("master_lease_id", row.master_lease_id)
        .is("rider_id", null);
    }
    const ins = await supabaseAdmin.from("rlms_sale_classification").insert({
      rider_id: row.rider_id ?? null,
      master_lease_id: row.master_lease_id ?? null,
      class: preview.class,
      note: preview.note,
      set_by: actor,
      set_at: new Date().toISOString(),
    });
    if (ins.error) throw ins.error;
    written += 1;
  }
  return { preview, written };
}

export async function previewOl2144RtexBuyer() {
  const { data, error } = await supabaseAdmin.from("v_kpi_preview_ol2144_rtex_buyer").select("*");
  if (error) throw error;
  const cars = data ?? [];
  const snapshot = {
    buyer: "RTEX",
    ids: cars.map((r: any) => r.railcar_id),
    cars,
    rejected_inactive: [] as any[],
  };
  (snapshot as any).kpi_delta = await annotateKpiDelta(snapshot.ids, { kind: "buyer" }, "sold_missing_buyer");
  return { preview_token: await putPreview("buyer", snapshot), ...snapshot };
}

export async function applyOl2144RtexBuyer(previewToken: string, actor: string) {
  const preview = await getPreview("buyer", previewToken);
  let updated = 0;
  for (const id of preview.ids ?? []) {
    const { data, error } = await supabaseAdmin
      .from("railcars")
      .update({ sold_to: preview.buyer ?? "RTEX" })
      .eq("id", id)
      .eq("active", true)
      .eq("fleet_status", "Sold")
      .select("id");
    if (error) throw error;
    if (!data?.length) continue;
    await supabaseAdmin.from("assignment_history").insert({
      railcar_id: id,
      moved_at: new Date().toISOString(),
      moved_by: actor,
      reason: "Buyer set to RTEX (preview sign-off)",
    });
    await logActivity({
      entity_type: "railcar",
      entity_id: id,
      action: "buyer_set",
      actor,
      railcar_id: id,
      detail: { buyer: preview.buyer ?? "RTEX", preview_token: previewToken, active_unchanged: true },
    });
    updated += 1;
  }
  return { preview, updated };
}

export function registerCommitmentRoutes(
  app: Express,
  requireWrite: (req: Request, res: Response) => Promise<string | null>,
) {
  app.get("/api/commitments/car/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const open = await openCommitment(id);
      const { rider, assignment } = await linkForCar(id);
      const { data: car } = await supabaseAdmin.from("railcars").select(CAR_SEL).eq("id", id).maybeSingle();
      const onOl = isOnOl(linkInput(car, rider?.rider_name, assignment));
      const off = await offRentOf(car, rider?.rider_name, assignment);
      const implicit =
        onOl && off
          ? {
              name: implicitAwaitingLabel(rider?.rider_name, car?.lessee_name),
              read_only: true,
            }
          : null;
      res.json({
        commitment: open,
        implicit,
        on_ol: onOl,
        off_rent: off,
        rent_start_date: assignment?.rent_start_date ?? null,
        derived_status: derivedFleetStatus({
          sold: car?.fleet_status === "Sold",
          offRent: off,
          onOl,
          hasOpenCommitment: Boolean(open),
        }),
      });
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/commitments/car/:id", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const id = Number(req.params.id);
      if (!isCommitmentType(req.body?.type) || !String(req.body?.name ?? "").trim()) {
        return res.status(400).json({ message: "type and name required" });
      }
      const row = await setCommitment(
        id,
        {
          type: req.body.type,
          name: req.body.name,
          program_id: req.body.program_id ?? null,
          target_date: req.body.target_date ?? null,
          note: req.body.note ?? null,
        },
        actor,
        { overwrite: Boolean(req.body.overwrite) },
      );
      res.json(row);
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.delete("/api/commitments/car/:id", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const row = await clearCommitment(Number(req.params.id), actor);
      res.json({ cleared: Boolean(row), commitment: row });
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/commitments/bulk/preview", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(
        await previewBulkCommitment(String(req.body?.text ?? ""), {
          action: req.body?.action === "clear" ? "clear" : "set",
          type: req.body?.type,
          name: req.body?.name,
          program_id: req.body?.program_id ?? null,
          target_date: req.body?.target_date ?? null,
          note: req.body?.note ?? null,
          overwrite: Boolean(req.body?.overwrite),
          ids: Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : undefined,
          bucket: req.body?.bucket ?? null,
        }),
      );
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/commitments/bulk/apply", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await applyBulkCommitment(String(req.body?.preview_token ?? ""), actor));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/returns/bulk/preview", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(
        await previewBulkReturn(String(req.body?.text ?? ""), {
          ea_rider_id: req.body?.ea_rider_id ?? null,
          commitment: req.body?.commitment ?? null,
        }),
      );
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/returns/bulk/apply", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await applyBulkReturn(String(req.body?.preview_token ?? ""), actor));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.get("/api/commitments/stale", async (_req, res) => {
    try {
      res.json(await listStale());
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.get("/api/returns/watch", async (_req, res) => {
    try {
      res.json({ rows: await listWatch() });
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/commitments/:id/extend", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const date = String(req.body?.target_date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: "target_date required" });
      res.json(await extendCommitment(Number(req.params.id), date, req.body?.note ?? null, actor));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/commitments/:id/clear", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const { data } = await supabaseAdmin.from("car_commitments").select("railcar_id").eq("id", Number(req.params.id)).maybeSingle();
      if (!data) return res.status(404).json({ message: "Not found" });
      res.json({ cleared: await clearCommitment(data.railcar_id, actor) });
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/railcars/sold/preview", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
      res.json(await previewMarkSold(ids, { sold_to: req.body?.sold_to ?? null, bucket: req.body?.bucket ?? null }));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/railcars/sold/apply", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(
        await applyMarkSold(String(req.body?.preview_token ?? ""), actor, {
          sold_to: req.body && Object.prototype.hasOwnProperty.call(req.body, "sold_to") ? req.body.sold_to : undefined,
          effective_date: req.body?.effective_date ?? null,
        }),
      );
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/railcars/unsold/preview", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(
        await previewRemoveSold(
          Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [],
          req.body?.bucket ?? null,
        ),
      );
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/railcars/unsold/apply", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await applyRemoveSold(String(req.body?.preview_token ?? ""), actor));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/sale-class/preview", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(
        await previewClassifySale(
          Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [],
          req.body?.class,
          req.body?.note ?? null,
        ),
      );
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/sale-class/apply", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await applyClassifySale(String(req.body?.preview_token ?? ""), actor));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/previews/ol2144-rtex", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await previewOl2144RtexBuyer());
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/previews/ol2144-rtex/apply", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await applyOl2144RtexBuyer(String(req.body?.preview_token ?? ""), actor));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.get("/api/sale-class", async (_req, res) => {
    try {
      const { data: entities, error: e1 } = await supabaseAdmin.from("rlms_internal_entities").select("*").order("name");
      if (e1) throw e1;
      const { data: rows, error: e2 } = await supabaseAdmin.from("rlms_sale_classification").select("*").order("id");
      if (e2) throw e2;
      res.json({ entities: entities ?? [], classifications: rows ?? [] });
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/sale-class/entities", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const { error } = await supabaseAdmin.from("rlms_internal_entities").upsert({
        name: String(req.body?.name ?? "").trim(),
        kind: req.body?.kind ?? null,
        note: req.body?.note ?? null,
      });
      if (error) throw error;
      res.json({ ok: true });
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/sale-class/rows", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const { error } = await supabaseAdmin.from("rlms_sale_classification").insert({
        master_lease_id: req.body?.master_lease_id ?? null,
        rider_id: req.body?.rider_id ?? null,
        class: req.body?.class,
        buyer: req.body?.buyer ?? null,
        note: req.body?.note ?? null,
        set_by: actor,
      });
      if (error) throw error;
      res.json({ ok: true });
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.get("/api/previews/occidental-ol1818", async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin.from("v_kpi_preview_occidental_ol1818").select("*");
      if (error) throw error;
      const rows = data ?? [];
      if (String(req.query.format ?? "") === "csv") {
        const headers = ["kind", "id", "car", "entity", "legal_owner", "old_value", "new_value"];
        const lines = [
          headers.join(","),
          ...rows.map((r: any) =>
            [
              r.kind,
              r.id,
              r.kind === "railcar" ? formatCarId(r) : (r.label ?? ""),
              r.entity ?? "",
              r.legal_owner ?? "",
              r.old_value ?? "",
              r.new_value ?? "",
            ]
              .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
              .join(","),
          ),
        ];
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="preview_occidental_ol1818_unsold.csv"');
        res.send(lines.join("\n") + "\n");
        return;
      }
      res.json({
        rows,
        mla_rows: rows.filter((r: any) => r.kind === "master_lease").length,
        car_rows: rows.filter((r: any) => r.kind === "railcar").length,
        inactive_rows: 0,
      });
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.get("/api/previews/ol2144-rtex", async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin.from("v_kpi_preview_ol2144_rtex_buyer").select("*");
      if (error) throw error;
      const rows = data ?? [];
      if (String(req.query.format ?? "") === "csv") {
        const headers = ["railcar_id", "car", "entity", "legal_owner", "status_tag", "old_value", "new_value"];
        const lines = [
          headers.join(","),
          ...rows.map((r: any) =>
            headers
              .map((h) => `"${String(h === "car" ? formatCarId(r) : (r[h] ?? "")).replace(/"/g, '""')}"`)
              .join(","),
          ),
        ];
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="preview_ol2144_rtex_buyer.csv"');
        res.send(lines.join("\n") + "\n");
        return;
      }
      res.json({ rows, car_rows: rows.length, inactive_rows: 0 });
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/programs/:id/close", async (_req, res) => {
    res.status(405).json({ error: "Use POST /api/programs/:id/close/preview then /close/apply. Links are kept." });
  });
}
