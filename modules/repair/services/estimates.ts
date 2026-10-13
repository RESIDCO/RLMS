import { DEFAULT_TENANT_ID, q, withTransaction } from "../db";
import { getStatusByCode, assertTransitionAllowed } from "./status-machine";
import { resolveActiveLink } from "./event-links";
import { requireVcfCar } from "./vcf";
import { writeAudit } from "./audit";
import { getStorageProvider } from "../providers/storage";
import { parseAarFile, signedMaterialCents } from "./aar-parser";
import { lookupRepairCategory } from "./categories";

export type EstimateLineInput = {
  lineNo?: number;
  aarJobCode?: string;
  qualifier?: string;
  whyMade?: string;
  conditionCode?: string;
  respCode?: string;
  labor?: number;
  material?: number;
  total?: number;
  laborCents?: number;
  materialCents?: number;
  repairCategory?: string | null;
  subCategory?: string | null;
  aarComponentId?: string | null;
  ddctIncidentId?: string | null;
  rawLine?: string;
};

async function ensureEstimate(opts: {
  tenantId: string;
  eventId: string;
  trackId?: string | null;
  actor: string;
}) {
  const existing = await q(
    `SELECT * FROM repair.estimates
     WHERE event_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     ORDER BY created_at ASC LIMIT 1`,
    [opts.eventId, opts.tenantId],
  );
  if (existing.rows[0]) return existing.rows[0];

  const queued = await getStatusByCode(opts.tenantId, "ESTIMATE", "QUEUED");
  if (!queued) throw new Error("ESTIMATE/QUEUED status missing");

  const { rows } = await q(
    `INSERT INTO repair.estimates
       (tenant_id, event_id, track_id, current_revision, status_id, created_by)
     VALUES ($1,$2,$3,0,$4,$5)
     RETURNING *`,
    [
      opts.tenantId,
      opts.eventId,
      opts.trackId ?? null,
      queued.id,
      opts.actor,
    ],
  );
  return rows[0];
}

export async function uploadEstimate(opts: {
  rawToken?: string;
  eventId?: string;
  tenantId?: string;
  actorName: string;
  actorEmail?: string;
  via: "event_link" | "UI";
  comment?: string;
  lines?: EstimateLineInput[];
  file?: { filename: string; mime: string; bytes: Buffer };
}) {
  let eventId = opts.eventId;
  let tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  let actor = opts.via === "event_link" ? "shop_link" : "reviewer";

  if (opts.rawToken) {
    const resolved = await resolveActiveLink(opts.rawToken, "SHOP");
    if (!resolved) {
      return { ok: false as const, status: 401, error: "Invalid or revoked link" };
    }
    eventId = String(resolved.event.id);
    tenantId = String(resolved.event.tenant_id ?? DEFAULT_TENANT_ID);
  }
  if (!eventId) {
    return { ok: false as const, status: 400, error: "eventId or token required" };
  }

  const { rows: events } = await q(
    `SELECT * FROM repair.events WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [eventId, tenantId],
  );
  const event = events[0];
  if (!event) return { ok: false as const, status: 404, error: "Event not found" };

  const vcf = await requireVcfCar(event.car_mark, event.car_number);
  if (!vcf.ok) {
    return { ok: false as const, status: 422, error: vcf.reason };
  }

  const estimate = await ensureEstimate({
    tenantId,
    eventId,
    actor: opts.actorEmail ?? opts.actorName,
  });

  const oldStatus = await q<{ code: string }>(
    `SELECT code FROM repair.statuses WHERE id = $1`,
    [estimate.status_id],
  );
  const oldCode = oldStatus.rows[0]?.code ?? null;

  let targetCode = "QUEUED";
  if (oldCode === "REVISION_REQUESTED" || oldCode === "QUEUED") {
    targetCode = oldCode === "REVISION_REQUESTED" ? "AWAITING_APPROVAL" : "QUEUED";
  }
  // New upload on Queued stays Queued with "New Estimate"; revision upload moves to Awaiting Approval
  const action =
    Number(estimate.current_revision) === 0 ? "New Estimate" : "Revised estimate uploaded";
  if (Number(estimate.current_revision) > 0) {
    targetCode = "AWAITING_APPROVAL";
  }

  const newStatus = await getStatusByCode(tenantId, "ESTIMATE", targetCode);
  if (!newStatus) {
    return { ok: false as const, status: 500, error: "Estimate status missing" };
  }

  if (oldCode && oldCode !== targetCode) {
    const allowed = await assertTransitionAllowed({
      tenantId,
      entity: "ESTIMATE",
      fromStatusId: estimate.status_id,
      toStatusId: newStatus.id,
      actor,
    });
    if (!allowed.ok) {
      // Allow first upload without transition table edge Queued→Queued
      if (!(oldCode === "QUEUED" && targetCode === "QUEUED")) {
        return { ok: false as const, status: 409, error: allowed.reason };
      }
    }
  }

  let sourceFileId: string | null = null;
  if (opts.file) {
    const stored = await getStorageProvider().put({
      tenantId,
      kind: "estimate_file",
      filename: opts.file.filename,
      mime: opts.file.mime,
      bytes: opts.file.bytes,
    });
    const doc = await q(
      `INSERT INTO repair.documents
         (tenant_id, event_id, kind, storage_key, sha256, size, mime, uploaded_by, created_by)
       VALUES ($1,$2,'estimate_file',$3,$4,$5,$6,$7,$7)
       RETURNING id`,
      [
        tenantId,
        eventId,
        stored.storageKey,
        stored.sha256,
        stored.size,
        stored.mime,
        opts.actorEmail ?? opts.actorName,
      ],
    );
    sourceFileId = doc.rows[0].id;
  }

  const lines = opts.lines?.length
    ? opts.lines
    : await linesFromAarFile(opts.file?.bytes, tenantId);

  const labor = lines.reduce(
    (s, l) => s + Number(l.labor ?? (l.laborCents != null ? l.laborCents / 100 : 0)),
    0,
  );
  const material = lines.reduce(
    (s, l) =>
      s + Number(l.material ?? (l.materialCents != null ? l.materialCents / 100 : 0)),
    0,
  );
  const total = lines.reduce(
    (s, l) =>
      s +
      Number(
        l.total ??
          Number(l.labor ?? (l.laborCents != null ? l.laborCents / 100 : 0)) +
            Number(l.material ?? (l.materialCents != null ? l.materialCents / 100 : 0)),
      ),
    0,
  );

  const packed = await withTransaction(async (client) => {
    const revNo = Number(estimate.current_revision) + 1;
    const rev = await client.query(
      `INSERT INTO repair.estimate_revisions
         (tenant_id, estimate_id, rev_no, action, actor_name, actor_email,
          labor, material, total, new_status, old_status, comment, source_file_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        tenantId,
        estimate.id,
        revNo,
        action,
        opts.actorName,
        opts.actorEmail ?? null,
        labor,
        material,
        total,
        targetCode,
        oldCode,
        opts.comment ?? null,
        sourceFileId,
        opts.actorEmail ?? opts.actorName,
      ],
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineTotal =
        Number(line.total ?? Number(line.labor ?? 0) + Number(line.material ?? 0));
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
          Number(line.labor ?? (line.laborCents != null ? line.laborCents / 100 : 0)),
          Number(
            line.material ?? (line.materialCents != null ? line.materialCents / 100 : 0),
          ),
          lineTotal,
          line.repairCategory ?? null,
          line.subCategory ?? null,
          line.laborCents ?? null,
          line.materialCents ?? null,
          line.aarComponentId ?? null,
          line.ddctIncidentId ?? null,
          line.rawLine ?? null,
          opts.actorEmail ?? opts.actorName,
        ],
      );
    }

    const updated = await client.query(
      `UPDATE repair.estimates
       SET current_revision = $1, status_id = $2
       WHERE id = $3
       RETURNING *`,
      [revNo, newStatus.id, estimate.id],
    );

    if (sourceFileId) {
      await client.query(
        `UPDATE repair.documents SET revision_id = $1 WHERE id = $2`,
        [rev.rows[0].id, sourceFileId],
      );
    }

    return { revision: rev.rows[0], estimate: updated.rows[0] };
  });

  await writeAudit({
    tenantId,
    entity: "estimate",
    entityId: estimate.id,
    action: action,
    after: {
      rev_no: packed.revision.rev_no,
      total,
      status: targetCode,
    },
    actor: opts.actorEmail ?? opts.actorName,
    via: opts.via,
  });

  return { ok: true as const, ...packed, linesCount: lines.length };
}

async function linesFromAarFile(
  bytes: Buffer | undefined,
  tenantId: string,
): Promise<EstimateLineInput[]> {
  if (!bytes || bytes.length === 0) {
    return [{ lineNo: 1, labor: 0, material: 0, total: 0, rawLine: "" }];
  }
  try {
    const parsed = parseAarFile(bytes);
    const out: EstimateLineInput[] = [];
    for (const line of parsed.lines) {
      if (line.recordFormat !== "1") continue;
      const cat = await lookupRepairCategory({
        tenantId,
        jobCode: line.appliedJobCode,
        qualifier: line.appliedQualifier,
      });
      const laborCents = line.laborCents ?? 0;
      const materialCents = signedMaterialCents(line);
      out.push({
        lineNo: Number(line.fields.line_number ?? line.lineNo) || line.lineNo,
        aarJobCode: line.appliedJobCode ?? undefined,
        qualifier: line.appliedQualifier ?? undefined,
        whyMade: line.whyMade ?? undefined,
        conditionCode: String(line.fields.condition_code ?? "").trim() || undefined,
        respCode: line.respCode ?? undefined,
        laborCents,
        materialCents,
        labor: laborCents / 100,
        material: materialCents / 100,
        total: (laborCents + materialCents) / 100,
        repairCategory: cat?.category ?? null,
        subCategory: cat?.sub_category ?? null,
        aarComponentId: line.aarComponentId,
        ddctIncidentId: line.ddctIncidentId,
        rawLine: line.rawLine,
      });
    }
    return out.length
      ? out
      : [{ lineNo: 1, labor: 0, material: 0, total: 0, rawLine: "" }];
  } catch (err) {
    console.warn("[repair/estimates] AAR parse failed; storing raw only", err);
    return [
      {
        lineNo: 1,
        labor: 0,
        material: 0,
        total: 0,
        rawLine: bytes.toString("latin1").slice(0, 500),
      },
    ];
  }
}

export async function listRevisions(estimateId: string, tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT * FROM repair.estimate_revisions
     WHERE estimate_id = $1 AND tenant_id = $2
     ORDER BY rev_no ASC`,
    [estimateId, tenantId],
  );
  return rows;
}

export async function getRevisionLines(revisionId: string) {
  const { rows } = await q(
    `SELECT * FROM repair.estimate_lines
     WHERE revision_id = $1
     ORDER BY line_no ASC`,
    [revisionId],
  );
  return rows;
}

export async function submitForApproval(opts: {
  estimateId: string;
  actor: string;
  tenantId?: string;
  comment?: string;
}) {
  return transitionEstimate({
    ...opts,
    actorRole: "reviewer",
    fromCode: "QUEUED",
    toCode: "AWAITING_APPROVAL",
    action: "Submit for Approval",
  });
}

export async function requestRevision(opts: {
  estimateId: string;
  actor: string;
  tenantId?: string;
  comment?: string;
}) {
  return transitionEstimate({
    ...opts,
    actorRole: "reviewer",
    fromCode: "AWAITING_APPROVAL",
    toCode: "REVISION_REQUESTED",
    action: "Reject / Request revision",
  });
}

export async function approveEstimate(opts: {
  estimateId: string;
  actor: string;
  tenantId?: string;
  comment?: string;
}) {
  return transitionEstimate({
    ...opts,
    actorRole: "reviewer",
    fromCode: "AWAITING_APPROVAL",
    toCode: "APPROVED",
    action: "Approve",
  });
}

async function transitionEstimate(opts: {
  estimateId: string;
  actor: string;
  actorRole: string;
  tenantId?: string;
  fromCode: string;
  toCode: string;
  action: string;
  comment?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT e.*, s.code AS status_code
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [opts.estimateId, tenantId],
  );
  const estimate = rows[0];
  if (!estimate) return { ok: false as const, status: 404, error: "Estimate not found" };
  if (estimate.status_code !== opts.fromCode) {
    return {
      ok: false as const,
      status: 409,
      error: `Expected ${opts.fromCode}, found ${estimate.status_code}`,
    };
  }

  const to = await getStatusByCode(tenantId, "ESTIMATE", opts.toCode);
  if (!to) return { ok: false as const, status: 500, error: "Status missing" };

  const allowed = await assertTransitionAllowed({
    tenantId,
    entity: "ESTIMATE",
    fromStatusId: estimate.status_id,
    toStatusId: to.id,
    actor: opts.actorRole,
  });
  if (!allowed.ok) {
    return { ok: false as const, status: 403, error: allowed.reason };
  }

  // VCF on approve
  if (opts.toCode === "APPROVED") {
    const ev = await q(
      `SELECT car_mark, car_number FROM repair.events WHERE id = $1`,
      [estimate.event_id],
    );
    const vcf = await requireVcfCar(ev.rows[0].car_mark, ev.rows[0].car_number);
    if (!vcf.ok) {
      return { ok: false as const, status: 422, error: vcf.reason };
    }
  }

  const last = await q(
    `SELECT * FROM repair.estimate_revisions
     WHERE estimate_id = $1 ORDER BY rev_no DESC LIMIT 1`,
    [opts.estimateId],
  );
  const prev = last.rows[0];
  const revNo = Number(estimate.current_revision) + 1;

  const packed = await withTransaction(async (client) => {
    const rev = await client.query(
      `INSERT INTO repair.estimate_revisions
         (tenant_id, estimate_id, rev_no, action, actor_name, actor_email,
          labor, material, total, new_status, old_status, comment, created_by)
       VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$5)
       RETURNING *`,
      [
        tenantId,
        opts.estimateId,
        revNo,
        opts.action,
        opts.actor,
        prev?.labor ?? 0,
        prev?.material ?? 0,
        prev?.total ?? 0,
        opts.toCode,
        opts.fromCode,
        opts.comment ?? null,
      ],
    );
    const updated = await client.query(
      `UPDATE repair.estimates
       SET current_revision = $1, status_id = $2
       WHERE id = $3
       RETURNING *`,
      [revNo, to.id, opts.estimateId],
    );
    return { revision: rev.rows[0], estimate: updated.rows[0] };
  });

  await writeAudit({
    tenantId,
    entity: "estimate",
    entityId: opts.estimateId,
    action: opts.action,
    before: { status: opts.fromCode },
    after: { status: opts.toCode },
    actor: opts.actor,
    via: "UI",
  });

  return { ok: true as const, ...packed };
}

export async function listEstimatesForEvent(eventId: string, tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT e.*, s.code AS status_code, s.display_name AS status_name
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.event_id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [eventId, tenantId],
  );
  return rows;
}
