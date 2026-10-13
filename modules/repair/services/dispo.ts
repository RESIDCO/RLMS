/**
 * Dispo request / instructions relay — information only.
 * No waybill or movement tracking (RailSite owns that).
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { notify } from "./notifications";
import { resolveActiveLink } from "./event-links";

export async function listDispo(eventId: string, tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT * FROM repair.dispo
     WHERE event_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     ORDER BY at ASC`,
    [eventId, tenantId],
  );
  return rows;
}

export async function relayDispo(opts: {
  eventId?: string;
  rawToken?: string;
  direction: "to_shop" | "from_shop";
  instructions: string;
  actor: string;
  tenantId?: string;
  via?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  let eventId = opts.eventId;
  let via = opts.via ?? "UI";

  if (opts.rawToken) {
    const resolved = await resolveActiveLink(opts.rawToken, "SHOP");
    if (!resolved) return { ok: false as const, status: 401, error: "Invalid or revoked link" };
    eventId = String(resolved.event.id);
    via = "event_link";
  }
  if (!eventId) return { ok: false as const, status: 400, error: "eventId required" };

  const text = opts.instructions.trim();
  if (!text) return { ok: false as const, status: 400, error: "instructions required" };

  const { rows } = await q(
    `INSERT INTO repair.dispo
       (tenant_id, event_id, direction, instructions, by_actor, created_by)
     VALUES ($1,$2,$3,$4,$5,$5)
     RETURNING *`,
    [tenantId, eventId, opts.direction, text, opts.actor],
  );

  await writeAudit({
    tenantId,
    entity: "dispo",
    entityId: rows[0].id,
    action: "DISPO_RELAY",
    after: { direction: opts.direction, instructions: text },
    actor: opts.actor,
    via,
  });

  await notify({
    tenantId,
    eventId,
    type: "DISPO",
    bodyText: `Dispo (${opts.direction}) from ${opts.actor}:\n\n${text}\n\n(Information only — not a waybill.)`,
    actor: opts.actor,
  });

  return { ok: true as const, dispo: rows[0] };
}
