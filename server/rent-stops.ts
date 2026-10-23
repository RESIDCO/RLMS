import type { Express, Request, Response } from "express";
import { supabaseAdmin } from "./supabase";
import { getPreview, putPreview } from "./commitment";
import { appendNotesInGroup, withNoteReport } from "./append-note";
import { recordChange, withChangeGroupResult } from "./change-log";
import { parseCarListText } from "@shared/commitment";
import { formatCarId } from "@shared/residco-import";
import {
  offRentRowStopDate,
  parseOffRentPaste,
  rentStopReasonFields,
} from "@shared/rent-stops";
import { annotateKpiDelta } from "./kpi-delta";
import { resolveRailcarsByAnyIdentity } from "./activity-log";

function errHandler(res: Response, e: any) {
  res.status(e?.status || 500).json({ message: e?.message || "Error", code: e?.code });
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

export async function setAbatement(railcarId: number, body: any, actor: string) {
  const car = await loadCar(railcarId);
  if (!car) throw Object.assign(new Error("Car not found"), { status: 404 });
  if (car.active !== true) throw Object.assign(new Error("rejected: inactive"), { status: 400, code: "inactive" });
  if (car.fleet_status === "Sold") throw Object.assign(new Error("Sold cars cannot take an abatement"), { status: 400 });
  const existing = await openStop(railcarId);
  if (existing) throw Object.assign(new Error("Car already has an open rent stop"), { status: 400, code: "open_stop" });
  const assignment = await latestAssignment(railcarId);
  const stopDate = String(body.stop_date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stopDate)) throw Object.assign(new Error("stop_date must be YYYY-MM-DD"), { status: 400 });
  const fields = rentStopReasonFields(body, { strict: true });
  const reason = fields.reason;
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
      reason_other: fields.reason_other,
      note: fields.note,
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
    detail: { type: "Abatement", stop_date: stopDate, reason, reason_other: fields.reason_other, note: fields.note, expected_resume_date: body.expected_resume_date || null },
    source: "ui",
    source_table: "car_rent_stops",
    source_id: Number(data.id),
  });
  return data;
}

export async function setOffRent(railcarId: number, body: any, actor: string) {
  const car = await loadCar(railcarId);
  if (!car) throw Object.assign(new Error("Car not found"), { status: 404 });
  if (car.active !== true) throw Object.assign(new Error("inactive – left alone"), { status: 400, code: "inactive" });
  const existing = await openStop(railcarId);
  if (existing) {
    const err: any = new Error(existing.type === "Off rent" ? "already off rent" : "Car already has an open rent stop");
    err.status = 400;
    err.code = existing.type === "Off rent" ? "already_off_rent" : "open_stop";
    throw err;
  }
  const assignment = await latestAssignment(railcarId);
  const stopDate = String(body.stop_date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stopDate)) throw Object.assign(new Error("stop_date must be YYYY-MM-DD"), { status: 400 });
  const fields = rentStopReasonFields(body);
  const reason = fields.reason;
  const { data, error } = await supabaseAdmin
    .from("car_rent_stops")
    .insert({
      railcar_id: railcarId,
      assignment_id: assignment?.id ?? null,
      rider_id: assignment?.rider_id ?? null,
      lease_ref: body.lease_ref ?? car.rider_external_id ?? null,
      lessee_snapshot: car.lessee_name ?? null,
      type: "Off rent",
      stop_date: stopDate,
      expected_resume_date: body.expected_resume_date || null,
      reason,
      reason_other: fields.reason_other,
      note: fields.note,
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
    action: "rent_stop_off_rent",
    entity_type: "railcar",
    entity_id: railcarId,
    railcar_id: railcarId,
    actor,
    detail: { type: "Off rent", stop_date: stopDate, reason, reason_other: fields.reason_other, note: fields.note },
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
  const fields = rentStopReasonFields({
    reason: body.reason ?? existing.reason,
    reason_other: body.reason_other ?? existing.reason_other,
    note: body.note ?? existing.note,
  });
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
      reason: fields.reason,
      reason_other: fields.reason_other,
      note: fields.note,
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

type BulkStopKind = "off_rent" | "resume" | "convert" | "abatement";

function bulkStopKind(raw: string): BulkStopKind {
  if (raw === "Off rent" || raw === "off_rent") return "off_rent";
  if (raw === "resume") return "resume";
  if (raw === "convert") return "convert";
  return "abatement";
}

function bulkStopLabels(kind: BulkStopKind): { actionLabel: string; storedAction: string } {
  switch (kind) {
    case "off_rent":
      return { actionLabel: "Off rent", storedAction: "Off rent" };
    case "resume":
      return { actionLabel: "Resume", storedAction: "resume" };
    case "convert":
      return { actionLabel: "Convert to off rent", storedAction: "convert" };
    case "abatement":
      return { actionLabel: "Abatement", storedAction: "Abatement" };
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown rent stop action ${String(exhaustive)}`);
    }
  }
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

  app.post("/api/rent-stops/car/:id/off-rent", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await withChangeGroupResult(actor, async () => {
        const data = await setOffRent(Number(req.params.id), req.body ?? {}, actor);
        const noteReport = await appendNotesInGroup({
          entityType: "railcar",
          ids: [Number(req.params.id)],
          note: req.body?.append_note,
          actor,
        });
        return withNoteReport(data, req.body?.append_note, noteReport);
      }));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/rent-stops/car/:id/abatement", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await withChangeGroupResult(actor, async () => {
        const data = await setAbatement(Number(req.params.id), req.body ?? {}, actor);
        const noteReport = await appendNotesInGroup({
          entityType: "railcar",
          ids: [Number(req.params.id)],
          note: req.body?.append_note,
          actor,
        });
        return withNoteReport(data, req.body?.append_note, noteReport);
      }));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/rent-stops/car/:id/resume", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await withChangeGroupResult(actor, async () => {
        const data = await resumeStop(Number(req.params.id), actor, req.body?.actual_resume_date);
        const noteReport = await appendNotesInGroup({
          entityType: "railcar",
          ids: [Number(req.params.id)],
          note: req.body?.append_note,
          actor,
        });
        return withNoteReport(data, req.body?.append_note, noteReport);
      }));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/rent-stops/car/:id/convert-off-rent", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await withChangeGroupResult(actor, async () => {
        const data = await convertToOffRent(Number(req.params.id), actor, req.body ?? {});
        const noteReport = await appendNotesInGroup({
          entityType: "railcar",
          ids: [Number(req.params.id)],
          note: req.body?.append_note,
          actor,
        });
        return withNoteReport(data, req.body?.append_note, noteReport);
      }));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/rent-stops/bulk/preview", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const kind = bulkStopKind(String(req.body?.action ?? req.body?.type ?? "abatement"));
      const { actionLabel, storedAction } = bulkStopLabels(kind);
      const text = String(req.body?.text ?? "");
      const idsIn = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((n: number) => n > 0) : [];
      let rowsIn: { car?: string; id?: number; stop_date?: string | null; note?: string | null }[] = Array.isArray(req.body?.rows)
        ? req.body.rows
        : [];
      if (!rowsIn.length && text) {
        const dated = parseOffRentPaste(text);
        if (dated.some((row) => row.stop_date || row.note)) rowsIn = dated;
      }
      const parsed = text && !rowsIn.length ? parseCarListText(text) : [];
      const rejected: any[] = [];
      const warnings: any[] = [];
      let ids = idsIn;
      const dateById = new Map<number, { stop_date?: string | null; note?: string | null }>();
      if (rowsIn.length) {
        for (const row of rowsIn) {
          const raw = String(row.car ?? "").trim();
          const found = row.id ? [Number(row.id)] : raw ? await resolveRailcarsByAnyIdentity(raw) : [];
          if (!found.length) {
            rejected.push({ car: raw || row.id, reason: "not_found" });
            continue;
          }
          if (found.length > 1) {
            rejected.push({ car: raw, reason: "ambiguous" });
            continue;
          }
          const id = found[0];
          ids.push(id);
          dateById.set(id, { stop_date: row.stop_date, note: row.note });
        }
      }
      if (!ids.length) {
        for (const tok of parsed) {
          const raw = tok.initial ? `${tok.initial} ${tok.number}` : tok.raw;
          const found = await resolveRailcarsByAnyIdentity(raw);
          if (!found.length) rejected.push({ car: raw, reason: "not_found" });
          ids.push(...found);
        }
      }
      const today = new Date().toISOString().slice(0, 10);
      const fields = rentStopReasonFields(req.body ?? {});
      const needsDate = kind === "off_rent" || kind === "abatement";
      const toWrite: any[] = [];
      const seenIds = new Set<number>();
      for (let index = 0; index < ids.length; index += 1) {
        const id = ids[index];
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        const car = await loadCar(id);
        if (!car) {
          rejected.push({ id, reason: "not_found" });
          continue;
        }
        if (car.active !== true) {
          rejected.push({ id, car: formatCarId(car), reason: "inactive – left alone" });
          continue;
        }
        const existing = await openStop(id);
        if (existing && kind !== "resume" && kind !== "convert") {
          rejected.push({
            id,
            car: formatCarId(car),
            reason: existing.type === "Off rent" ? "already off rent" : "existing open stop",
          });
          continue;
        }
        if ((kind === "resume" || kind === "convert") && !existing) {
          rejected.push({ id, car: formatCarId(car), reason: "no open stop" });
          continue;
        }
        if (kind === "convert" && existing?.type !== "Abatement") {
          rejected.push({ id, car: formatCarId(car), reason: "Open abatement required to convert" });
          continue;
        }
        const per = dateById.get(id);
        const stopDate = offRentRowStopDate(per?.stop_date, req.body?.stop_date);
        if (needsDate && !stopDate) {
          rejected.push({ id, car: formatCarId(car), reason: "stop_date required" });
          continue;
        }
        const { data: startRow } = await supabaseAdmin
          .from("railcars")
          .select("id, lease_start_date")
          .eq("id", id)
          .maybeSingle();
        const rentStart = String(startRow?.lease_start_date ?? "").slice(0, 10);
        if (stopDate && rentStart && stopDate < rentStart) {
          warnings.push({ id, car: formatCarId(car), reason: "date before rent_start", stop_date: stopDate, rent_start: rentStart });
        }
        if (stopDate && stopDate > today) {
          warnings.push({ id, car: formatCarId(car), reason: "date after today", stop_date: stopDate });
        }
        const rowNote = String(per?.note ?? "").trim();
        toWrite.push({
          id: car.id,
          car: formatCarId(car),
          ol: car.rider_external_id,
          lessee: car.lessee_name,
          action: actionLabel,
          stop_date: stopDate || null,
          reason: fields.reason,
          reason_other: fields.reason_other,
          note: rowNote || fields.note,
          expected_resume_date: req.body?.expected_resume_date ?? null,
        });
      }
      const storedBody = {
        ...(req.body ?? {}),
        reason: fields.reason,
        reason_other: fields.reason_other,
        note: fields.note,
      };
      const token = await putPreview("rent_stop", { action: storedAction, toWrite, body: storedBody, warnings });
      const kpi_delta = kind === "abatement"
        ? await annotateKpiDelta(
          toWrite.map((r) => r.id),
          { kind: "abatement" },
          req.body?.bucket ?? null,
        )
        : null;
      res.json({ preview_token: token, to_write: toWrite, rejected, warnings, kpi_delta });
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
          const rowNote = String(row.note ?? "").trim();
          const body = {
            ...(snap.body ?? {}),
            stop_date: row.stop_date ?? snap.body?.stop_date,
            note: rowNote || snap.body?.note || null,
          };
          if (snap.action === "resume") written.push(await resumeStop(row.id, actor, snap.body?.actual_resume_date));
          else if (snap.action === "convert") written.push(await convertToOffRent(row.id, actor, body));
          else if (snap.action === "Off rent" || snap.action === "off_rent") written.push(await setOffRent(row.id, body, actor));
          else written.push(await setAbatement(row.id, body, actor));
        }
        const noteReport = await appendNotesInGroup({
          entityType: "railcar",
          ids: (snap.toWrite ?? []).map((row: { id?: number }) => Number(row.id)),
          note: req.body?.append_note,
          actor,
        });
        return withNoteReport({ written: written.length }, req.body?.append_note, noteReport);
      });
      res.json(result);
    } catch (e) {
      errHandler(res, e);
    }
  });
}
