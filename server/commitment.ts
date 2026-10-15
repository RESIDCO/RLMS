import type { Express, Request, Response } from "express";
import { supabaseAdmin } from "./supabase";
import { COMMITMENT_TYPES, isOffRentLink, parseCarListText, type CommitmentType } from "@shared/commitment";
import { fetchAllRows } from "./fetch-all";

const CAR_SEL =
  "id, reporting_marks, car_initial, car_number, entity, active, fleet_status, lessee_name, assignment_label, rider_external_id";

function isCommitmentType(v: unknown): v is CommitmentType {
  return COMMITMENT_TYPES.includes(String(v) as CommitmentType);
}

async function linkForCar(railcarId: number) {
  const { data: a } = await supabaseAdmin
    .from("railcar_assignments")
    .select("id, rider_id, fleet_name, rider:riders(id, rider_name, lease_status, expiration_date)")
    .eq("railcar_id", railcarId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const rider = Array.isArray((a as any)?.rider) ? (a as any).rider[0] : (a as any)?.rider;
  return { assignment: a, rider };
}

function offRentOf(car: any, riderName: string | null | undefined, hasAssignment: boolean) {
  return isOffRentLink({
    hasAssignment,
    rider: riderName,
    lesseeName: car?.lessee_name,
    assignmentLabel: car?.assignment_label,
  });
}

export async function recomputeStatus(railcarId: number) {
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
  const { rider, assignment } = await linkForCar(railcarId);
  const off = offRentOf(car, rider?.rider_name, Boolean(assignment));
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

export async function ensureProgramCommitment(railcarId: number, program: { id: number; name: string }, actor: string) {
  const { rider, assignment } = await linkForCar(railcarId);
  const { data: car } = await supabaseAdmin.from("railcars").select(CAR_SEL).eq("id", railcarId).maybeSingle();
  if (!offRentOf(car, rider?.rider_name, Boolean(assignment))) return { skipped: "on_rent" as const };
  const existing = await openCommitment(railcarId);
  if (existing) return { skipped: "already_committed" as const, existing };
  await setCommitment(
    railcarId,
    { type: "program", name: program.name, program_id: program.id },
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
    const { data, error } = await supabaseAdmin
      .from("railcars")
      .select(CAR_SEL)
      .ilike("car_number", t.number)
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
  return { tokens, matched, notFound };
}

async function classifyMatched(cars: any[]) {
  const ids = cars.map((c) => c.id);
  const { data: assigns } = ids.length
    ? await supabaseAdmin
        .from("railcar_assignments")
        .select("railcar_id, rider_id, fleet_name, rider:riders(id, rider_name, lease_status)")
        .in("railcar_id", ids)
    : { data: [] as any[] };
  const { data: commits } = ids.length
    ? await supabaseAdmin.from("car_commitments").select("*").in("railcar_id", ids).is("cleared_at", null)
    : { data: [] as any[] };
  const aBy = new Map<number, any>();
  for (const a of assigns ?? []) aBy.set(a.railcar_id, a);
  const cBy = new Map<number, any>();
  for (const c of commits ?? []) cBy.set(c.railcar_id, c);
  return cars.map((car) => {
    const a = aBy.get(car.id);
    const rider = Array.isArray(a?.rider) ? a.rider[0] : a?.rider;
    const off = offRentOf(car, rider?.rider_name, Boolean(a));
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

export async function previewBulkCommitment(text: string) {
  const { matched, notFound } = await matchCarsFromText(text);
  const rows = await classifyMatched(matched);
  return {
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
  };
}

export async function applyBulkCommitment(
  text: string,
  action: "set" | "clear",
  actor: string,
  body: {
    type?: CommitmentType;
    name?: string;
    program_id?: number | null;
    target_date?: string | null;
    note?: string | null;
    overwrite?: boolean;
  },
) {
  const preview = await previewBulkCommitment(text);
  if (action === "clear") {
    const ids = preview.matched.map((m) => m.id);
    const cleared = [];
    for (const id of ids) {
      const row = await clearCommitment(id, actor);
      if (row) cleared.push(row);
    }
    return { preview, cleared: cleared.length };
  }
  if (!body.type || !body.name?.trim()) {
    throw Object.assign(new Error("type and name required"), { status: 400 });
  }
  const eligible = preview.matched.filter((m) => !m.commitment || body.overwrite);
  const skipped = preview.matched.filter((m) => m.commitment && !body.overwrite);
  const set = [];
  for (const m of eligible) {
    const row = await setCommitment(
      m.id,
      {
        type: body.type,
        name: body.name,
        program_id: body.program_id,
        target_date: body.target_date,
        note: body.note,
      },
      actor,
      { overwrite: true },
    );
    set.push(row);
  }
  return { preview, set: set.length, skipped: skipped.length, rejected_on_rent: preview.on_rent.length };
}

function eaNameFromOl(ol: string | null | undefined): string | null {
  const s = String(ol ?? "").trim();
  const m = /^OL(\d+)/i.exec(s);
  if (!m) return null;
  return `EA${m[1]}`;
}

function xLessee(lessee: string | null | undefined): string {
  const s = String(lessee ?? "").trim();
  if (!s) return "xLessee";
  if (/^\(?x/i.test(s)) return s;
  return `x${s}`;
}

export async function previewBulkReturn(text: string, eaRiderId?: number | null) {
  const { matched, notFound } = await matchCarsFromText(text);
  const rows = await classifyMatched(matched);
  let ea: any = null;
  if (eaRiderId) {
    const { data } = await supabaseAdmin
      .from("riders")
      .select("id, rider_name, master_lease_id")
      .eq("id", eaRiderId)
      .maybeSingle();
    ea = data;
  }
  const suggested = [];
  for (const r of rows) {
    const from = r.rider?.rider_name ?? r.car.rider_external_id ?? null;
    const want = ea?.rider_name ?? eaNameFromOl(from);
    let dest = ea;
    if (!dest && want) {
      const { data } = await supabaseAdmin
        .from("riders")
        .select("id, rider_name, master_lease_id")
        .ilike("rider_name", want)
        .limit(1)
        .maybeSingle();
      dest = data;
    }
    suggested.push({
      id: r.car.id,
      marks: r.car.reporting_marks,
      car_number: r.car.car_number,
      entity: r.car.entity,
      from_link: from,
      from_lessee: r.car.lessee_name,
      to_link: dest?.rider_name ?? want,
      to_rider_id: dest?.id ?? null,
      to_label: xLessee(r.car.lessee_name),
      resulting_status: r.commitment ? "Idle" : "Unassigned",
      missing_ea: !dest,
      already_off_rent: r.off_rent,
    });
  }
  return { not_found: notFound, rows: suggested, ea_rider: ea };
}

export async function applyBulkReturn(
  text: string,
  actor: string,
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
  const preview = await previewBulkReturn(text, opts.ea_rider_id);
  const moved = [];
  const failed = [];
  for (const row of preview.rows) {
    if (!row.to_rider_id) {
      failed.push({ ...row, error: "EA rider not found" });
      continue;
    }
    const { data: prev } = await supabaseAdmin
      .from("railcar_assignments")
      .select("id, rider_id, fleet_name")
      .eq("railcar_id", row.id)
      .maybeSingle();
    const targetFleet = row.to_label;
    if (prev) {
      const { error } = await supabaseAdmin
        .from("railcar_assignments")
        .update({ rider_id: row.to_rider_id, fleet_name: targetFleet, assigned_at: new Date().toISOString() })
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
      });
      if (error) {
        failed.push({ ...row, error: error.message });
        continue;
      }
    }
    await supabaseAdmin.from("assignment_history").insert({
      railcar_id: row.id,
      from_rider_id: prev?.rider_id ?? null,
      to_rider_id: row.to_rider_id,
      from_fleet_name: prev?.fleet_name ?? null,
      to_fleet_name: targetFleet,
      moved_at: new Date().toISOString(),
      moved_by: actor,
      reason: "Bulk return OL → EA",
    });
    await supabaseAdmin
      .from("railcars")
      .update({
        rider_external_id: row.to_link,
        assignment_label: targetFleet,
        lessee_name: targetFleet,
      })
      .eq("id", row.id);
    if (opts.commitment) {
      try {
        await setCommitment(row.id, opts.commitment, actor, { overwrite: Boolean(opts.commitment.overwrite) });
      } catch (e: any) {
        if (e?.code !== "on_rent") failed.push({ ...row, error: e.message });
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

export async function listKpiCars(bucket: string) {
  let q = supabaseAdmin.from("v_rlms_car_kpi").select("*").eq("is_op", true);
  if (bucket === "off_rent") q = q.eq("off_rent", true);
  else if (bucket === "idle") q = q.eq("off_rent", true).eq("has_open_commitment", true);
  else if (bucket === "unassigned") q = q.eq("off_rent", true).eq("has_open_commitment", false);
  else if (bucket === "on_rent") q = q.eq("off_rent", false);
  else if (bucket === "no_link") q = q.eq("no_assignment", true);
  else if (bucket === "mtm") q = q.or("lease_status.ilike.%MTM%,lease_status.ilike.%month to month%");
  const { data, error } = await q.order("railcar_id").limit(5000);
  if (error) throw error;
  return data ?? [];
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

export function registerCommitmentRoutes(
  app: Express,
  requireWrite: (req: Request, res: Response) => Promise<string | null>,
) {
  app.get("/api/commitments/car/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const open = await openCommitment(id);
      res.json({ commitment: open });
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
      res.json(await previewBulkCommitment(String(req.body?.text ?? "")));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/commitments/bulk/apply", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const action = req.body?.action === "clear" ? "clear" : "set";
      res.json(
        await applyBulkCommitment(String(req.body?.text ?? ""), action, actor, {
          type: req.body?.type,
          name: req.body?.name,
          program_id: req.body?.program_id ?? null,
          target_date: req.body?.target_date ?? null,
          note: req.body?.note ?? null,
          overwrite: Boolean(req.body?.overwrite),
        }),
      );
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/returns/bulk/preview", async (req, res) => {
    try {
      res.json(await previewBulkReturn(String(req.body?.text ?? ""), req.body?.ea_rider_id ?? null));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/returns/bulk/apply", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(
        await applyBulkReturn(String(req.body?.text ?? ""), actor, {
          ea_rider_id: req.body?.ea_rider_id ?? null,
          commitment: req.body?.commitment ?? null,
        }),
      );
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

  app.get("/api/kpi/cars", async (req, res) => {
    try {
      res.json({ rows: await listKpiCars(String(req.query.bucket ?? "off_rent")) });
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

  app.post("/api/programs/:id/close", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await closeProgram(Number(req.params.id), actor));
    } catch (e) {
      errHandler(res, e);
    }
  });
}
