/**
 * Completed date locks the estimate (docs/photos still allowed).
 * Rollback: reviewer / admin / fleet_manager only; notifies all parties.
 */
import { DEFAULT_TENANT_ID, q, withTransaction } from "../db";
import { writeAudit } from "./audit";
import { notify } from "./notifications";
import { getStatusByCode, assertTransitionAllowed } from "./status-machine";
import { resolveActiveLink } from "./event-links";
import { isOtpRequired, verifyStepOtp } from "./otp";
import { estimateHasOpenWreckFlags } from "./wreck-validate";

const ROLLBACK_ROLES = new Set(["reviewer", "admin", "fleet_manager", "mech_manager"]);

export async function setCompletedDate(opts: {
  eventId?: string;
  estimateId?: string;
  rawToken?: string;
  completedAt: string; // ISO date or datetime
  actor: string;
  actorRole?: string;
  tenantId?: string;
  via?: string;
  comment?: string;
  /** Required when shop has otpSteps.completed_date enabled (shop link only). */
  otpCode?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  let eventId = opts.eventId;
  let via = opts.via ?? "UI";
  let actorRole = opts.actorRole ?? "reviewer";
  let shopId: string | null = null;

  if (opts.rawToken) {
    const resolved = await resolveActiveLink(opts.rawToken, "SHOP");
    if (!resolved) return { ok: false as const, status: 401, error: "Invalid or revoked link" };
    eventId = String(resolved.event.id);
    via = "event_link";
    actorRole = "shop_link";
    shopId = resolved.event.shop_id ? String(resolved.event.shop_id) : null;

    // Optional per-shop OTP on completed-date via shop link (Q3)
    const otpNeeded = await isOtpRequired("completed_date", {
      shopId,
      eventId,
      tenantId: String(resolved.event.tenant_id ?? tenantId),
    });
    if (otpNeeded) {
      if (!opts.otpCode) {
        return {
          ok: false as const,
          status: 403,
          error: "One-time code required for completed date (request OTP first)",
          otpRequired: true as const,
        };
      }
      const verified = await verifyStepOtp({
        eventId,
        step: "completed_date",
        email: opts.actor,
        code: opts.otpCode,
        tenantId: String(resolved.event.tenant_id ?? tenantId),
      });
      if (!verified.ok) {
        return { ok: false as const, status: verified.status, error: verified.error };
      }
    }
  }

  const { rows: estRows } = await q(
    `SELECT e.*, s.code AS status_code, ev.id AS event_id, ev.status_id AS event_status_id,
            es.code AS event_status_code
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     JOIN repair.events ev ON ev.id = e.event_id
     JOIN repair.statuses es ON es.id = ev.status_id
     WHERE e.tenant_id = $1 AND e.deleted_at IS NULL
       AND ($2::uuid IS NULL OR e.id = $2)
       AND ($3::uuid IS NULL OR e.event_id = $3)
     ORDER BY e.created_at ASC
     LIMIT 1`,
    [tenantId, opts.estimateId ?? null, eventId ?? null],
  );
  const estimate = estRows[0];
  if (!estimate) return { ok: false as const, status: 404, error: "Estimate not found" };
  if (estimate.locked || estimate.status_code === "COMPLETED") {
    return { ok: false as const, status: 409, error: "Estimate already completed/locked" };
  }
  if (estimate.status_code !== "APPROVED") {
    return {
      ok: false as const,
      status: 409,
      error: `Estimate must be APPROVED to complete (found ${estimate.status_code})`,
    };
  }

  // Resp 3 wreck flags block completed date until owner/MP clears
  if (await estimateHasOpenWreckFlags(String(estimate.id), tenantId)) {
    return {
      ok: false as const,
      status: 409,
      error:
        "Cannot set completed date while Resp 3 wreck flags remain open — car owner / managing partner must clear flags first",
      wreckFlagsBlock: true as const,
    };
  }

  const toEst = await getStatusByCode(tenantId, "ESTIMATE", "COMPLETED");
  const toEv = await getStatusByCode(tenantId, "EVENT", "COMPLETE");
  if (!toEst || !toEv) {
    return { ok: false as const, status: 500, error: "Status configuration missing" };
  }

  if (String(estimate.event_status_code) === "ON_HAND") {
    const { rows: pods } = await q(
      `SELECT 1 FROM repair.pod_dates WHERE event_id = $1 LIMIT 1`,
      [estimate.event_id],
    );
    if (!pods[0]) {
      return {
        ok: false as const,
        status: 409,
        error: "Enter POD or ERD before setting completed date",
      };
    }
  }

  const estAllowed = await assertTransitionAllowed({
    tenantId,
    entity: "ESTIMATE",
    fromStatusId: estimate.status_id,
    toStatusId: toEst.id,
    actor: actorRole,
  });
  if (!estAllowed.ok) {
    return { ok: false as const, status: 403, error: estAllowed.reason };
  }

  const completedAt = new Date(opts.completedAt);
  if (Number.isNaN(completedAt.getTime())) {
    return { ok: false as const, status: 400, error: "Invalid completedAt" };
  }

  const revNo = Number(estimate.current_revision) + 1;
  const last = await q(
    `SELECT labor, material, total FROM repair.estimate_revisions
     WHERE estimate_id = $1 ORDER BY rev_no DESC LIMIT 1`,
    [estimate.id],
  );

  const packed = await withTransaction(async (client) => {
    const rev = await client.query(
      `INSERT INTO repair.estimate_revisions
         (tenant_id, estimate_id, rev_no, action, actor_name, actor_email,
          labor, material, total, new_status, old_status, comment, created_by)
       VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,'COMPLETED','APPROVED',$9,$5)
       RETURNING *`,
      [
        tenantId,
        estimate.id,
        revNo,
        "Outbound / completed date entered",
        opts.actor,
        last.rows[0]?.labor ?? 0,
        last.rows[0]?.material ?? 0,
        last.rows[0]?.total ?? 0,
        opts.comment ?? null,
      ],
    );
    const updated = await client.query(
      `UPDATE repair.estimates
       SET current_revision = $1, status_id = $2, completed_at = $3, locked = true
       WHERE id = $4
       RETURNING *`,
      [revNo, toEst.id, completedAt.toISOString(), estimate.id],
    );

    // Move event → COMPLETE (seed: IN_REPAIR → COMPLETE). If still ON_HAND but POD exists, jump via IN_REPAIR.
    const evCode = String(estimate.event_status_code);
    if (evCode === "ON_HAND") {
      const { rows: pods } = await client.query(
        `SELECT 1 FROM repair.pod_dates WHERE event_id = $1 LIMIT 1`,
        [estimate.event_id],
      );
      const inRepair = await getStatusByCode(tenantId, "EVENT", "IN_REPAIR");
      if (pods[0] && inRepair) {
        await client.query(`UPDATE repair.events SET status_id = $1 WHERE id = $2`, [
          inRepair.id,
          estimate.event_id,
        ]);
      }
    }
    if (evCode === "IN_REPAIR" || evCode === "ON_HAND") {
      await client.query(`UPDATE repair.events SET status_id = $1 WHERE id = $2`, [
        toEv.id,
        estimate.event_id,
      ]);
    }

    return { revision: rev.rows[0], estimate: updated.rows[0] };
  });

  await writeAudit({
    tenantId,
    entity: "estimate",
    entityId: String(estimate.id),
    action: "COMPLETED_DATE_SET",
    after: { completedAt: completedAt.toISOString(), locked: true },
    actor: opts.actor,
    via,
  });

  {
    const { setBoStatus } = await import("./bo-status");
    await setBoStatus({
      eventId: String(estimate.event_id),
      to: "COMPLETED",
      actor: opts.actor,
      actionName: "Set completed date",
      tenantId,
      occurredAt: completedAt.toISOString(),
      force: true,
    });
  }

  await notify({
    tenantId,
    eventId: String(estimate.event_id),
    type: "EVENT_COMPLETE",
    bodyText: `Completed date set to ${completedAt.toISOString()} by ${opts.actor}. Estimate is locked; documents/photos may still be added.`,
    actor: opts.actor,
  });

  return { ok: true as const, ...packed };
}

export async function rollbackCompletedDate(opts: {
  estimateId: string;
  actor: string;
  actorRole: string;
  tenantId?: string;
  comment?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (!ROLLBACK_ROLES.has(opts.actorRole)) {
    return {
      ok: false as const,
      status: 403,
      error: "Only reviewer, admin, or fleet_manager may roll back completed date",
    };
  }

  const { rows } = await q(
    `SELECT e.*, s.code AS status_code
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [opts.estimateId, tenantId],
  );
  const estimate = rows[0];
  if (!estimate) return { ok: false as const, status: 404, error: "Estimate not found" };
  if (estimate.status_code !== "COMPLETED") {
    return { ok: false as const, status: 409, error: "Estimate is not completed" };
  }

  const toEst = await getStatusByCode(tenantId, "ESTIMATE", "APPROVED");
  const toEv = await getStatusByCode(tenantId, "EVENT", "IN_REPAIR");
  if (!toEst || !toEv) {
    return { ok: false as const, status: 500, error: "Status configuration missing" };
  }

  const allowed = await assertTransitionAllowed({
    tenantId,
    entity: "ESTIMATE",
    fromStatusId: estimate.status_id,
    toStatusId: toEst.id,
    actor: opts.actorRole,
  });
  if (!allowed.ok) {
    return { ok: false as const, status: 403, error: allowed.reason };
  }

  const revNo = Number(estimate.current_revision) + 1;
  const last = await q(
    `SELECT labor, material, total FROM repair.estimate_revisions
     WHERE estimate_id = $1 ORDER BY rev_no DESC LIMIT 1`,
    [opts.estimateId],
  );

  const packed = await withTransaction(async (client) => {
    const rev = await client.query(
      `INSERT INTO repair.estimate_revisions
         (tenant_id, estimate_id, rev_no, action, actor_name, actor_email,
          labor, material, total, new_status, old_status, comment, created_by)
       VALUES ($1,$2,$3,'Rollback',$4,$4,$5,$6,$7,'APPROVED','COMPLETED',$8,$4)
       RETURNING *`,
      [
        tenantId,
        opts.estimateId,
        revNo,
        opts.actor,
        last.rows[0]?.labor ?? 0,
        last.rows[0]?.material ?? 0,
        last.rows[0]?.total ?? 0,
        opts.comment ?? null,
      ],
    );
    const updated = await client.query(
      `UPDATE repair.estimates
       SET current_revision = $1, status_id = $2, completed_at = NULL, locked = false
       WHERE id = $3
       RETURNING *`,
      [revNo, toEst.id, opts.estimateId],
    );
    await client.query(`UPDATE repair.events SET status_id = $1 WHERE id = $2`, [
      toEv.id,
      estimate.event_id,
    ]);
    return { revision: rev.rows[0], estimate: updated.rows[0] };
  });

  await writeAudit({
    tenantId,
    entity: "estimate",
    entityId: opts.estimateId,
    action: "COMPLETED_DATE_ROLLBACK",
    before: { status: "COMPLETED", locked: true },
    after: { status: "APPROVED", locked: false },
    actor: opts.actor,
    via: "UI",
  });

  await notify({
    tenantId,
    eventId: String(estimate.event_id),
    type: "EVENT_COMPLETE_ROLLBACK",
    bodyText: `Completed date rolled back by ${opts.actor}${opts.comment ? `: ${opts.comment}` : ""}`,
    actor: opts.actor,
  });

  return { ok: true as const, ...packed };
}
