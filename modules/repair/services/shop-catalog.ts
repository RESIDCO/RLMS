/**
 * Owner-managed shop catalogs (Admin gear): capabilities, car types, cert types.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";

export type CatalogKind = "capability" | "car_type" | "cert_type";

const TABLE: Record<CatalogKind, string> = {
  capability: "repair.shop_capability_codes",
  car_type: "repair.shop_car_type_codes",
  cert_type: "repair.shop_cert_type_codes",
};

export type CatalogRow = {
  id: string;
  code: string;
  display_name: string;
  sort_order: number;
  active: boolean;
};

export async function listCatalog(
  kind: CatalogKind,
  opts?: { tenantId?: string; activeOnly?: boolean },
): Promise<CatalogRow[]> {
  const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
  const table = TABLE[kind];
  let sql = `SELECT id, code, display_name, sort_order, active
             FROM ${table}
             WHERE tenant_id = $1 AND deleted_at IS NULL`;
  if (opts?.activeOnly !== false) sql += ` AND active = true`;
  sql += ` ORDER BY sort_order, display_name`;
  const { rows } = await q(sql, [tenantId]);
  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    display_name: String(r.display_name),
    sort_order: Number(r.sort_order ?? 0),
    active: Boolean(r.active),
  }));
}

export async function upsertCatalogItem(opts: {
  kind: CatalogKind;
  tenantId?: string;
  code: string;
  displayName: string;
  sortOrder?: number;
  active?: boolean;
  actor: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const table = TABLE[opts.kind];
  const code = opts.code.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  const displayName = opts.displayName.trim();
  if (!code || !displayName) {
    return { ok: false as const, status: 400, error: "code and displayName required" };
  }
  const { rows } = await q(
    `INSERT INTO ${table} (tenant_id, code, display_name, sort_order, active, created_by)
     VALUES ($1,$2,$3,COALESCE($4,0),COALESCE($5,true),$6)
     ON CONFLICT (tenant_id, code) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       sort_order = EXCLUDED.sort_order,
       active = EXCLUDED.active,
       deleted_at = NULL, deleted_by = NULL, delete_reason = NULL
     RETURNING *`,
    [
      tenantId,
      code,
      displayName,
      opts.sortOrder ?? 0,
      opts.active ?? true,
      opts.actor,
    ],
  );
  await writeAudit({
    tenantId,
    entity: `shop_${opts.kind}_catalog`,
    entityId: String(rows[0].id),
    action: "CATALOG_UPSERT",
    after: rows[0],
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, item: rows[0] };
}

export async function deactivateCatalogItem(opts: {
  kind: CatalogKind;
  id: string;
  tenantId?: string;
  actor: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const table = TABLE[opts.kind];
  const { rows } = await q(
    `UPDATE ${table}
     SET active = false
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [opts.id, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Not found" };
  await writeAudit({
    tenantId,
    entity: `shop_${opts.kind}_catalog`,
    entityId: opts.id,
    action: "CATALOG_DEACTIVATED",
    after: rows[0],
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, item: rows[0] };
}
