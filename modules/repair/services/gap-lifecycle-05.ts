/**
 * Manual_Gap_Review Phase 1 leftovers (lifecycle-05).
 * Does not implement carMARQS/CROP (Phase 2 hooks only).
 */
import { DEFAULT_TENANT_ID, q, withTransaction } from "../db";
import { writeAudit } from "./audit";
import { getStatusByCode, assertTransitionAllowed } from "./status-machine";
import { notify } from "./notifications";
import { resolveActiveLink } from "./event-links";
import { assertOutboundAllowed } from "./tank-docs";
import { getRevisionLines, listRevisions } from "./estimates";

const ALLOWED_DEFAULT = new Set([
  ".500", ".bmp", ".dat", ".doc", ".docx", ".edi", ".gif",
  ".jpg", ".jpeg", ".pdf", ".txt", ".xls", ".xlsx",
]);

export async function assertAttachmentAllowed(opts: {
  filename: string;
  tenantId?: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const m = opts.filename.toLowerCase().match(/(\.[a-z0-9]+)$/);
  const ext = m?.[1] ?? "";
  if (!ext) {
    return { ok: false, status: 400, error: "Attachment must have a file extension" };
  }
  const { rows } = await q(
    `SELECT extension FROM repair.attachment_allowed_types
     WHERE tenant_id = $1 AND active`,
    [tenantId],
  );
  const allowed = rows.length
    ? new Set(rows.map((r) => String(r.extension).toLowerCase()))
    : ALLOWED_DEFAULT;
  if (!allowed.has(ext)) {
    return {
      ok: false,
      status: 422,
      error: `Attachment type ${ext} not allowed (allowed: ${[...allowed].sort().join(", ")})`,
    };
  }
  return { ok: true };
}

/** #7 blank initials fall back to header initials */
export function parsePastedCarListWithHeader(
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
      const numOnly = line.match(/^(\d{1,6})\s*$/);
      if (numOnly && header) {
        out.push({ carMark: header, carNumber: String(Number(numOnly[1])) });
      }
      continue;
    }
    out.push({
      carMark: m[1].toUpperCase(),
      carNumber: String(Number(m[2])),
    });
  }
  return out;
}

/** #4 Shop may delete a Queued estimate → AWAITING_DELETE */
export async function shopRequestDeleteEstimate(opts: {
  estimateId?: string;
  rawToken?: string;
  actor: string;
  reason?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  let estimateId = opts.estimateId;
  let actorRole = "reviewer";
  if (opts.rawToken) {
    const resolved = await resolveActiveLink(opts.rawToken, "SHOP");
    if (!resolved) return { ok: false as const, status: 401, error: "Invalid or revoked link" };
    actorRole = "shop_link";
    const { rows } = await q(
      `SELECT id FROM repair.estimates
       WHERE event_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       ORDER BY created_at ASC LIMIT 1`,
      [resolved.event.id, resolved.event.tenant_id ?? tenantId],
    );
    estimateId = rows[0] ? String(rows[0].id) : undefined;
  }
  if (!estimateId) return { ok: false as const, status: 400, error: "estimateId required" };

  const { rows } = await q(
    `SELECT e.*, s.code AS status_code
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [estimateId, tenantId],
  );
  const est = rows[0];
  if (!est) return { ok: false as const, status: 404, error: "Estimate not found" };
  if (actorRole === "shop_link" && est.status_code !== "QUEUED") {
    return {
      ok: false as const,
      status: 409,
      error: "Shop may only delete Queued estimates",
    };
  }

  const to = await getStatusByCode(tenantId, "ESTIMATE", "AWAITING_DELETE");
  if (!to) return { ok: false as const, status: 500, error: "AWAITING_DELETE missing" };
  const allowed = await assertTransitionAllowed({
    tenantId,
    entity: "ESTIMATE",
    fromStatusId: est.status_id,
    toStatusId: to.id,
    actor: actorRole,
  });
  if (!allowed.ok) return { ok: false as const, status: 403, error: allowed.reason };

  const revNo = Number(est.current_revision) + 1;
  await q(
    `INSERT INTO repair.estimate_revisions
       (tenant_id, estimate_id, rev_no, action, actor_name, labor, material, total,
        new_status, old_status, comment, created_by)
     VALUES ($1,$2,$3,'Request delete',$4,0,0,0,'AWAITING_DELETE',$5,$6,$4)`,
    [tenantId, estimateId, revNo, opts.actor, est.status_code, opts.reason ?? null],
  );
  await q(
    `UPDATE repair.estimates SET status_id = $1, current_revision = $2 WHERE id = $3`,
    [to.id, revNo, estimateId],
  );
  await writeAudit({
    tenantId,
    entity: "estimate",
    entityId: estimateId,
    action: "AWAITING_DELETE",
    after: { reason: opts.reason ?? null },
    actor: opts.actor,
    via: opts.rawToken ? "event_link" : "UI",
  });
  return { ok: true as const, status: "AWAITING_DELETE" as const };
}

/** #5 Owner reviews Awaiting Delete → VOIDED (never purge) */
export async function approveDeleteToVoid(opts: {
  estimateId: string;
  actor: string;
  actorRole?: string;
  reason?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { voidEstimate } = await import("./bo-lifecycle");
  // Prefer transition AWAITING_DELETE → VOIDED when in that status
  const { rows } = await q(
    `SELECT e.*, s.code AS status_code
     FROM repair.estimates e JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2`,
    [opts.estimateId, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Estimate not found" };
  if (rows[0].status_code === "AWAITING_DELETE") {
    const voided = await getStatusByCode(tenantId, "ESTIMATE", "VOIDED");
    if (!voided) return { ok: false as const, status: 500, error: "VOIDED missing" };
    const revNo = Number(rows[0].current_revision) + 1;
    await q(
      `INSERT INTO repair.estimate_revisions
         (tenant_id, estimate_id, rev_no, action, actor_name, labor, material, total,
          new_status, old_status, comment, created_by)
       VALUES ($1,$2,$3,'Void (approve delete)',$4,0,0,0,'VOIDED','AWAITING_DELETE',$5,$4)`,
      [tenantId, opts.estimateId, revNo, opts.actor, opts.reason ?? "Approved delete → Void"],
    );
    await q(
      `UPDATE repair.estimates
       SET status_id = $1, current_revision = $2,
           deleted_at = now(), deleted_by = $3, delete_reason = $4
       WHERE id = $5`,
      [voided.id, revNo, opts.actor, opts.reason ?? "Voided (never purged)", opts.estimateId],
    );
    await writeAudit({
      tenantId,
      entity: "estimate",
      entityId: opts.estimateId,
      action: "ESTIMATE_VOIDED",
      before: { status: "AWAITING_DELETE" },
      after: { status: "VOIDED", neverPurge: true },
      actor: opts.actor,
      via: "UI",
    });
    return { ok: true as const, status: "VOIDED" as const };
  }
  return voidEstimate({
    estimateId: opts.estimateId,
    actor: opts.actor,
    actorRole: opts.actorRole ?? "reviewer",
    reason: opts.reason,
    tenantId,
  });
}

/** #3 Bulk Submit for Approval from history grid */
export async function bulkSubmitForApproval(opts: {
  estimateIds: string[];
  actor: string;
  tenantId?: string;
}) {
  const { submitForApproval } = await import("./estimates");
  const results: Array<{ estimateId: string; ok: boolean; error?: string }> = [];
  for (const id of opts.estimateIds) {
    const r = await submitForApproval({
      estimateId: id,
      actor: opts.actor,
      tenantId: opts.tenantId,
    });
    results.push({
      estimateId: id,
      ok: r.ok,
      error: r.ok ? undefined : r.error,
    });
  }
  return {
    ok: true as const,
    submitted: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

/** Shop requests terminate → AWAITING_TERMINATE */
export async function shopRequestTerminate(opts: {
  estimateId?: string;
  rawToken?: string;
  actor: string;
  reason?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  let estimateId = opts.estimateId;
  let actorRole = "reviewer";
  if (opts.rawToken) {
    const resolved = await resolveActiveLink(opts.rawToken, "SHOP");
    if (!resolved) return { ok: false as const, status: 401, error: "Invalid or revoked link" };
    actorRole = "shop_link";
    const { rows } = await q(
      `SELECT id FROM repair.estimates
       WHERE event_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
      [resolved.event.id],
    );
    estimateId = rows[0] ? String(rows[0].id) : undefined;
  }
  if (!estimateId) return { ok: false as const, status: 400, error: "estimateId required" };

  const { rows } = await q(
    `SELECT e.*, s.code AS status_code FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [estimateId, tenantId],
  );
  const est = rows[0];
  if (!est) return { ok: false as const, status: 404, error: "Estimate not found" };

  const to = await getStatusByCode(tenantId, "ESTIMATE", "AWAITING_TERMINATE");
  if (!to) return { ok: false as const, status: 500, error: "AWAITING_TERMINATE missing" };
  const allowed = await assertTransitionAllowed({
    tenantId,
    entity: "ESTIMATE",
    fromStatusId: est.status_id,
    toStatusId: to.id,
    actor: actorRole,
  });
  if (!allowed.ok) return { ok: false as const, status: 403, error: allowed.reason };

  const revNo = Number(est.current_revision) + 1;
  await q(
    `INSERT INTO repair.estimate_revisions
       (tenant_id, estimate_id, rev_no, action, actor_name, labor, material, total,
        new_status, old_status, comment, created_by)
     VALUES ($1,$2,$3,'Terminate requested',$4,0,0,0,'AWAITING_TERMINATE',$5,$6,$4)`,
    [tenantId, estimateId, revNo, opts.actor, est.status_code, opts.reason ?? null],
  );
  await q(
    `UPDATE repair.estimates SET status_id = $1, current_revision = $2 WHERE id = $3`,
    [to.id, revNo, estimateId],
  );
  return { ok: true as const, status: "AWAITING_TERMINATE" as const };
}

/** #14 Request Dispo — only once Approved, only if not already requested */
export async function requestDispo(opts: {
  eventId?: string;
  eventIds?: string[];
  actor: string;
  instructions?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const ids = opts.eventIds?.length
    ? opts.eventIds
    : opts.eventId
      ? [opts.eventId]
      : [];
  if (!ids.length) return { ok: false as const, status: 400, error: "eventId(s) required" };

  const done: string[] = [];
  const skipped: Array<{ eventId: string; error: string }> = [];

  for (const eventId of ids) {
    const { rows } = await q(
      `SELECT e.id, e.dispo_requested_at, s.code AS status_code
       FROM repair.events e
       JOIN repair.statuses s ON s.id = e.status_id
       WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
      [eventId, tenantId],
    );
    const ev = rows[0];
    if (!ev) {
      skipped.push({ eventId, error: "not found" });
      continue;
    }
    // Estimate must be Approved (or event in repair / complete)
    const { rows: est } = await q(
      `SELECT s.code FROM repair.estimates e
       JOIN repair.statuses s ON s.id = e.status_id
       WHERE e.event_id = $1 AND e.deleted_at IS NULL
       ORDER BY e.created_at ASC LIMIT 1`,
      [eventId],
    );
    const estCode = est[0]?.code;
    if (estCode !== "APPROVED" && estCode !== "COMPLETED") {
      skipped.push({ eventId, error: `Estimate status ${estCode ?? "none"} — must be Approved` });
      continue;
    }
    if (ev.dispo_requested_at) {
      skipped.push({ eventId, error: "Dispo already requested" });
      continue;
    }
    await q(
      `INSERT INTO repair.dispo
         (tenant_id, event_id, direction, instructions, by_actor, kind, created_by)
       VALUES ($1,$2,'to_shop',$3,$4,'request',$4)`,
      [
        tenantId,
        eventId,
        opts.instructions?.trim() || "Request disposition",
        opts.actor,
      ],
    );
    await q(
      `UPDATE repair.events SET dispo_requested_at = now() WHERE id = $1`,
      [eventId],
    );
    done.push(eventId);
  }
  return { ok: true as const, requested: done, skipped };
}

/** #19 Update Responsibility — re-assign resp on lines of current revision */
export async function updateResponsibility(opts: {
  estimateId: string;
  lineUpdates: Array<{ lineId: string; respCode: string }>;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT e.*, s.code AS status_code FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [opts.estimateId, tenantId],
  );
  const est = rows[0];
  if (!est) return { ok: false as const, status: 404, error: "Estimate not found" };
  if (est.locked) {
    return { ok: false as const, status: 409, error: "Estimate locked" };
  }

  const revs = await listRevisions(opts.estimateId, tenantId);
  const current = revs[revs.length - 1];
  if (!current) return { ok: false as const, status: 404, error: "No revision" };
  const lines = await getRevisionLines(String(current.id));
  const byId = new Map(lines.map((l) => [String(l.id), l]));

  // New revision with updated resp codes (append-only)
  const revNo = Number(est.current_revision) + 1;
  const awaitStatus = await getStatusByCode(tenantId, "ESTIMATE", "AWAITING_APPROVAL");
  if (!awaitStatus) return { ok: false as const, status: 500, error: "status missing" };

  let labor = 0;
  let material = 0;
  let total = 0;
  const packed = await withTransaction(async (client) => {
    const rev = await client.query(
      `INSERT INTO repair.estimate_revisions
         (tenant_id, estimate_id, rev_no, action, actor_name, labor, material, total,
          new_status, old_status, comment, created_by)
       VALUES ($1,$2,$3,'Update Responsibility',$4,0,0,0,'AWAITING_APPROVAL',$5,$6,$4)
       RETURNING *`,
      [
        tenantId,
        opts.estimateId,
        revNo,
        opts.actor,
        est.status_code,
        `Updated ${opts.lineUpdates.length} line(s)`,
      ],
    );
    const updates = new Map(opts.lineUpdates.map((u) => [u.lineId, u.respCode]));
    let lineNo = 0;
    for (const line of lines) {
      lineNo += 1;
      const resp = updates.get(String(line.id)) ?? String(line.resp_code ?? "");
      labor += Number(line.labor ?? 0);
      material += Number(line.material ?? 0);
      total += Number(line.total ?? 0);
      await client.query(
        `INSERT INTO repair.estimate_lines
           (tenant_id, revision_id, line_no, aar_job_code, qualifier, why_made,
            condition_code, resp_code, labor, material, total,
            repair_category, sub_category, labor_cents, material_cents,
            aar_component_id, ddct_incident_id, raw_line, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          tenantId,
          rev.rows[0].id,
          line.line_no ?? lineNo,
          line.aar_job_code,
          line.qualifier,
          line.why_made,
          line.condition_code,
          resp,
          line.labor,
          line.material,
          line.total,
          line.repair_category,
          line.sub_category,
          line.labor_cents,
          line.material_cents,
          line.aar_component_id,
          line.ddct_incident_id,
          line.raw_line,
          opts.actor,
        ],
      );
    }
    await client.query(
      `UPDATE repair.estimate_revisions SET labor=$1, material=$2, total=$3 WHERE id=$4`,
      [labor, material, total, rev.rows[0].id],
    );
    await client.query(
      `UPDATE repair.estimates SET current_revision=$1, status_id=$2 WHERE id=$3`,
      [revNo, awaitStatus.id, opts.estimateId],
    );
    return rev.rows[0];
  });

  await notify({
    tenantId,
    eventId: String(est.event_id),
    type: "RESPONSIBILITY_UPDATED",
    bodyText: `Responsibility updated on estimate by ${opts.actor}; back to Awaiting Approval.`,
    actor: opts.actor,
  }).catch(() => undefined);

  return { ok: true as const, revision: packed, total };
}

/** #18 Export selected estimates as regenerated 500-byte (from raw_line) */
export async function exportEstimatesAar500(opts: {
  estimateIds: string[];
  tenantId?: string;
}): Promise<{ ok: true; files: Array<{ estimateId: string; filename: string; content: string }> }> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const files: Array<{ estimateId: string; filename: string; content: string }> = [];
  for (const estimateId of opts.estimateIds) {
    const { rows } = await q(
      `SELECT e.id, e.current_revision, ev.car_mark, ev.car_number
       FROM repair.estimates e
       JOIN repair.events ev ON ev.id = e.event_id
       WHERE e.id = $1 AND e.tenant_id = $2`,
      [estimateId, tenantId],
    );
    if (!rows[0]) continue;
    const { rows: revs } = await q(
      `SELECT id FROM repair.estimate_revisions
       WHERE estimate_id = $1 AND rev_no = $2`,
      [estimateId, rows[0].current_revision],
    );
    if (!revs[0]) continue;
    const lines = await getRevisionLines(String(revs[0].id));
    const content = lines
      .map((l) => String(l.raw_line ?? "").padEnd(500, " ").slice(0, 500))
      .filter((l) => l.trim().length)
      .join("\n");
    files.push({
      estimateId,
      filename: `${rows[0].car_mark}${rows[0].car_number}-rev${rows[0].current_revision}.dat`,
      content,
    });
  }
  return { ok: true, files };
}

/** #13 Actual outbound also moves estimate APPROVED → COMPLETED when appropriate */
export async function setActualOutboundAndComplete(opts: {
  eventId: string;
  actualDate: string;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const gate = await assertOutboundAllowed({ eventId: opts.eventId, tenantId });
  if (!gate.ok) return gate;

  await q(
    `UPDATE repair.events
     SET actual_outbound_at = $1::date
     WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL`,
    [opts.actualDate, opts.eventId, tenantId],
  );

  const { rows: est } = await q(
    `SELECT e.*, s.code AS status_code FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.event_id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL
     ORDER BY e.created_at ASC LIMIT 1`,
    [opts.eventId, tenantId],
  );
  if (est[0]?.status_code === "APPROVED") {
    const completed = await getStatusByCode(tenantId, "ESTIMATE", "COMPLETED");
    if (completed) {
      const allowed = await assertTransitionAllowed({
        tenantId,
        entity: "ESTIMATE",
        fromStatusId: est[0].status_id,
        toStatusId: completed.id,
        actor: "reviewer",
      });
      if (allowed.ok) {
        const revNo = Number(est[0].current_revision) + 1;
        await q(
          `INSERT INTO repair.estimate_revisions
             (tenant_id, estimate_id, rev_no, action, actor_name, labor, material, total,
              new_status, old_status, created_by)
           VALUES ($1,$2,$3,'Outbound / completed date entered',$4,0,0,0,'COMPLETED','APPROVED',$4)`,
          [tenantId, est[0].id, revNo, opts.actor],
        );
        await q(
          `UPDATE repair.estimates
           SET status_id = $1, current_revision = $2,
               completed_at = $3::timestamptz, locked = true
           WHERE id = $4`,
          [completed.id, revNo, new Date(opts.actualDate).toISOString(), est[0].id],
        );
      }
    }
  }

  await writeAudit({
    tenantId,
    entity: "event",
    entityId: opts.eventId,
    action: "ACTUAL_OUTBOUND_COMPLETE",
    after: { actualDate: opts.actualDate },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const };
}

/** #19 Railinc validation — reuse CRB validate on regenerated 500-byte */
export async function runRailincValidation(opts: {
  estimateId: string;
  tenantId?: string;
}) {
  const exported = await exportEstimatesAar500({
    estimateIds: [opts.estimateId],
    tenantId: opts.tenantId,
  });
  const file = exported.files[0];
  if (!file?.content) {
    return { ok: false as const, status: 404, error: "No 500-byte lines to validate" };
  }
  try {
    const { validateCripBytes } = await import("./crb-validate");
    const result = validateCripBytes(Buffer.from(file.content, "latin1"));
    return { ok: true as const, filename: file.filename, validation: result };
  } catch (err) {
    // Fallback: line-length check only
    const lines = file.content.split(/\n/);
    const bad = lines.filter((l) => l.length > 0 && l.length !== 500);
    return {
      ok: true as const,
      filename: file.filename,
      validation: {
        ok: bad.length === 0,
        errors: bad.map((l, i) => `Line ${i + 1}: length ${l.length} (expected 500)`),
        warnings: [],
        note: err instanceof Error ? err.message : "basic line-length validation",
      },
    };
  }
}

/** Mark event as tank car (or clear) for gate #11 */
export async function setEventTankCar(opts: {
  eventId: string;
  isTankCar: boolean;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  await q(
    `UPDATE repair.events SET is_tank_car = $1 WHERE id = $2 AND tenant_id = $3`,
    [opts.isTankCar, opts.eventId, tenantId],
  );
  await writeAudit({
    tenantId,
    entity: "event",
    entityId: opts.eventId,
    action: "SET_TANK_CAR",
    after: { isTankCar: opts.isTankCar },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const };
}
