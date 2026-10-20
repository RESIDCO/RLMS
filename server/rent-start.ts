import type { Express, Request, Response } from "express";
import { pickRow } from "@shared/change-log";
import { supabaseAdmin } from "./supabase";
import { appendNotesInGroup, withNoteReport } from "./append-note";
import { recordChange, withChangeGroupResult } from "./change-log";
import { getPreview, putPreview, recomputeStatus } from "./commitment";
import { annotateKpiDelta } from "./kpi-delta";
import {
  derivedFleetStatus,
  implicitAwaitingLabel,
  isoDateOnly,
  isOnOl,
  parseCarDateRows,
  parseCarListText,
  carNumberLookupValues,
} from "@shared/commitment";

const CAR_SEL =
  "id, reporting_marks, car_initial, car_number, entity, active, fleet_status, lessee_name, assignment_label, rider_external_id, ops_flag";

async function latestAssignment(railcarId: number) {
  const { data, error } = await supabaseAdmin
    .from("railcar_assignments")
    .select("id, rider_id, fleet_name, rent_start_date, assigned_at, rider:riders(id, rider_name)")
    .eq("railcar_id", railcarId)
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw error;
  const a = (data ?? [])[0] ?? null;
  const rider = Array.isArray((a as any)?.rider) ? (a as any).rider[0] : (a as any)?.rider;
  return { assignment: a, rider };
}

function onOlOf(car: any, riderName: string | null | undefined, assignment: any) {
  return isOnOl({
    hasAssignment: Boolean(assignment),
    rider: riderName,
    lesseeName: car?.lessee_name,
    assignmentLabel: car?.assignment_label,
  });
}

async function logRentStartHistory(railcarId: number, assignment: any, actor: string, date: string | null) {
  const { error } = await supabaseAdmin.from("assignment_history").insert({
    railcar_id: railcarId,
    from_rider_id: assignment?.rider_id ?? null,
    to_rider_id: assignment?.rider_id ?? null,
    from_fleet_name: assignment?.fleet_name ?? null,
    to_fleet_name: assignment?.fleet_name ?? null,
    moved_at: new Date().toISOString(),
    moved_by: actor,
    reason: date ? `Rent start set (${date})` : "Rent start set",
  });
  if (error) throw error;
}

export async function setRentStartDate(
  railcarId: number,
  dateRaw: string | null,
  actor: string,
  appendNote?: unknown,
) {
  const date = dateRaw == null || dateRaw === "" ? null : isoDateOnly(dateRaw);
  if (dateRaw && !date) throw Object.assign(new Error("date must be YYYY-MM-DD"), { status: 400 });
  const { data: car, error: cErr } = await supabaseAdmin.from("railcars").select(CAR_SEL).eq("id", railcarId).maybeSingle();
  if (cErr) throw cErr;
  if (!car) throw Object.assign(new Error("Car not found"), { status: 404 });
  if (car.active !== true) {
    throw Object.assign(new Error("rejected: inactive"), { status: 400, code: "inactive" });
  }
  if (car.fleet_status === "Sold") {
    throw Object.assign(new Error("Sold cars are never changed by rent-start logic"), { status: 400 });
  }
  const { assignment, rider } = await latestAssignment(railcarId);
  if (!onOlOf(car, rider?.rider_name, assignment)) {
    throw Object.assign(new Error("not on OL"), { status: 400, code: "not_on_ol" });
  }
  const prior = pickRow(assignment as Record<string, unknown>, ["rent_start_date", "rent_start_set_by", "rent_start_set_at"]);
  return withChangeGroupResult(actor, async () => {
    const patch = {
      rent_start_date: date,
      rent_start_set_by: actor,
      rent_start_set_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin.from("railcar_assignments").update(patch).eq("id", assignment.id);
    if (error) throw error;
    await recordChange({
      table: "railcar_assignments",
      pk: Number(assignment.id),
      before: prior,
      after: patch,
      action: "rent_start",
      entity_type: "railcar",
      entity_id: railcarId,
      railcar_id: railcarId,
      actor,
    });
    await logRentStartHistory(railcarId, assignment, actor, date);
    await recomputeStatus(railcarId);
    const off = !(date && date <= new Date().toISOString().slice(0, 10));
    const noteReport = await appendNotesInGroup({
      entityType: "railcar",
      ids: [railcarId],
      note: appendNote,
      actor,
    });
    return withNoteReport({
      railcar_id: railcarId,
      rent_start_date: date,
      derived_status: derivedFleetStatus({
        sold: false,
        offRent: off,
        onOl: true,
        hasOpenCommitment: false,
      }),
    }, appendNote, noteReport);
  });
}

export async function previewBulkRentStart(
  text: string,
  opts: { date?: string | null; overwrite?: boolean; ids?: number[]; bucket?: string | null },
) {
  const fallback = isoDateOnly(opts.date);
  const parsed = parseCarDateRows(text, fallback);
  const hasCarTokens = parseCarListText(text).some((t) => t.initial);
  if (!hasCarTokens && !(opts.ids && opts.ids.length)) {
    throw Object.assign(new Error("No car numbers found"), { status: 400 });
  }

  const matched: any[] = [];
  const not_found: { raw: string }[] = [];
  const not_on_ol: any[] = [];
  const already_has_date: any[] = [];
  const to_write: any[] = [];
  const rejected_inactive: any[] = [];

  if (opts.ids && opts.ids.length) {
    const ids = Array.from(new Set(opts.ids.filter((n) => Number.isFinite(n) && n > 0)));
    const { data, error } = await supabaseAdmin.from("railcars").select(CAR_SEL).in("id", ids);
    if (error) throw error;
    const found = new Set((data ?? []).map((c: any) => c.id));
    for (const id of ids) {
      if (!found.has(id)) not_found.push({ raw: String(id) });
    }
    for (const car of data ?? []) {
      if (car.active !== true) {
        rejected_inactive.push({
          id: car.id,
          marks: car.reporting_marks,
          car_number: car.car_number,
          rejected: "inactive",
        });
        continue;
      }
      parsed.push({
        initial: String(car.reporting_marks ?? "").trim().toUpperCase(),
        number: String(car.car_number ?? ""),
        date: fallback,
        raw: `${car.reporting_marks} ${car.car_number}`,
      });
    }
  }

  for (const t of parsed) {
    if (!t.initial || !t.number) {
      not_found.push({ raw: t.raw });
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
    if (hits.length !== 1) {
      not_found.push({ raw: t.raw || `${t.initial} ${t.number}` });
      continue;
    }
    const car = hits[0];
    if (car.active !== true) {
      rejected_inactive.push({
        id: car.id,
        marks: car.reporting_marks,
        car_number: car.car_number,
        rejected: "inactive",
      });
      continue;
    }
    if (car.fleet_status === "Sold") {
      not_on_ol.push({
        id: car.id,
        marks: car.reporting_marks,
        car_number: car.car_number,
        reason: "Sold",
      });
      continue;
    }
    const { assignment, rider } = await latestAssignment(car.id);
    const onOl = onOlOf(car, rider?.rider_name, assignment);
    const row = {
      id: car.id,
      assignment_id: assignment?.id ?? null,
      marks: car.reporting_marks,
      car_number: car.car_number,
      entity: car.entity,
      link: rider?.rider_name ?? null,
      lessee: car.lessee_name,
      old_date: assignment?.rent_start_date ?? null,
      new_date: t.date,
      resulting_status:
        t.date && t.date <= new Date().toISOString().slice(0, 10)
          ? "Leased"
          : "Idle",
      implicit: t.date && t.date <= new Date().toISOString().slice(0, 10)
        ? null
        : implicitAwaitingLabel(rider?.rider_name, car.lessee_name),
    };
    if (!onOl) {
      not_on_ol.push({ ...row, reason: "not on OL" });
      continue;
    }
    if (!t.date) {
      not_found.push({ raw: `${t.raw} (missing date)` });
      continue;
    }
    matched.push(row);
    if (row.old_date && !opts.overwrite) {
      already_has_date.push({ ...row, action: "skip" });
      continue;
    }
    to_write.push({ ...row, action: row.old_date ? "overwrite" : "set" });
  }

  const snapshot = {
    overwrite: Boolean(opts.overwrite),
    matched,
    not_found,
    not_on_ol,
    already_has_date,
    rejected_inactive,
    to_write,
    write_ids: to_write.map((r) => ({ id: r.id, assignment_id: r.assignment_id, new_date: r.new_date })),
  };
  const dateById = new Map<number, string | null>(
    (snapshot.write_ids as { id: number; new_date: string | null }[]).map((r) => [r.id, r.new_date]),
  );
  (snapshot as any).kpi_delta = await annotateKpiDelta(
    snapshot.write_ids.map((r: { id: number }) => r.id),
    { kind: "rent_start", dateById },
    opts.bucket,
  );
  const preview_token = await putPreview("rent_start", snapshot);
  return { preview_token, ...snapshot };
}

export async function applyBulkRentStart(previewToken: string, actor: string, appendNote?: unknown) {
  const preview = await getPreview("rent_start", previewToken);
  return withChangeGroupResult(actor, async () => {
    const written = [];
    const ids: number[] = [];
    for (const row of preview.write_ids ?? []) {
      const result = await setRentStartDate(row.id, row.new_date, actor);
      written.push(result);
      ids.push(Number(row.id));
    }
    const noteReport = await appendNotesInGroup({
      entityType: "railcar",
      ids,
      note: appendNote,
      actor,
    });
    return withNoteReport({ written: written.length, rows: written }, appendNote, noteReport);
  });
}

export async function listRentStartWatch(kind: string) {
  const { data: setting } = await supabaseAdmin
    .from("rlms_app_settings")
    .select("value")
    .eq("key", "awaiting_rent_days")
    .maybeSingle();
  const days = Math.max(1, Number(setting?.value) || 60);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  if (kind === "shop") {
    const { data, error } = await supabaseAdmin
      .from("v_rlms_car_kpi")
      .select("railcar_id, reporting_marks, car_number, entity, link_rider, lessee_name, rent_start_date, ops_flag, open_program_shop_id")
      .eq("is_op", true)
      .eq("shop_conflict", true)
      .order("railcar_id")
      .limit(5000);
    if (error) throw error;
    return { kind, days, rows: data ?? [] };
  }
  if (kind === "future") {
    const { data, error } = await supabaseAdmin
      .from("v_rlms_car_kpi")
      .select("railcar_id, reporting_marks, car_number, entity, link_rider, lessee_name, rent_start_date")
      .eq("is_op", true)
      .eq("future_rent_start", true)
      .order("rent_start_date")
      .limit(5000);
    if (error) throw error;
    return { kind, days, rows: data ?? [] };
  }

  const { data, error } = await supabaseAdmin
    .from("v_rlms_car_kpi")
    .select("railcar_id, reporting_marks, car_number, entity, link_rider, lessee_name, assigned_at, rent_start_date, open_program_shop_id, ops_flag")
    .eq("is_op", true)
    .eq("awaiting_rent_start", true)
    .order("railcar_id")
    .limit(5000);
  if (error) throw error;
  const rows = (data ?? [])
    .filter((r: any) => !r.assigned_at || String(r.assigned_at) <= cutoff)
    .map((r: any) => {
      const assigned = r.assigned_at ? new Date(r.assigned_at).getTime() : null;
      const waiting = assigned != null ? Math.floor((Date.now() - assigned) / 86400000) : null;
      return {
        ...r,
        days_waiting: waiting,
        shop: r.open_program_shop_id ?? r.ops_flag ?? null,
      };
    });
  return { kind: "awaiting", days, rows };
}

function errHandler(res: Response, e: any) {
  const status = e?.status || 500;
  res.status(status).json({ message: e?.message || "Error", code: e?.code });
}

export function registerRentStartRoutes(
  app: Express,
  requireWrite: (req: Request, res: Response) => Promise<string | null>,
) {
  app.get("/api/rent-start/car/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { assignment, rider } = await latestAssignment(id);
      const { data: car } = await supabaseAdmin.from("railcars").select(CAR_SEL).eq("id", id).maybeSingle();
      res.json({
        rent_start_date: assignment?.rent_start_date ?? null,
        on_ol: onOlOf(car, rider?.rider_name, assignment),
        rider: rider?.rider_name ?? null,
      });
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/rent-start/car/:id", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await setRentStartDate(
        Number(req.params.id),
        req.body?.date ?? req.body?.rent_start_date ?? null,
        actor,
        req.body?.append_note,
      ));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/rent-start/bulk/preview", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(
        await previewBulkRentStart(String(req.body?.text ?? ""), {
          date: req.body?.date ?? null,
          overwrite: Boolean(req.body?.overwrite),
          ids: Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : undefined,
          bucket: req.body?.bucket ?? null,
        }),
      );
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.post("/api/rent-start/bulk/apply", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await applyBulkRentStart(String(req.body?.preview_token ?? ""), actor, req.body?.append_note));
    } catch (e) {
      errHandler(res, e);
    }
  });

  app.get("/api/rent-start/watch", async (req, res) => {
    try {
      res.json(await listRentStartWatch(String(req.query.kind ?? "awaiting")));
    } catch (e) {
      errHandler(res, e);
    }
  });
}
