/**
 * POD / ERD entry (append-only) + due/missed/revised reminders.
 * POD required within N days of estimate approval (tenant settings.podDueDays, default 5).
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { notify } from "./notifications";
import { getStatusByCode, assertTransitionAllowed } from "./status-machine";

export async function listPodDates(eventId: string, tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT * FROM repair.pod_dates
     WHERE event_id = $1 AND tenant_id = $2
     ORDER BY entered_at ASC`,
    [eventId, tenantId],
  );
  return rows;
}

export async function latestPodErd(eventId: string, tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT DISTINCT ON (kind) *
     FROM repair.pod_dates
     WHERE event_id = $1 AND tenant_id = $2
     ORDER BY kind, entered_at DESC`,
    [eventId, tenantId],
  );
  const out: { POD?: (typeof rows)[0]; ERD?: (typeof rows)[0] } = {};
  for (const r of rows) {
    if (r.kind === "POD" || r.kind === "ERD") out[r.kind as "POD" | "ERD"] = r;
  }
  return out;
}

async function maybeMoveEventToInRepair(eventId: string, tenantId: string, actor: string) {
  const { rows } = await q(
    `SELECT e.*, s.code AS status_code
     FROM repair.events e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [eventId, tenantId],
  );
  const event = rows[0];
  if (!event || event.status_code !== "ON_HAND") return;

  const { rows: est } = await q(
    `SELECT e.id FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.event_id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL
       AND s.code = 'APPROVED'
     LIMIT 1`,
    [eventId, tenantId],
  );
  if (!est[0]) return;

  const latest = await latestPodErd(eventId, tenantId);
  if (!latest.POD && !latest.ERD) return;

  const to = await getStatusByCode(tenantId, "EVENT", "IN_REPAIR");
  if (!to) return;
  const allowed = await assertTransitionAllowed({
    tenantId,
    entity: "EVENT",
    fromStatusId: event.status_id,
    toStatusId: to.id,
    actor: "system",
  });
  if (!allowed.ok) return;

  await q(
    `UPDATE repair.events SET status_id = $1 WHERE id = $2 AND tenant_id = $3`,
    [to.id, eventId, tenantId],
  );
  await writeAudit({
    tenantId,
    entity: "event",
    entityId: eventId,
    action: "Estimate approved, POD/ERD entered",
    before: { status: "ON_HAND" },
    after: { status: "IN_REPAIR" },
    actor,
    via: "system",
  });
}

export async function enterPodErd(opts: {
  eventId?: string;
  rawToken?: string;
  kind: "POD" | "ERD";
  dateValue: string; // YYYY-MM-DD
  enteredBy: string;
  reason?: string;
  tenantId?: string;
  via?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  let eventId = opts.eventId;

  if (opts.rawToken) {
    const { resolveActiveLink } = await import("./event-links");
    const resolved = await resolveActiveLink(opts.rawToken, "SHOP");
    if (!resolved) return { ok: false as const, status: 401, error: "Invalid or revoked link" };
    eventId = String(resolved.event.id);
  }
  if (!eventId) return { ok: false as const, status: 400, error: "eventId required" };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.dateValue)) {
    return { ok: false as const, status: 400, error: "dateValue must be YYYY-MM-DD" };
  }

  const prior = await latestPodErd(eventId, tenantId);
  const wasRevision = Boolean(prior[opts.kind]);

  const { rows } = await q(
    `INSERT INTO repair.pod_dates
       (tenant_id, event_id, kind, date_value, entered_by, reason, created_by)
     VALUES ($1,$2,$3,$4::date,$5,$6,$5)
     RETURNING *`,
    [tenantId, eventId, opts.kind, opts.dateValue, opts.enteredBy, opts.reason ?? null],
  );

  await writeAudit({
    tenantId,
    entity: "pod_dates",
    entityId: rows[0].id,
    action: wasRevision ? "POD_ERD_REVISED" : "POD_ERD_ENTERED",
    before: prior[opts.kind]
      ? { kind: opts.kind, date: prior[opts.kind]?.date_value }
      : null,
    after: { kind: opts.kind, date: opts.dateValue },
    actor: opts.enteredBy,
    via: opts.via ?? "event_link",
  });

  await maybeMoveEventToInRepair(eventId, tenantId, opts.enteredBy);

  if (wasRevision) {
    await notify({
      tenantId,
      eventId,
      type: "POD_REVISED",
      bodyText: `${opts.kind} revised to ${opts.dateValue}${opts.reason ? ` — ${opts.reason}` : ""}`,
      actor: opts.enteredBy,
    });
    // Allow a fresh due/missed cycle after revision
    await q(
      `DELETE FROM repair.reminder_fires
       WHERE event_id = $1 AND tenant_id = $2
         AND reminder_type IN ('POD_DUE','POD_MISSED')`,
      [eventId, tenantId],
    );
  }

  return { ok: true as const, row: rows[0], revised: wasRevision };
}

async function approvalAnchor(eventId: string, tenantId: string): Promise<Date | null> {
  const { rows } = await q(
    `SELECT r.action_at
     FROM repair.estimate_revisions r
     JOIN repair.estimates e ON e.id = r.estimate_id
     WHERE e.event_id = $1 AND e.tenant_id = $2
       AND r.action IN ('Approve', 'Approve adjustment')
     ORDER BY r.action_at DESC
     LIMIT 1`,
    [eventId, tenantId],
  );
  return rows[0] ? new Date(rows[0].action_at) : null;
}

async function podDueDays(tenantId: string): Promise<number> {
  const { rows } = await q(`SELECT settings FROM repair.tenants WHERE id = $1`, [tenantId]);
  const n = Number(rows[0]?.settings?.podDueDays ?? 5);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

async function markFired(
  tenantId: string,
  eventId: string,
  reminderType: string,
  meta: unknown,
): Promise<boolean> {
  try {
    await q(
      `INSERT INTO repair.reminder_fires (tenant_id, event_id, reminder_type, meta)
       VALUES ($1,$2,$3,$4::jsonb)`,
      [tenantId, eventId, reminderType, JSON.stringify(meta ?? {})],
    );
    return true;
  } catch {
    return false; // unique → already fired
  }
}

/** In-process reminder sweep (dev/cron-free). */
export async function runPodReminders(tenantId = DEFAULT_TENANT_ID) {
  const days = await podDueDays(tenantId);
  const { rows: events } = await q(
    `SELECT e.id, e.car_mark, e.car_number, s.code AS status_code
     FROM repair.events e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.tenant_id = $1 AND e.deleted_at IS NULL
       AND s.code IN ('ON_HAND','IN_REPAIR')`,
    [tenantId],
  );

  const results: Array<{ eventId: string; type: string }> = [];
  const now = Date.now();

  for (const ev of events) {
    const latest = await latestPodErd(String(ev.id), tenantId);
    const pod = latest.POD;
    const approvedAt = await approvalAnchor(String(ev.id), tenantId);
    if (!approvedAt) continue;

    const dueAt = approvedAt.getTime() + days * 86400000;

    if (!pod) {
      if (now >= dueAt) {
        if (await markFired(tenantId, String(ev.id), "POD_MISSED", { days })) {
          await notify({
            tenantId,
            eventId: String(ev.id),
            type: "POD_MISSED",
            actor: "system",
          });
          results.push({ eventId: String(ev.id), type: "POD_MISSED" });
        }
      } else if (now >= dueAt - 86400000) {
        if (await markFired(tenantId, String(ev.id), "POD_DUE", { days })) {
          await notify({
            tenantId,
            eventId: String(ev.id),
            type: "POD_DUE",
            actor: "system",
          });
          results.push({ eventId: String(ev.id), type: "POD_DUE" });
        }
      }
    }
  }

  return { ok: true as const, fired: results, podDueDays: days };
}
