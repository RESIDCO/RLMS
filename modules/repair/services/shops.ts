/**
 * Owner UI §B — Shop master.
 * Shops are owner-created, permanent, linked to tenant. Never hard-delete —
 * deactivate (active=false). Dropdown empty until at least one shop exists.
 * Billing roads are a separate table for optional mark validation only.
 */
import { DEFAULT_TENANT_ID, q, withTransaction } from "../db";
import { writeAudit } from "./audit";
import { getStorageProvider } from "../providers/storage";

export type ShopListRow = {
  id: string;
  reporting_mark: string;
  name: string;
  default_inbox: string | null;
  city: string | null;
  state: string | null;
  billing_road: string | null;
  remit_address: string | null;
  shop_mark: string | null;
  display_label: string;
};

/**
 * Display: "Name (MARK) – City, ST" when shop_mark present,
 * else "Name – City, ST".
 */
export function formatShopLabel(s: {
  name?: string | null;
  city?: string | null;
  state?: string | null;
  reporting_mark?: string | null;
  shop_mark?: string | null;
}): string {
  const name = (s.name || s.reporting_mark || "Shop").trim();
  const mark = (s.shop_mark || "").trim();
  const titled = mark ? `${name} (${mark})` : name;
  const city = (s.city || "").trim();
  const state = (s.state || "").trim();
  if (city && state) return `${titled} – ${city}, ${state}`;
  if (city) return `${titled} – ${city}`;
  return titled;
}

/** Warn when cert expired or expires within 60 days. */
export function certExpiryWarning(
  expiresOn: string | Date | null | undefined,
  now = new Date(),
): "expired" | "expiring_soon" | null {
  if (!expiresOn) return null;
  const d =
    typeof expiresOn === "string"
      ? new Date(expiresOn + (expiresOn.length <= 10 ? "T00:00:00Z" : ""))
      : expiresOn;
  if (Number.isNaN(d.getTime())) return null;
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const end = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000);
  if (days < 0) return "expired";
  if (days <= 60) return "expiring_soon";
  return null;
}

export type ShopContactInput = {
  id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  active?: boolean;
};

export type ShopCertInput = {
  id?: string;
  certTypeId?: string | null;
  certTypeLabel?: string | null;
  certificateNumber?: string | null;
  expiresOn?: string | null; // YYYY-MM-DD
};

export type ShopMasterRow = ShopListRow & {
  splc: string | null;
  website: string | null;
  hours_notes: string | null;
  active: boolean;
  contacts: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string | null;
    active: boolean;
  }>;
  delivering_lines: string[];
  capability_ids: string[];
  car_type_ids: string[];
  certifications: Array<{
    id: string;
    cert_type_id: string | null;
    cert_type_label: string | null;
    certificate_number: string | null;
    expires_on: string | null;
    expiry_warning: "expired" | "expiring_soon" | null;
  }>;
  documents: Array<{
    id: string;
    kind: string;
    original_filename: string | null;
    mime: string | null;
    size: number;
    uploaded_at: string;
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
  /** Optional AAR shop code (e.g. A084) */
  shopMark?: string | null;
  website?: string | null;
  hoursNotes?: string | null;
  deliveringLines?: string[];
  capabilityIds?: string[];
  carTypeIds?: string[];
  certifications?: ShopCertInput[];
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

function mapListRow(s: Record<string, unknown>): ShopListRow {
  return {
    id: String(s.id),
    reporting_mark: String(s.reporting_mark),
    name: String(s.name),
    default_inbox: s.default_inbox != null ? String(s.default_inbox) : null,
    city: s.city != null ? String(s.city) : null,
    state: s.state != null ? String(s.state) : null,
    billing_road: s.billing_road != null ? String(s.billing_road) : null,
    remit_address: s.remit_address != null ? String(s.remit_address) : null,
    shop_mark: s.shop_mark != null ? String(s.shop_mark) : null,
    display_label: formatShopLabel(s as Parameters<typeof formatShopLabel>[0]),
  };
}

/** Active shops for dropdowns — empty until owner creates at least one. */
export async function listShopsForDropdown(
  tenantId = DEFAULT_TENANT_ID,
): Promise<ShopListRow[]> {
  const { rows } = await q(
    `SELECT id, reporting_mark, name, default_inbox, city, state, billing_road,
            remit_address, splc, shop_mark, active
     FROM repair.shops
     WHERE tenant_id = $1 AND deleted_at IS NULL AND active = true
     ORDER BY name, city, state`,
    [tenantId],
  );
  return rows.map((s) => mapListRow(s));
}

async function hydrateShopMaster(
  s: Record<string, unknown>,
  tenantId: string,
): Promise<ShopMasterRow> {
  const shopId = String(s.id);
  const [contacts, delivering_lines, capability_ids, car_type_ids, certifications, documents] =
    await Promise.all([
      listShopContacts(shopId, tenantId),
      listDeliveringLines(shopId),
      listShopCapabilityIds(shopId),
      listShopCarTypeIds(shopId),
      listShopCertifications(shopId, tenantId),
      listShopDocuments(shopId, tenantId),
    ]);
  return {
    ...mapListRow(s),
    splc: s.splc != null ? String(s.splc) : null,
    website: s.website != null ? String(s.website) : null,
    hours_notes: s.hours_notes != null ? String(s.hours_notes) : null,
    active: Boolean(s.active),
    contacts,
    delivering_lines,
    capability_ids,
    car_type_ids,
    certifications,
    documents,
  };
}

export async function listShopMaster(opts?: {
  tenantId?: string;
  activeOnly?: boolean;
  search?: string;
}): Promise<ShopMasterRow[]> {
  const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
  const params: unknown[] = [tenantId];
  let sql = `SELECT id, reporting_mark, name, default_inbox, city, state,
                    billing_road, remit_address, splc, shop_mark, website,
                    hours_notes, active
             FROM repair.shops
             WHERE tenant_id = $1 AND deleted_at IS NULL`;
  if (opts?.activeOnly !== false) {
    sql += ` AND active = true`;
  }
  if (opts?.search?.trim()) {
    params.push(`%${opts.search.trim()}%`);
    const p = `$${params.length}`;
    sql += ` AND (
      name ILIKE ${p}
      OR city ILIKE ${p}
      OR state ILIKE ${p}
      OR splc ILIKE ${p}
      OR billing_road ILIKE ${p}
      OR reporting_mark ILIKE ${p}
      OR shop_mark ILIKE ${p}
      OR website ILIKE ${p}
      OR hours_notes ILIKE ${p}
      OR EXISTS (
        SELECT 1 FROM repair.shop_delivering_lines dl
        WHERE dl.shop_id = repair.shops.id AND dl.mark ILIKE ${p}
      )
      OR EXISTS (
        SELECT 1 FROM repair.shop_capabilities sc
        JOIN repair.shop_capability_codes cc ON cc.id = sc.capability_id
        WHERE sc.shop_id = repair.shops.id AND (
          cc.display_name ILIKE ${p} OR cc.code ILIKE ${p}
        )
      )
      OR EXISTS (
        SELECT 1 FROM repair.shop_car_types sct
        JOIN repair.shop_car_type_codes ct ON ct.id = sct.car_type_id
        WHERE sct.shop_id = repair.shops.id AND (
          ct.display_name ILIKE ${p} OR ct.code ILIKE ${p}
        )
      )
    )`;
  }
  sql += ` ORDER BY name, city, state`;
  const { rows } = await q(sql, params);
  const shops: ShopMasterRow[] = [];
  for (const s of rows) {
    shops.push(await hydrateShopMaster(s, tenantId));
  }
  return shops;
}

export async function getShopMaster(
  shopId: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<ShopMasterRow | null> {
  const { rows } = await q(
    `SELECT id, reporting_mark, name, default_inbox, city, state,
            billing_road, remit_address, splc, shop_mark, website,
            hours_notes, active
     FROM repair.shops
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [shopId, tenantId],
  );
  if (!rows[0]) return null;
  return hydrateShopMaster(rows[0], tenantId);
}

async function listDeliveringLines(shopId: string): Promise<string[]> {
  const { rows } = await q(
    `SELECT mark FROM repair.shop_delivering_lines WHERE shop_id = $1 ORDER BY mark`,
    [shopId],
  );
  return rows.map((r) => String(r.mark));
}

async function listShopCapabilityIds(shopId: string): Promise<string[]> {
  const { rows } = await q(
    `SELECT capability_id AS id FROM repair.shop_capabilities WHERE shop_id = $1`,
    [shopId],
  );
  return rows.map((r) => String(r.id));
}

async function listShopCarTypeIds(shopId: string): Promise<string[]> {
  const { rows } = await q(
    `SELECT car_type_id AS id FROM repair.shop_car_types WHERE shop_id = $1`,
    [shopId],
  );
  return rows.map((r) => String(r.id));
}

async function listShopCertifications(shopId: string, tenantId: string) {
  const { rows } = await q(
    `SELECT c.id, c.cert_type_id, c.cert_type_label, c.certificate_number,
            c.expires_on::text AS expires_on,
            t.display_name AS type_name
     FROM repair.shop_certifications c
     LEFT JOIN repair.shop_cert_type_codes t ON t.id = c.cert_type_id
     WHERE c.shop_id = $1 AND c.tenant_id = $2 AND c.deleted_at IS NULL
     ORDER BY c.expires_on NULLS LAST, c.created_at`,
    [shopId, tenantId],
  );
  return rows.map((r) => {
    const expires = r.expires_on != null ? String(r.expires_on).slice(0, 10) : null;
    return {
      id: String(r.id),
      cert_type_id: r.cert_type_id != null ? String(r.cert_type_id) : null,
      cert_type_label:
        r.cert_type_label != null
          ? String(r.cert_type_label)
          : r.type_name != null
            ? String(r.type_name)
            : null,
      certificate_number:
        r.certificate_number != null ? String(r.certificate_number) : null,
      expires_on: expires,
      expiry_warning: certExpiryWarning(expires),
    };
  });
}

export async function listShopDocuments(
  shopId: string,
  tenantId = DEFAULT_TENANT_ID,
) {
  const { rows } = await q(
    `SELECT id, kind, original_filename, mime, size, uploaded_at
     FROM repair.documents
     WHERE shop_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       AND COALESCE(lifecycle_status, 'ACTIVE') <> 'VOIDED'
     ORDER BY uploaded_at DESC`,
    [shopId, tenantId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    original_filename:
      r.original_filename != null ? String(r.original_filename) : null,
    mime: r.mime != null ? String(r.mime) : null,
    size: Number(r.size ?? 0),
    uploaded_at: String(r.uploaded_at),
  }));
}

export async function uploadShopDocument(opts: {
  shopId: string;
  tenantId?: string;
  kind: string;
  actor: string;
  file: { filename: string; mime: string; bytes: Buffer };
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const shop = await getShopMaster(opts.shopId, tenantId);
  if (!shop) return { ok: false as const, status: 404, error: "Shop not found" };
  const kind = (opts.kind || "shop_attachment").trim() || "shop_attachment";
  const stored = await getStorageProvider().put({
    tenantId,
    kind,
    filename: opts.file.filename,
    mime: opts.file.mime,
    bytes: opts.file.bytes,
  });
  const { rows } = await q(
    `INSERT INTO repair.documents
       (tenant_id, shop_id, kind, storage_key, sha256, size, mime,
        uploaded_by, created_by, original_filename, lifecycle_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,'ACTIVE')
     RETURNING *`,
    [
      tenantId,
      opts.shopId,
      kind,
      stored.storageKey,
      stored.sha256,
      stored.size,
      stored.mime,
      opts.actor,
      opts.file.filename,
    ],
  );
  await writeAudit({
    tenantId,
    entity: "document",
    entityId: String(rows[0].id),
    action: "SHOP_DOCUMENT_UPLOADED",
    after: { shopId: opts.shopId, kind, sha256: stored.sha256 },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, document: rows[0] };
}

async function validateDeliveringLines(
  tenantId: string,
  marks: string[] | undefined,
): Promise<{ ok: true; marks: string[] } | { ok: false; error: string }> {
  if (!marks?.length) return { ok: true, marks: [] };
  const cleaned = [
    ...new Set(marks.map((m) => m.trim().toUpperCase()).filter(Boolean)),
  ];
  for (const m of cleaned) {
    const road = await validateBillingRoad(tenantId, m);
    if (!road.ok) {
      return {
        ok: false,
        error: `Delivering line "${m}" is not in the billing-road / railroad table`,
      };
    }
  }
  return { ok: true, marks: cleaned };
}

async function replaceDeliveringLines(
  shopId: string,
  marks: string[],
  actor: string,
) {
  await q(`DELETE FROM repair.shop_delivering_lines WHERE shop_id = $1`, [shopId]);
  for (const mark of marks) {
    await q(
      `INSERT INTO repair.shop_delivering_lines (shop_id, mark, created_by)
       VALUES ($1,$2,$3)`,
      [shopId, mark, actor],
    );
  }
}

async function replaceCapabilities(
  shopId: string,
  ids: string[] | undefined,
  actor: string,
) {
  if (!ids) return;
  await q(`DELETE FROM repair.shop_capabilities WHERE shop_id = $1`, [shopId]);
  for (const id of [...new Set(ids.filter(Boolean))]) {
    await q(
      `INSERT INTO repair.shop_capabilities (shop_id, capability_id, created_by)
       VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [shopId, id, actor],
    );
  }
}

async function replaceCarTypes(
  shopId: string,
  ids: string[] | undefined,
  actor: string,
) {
  if (!ids) return;
  await q(`DELETE FROM repair.shop_car_types WHERE shop_id = $1`, [shopId]);
  for (const id of [...new Set(ids.filter(Boolean))]) {
    await q(
      `INSERT INTO repair.shop_car_types (shop_id, car_type_id, created_by)
       VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [shopId, id, actor],
    );
  }
}

async function replaceCertifications(
  tenantId: string,
  shopId: string,
  certs: ShopCertInput[] | undefined,
  actor: string,
) {
  if (!certs) return;
  // Soft-delete existing then insert current set (never hard-delete)
  await q(
    `UPDATE repair.shop_certifications
     SET deleted_at = now(), deleted_by = $1, delete_reason = 'replaced on shop save'
     WHERE shop_id = $2 AND tenant_id = $3 AND deleted_at IS NULL`,
    [actor, shopId, tenantId],
  );
  for (const c of certs) {
    const label = (c.certTypeLabel ?? "").trim() || null;
    const num = (c.certificateNumber ?? "").trim() || null;
    const expires = (c.expiresOn ?? "").trim() || null;
    const typeId = c.certTypeId?.trim() || null;
    if (!label && !num && !expires && !typeId) continue;
    await q(
      `INSERT INTO repair.shop_certifications
         (tenant_id, shop_id, cert_type_id, cert_type_label, certificate_number,
          expires_on, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7)`,
      [tenantId, shopId, typeId, label, num, expires, actor],
    );
  }
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

  const lines = await validateDeliveringLines(tenantId, input.deliveringLines);
  if (!lines.ok) return { ok: false as const, status: 400, error: lines.error };

  const shopMark = (input.shopMark ?? "").trim().toUpperCase() || null;
  const website = (input.website ?? "").trim() || null;
  const hoursNotes = (input.hoursNotes ?? "").trim() || null;

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
          shop_mark, website, hours_notes, active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,true),$12)
       RETURNING *`,
      [
        tenantId,
        reportingMark,
        legal.value,
        city.value,
        st,
        splc.value,
        road.mark,
        shopMark,
        website,
        hoursNotes,
        input.active ?? true,
        input.actor,
      ],
    );
    return rows[0];
  });

  const shopId = String(shop.id);
  await upsertShopContacts(tenantId, shopId, input.contacts, input.actor);
  await replaceDeliveringLines(shopId, lines.marks, input.actor);
  await replaceCapabilities(shopId, input.capabilityIds ?? [], input.actor);
  await replaceCarTypes(shopId, input.carTypeIds ?? [], input.actor);
  await replaceCertifications(
    tenantId,
    shopId,
    input.certifications ?? [],
    input.actor,
  );

  await writeAudit({
    tenantId,
    entity: "shop",
    entityId: shopId,
    action: "SHOP_CREATED",
    after: shop,
    actor: input.actor,
    via: "UI",
  });

  const full = await getShopMaster(shopId, tenantId);
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
  shopMark?: string | null;
  website?: string | null;
  hoursNotes?: string | null;
  deliveringLines?: string[];
  capabilityIds?: string[];
  carTypeIds?: string[];
  certifications?: ShopCertInput[];
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

  const linesIn =
    opts.deliveringLines !== undefined
      ? opts.deliveringLines
      : existing.delivering_lines;
  const lines = await validateDeliveringLines(tenantId, linesIn);
  if (!lines.ok) return { ok: false as const, status: 400, error: lines.error };

  const shopMark =
    opts.shopMark !== undefined
      ? (opts.shopMark ?? "").trim().toUpperCase() || null
      : existing.shop_mark;
  const website =
    opts.website !== undefined
      ? (opts.website ?? "").trim() || null
      : existing.website;
  const hoursNotes =
    opts.hoursNotes !== undefined
      ? (opts.hoursNotes ?? "").trim() || null
      : existing.hours_notes;

  const reportingMark = road.mark ?? existing.reporting_mark;

  const { rows } = await q(
    `UPDATE repair.shops
     SET name = $1, city = $2, state = $3, splc = $4, billing_road = $5,
         reporting_mark = $6, shop_mark = $7, website = $8, hours_notes = $9,
         active = COALESCE($10, active)
     WHERE id = $11 AND tenant_id = $12 AND deleted_at IS NULL
     RETURNING *`,
    [
      legalName,
      city,
      state,
      splc,
      road.mark,
      reportingMark,
      shopMark,
      website,
      hoursNotes,
      opts.active ?? null,
      opts.shopId,
      tenantId,
    ],
  );
  if (!rows[0]) {
    return { ok: false as const, status: 404, error: "Shop not found" };
  }

  await upsertShopContacts(tenantId, opts.shopId, opts.contacts, opts.actor);
  await replaceDeliveringLines(opts.shopId, lines.marks, opts.actor);
  if (opts.capabilityIds !== undefined) {
    await replaceCapabilities(opts.shopId, opts.capabilityIds, opts.actor);
  }
  if (opts.carTypeIds !== undefined) {
    await replaceCarTypes(opts.shopId, opts.carTypeIds, opts.actor);
  }
  if (opts.certifications !== undefined) {
    await replaceCertifications(
      tenantId,
      opts.shopId,
      opts.certifications,
      opts.actor,
    );
  }

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
