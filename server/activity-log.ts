import { splitCarNumber } from "@shared/residco-import";
import { asOne } from "@shared/lease-type";
import { supabaseAdmin } from "./supabase";

export type ActivityEntityType = "railcar" | "rider";

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
  };
  const { error } = await supabaseAdmin.from("activity_log").insert(payload);
  if (error) console.log(`[activity] log skipped: ${error.message}`);
}

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

const RESOLVED_CAR_SELECT = `
id, car_number, reporting_marks, car_type, status, fleet_status, entity, active, mechanical_designation,
lessee_name, rider_external_id, lease_type, ops_flag,
assignment:railcar_assignments(
  id, fleet_name,
  rider:riders(
    id, rider_name, schedule_number,
    master_lease:master_leases(id, lease_number, lessee, lease_type)
  )
)
`.replace(/\s+/g, " ").trim();

async function hydrateRailcars(ids: number[]) {
  const uniq = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniq.length) return [];
  const { data, error } = await supabaseAdmin
    .from("railcars")
    .select(RESOLVED_CAR_SELECT)
    .in("id", uniq.slice(0, 80));
  if (error) {
    console.log(`[activity] hydrate railcars skipped: ${error.message}`);
    return [];
  }
  const byId = new Map((data ?? []).map((row: any) => {
    const assignment = asOne(row.assignment);
    const rider = asOne(assignment?.rider);
    const master_lease = asOne(rider?.master_lease);
    return [Number(row.id), {
      ...row,
      assignment: assignment
        ? { ...assignment, rider: rider ? { ...rider, master_lease } : null }
        : null,
    }];
  }));
  return uniq.map((id) => byId.get(id)).filter(Boolean);
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
};

function isVcfAssignmentNoise(row: any): boolean {
  if (row.action !== "reassignment") return false;
  const actor = String(row.actor ?? "");
  const source = String(row.source ?? "");
  const reason = String(row.detail?.reason ?? "");
  return source === "vcf-import" || actor === "vcf-import" || /V_VALID_CARS assignment period/i.test(reason);
}

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
      resolveRailcarsByAnyIdentity(qText),
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

  let q = supabaseAdmin
    .from("activity_log")
    .select(
      `*,
      railcar:railcars(id, car_number, reporting_marks),
      rider:riders(id, rider_name, schedule_number, master_lease:master_leases(id, lease_number))`,
    )
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (railcarIds.length && riderIds.length) {
    q = q.or(
      `railcar_id.in.(${railcarIds.join(",")}),rider_id.in.(${riderIds.join(",")})`,
    );
  } else if (railcarIds.length) {
    q = q.in("railcar_id", railcarIds);
  } else if (riderIds.length) {
    q = q.in("rider_id", riderIds);
  } else if (qText) {
    return { events: [], resolved, query: qText };
  }

  const { data, error } = await q;
  if (error) throw error;
  let events = (data ?? []).map((row: any) => ({
    ...row,
    railcar: Array.isArray(row.railcar) ? row.railcar[0] ?? null : row.railcar,
    rider: Array.isArray(row.rider) ? row.rider[0] ?? null : row.rider,
  }));
  if (!opts.includeVcfNoise) events = events.filter((e) => !isVcfAssignmentNoise(e));
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
  const occurred_at = new Date().toISOString();
  const insert: Record<string, unknown> = {
    entity_type: opts.entity_type,
    entity_id: opts.entity_id,
    action: "note",
    actor: opts.actor ?? null,
    detail: { body },
    source: "ui",
    occurred_at,
    railcar_id: opts.entity_type === "railcar" ? opts.entity_id : null,
    rider_id: opts.entity_type === "rider" ? opts.entity_id : null,
  };
  const { data, error } = await supabaseAdmin.from("activity_log").insert(insert).select().single();
  if (error) throw error;

  if (opts.entity_type === "railcar") {
    await supabaseAdmin.from("railcars").update({ notes: body }).eq("id", opts.entity_id);
  } else {
    await supabaseAdmin.from("riders").update({ notes: body }).eq("id", opts.entity_id);
  }
  return data;
}
