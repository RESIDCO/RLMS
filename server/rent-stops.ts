import type { Express, Request, Response } from "express";
import { supabaseAdmin } from "./supabase";
import { getPreview, putPreview } from "./commitment";
import { recordChange, withChangeGroupResult } from "./change-log";
import { parseCarListText } from "@shared/commitment";
import { formatCarId } from "@shared/residco-import";
import { annotateKpiDelta } from "./kpi-delta";
import { resolveRailcarsByAnyIdentity } from "./activity-log";

const STOP_TYPES = ["Abatement", "Off rent"] as const;
const REASONS = ["quality repair", "goodwill", "damage", "dispute", "other"] as const;

type StopType = (typeof STOP_TYPES)[number];
type StopReason = (typeof REASONS)[number];

function errHandler(res: Response, e: any) {
  res.status(e?.status || 500).json({ message: e?.message || "Error", code: e?.code });
}

function isType(v: unknown): v is StopType {
  return STOP_TYPES.includes(String(v) as StopType);
}
function isReason(v: unknown): v is StopReason {
  return REASONS.includes(String(v) as StopReason);
}

async function loadCar(id: number) {
  const { data, error } = await supabaseAdmin
    .from("railcars")
    .select("id, reporting_marks, car_number, active, fleet_status, lessee_name, rider_external_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function latestAssignment(railcarId: number) {
  const { data, error } = await supabaseAdmin
    .from("railcar_assignments")
    .select("id, rider_id")
    .eq("railcar_id", railcarId)
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data ?? [])[0] ?? null;
}

async function openStop(railcarId: number) {
  const { data, error } = await supabaseAdmin
    .from("car_rent_stops")
    .select("*")
    .eq("railcar_id", railcarId)
    .is("actual_resume_date", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function history(railcarId: number) {
  const { data: stops, error } = await supabaseAdmin
    .from("car_rent_stops")
    .select("id")
    .eq("railcar_id", railcarId);
  if (error) throw error;
  const ids = (stops ?? []).map((s: any) => s.id);
  if (!ids.length) return [];
  const { data, error: hErr } = await supabaseAdmin
    .from("car_rent_stops_history")
    .select("*")
    .in("stop_id", ids)
    .order("at", { ascending: false })
    .limit(100);
  if (hErr) throw hErr;
  return data ?? [];
}

async function setAbatement(railcarId: number, body: any, actor: string) {
  const car = await loadCar(railcarId);
  if (!car) throw Object.assign(new Error("Car not found"), { status: 404 });
  if (car.active !== true) throw Object.assign(new Error("rejected: inactive"), { status: 400, code: "inactive" });
  if (car.fleet_status === "Sold") throw Object.assign(new Error("Sold cars cannot take an abatement"), { status: 400 });
  const existing = await openStop(railcarId);
  if (existing) throw Object.assign(new Error("Car already has an open rent stop"), { status: 400, code: "open_stop" });
  const assignment = await latestAssignment(railcarId);
  const stopDate = String(body.stop_date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stopDate)) throw Object.assign(new Error("stop_date must be YYYY-MM-DD"), { status: 400 });
  const reason = body.reason;
  if (!isReason(reason)) throw Object.assign(new Error("invalid reason"), { status: 400 });
  const { data, error } = await supabaseAdmin
    .from("car_rent_stops")
    .insert({
      railcar_id: railcarId,
      assignment_id: assignment?.id ?? null,
      rider_id: assignment?.rider_id ?? null,
      lease_ref: car.rider_external_id ?? null,
      lessee_snapshot: car.lessee_name ?? null,
      type: "Abatement",
      stop_date: stopDate,
      expected_resume_date: body.expected_resume_date || null,
      reason,
      reason_other: body.reason_other ?? null,
      note: body.note ?? null,
      created_by: actor,
    })
    .select()
    .single();
  if (error) throw error;
  await recordChange({
    table: "car_rent_stops",
    pk: Number(data.id),
    before: {},
    after: data,
    action: "rent_stop_abatement",
    entity_type: "railcar",
    entity_id: railcarId,
    railcar_id: railcarId,
    actor,
    detail: { type: "Abatement", stop_date: stopDate, reason, expected_resume_date: body.expected_resume_date || null },
    source: "ui",
    source_table: "car_rent_stops",
    source_id: Number(data.id),
  });
  return data;
}

async function resumeStop(railcarId: number, actor: string, resumeDate?: string) {
  const car = await loadCar(railcarId);
  if (!car) throw Object.assign(new Error("Car not found"), { status: 404 });
  if (car.active !== true) throw Object.assign(new Error("rejected: inactive"), { status: 400, code: "inactive" });
  const existing = await openStop(railcarId);
  if (!existing) throw Object.assign(new Error("No open rent stop"), { status: 400 });
  const date = (resumeDate && String(resumeDate).slice(0, 10)) || new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("car_rent_stops")
    .update({ actual_resume_date: date, created_by: actor })
    .eq("id", existing.id)
    .select()
    .single();
  if (error) throw error;
  await recordChange({
    table: "car_rent_stops",
    pk: Number(existing.id),
    before: { actual_resume_date: existing.actual_resume_date ?? null },
    after: { actual_resume_date: date },
    action: "rent_stop_resume",
    entity_type: "railcar",
    entity_id: railcarId,
    railcar_id: railcarId,
    actor,
    detail: { from: existing.type, actual_resume_date: date, stop_id: existing.id },
    source: "ui",
    source_table: "car_rent_stops",
    source_id: Number(existing.id),
  });
  return data;
}

async function convertToOffRent(railcarId: number, actor: string, body: any) {
  const car = await loadCar(railcarId);
  if (!car) throw Object.assign(new Error("Car not found"), { status: 404 });
  if (car.active !== true) throw Object.assign(new Error("rejected: inactive"), { status: 400, code: "inactive" });
  const existing = await openStop(railcarId);
  if (!existing || existing.type !== "Abatement") {
    throw Object.assign(new Error("Open abatement required to convert"), { status: 400 });
  }
  const today = new Date().toISOString().slice(0, 10);
  const { error: closeErr } = await supabaseAdmin
    .from("car_rent_stops")
    .update({ actual_resume_date: today, created_by: actor })
    .eq("id", existing.id);
  if (closeErr) throw closeErr;
  await recordChange({
    table: "car_rent_stops",
    pk: Number(existing.id),
    before: { actual_resume_date: existing.actual_resume_date ?? null },
    after: { actual_resume_date: today },
    action: "rent_stop_convert_off_rent",
    entity_type: "railcar",
    entity_id: railcarId,
    railcar_id: railcarId,
    actor,
    source_table: "car_rent_stops",
    source_id: Number(existing.id),
  });
  const assignment = await latestAssignment(railcarId);
  const { data, error } = await supabaseAdmin
    .from("car_rent_stops")
    .insert({
      railcar_id: railcarId,
      assignment_id: assignment?.id ?? existing.assignment_id,
      rider_id: assignment?.rider_id ?? existing.rider_id,
      lease_ref: existing.lease_ref,
      lessee_snapshot: existing.lessee_snapshot,
      type: "Off rent",
      stop_date: body.stop_date || today,
      expected_resume_date: body.expected_resume_date || null,
      reason: isReason(body.reason) ? body.reason : existing.reason,
      reason_other: body.reason_other ?? existing.reason_other,
      note: body.note ?? existing.note,
      created_by: actor,
      converted_from_id: existing.id,
    })
    .select()
    .single();
  if (error) throw error;
  await recordChange({
    table: "car_rent_stops",
    pk: Number(data.id),
    before: {},
    after: data,
    action: "rent_stop_convert_off_rent",
    entity_type: "railcar",
    entity_id: railcarId,
    railcar_id: railcarId,
    actor,
    detail: { converted_from_id: existing.id, new_id: data.id, assignment_unchanged: true },
    source: "ui",
    source_table: "car_rent_stops",
    source_id: Number(data.id),
  });
  return data;
}

export function registerRentStopRoutes(
  app: Express,
  requireWrite: (req: Request, res: Response) => Promise<string | null>,
) {
  app.get("/api/rent-stops/car/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [open, hist] = await Promise.all([openStop(id), history(id)]);
      res.json({ open, history: hist });
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/rent-stops/car/:id/abatement", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await withChangeGroupResult(actor, () => setAbatement(Number(req.params.id), req.body ?? {}, actor)));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/rent-stops/car/:id/resume", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await withChangeGroupResult(actor, () => resumeStop(Number(req.params.id), actor, req.body?.actual_resume_date)));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/rent-stops/car/:id/convert-off-rent", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await withChangeGroupResult(actor, () => convertToOffRent(Number(req.params.id), actor, req.body ?? {})));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/rent-stops/bulk/preview", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const action = String(req.body?.action ?? "abatement");
      const text = String(req.body?.text ?? "");
      const idsIn = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((n: number) => n > 0) : [];
      const parsed = text ? parseCarListText(text) : [];
      const rejected: any[] = [];
      let ids = idsIn;
      if (!ids.length) {
        for (const tok of parsed) {
          const raw = tok.initial ? `${tok.initial} ${tok.number}` : tok.raw;
          const found = await resolveRailcarsByAnyIdentity(raw);
          if (!found.length) rejected.push({ car: raw, reason: "not_found" });
          ids.push(...found);
        }
      }
      const toWrite: any[] = [];
      for (const id of [...new Set(ids)]) {
        const car = await loadCar(id);
        if (!car) {
          rejected.push({ id, reason: "not_found" });
          continue;
        }
        if (car.active !== true) {
          rejected.push({ id, car: formatCarId(car), reason: "inactive" });
          continue;
        }
        toWrite.push({
          id: car.id,
          car: formatCarId(car),
          ol: car.rider_external_id,
          lessee: car.lessee_name,
          action,
          stop_date: req.body?.stop_date ?? null,
          reason: req.body?.reason ?? null,
          expected_resume_date: req.body?.expected_resume_date ?? null,
        });
      }
      const token = await putPreview("rent_stop", { action, toWrite, body: req.body ?? {} });
      const kpi_delta = await annotateKpiDelta(
        toWrite.map((r) => r.id),
        { kind: "abatement" },
        req.body?.bucket ?? null,
      );
      res.json({ preview_token: token, to_write: toWrite, rejected, kpi_delta });
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/rent-stops/bulk/apply", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const result = await withChangeGroupResult(actor, async () => {
        const snap = await getPreview("rent_stop", String(req.body?.preview_token ?? ""));
        const written: any[] = [];
        for (const row of snap.toWrite ?? []) {
          if (snap.action === "resume") written.push(await resumeStop(row.id, actor, snap.body?.actual_resume_date));
          else if (snap.action === "convert") written.push(await convertToOffRent(row.id, actor, snap.body ?? {}));
          else written.push(await setAbatement(row.id, snap.body ?? {}, actor));
        }
        return { written: written.length };
      });
      res.json(result);
    } catch (e) {
      errHandler(res, e);
    }
  });
}
