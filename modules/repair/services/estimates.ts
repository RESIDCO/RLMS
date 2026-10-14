import { DEFAULT_TENANT_ID, q, withTransaction } from "../db";
import { getStatusByCode, assertTransitionAllowed } from "./status-machine";
import { resolveActiveLink } from "./event-links";
import { requireVcfCar } from "./vcf";
import { writeAudit } from "./audit";
import { getStorageProvider } from "../providers/storage";
import { parseAarFile, signedMaterialCents } from "./aar-parser";
import { lookupRepairCategory } from "./categories";
import {
  centsToDollars,
  lineLaborCents,
  lineMaterialCents,
  lineTotalCents,
  sumLineMoney,
} from "./money";

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
  // MG2: VOIDED estimates stay in DB (never purge) — block shop from creating a twin
  const voided = await q(
    `SELECT e.id FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.event_id = $1 AND e.tenant_id = $2
       AND (s.code = 'VOIDED' OR e.deleted_at IS NOT NULL)
     LIMIT 1`,
    [opts.eventId, opts.tenantId],
  );
  if (voided.rows[0]) {
    throw Object.assign(
      new Error(
        "Estimate is VOIDED — locked from shop edits/link access (admin can restore)",
      ),
      { status: 409, code: "VOIDED_LOCKED" },
    );
  }

  const existing = await q(
    `SELECT * FROM repair.estimates
     WHERE event_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     ORDER BY created_at ASC LIMIT 1`,
    [opts.eventId, opts.tenantId],
  );
  if (existing.rows[0]) return existing.rows[0];

  const queued = await getStatusByCode(opts.tenantId, "ESTIMATE", "QUEUED");
  if (!queued) throw new Error("ESTIMATE/QUEUED status missing");

  // Carry entity snapshot from event (set at BO create); fall back to live lookup
  const { rows: evEntity } = await q(
    `SELECT entity_code, entity_source_value, car_mark, car_number
     FROM repair.events WHERE id = $1 AND tenant_id = $2`,
    [opts.eventId, opts.tenantId],
  );
  let entityCode =
    evEntity[0]?.entity_code != null ? String(evEntity[0].entity_code) : null;
  let entitySource =
    evEntity[0]?.entity_source_value != null
      ? String(evEntity[0].entity_source_value)
      : null;
  if (!entityCode && evEntity[0]) {
    const { resolveEntitySnapshot } = await import("./entity");
    const snap = await resolveEntitySnapshot({
      carMark: String(evEntity[0].car_mark),
      carNumber: String(evEntity[0].car_number),
      tenantId: opts.tenantId,
    });
    entityCode = snap.code;
    entitySource = snap.sourceValue;
    if (entityCode) {
      await q(
        `UPDATE repair.events
         SET entity_code = COALESCE(entity_code, $1),
             entity_source_value = COALESCE(entity_source_value, $2)
         WHERE id = $3 AND tenant_id = $4`,
        [entityCode, entitySource, opts.eventId, opts.tenantId],
      );
    }
  }

  const { rows } = await q(
    `INSERT INTO repair.estimates
       (tenant_id, event_id, track_id, current_revision, status_id, created_by,
        entity_code, entity_source_value)
     VALUES ($1,$2,$3,0,$4,$5,$6,$7)
     RETURNING *`,
    [
      opts.tenantId,
      opts.eventId,
      opts.trackId ?? null,
      queued.id,
      opts.actor,
      entityCode,
      entitySource,
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

  let estimate: Record<string, unknown>;
  try {
    estimate = await ensureEstimate({
      tenantId,
      eventId,
      actor: opts.actorEmail ?? opts.actorName,
    });
  } catch (err) {
    const e = err as { status?: number; code?: string; message?: string };
    if (e.code === "VOIDED_LOCKED") {
      return { ok: false as const, status: 409, error: e.message ?? "VOIDED locked" };
    }
    throw err;
  }

  if (estimate.locked) {
    return {
      ok: false as const,
      status: 409,
      error: "Estimate is locked (completed). Documents/photos can still be added; estimate lines cannot change.",
    };
  }

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
    const kind =
      opts.file.mime?.includes("pdf") || opts.file.filename.toLowerCase().endsWith(".pdf")
        ? "estimate_pdf"
        : opts.file.filename.toLowerCase().match(/\.(txt|dat)$/)
          ? "aar_500byte"
          : "estimate_file";
    const doc = await q(
      `INSERT INTO repair.documents
         (tenant_id, event_id, kind, storage_key, sha256, size, mime,
          original_filename, uploaded_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       RETURNING id`,
      [
        tenantId,
        eventId,
        kind,
        stored.storageKey,
        stored.sha256,
        stored.size,
        stored.mime,
        opts.file.filename,
        opts.actorEmail ?? opts.actorName,
      ],
    );
    sourceFileId = doc.rows[0].id;
  }

  const lines = opts.lines?.length
    ? opts.lines
    : await linesFromAarFile(opts.file?.bytes, tenantId);

  const { labor, material, total } = sumLineMoney(lines);

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
      const laborC = lineLaborCents(line);
      const materialC = lineMaterialCents(line);
      const totalC = lineTotalCents(line);
      await client.query(
        `INSERT INTO repair.estimate_lines
           (tenant_id, revision_id, line_no, aar_job_code, qualifier, why_made,
            condition_code, resp_code, labor, material, total,
            repair_category, sub_category, labor_cents, material_cents,
            aar_component_id, ddct_incident_id, raw_line, created_by, entity_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
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
          opts.actorEmail ?? opts.actorName,
          (estimate as { entity_code?: string | null }).entity_code ?? null,
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
        labor: centsToDollars(laborCents),
        material: centsToDollars(materialCents),
        total: centsToDollars(laborCents + materialCents),
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
  // Yard arrival required to leave Queued (Bruce status rules)
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows: yard } = await q(
    `SELECT ev.yard_arrived_at
     FROM repair.estimates e
     JOIN repair.events ev ON ev.id = e.event_id
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [opts.estimateId, tenantId],
  );
  if (yard[0] && !yard[0].yard_arrived_at) {
    return {
      ok: false as const,
      status: 409,
      error: "Yard arrival required before leaving Queued",
    };
  }
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

  // OWNER_UI §C: Estimate Approved → Bad Order Closed
  if (opts.toCode === "APPROVED") {
    await q(
      `UPDATE repair.bad_orders
       SET lifecycle_status = 'CLOSED'
       WHERE event_id = $1 AND deleted_at IS NULL
         AND lifecycle_status IN ('QUEUED','ACCEPTED_PENDING','ACCEPTED_WORKING')`,
      [estimate.event_id],
    ).catch(() => undefined);
    await writeAudit({
      tenantId,
      entity: "event",
      entityId: String(estimate.event_id),
      action: "BO_CLOSED_ON_ESTIMATE_APPROVED",
      after: { estimateId: opts.estimateId },
      actor: opts.actor,
      via: "UI",
    }).catch(() => undefined);
  }

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

/** Docs/photos allowed even when estimate is locked (completed). */
export async function uploadEventDocument(opts: {
  rawToken?: string;
  eventId?: string;
  tenantId?: string;
  kind: string;
  /** Attachment category (sds / scope_of_work / photograph / other). */
  categoryCode?: string;
  comment?: string;
  actorEmail: string;
  file: { filename: string; mime: string; bytes: Buffer };
}) {
  let eventId = opts.eventId;
  let tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
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

  const categoryCode = (opts.categoryCode || opts.kind || "other")
    .trim()
    .toLowerCase();
  const kind = opts.kind?.trim() || categoryCode || "other";

  const stored = await getStorageProvider().put({
    tenantId,
    kind,
    filename: opts.file.filename,
    mime: opts.file.mime,
    bytes: opts.file.bytes,
  });

  const { rows } = await q(
    `INSERT INTO repair.documents
       (tenant_id, event_id, kind, category_code, comment, storage_key, sha256, size, mime,
        uploaded_by, created_by, original_filename)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11)
     RETURNING *`,
    [
      tenantId,
      eventId,
      kind,
      categoryCode,
      opts.comment?.trim() || null,
      stored.storageKey,
      stored.sha256,
      stored.size,
      stored.mime,
      opts.actorEmail,
      opts.file.filename,
    ],
  );

  await writeAudit({
    tenantId,
    entity: "document",
    entityId: rows[0].id,
    action: "DOCUMENT_UPLOADED",
    after: {
      kind,
      categoryCode,
      comment: opts.comment?.trim() || null,
      sha256: stored.sha256,
    },
    actor: opts.actorEmail,
    via: opts.rawToken ? "event_link" : "UI",
  });

  return { ok: true as const, document: rows[0] };
}
