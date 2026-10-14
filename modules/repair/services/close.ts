/**
 * Ready-to-Close + explicit reviewer close (Q12).
 * No auto-close: when invoice MATCHED + dispo present → READY_TO_CLOSE + notify.
 * Reviewer closes with one click; closing is audited.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { notify } from "./notifications";
import { getStatusByCode, assertTransitionAllowed } from "./status-machine";

const CLOSE_ROLES = new Set([
  "reviewer",
  "admin",
  "fleet_manager",
  "mech_manager",
]);

async function hasMatchedInvoice(eventId: string, tenantId: string): Promise<boolean> {
  // MATCHED = totals equal approved estimate. APPROVED = ACH-cleared after MATCHED
  // (Q20: MISMATCH cannot reach APPROVED_FOR_ACH / APPROVED — no override).
  const { rows } = await q(
    `SELECT 1 FROM repair.invoices
     WHERE event_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       AND match_status IN ('MATCHED', 'APPROVED')
     LIMIT 1`,
    [eventId, tenantId],
  );
  return Boolean(rows[0]);
}

async function hasDispo(eventId: string, tenantId: string): Promise<boolean> {
  const { rows } = await q(
    `SELECT 1 FROM repair.dispo
     WHERE event_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [eventId, tenantId],
  );
  return Boolean(rows[0]);
}

/**
 * If MATCHED invoice + dispo both present and event is COMPLETE (or IN_REPAIR),
 * move to READY_TO_CLOSE and notify reviewers. Idempotent.
 */
export async function maybeMarkReadyToClose(opts: {
  eventId: string;
  tenantId?: string;
  actor?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const actor = opts.actor ?? "system";

  const matched = await hasMatchedInvoice(opts.eventId, tenantId);
  const dispo = await hasDispo(opts.eventId, tenantId);
  if (!matched || !dispo) {
    return {
      ok: true as const,
      transitioned: false,
      reason: !matched
        ? "No MATCHED/APPROVED invoice yet"
        : "No dispo on file yet",
    };
  }

  const { rows } = await q(
    `SELECT e.*, s.code AS status_code
     FROM repair.events e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [opts.eventId, tenantId],
  );
  const event = rows[0];
  if (!event) return { ok: false as const, status: 404, error: "Event not found" };

  if (event.status_code === "READY_TO_CLOSE" || event.status_code === "CLOSED") {
    return { ok: true as const, transitioned: false, reason: `Already ${event.status_code}` };
  }

  if (event.status_code !== "COMPLETE" && event.status_code !== "IN_REPAIR") {
    return {
      ok: true as const,
      transitioned: false,
      reason: `Event status ${event.status_code} is not eligible`,
    };
  }

  const to = await getStatusByCode(tenantId, "EVENT", "READY_TO_CLOSE");
  if (!to) {
    return { ok: false as const, status: 500, error: "READY_TO_CLOSE status missing" };
  }

  const allowed = await assertTransitionAllowed({
    tenantId,
    entity: "EVENT",
    fromStatusId: event.status_id,
    toStatusId: to.id,
    actor: "system",
  });
  if (!allowed.ok) {
    // Fallback: try as reviewer if system not in allowed_actors for this path
    const asReviewer = await assertTransitionAllowed({
      tenantId,
      entity: "EVENT",
      fromStatusId: event.status_id,
      toStatusId: to.id,
      actor: "reviewer",
    });
    if (!asReviewer.ok) {
      return { ok: false as const, status: 403, error: allowed.reason };
    }
  }

  await q(`UPDATE repair.events SET status_id = $1 WHERE id = $2 AND tenant_id = $3`, [
    to.id,
    opts.eventId,
    tenantId,
  ]);

  await writeAudit({
    tenantId,
    entity: "event",
    entityId: opts.eventId,
    action: "READY_TO_CLOSE",
    before: { status: event.status_code },
    after: { status: "READY_TO_CLOSE", invoiceMatched: true, dispoPresent: true },
    actor,
    via: "system",
  });

  await notify({
    tenantId,
    eventId: opts.eventId,
    type: "READY_TO_CLOSE",
    bodyText: `Invoice matches the approved final estimate and dispo is on file. Ready for one-click close.`,
    actor,
  });

  return { ok: true as const, transitioned: true, status: "READY_TO_CLOSE" as const };
}

/** Reviewer one-click close from READY_TO_CLOSE → CLOSED (audited). */
export async function closeEvent(opts: {
  eventId: string;
  actor: string;
  actorRole: string;
  tenantId?: string;
  comment?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (!CLOSE_ROLES.has(opts.actorRole)) {
    return {
      ok: false as const,
      status: 403,
      error: "Only reviewer, admin, fleet_manager, or mech_manager may close",
    };
  }

  const { rows } = await q(
    `SELECT e.*, s.code AS status_code
     FROM repair.events e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [opts.eventId, tenantId],
  );
  const event = rows[0];
  if (!event) return { ok: false as const, status: 404, error: "Event not found" };
  if (event.status_code !== "READY_TO_CLOSE") {
    return {
      ok: false as const,
      status: 409,
      error: `Event must be READY_TO_CLOSE to close (found ${event.status_code})`,
    };
  }

  const to = await getStatusByCode(tenantId, "EVENT", "CLOSED");
  if (!to) return { ok: false as const, status: 500, error: "CLOSED status missing" };

  const allowed = await assertTransitionAllowed({
    tenantId,
    entity: "EVENT",
    fromStatusId: event.status_id,
    toStatusId: to.id,
    actor: opts.actorRole,
  });
  if (!allowed.ok) {
    return { ok: false as const, status: 403, error: allowed.reason };
  }

  await q(`UPDATE repair.events SET status_id = $1 WHERE id = $2 AND tenant_id = $3`, [
    to.id,
    opts.eventId,
    tenantId,
  ]);

  await writeAudit({
    tenantId,
    entity: "event",
    entityId: opts.eventId,
    action: "EVENT_CLOSED",
    before: { status: "READY_TO_CLOSE" },
    after: { status: "CLOSED", comment: opts.comment ?? null },
    actor: opts.actor,
    via: "UI",
  });

  await notify({
    tenantId,
    eventId: opts.eventId,
    type: "EVENT_CLOSED",
    bodyText: `Event closed by ${opts.actor}${opts.comment ? `: ${opts.comment}` : ""}`,
    actor: opts.actor,
  });

  return { ok: true as const, status: "CLOSED" as const };
}
