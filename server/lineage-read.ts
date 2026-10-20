import { mergeLineageFeed, type LineageSourceBundle } from "@shared/lineage-feed";
import { listActivityLog, type ListActivityOpts } from "./activity-log";
import { resolveLineageRailcars } from "./lineage-identity";
import { supabaseAdmin } from "./supabase";

const SLICE = 400;

type DbResult = { data: unknown; error: { message: string } | null };

function uniqueIds(ids: readonly number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function selectRows(label: string, run: () => unknown): Promise<Record<string, unknown>[]> {
  try {
    const { data, error } = await (run() as PromiseLike<DbResult>);
    if (error) {
      console.log(`[lineage] ${label} skipped: ${error.message}`);
      return [];
    }
    return Array.isArray(data) ? data as Record<string, unknown>[] : [];
  } catch (err) {
    const message = err instanceof Error ? err.message : "error";
    console.log(`[lineage] ${label} skipped: ${message}`);
    return [];
  }
}

async function selectSlice(
  label: string,
  table: string,
  columns: string,
  order: string,
  scoped: boolean,
  column: string,
  ids: number[],
): Promise<Record<string, unknown>[]> {
  if (scoped && ids.length === 0) return [];
  if (!scoped) {
    return selectRows(label, () =>
      supabaseAdmin.from(table).select(columns).order(order, { ascending: false }).limit(SLICE),
    );
  }
  const rows: Record<string, unknown>[] = [];
  for (const slice of chunks(ids, 100)) {
    const part = await selectRows(label, () =>
      supabaseAdmin.from(table).select(columns).in(column, slice).order(order, { ascending: false }).limit(SLICE),
    );
    rows.push(...part);
  }
  return rows;
}

function dedupeRows(rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const id = row.id == null ? "" : String(row.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

async function carIdsForRiders(riderIds: number[]): Promise<number[]> {
  if (!riderIds.length) return [];
  const rows = await selectSlice(
    "assignment-links",
    "railcar_assignments",
    "id, railcar_id, rider_id",
    "id",
    true,
    "rider_id",
    riderIds,
  );
  return uniqueIds(rows.map((row) => Number(row.railcar_id)));
}

async function readMoves(railcarIds: number[], riderIds: number[], scoped: boolean) {
  const columns = "id, railcar_id, from_rider_id, to_rider_id, from_fleet_name, to_fleet_name, moved_at, moved_by, reason";
  if (!scoped) return selectSlice("moves", "assignment_history", columns, "moved_at", false, "id", []);
  const parts: Record<string, unknown>[] = [];
  if (railcarIds.length) {
    parts.push(...await selectSlice("moves", "assignment_history", columns, "moved_at", true, "railcar_id", railcarIds));
  }
  if (riderIds.length) {
    parts.push(...await selectSlice("moves-from", "assignment_history", columns, "moved_at", true, "from_rider_id", riderIds));
    parts.push(...await selectSlice("moves-to", "assignment_history", columns, "moved_at", true, "to_rider_id", riderIds));
  }
  return dedupeRows(parts);
}

async function readImports(railcarIds: number[], scoped: boolean): Promise<Record<string, unknown>[]> {
  if (!scoped) {
    const [vcf, asset] = await Promise.all([
      selectSlice("vcf-loads", "vcf_load_log", "id, loaded_at, loaded_by, file_name", "loaded_at", false, "id", []),
      selectSlice(
        "asset-loads",
        "asset_report_load_log",
        "id, snapshot_month, loaded_at, loaded_by, file_name",
        "loaded_at",
        false,
        "id",
        [],
      ),
    ]);
    return [
      ...vcf.map((row) => ({ ...row, kind: "vcf" })),
      ...asset.map((row) => ({ ...row, kind: "asset_report" })),
    ];
  }
  if (!railcarIds.length) return [];
  const [inserts, backups] = await Promise.all([
    selectSlice("vcf-inserts", "vcf_load_railcar_insert", "load_id, railcar_id", "load_id", true, "railcar_id", railcarIds),
    selectSlice("vcf-backups", "vcf_load_railcar_backup", "load_id, railcar_id", "load_id", true, "railcar_id", railcarIds),
  ]);
  const loadIds: string[] = [];
  const seen = new Set<string>();
  for (const row of [...inserts, ...backups]) {
    const id = row.load_id == null ? "" : String(row.load_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    loadIds.push(id);
  }
  const loads: Record<string, unknown>[] = [];
  for (const slice of chunks(loadIds, 100)) {
    const part = await selectRows("vcf-loads", () =>
      supabaseAdmin.from("vcf_load_log").select("id, loaded_at, loaded_by, file_name").in("id", slice),
    );
    loads.push(...part);
  }
  return loads.map((row) => ({ ...row, kind: "vcf" }));
}

async function readPrograms(railcarIds: number[], scoped: boolean) {
  const columns = "id, railcar_id, program_id, status, milestone, milestone_at, notes, added_at, joined_date, exited_date";
  const rows = await selectSlice("programs", "program_cars", columns, "added_at", scoped, "railcar_id", railcarIds);
  const programIds = uniqueIds(rows.map((row) => Number(row.program_id)));
  const names = new Map<number, string>();
  if (programIds.length) {
    const nameRows = await selectSlice("program-names", "programs", "id, name", "id", true, "id", programIds);
    for (const row of nameRows) names.set(Number(row.id), String(row.name ?? ""));
  }
  return rows.map((row) => ({
    ...row,
    program_name: names.get(Number(row.program_id)) ?? null,
  }));
}

async function readNotes(
  table: "railcars" | "riders",
  columns: string,
  ids: number[],
  scoped: boolean,
) {
  if (scoped && ids.length === 0) return [];
  if (!scoped) {
    return selectRows(`${table}-notes`, () =>
      supabaseAdmin.from(table).select(columns).not("notes", "is", null).order("updated_at", { ascending: false }).limit(SLICE),
    );
  }
  const rows: Record<string, unknown>[] = [];
  for (const slice of chunks(ids, 100)) {
    const part = await selectRows(`${table}-notes`, () =>
      supabaseAdmin.from(table).select(columns).in("id", slice).not("notes", "is", null),
    );
    rows.push(...part);
  }
  return rows;
}

export async function readLineageSources(opts: {
  railcarIds: number[];
  riderIds: number[];
  scoped: boolean;
}): Promise<LineageSourceBundle> {
  const riderIds = uniqueIds(opts.riderIds);
  const linkedCars = await carIdsForRiders(riderIds);
  const railcarIds = uniqueIds([...opts.railcarIds, ...linkedCars]);
  const scoped = opts.scoped;

  const [moves, marks, statuses, rentStops, programs, carNotes, riderNotes, imports] = await Promise.all([
    readMoves(railcarIds, riderIds, scoped),
    selectSlice(
      "marks",
      "car_number_history",
      "id, railcar_id, old_car_initial, old_car_number, new_car_initial, new_car_number, changed_at, changed_by, reason",
      "changed_at",
      scoped,
      "railcar_id",
      railcarIds,
    ),
    selectSlice(
      "status",
      "car_status_history",
      "id, car_id, event_type, reason, created_by, created_at, from_status, to_status",
      "created_at",
      scoped,
      "car_id",
      railcarIds,
    ),
    selectSlice(
      "rent-stops",
      "car_rent_stops",
      "id, railcar_id, rider_id, type, stop_date, expected_resume_date, actual_resume_date, reason, reason_other, note, created_by, created_at",
      "created_at",
      scoped,
      "railcar_id",
      railcarIds,
    ),
    readPrograms(railcarIds, scoped),
    readNotes("railcars", "id, notes, reporting_marks, car_number, updated_at", railcarIds, scoped),
    readNotes("riders", "id, notes, rider_name, updated_at", riderIds, scoped),
    readImports(railcarIds, scoped),
  ]);

  const stopIds = uniqueIds(rentStops.map((row) => Number(row.id)));
  const rentStopAudits = await selectSlice(
    "rent-stop-audit",
    "car_rent_stops_history",
    "id, stop_id, op, old_row, new_row, actor, at",
    "at",
    scoped,
    "stop_id",
    scoped ? stopIds : [],
  );

  return {
    moves,
    marks,
    statuses,
    rentStops,
    rentStopAudits,
    programs,
    carNotes,
    riderNotes,
    imports,
  };
}

/** Read-only Lineage. Activity log rows are the change-capture feed. */
export async function listLineage(opts: ListActivityOpts) {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 1000);
  const qText = opts.q != null ? String(opts.q).trim() : "";
  // Tokenize before splitCarNumber. The shared resolver strips every space,
  // so a list or a range never reaches the database as separate cars.
  const lineageCars = qText ? await resolveLineageRailcars(qText) : null;
  const activity = await listActivityLog({
    ...opts,
    limit,
    resolvedRailcarIds: lineageCars ? lineageCars.ids : undefined,
  });
  const scoped = Boolean(qText || opts.railcarId || opts.riderId);
  let railcarIds = opts.railcarId ? [opts.railcarId] : [];
  let riderIds = opts.riderId ? [opts.riderId] : [];
  if (qText) {
    railcarIds = uniqueIds(activity.resolved?.railcar_ids ?? []);
    riderIds = uniqueIds(activity.resolved?.rider_ids ?? []);
    if (opts.railcarId) railcarIds = [opts.railcarId];
    if (opts.riderId) riderIds = [opts.riderId];
  }
  const message = lineageCars?.message ?? null;
  if (scoped && railcarIds.length === 0 && riderIds.length === 0) {
    return { ...activity, events: [], message };
  }
  const bundle = await readLineageSources({ railcarIds, riderIds, scoped });
  return {
    ...activity,
    message,
    events: mergeLineageFeed(activity.events ?? [], bundle, {
      limit,
      includeVcfNoise: Boolean(opts.includeVcfNoise),
    }),
  };
}
