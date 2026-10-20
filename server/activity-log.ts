import { splitCarNumber } from "@shared/residco-import";
import { asOne } from "@shared/lease-type";
import type { ActivityEntityType } from "@shared/change-log";
import { formatUsDateTimeEt } from "@shared/display-date";
import {
  appendTimestampedNote,
  capActivityEvents,
  noteWriteDecision,
} from "@shared/lineage-notes";
import { currentChangeGroup, recordChange, withChangeGroupResult } from "./change-log";
import { supabaseAdmin } from "./supabase";

export type { ActivityEntityType };

export type ActivityRow = {
  entity_type: ActivityEntityType;
  entity_id: number;
  action: string;
  actor?: string | null;
  railcar_id?: number | null;
  rider_id?: number | null;
  detail?: Record<string, unknown>;
  source?: string;
  occurred_at?: string;
  source_table?: string | null;
  source_id?: number | null;
  change_group?: string | null;
  table_name?: string | null;
  row_pk?: number | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  undoable?: boolean;
  undo_of?: number | null;
};

function carNumberVariants(n: string): string[] {
  const out = new Set<string>();
  const raw = String(n ?? "").trim();
  if (!raw) return [];
  out.add(raw);
  const stripped = raw.replace(/^0+/, "") || "0";
  out.add(stripped);
  if (/^\d+$/.test(stripped)) out.add(stripped.padStart(6, "0"));
  return [...out];
}

export async function logActivity(row: ActivityRow): Promise<void> {
  const payload: Record<string, unknown> = {
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    action: row.action,
    actor: row.actor ?? null,
    railcar_id: row.railcar_id ?? (row.entity_type === "railcar" ? row.entity_id : null),
    rider_id: row.rider_id ?? (row.entity_type === "rider" ? row.entity_id : null),
    detail: row.detail ?? {},
    source: row.source ?? "ui",
    occurred_at: row.occurred_at ?? new Date().toISOString(),
    source_table: row.source_table ?? null,
    source_id: row.source_id ?? null,
    change_group: row.change_group ?? currentChangeGroup(),
    table_name: row.table_name ?? null,
    row_pk: row.row_pk ?? null,
    before: row.before ?? null,
    after: row.after ?? null,
    undoable: row.undoable ?? true,
    undo_of: row.undo_of ?? null,
  };
  const { error } = await supabaseAdmin.from("activity_log").insert(payload);
  if (error) console.log(`[activity] log skipped: ${error.message}`);
}

/**
 * Shared identity lookup for Search, programs, and bulk tools.
 * A single "MARK 123" survives splitCarNumber stripping spaces. Lineage lists,
 * ranges, and bare marks use resolveLineageRailcars instead.
 */
export async function resolveRailcarsByAnyIdentity(raw: string): Promise<number[]> {
  const groups = String(raw ?? "")
    .split(/[\n\r,;]+/)
    .map((g) => g.trim())
    .filter(Boolean);
  const ids = new Set<number>();
  for (const group of groups.length ? groups : [String(raw ?? "").trim()]) {
    if (!group) continue;
    const split = splitCarNumber(group);
    if (!split.car_number) continue;
    const variants = carNumberVariants(split.car_number);
    const mark = split.reporting_marks ? split.reporting_marks.toUpperCase() : null;

    const { data: current, error: cErr } = await supabaseAdmin
      .from("railcars")
      .select("id, car_number, reporting_marks, car_initial")
      .in("car_number", variants);
    if (cErr) {
      console.log(`[activity] current-identity lookup skipped: ${cErr.message}`);
    } else {
      for (const c of current ?? []) {
        if (mark) {
          const rm = String(c.reporting_marks ?? "").trim().toUpperCase();
          const ci = String(c.car_initial ?? "").trim().toUpperCase();
          if (rm !== mark && ci !== mark) continue;
        }
        ids.add(Number(c.id));
      }
    }

    // Bare number: same fan-out as global Search (ilike on current + history numbers)
    if (!mark && /^\d+$/.test(split.car_number)) {
      const like = `%${split.car_number}%`;
      const { data: ilikeCars, error: iErr } = await supabaseAdmin
        .from("railcars")
        .select("id")
        .ilike("car_number", like)
        .limit(80);
      if (iErr) console.log(`[activity] bare-number ilike skipped: ${iErr.message}`);
      for (const c of ilikeCars ?? []) ids.add(Number(c.id));
      const { data: histLikeOld, error: hoErr } = await supabaseAdmin
        .from("car_number_history")
        .select("railcar_id")
        .ilike("old_car_number", like)
        .limit(80);
      const { data: histLikeNew, error: hnErr } = await supabaseAdmin
        .from("car_number_history")
        .select("railcar_id")
        .ilike("new_car_number", like)
        .limit(80);
      if (hoErr) console.log(`[activity] bare-number history old skipped: ${hoErr.message}`);
      if (hnErr) console.log(`[activity] bare-number history new skipped: ${hnErr.message}`);
      for (const h of [...(histLikeOld ?? []), ...(histLikeNew ?? [])]) {
        const id = Number(h.railcar_id);
        if (id) ids.add(id);
      }
    }

    const { data: oldHits, error: oErr } = await supabaseAdmin
      .from("car_number_history")
      .select("railcar_id, old_car_initial, old_car_number, new_car_initial, new_car_number")
      .in("old_car_number", variants);
    const { data: newHits, error: nErr } = await supabaseAdmin
      .from("car_number_history")
      .select("railcar_id, old_car_initial, old_car_number, new_car_initial, new_car_number")
      .in("new_car_number", variants);
    if (oErr) console.log(`[activity] prior-identity lookup skipped: ${oErr.message}`);
    if (nErr) console.log(`[activity] new-identity history lookup skipped: ${nErr.message}`);
    for (const h of [...(oldHits ?? []), ...(newHits ?? [])]) {
      if (mark) {
        const oldM = String(h.old_car_initial ?? "").trim().toUpperCase();
        const newM = String(h.new_car_initial ?? "").trim().toUpperCase();
        if (oldM !== mark && newM !== mark) continue;
      }
      const id = Number(h.railcar_id);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

const RESOLVED_CAR_SELECTS = [
  "id, car_number, reporting_marks, car_type, status, fleet_status, entity, active, mechanical_designation, lessee_name, rider_external_id, lease_type, ops_flag, assignment:railcar_assignments(id, fleet_name, rider:riders(id, rider_name, schedule_number, master_lease:master_leases(id, lease_number, lessee, lease_type)))",
  "id, car_number, reporting_marks, car_type, status, fleet_status, entity, active, mechanical_designation, lessee_name, rider_external_id, lease_type, assignment:railcar_assignments(id, fleet_name, rider:riders(id, rider_name, schedule_number, master_lease:master_leases(id, lease_number, lessee, lease_type)))",
  "id, car_number, reporting_marks, car_type, status, fleet_status, entity, active, lessee_name, rider_external_id, assignment:railcar_assignments(id, fleet_name, rider:riders(id, rider_name, master_lease:master_leases(id, lease_number, lessee)))",
  "id, car_number, reporting_marks, car_type, status, fleet_status, entity, active, lessee_name, rider_external_id",
  "id, car_number, reporting_marks, active",
];

function mapHydratedCar(row: any) {
  const assignment = asOne(row.assignment);
  const rider = asOne(assignment?.rider);
  const master_lease = asOne(rider?.master_lease);
  return {
    ...row,
    id: Number(row.id),
    assignment: assignment
      ? { ...assignment, rider: rider ? { ...rider, master_lease } : null }
      : null,
  };
}

async function hydrateRailcars(ids: number[]) {
  const uniq = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniq.length) return [];
  const slice = uniq.slice(0, 80);
  for (const select of RESOLVED_CAR_SELECTS) {
    const { data, error } = await supabaseAdmin.from("railcars").select(select).in("id", slice);
    if (error) {
      console.log(`[activity] hydrate railcars select failed: ${error.message}`);
      continue;
    }
    const byId = new Map((data ?? []).map((row: any) => [Number(row.id), mapHydratedCar(row)]));
    const out = uniq.map((id) => byId.get(id)).filter(Boolean);
    if (out.length) return out;
    console.log(`[activity] hydrate railcars returned 0 rows for ids=${slice.join(",")}`);
  }
  return [];
}

async function hydrateRiders(ids: number[]) {
  const uniq = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniq.length) return [];
  const { data, error } = await supabaseAdmin
    .from("riders")
    .select("id, rider_name, schedule_number, expiration_date, master_lease:master_leases(id, lease_number, lessee, lease_type)")
    .in("id", uniq.slice(0, 80));
  if (error) {
    console.log(`[activity] hydrate riders skipped: ${error.message}`);
    return [];
  }
  const byId = new Map(
    (data ?? []).map((r: any) => [Number(r.id), { ...r, master_lease: asOne(r.master_lease) }]),
  );
  return uniq.map((id) => byId.get(id)).filter(Boolean);
}

export async function resolveRidersByQuery(raw: string): Promise<number[]> {
  const q = String(raw ?? "").trim().replace(/[%*,()]/g, " ").trim();
  if (!q) return [];
  // Pure car numbers are not rider queries — Search fans those out on cars only.
  if (/^\d+$/.test(q)) return [];
  const like = `%${q}%`;
  const ids = new Set<number>();
  const { data: riders, error: rErr } = await supabaseAdmin
    .from("riders")
    .select("id, rider_name, schedule_number")
    .or(`rider_name.ilike."${like}",schedule_number.ilike."${like}"`)
    .limit(80);
  if (rErr) console.log(`[activity] rider lookup skipped: ${rErr.message}`);
  for (const r of riders ?? []) ids.add(Number(r.id));

  const { data: leases, error: lErr } = await supabaseAdmin
    .from("master_leases")
    .select("id, lease_number")
    .ilike("lease_number", like)
    .limit(40);
  if (lErr) console.log(`[activity] lease lookup skipped: ${lErr.message}`);
  const leaseIds = (leases ?? []).map((l: any) => Number(l.id)).filter(Boolean);
  if (leaseIds.length) {
    const { data: under, error: uErr } = await supabaseAdmin
      .from("riders")
      .select("id")
      .in("master_lease_id", leaseIds)
      .limit(80);
    if (uErr) console.log(`[activity] riders-by-lease lookup skipped: ${uErr.message}`);
    for (const r of under ?? []) ids.add(Number(r.id));
  }
  return [...ids];
}

export type ListActivityOpts = {
  railcarId?: number;
  riderId?: number;
  q?: string;
  includeVcfNoise?: boolean;
  limit?: number;
  /** When set, Lineage has already resolved cars and the shared parser is skipped. */
  resolvedRailcarIds?: number[];
};

export async function listActivityLog(opts: ListActivityOpts) {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 1000);
  const qText = opts.q != null ? String(opts.q).trim() : "";
  let railcarIds: number[] = opts.railcarId ? [opts.railcarId] : [];
  let riderIds: number[] = opts.riderId ? [opts.riderId] : [];
  const resolved = {
    railcar_ids: [] as number[],
    rider_ids: [] as number[],
    railcars: [] as any[],
    riders: [] as any[],
  };

  if (qText) {
    const [cars, riders] = await Promise.all([
      opts.resolvedRailcarIds ?? resolveRailcarsByAnyIdentity(qText),
      resolveRidersByQuery(qText),
    ]);
    if (!opts.railcarId) railcarIds = cars;
    if (!opts.riderId) riderIds = riders;
    resolved.railcar_ids = cars;
    resolved.rider_ids = riders;
    const [railcars, riderRows] = await Promise.all([
      hydrateRailcars(cars),
      hydrateRiders(riders),
    ]);
    resolved.railcars = railcars;
    resolved.riders = riderRows;
  }

  if (!railcarIds.length && !riderIds.length && qText) {
    return { events: [], resolved, query: qText };
  }

  const pageSize = 500;
  const scanned: any[] = [];
  for (let offset = 0; offset < 20000; offset += pageSize) {
    let page = supabaseAdmin
      .from("activity_log")
      .select(
        `*,
        railcar:railcars(id, car_number, reporting_marks),
        rider:riders(id, rider_name, schedule_number, master_lease:master_leases(id, lease_number))`,
      )
      .order("occurred_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (railcarIds.length && riderIds.length) {
      page = page.or(
        `railcar_id.in.(${railcarIds.join(",")}),rider_id.in.(${riderIds.join(",")})`,
      );
    } else if (railcarIds.length) {
      page = page.in("railcar_id", railcarIds);
    } else if (riderIds.length) {
      page = page.in("rider_id", riderIds);
    }

    const { data, error } = await page;
    if (error) throw error;
    const batch = (data ?? []).map((row: any) => ({
      ...row,
      railcar: Array.isArray(row.railcar) ? row.railcar[0] ?? null : row.railcar,
      rider: Array.isArray(row.rider) ? row.rider[0] ?? null : row.rider,
    }));
    scanned.push(...batch);
    const keptSoFar = capActivityEvents(scanned, limit, Boolean(opts.includeVcfNoise));
    if (keptSoFar.length >= limit || batch.length < pageSize) break;
  }
  const events = capActivityEvents(scanned, limit, Boolean(opts.includeVcfNoise));
  return { events, resolved, query: qText || null };
}

export async function addNote(opts: {
  entity_type: ActivityEntityType;
  entity_id: number;
  body: string;
  actor?: string | null;
}): Promise<any> {
  const body = String(opts.body ?? "").trim();
  if (!body) throw Object.assign(new Error("Note text is required"), { status: 400 });
  const actor = opts.actor ?? null;
  const occurred_at = new Date().toISOString();

  const stamp = formatUsDateTimeEt(occurred_at);

  if (opts.entity_type === "railcar") {
    return withChangeGroupResult(actor || "system", async () => {
      const { data: prior, error: priorErr } = await supabaseAdmin
        .from("railcars")
        .select("id, notes, active, status")
        .eq("id", opts.entity_id)
        .maybeSingle();
      if (priorErr) throw priorErr;
      const decision = noteWriteDecision(prior);
      if (!decision.ok) {
        throw Object.assign(new Error(decision.message), { status: decision.status });
      }
      const notes = appendTimestampedNote(prior?.notes, body, stamp);
      const { error: updErr } = await supabaseAdmin
        .from("railcars")
        .update({ notes })
        .eq("id", opts.entity_id);
      if (updErr) throw updErr;
      const rec = await recordChange({
        table: "railcars",
        pk: opts.entity_id,
        before: { notes: prior?.notes ?? null },
        after: { notes },
        action: "note",
        entity_type: "railcar",
        entity_id: opts.entity_id,
        railcar_id: opts.entity_id,
        actor,
        force: true,
        detail: { body },
        occurred_at,
      });
      return { id: rec?.id ?? null, action: "note" };
    });
  }

  return withChangeGroupResult(actor || "system", async () => {
    const { data: prior, error: priorErr } = await supabaseAdmin
      .from("riders")
      .select("id, notes")
      .eq("id", opts.entity_id)
      .maybeSingle();
    if (priorErr) throw priorErr;
    if (!prior) throw Object.assign(new Error("Rider not found"), { status: 404 });
    const notes = appendTimestampedNote(prior.notes, body, stamp);
    const { error: updErr } = await supabaseAdmin
      .from("riders")
      .update({ notes })
      .eq("id", opts.entity_id);
    if (updErr) throw updErr;
    const rec = await recordChange({
      table: "riders",
      pk: opts.entity_id,
      before: { notes: prior.notes ?? null },
      after: { notes },
      action: "note",
      entity_type: "rider",
      entity_id: opts.entity_id,
      railcar_id: null,
      rider_id: opts.entity_id,
      actor,
      force: true,
      detail: { body },
      occurred_at,
    });
    return { id: rec?.id ?? null, action: "note" };
  });
}
