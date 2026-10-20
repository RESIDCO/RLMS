import { capActivityEvents } from "./lineage-notes";

/**
 * Tables Lineage may read. Change capture lives in activity_log (before/after).
 * The rent-event table is intentionally absent: Lineage does not read or write it.
 * Rent stops are car_rent_stops. railcar_assignments is an id lookup only.
 */
export const LINEAGE_SOURCE_TABLES = [
  "activity_log",
  "assignment_history",
  "car_number_history",
  "car_status_history",
  "car_rent_stops",
  "car_rent_stops_history",
  "program_cars",
  "programs",
  "railcars",
  "riders",
  "railcar_assignments",
  "vcf_load_log",
  "vcf_load_railcar_insert",
  "vcf_load_railcar_backup",
  "asset_report_load_log",
] as const;

export type LineageEvent = {
  id: number | string;
  action: string;
  actor?: string | null;
  occurred_at?: string | null;
  created_at?: string | null;
  detail?: Record<string, unknown> | null;
  source?: string | null;
  source_table?: string | null;
  source_id?: number | string | null;
  railcar_id?: number | null;
  rider_id?: number | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  railcar?: { id: number; car_number?: string | null; reporting_marks?: string | null } | null;
  rider?: {
    id: number;
    rider_name?: string | null;
    schedule_number?: string | null;
    master_lease?: { lease_number?: string | null } | null;
  } | null;
};

export type LineageSourceBundle = {
  moves?: readonly Record<string, unknown>[];
  marks?: readonly Record<string, unknown>[];
  statuses?: readonly Record<string, unknown>[];
  rentStops?: readonly Record<string, unknown>[];
  rentStopAudits?: readonly Record<string, unknown>[];
  programs?: readonly Record<string, unknown>[];
  carNotes?: readonly Record<string, unknown>[];
  riderNotes?: readonly Record<string, unknown>[];
  imports?: readonly Record<string, unknown>[];
};

export function lineageSourceKey(
  table: string | null | undefined,
  id: number | string | null | undefined,
): string | null {
  const name = String(table ?? "").trim();
  if (!name || id == null || id === "") return null;
  return `${name}:${id}`;
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/** A date-only value stays on that calendar day in Eastern Time. */
export function lineageDateOnlyNoonUtc(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T12:00:00.000Z`;
  return raw;
}

function eventTime(ev: { occurred_at?: string | null; created_at?: string | null }): number {
  const raw = ev.occurred_at || ev.created_at || "";
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function railcarRef(id: number | null): LineageEvent["railcar"] {
  return id && id > 0 ? { id } : null;
}

function projectMove(row: Record<string, unknown>): LineageEvent | null {
  const id = num(row.id);
  const railcarId = num(row.railcar_id);
  if (id == null || railcarId == null) return null;
  const reason = str(row.reason);
  const actor = str(row.moved_by);
  const vcf = actor === "vcf-import" || /V_VALID_CARS assignment period/i.test(reason ?? "");
  return {
    id: `assignment_history:${id}`,
    action: "reassignment",
    actor,
    source: vcf ? "vcf-import" : "history",
    occurred_at: str(row.moved_at),
    source_table: "assignment_history",
    source_id: id,
    railcar_id: railcarId,
    rider_id: num(row.to_rider_id),
    railcar: railcarRef(railcarId),
    detail: {
      from_rider_id: num(row.from_rider_id),
      to_rider_id: num(row.to_rider_id),
      from_fleet: str(row.from_fleet_name),
      to_fleet: str(row.to_fleet_name),
      reason,
    },
  };
}

function projectMark(row: Record<string, unknown>): LineageEvent | null {
  const id = num(row.id);
  const railcarId = num(row.railcar_id);
  if (id == null || railcarId == null) return null;
  const from = [str(row.old_car_initial), str(row.old_car_number)].filter(Boolean).join(" ");
  const to = [str(row.new_car_initial), str(row.new_car_number)].filter(Boolean).join(" ");
  return {
    id: `car_number_history:${id}`,
    action: "mark_change",
    actor: str(row.changed_by),
    source: str(row.changed_by) === "vcf-import" ? "vcf-import" : "history",
    occurred_at: str(row.changed_at),
    source_table: "car_number_history",
    source_id: id,
    railcar_id: railcarId,
    railcar: railcarRef(railcarId),
    detail: { from: from || null, to: to || null, reason: str(row.reason) },
  };
}

function projectStatus(row: Record<string, unknown>): LineageEvent | null {
  const id = num(row.id);
  const railcarId = num(row.car_id);
  if (id == null || railcarId == null) return null;
  return {
    id: `car_status_history:${id}`,
    action: "status_change",
    actor: str(row.created_by),
    source: "history",
    occurred_at: str(row.created_at),
    source_table: "car_status_history",
    source_id: id,
    railcar_id: railcarId,
    railcar: railcarRef(railcarId),
    detail: {
      event_type: str(row.event_type),
      from: str(row.from_status),
      to: str(row.to_status),
      reason: str(row.reason),
    },
  };
}

function projectRentStop(row: Record<string, unknown>): LineageEvent | null {
  const id = num(row.id);
  const railcarId = num(row.railcar_id);
  if (id == null || railcarId == null) return null;
  return {
    id: `car_rent_stops:${id}`,
    action: "rent_stop",
    actor: str(row.created_by),
    source: "history",
    occurred_at: str(row.created_at) ?? lineageDateOnlyNoonUtc(str(row.stop_date)),
    source_table: "car_rent_stops",
    source_id: id,
    railcar_id: railcarId,
    rider_id: num(row.rider_id),
    railcar: railcarRef(railcarId),
    detail: {
      type: str(row.type),
      stop_date: str(row.stop_date),
      expected_resume_date: str(row.expected_resume_date),
      actual_resume_date: str(row.actual_resume_date),
      reason: str(row.reason_other) ?? str(row.reason),
      note: str(row.note),
    },
  };
}

function auditBody(row: Record<string, unknown>, op: string): Record<string, unknown> | null {
  const raw = op === "DELETE" ? row.old_row : row.new_row;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function projectRentStopAudit(row: Record<string, unknown>): LineageEvent | null {
  const id = num(row.id);
  const op = String(row.op ?? "").trim().toUpperCase();
  if (id == null) return null;
  if (op !== "UPDATE" && op !== "DELETE") return null;
  const body = auditBody(row, op);
  const railcarId = num(body?.railcar_id);
  return {
    id: `car_rent_stops_history:${id}`,
    action: "rent_stop",
    actor: str(row.actor),
    source: "history",
    occurred_at: str(row.at),
    source_table: "car_rent_stops_history",
    source_id: id,
    railcar_id: railcarId,
    railcar: railcarRef(railcarId),
    detail: {
      op,
      type: str(body?.type),
      stop_date: str(body?.stop_date),
      reason: str(body?.reason),
    },
  };
}

function projectProgram(row: Record<string, unknown>): LineageEvent[] {
  const id = num(row.id);
  const railcarId = num(row.railcar_id);
  if (id == null || railcarId == null) return [];
  const name = str(row.program_name) ?? (num(row.program_id) ? `Program ${num(row.program_id)}` : "Program");
  const events: LineageEvent[] = [];
  const addedAt = str(row.added_at) ?? lineageDateOnlyNoonUtc(str(row.joined_date));
  if (addedAt) {
    events.push({
      id: `program_cars:${id}:added`,
      action: "program",
      source: "history",
      occurred_at: addedAt,
      source_table: "program_cars",
      source_id: id,
      railcar_id: railcarId,
      railcar: railcarRef(railcarId),
      detail: {
        kind: "added",
        program: name,
        status: str(row.status),
        milestone: str(row.milestone),
      },
    });
  }
  const exitedAt = lineageDateOnlyNoonUtc(str(row.exited_date));
  if (exitedAt) {
    events.push({
      id: `program_cars:${id}:exited`,
      action: "program",
      source: "history",
      occurred_at: exitedAt,
      source_table: "program_cars.exited",
      source_id: id,
      railcar_id: railcarId,
      railcar: railcarRef(railcarId),
      detail: { kind: "exited", program: name, status: str(row.status) },
    });
  }
  return events;
}

function projectImport(row: Record<string, unknown>): LineageEvent | null {
  const id = row.id;
  if (id == null || id === "") return null;
  const kind = str(row.kind) === "asset_report" ? "asset_report" : "vcf";
  const table = kind === "asset_report" ? "asset_report_load_log" : "vcf_load_log";
  return {
    id: `${table}:${id}`,
    action: "import",
    actor: str(row.loaded_by),
    source: "import",
    occurred_at: str(row.loaded_at),
    source_table: table,
    source_id: typeof id === "number" || typeof id === "string" ? id : String(id),
    detail: {
      kind,
      file_name: str(row.file_name),
      snapshot_month: str(row.snapshot_month),
    },
  };
}

function idsWithNote(activity: readonly LineageEvent[], side: "railcar" | "rider"): Set<number> {
  const ids = new Set<number>();
  const field = side === "railcar" ? "railcar_id" : "rider_id";
  const nested = side === "railcar" ? "railcar" : "rider";
  const snapshotTable = side === "railcar" ? "railcars.notes" : "riders.notes";
  for (const ev of activity) {
    if (ev.action !== "note") continue;
    const direct = num(ev[field]);
    const nestedId = num(ev[nested] && typeof ev[nested] === "object" ? (ev[nested] as { id?: unknown }).id : null);
    const id = direct ?? nestedId;
    if (id) ids.add(id);
    if (ev.source_table === snapshotTable) {
      const sourceId = num(ev.source_id);
      if (sourceId) ids.add(sourceId);
    }
  }
  return ids;
}

function projectNoteSnapshots(
  rows: readonly Record<string, unknown>[] | undefined,
  covered: Set<number>,
  side: "railcar" | "rider",
): LineageEvent[] {
  const events: LineageEvent[] = [];
  const table = side === "railcar" ? "railcars.notes" : "riders.notes";
  for (const row of rows ?? []) {
    const id = num(row.id);
    const body = str(row.notes);
    if (id == null || !body || covered.has(id)) continue;
    const event: LineageEvent = {
      id: `${table}:${id}`,
      action: "note",
      source: "notes",
      occurred_at: str(row.updated_at),
      source_table: table,
      source_id: id,
      detail: { body, snapshot: true },
    };
    if (side === "railcar") {
      event.railcar_id = id;
      event.railcar = {
        id,
        car_number: str(row.car_number),
        reporting_marks: str(row.reporting_marks),
      };
    } else {
      event.rider_id = id;
      event.rider = { id, rider_name: str(row.rider_name) };
    }
    events.push(event);
  }
  return events;
}

export function projectLineageSources(
  bundle: LineageSourceBundle,
  activity: readonly LineageEvent[] = [],
): LineageEvent[] {
  const events: LineageEvent[] = [];
  for (const row of bundle.moves ?? []) {
    const ev = projectMove(row);
    if (ev) events.push(ev);
  }
  for (const row of bundle.marks ?? []) {
    const ev = projectMark(row);
    if (ev) events.push(ev);
  }
  for (const row of bundle.statuses ?? []) {
    const ev = projectStatus(row);
    if (ev) events.push(ev);
  }
  for (const row of bundle.rentStops ?? []) {
    const ev = projectRentStop(row);
    if (ev) events.push(ev);
  }
  for (const row of bundle.rentStopAudits ?? []) {
    const ev = projectRentStopAudit(row);
    if (ev) events.push(ev);
  }
  for (const row of bundle.programs ?? []) events.push(...projectProgram(row));
  for (const row of bundle.imports ?? []) {
    const ev = projectImport(row);
    if (ev) events.push(ev);
  }
  events.push(...projectNoteSnapshots(bundle.carNotes, idsWithNote(activity, "railcar"), "railcar"));
  events.push(...projectNoteSnapshots(bundle.riderNotes, idsWithNote(activity, "rider"), "rider"));
  return events;
}

/**
 * Activity-log rows already are change capture. Other sources are read-only
 * projections. A source row is dropped when the log already points at it.
 * VCF assignment noise is removed before the cap.
 */
export function mergeLineageFeed(
  activity: readonly LineageEvent[],
  bundle: LineageSourceBundle,
  opts: { limit: number; includeVcfNoise?: boolean },
): LineageEvent[] {
  const seen = new Set<string>();
  const merged: LineageEvent[] = [];
  for (const ev of activity) {
    const key = lineageSourceKey(ev.source_table, ev.source_id);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    merged.push(ev);
  }
  for (const ev of projectLineageSources(bundle, activity)) {
    const key = lineageSourceKey(ev.source_table, ev.source_id);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    merged.push(ev);
  }
  merged.sort((a, b) => eventTime(b) - eventTime(a) || String(b.id).localeCompare(String(a.id)));
  return capActivityEvents(merged, opts.limit, Boolean(opts.includeVcfNoise));
}
