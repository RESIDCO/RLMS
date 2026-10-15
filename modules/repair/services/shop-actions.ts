import { DEFAULT_TENANT_ID, q, withTransaction } from "../db";
import { getStatusByCode, assertTransitionAllowed } from "./status-machine";
import { resolveActiveLink } from "./event-links";
import { writeAudit } from "./audit";

async function transitionEvent(opts: {
  eventId: string;
  tenantId: string;
  fromCode: string;
  toCode: string;
  actor: string;
  via: string;
}) {
  const from = await getStatusByCode(opts.tenantId, "EVENT", opts.fromCode);
  const to = await getStatusByCode(opts.tenantId, "EVENT", opts.toCode);
  if (!from || !to) {
    return { ok: false as const, error: "Status configuration missing" };
  }
  const allowed = await assertTransitionAllowed({
    tenantId: opts.tenantId,
    entity: "EVENT",
    fromStatusId: from.id,
    toStatusId: to.id,
    actor: opts.actor,
  });
  if (!allowed.ok) return { ok: false as const, error: allowed.reason };

  const { rows } = await q(
    `UPDATE repair.events SET status_id = $1
     WHERE id = $2 AND tenant_id = $3 AND status_id = $4 AND deleted_at IS NULL
     RETURNING *`,
    [to.id, opts.eventId, opts.tenantId, from.id],
  );
  if (!rows[0]) {
    return {
      ok: false as const,
      error: `Event is not in status ${opts.fromCode}`,
    };
  }
  await writeAudit({
    tenantId: opts.tenantId,
    entity: "event",
    entityId: opts.eventId,
    action: allowed.transition.action_name,
    before: { status: opts.fromCode },
    after: { status: opts.toCode },
    actor: opts.actor,
    via: opts.via,
  });
  return { ok: true as const, event: rows[0], toCode: opts.toCode };
}

export async function shopAccept(rawToken: string, actorEmail: string) {
  const resolved = await resolveActiveLink(rawToken, "SHOP");
  if (!resolved) return { ok: false as const, status: 401, error: "Invalid or revoked link" };
  const tenantId = String(resolved.event.tenant_id ?? DEFAULT_TENANT_ID);
  const code = String(resolved.event.status_code);
  if (code !== "SHOP_ASSIGNED") {
    return {
      ok: false as const,
      status: 409,
      error: `Cannot accept from status ${code}`,
    };
  }
  const result = await transitionEvent({
    eventId: String(resolved.event.id),
    tenantId,
    fromCode: "SHOP_ASSIGNED",
    toCode: "ACCEPTED",
    actor: "shop_link",
    via: "event_link",
  });
  if (!result.ok) return { ok: false as const, status: 409, error: result.error };
  await writeAudit({
    tenantId,
    entity: "event",
    entityId: String(resolved.event.id),
    action: "SHOP_ACCEPT_BY",
    after: { email: actorEmail },
    actor: actorEmail,
    via: "event_link",
  });
  return { ok: true as const, event: result.event };
}

export async function shopReject(rawToken: string, actorEmail: string, comment?: string) {
  const resolved = await resolveActiveLink(rawToken, "SHOP");
  if (!resolved) return { ok: false as const, status: 401, error: "Invalid or revoked link" };
  const tenantId = String(resolved.event.tenant_id ?? DEFAULT_TENANT_ID);
  // Reject stays in SHOP_ASSIGNED per seed (self-transition) then clear shop for reassign
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE repair.events SET shop_id = NULL
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [resolved.event.id, tenantId],
    );
    return rows[0];
  });
  await writeAudit({
    tenantId,
    entity: "event",
    entityId: String(resolved.event.id),
    action: "SHOP_REJECT",
    after: { email: actorEmail, comment: comment ?? null },
    actor: actorEmail,
    via: "event_link",
  });
  return { ok: true as const, event: result };
}

export async function shopOnHand(rawToken: string, actorEmail: string) {
  const resolved = await resolveActiveLink(rawToken, "SHOP");
  if (!resolved) return { ok: false as const, status: 401, error: "Invalid or revoked link" };
  const tenantId = String(resolved.event.tenant_id ?? DEFAULT_TENANT_ID);
  const code = String(resolved.event.status_code);
  if (code !== "ACCEPTED") {
    return {
      ok: false as const,
      status: 409,
      error: `Cannot mark on hand from status ${code}`,
    };
  }
  const result = await transitionEvent({
    eventId: String(resolved.event.id),
    tenantId,
    fromCode: "ACCEPTED",
    toCode: "ON_HAND",
    actor: "shop_link",
    via: "event_link",
  });
  if (!result.ok) return { ok: false as const, status: 409, error: result.error };
  await writeAudit({
    tenantId,
    entity: "event",
    entityId: String(resolved.event.id),
    action: "SHOP_ON_HAND_BY",
    after: { email: actorEmail },
    actor: actorEmail,
    via: "event_link",
  });
  return { ok: true as const, event: result.event };
}
