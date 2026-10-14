/**
 * Owner UI §B — Shop master.
 * Shops are owner-created, permanent, linked to tenant. Never hard-delete —
 * deactivate (active=false). Dropdown empty until at least one shop exists.
 * Billing roads are a separate table for optional mark validation only.
 */
import { DEFAULT_TENANT_ID, q, withTransaction } from "../db";
import { writeAudit } from "./audit";

export type ShopListRow = {
  id: string;
  reporting_mark: string;
  name: string;
  default_inbox: string | null;
  city: string | null;
  state: string | null;
  billing_road: string | null;
  remit_address: string | null;
  display_label: string;
};

/** Display: "Name – City, ST" */
export function formatShopLabel(s: {
  name?: string | null;
  city?: string | null;
  state?: string | null;
  reporting_mark?: string | null;
}): string {
  const name = (s.name || s.reporting_mark || "Shop").trim();
  const city = (s.city || "").trim();
  const state = (s.state || "").trim();
  if (city && state) return `${name} – ${city}, ${state}`;
  if (city) return `${name} – ${city}`;
  return name;
}

export type ShopContactInput = {
  id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  active?: boolean;
};

export type ShopMasterRow = ShopListRow & {
  splc: string | null;
  active: boolean;
  contacts: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string | null;
    active: boolean;
  }>;
};

export type CreateShopInput = {
  tenantId?: string;
  legalName: string;
  city: string;
  state: string;
  splc: string;
  /** Optional mark / billing road — validated against billing_roads when set */
  billingRoad?: string | null;
  active?: boolean;
  contacts?: ShopContactInput[];
  actor: string;
};

async function validateBillingRoad(
  tenantId: string,
  mark: string | null | undefined,
): Promise<{ ok: true; mark: string | null } | { ok: false; error: string }> {
  const m = (mark ?? "").trim().toUpperCase();
  if (!m) return { ok: true, mark: null };
  const { rows } = await q(
    `SELECT mark FROM repair.billing_roads
     WHERE tenant_id = $1 AND upper(mark) = $2
       AND deleted_at IS NULL AND active = true
     LIMIT 1`,
    [tenantId, m],
  );
  if (!rows[0]) {
    return {
      ok: false,
      error: `Mark / billing road "${m}" is not in the billing-road table`,
    };
  }
  return { ok: true, mark: m };
}

export async function listBillingRoads(
  tenantId = DEFAULT_TENANT_ID,
  opts?: { q?: string; activeOnly?: boolean },
) {
  const params: unknown[] = [tenantId];
  let sql = `SELECT id, mark, name, active
             FROM repair.billing_roads
             WHERE tenant_id = $1 AND deleted_at IS NULL`;
  if (opts?.activeOnly !== false) {
    sql += ` AND active = true`;
  }
  if (opts?.q?.trim()) {
    params.push(`%${opts.q.trim()}%`);
    sql += ` AND (mark ILIKE $${params.length} OR name ILIKE $${params.length})`;
  }
  sql += ` ORDER BY mark`;
  const { rows } = await q(sql, params);
  return rows;
}

/** Active shops for dropdowns — empty until owner creates at least one. */
export async function listShopsForDropdown(
  tenantId = DEFAULT_TENANT_ID,
): Promise<ShopListRow[]> {
  const { rows } = await q(
    `SELECT id, reporting_mark, name, default_inbox, city, state, billing_road,
            remit_address, splc, active
     FROM repair.shops
     WHERE tenant_id = $1 AND deleted_at IS NULL AND active = true
     ORDER BY name, city, state`,
    [tenantId],
  );
  return rows.map((s) => ({
    id: String(s.id),
    reporting_mark: String(s.reporting_mark),
    name: String(s.name),
    default_inbox: s.default_inbox != null ? String(s.default_inbox) : null,
    city: s.city != null ? String(s.city) : null,
    state: s.state != null ? String(s.state) : null,
    billing_road: s.billing_road != null ? String(s.billing_road) : null,
    remit_address: s.remit_address != null ? String(s.remit_address) : null,
    display_label: formatShopLabel(s),
  }));
}

export async function listShopMaster(opts?: {
  tenantId?: string;
  activeOnly?: boolean;
  search?: string;
}): Promise<ShopMasterRow[]> {
  const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
  const params: unknown[] = [tenantId];
  let sql = `SELECT id, reporting_mark, name, default_inbox, city, state,
                    billing_road, remit_address, splc, active
             FROM repair.shops
             WHERE tenant_id = $1 AND deleted_at IS NULL`;
  if (opts?.activeOnly !== false) {
    sql += ` AND active = true`;
  }
  if (opts?.search?.trim()) {
    params.push(`%${opts.search.trim()}%`);
    sql += ` AND (
      name ILIKE $${params.length}
      OR city ILIKE $${params.length}
      OR state ILIKE $${params.length}
      OR splc ILIKE $${params.length}
      OR billing_road ILIKE $${params.length}
      OR reporting_mark ILIKE $${params.length}
    )`;
  }
  sql += ` ORDER BY name, city, state`;
  const { rows } = await q(sql, params);
  const shops: ShopMasterRow[] = [];
  for (const s of rows) {
    const contacts = await listShopContacts(String(s.id), tenantId);
    shops.push({
      id: String(s.id),
      reporting_mark: String(s.reporting_mark),
      name: String(s.name),
      default_inbox: s.default_inbox != null ? String(s.default_inbox) : null,
      city: s.city != null ? String(s.city) : null,
      state: s.state != null ? String(s.state) : null,
      billing_road: s.billing_road != null ? String(s.billing_road) : null,
      remit_address: s.remit_address != null ? String(s.remit_address) : null,
      splc: s.splc != null ? String(s.splc) : null,
      active: Boolean(s.active),
      display_label: formatShopLabel(s),
      contacts,
    });
  }
  return shops;
}

export async function getShopMaster(
  shopId: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<ShopMasterRow | null> {
  const { rows } = await q(
    `SELECT id, reporting_mark, name, default_inbox, city, state,
            billing_road, remit_address, splc, active
     FROM repair.shops
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [shopId, tenantId],
  );
  if (!rows[0]) return null;
  const s = rows[0];
  return {
    id: String(s.id),
    reporting_mark: String(s.reporting_mark),
    name: String(s.name),
    default_inbox: s.default_inbox != null ? String(s.default_inbox) : null,
    city: s.city != null ? String(s.city) : null,
    state: s.state != null ? String(s.state) : null,
    billing_road: s.billing_road != null ? String(s.billing_road) : null,
    remit_address: s.remit_address != null ? String(s.remit_address) : null,
    splc: s.splc != null ? String(s.splc) : null,
    active: Boolean(s.active),
    display_label: formatShopLabel(s),
    contacts: await listShopContacts(String(s.id), tenantId),
  };
}

async function listShopContacts(shopId: string, tenantId: string) {
  const { rows } = await q(
    `SELECT id, name, email, phone, role, active
     FROM repair.contacts
     WHERE tenant_id = $1 AND party_type = 'shop' AND party_ref = $2
       AND deleted_at IS NULL
     ORDER BY name`,
    [tenantId, shopId],
  );
  return rows.map((c) => ({
    id: String(c.id),
    name: String(c.name),
    email: c.email != null ? String(c.email) : null,
    phone: c.phone != null ? String(c.phone) : null,
    role: c.role != null ? String(c.role) : null,
    active: Boolean(c.active),
  }));
}

function requireText(v: string | undefined | null, label: string) {
  const t = (v ?? "").trim();
  if (!t) return { ok: false as const, error: `${label} is required` };
  return { ok: true as const, value: t };
}

async function upsertShopContacts(
  tenantId: string,
  shopId: string,
  contacts: ShopContactInput[] | undefined,
  actor: string,
) {
  if (!contacts) return;
  for (const c of contacts) {
    const name = (c.name ?? "").trim();
    if (!name) continue;
    if (c.id) {
      await q(
        `UPDATE repair.contacts
         SET name = $1, email = $2, phone = $3, role = $4,
             active = COALESCE($5, active)
         WHERE id = $6 AND tenant_id = $7 AND party_type = 'shop'
           AND party_ref = $8 AND deleted_at IS NULL`,
        [
          name,
          c.email?.trim().toLowerCase() || null,
          c.phone?.trim() || null,
          c.role?.trim() || null,
          c.active ?? null,
          c.id,
          tenantId,
          shopId,
        ],
      );
    } else {
      await q(
        `INSERT INTO repair.contacts
           (tenant_id, party_type, party_ref, name, email, phone, role, active, created_by)
         VALUES ($1,'shop',$2,$3,$4,$5,$6,COALESCE($7,true),$8)`,
        [
          tenantId,
          shopId,
          name,
          c.email?.trim().toLowerCase() || null,
          c.phone?.trim() || null,
          c.role?.trim() || null,
          c.active ?? true,
          actor,
        ],
      );
    }
  }
}

export async function createShop(input: CreateShopInput) {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const legal = requireText(input.legalName, "Legal name");
  if (!legal.ok) return { ok: false as const, status: 400, error: legal.error };
  const city = requireText(input.city, "City");
  if (!city.ok) return { ok: false as const, status: 400, error: city.error };
  const state = requireText(input.state, "State");
  if (!state.ok) return { ok: false as const, status: 400, error: state.error };
  const splc = requireText(input.splc, "SPLC");
  if (!splc.ok) return { ok: false as const, status: 400, error: splc.error };

  const st = state.value.toUpperCase();
  if (!/^[A-Z]{2}$/.test(st)) {
    return { ok: false as const, status: 400, error: "State must be 2 letters" };
  }

  const road = await validateBillingRoad(tenantId, input.billingRoad);
  if (!road.ok) return { ok: false as const, status: 400, error: road.error };

  // reporting_mark: use billing road mark when present, else synthetic unique key
  const reportingMark =
    road.mark ??
    `S${Date.now().toString(36).toUpperCase()}${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`.slice(0, 12);

  const shop = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO repair.shops
         (tenant_id, reporting_mark, name, city, state, splc, billing_road,
          active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,true),$9)
       RETURNING *`,
      [
        tenantId,
        reportingMark,
        legal.value,
        city.value,
        st,
        splc.value,
        road.mark,
        input.active ?? true,
        input.actor,
      ],
    );
    const row = rows[0];
    await upsertShopContacts(
      tenantId,
      String(row.id),
      input.contacts,
      input.actor,
    );
    return row;
  });

  await writeAudit({
    tenantId,
    entity: "shop",
    entityId: String(shop.id),
    action: "SHOP_CREATED",
    after: shop,
    actor: input.actor,
    via: "UI",
  });

  const full = await getShopMaster(String(shop.id), tenantId);
  return { ok: true as const, shop: full };
}

export async function updateShop(opts: {
  shopId: string;
  tenantId?: string;
  legalName?: string;
  city?: string;
  state?: string;
  splc?: string;
  billingRoad?: string | null;
  active?: boolean;
  contacts?: ShopContactInput[];
  actor: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const existing = await getShopMaster(opts.shopId, tenantId);
  if (!existing) {
    return { ok: false as const, status: 404, error: "Shop not found" };
  }

  const legalName = (opts.legalName ?? existing.name).trim();
  const city = (opts.city ?? existing.city ?? "").trim();
  const state = (opts.state ?? existing.state ?? "").trim().toUpperCase();
  const splc = (opts.splc ?? existing.splc ?? "").trim();
  if (!legalName || !city || !state || !splc) {
    return {
      ok: false as const,
      status: 400,
      error: "Legal name, city, state, and SPLC are required",
    };
  }
  if (!/^[A-Z]{2}$/.test(state)) {
    return { ok: false as const, status: 400, error: "State must be 2 letters" };
  }

  const roadIn =
    opts.billingRoad !== undefined ? opts.billingRoad : existing.billing_road;
  const road = await validateBillingRoad(tenantId, roadIn);
  if (!road.ok) return { ok: false as const, status: 400, error: road.error };

  const reportingMark = road.mark ?? existing.reporting_mark;

  const { rows } = await q(
    `UPDATE repair.shops
     SET name = $1, city = $2, state = $3, splc = $4, billing_road = $5,
         reporting_mark = $6,
         active = COALESCE($7, active)
     WHERE id = $8 AND tenant_id = $9 AND deleted_at IS NULL
     RETURNING *`,
    [
      legalName,
      city,
      state,
      splc,
      road.mark,
      reportingMark,
      opts.active ?? null,
      opts.shopId,
      tenantId,
    ],
  );
  if (!rows[0]) {
    return { ok: false as const, status: 404, error: "Shop not found" };
  }

  await upsertShopContacts(tenantId, opts.shopId, opts.contacts, opts.actor);

  await writeAudit({
    tenantId,
    entity: "shop",
    entityId: opts.shopId,
    action: "SHOP_UPDATED",
    before: existing,
    after: rows[0],
    actor: opts.actor,
    via: "UI",
  });

  const full = await getShopMaster(opts.shopId, tenantId);
  return { ok: true as const, shop: full };
}

/** Deactivate shop — never hard-delete. */
export async function deactivateShop(opts: {
  shopId: string;
  tenantId?: string;
  actor: string;
  reason?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.shops
     SET active = false
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [opts.shopId, tenantId],
  );
  if (!rows[0]) {
    return { ok: false as const, status: 404, error: "Shop not found" };
  }
  await writeAudit({
    tenantId,
    entity: "shop",
    entityId: opts.shopId,
    action: "SHOP_DEACTIVATED",
    after: { ...rows[0], reason: opts.reason ?? null },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, shop: rows[0] };
}

/**
 * Ensure a demo/smoke shop exists (owner-created style).
 * Used by local demos after payee-list seeds were retired from shop master.
 */
export async function ensureDemoShop(opts: {
  mark: string;
  legalName: string;
  city: string;
  state: string;
  splc: string;
  actor?: string;
  tenantId?: string;
}): Promise<string> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const mark = opts.mark.trim().toUpperCase();

  // Ensure billing road exists so mark validation passes
  await q(
    `INSERT INTO repair.billing_roads (tenant_id, mark, name, active, created_by)
     VALUES ($1,$2,$3,true,'demo:ensure-shop')
     ON CONFLICT (tenant_id, mark) DO UPDATE SET
       active = true,
       name = COALESCE(EXCLUDED.name, repair.billing_roads.name)
       WHERE repair.billing_roads.deleted_at IS NULL`,
    [tenantId, mark, opts.legalName],
  );

  const { rows } = await q(
    `SELECT id FROM repair.shops
     WHERE tenant_id = $1 AND deleted_at IS NULL AND active = true
       AND (upper(reporting_mark) = $2 OR upper(billing_road) = $2)
     LIMIT 1`,
    [tenantId, mark],
  );
  if (rows[0]) return String(rows[0].id);

  // Revive soft-deleted demo shop if present
  const { rows: soft } = await q(
    `UPDATE repair.shops
     SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
         active = true, name = $3, city = $4, state = $5, splc = $6,
         billing_road = $2, created_by = COALESCE(created_by, 'demo:ensure-shop')
     WHERE tenant_id = $1 AND upper(reporting_mark) = $2
     RETURNING id`,
    [tenantId, mark, opts.legalName, opts.city, opts.state, opts.splc],
  );
  if (soft[0]) return String(soft[0].id);

  const created = await createShop({
    tenantId,
    legalName: opts.legalName,
    city: opts.city,
    state: opts.state,
    splc: opts.splc,
    billingRoad: mark,
    active: true,
    actor: opts.actor ?? "demo:ensure-shop",
    contacts: [
      {
        name: "Demo Shop Contact",
        email: "shop@demo.invalid",
        phone: "555-0100",
        role: "Shop Manager",
      },
    ],
  });
  if (!created.ok || !created.shop) {
    throw new Error(created.ok === false ? created.error : "Failed to create demo shop");
  }
  return created.shop.id;
}
