/**
 * Optional contact bank (shops + lessees) + per-event ad hoc emails.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";

export async function listContacts(opts?: {
  tenantId?: string;
  partyType?: "shop" | "lessee" | "other";
  activeOnly?: boolean;
}) {
  const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
  const params: unknown[] = [tenantId];
  let sql = `SELECT * FROM repair.contacts
             WHERE tenant_id = $1 AND deleted_at IS NULL`;
  if (opts?.partyType) {
    params.push(opts.partyType);
    sql += ` AND party_type = $${params.length}`;
  }
  if (opts?.activeOnly !== false) {
    sql += ` AND active = true`;
  }
  sql += ` ORDER BY party_type, name`;
  const { rows } = await q(sql, params);
  return rows;
}

export async function upsertContact(opts: {
  id?: string;
  tenantId?: string;
  partyType: "shop" | "lessee" | "other";
  partyRef?: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  active?: boolean;
  /** Future RLMS Contacts module id — stored nullable; not required today. */
  rlmsContactId?: string | null;
  actor: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (!opts.name.trim()) {
    return { ok: false as const, status: 400, error: "name required" };
  }
  if (opts.email && !opts.email.includes("@")) {
    return { ok: false as const, status: 400, error: "invalid email" };
  }

  if (opts.id) {
    const { rows } = await q(
      `UPDATE repair.contacts
       SET party_type = $1, party_ref = $2, name = $3, email = $4,
           active = COALESCE($5, active),
           phone = COALESCE($8, phone),
           role = COALESCE($9, role),
           rlms_contact_id = COALESCE($10, rlms_contact_id)
       WHERE id = $6 AND tenant_id = $7 AND deleted_at IS NULL
       RETURNING *`,
      [
        opts.partyType,
        opts.partyRef ?? null,
        opts.name.trim(),
        opts.email?.trim().toLowerCase() ?? null,
        opts.active ?? null,
        opts.id,
        tenantId,
        opts.phone?.trim() || null,
        opts.role?.trim() || null,
        opts.rlmsContactId === undefined
          ? null
          : opts.rlmsContactId?.trim() || null,
      ],
    );
    if (!rows[0]) return { ok: false as const, status: 404, error: "Contact not found" };
    await writeAudit({
      tenantId,
      entity: "contact",
      entityId: opts.id,
      action: "CONTACT_UPDATED",
      after: rows[0],
      actor: opts.actor,
      via: "UI",
    });
    return { ok: true as const, contact: rows[0] };
  }

  const { rows } = await q(
    `INSERT INTO repair.contacts
       (tenant_id, party_type, party_ref, name, email, active, created_by,
        phone, role, rlms_contact_id)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,true),$7,$8,$9,$10)
     RETURNING *`,
    [
      tenantId,
      opts.partyType,
      opts.partyRef ?? null,
      opts.name.trim(),
      opts.email?.trim().toLowerCase() ?? null,
      opts.active ?? true,
      opts.actor,
      opts.phone?.trim() || null,
      opts.role?.trim() || null,
      opts.rlmsContactId?.trim() || null,
    ],
  );
  await writeAudit({
    tenantId,
    entity: "contact",
    entityId: rows[0].id,
    action: "CONTACT_CREATED",
    after: rows[0],
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, contact: rows[0] };
}

export async function softDeleteContact(opts: {
  id: string;
  actor: string;
  reason?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.contacts
     SET deleted_at = now(), deleted_by = $1, delete_reason = $2, active = false
     WHERE id = $3 AND tenant_id = $4 AND deleted_at IS NULL
     RETURNING *`,
    [opts.actor, opts.reason ?? null, opts.id, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Contact not found" };
  return { ok: true as const, contact: rows[0] };
}

export async function listAdhocEmails(eventId: string, tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT * FROM repair.event_adhoc_emails
     WHERE event_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [eventId, tenantId],
  );
  return rows;
}

export async function addAdhocEmails(opts: {
  eventId: string;
  emails: string[];
  notificationType?: string | null;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const created = [];
  for (const raw of opts.emails) {
    const email = raw.trim().toLowerCase();
    if (!email.includes("@")) continue;
    const { rows } = await q(
      `INSERT INTO repair.event_adhoc_emails
         (tenant_id, event_id, email, notification_type, created_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [tenantId, opts.eventId, email, opts.notificationType ?? null, opts.actor],
    );
    created.push(rows[0]);
  }
  if (created.length === 0) {
    return { ok: false as const, status: 400, error: "No valid emails provided" };
  }
  await writeAudit({
    tenantId,
    entity: "event",
    entityId: opts.eventId,
    action: "ADHOC_EMAILS_ADDED",
    after: { emails: created.map((c) => c.email), notificationType: opts.notificationType ?? null },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, emails: created };
}

export async function listNotificationRules(tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT * FROM repair.notification_rules
     WHERE tenant_id = $1 AND deleted_at IS NULL
     ORDER BY notification_type`,
    [tenantId],
  );
  return rows;
}

export async function updateNotificationRule(opts: {
  notificationType: string;
  includeRoles?: string[];
  excludeRoles?: string[];
  active?: boolean;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.notification_rules
     SET include_roles = COALESCE($1::jsonb, include_roles),
         exclude_roles = COALESCE($2::jsonb, exclude_roles),
         active = COALESCE($3, active)
     WHERE tenant_id = $4 AND notification_type = $5 AND deleted_at IS NULL
     RETURNING *`,
    [
      opts.includeRoles ? JSON.stringify(opts.includeRoles) : null,
      opts.excludeRoles ? JSON.stringify(opts.excludeRoles) : null,
      opts.active ?? null,
      tenantId,
      opts.notificationType,
    ],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Rule not found" };

  // Enforce hard rule for Resp 6
  if (
    opts.notificationType === "RESP6_LESSEE_EMAIL" &&
    !asStringArray(rows[0].exclude_roles).includes("shop")
  ) {
    const { rows: fixed } = await q(
      `UPDATE repair.notification_rules
       SET exclude_roles = '["shop"]'::jsonb
       WHERE id = $1
       RETURNING *`,
      [rows[0].id],
    );
    return { ok: true as const, rule: fixed[0], enforcedShopExclusion: true };
  }

  await writeAudit({
    tenantId,
    entity: "notification_rule",
    entityId: rows[0].id,
    action: "NOTIFICATION_RULE_UPDATED",
    after: rows[0],
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, rule: rows[0] };
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(String);
}
