import { createHash } from "node:crypto";
import type { Express, Request, Response } from "express";
import { supabaseAdmin } from "./supabase";
import { addNote, resolveRailcarsByAnyIdentity } from "./activity-log";
import { recordChange, withChangeGroupResult } from "./change-log";
import { clearViewCountCache, createSavedView, legacyListCarLists } from "./saved-views";
import { requireUser } from "./auth";
import { applyCarStatusChange } from "./car-status-history";
import { applyMarkSold, applyRemoveSold, clearCommitment, putPreview, getPreview, setCommitment } from "./commitment";
import { setOffRent, setAbatement } from "./rent-stops";
import { formatCarId } from "@shared/residco-import";
import { parseCarPasteList } from "@shared/programs";
import { pickRow } from "@shared/change-log";
import type { CommitmentType } from "@shared/commitment";

export type BulkOpKind =
  | "add_note"
  | "add_tag"
  | "remove_tag"
  | "set_status"
  | "mark_sold"
  | "unmark_sold"
  | "set_commitment"
  | "clear_commitment"
  | "rent_stop"
  | "set_scrapped_at"
  | "set_umler_status"
  | "deactivate"
  | "end_assignment";

export type BulkOp = {
  op: BulkOpKind;
  value?: unknown;
  field?: string;
  type?: string;
  name?: string;
  reason?: string;
  reason_other?: string;
  note?: string;
  buyer?: string;
  effective_date?: string;
  stop_date?: string;
};

export type BulkRow = {
  railcar_id: number;
  car: string;
  field: string;
  before: unknown;
  after: unknown;
  status: "ok" | "warn" | "reject";
  reason: string;
  op: BulkOpKind;
  extra?: Record<string, unknown>;
};

function hashPreview(rows: BulkRow[], ops: BulkOp[]) {
  return createHash("sha256").update(JSON.stringify({ rows, ops })).digest("hex");
}

async function resolveCars(input: { cars?: string[] | string; railcar_ids?: number[] }) {
  const ids: number[] = [];
  const notFound: string[] = [];
  const tokens = Array.isArray(input.cars)
    ? input.cars
    : typeof input.cars === "string"
      ? parseCarPasteList(input.cars)
      : [];
  for (const tok of tokens) {
    const found = await resolveRailcarsByAnyIdentity(String(tok));
    if (!found.length) notFound.push(String(tok));
    else ids.push(...found);
  }
  for (const id of input.railcar_ids ?? []) {
    if (Number.isFinite(id) && id > 0) ids.push(Number(id));
  }
  return { ids: [...new Set(ids)], notFound };
}

async function loadCars(ids: number[]) {
  if (!ids.length) return [];
  const { data, error } = await supabaseAdmin
    .from("railcars")
    .select("id, reporting_marks, car_number, active, status, fleet_status, sold_to, notes, scrapped_at, scrap_source, umler_status, umler_status_at, rider_external_id, lessee_name, lease_start_date")
    .in("id", ids);
  if (error) throw error;
  return data ?? [];
}

function perCarValue(
  perCar: { car?: string; railcar_id?: number; field?: string; value?: unknown }[] | undefined,
  railcarId: number,
  field: string,
): unknown {
  if (!perCar?.length) return undefined;
  const hit = perCar.find((p) => Number(p.railcar_id) === railcarId && (!p.field || p.field === field));
  return hit?.value;
}

export async function previewRailcarBulk(body: {
  cars?: string[] | string;
  railcar_ids?: number[];
  ops?: BulkOp[];
  per_car?: { car?: string; railcar_id?: number; field?: string; value?: unknown }[];
}) {
  const ops = (body.ops ?? []) as BulkOp[];
  const { ids, notFound } = await resolveCars(body);
  const cars = await loadCars(ids);
  const byId = new Map(cars.map((c: any) => [Number(c.id), c]));
  const rows: BulkRow[] = [];

  for (const tok of notFound) {
    rows.push({
      railcar_id: 0,
      car: tok,
      field: "identity",
      before: null,
      after: null,
      status: "reject",
      reason: "not found",
      op: "add_note",
    });
  }

  for (const id of ids) {
    const car = byId.get(id);
    const label = car ? formatCarId(car) : String(id);
    if (!car) {
      rows.push({ railcar_id: id, car: label, field: "identity", before: null, after: null, status: "reject", reason: "not found", op: "add_note" });
      continue;
    }
    if (car.active !== true) {
      rows.push({
        railcar_id: id,
        car: label,
        field: "active",
        before: false,
        after: false,
        status: "reject",
        reason: "inactive – left alone",
        op: "add_note",
      });
      continue;
    }
    for (const op of ops) {
      const field = op.field || op.op;
      const override = perCarValue(body.per_car, id, field);
      const value = override !== undefined ? override : op.value;
      const row = await previewOp(car, op, value, label);
      rows.push(row);
    }
  }

  const preview_hash = hashPreview(rows, ops);
  const token = await putPreview("railcar_bulk", { rows, ops, per_car: body.per_car ?? [], preview_hash });
  const ok = rows.filter((r) => r.status === "ok").length;
  const warn = rows.filter((r) => r.status === "warn").length;
  const reject = rows.filter((r) => r.status === "reject").length;
  return { preview_token: token, preview_hash, rows, counts: { ok, warn, reject } };
}

async function previewOp(car: any, op: BulkOp, value: unknown, label: string): Promise<BulkRow> {
  const id = Number(car.id);
  const base = { railcar_id: id, car: label, op: op.op };
  switch (op.op) {
    case "add_note": {
      const note = String(value ?? op.note ?? "").trim();
      if (!note) return { ...base, field: "notes", before: car.notes, after: null, status: "reject", reason: "empty note" };
      return { ...base, field: "notes", before: car.notes, after: note, status: "ok", reason: "append note" };
    }
    case "add_tag":
    case "remove_tag": {
      const tag = String(value ?? "").trim();
      if (!tag) return { ...base, field: "tag", before: null, after: null, status: "reject", reason: "empty tag" };
      const { data } = await supabaseAdmin.from("car_tags").select("tag").eq("railcar_id", id).eq("tag", tag).maybeSingle();
      if (op.op === "add_tag" && data) return { ...base, field: "tag", before: tag, after: tag, status: "ok", reason: "tag already present (idempotent)" };
      if (op.op === "remove_tag" && !data) return { ...base, field: "tag", before: null, after: null, status: "ok", reason: "tag already absent (idempotent)" };
      return { ...base, field: "tag", before: data?.tag ?? null, after: op.op === "add_tag" ? tag : null, status: "ok", reason: op.op };
    }
    case "set_status": {
      const status = String(value ?? "").trim();
      if (!status) return { ...base, field: "status", before: car.status, after: null, status: "reject", reason: "status required" };
      return { ...base, field: "status", before: car.status, after: status, status: "ok", reason: "set_status" };
    }
    case "mark_sold": {
      const buyer = String(op.buyer ?? value ?? "").trim() || car.sold_to;
      const date = String(op.effective_date ?? "").slice(0, 10) || null;
      if (car.fleet_status === "Sold" && String(car.sold_to ?? "") === String(buyer ?? "")) {
        return { ...base, field: "fleet_status", before: "Sold", after: "Sold", status: "ok", reason: "already Sold (idempotent)" };
      }
      const warn = date && car.lease_start_date && date < String(car.lease_start_date).slice(0, 10);
      return {
        ...base,
        field: "fleet_status",
        before: car.fleet_status,
        after: { fleet_status: "Sold", sold_to: buyer, effective_date: date },
        status: warn ? "warn" : "ok",
        reason: warn ? "sale date before rent start (allowed)" : "mark_sold",
      };
    }
    case "unmark_sold":
      return { ...base, field: "fleet_status", before: car.fleet_status, after: "Idle", status: "ok", reason: "unmark_sold" };
    case "set_commitment":
      return {
        ...base,
        field: "commitment",
        before: null,
        after: { type: op.type, name: op.name ?? value },
        status: "ok",
        reason: "set_commitment",
      };
    case "clear_commitment":
      return { ...base, field: "commitment", before: "open", after: null, status: "ok", reason: "clear_commitment" };
    case "rent_stop": {
      const stopDate = String(op.stop_date ?? value ?? "").slice(0, 10);
      const { data: open } = await supabaseAdmin
        .from("car_rent_stops")
        .select("id, type")
        .eq("railcar_id", id)
        .is("actual_resume_date", null)
        .maybeSingle();
      if (open) {
        return {
          ...base,
          field: "rent_stop",
          before: open.type,
          after: null,
          status: "reject",
          reason: open.type === "Off rent" ? "already off rent" : "existing open stop",
        };
      }
      const today = new Date().toISOString().slice(0, 10);
      const warn =
        (stopDate && car.lease_start_date && stopDate < String(car.lease_start_date).slice(0, 10) && "date before rent_start") ||
        (stopDate && stopDate > today && "date after today") ||
        "";
      return {
        ...base,
        field: "rent_stop",
        before: null,
        after: { type: op.type ?? "Off rent", stop_date: stopDate },
        status: warn ? "warn" : "ok",
        reason: warn || "rent_stop",
      };
    }
    case "set_scrapped_at": {
      const d = String(value ?? "").slice(0, 10);
      if (car.scrapped_at && String(car.scrapped_at).slice(0, 10) === d) {
        return { ...base, field: "scrapped_at", before: car.scrapped_at, after: d, status: "ok", reason: "same scrapped_at (idempotent)" };
      }
      return { ...base, field: "scrapped_at", before: car.scrapped_at, after: d, status: "ok", reason: "set_scrapped_at" };
    }
    case "set_umler_status": {
      const st = String(value ?? "");
      if (st && st !== "delete_requested" && st !== "deleted") {
        return { ...base, field: "umler_status", before: car.umler_status, after: st, status: "reject", reason: "invalid umler_status" };
      }
      return { ...base, field: "umler_status", before: car.umler_status, after: st, status: "ok", reason: "set_umler_status" };
    }
    case "deactivate": {
      if (car.fleet_status === "Sold" && !car.scrapped_at) {
        return { ...base, field: "active", before: true, after: false, status: "reject", reason: "Sold cars cannot be deactivated until scrapped_at is set" };
      }
      return { ...base, field: "active", before: true, after: false, status: "ok", reason: "deactivate" };
    }
    case "end_assignment": {
      const { data: open } = await supabaseAdmin
        .from("assignment_history")
        .select("id, end_date, rider_external_id, to_rider_id")
        .eq("railcar_id", id)
        .is("end_date", null)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!open) {
        return { ...base, field: "assignment_end", before: null, after: null, status: "reject", reason: "assignment already ended" };
      }
      const date = String(value ?? op.effective_date ?? "").slice(0, 10);
      return {
        ...base,
        field: "assignment_end",
        before: { id: open.id, end_date: null, lease: open.rider_external_id },
        after: { id: open.id, end_date: date },
        status: "ok",
        reason: "end_assignment",
      };
    }
    default: {
      const _never: never = op.op;
      return { ...base, field: String(_never), before: null, after: null, status: "reject", reason: "unknown op" };
    }
  }
}

export async function applyRailcarBulk(token: string, hash: string, actor: string) {
  const snap = await getPreview("railcar_bulk", token);
  const expected = String(snap.preview_hash ?? "");
  if (!hash || hash !== expected) {
    throw Object.assign(new Error("preview_hash mismatch"), { status: 409 });
  }
  return withChangeGroupResult(actor, async () => {
    let applied = 0;
    const errors: { car: string; reason: string }[] = [];
    for (const row of snap.rows ?? []) {
      if (row.status === "reject") continue;
      try {
        await applyRow(row, snap.ops ?? [], actor);
        applied += 1;
      } catch (e: any) {
        errors.push({ car: row.car, reason: e.message });
      }
    }
    clearViewCountCache();
    return { applied, errors, undoable: true };
  });
}

async function applyRow(row: BulkRow, ops: BulkOp[], actor: string) {
  const id = Number(row.railcar_id);
  const op = ops.find((o) => o.op === row.op) ?? { op: row.op };
  switch (row.op) {
    case "add_note":
      await addNote({ entity_type: "railcar", entity_id: id, body: String(row.after ?? ""), actor });
      return;
    case "add_tag": {
      const tag = String(row.after ?? "");
      const { data: existing } = await supabaseAdmin.from("car_tags").select("id, tag").eq("railcar_id", id).eq("tag", tag).maybeSingle();
      if (existing) return;
      const { data, error } = await supabaseAdmin
        .from("car_tags")
        .insert({ railcar_id: id, tag, created_by: actor })
        .select()
        .single();
      if (error) throw error;
      await recordChange({
        table: "car_tags",
        pk: Number(data.id),
        before: {},
        after: data,
        action: "add_tag",
        entity_type: "railcar",
        entity_id: id,
        railcar_id: id,
        actor,
      });
      return;
    }
    case "remove_tag": {
      const tag = String(row.before ?? "");
      const { data: existing } = await supabaseAdmin.from("car_tags").select("id, tag").eq("railcar_id", id).eq("tag", tag).maybeSingle();
      if (!existing) return;
      const { error } = await supabaseAdmin.from("car_tags").delete().eq("id", existing.id);
      if (error) throw error;
      await recordChange({
        table: "car_tags",
        pk: Number(existing.id),
        before: existing,
        after: {},
        action: "remove_tag",
        entity_type: "railcar",
        entity_id: id,
        railcar_id: id,
        actor,
      });
      return;
    }
    case "set_status":
      await applyCarStatusChange({ ids: [id], status: String(row.after ?? ""), reason: op.reason, userId: actor });
      return;
    case "mark_sold": {
      const after = row.after as any;
      const preview = await putPreview("sold", {
        cars: [{ id, proposed_sold_to: after?.sold_to, sold_to: after?.sold_to, fleet_status: null }],
      });
      await applyMarkSold(preview, actor, { sold_to: after?.sold_to, effective_date: after?.effective_date });
      return;
    }
    case "unmark_sold": {
      const preview = await putPreview("unsold", { ids: [id], cars: [{ id }] });
      await applyRemoveSold(preview, actor);
      return;
    }
    case "set_commitment": {
      const after = row.after as any;
      await setCommitment(id, { type: after.type as CommitmentType, name: String(after.name ?? "") }, actor, { overwrite: true });
      return;
    }
    case "clear_commitment":
      await clearCommitment(id, actor);
      return;
    case "rent_stop": {
      const after = row.after as any;
      const body = {
        stop_date: after?.stop_date,
        reason: op.reason ?? "other",
        reason_other: op.reason_other,
        note: op.note,
      };
      if (String(after?.type ?? "Off rent") === "Abatement") await setAbatement(id, body, actor);
      else await setOffRent(id, body, actor);
      return;
    }
    case "set_scrapped_at": {
      const { data: prior } = await supabaseAdmin.from("railcars").select("scrapped_at, scrap_source").eq("id", id).maybeSingle();
      const patch = { scrapped_at: row.after, scrap_source: String(op.note ?? op.value ?? prior?.scrap_source ?? "manual") };
      const { error } = await supabaseAdmin.from("railcars").update(patch).eq("id", id).eq("active", true);
      if (error) throw error;
      await recordChange({
        table: "railcars",
        pk: id,
        before: pickRow(prior, ["scrapped_at", "scrap_source"]),
        after: patch,
        action: "set_scrapped_at",
        entity_type: "railcar",
        entity_id: id,
        railcar_id: id,
        actor,
      });
      return;
    }
    case "set_umler_status": {
      const { data: prior } = await supabaseAdmin.from("railcars").select("umler_status, umler_status_at").eq("id", id).maybeSingle();
      const patch = { umler_status: row.after, umler_status_at: new Date().toISOString().slice(0, 10) };
      const { error } = await supabaseAdmin.from("railcars").update(patch).eq("id", id);
      if (error) throw error;
      await recordChange({
        table: "railcars",
        pk: id,
        before: pickRow(prior, ["umler_status", "umler_status_at"]),
        after: patch,
        action: "set_umler_status",
        entity_type: "railcar",
        entity_id: id,
        railcar_id: id,
        actor,
      });
      return;
    }
    case "deactivate":
      await applyCarStatusChange({ ids: [id], status: "Inactive", reason: op.reason || "scrapped / UMLER deleted", userId: actor });
      return;
    case "end_assignment": {
      const after = row.after as any;
      const pk = Number(after?.id ?? (row.before && (row.before as any).id));
      const { data: prior } = await supabaseAdmin.from("assignment_history").select("id, end_date").eq("id", pk).maybeSingle();
      if (!prior) throw new Error("assignment row missing");
      if (prior.end_date) throw new Error("assignment already ended");
      const { error } = await supabaseAdmin.from("assignment_history").update({ end_date: after.end_date }).eq("id", pk);
      if (error) throw error;
      await recordChange({
        table: "assignment_history",
        pk,
        before: { end_date: prior.end_date },
        after: { end_date: after.end_date },
        action: "end_assignment",
        entity_type: "railcar",
        entity_id: id,
        railcar_id: id,
        actor,
      });
      return;
    }
    default: {
      const _never: never = row.op;
      throw new Error(`unknown op ${_never}`);
    }
  }
}

export function registerRailcarBulkRoutes(
  app: Express,
  requireWrite: (req: Request, res: Response) => Promise<string | null>,
) {
  app.post("/api/railcars/bulk/preview", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      res.json(await previewRailcarBulk(req.body ?? {}));
    } catch (e: any) {
      res.status(e?.status || 500).json({ message: e.message });
    }
  });
  app.get("/api/railcars/lists", async (req, res) => {
    try {
      const actor = await requireUser(req, res);
      if (!actor) return;
      res.json(await legacyListCarLists(actor));
    } catch (e: any) {
      res.status(e?.status || 500).json({ message: e.message });
    }
  });
  app.post("/api/railcars/lists", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const role = req.authRole || "editor";
      const result = await createSavedView({ id: actor, role }, {
        name: req.body?.name,
        kind: Array.isArray(req.body?.railcar_ids) && req.body.railcar_ids.length ? "fixed" : (req.body?.kind ?? "fixed"),
        shared: req.body?.shared === true,
        query: req.body?.query ?? {},
        layout: req.body?.layout ?? {},
        pinned: false,
        railcar_ids: req.body?.railcar_ids,
        text: req.body?.text,
      });
      res.json(result);
      return;
    } catch (e: any) {
      if (e?.status !== 503) {
        res.status(e?.status || 500).json({ message: e.message });
        return;
      }
    }
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const result = await withChangeGroupResult(actor, async () => {
        const { data, error } = await supabaseAdmin
          .from("car_lists")
          .insert({
            name: String(req.body?.name ?? "Untitled"),
            owner: actor,
            shared: Boolean(req.body?.shared),
            query: req.body?.query ?? null,
          })
          .select()
          .single();
        if (error) throw error;
        await recordChange({
          table: "car_lists",
          pk: Number(data.id),
          before: {},
          after: data,
          action: "create_car_list",
          actor,
        });
        const ids: number[] = Array.isArray(req.body?.railcar_ids) ? req.body.railcar_ids.map(Number) : [];
        if (ids.length) {
          const { data: mems, error: me } = await supabaseAdmin
            .from("car_list_members")
            .insert(ids.map((railcar_id) => ({ list_id: data.id, railcar_id })))
            .select();
          if (me) throw me;
          for (const m of mems ?? []) {
            await recordChange({
              table: "car_list_members",
              pk: Number(m.id),
              before: {},
              after: m,
              action: "add_list_member",
              railcar_id: Number(m.railcar_id),
              actor,
            });
          }
        }
        return data;
      });
      res.json(result);
    } catch (e: any) {
      res.status(e?.status || 500).json({ message: e.message });
    }
  });
  app.get("/api/railcars/umler-queue", async (_req, res) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("railcars")
        .select("id, reporting_marks, car_number, scrapped_at, umler_status, umler_status_at, active, fleet_status")
        .not("scrapped_at", "is", null)
        .or("umler_status.is.null,umler_status.eq.delete_requested")
        .eq("active", true)
        .order("scrapped_at", { ascending: true });
      if (error) throw error;
      res.json(data ?? []);
    } catch (e: any) {
      res.status(e?.status || 500).json({ message: e.message });
    }
  });

  app.post("/api/railcars/bulk/apply", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      res.json(await applyRailcarBulk(String(req.body?.preview_token ?? ""), String(req.body?.preview_hash ?? ""), actor));
    } catch (e: any) {
      res.status(e?.status || 500).json({ message: e.message });
    }
  });
}
