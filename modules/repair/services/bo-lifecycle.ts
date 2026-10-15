/**
 * Bad order lifecycle via shop link + owner bulk create from pasted car list.
 * Acknowledge, Decline Work + reason, arrival (yard) date.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { resolveActiveLink } from "./event-links";
import { getStatusByCode, assertTransitionAllowed } from "./status-machine";
import { createBadOrder, type CreateBadOrderInput } from "./bo";
import { requireVcfCar } from "./vcf";
import { shopAccept, shopReject, shopOnHand } from "./shop-actions";
import { getBoStoredStatus, setBoStatus } from "./bo-status";

export async function shopAcknowledge(rawToken: string, actorEmail: string) {
  const resolved = await resolveActiveLink(rawToken, "SHOP");
  if (!resolved) return { ok: false as const, status: 401, error: "Invalid or revoked link" };
  const eventId = String(resolved.event.id);
  const tenantId = String(resolved.event.tenant_id ?? DEFAULT_TENANT_ID);

  // Idempotent reopen: already accepted → return current step (never re-mark on hand)
  const stored = await getBoStoredStatus({ eventId, tenantId });
  if (stored && stored.status !== "ASSIGNED" && stored.status !== "DECLINED") {
    await q(
      `UPDATE repair.events
       SET acknowledged_at = coalesce(acknowledged_at, now()),
           acknowledged_by = coalesce(acknowledged_by, $1)
       WHERE id = $2`,
      [actorEmail, eventId],
    );
    return {
      ok: true as const,
      event: resolved.event,
      status: stored.status,
      alreadyAccepted: true as const,
    };
  }

  const result = await shopAccept(rawToken, actorEmail);
  if (!result.ok) return result;

  await q(
    `UPDATE repair.events
     SET acknowledged_at = now(), acknowledged_by = $1
     WHERE id = $2`,
    [actorEmail, eventId],
  );

  // Persist bo.status — must not silently fail (DEMO 100004 accept bug)
  const statusSet = await setBoStatus({
    eventId,
    to: "ACCEPTED",
    actor: actorEmail,
    actionName: "Shop accept",
    tenantId,
  });
  if (!statusSet.ok) {
    return {
      ok: false as const,
      status: statusSet.status,
      error: statusSet.error,
    };
  }

  await writeAudit({
    tenantId,
    entity: "event",
    entityId: eventId,
    action: "BO_ACKNOWLEDGED",
    after: { email: actorEmail, boStatus: "ACCEPTED" },
    actor: actorEmail,
    via: "event_link",
  });
  return { ...result, status: "ACCEPTED" as const };
}

export async function shopDeclineWork(
  rawToken: string,
  actorEmail: string,
  reason: string,
) {
  const text = (reason ?? "").trim();
  if (!text) {
    return { ok: false as const, status: 400, error: "Decline reason required" };
  }
  const resolved = await resolveActiveLink(rawToken, "SHOP");
  if (!resolved) return { ok: false as const, status: 401, error: "Invalid or revoked link" };
  const tenantId = String(resolved.event.tenant_id ?? DEFAULT_TENANT_ID);
  const result = await shopReject(rawToken, actorEmail, text);
  if (!result.ok) return result;
  await q(
    `UPDATE repair.events
     SET declined_at = now(), declined_by = $1, decline_reason = $2, shop_id = NULL
     WHERE id = $3`,
    [actorEmail, text, resolved.event.id],
  );
  await setBoStatus({
    eventId: String(resolved.event.id),
    to: "DECLINED",
    actor: actorEmail,
    actionName: "Shop decline",
    note: text,
    tenantId,
    force: true,
  });
  await writeAudit({
    tenantId,
    entity: "event",
    entityId: String(resolved.event.id),
    action: "BO_DECLINED_WORK",
    after: { email: actorEmail, reason: text },
    actor: actorEmail,
    via: "event_link",
  });
  // Owner notified via local outbox (never real send)
  const label = `${resolved.event.car_mark} ${resolved.event.car_number}`;
  await q(
    `INSERT INTO repair.email_outbox
       (tenant_id, event_id, notification_type, recipients, subject, body_text,
        status, local_mode, created_by, note)
     VALUES ($1,$2,'BO_DECLINED_WORK',$3::jsonb,$4,$5,'logged',true,$6,$7)`,
    [
      tenantId,
      resolved.event.id,
      JSON.stringify(["owner@local.invalid"]),
      `Shop declined BO — ${label}`,
      `Shop ${actorEmail} declined ${label}.\nReason: ${text}`,
      actorEmail,
      "§G r4 decline → owner local outbox",
    ],
  ).catch(() => undefined);
  return { ok: true as const, event: result.event, reason: text };
}

export async function shopArrivalDate(
  rawToken: string,
  actorEmail: string,
  arrivalDate: string,
  yardTrackNote?: string | null,
) {
  const resolved = await resolveActiveLink(rawToken, "SHOP");
  if (!resolved) return { ok: false as const, status: 401, error: "Invalid or revoked link" };
  const tenantId = String(resolved.event.tenant_id ?? DEFAULT_TENANT_ID);
  const d = new Date(arrivalDate);
  if (Number.isNaN(d.getTime())) {
    return { ok: false as const, status: 400, error: "Invalid arrival date" };
  }

  // Accept NEVER marks on hand — only this action does, with arrival date.
  const stored = await getBoStoredStatus({
    eventId: String(resolved.event.id),
    tenantId,
  });
  const boStatus = stored?.status ?? String(resolved.event.status_code);
  const code = String(resolved.event.status_code);
  if (boStatus === "ACCEPTED" || code === "ACCEPTED") {
    const onHand = await shopOnHand(rawToken, actorEmail);
    if (!onHand.ok) return onHand;
  } else if (
    boStatus !== "ON_HAND" &&
    boStatus !== "IN_REPAIR" &&
    code !== "ON_HAND" &&
    code !== "IN_REPAIR"
  ) {
    return {
      ok: false as const,
      status: 409,
      error: `Cannot set arrival from status ${boStatus}`,
    };
  }

  const note = (yardTrackNote ?? "").trim() || null;
  await q(
    `UPDATE repair.events
     SET yard_arrived_at = $1::timestamptz, yard_arrived_by = $2,
         yard_track_note = coalesce($4, yard_track_note)
     WHERE id = $3`,
    [d.toISOString(), actorEmail, resolved.event.id, note],
  );
  await q(
    `UPDATE repair.bad_orders
     SET arrival_date = coalesce(arrival_date, $1::date)
     WHERE event_id = $2 AND deleted_at IS NULL`,
    [d.toISOString().slice(0, 10), resolved.event.id],
  );
  const statusSet = await setBoStatus({
    eventId: String(resolved.event.id),
    to: "ON_HAND",
    actor: actorEmail,
    actionName: "Mark on hand",
    note,
    tenantId,
    occurredAt: d.toISOString(),
  });
  if (!statusSet.ok) {
    return { ok: false as const, status: statusSet.status, error: statusSet.error };
  }
  await writeAudit({
    tenantId,
    entity: "event",
    entityId: String(resolved.event.id),
    action: "YARD_ARRIVAL",
    after: {
      arrivalDate: d.toISOString(),
      email: actorEmail,
      yardTrackNote: note,
      boStatus: "ON_HAND",
    },
    actor: actorEmail,
    via: "event_link",
  });
  return {
    ok: true as const,
    yardArrivedAt: d.toISOString(),
    yardTrackNote: note,
    status: "ON_HAND" as const,
  };
}

/**
 * Parse pasted car list lines like:
 *   ARSX 100001
 *   ARSX,100002
 *   OFOX528313
 */
export function parsePastedCarList(
  text: string,
  headerInitials?: string,
): Array<{ carMark: string; carNumber: string }> {
  const header = (headerInitials ?? "").trim().toUpperCase();
  const out: Array<{ carMark: string; carNumber: string }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let m = line.match(/^([A-Za-z]{2,4})\s*[,\s]+\s*(\d{1,6})\s*$/);
    if (!m) m = line.match(/^([A-Za-z]{2,4})(\d{1,6})\s*$/);
    if (!m) {
      // Manual_Gap #7: blank initials fall back to header initials
      const numOnly = line.match(/^(\d{1,6})\s*$/);
      if (numOnly && header) {
        out.push({ carMark: header, carNumber: String(Number(numOnly[1])) });
      }
      continue;
    }
    out.push({
      carMark: m[1].toUpperCase(),
      carNumber: String(Number(m[2])), // strip leading zeros consistently with VCF
    });
  }
  return out;
}

export async function bulkCreateBadOrders(opts: {
  pastedCars: string;
  /** Header initials for blank-initial lines (Manual_Gap #7) */
  headerInitials?: string;
  shopId?: string;
  rule?: "RULE_1" | "RULE_107";
  boRuleCode?: string;
  boRuleOtherText?: string;
  shoppingReason?: string;
  actor: string;
  tenantId?: string;
  boCity?: string;
  boState?: string;
  destCity?: string;
  destState?: string;
  allowDuplicates?: boolean;
  /** Shared form fields applied to each car in the multi-car group. */
  shared?: Partial<CreateBadOrderInput>;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const cars = parsePastedCarList(opts.pastedCars, opts.headerInitials);
  if (cars.length === 0) {
    return { ok: false as const, status: 400, error: "No cars parsed from pasted list" };
  }

  const { randomUUID } = await import("crypto");
  const multiCarGroupId = randomUUID();
  const created: Array<Record<string, unknown>> = [];
  const rejected: Array<{ carMark: string; carNumber: string; error: string }> = [];

  for (const car of cars) {
    const vcf = await requireVcfCar(car.carMark, car.carNumber);
    if (!vcf.ok) {
      rejected.push({ ...car, error: vcf.reason });
      continue;
    }
    const input: CreateBadOrderInput = {
      ...(opts.shared ?? {}),
      tenantId,
      carMark: car.carMark,
      carNumber: car.carNumber,
      shopId: opts.shopId ?? opts.shared?.shopId,
      rule: opts.rule ?? opts.shared?.rule ?? "RULE_1",
      boRuleCode: opts.boRuleCode ?? opts.shared?.boRuleCode,
      boRuleOtherText: opts.boRuleOtherText ?? opts.shared?.boRuleOtherText,
      shoppingReason: opts.shoppingReason ?? opts.shared?.shoppingReason,
      actor: opts.actor,
      source: "INTERNAL",
      boCity: opts.boCity ?? opts.shared?.boCity,
      boState: opts.boState ?? opts.shared?.boState,
      destCity: opts.destCity ?? opts.shared?.destCity,
      destState: opts.destState ?? opts.shared?.destState,
      allowDuplicates: opts.allowDuplicates ?? opts.shared?.allowDuplicates,
      multiCarGroupId,
    };
    const result = await createBadOrder(input);
    if (!result.ok) {
      rejected.push({ ...car, error: result.error });
      continue;
    }
    created.push({
      carMark: car.carMark,
      carNumber: car.carNumber,
      eventId: result.event.id,
      badOrderId: result.badOrder.id,
      entityCode: result.event.entity_code,
      multiCarGroupId,
    });
  }

  await writeAudit({
    tenantId,
    entity: "bad_order_bulk",
    entityId: null,
    action: "BO_BULK_CREATE",
    after: { created: created.length, rejected: rejected.length },
    actor: opts.actor,
    via: "UI",
  });

  return { ok: true as const, created, rejected, parsed: cars.length };
}

/** Yard arrival required to leave Queued (submit for approval). */
export async function assertYardArrivalForQueuedExit(opts: {
  estimateId: string;
  tenantId?: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT e.id AS estimate_id, s.code AS status_code,
            ev.id AS event_id, ev.yard_arrived_at
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     JOIN repair.events ev ON ev.id = e.event_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [opts.estimateId, tenantId],
  );
  const row = rows[0];
  if (!row) return { ok: false, status: 404, error: "Estimate not found" };
  if (row.status_code === "QUEUED" && !row.yard_arrived_at) {
    return {
      ok: false,
      status: 409,
      error: "Yard arrival required before leaving Queued",
    };
  }
  return { ok: true };
}

export async function voidEstimate(opts: {
  estimateId: string;
  actor: string;
  actorRole?: string;
  reason?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const actorRole = opts.actorRole ?? "reviewer";
  const { rows } = await q(
    `SELECT e.*, s.code AS status_code
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [opts.estimateId, tenantId],
  );
  const estimate = rows[0];
  if (!estimate) return { ok: false as const, status: 404, error: "Estimate not found" };

  const voided = await getStatusByCode(tenantId, "ESTIMATE", "VOIDED");
  if (!voided) return { ok: false as const, status: 500, error: "VOIDED status missing" };

  const allowed = await assertTransitionAllowed({
    tenantId,
    entity: "ESTIMATE",
    fromStatusId: estimate.status_id,
    toStatusId: voided.id,
    actor: actorRole,
  });
  if (!allowed.ok) {
    return { ok: false as const, status: 403, error: allowed.reason };
  }

  const revNo = Number(estimate.current_revision) + 1;
  await q(
    `INSERT INTO repair.estimate_revisions
       (tenant_id, estimate_id, rev_no, action, actor_name, actor_email,
        labor, material, total, new_status, old_status, comment, created_by)
     VALUES ($1,$2,$3,'Void',$4,$4,0,0,0,'VOIDED',$5,$6,$4)`,
    [
      tenantId,
      opts.estimateId,
      revNo,
      opts.actor,
      estimate.status_code,
      opts.reason ?? "Awaiting Delete → Void",
    ],
  );
  // Soft-hide: mark deleted_at for owner visibility but never purge (status VOIDED + never_purge)
  await q(
    `UPDATE repair.estimates
     SET status_id = $1, current_revision = $2,
         deleted_at = now(), deleted_by = $3, delete_reason = $4
     WHERE id = $5`,
    [
      voided.id,
      revNo,
      opts.actor,
      opts.reason ?? "Voided (never purged)",
      opts.estimateId,
    ],
  );

  await writeAudit({
    tenantId,
    entity: "estimate",
    entityId: opts.estimateId,
    action: "ESTIMATE_VOIDED",
    before: { status: estimate.status_code },
    after: { status: "VOIDED", reason: opts.reason ?? null, neverPurge: true },
    actor: opts.actor,
    via: "UI",
  });

  return { ok: true as const, status: "VOIDED" as const };
}
