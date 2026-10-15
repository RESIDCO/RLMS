/**
 * Threaded comments on estimate or line with per-comment notify.
 * Shops revise only by re-upload (no in-app line edit) — comments are discussion only.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { notify } from "./notifications";
import { centsToDollars, lineLaborCents, lineMaterialCents, lineTotalCents } from "./money";

export async function listComments(opts: {
  eventId?: string;
  estimateId?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (opts.estimateId) {
    const { rows } = await q(
      `SELECT * FROM repair.comments
       WHERE tenant_id = $1 AND estimate_id = $2 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [tenantId, opts.estimateId],
    );
    return rows;
  }
  if (opts.eventId) {
    const { rows } = await q(
      `SELECT * FROM repair.comments
       WHERE tenant_id = $1 AND event_id = $2 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [tenantId, opts.eventId],
    );
    return rows;
  }
  return [];
}

export async function addComment(opts: {
  eventId: string;
  estimateId?: string;
  revisionId?: string;
  lineId?: string;
  parentId?: string;
  body: string;
  /** Manual_Gap #8 — Subject on comment thread */
  subject?: string;
  /** Manual_Gap #8 — Issue classification */
  issue?: string;
  author: string;
  /** Opt-in per comment (default false — RS "Send email notice…") */
  notify?: boolean;
  notifyRoles?: string[];
  notifyEmails?: string[];
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const body = opts.body.trim();
  if (!body) return { ok: false as const, status: 400, error: "Comment body required" };

  if (opts.parentId) {
    const parent = await q(
      `SELECT id FROM repair.comments
       WHERE id = $1 AND event_id = $2 AND deleted_at IS NULL`,
      [opts.parentId, opts.eventId],
    );
    if (!parent.rows[0]) {
      return { ok: false as const, status: 404, error: "Parent comment not found" };
    }
  }

  // Manual_Gap #8: emailing is opt-in per comment (default off)
  const shouldNotify = opts.notify === true;
  const notifyRoles = opts.notifyRoles ?? ["reviewer", "mech_manager"];
  const notifyEmails = opts.notifyEmails ?? [];

  const { rows } = await q(
    `INSERT INTO repair.comments
       (tenant_id, event_id, estimate_id, revision_id, line_id, parent_id,
        body, subject, issue, notify_roles, notify_emails, did_notify, author, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$13)
     RETURNING *`,
    [
      tenantId,
      opts.eventId,
      opts.estimateId ?? null,
      opts.revisionId ?? null,
      opts.lineId ?? null,
      opts.parentId ?? null,
      body,
      opts.subject?.trim() || null,
      opts.issue?.trim() || null,
      JSON.stringify(notifyRoles),
      JSON.stringify(notifyEmails),
      false,
      opts.author,
    ],
  );
  const comment = rows[0];

  if (shouldNotify) {
    await notify({
      tenantId,
      eventId: opts.eventId,
      type: "COMMENT",
      bodyText: `Comment by ${opts.author}:\n\n${body}`,
      extraTo: notifyEmails,
      actor: opts.author,
    }).catch(() => undefined);
    await q(`UPDATE repair.comments SET did_notify = true WHERE id = $1`, [comment.id]);
  }

  await writeAudit({
    tenantId,
    entity: "comment",
    entityId: comment.id,
    action: "COMMENT_ADDED",
    after: {
      estimateId: opts.estimateId ?? null,
      lineId: opts.lineId ?? null,
      parentId: opts.parentId ?? null,
      notified: shouldNotify,
    },
    actor: opts.author,
    via: "UI",
  });

  return { ok: true as const, comment };
}

/** Line-level revision compare (added/removed/changed). */
export async function compareRevisions(opts: {
  leftRevisionId: string;
  rightRevisionId: string;
}) {
  const left = await q(
    `SELECT * FROM repair.estimate_lines WHERE revision_id = $1 ORDER BY line_no`,
    [opts.leftRevisionId],
  );
  const right = await q(
    `SELECT * FROM repair.estimate_lines WHERE revision_id = $1 ORDER BY line_no`,
    [opts.rightRevisionId],
  );

  const keyOf = (r: Record<string, unknown>) =>
    `${r.aar_job_code ?? ""}|${r.qualifier ?? ""}|${r.why_made ?? ""}|${r.line_no}`;

  const leftMap = new Map(left.rows.map((r) => [keyOf(r), r]));
  const rightMap = new Map(right.rows.map((r) => [keyOf(r), r]));

  const added: unknown[] = [];
  const removed: unknown[] = [];
  const changed: Array<{ left: unknown; right: unknown; deltas: Record<string, unknown> }> = [];

  for (const [k, r] of rightMap) {
    if (!leftMap.has(k)) added.push(r);
  }
  for (const [k, l] of leftMap) {
    if (!rightMap.has(k)) removed.push(l);
    else {
      const r = rightMap.get(k)!;
      const deltas: Record<string, unknown> = {};
      for (const field of ["labor", "material", "total", "resp_code", "condition_code"] as const) {
        if (String(l[field] ?? "") !== String(r[field] ?? "")) {
          deltas[field] = { from: l[field], to: r[field] };
        }
      }
      if (Object.keys(deltas).length) changed.push({ left: l, right: r, deltas });
    }
  }

  const sum = (rows: typeof left.rows) => {
    let laborCents = 0;
    let materialCents = 0;
    let totalCents = 0;
    for (const r of rows) {
      const line = {
        labor: r.labor as number | string | null,
        material: r.material as number | string | null,
        total: r.total as number | string | null,
        laborCents: r.labor_cents != null ? Number(r.labor_cents) : null,
        materialCents: r.material_cents != null ? Number(r.material_cents) : null,
      };
      laborCents += lineLaborCents(line);
      materialCents += lineMaterialCents(line);
      totalCents += lineTotalCents(line);
    }
    return {
      labor: centsToDollars(laborCents),
      material: centsToDollars(materialCents),
      total: centsToDollars(totalCents),
    };
  };

  return {
    leftRevisionId: opts.leftRevisionId,
    rightRevisionId: opts.rightRevisionId,
    added,
    removed,
    changed,
    totals: { left: sum(left.rows), right: sum(right.rows) },
  };
}
