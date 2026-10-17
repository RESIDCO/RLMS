import { pickRow } from "@shared/change-log";
import { assignmentRentStartOnMove, isoDateOnly } from "@shared/commitment";
import { putOnRentProgramTypes } from "@shared/programs";
import { formatCarId } from "@shared/residco-import";
import { recordChange, withChangeGroupResult } from "./change-log";
import { getPreview, putPreview, recomputeStatus } from "./commitment";
import { pointCurrentAssignmentAt } from "./current-assignment";
import { annotateKpiDelta } from "./kpi-delta";
import { loadOlIdentity, railcarIdentityPatch } from "./ol-identity";
import { appendProgramCarMilestone, logProgramActivity } from "./programs";
import { loadProgramRow } from "./program-previews";
import { supabaseAdmin } from "./supabase";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function assertWritable(program: { overlay_lifecycle: string }) {
  if (program.overlay_lifecycle === "closed" || program.overlay_lifecycle === "cancelled") {
    throw Object.assign(new Error("Closed/cancelled programs are read-only (put on rent)"), { status: 400 });
  }
}

export async function previewPutOnRent(
  programId: number,
  body: { link_ids?: number[]; rider_id?: number; rent_start_date?: string; overwrite?: boolean },
) {
  const program = await loadProgramRow(programId);
  assertWritable(program);
  const type = String(program.type ?? "");
  if (!(putOnRentProgramTypes() as readonly string[]).includes(type)) {
    throw Object.assign(new Error("Put on rent is only for Return and New Assignment programs"), { status: 400 });
  }
  const riderId = Number(body.rider_id);
  const date = isoDateOnly(body.rent_start_date) ?? todayIso();
  if (!Number.isFinite(riderId) || riderId <= 0) {
    throw Object.assign(new Error("rider_id required"), { status: 400 });
  }
  const identity = await loadOlIdentity(riderId);
  if (!identity) throw Object.assign(new Error("Destination rider not found"), { status: 400 });

  const ids = [...new Set((body.link_ids ?? []).map(Number).filter((n) => n > 0))];
  const { data: links, error } = await supabaseAdmin
    .from("program_cars")
    .select("id, railcar_id, exited_date, railcar:railcars(id, active, fleet_status, reporting_marks, car_number)")
    .eq("program_id", programId)
    .in("id", ids.length ? ids : [0]);
  if (error) throw error;

  const railcarIds = (links ?? []).map((l: any) => Number(l.railcar_id));
  const { data: assigns } = await supabaseAdmin
    .from("railcar_assignments")
    .select("id, railcar_id, rider_id, fleet_name, rent_start_date, rent_start_set_by, rent_start_set_at")
    .in("railcar_id", railcarIds.length ? railcarIds : [0]);
  const assignBy = new Map((assigns ?? []).map((a: any) => [Number(a.railcar_id), a]));

  const to_write: any[] = [];
  const already_on_rider: any[] = [];
  const rejected_inactive: any[] = [];
  const rejected_sold: any[] = [];
  const not_writable: any[] = [];
  const skip_has_date: any[] = [];

  for (const l of links ?? []) {
    const rc = Array.isArray((l as any).railcar) ? (l as any).railcar[0] : (l as any).railcar;
    const base = {
      link_id: l.id,
      railcar_id: Number(l.railcar_id),
      label: rc ? formatCarId(rc) : String(l.railcar_id),
    };
    if (l.exited_date) {
      not_writable.push(base);
      continue;
    }
    if (rc?.active !== true) {
      rejected_inactive.push(base);
      continue;
    }
    if (String(rc?.fleet_status ?? "") === "Sold") {
      rejected_sold.push(base);
      continue;
    }
    const asg = assignBy.get(Number(l.railcar_id));
    const same = asg && Number(asg.rider_id) === riderId;
    const oldDate = asg?.rent_start_date ? String(asg.rent_start_date).slice(0, 10) : null;
    if (same && oldDate && !body.overwrite) {
      skip_has_date.push({ ...base, old_date: oldDate });
      continue;
    }
    const row = {
      ...base,
      assignment_id: asg?.id ?? null,
      from_rider_id: asg?.rider_id ?? null,
      needs_move: !same,
      old_date: oldDate,
      new_date: date,
    };
    if (same) already_on_rider.push(row);
    to_write.push(row);
  }

  const dateById = new Map<number, string | null>(to_write.map((r) => [r.railcar_id, date]));
  const kpi_delta = await annotateKpiDelta(
    to_write.map((r) => r.railcar_id),
    { kind: "rent_start", dateById },
  );
  const snapshot = {
    action: "put_on_rent",
    program_id: programId,
    rider_id: riderId,
    rent_start_date: date,
    overwrite: Boolean(body.overwrite),
    rider_label: identity.rider_name ?? identity.schedule_number ?? String(riderId),
    to_write,
    already_on_rider,
    skip_has_date,
    rejected_inactive,
    rejected_sold,
    not_writable,
    kpi_delta,
  };
  return { preview_token: await putPreview("program", snapshot), ...snapshot };
}

export async function applyPutOnRent(token: string, actor: string) {
  return withChangeGroupResult(actor, async () => {
    const preview = await getPreview("program", token);
    if (preview.action !== "put_on_rent") throw Object.assign(new Error("Wrong preview kind"), { status: 400 });
    const program = await loadProgramRow(Number(preview.program_id));
    assertWritable(program);
    const riderId = Number(preview.rider_id);
    const date = String(preview.rent_start_date).slice(0, 10);
    const identity = await loadOlIdentity(riderId);
    if (!identity) throw Object.assign(new Error("Destination rider not found"), { status: 400 });
    const movedAt = new Date().toISOString();
    let written = 0;
    for (const row of preview.to_write ?? []) {
      const { data: car } = await supabaseAdmin
        .from("railcars")
        .select("id, active, fleet_status")
        .eq("id", row.railcar_id)
        .maybeSingle();
      if (car?.active !== true || car?.fleet_status === "Sold") continue;

      const { data: currentAssigns, error: caErr } = await supabaseAdmin
        .from("railcar_assignments")
        .select("id, railcar_id, rider_id, fleet_name, rent_start_date, rent_start_set_by, rent_start_set_at")
        .eq("railcar_id", row.railcar_id)
        .order("id", { ascending: false })
        .limit(1);
      if (caErr) throw caErr;
      const prev = (currentAssigns ?? [])[0] ?? null;
      const fromRiderId = prev?.rider_id ?? null;
      const fromFleet = prev?.fleet_name ?? null;
      const targetFleet = identity.canonical_lessee ?? fromFleet;
      const rent = assignmentRentStartOnMove({
        fromRiderId,
        toRiderId: riderId,
        prevDate: prev?.rent_start_date ?? null,
        prevSetBy: prev?.rent_start_set_by ?? null,
        prevSetAt: prev?.rent_start_set_at ?? null,
        dateSupplied: true,
        suppliedDate: date,
        actor,
        movedAt,
      });
      const assignAfter = {
        rider_id: riderId,
        fleet_name: targetFleet,
        assigned_at: movedAt,
        rent_start_date: rent.rent_start_date,
        rent_start_set_by: rent.rent_start_set_by,
        rent_start_set_at: rent.rent_start_set_at,
      };
      if (prev) {
        const { error: uErr } = await supabaseAdmin.from("railcar_assignments").update(assignAfter).eq("id", prev.id);
        if (uErr) throw uErr;
        await pointCurrentAssignmentAt(supabaseAdmin, [{ id: prev.id, railcar_id: row.railcar_id }]);
        await recordChange({
          table: "railcar_assignments",
          pk: Number(prev.id),
          before: pickRow(prev, ["rider_id", "fleet_name", "rent_start_date", "rent_start_set_by", "rent_start_set_at"]),
          after: assignAfter,
          action: "program_put_on_rent",
          entity_type: "railcar",
          entity_id: row.railcar_id,
          railcar_id: row.railcar_id,
          rider_id: riderId,
          actor,
        });
      } else {
        const { data: ins, error: iErr } = await supabaseAdmin
          .from("railcar_assignments")
          .insert({ railcar_id: row.railcar_id, ...assignAfter })
          .select("id, railcar_id")
          .single();
        if (iErr) throw iErr;
        await pointCurrentAssignmentAt(supabaseAdmin, ins ? [ins] : []);
        await recordChange({
          table: "railcar_assignments",
          pk: ins?.id != null ? Number(ins.id) : null,
          before: {},
          after: { railcar_id: row.railcar_id, ...assignAfter },
          action: "program_put_on_rent",
          entity_type: "railcar",
          entity_id: row.railcar_id,
          railcar_id: row.railcar_id,
          rider_id: riderId,
          actor,
        });
      }
      const carPatch = railcarIdentityPatch(identity, targetFleet);
      const identKeys = Object.keys(carPatch);
      const { data: carPrior } = await supabaseAdmin
        .from("railcars")
        .select("id, lessee_name, rider_external_id, assignment_label, lease_type")
        .eq("id", row.railcar_id)
        .maybeSingle();
      const { error: carErr } = await supabaseAdmin.from("railcars").update(carPatch).eq("id", row.railcar_id);
      if (carErr) throw carErr;
      await recordChange({
        table: "railcars",
        pk: row.railcar_id,
        before: pickRow(carPrior, identKeys),
        after: pickRow({ ...(carPrior ?? {}), ...carPatch }, identKeys),
        action: "program_put_on_rent",
        entity_type: "railcar",
        entity_id: row.railcar_id,
        railcar_id: row.railcar_id,
        actor,
      });
      await supabaseAdmin.from("assignment_history").insert({
        railcar_id: row.railcar_id,
        from_rider_id: fromRiderId,
        to_rider_id: riderId,
        from_fleet_name: fromFleet,
        to_fleet_name: targetFleet,
        moved_at: movedAt,
        moved_by: actor,
        reason: `Program put on rent (${date})`,
      });
      await recomputeStatus(row.railcar_id);
      await supabaseAdmin
        .from("program_cars")
        .update({ milestone: "On rent", milestone_at: date })
        .eq("id", row.link_id)
        .eq("program_id", program.id);
      await appendProgramCarMilestone({
        programCarId: row.link_id,
        milestone: "On rent",
        milestoneDate: date,
        actor,
      });
      await logProgramActivity({
        program_id: program.id,
        action: "put_on_rent",
        actor,
        program_car_id: row.link_id,
        railcar_id: row.railcar_id,
        detail: { rider_id: riderId, rent_start_date: date },
        before: { rent_start_date: row.old_date ?? null },
        after: { rent_start_date: date, rider_id: riderId },
      });
      written += 1;
    }
    await supabaseAdmin.from("programs").update({ updated_at: new Date().toISOString() }).eq("id", program.id);
    return { preview, written };
  });
}
