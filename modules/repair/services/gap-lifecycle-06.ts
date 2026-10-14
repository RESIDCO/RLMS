/**
 * Lifecycle-06 — MG1–MG4 (Bruce 2026-10-14).
 * MG1 Internal correction editor (admin/reviewer only; shops re-upload).
 * MG2 VOIDED/attachment/comment soft-delete + admin restore (never purge).
 * MG3 Tank gate OFF for RESIDCO (handled in tank-docs + migration).
 * MG4 CROP/carMARQS Phase 2 hooks only.
 */
import { DEFAULT_TENANT_ID, q, withTransaction } from "../db";
import { writeAudit } from "./audit";
import { getStatusByCode, assertTransitionAllowed } from "./status-machine";
import { notify } from "./notifications";
import { resolveActiveLink } from "./event-links";
import type { EstimateLineInput } from "./estimates";
import { getPhase2Hooks } from "./ops-grid";
import {
  centsToDollars,
  formatDollars,
  lineLaborCents,
  lineMaterialCents,
  lineTotalCents,
  sumLineMoney,
} from "./money";

const INTERNAL_CORRECTION_STATUSES = new Set([
  "QUEUED",
  "AWAITING_APPROVAL",
  "REVISION_REQUESTED",
  "ADJUSTMENT_FOR_APPROVAL",
]);

const APPROVED_BLOCK_STATUSES = new Set([
  "APPROVED",
  "COMPLETED",
  "READY_TO_CLOSE",
  "CLOSED",
]);

export type CorrectionHeader = {
  shopMark?: string | null;
  billingParty?: string | null;
  billedParty?: string | null;
  invoiceNumber?: string | null;
  repairDate?: string | null;
  splc?: string | null;
  facilityType?: string | null;
  locationOnCar?: string | null;
  accountDateYymm?: string | null;
  currency?: string | null;
  notes?: string | null;
  [key: string]: unknown;
};

const INTERNAL_ROLES = new Set(["admin", "reviewer", "fleet_manager", "mech_manager"]);

/** MG1 — internal correction: edit header + lines; new revision; reason required. */
export async function saveInternalCorrection(opts: {
  estimateId: string;
  actor: string;
  actorRole?: string;
  reason: string;
  header?: CorrectionHeader;
  lines: EstimateLineInput[];
  tenantId?: string;
  /** When true and status is ADJUSTMENT_FOR_APPROVAL, allow after Approved path */
  asAdjustment?: boolean;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const actorRole = opts.actorRole ?? "reviewer";
  const reason = (opts.reason ?? "").trim();
  if (!reason) {
    return { ok: false as const, status: 400, error: "Correction reason is required" };
  }
  if (!INTERNAL_ROLES.has(actorRole) && actorRole !== "dev-bypass") {
    return {
      ok: false as const,
      status: 403,
      error: "Internal correction editor is admin/reviewer only (never shop link)",
    };
  }
  if (!opts.lines?.length) {
    return { ok: false as const, status: 400, error: "At least one line is required" };
  }

  const { rows } = await q(
    `SELECT e.*, s.code AS status_code, e.event_id
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [opts.estimateId, tenantId],
  );
  const estimate = rows[0];
  if (!estimate) {
    return { ok: false as const, status: 404, error: "Estimate not found (or VOIDED)" };
  }
  if (estimate.locked) {
    return {
      ok: false as const,
      status: 409,
      error: "Estimate is locked (completed). Use Adjustment after unlock/rollback if needed.",
    };
  }

  const statusCode = String(estimate.status_code);
  if (APPROVED_BLOCK_STATUSES.has(statusCode) && !opts.asAdjustment) {
    return {
      ok: false as const,
      status: 409,
      error:
        "Corrections cannot be made after Approved without going through Adjustment. " +
        "Shop re-upload creates Adjustment for Approval, or move to ADJUSTMENT_FOR_APPROVAL first.",
    };
  }
  if (statusCode === "VOIDED" || statusCode === "AWAITING_DELETE" || statusCode === "TERMINATED") {
    return {
      ok: false as const,
      status: 409,
      error: `Cannot correct estimate in status ${statusCode}`,
    };
  }
  if (!INTERNAL_CORRECTION_STATUSES.has(statusCode) && statusCode !== "ADJUSTMENT_FOR_APPROVAL") {
    // Allow if caller explicitly marked asAdjustment and we transition first
    if (!(opts.asAdjustment && APPROVED_BLOCK_STATUSES.has(statusCode))) {
      return {
        ok: false as const,
        status: 409,
        error: `Internal correction not allowed from status ${statusCode}`,
      };
    }
  }

  let workingStatusId = estimate.status_id;
  let workingStatusCode = statusCode;
  let oldStatusForRev = statusCode;

  // Post-Approved path: move to ADJUSTMENT_FOR_APPROVAL first when requested
  if (opts.asAdjustment && APPROVED_BLOCK_STATUSES.has(statusCode)) {
    const adj = await getStatusByCode(tenantId, "ESTIMATE", "ADJUSTMENT_FOR_APPROVAL");
    if (!adj) {
      return { ok: false as const, status: 500, error: "ADJUSTMENT_FOR_APPROVAL missing" };
    }
    const allowed = await assertTransitionAllowed({
      tenantId,
      entity: "ESTIMATE",
      fromStatusId: estimate.status_id,
      toStatusId: adj.id,
      actor: actorRole === "dev-bypass" ? "admin" : actorRole,
    });
    if (!allowed.ok) {
      return { ok: false as const, status: 403, error: allowed.reason };
    }
    workingStatusId = adj.id;
    workingStatusCode = "ADJUSTMENT_FOR_APPROVAL";
  }

  // Correction on Awaiting Approval / Queued / Revision Requested stays / moves to Awaiting Approval
  let targetCode = workingStatusCode;
  if (workingStatusCode === "QUEUED" || workingStatusCode === "REVISION_REQUESTED") {
    targetCode = "AWAITING_APPROVAL";
  } else if (workingStatusCode === "ADJUSTMENT_FOR_APPROVAL") {
    targetCode = "ADJUSTMENT_FOR_APPROVAL";
  } else {
    targetCode = "AWAITING_APPROVAL";
  }

  const newStatus = await getStatusByCode(tenantId, "ESTIMATE", targetCode);
  if (!newStatus) {
    return { ok: false as const, status: 500, error: `Status ${targetCode} missing` };
  }

  if (workingStatusCode !== targetCode) {
    const allowed = await assertTransitionAllowed({
      tenantId,
      entity: "ESTIMATE",
      fromStatusId: workingStatusId,
      toStatusId: newStatus.id,
      actor: actorRole === "dev-bypass" ? "reviewer" : actorRole,
    });
    // Queued→Awaiting may need yard; allow internal correction transition if seeded,
    // otherwise still proceed when same-family (reviewer override for correction).
    if (!allowed.ok && workingStatusCode !== "QUEUED") {
      return { ok: false as const, status: 403, error: allowed.reason };
    }
  }

  const { labor, material, total } = sumLineMoney(opts.lines);

  const header = opts.header ?? {};
  const revNo = Number(estimate.current_revision) + 1;

  const packed = await withTransaction(async (client) => {
    if (workingStatusId !== estimate.status_id) {
      await client.query(`UPDATE repair.estimates SET status_id = $1 WHERE id = $2`, [
        workingStatusId,
        opts.estimateId,
      ]);
    }

    const rev = await client.query(
      `INSERT INTO repair.estimate_revisions
         (tenant_id, estimate_id, rev_no, action, actor_name, actor_email,
          labor, material, total, new_status, old_status, comment,
          header, correction_reason, is_internal_correction, created_by)
       VALUES ($1,$2,$3,'Internal correction',$4,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$10,true,$4)
       RETURNING *`,
      [
        tenantId,
        opts.estimateId,
        revNo,
        opts.actor,
        labor,
        material,
        total,
        targetCode,
        oldStatusForRev,
        reason,
        JSON.stringify(header),
      ],
    );

    for (let i = 0; i < opts.lines.length; i++) {
      const line = opts.lines[i];
      const laborC = lineLaborCents(line);
      const materialC = lineMaterialCents(line);
      const totalC = lineTotalCents(line);
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
          line.lineNo ?? i + 1,
          line.aarJobCode ?? null,
          line.qualifier ?? null,
          line.whyMade ?? null,
          line.conditionCode ?? null,
          line.respCode ?? null,
          centsToDollars(laborC),
          centsToDollars(materialC),
          centsToDollars(totalC),
          line.repairCategory ?? null,
          line.subCategory ?? null,
          laborC,
          materialC,
          line.aarComponentId ?? null,
          line.ddctIncidentId ?? null,
          line.rawLine ?? null,
          opts.actor,
        ],
      );
    }

    const updated = await client.query(
      `UPDATE repair.estimates
       SET current_revision = $1, status_id = $2, current_header = $3::jsonb
       WHERE id = $4
       RETURNING *`,
      [revNo, newStatus.id, JSON.stringify(header), opts.estimateId],
    );

    return { revision: rev.rows[0], estimate: updated.rows[0] };
  });

  await writeAudit({
    tenantId,
    entity: "estimate",
    entityId: opts.estimateId,
    action: "INTERNAL_CORRECTION",
    before: { status: statusCode, rev: estimate.current_revision },
    after: {
      status: targetCode,
      rev: revNo,
      reason,
      labor,
      material,
      total,
      lines: opts.lines.length,
    },
    actor: opts.actor,
    via: "UI",
  });

  await notify({
    tenantId,
    eventId: String(estimate.event_id),
    type: "ESTIMATE_INTERNAL_CORRECTION",
    subject: "Estimate correction (internal)",
    bodyText:
      `An internal correction was saved on your estimate by ${opts.actor}.\n` +
      `Reason: ${reason}\n` +
      `New revision: ${revNo}\n` +
      `New total: $${formatDollars(total)}\n` +
      `Status: ${targetCode}`,
    actor: opts.actor,
  }).catch(() => undefined);

  return {
    ok: true as const,
    revision: packed.revision,
    estimate: packed.estimate,
    totals: { labor, material, total },
    status: targetCode,
  };
}

/** MG2 — admin restore VOIDED estimate (never purged). */
export async function restoreVoidedEstimate(opts: {
  estimateId: string;
  actor: string;
  actorRole?: string;
  reason: string;
  /** Restore target; default = old_status from void revision, else AWAITING_APPROVAL */
  toStatus?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const actorRole = opts.actorRole ?? "admin";
  const reason = (opts.reason ?? "").trim();
  if (!reason) {
    return { ok: false as const, status: 400, error: "Restore reason is required" };
  }
  if (actorRole !== "admin" && actorRole !== "dev-bypass") {
    return { ok: false as const, status: 403, error: "Only admins can restore VOIDED estimates" };
  }

  const { rows } = await q(
    `SELECT e.*, s.code AS status_code
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2`,
    [opts.estimateId, tenantId],
  );
  const estimate = rows[0];
  if (!estimate) return { ok: false as const, status: 404, error: "Estimate not found" };
  if (estimate.status_code !== "VOIDED" && !estimate.deleted_at) {
    return {
      ok: false as const,
      status: 409,
      error: `Expected VOIDED, found ${estimate.status_code}`,
    };
  }

  const { rows: voidRev } = await q(
    `SELECT old_status FROM repair.estimate_revisions
     WHERE estimate_id = $1 AND new_status = 'VOIDED'
     ORDER BY rev_no DESC LIMIT 1`,
    [opts.estimateId],
  );
  const restoreCode =
    opts.toStatus ??
    (voidRev[0]?.old_status && voidRev[0].old_status !== "VOIDED"
      ? String(voidRev[0].old_status)
      : "AWAITING_APPROVAL");

  // Never restore into terminal/hidden codes
  const safeCode =
    restoreCode === "AWAITING_DELETE" || restoreCode === "VOIDED" || restoreCode === "TERMINATED"
      ? "AWAITING_APPROVAL"
      : restoreCode;

  const to = await getStatusByCode(tenantId, "ESTIMATE", safeCode);
  if (!to) return { ok: false as const, status: 500, error: `Status ${safeCode} missing` };

  const allowed = await assertTransitionAllowed({
    tenantId,
    entity: "ESTIMATE",
    fromStatusId: estimate.status_id,
    toStatusId: to.id,
    actor: "admin",
  });
  if (!allowed.ok) {
    return { ok: false as const, status: 403, error: allowed.reason };
  }

  const revNo = Number(estimate.current_revision) + 1;
  await q(
    `INSERT INTO repair.estimate_revisions
       (tenant_id, estimate_id, rev_no, action, actor_name, actor_email,
        labor, material, total, new_status, old_status, comment, created_by)
     VALUES ($1,$2,$3,'Restore from Voided',$4,$4,0,0,0,$5,'VOIDED',$6,$4)`,
    [tenantId, opts.estimateId, revNo, opts.actor, safeCode, reason],
  );
  await q(
    `UPDATE repair.estimates
     SET status_id = $1, current_revision = $2,
         deleted_at = NULL, deleted_by = NULL, delete_reason = NULL
     WHERE id = $3`,
    [to.id, revNo, opts.estimateId],
  );

  await writeAudit({
    tenantId,
    entity: "estimate",
    entityId: opts.estimateId,
    action: "ESTIMATE_RESTORED",
    before: { status: "VOIDED" },
    after: { status: safeCode, reason },
    actor: opts.actor,
    via: "UI",
  });

  return { ok: true as const, status: safeCode };
}

export async function listVoidedEstimates(opts?: {
  tenantId?: string;
  includeAllHidden?: boolean;
}) {
  const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT e.*, s.code AS status_code, s.display_name AS status_name,
            ev.car_mark, ev.car_number
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     JOIN repair.events ev ON ev.id = e.event_id
     WHERE e.tenant_id = $1
       AND (s.code = 'VOIDED' OR e.deleted_at IS NOT NULL)
     ORDER BY e.deleted_at DESC NULLS LAST, e.created_at DESC`,
    [tenantId],
  );
  return rows;
}

/** Roles that may void / recategorize attachments (owner / system manager). Shop: add-only. */
const DOC_MANAGE_ROLES = new Set([
  "owner",
  "system_manager",
  "admin",
  "reviewer",
  "dev-bypass",
]);

export function canManageAttachments(actorRole?: string | null): boolean {
  const role = String(actorRole ?? "").trim().toLowerCase();
  return DOC_MANAGE_ROLES.has(role);
}

/** MG2 — soft-delete document (never hard delete). Shop cannot void/remove. */
export async function softDeleteDocument(opts: {
  documentId: string;
  actor: string;
  reason: string;
  actorRole?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const reason = (opts.reason ?? "").trim();
  if (!reason) return { ok: false as const, status: 400, error: "Delete reason required" };
  const role = String(opts.actorRole ?? "reviewer").trim().toLowerCase();
  if (!canManageAttachments(role)) {
    return {
      ok: false as const,
      status: 403,
      error: "Shop cannot delete, void, or recategorize attachments (add only)",
    };
  }
  const { rows } = await q(
    `UPDATE repair.documents
     SET deleted_at = now(), deleted_by = $1, delete_reason = $2,
         lifecycle_status = 'VOIDED'
     WHERE id = $3 AND tenant_id = $4 AND deleted_at IS NULL
     RETURNING *`,
    [opts.actor, reason, opts.documentId, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Document not found" };
  await writeAudit({
    tenantId,
    entity: "document",
    entityId: opts.documentId,
    action: "DOCUMENT_SOFT_DELETED",
    after: {
      reason,
      neverPurge: true,
      lifecycle_status: "VOIDED",
      actorRole: role,
    },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, document: rows[0] };
}

/** Recategorize attachment — owner/system manager only; audited. */
export async function recategorizeDocument(opts: {
  documentId: string;
  categoryCode: string;
  comment?: string;
  actor: string;
  actorRole?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const role = String(opts.actorRole ?? "reviewer").trim().toLowerCase();
  if (!canManageAttachments(role)) {
    return {
      ok: false as const,
      status: 403,
      error: "Shop cannot delete, void, or recategorize attachments (add only)",
    };
  }
  const { rows: before } = await q(
    `SELECT * FROM repair.documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [opts.documentId, tenantId],
  );
  if (!before[0]) return { ok: false as const, status: 404, error: "Document not found" };
  const { rows } = await q(
    `UPDATE repair.documents
     SET kind = COALESCE(NULLIF($1,''), kind),
         category_code = COALESCE(NULLIF($2,''), category_code),
         comment = COALESCE($3, comment),
         last_category_by = $4,
         last_category_at = now()
     WHERE id = $5 AND tenant_id = $6
     RETURNING *`,
    [
      opts.categoryCode,
      opts.categoryCode,
      opts.comment ?? null,
      opts.actor,
      opts.documentId,
      tenantId,
    ],
  );
  await writeAudit({
    tenantId,
    entity: "document",
    entityId: opts.documentId,
    action: "DOCUMENT_RECATEGORIZED",
    before: {
      kind: before[0].kind,
      category_code: before[0].category_code,
      comment: before[0].comment,
    },
    after: {
      kind: rows[0].kind,
      category_code: rows[0].category_code,
      comment: rows[0].comment,
      actorRole: role,
    },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, document: rows[0] };
}

export async function restoreDocument(opts: {
  documentId: string;
  actor: string;
  reason: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const reason = (opts.reason ?? "").trim();
  if (!reason) return { ok: false as const, status: 400, error: "Restore reason required" };
  const { rows } = await q(
    `UPDATE repair.documents
     SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
         lifecycle_status = 'ACTIVE'
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NOT NULL
     RETURNING *`,
    [opts.documentId, tenantId],
  );
  if (!rows[0]) {
    return { ok: false as const, status: 404, error: "Deleted document not found" };
  }
  await writeAudit({
    tenantId,
    entity: "document",
    entityId: opts.documentId,
    action: "DOCUMENT_RESTORED",
    after: { reason },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, document: rows[0] };
}

/** MG2 — soft-delete comment (never hard delete). */
export async function softDeleteComment(opts: {
  commentId: string;
  actor: string;
  reason: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const reason = (opts.reason ?? "").trim();
  if (!reason) return { ok: false as const, status: 400, error: "Delete reason required" };
  const { rows } = await q(
    `UPDATE repair.comments
     SET deleted_at = now(), deleted_by = $1, delete_reason = $2
     WHERE id = $3 AND tenant_id = $4 AND deleted_at IS NULL
     RETURNING *`,
    [opts.actor, reason, opts.commentId, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Comment not found" };
  await writeAudit({
    tenantId,
    entity: "comment",
    entityId: opts.commentId,
    action: "COMMENT_SOFT_DELETED",
    after: { reason, neverPurge: true },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, comment: rows[0] };
}

export async function restoreComment(opts: {
  commentId: string;
  actor: string;
  reason: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const reason = (opts.reason ?? "").trim();
  if (!reason) return { ok: false as const, status: 400, error: "Restore reason required" };
  const { rows } = await q(
    `UPDATE repair.comments
     SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NOT NULL
     RETURNING *`,
    [opts.commentId, tenantId],
  );
  if (!rows[0]) {
    return { ok: false as const, status: 404, error: "Deleted comment not found" };
  }
  await writeAudit({
    tenantId,
    entity: "comment",
    entityId: opts.commentId,
    action: "COMMENT_RESTORED",
    after: { reason },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, comment: rows[0] };
}

/**
 * MG2 — shop link locked when the event has a VOIDED estimate (or event VOIDED).
 * Call before shop mutations via event link.
 */
export async function assertShopLinkNotVoidLocked(opts: {
  rawToken?: string;
  eventId?: string;
  tenantId?: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  let eventId = opts.eventId;
  let tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (opts.rawToken) {
    const resolved = await resolveActiveLink(opts.rawToken, "SHOP");
    if (!resolved) {
      return { ok: false, status: 401, error: "Invalid or revoked link" };
    }
    eventId = String(resolved.event.id);
    tenantId = String(resolved.event.tenant_id ?? DEFAULT_TENANT_ID);
    if (String(resolved.event.status_code) === "VOIDED") {
      return {
        ok: false,
        status: 409,
        error: "Event is VOIDED — shop link locked (admin restore required)",
      };
    }
  }
  if (!eventId) return { ok: false, status: 400, error: "eventId or token required" };

  const { rows } = await q(
    `SELECT e.id, s.code
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.event_id = $1 AND e.tenant_id = $2
       AND (s.code = 'VOIDED' OR e.deleted_at IS NOT NULL)
     LIMIT 1`,
    [eventId, tenantId],
  );
  if (rows[0]) {
    return {
      ok: false,
      status: 409,
      error: "Estimate is VOIDED — locked from shop edits/link access (admin can restore)",
    };
  }
  return { ok: true };
}

/** MG4 — Phase 2 CROP import stub (not built). */
export async function cropImportPhase2Stub(_opts?: {
  actor?: string;
  tenantId?: string;
}) {
  const hooks = await getPhase2Hooks();
  return {
    ok: false as const,
    status: 501 as const,
    error: "CROP/AAR bill import is Phase 2 (carMARQS-style history). Phase 1 hooks only.",
    hooks,
  };
}

export async function getCorrectionEditorPayload(opts: {
  estimateId: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT e.*, s.code AS status_code, s.display_name AS status_name
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [opts.estimateId, tenantId],
  );
  const estimate = rows[0];
  if (!estimate) return { ok: false as const, status: 404, error: "Estimate not found" };

  const { rows: revs } = await q(
    `SELECT * FROM repair.estimate_revisions
     WHERE estimate_id = $1 ORDER BY rev_no DESC LIMIT 1`,
    [opts.estimateId],
  );
  const latest = revs[0];
  let lines: unknown[] = [];
  if (latest) {
    const { rows: lineRows } = await q(
      `SELECT * FROM repair.estimate_lines WHERE revision_id = $1 ORDER BY line_no`,
      [latest.id],
    );
    lines = lineRows;
  }

  const canCorrect = INTERNAL_CORRECTION_STATUSES.has(String(estimate.status_code));
  const needsAdjustment = APPROVED_BLOCK_STATUSES.has(String(estimate.status_code));

  return {
    ok: true as const,
    estimate,
    header: estimate.current_header ?? latest?.header ?? {},
    latestRevision: latest ?? null,
    lines,
    canCorrect,
    needsAdjustment,
    shopEditMode: "reupload_only" as const,
  };
}
