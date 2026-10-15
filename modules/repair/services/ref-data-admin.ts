/**
 * Reference Data admin — owner / system manager only.
 * Soft-retire (active=false + effective_to); never hard-delete.
 * Manual rows source=RESIDCO; AAR import wins unless owner_override.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";

export const REF_ADMIN_ROLES = new Set([
  "owner",
  "system_manager",
  "admin",
  "dev-bypass",
]);

export function canManageRefData(actorRole?: string | null): boolean {
  return REF_ADMIN_ROLES.has(String(actorRole ?? "").trim().toLowerCase());
}

export type RefTableKey =
  | "job_codes"
  | "qualifiers"
  | "qualifier_generic"
  | "qualifier_charts"
  | "why_made"
  | "condition"
  | "location"
  | "responsibility"
  | "categories"
  | "component_id_rules"
  | "job_code_prices";

type TableDef = {
  key: RefTableKey;
  label: string;
  table: string;
  /** Natural key columns (unique with tenant). */
  naturalKey: string[];
  /** Editable display columns (excludes id/tenant audit). */
  columns: string[];
  searchCols: string[];
};

export const REF_TABLES: TableDef[] = [
  {
    key: "job_codes",
    label: "Job codes",
    table: "repair.ref_job_codes",
    naturalKey: ["job_code"],
    columns: [
      "job_code",
      "description",
      "rule",
      "price_list_qualifier",
      "category",
      "sub_category",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
      "active",
      "effective_to",
      "owner_override",
    ],
    searchCols: ["job_code", "description", "rule", "category", "source"],
  },
  {
    key: "qualifiers",
    label: "Qualifiers",
    table: "repair.ref_qualifiers",
    naturalKey: ["job_code", "qualifier"],
    columns: [
      "job_code",
      "qualifier",
      "description",
      "category",
      "sub_category",
      "qualifier_type",
      "basis",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
      "active",
      "effective_to",
      "owner_override",
    ],
    searchCols: ["job_code", "qualifier", "description", "source"],
  },
  {
    key: "qualifier_generic",
    label: "Car part / generic qualifiers",
    table: "repair.ref_qualifier_generic",
    naturalKey: ["qualifier"],
    columns: [
      "qualifier",
      "qualifier_type",
      "description",
      "category",
      "sub_category",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
      "active",
      "effective_to",
      "owner_override",
    ],
    searchCols: ["qualifier", "description", "category", "source"],
  },
  {
    key: "qualifier_charts",
    label: "Qualifier charts",
    table: "repair.ref_qualifier_charts",
    naturalKey: ["import_key"],
    columns: [
      "import_key",
      "rule",
      "chart_group",
      "qualifier",
      "description",
      "chart_title",
      "discontinued",
      "job_codes_using_chart",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
      "active",
      "effective_to",
      "owner_override",
    ],
    searchCols: ["import_key", "rule", "qualifier", "description", "chart_title"],
  },
  {
    key: "why_made",
    label: "Why-made",
    table: "repair.ref_why_made",
    naturalKey: ["code"],
    columns: [
      "code",
      "description",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
      "active",
      "effective_to",
      "owner_override",
    ],
    searchCols: ["code", "description", "source"],
  },
  {
    key: "condition",
    label: "Condition",
    table: "repair.ref_condition_codes",
    naturalKey: ["code"],
    columns: [
      "code",
      "description",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
      "active",
      "effective_to",
      "owner_override",
    ],
    searchCols: ["code", "description", "source"],
  },
  {
    key: "location",
    label: "Location",
    table: "repair.ref_location_codes",
    naturalKey: ["code"],
    columns: [
      "code",
      "description",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
      "active",
      "effective_to",
      "owner_override",
    ],
    searchCols: ["code", "description", "source"],
  },
  {
    key: "responsibility",
    label: "Responsibility",
    table: "repair.ref_responsibility_codes",
    naturalKey: ["code"],
    columns: [
      "code",
      "description",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
      "active",
      "effective_to",
      "owner_override",
    ],
    searchCols: ["code", "description", "source"],
  },
  {
    key: "categories",
    label: "Repair categories",
    table: "repair.ref_repair_categories",
    naturalKey: ["combo_key"],
    columns: [
      "job_code",
      "qualifier",
      "combo_key",
      "description",
      "category",
      "sub_category",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
      "active",
      "effective_to",
      "owner_override",
    ],
    searchCols: ["job_code", "qualifier", "combo_key", "description", "category"],
  },
  {
    key: "component_id_rules",
    label: "Component ID rules",
    table: "repair.component_id_rules",
    naturalKey: ["id"],
    columns: [
      "job_code",
      "qualifier",
      "job_code_prefix",
      "label",
      "require_on",
      "notes",
      "active",
      "effective_to",
      "owner_override",
    ],
    searchCols: ["job_code", "qualifier", "job_code_prefix", "label", "notes"],
  },
  {
    key: "job_code_prices",
    label: "Job code prices",
    table: "repair.ref_job_code_prices",
    naturalKey: ["price_key"],
    columns: [
      "job_code",
      "qualifier",
      "condition_code",
      "why_made",
      "resp_code",
      "price_key",
      "price_cents",
      "labor_cents",
      "material_cents",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
      "active",
      "effective_to",
      "owner_override",
    ],
    searchCols: ["job_code", "qualifier", "price_key", "source"],
  },
  {
    key: "missed_pod_reasons",
    label: "Missed POD reasons",
    table: "repair.missed_pod_reason_codes",
    naturalKey: ["code"],
    columns: [
      "code",
      "label",
      "description",
      "sort_order",
      "active",
      "effective_to",
      "owner_override",
    ],
    searchCols: ["code", "label", "description"],
  },
];

function tableDef(key: string): TableDef | null {
  return REF_TABLES.find((t) => t.key === key) ?? null;
}

function naturalKeyOf(def: TableDef, row: Record<string, unknown>): string {
  return def.naturalKey.map((k) => String(row[k] ?? "")).join("|");
}

async function recordChange(opts: {
  tenantId: string;
  tableName: string;
  rowId: string | null;
  naturalKey: string;
  action: string;
  reason: string;
  before: unknown;
  after: unknown;
  actor: string;
}) {
  await q(
    `INSERT INTO repair.ref_data_changes
       (tenant_id, table_name, row_id, natural_key, action, reason,
        before_json, after_json, actor, created_by)
     VALUES ($1,$2,$3::uuid,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$9)`,
    [
      opts.tenantId,
      opts.tableName,
      opts.rowId,
      opts.naturalKey,
      opts.action,
      opts.reason,
      opts.before ? JSON.stringify(opts.before) : null,
      opts.after ? JSON.stringify(opts.after) : null,
      opts.actor,
    ],
  );
  await writeAudit({
    tenantId: opts.tenantId,
    entity: opts.tableName,
    entityId: opts.rowId,
    action: `REF_${opts.action}`,
    before: opts.before,
    after: { ...(opts.after as object), reason: opts.reason },
    actor: opts.actor,
    via: "ref-data-admin",
  });
}

export function listRefTableMeta() {
  return REF_TABLES.map((t) => ({
    key: t.key,
    label: t.label,
    table: t.table,
    naturalKey: t.naturalKey,
    columns: t.columns,
  }));
}

export async function listRefRows(opts: {
  tableKey: string;
  q?: string;
  activeOnly?: boolean;
  sort?: string;
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
  tenantId?: string;
}) {
  const def = tableDef(opts.tableKey);
  if (!def) return { ok: false as const, status: 404, error: "Unknown table" };
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const offset = Math.max(0, opts.offset ?? 0);
  const sortCol =
    opts.sort && def.columns.includes(opts.sort) ? opts.sort : def.naturalKey[0]!;
  const dir = opts.dir === "desc" ? "DESC" : "ASC";

  const params: unknown[] = [tenantId];
  const where: string[] = ["tenant_id = $1", "deleted_at IS NULL"];
  if (opts.activeOnly) where.push("active = true");
  if (opts.q?.trim()) {
    params.push(`%${opts.q.trim().toLowerCase()}%`);
    const i = params.length;
    where.push(
      `(${def.searchCols.map((c) => `LOWER(COALESCE(${c}::text,'')) LIKE $${i}`).join(" OR ")})`,
    );
  }

  const { rows } = await q(
    `SELECT * FROM ${def.table}
     WHERE ${where.join(" AND ")}
     ORDER BY ${sortCol} ${dir} NULLS LAST
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const { rows: cnt } = await q<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ${def.table}
     WHERE ${where.join(" AND ")}`,
    params,
  );
  return {
    ok: true as const,
    table: def.key,
    label: def.label,
    columns: def.columns,
    naturalKey: def.naturalKey,
    total: Number(cnt[0]?.n ?? 0),
    rows,
  };
}

export async function upsertRefRow(opts: {
  tableKey: string;
  id?: string;
  values: Record<string, unknown>;
  reason: string;
  actor: string;
  actorRole?: string;
  tenantId?: string;
}) {
  if (!canManageRefData(opts.actorRole)) {
    return { ok: false as const, status: 403, error: "Owner or system manager only" };
  }
  const reason = opts.reason.trim();
  if (!reason) return { ok: false as const, status: 400, error: "Reason required" };
  const def = tableDef(opts.tableKey);
  if (!def) return { ok: false as const, status: 404, error: "Unknown table" };
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;

  const cleaned: Record<string, unknown> = {};
  for (const c of def.columns) {
    if (c === "active" || c === "effective_to") continue;
    if (opts.values[c] !== undefined) cleaned[c] = opts.values[c];
  }
  // Manual edits default to RESIDCO; AAR imports set source explicitly
  if (!cleaned.source) {
    cleaned.source = "RESIDCO";
  }
  if (String(cleaned.source).toUpperCase() === "RESIDCO") {
    cleaned.owner_override =
      opts.values.owner_override != null
        ? Boolean(opts.values.owner_override)
        : true;
  } else if (opts.values.owner_override != null) {
    cleaned.owner_override = Boolean(opts.values.owner_override);
  }

  if (opts.id) {
    const { rows: before } = await q(
      `SELECT * FROM ${def.table} WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [opts.id, tenantId],
    );
    if (!before[0]) return { ok: false as const, status: 404, error: "Row not found" };
    const sets = Object.keys(cleaned)
      .map((c, i) => `${c} = $${i + 3}`)
      .concat(["updated_at = now()", "updated_by = $2"]);
    const vals = Object.keys(cleaned).map((c) => cleaned[c]);
    const { rows } = await q(
      `UPDATE ${def.table}
       SET ${sets.join(", ")}
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [opts.id, tenantId, ...vals],
    );
    await recordChange({
      tenantId,
      tableName: def.table,
      rowId: opts.id,
      naturalKey: naturalKeyOf(def, rows[0] as Record<string, unknown>),
      action: "EDIT",
      reason,
      before: before[0],
      after: rows[0],
      actor: opts.actor,
    });
    return { ok: true as const, row: rows[0], action: "EDIT" as const };
  }

  // ADD
  for (const k of def.naturalKey) {
    if (k === "id") continue;
    if (cleaned[k] == null || String(cleaned[k]).trim() === "") {
      return { ok: false as const, status: 400, error: `${k} required` };
    }
  }
  if (def.key === "qualifier_charts" && !cleaned.import_key) {
    cleaned.import_key = `residco-${Date.now()}`;
  }
  if (def.key === "categories" && !cleaned.combo_key) {
    cleaned.combo_key = `${cleaned.job_code}|${cleaned.qualifier ?? ""}`;
  }
  if (def.key === "job_code_prices" && !cleaned.price_key) {
    cleaned.price_key = `${cleaned.job_code}|${cleaned.qualifier ?? ""}`;
  }

  if (!cleaned.source) cleaned.source = "RESIDCO";
  const cols = Object.keys(cleaned);
  const placeholders = cols.map((_, i) => `$${i + 3}`).join(",");
  let rows: Record<string, unknown>[];
  try {
    const inserted = await q(
      `INSERT INTO ${def.table}
         (tenant_id, ${cols.join(", ")}, created_by, active)
       VALUES ($1, ${placeholders}, $2, true)
       RETURNING *`,
      [tenantId, opts.actor, ...cols.map((c) => cleaned[c])],
    );
    rows = inserted.rows as Record<string, unknown>[];
  } catch (err) {
    return {
      ok: false as const,
      status: 409,
      error: err instanceof Error ? err.message : "Insert failed",
    };
  }

  const row = rows[0];
  if (!row) {
    return { ok: false as const, status: 500, error: "Insert returned no row" };
  }
  await recordChange({
    tenantId,
    tableName: def.table,
    rowId: String(row.id),
    naturalKey: naturalKeyOf(def, row as Record<string, unknown>),
    action: "ADD",
    reason,
    before: null,
    after: row,
    actor: opts.actor,
  });
  return { ok: true as const, row, action: "ADD" as const };
}

export async function retireRefRow(opts: {
  tableKey: string;
  id: string;
  reason: string;
  actor: string;
  actorRole?: string;
  tenantId?: string;
  effectiveTo?: string;
}) {
  if (!canManageRefData(opts.actorRole)) {
    return { ok: false as const, status: 403, error: "Owner or system manager only" };
  }
  const reason = opts.reason.trim();
  if (!reason) return { ok: false as const, status: 400, error: "Reason required" };
  const def = tableDef(opts.tableKey);
  if (!def) return { ok: false as const, status: 404, error: "Unknown table" };
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows: before } = await q(
    `SELECT * FROM ${def.table} WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [opts.id, tenantId],
  );
  if (!before[0]) return { ok: false as const, status: 404, error: "Row not found" };
  const eff =
    opts.effectiveTo?.trim() || new Date().toISOString().slice(0, 10);
  const { rows } = await q(
    `UPDATE ${def.table}
     SET active = false,
         effective_to = $3::date,
         retired_at = now(),
         retired_by = $4,
         retire_reason = $5,
         updated_at = now(),
         updated_by = $4
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [opts.id, tenantId, eff, opts.actor, reason],
  );
  await recordChange({
    tenantId,
    tableName: def.table,
    rowId: opts.id,
    naturalKey: naturalKeyOf(def, rows[0] as Record<string, unknown>),
    action: "RETIRE",
    reason,
    before: before[0],
    after: rows[0],
    actor: opts.actor,
  });
  return { ok: true as const, row: rows[0] };
}

export async function restoreRefRow(opts: {
  tableKey: string;
  id: string;
  reason: string;
  actor: string;
  actorRole?: string;
  tenantId?: string;
}) {
  if (!canManageRefData(opts.actorRole)) {
    return { ok: false as const, status: 403, error: "Owner or system manager only" };
  }
  const reason = opts.reason.trim();
  if (!reason) return { ok: false as const, status: 400, error: "Reason required" };
  const def = tableDef(opts.tableKey);
  if (!def) return { ok: false as const, status: 404, error: "Unknown table" };
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows: before } = await q(
    `SELECT * FROM ${def.table} WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [opts.id, tenantId],
  );
  if (!before[0]) return { ok: false as const, status: 404, error: "Row not found" };
  const { rows } = await q(
    `UPDATE ${def.table}
     SET active = true,
         effective_to = NULL,
         retired_at = NULL,
         retired_by = NULL,
         retire_reason = NULL,
         updated_at = now(),
         updated_by = $3
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [opts.id, tenantId, opts.actor],
  );
  await recordChange({
    tenantId,
    tableName: def.table,
    rowId: opts.id,
    naturalKey: naturalKeyOf(def, rows[0] as Record<string, unknown>),
    action: "RESTORE",
    reason,
    before: before[0],
    after: rows[0],
    actor: opts.actor,
  });
  return { ok: true as const, row: rows[0] };
}

export async function listRefHistory(opts: {
  tableKey: string;
  rowId?: string;
  limit?: number;
  tenantId?: string;
}) {
  const def = tableDef(opts.tableKey);
  if (!def) return { ok: false as const, status: 404, error: "Unknown table" };
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const params: unknown[] = [tenantId, def.table];
  let sql = `SELECT * FROM repair.ref_data_changes
             WHERE tenant_id = $1 AND table_name = $2`;
  if (opts.rowId) {
    params.push(opts.rowId);
    sql += ` AND row_id = $${params.length}::uuid`;
  }
  sql += ` ORDER BY created_at DESC LIMIT ${limit}`;
  const { rows } = await q(sql, params);
  return { ok: true as const, rows };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsvText(text: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]!).map((h) =>
    h.trim().toLowerCase().replace(/\s+/g, "_"),
  );
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] ?? "").trim();
    });
    if (Object.values(row).every((v) => !v)) continue;
    rows.push(row);
  }
  return { headers, rows };
}

function keyFromImportRow(
  def: TableDef,
  row: Record<string, string>,
): string {
  if (def.key === "component_id_rules") {
    return [
      row.job_code ?? "",
      row.qualifier ?? "",
      row.job_code_prefix ?? "",
      row.label ?? "",
    ].join("|");
  }
  return def.naturalKey.map((k) => row[k] ?? "").join("|");
}

export async function dryRunRefImport(opts: {
  tableKey: string;
  csvText: string;
  edition?: string;
  quarter?: string;
  actor: string;
  actorRole?: string;
  tenantId?: string;
}) {
  if (!canManageRefData(opts.actorRole)) {
    return { ok: false as const, status: 403, error: "Owner or system manager only" };
  }
  const def = tableDef(opts.tableKey);
  if (!def) return { ok: false as const, status: 404, error: "Unknown table" };
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const parsed = parseCsvText(opts.csvText);
  if (!parsed.rows.length) {
    return { ok: false as const, status: 400, error: "No data rows in CSV" };
  }

  const { rows: existing } = await q(
    `SELECT * FROM ${def.table} WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [tenantId],
  );
  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of existing) {
    byKey.set(naturalKeyOf(def, r as Record<string, unknown>), r as Record<string, unknown>);
  }

  const added: Array<Record<string, string>> = [];
  const changed: Array<{ key: string; before: unknown; after: Record<string, string> }> = [];
  const conflicts: Array<{
    key: string;
    reason: string;
    existing: unknown;
    incoming: Record<string, string>;
  }> = [];
  const seen = new Set<string>();

  for (const row of parsed.rows) {
    const key = keyFromImportRow(def, row);
    if (!key || key === "|" || key.split("|").every((p) => !p)) continue;
    seen.add(key);
    const cur = byKey.get(key);
    if (!cur) {
      added.push(row);
      continue;
    }
    const src = String(cur.source ?? "").toUpperCase();
    const override = Boolean(cur.owner_override);
    if (src === "RESIDCO" && override) {
      conflicts.push({
        key,
        reason: "Manual RESIDCO row with owner_override — AAR will not overwrite",
        existing: cur,
        incoming: row,
      });
      continue;
    }
    // Detect description / material change
    const descBefore = String(cur.description ?? "");
    const descAfter = String(row.description ?? row.desc ?? "");
    const materialChange =
      descAfter && descAfter !== descBefore
        ? true
        : def.columns.some((c) => {
            if (["source", "edition", "effective_quarter", "active"].includes(c))
              return false;
            if (row[c] == null || row[c] === "") return false;
            return String(cur[c] ?? "") !== String(row[c]);
          });
    if (materialChange) {
      changed.push({ key, before: cur, after: row });
    }
  }

  // Rows in DB from AAR not in file → proposed retire (inactive)
  const retired: Array<{ key: string; existing: unknown }> = [];
  for (const [key, cur] of byKey) {
    if (seen.has(key)) continue;
    if (!Boolean(cur.active)) continue;
    const src = String(cur.source ?? "").toUpperCase();
    if (src === "RESIDCO" && Boolean(cur.owner_override)) continue;
    retired.push({ key, existing: cur });
  }

  // Record dry-run edition (not confirmed)
  const { rows: ed } = await q(
    `INSERT INTO repair.ref_data_editions
       (tenant_id, table_name, edition, quarter, source_file, row_count,
        imported_by, notes, dry_run, added_count, changed_count, retired_count, conflict_count)
     VALUES ($1,$2,$3,$4,'ui-upload',$5,$6,'dry-run',true,$7,$8,$9,$10)
     RETURNING id`,
    [
      tenantId,
      def.table,
      opts.edition ?? null,
      opts.quarter ?? null,
      parsed.rows.length,
      opts.actor,
      added.length,
      changed.length,
      retired.length,
      conflicts.length,
    ],
  );

  return {
    ok: true as const,
    dryRunId: String(ed[0].id),
    table: def.key,
    edition: opts.edition ?? null,
    quarter: opts.quarter ?? null,
    counts: {
      incoming: parsed.rows.length,
      added: added.length,
      changed: changed.length,
      retired: retired.length,
      conflicts: conflicts.length,
    },
    added: added.slice(0, 50),
    changed: changed.slice(0, 50),
    retired: retired.slice(0, 50),
    conflicts: conflicts.slice(0, 50),
    committed: false,
  };
}

export async function confirmRefImport(opts: {
  tableKey: string;
  csvText: string;
  dryRunId?: string;
  edition?: string;
  quarter?: string;
  actor: string;
  actorRole?: string;
  reason: string;
  tenantId?: string;
}) {
  if (!canManageRefData(opts.actorRole)) {
    return { ok: false as const, status: 403, error: "Owner or system manager only" };
  }
  const reason = opts.reason.trim() || "Quarterly AAR import confirm";
  const def = tableDef(opts.tableKey);
  if (!def) return { ok: false as const, status: 404, error: "Unknown table" };
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;

  // Recompute dry-run (authoritative) then apply
  const preview = await dryRunRefImport({
    tableKey: opts.tableKey,
    csvText: opts.csvText,
    edition: opts.edition,
    quarter: opts.quarter,
    actor: opts.actor,
    actorRole: opts.actorRole,
    tenantId,
  });
  if (!preview.ok) return preview;

  const parsed = parseCsvText(opts.csvText);
  let applied = 0;
  for (const row of parsed.rows) {
    const key = keyFromImportRow(def, row);
    if (!key || key.split("|").every((p) => !p)) continue;

    // Skip override conflicts
    if (preview.conflicts.some((c) => c.key === key)) continue;

    const payload: Record<string, unknown> = { ...row, source: row.source || "AAR" };
    if (opts.edition) payload.edition = opts.edition;
    if (opts.quarter) payload.effective_quarter = opts.quarter;

    // Find existing by natural key
    let existingId: string | undefined;
    if (def.naturalKey[0] === "id") {
      // component rules — match loosely
      const { rows: hit } = await q(
        `SELECT id FROM ${def.table}
         WHERE tenant_id = $1 AND deleted_at IS NULL
           AND COALESCE(job_code,'') = $2
           AND COALESCE(qualifier,'') = $3
           AND COALESCE(job_code_prefix,'') = $4
           AND COALESCE(label,'') = $5
         LIMIT 1`,
        [
          tenantId,
          row.job_code ?? "",
          row.qualifier ?? "",
          row.job_code_prefix ?? "",
          row.label ?? "",
        ],
      );
      existingId = hit[0]?.id ? String(hit[0].id) : undefined;
    } else if (def.naturalKey.length === 1) {
      const col = def.naturalKey[0]!;
      const { rows: hit } = await q(
        `SELECT id, owner_override, source FROM ${def.table}
         WHERE tenant_id = $1 AND deleted_at IS NULL AND ${col} = $2 LIMIT 1`,
        [tenantId, row[col] ?? ""],
      );
      if (hit[0]?.owner_override && String(hit[0].source ?? "").toUpperCase() === "RESIDCO") {
        continue;
      }
      existingId = hit[0]?.id ? String(hit[0].id) : undefined;
    } else if (def.key === "qualifiers") {
      const { rows: hit } = await q(
        `SELECT id, owner_override, source FROM ${def.table}
         WHERE tenant_id = $1 AND deleted_at IS NULL
           AND COALESCE(job_code,'') = $2 AND qualifier = $3 LIMIT 1`,
        [tenantId, row.job_code ?? "", row.qualifier ?? ""],
      );
      if (hit[0]?.owner_override && String(hit[0].source ?? "").toUpperCase() === "RESIDCO") {
        continue;
      }
      existingId = hit[0]?.id ? String(hit[0].id) : undefined;
    }

    const result = await upsertRefRow({
      tableKey: opts.tableKey,
      id: existingId,
      values: { ...payload, owner_override: false },
      reason,
      actor: opts.actor,
      actorRole: opts.actorRole,
      tenantId,
    });
    if (result.ok) {
      // Force source AAR on import path
      await q(
        `UPDATE ${def.table}
         SET source = COALESCE(NULLIF($3,''), 'AAR'),
             edition = COALESCE($4, edition),
             effective_quarter = COALESCE($5, effective_quarter),
             active = true,
             effective_to = NULL,
             retired_at = NULL,
             updated_at = now(),
             updated_by = $6
         WHERE id = $1 AND tenant_id = $2`,
        [
          String(result.row.id),
          tenantId,
          String(payload.source ?? "AAR"),
          opts.edition ?? null,
          opts.quarter ?? null,
          opts.actor,
        ],
      );
      applied += 1;
    }
  }

  // Retire missing AAR rows (from preview)
  for (const r of preview.retired) {
    const ex = r.existing as { id?: string };
    if (!ex?.id) continue;
    await retireRefRow({
      tableKey: opts.tableKey,
      id: String(ex.id),
      reason: `${reason} (absent from import)`,
      actor: opts.actor,
      actorRole: opts.actorRole,
      tenantId,
    });
  }

  if (opts.dryRunId) {
    await q(
      `UPDATE repair.ref_data_editions
       SET dry_run = false, confirmed_at = now(), confirmed_by = $2,
           notes = COALESCE(notes,'') || ' confirmed'
       WHERE id = $1`,
      [opts.dryRunId, opts.actor],
    );
  }
  await q(
    `UPDATE repair.ref_data_editions
     SET dry_run = false, confirmed_at = now(), confirmed_by = $2
     WHERE id = $1`,
    [preview.dryRunId, opts.actor],
  );

  await recordChange({
    tenantId,
    tableName: def.table,
    rowId: null,
    naturalKey: "*",
    action: "IMPORT",
    reason,
    before: preview.counts,
    after: { applied, ...preview.counts, edition: opts.edition, quarter: opts.quarter },
    actor: opts.actor,
  });

  return {
    ok: true as const,
    applied,
    counts: preview.counts,
    edition: opts.edition ?? null,
    quarter: opts.quarter ?? null,
  };
}

export async function exportRefCsv(opts: {
  tableKey: string;
  activeOnly?: boolean;
  tenantId?: string;
}) {
  const listed = await listRefRows({
    tableKey: opts.tableKey,
    activeOnly: opts.activeOnly,
    limit: 5000,
    offset: 0,
    tenantId: opts.tenantId,
  });
  if (!listed.ok) return listed;
  const cols = listed.columns;
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(",")];
  for (const row of listed.rows) {
    lines.push(cols.map((c) => esc((row as Record<string, unknown>)[c])).join(","));
  }
  return {
    ok: true as const,
    filename: `${listed.table}.csv`,
    csv: lines.join("\n") + "\n",
    rowCount: listed.rows.length,
  };
}

/**
 * New-line check: retired / inactive codes warn (or reject when opts.reject).
 * Historical estimates still resolve via lookup (include inactive).
 */
export async function checkRefCodeForNewLine(opts: {
  tableKey: "job_codes" | "why_made" | "condition" | "location" | "qualifiers";
  code: string;
  qualifier?: string | null;
  jobCode?: string | null;
  rejectRetired?: boolean;
  tenantId?: string;
}): Promise<{
  ok: boolean;
  found: boolean;
  active: boolean;
  warning?: string;
  description?: string | null;
}> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const code = opts.code.trim();
  if (!code) return { ok: true, found: false, active: false };

  if (opts.tableKey === "qualifiers") {
    const { rows } = await q<{
      description: string | null;
      active: boolean;
    }>(
      `SELECT description, active FROM repair.ref_qualifiers
       WHERE tenant_id = $1 AND deleted_at IS NULL
         AND COALESCE(job_code,'') = $2 AND UPPER(qualifier) = UPPER($3)
       ORDER BY active DESC LIMIT 1`,
      [tenantId, opts.jobCode ?? "", opts.qualifier ?? code],
    );
    if (!rows[0]) return { ok: true, found: false, active: false };
    if (!rows[0].active) {
      const msg = `Qualifier ${opts.qualifier ?? code} is retired — do not use on new lines`;
      if (opts.rejectRetired) return { ok: false, found: true, active: false, warning: msg };
      return {
        ok: true,
        found: true,
        active: false,
        warning: msg,
        description: rows[0].description,
      };
    }
    return { ok: true, found: true, active: true, description: rows[0].description };
  }

  const table =
    opts.tableKey === "job_codes"
      ? "repair.ref_job_codes"
      : opts.tableKey === "why_made"
        ? "repair.ref_why_made"
        : opts.tableKey === "condition"
          ? "repair.ref_condition_codes"
          : "repair.ref_location_codes";
  const codeCol = opts.tableKey === "job_codes" ? "job_code" : "code";
  const { rows } = await q<{ description: string | null; active: boolean }>(
    `SELECT description, active FROM ${table}
     WHERE tenant_id = $1 AND deleted_at IS NULL AND ${codeCol} = $2
     ORDER BY active DESC LIMIT 1`,
    [tenantId, code],
  );
  if (!rows[0]) return { ok: true, found: false, active: false };
  if (!rows[0].active) {
    const msg = `${opts.tableKey} ${code} is retired — do not use on new lines`;
    if (opts.rejectRetired) return { ok: false, found: true, active: false, warning: msg };
    return {
      ok: true,
      found: true,
      active: false,
      warning: msg,
      description: rows[0].description,
    };
  }
  return { ok: true, found: true, active: true, description: rows[0].description };
}
