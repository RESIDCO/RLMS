/**
 * Resolve recipients from notification_rules + contact bank + ad hoc emails.
 * Hard rule: Resp 6 lessee emails never include the shop.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { getEmailProvider, type OutboundEmail } from "../providers/email";

export type NotifyOpts = {
  tenantId?: string;
  eventId: string;
  type: string;
  subject?: string;
  bodyText?: string;
  /** If set, stored in notifications_log instead of bodyText (redact secrets) */
  bodyForLog?: string;
  extraTo?: string[];
  attachments?: OutboundEmail["attachments"];
  replyTo?: string;
  actor?: string;
  /** Force-exclude roles even if rule includes them */
  forceExclude?: string[];
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(String);
}

async function equipmentLabel(eventId: string): Promise<string> {
  const { rows } = await q(
    `SELECT car_mark, car_number FROM repair.events WHERE id = $1`,
    [eventId],
  );
  if (!rows[0]) return eventId;
  return `${rows[0].car_mark} ${rows[0].car_number}`.trim();
}

export async function resolveRecipients(opts: {
  tenantId: string;
  eventId: string;
  type: string;
  extraTo?: string[];
  forceExclude?: string[];
}): Promise<{ to: string[]; rule: Record<string, unknown> | null; excludedShop: boolean }> {
  const { rows: rules } = await q(
    `SELECT * FROM repair.notification_rules
     WHERE tenant_id = $1 AND notification_type = $2
       AND active AND deleted_at IS NULL
     LIMIT 1`,
    [opts.tenantId, opts.type],
  );
  const rule = rules[0] ?? null;
  const include = asStringArray(rule?.include_roles);
  const exclude = new Set([
    ...asStringArray(rule?.exclude_roles),
    ...(opts.forceExclude ?? []),
  ]);

  // Hard rule: RESP6 never to shop
  if (opts.type === "RESP6_LESSEE_EMAIL" || opts.type === "LESSEE_ESTIMATE_APPROVAL") {
    exclude.add("shop");
    exclude.add("shop_contact");
  }

  const emails = new Set<string>();

  if (include.includes("shop_contact") && !exclude.has("shop") && !exclude.has("shop_contact")) {
    const { rows } = await q(
      `SELECT COALESCE(s.default_inbox, c.email) AS email
       FROM repair.events e
       LEFT JOIN repair.shops s ON s.id = e.shop_id AND s.deleted_at IS NULL
       LEFT JOIN repair.contacts c
         ON c.tenant_id = e.tenant_id
        AND c.party_type = 'shop'
        AND c.active AND c.deleted_at IS NULL
        AND (c.party_ref = s.reporting_mark OR c.party_ref = s.id::text)
       WHERE e.id = $1`,
      [opts.eventId],
    );
    for (const r of rows) {
      if (r.email) emails.add(String(r.email).toLowerCase());
    }
  }

  if (include.includes("lessee_contacts") && !exclude.has("lessee_contacts")) {
    const { rows } = await q(
      `SELECT email FROM repair.contacts
       WHERE tenant_id = $1 AND party_type = 'lessee'
         AND active AND deleted_at IS NULL AND email IS NOT NULL`,
      [opts.tenantId],
    );
    for (const r of rows) emails.add(String(r.email).toLowerCase());
  }

  if (
    (include.includes("owner_users") || include.includes("reviewers")) &&
    !exclude.has("owner_users")
  ) {
    const roles =
      include.includes("reviewers") && include.includes("owner_users")
        ? ["admin", "car_owner", "mech_manager", "reviewer", "fleet_manager"]
        : include.includes("reviewers")
          ? ["admin", "mech_manager", "reviewer", "fleet_manager"]
          : ["admin", "car_owner"];
    const { rows } = await q(
      `SELECT u.email
       FROM repair.users u
       JOIN repair.user_roles ur ON ur.user_id = u.id AND ur.deleted_at IS NULL
       WHERE u.tenant_id = $1 AND u.deleted_at IS NULL
         AND ur.role = ANY($2::text[])`,
      [opts.tenantId, roles],
    );
    for (const r of rows) emails.add(String(r.email).toLowerCase());
  }

  if (include.includes("ad_hoc") && !exclude.has("ad_hoc")) {
    const { rows } = await q(
      `SELECT email FROM repair.event_adhoc_emails
       WHERE event_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         AND (notification_type IS NULL OR notification_type = $3)`,
      [opts.eventId, opts.tenantId, opts.type],
    );
    for (const r of rows) emails.add(String(r.email).toLowerCase());
  }

  for (const e of opts.extraTo ?? []) {
    const t = e.trim().toLowerCase();
    if (t.includes("@")) emails.add(t);
  }

  // Strip shop inboxes when excluded
  if (exclude.has("shop") || exclude.has("shop_contact")) {
    const { rows } = await q(
      `SELECT lower(s.default_inbox) AS email
       FROM repair.events e
       JOIN repair.shops s ON s.id = e.shop_id
       WHERE e.id = $1 AND s.default_inbox IS NOT NULL
       UNION
       SELECT lower(c.email)
       FROM repair.contacts c
       WHERE c.tenant_id = $2 AND c.party_type = 'shop'
         AND c.email IS NOT NULL AND c.deleted_at IS NULL`,
      [opts.eventId, opts.tenantId],
    );
    for (const r of rows) {
      if (r.email) emails.delete(String(r.email));
    }
  }

  return {
    to: Array.from(emails),
    rule,
    excludedShop: exclude.has("shop") || exclude.has("shop_contact"),
  };
}

export async function notify(opts: NotifyOpts) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const equipment = await equipmentLabel(opts.eventId);
  const resolved = await resolveRecipients({
    tenantId,
    eventId: opts.eventId,
    type: opts.type,
    extraTo: opts.extraTo,
    forceExclude: opts.forceExclude,
  });

  const subject =
    opts.subject ??
    String(resolved.rule?.template_subject ?? `${opts.type} — {Equipment}`).replace(
      /\{Equipment\}/g,
      equipment,
    );
  const bodyText =
    opts.bodyText ??
    String(resolved.rule?.template_body ?? `${opts.type} for {Equipment}`).replace(
      /\{Equipment\}/g,
      equipment,
    );

  const to = resolved.to.length > 0 ? resolved.to : ["unconfigured@repair.local"];
  const send = await getEmailProvider().send({
    tenantId,
    eventId: opts.eventId,
    type: opts.type,
    to,
    cc: [],
    subject,
    bodyText,
    attachments: opts.attachments,
    replyTo: opts.replyTo,
  });

  const { rows } = await q(
    `INSERT INTO repair.notifications_log
       (tenant_id, event_id, notification_type, recipients, subject, body_snapshot,
        attachments, provider_message_id, status, created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8,$9,$10)
     RETURNING id`,
    [
      tenantId,
      opts.eventId,
      opts.type,
      JSON.stringify(to),
      subject,
      opts.bodyForLog ?? bodyText,
      JSON.stringify(opts.attachments ?? []),
      send.providerMessageId,
      send.status,
      opts.actor ?? "system",
    ],
  );

  return {
    ok: true as const,
    logId: rows[0].id,
    to,
    excludedShop: resolved.excludedShop,
    providerMessageId: send.providerMessageId,
  };
}
