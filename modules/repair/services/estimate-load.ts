/**
 * Estimate 500-byte load (shop link or inbound email).
 *
 * - ERRORS block the load entirely
 * - WARNINGS park the load for owner accept/reject
 * - Multi-car → one estimate per car
 * - Resp 3 wreck lines must be a separate file (reject mixed)
 * - Non-VCF cars → ERROR
 * - Open event match: before first approval = Revision;
 *   after approval = Adjustment → ADJUSTMENT_FOR_APPROVAL
 */
import { createHash } from "crypto";
import { DEFAULT_TENANT_ID, q, withTransaction } from "../db";
import { writeAudit } from "./audit";
import { parseAarFile, signedMaterialCents, type ParsedAarLine } from "./aar-parser";
import { requireVcfCar } from "./vcf";
import { resolveActiveLink } from "./event-links";
import { getStorageProvider } from "../providers/storage";
import { getStatusByCode, assertTransitionAllowed } from "./status-machine";
import { lookupRepairCategory } from "./categories";
import { getInboundEmailProvider } from "../providers/inbound-email";
import { notify } from "./notifications";

export type LoadFinding = {
  severity: "ERROR" | "WARNING";
  code: string;
  message: string;
  carMark?: string;
  carNumber?: string;
  lineNo?: number;
  detail?: Record<string, unknown>;
};

type CarBucket = {
  carMark: string;
  carNumber: string;
  lines: ParsedAarLine[];
};

function normalizeMark(v: string | number | null | undefined): string {
  return String(v ?? "")
    .trim()
    .toUpperCase();
}

function normalizeNumber(v: string | number | null | undefined): string {
  return String(v ?? "")
    .trim()
    .replace(/^0+(?=\d)/, "");
}

function groupByCar(lines: ParsedAarLine[]): CarBucket[] {
  const map = new Map<string, CarBucket>();
  for (const line of lines) {
    if (line.recordFormat !== "1") continue;
    const carMark = normalizeMark(line.fields.car_initial as string);
    const carNumber = normalizeNumber(line.fields.car_number as string);
    const key = `${carMark}|${carNumber}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { carMark, carNumber, lines: [] };
      map.set(key, bucket);
    }
    bucket.lines.push(line);
  }
  return [...map.values()];
}

function analyzeFile(bytes: Buffer): {
  parsed: ReturnType<typeof parseAarFile> | null;
  findings: LoadFinding[];
  cars: CarBucket[];
} {
  const findings: LoadFinding[] = [];
  let parsed: ReturnType<typeof parseAarFile> | null = null;
  try {
    parsed = parseAarFile(bytes);
  } catch (err) {
    findings.push({
      severity: "ERROR",
      code: "PARSE_FAILED",
      message: err instanceof Error ? err.message : "Failed to parse 500-byte file",
    });
    return { parsed: null, findings, cars: [] };
  }

  for (const line of parsed.lines) {
    if (line.rawLine.length !== 500) {
      findings.push({
        severity: "ERROR",
        code: "LINE_LENGTH",
        message: `Line ${line.lineNo}: expected 500 chars, got ${line.rawLine.length}`,
        lineNo: line.lineNo,
      });
    }
  }

  const detailLines = parsed.lines.filter((l) => l.recordFormat === "1");
  if (detailLines.length === 0) {
    findings.push({
      severity: "ERROR",
      code: "NO_DETAIL_LINES",
      message: "File has no Format 1 detail lines",
    });
  }

  const cars = groupByCar(parsed.lines);
  if (cars.length === 0 && detailLines.length > 0) {
    findings.push({
      severity: "ERROR",
      code: "MISSING_CAR_ID",
      message: "Detail lines missing car initial/number",
    });
  }

  // Resp 3 wreck lines must be separate file — reject mixed
  let hasResp3 = false;
  let hasNonResp3 = false;
  for (const line of detailLines) {
    const resp = String(line.respCode ?? "").trim();
    if (resp === "3") hasResp3 = true;
    else hasNonResp3 = true;
  }
  if (hasResp3 && hasNonResp3) {
    findings.push({
      severity: "ERROR",
      code: "RESP3_MIXED",
      message:
        "Responsibility 3 wreck lines must be in a separate file; mixed Resp 3 / non-3 rejected",
    });
  }

  if (cars.length > 1) {
    findings.push({
      severity: "WARNING",
      code: "MULTI_CAR",
      message: `File contains ${cars.length} cars; one estimate will be created per car`,
      detail: { carCount: cars.length },
    });
  }

  return { parsed, findings, cars };
}

async function findOpenEventForCar(
  tenantId: string,
  carMark: string,
  carNumber: string,
  preferredEventId?: string | null,
): Promise<Record<string, unknown> | null> {
  if (preferredEventId) {
    const { rows } = await q(
      `SELECT e.*, s.code AS status_code
       FROM repair.events e
       JOIN repair.statuses s ON s.id = e.status_id
       WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL
         AND upper(e.car_mark) = $3 AND e.car_number = $4`,
      [preferredEventId, tenantId, carMark, carNumber],
    );
    if (rows[0]) return rows[0];
  }
  const { rows } = await q(
    `SELECT e.*, s.code AS status_code
     FROM repair.events e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.tenant_id = $1 AND e.deleted_at IS NULL
       AND upper(e.car_mark) = $2 AND e.car_number = $3
       AND s.code NOT IN ('CLOSED', 'VOIDED', 'TERMINATED')
       AND s.is_terminal = false
     ORDER BY e.created_at DESC
     LIMIT 1`,
    [tenantId, carMark, carNumber],
  );
  return rows[0] ?? null;
}

async function estimateLoadKind(
  tenantId: string,
  eventId: string,
): Promise<"REVISION" | "ADJUSTMENT" | "NEW"> {
  const { rows } = await q(
    `SELECT e.id, s.code AS status_code, e.current_revision
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.event_id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL
     ORDER BY e.created_at ASC
     LIMIT 1`,
    [eventId, tenantId],
  );
  if (!rows[0]) return "NEW";
  const code = String(rows[0].status_code);
  // After approval (or adjustment / completed) → Adjustment
  if (
    code === "APPROVED" ||
    code === "ADJUSTMENT_FOR_APPROVAL" ||
    code === "COMPLETED"
  ) {
    return "ADJUSTMENT";
  }
  // Also: any prior revision that reached APPROVED in history
  const hist = await q(
    `SELECT 1 FROM repair.estimate_revisions
     WHERE estimate_id = $1 AND new_status = 'APPROVED'
     LIMIT 1`,
    [rows[0].id],
  );
  if (hist.rows[0]) return "ADJUSTMENT";
  return "REVISION";
}

async function persistFindings(
  client: import("pg").PoolClient,
  tenantId: string,
  loadRunId: string,
  findings: LoadFinding[],
  actor: string,
) {
  for (const f of findings) {
    await client.query(
      `INSERT INTO repair.estimate_load_findings
         (tenant_id, load_run_id, severity, code, message,
          car_mark, car_number, line_no, detail, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        tenantId,
        loadRunId,
        f.severity,
        f.code,
        f.message,
        f.carMark ?? null,
        f.carNumber ?? null,
        f.lineNo ?? null,
        JSON.stringify(f.detail ?? {}),
        actor,
      ],
    );
  }
}

async function applyCarEstimate(opts: {
  tenantId: string;
  eventId: string;
  car: CarBucket;
  loadKind: "REVISION" | "ADJUSTMENT" | "NEW";
  sourceFileId: string | null;
  actor: string;
  actorName: string;
  comment?: string;
}): Promise<{ estimateId: string; revisionId: string; labor: number; material: number; total: number }> {
  const tenantId = opts.tenantId;
  const { rows: existing } = await q(
    `SELECT e.*, s.code AS status_code
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.event_id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL
     ORDER BY e.created_at ASC LIMIT 1`,
    [opts.eventId, tenantId],
  );

  let estimate = existing[0];
  const queued = await getStatusByCode(tenantId, "ESTIMATE", "QUEUED");
  if (!queued) throw new Error("ESTIMATE/QUEUED missing");

  if (!estimate) {
    const ins = await q(
      `INSERT INTO repair.estimates
         (tenant_id, event_id, current_revision, status_id, created_by)
       VALUES ($1,$2,0,$3,$4)
       RETURNING *`,
      [tenantId, opts.eventId, queued.id, opts.actor],
    );
    estimate = { ...ins.rows[0], status_code: "QUEUED" };
  }

  if (estimate.locked) {
    throw new Error("Estimate is locked (completed); cannot load lines");
  }

  // Target status by load kind
  let targetCode = "QUEUED";
  let action = "New Estimate";
  if (opts.loadKind === "REVISION") {
    targetCode =
      Number(estimate.current_revision) === 0 && estimate.status_code === "QUEUED"
        ? "QUEUED"
        : "AWAITING_APPROVAL";
    action =
      Number(estimate.current_revision) === 0 ? "New Estimate" : "Revised estimate uploaded";
  } else if (opts.loadKind === "ADJUSTMENT") {
    targetCode = "ADJUSTMENT_FOR_APPROVAL";
    action = "Adjustment";
  } else {
    targetCode = "QUEUED";
    action = "New Estimate";
  }

  const newStatus = await getStatusByCode(tenantId, "ESTIMATE", targetCode);
  if (!newStatus) throw new Error(`Status ${targetCode} missing`);

  if (estimate.status_code !== targetCode) {
    const allowed = await assertTransitionAllowed({
      tenantId,
      entity: "ESTIMATE",
      fromStatusId: String(estimate.status_id),
      toStatusId: newStatus.id,
      actor: opts.actor.includes("@") || opts.actor === "shop_link" ? "shop_link" : "system",
    });
    // Allow Queued→Queued first upload; Adjustment from Approved uses seeded transition
    if (
      !allowed.ok &&
      !(estimate.status_code === "QUEUED" && targetCode === "QUEUED") &&
      !(
        opts.loadKind === "ADJUSTMENT" &&
        (estimate.status_code === "APPROVED" ||
          estimate.status_code === "COMPLETED" ||
          estimate.status_code === "ADJUSTMENT_FOR_APPROVAL")
      )
    ) {
      // Soft: still allow adjustment path via direct status set when transition exists seed-wise
      if (opts.loadKind !== "ADJUSTMENT") {
        throw new Error(allowed.reason);
      }
    }
  }

  const lineInputs: Array<{
    lineNo: number;
    aarJobCode?: string;
    qualifier?: string;
    whyMade?: string;
    conditionCode?: string;
    respCode?: string;
    laborCents: number;
    materialCents: number;
    labor: number;
    material: number;
    total: number;
    repairCategory: string | null;
    subCategory: string | null;
    aarComponentId: string | null;
    ddctIncidentId: string | null;
    rawLine: string;
  }> = [];

  for (const line of opts.car.lines) {
    const cat = await lookupRepairCategory({
      tenantId,
      jobCode: line.appliedJobCode,
      qualifier: line.appliedQualifier,
    });
    const laborCents = line.laborCents ?? 0;
    const materialCents = signedMaterialCents(line);
    lineInputs.push({
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

  const labor = lineInputs.reduce((s, l) => s + l.labor, 0);
  const material = lineInputs.reduce((s, l) => s + l.material, 0);
  const total = lineInputs.reduce((s, l) => s + l.total, 0);

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
        opts.actor,
        labor,
        material,
        total,
        targetCode,
        estimate.status_code,
        opts.comment ?? null,
        opts.sourceFileId,
        opts.actor,
      ],
    );
    for (const line of lineInputs) {
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
          line.lineNo,
          line.aarJobCode ?? null,
          line.qualifier ?? null,
          line.whyMade ?? null,
          line.conditionCode ?? null,
          line.respCode ?? null,
          line.labor,
          line.material,
          line.total,
          line.repairCategory,
          line.subCategory,
          line.laborCents,
          line.materialCents,
          line.aarComponentId,
          line.ddctIncidentId,
          line.rawLine,
          opts.actor,
        ],
      );
    }
    await client.query(
      `UPDATE repair.estimates
       SET current_revision = $1, status_id = $2
       WHERE id = $3`,
      [revNo, newStatus.id, estimate.id],
    );
    if (opts.sourceFileId) {
      await client.query(
        `UPDATE repair.documents SET revision_id = $1 WHERE id = $2`,
        [rev.rows[0].id, opts.sourceFileId],
      );
    }
    return { revisionId: String(rev.rows[0].id), estimateId: String(estimate.id) };
  });

  await writeAudit({
    tenantId,
    entity: "estimate",
    entityId: packed.estimateId,
    action: action,
    after: { loadKind: opts.loadKind, status: targetCode, total },
    actor: opts.actor,
    via: "estimate_load",
  });

  return { ...packed, labor, material, total };
}

export async function loadEstimateAar(opts: {
  bytes: Buffer;
  filename: string;
  mime?: string;
  source: "SHOP_LINK" | "INBOUND_EMAIL" | "UI";
  rawToken?: string;
  eventId?: string;
  tenantId?: string;
  actor: string;
  actorName?: string;
  comment?: string;
  /** When true, apply even if only WARNINGS (used after owner accept). */
  forceAcceptWarnings?: boolean;
  existingLoadRunId?: string;
}) {
  const actorName = opts.actorName ?? opts.actor;
  let tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  let preferredEventId = opts.eventId ?? null;
  let tokenHash: string | null = null;

  if (opts.rawToken) {
    const resolved = await resolveActiveLink(opts.rawToken, "SHOP");
    if (!resolved) {
      return { ok: false as const, status: 401, error: "Invalid or revoked link" };
    }
    preferredEventId = String(resolved.event.id);
    tenantId = String(resolved.event.tenant_id ?? DEFAULT_TENANT_ID);
    tokenHash = createHash("sha256").update(opts.rawToken).digest("hex");
  }

  const sha256 = createHash("sha256").update(opts.bytes).digest("hex");
  const { findings: baseFindings, cars } = analyzeFile(opts.bytes);

  // Per-car VCF + open-event checks
  const findings = [...baseFindings];
  for (const car of cars) {
    if (!car.carMark || !car.carNumber) {
      findings.push({
        severity: "ERROR",
        code: "MISSING_CAR_ID",
        message: "Car initial/number blank on detail lines",
        carMark: car.carMark,
        carNumber: car.carNumber,
      });
      continue;
    }
    const vcf = await requireVcfCar(car.carMark, car.carNumber);
    if (!vcf.ok) {
      findings.push({
        severity: "ERROR",
        code: "NON_VCF_CAR",
        message: vcf.reason,
        carMark: car.carMark,
        carNumber: car.carNumber,
      });
      continue;
    }
    const event = await findOpenEventForCar(
      tenantId,
      car.carMark,
      car.carNumber,
      preferredEventId,
    );
    if (!event) {
      findings.push({
        severity: "WARNING",
        // Manual_Gap #2 wording
        code: "NO_BAD_ORDERS_FOUND",
        message: `No Bad Orders Found for ${car.carMark} ${car.carNumber}`,
        carMark: car.carMark,
        carNumber: car.carNumber,
      });
    } else if (
      preferredEventId &&
      String(event.id) === preferredEventId &&
      (normalizeMark(String(event.car_mark)) !== car.carMark ||
        normalizeNumber(String(event.car_number)) !== car.carNumber)
    ) {
      findings.push({
        severity: "ERROR",
        code: "EVENT_CAR_MISMATCH",
        message: `File car ${car.carMark} ${car.carNumber} does not match event`,
        carMark: car.carMark,
        carNumber: car.carNumber,
      });
    }
  }

  const errors = findings.filter((f) => f.severity === "ERROR");
  const warnings = findings.filter((f) => f.severity === "WARNING");

  // Store original file always (immutable)
  const stored = await getStorageProvider().put({
    tenantId,
    kind: "aar_500byte",
    filename: opts.filename,
    mime: opts.mime ?? "text/plain",
    bytes: opts.bytes,
  });
  const doc = await q(
    `INSERT INTO repair.documents
       (tenant_id, event_id, kind, storage_key, sha256, size, mime,
        original_filename, uploaded_by, created_by)
     VALUES ($1,$2,'aar_500byte',$3,$4,$5,$6,$7,$8,$8)
     RETURNING id`,
    [
      tenantId,
      preferredEventId,
      stored.storageKey,
      stored.sha256,
      stored.size,
      stored.mime,
      opts.filename,
      opts.actor,
    ],
  );
  const sourceFileId = String(doc.rows[0].id);

  let status: string;
  if (errors.length > 0) status = "BLOCKED_ERRORS";
  else if (warnings.length > 0 && !opts.forceAcceptWarnings) status = "PENDING_WARNINGS";
  else status = "LOADED";

  const run = await withTransaction(async (client) => {
    let loadRunId = opts.existingLoadRunId;
    if (loadRunId) {
      await client.query(
        `UPDATE repair.estimate_load_runs
         SET status = $1, car_count = $2, source_document_id = $3
         WHERE id = $4`,
        [status, cars.length, sourceFileId, loadRunId],
      );
    } else {
      const ins = await client.query(
        `INSERT INTO repair.estimate_load_runs
           (tenant_id, source, event_link_token_hash, source_document_id,
            sha256, original_filename, status, car_count, actor, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
         RETURNING *`,
        [
          tenantId,
          opts.source,
          tokenHash,
          sourceFileId,
          sha256,
          opts.filename,
          status,
          cars.length,
          opts.actor,
        ],
      );
      loadRunId = String(ins.rows[0].id);
    }
    await persistFindings(client, tenantId, loadRunId!, findings, opts.actor);
    return { id: loadRunId!, status };
  });

  await writeAudit({
    tenantId,
    entity: "estimate_load_run",
    entityId: run.id,
    action: "ESTIMATE_LOAD_EVALUATED",
    after: {
      status: run.status,
      errors: errors.length,
      warnings: warnings.length,
      carCount: cars.length,
      sha256,
    },
    actor: opts.actor,
    via: opts.source,
  });

  if (status === "BLOCKED_ERRORS") {
    return {
      ok: false as const,
      status: 422,
      error: "Estimate load blocked by ERRORS",
      loadRunId: run.id,
      errors,
      warnings,
    };
  }

  if (status === "PENDING_WARNINGS") {
    let notifyEventId = preferredEventId;
    if (!notifyEventId && cars[0]) {
      const ev = await findOpenEventForCar(tenantId, cars[0].carMark, cars[0].carNumber);
      notifyEventId = ev ? String(ev.id) : null;
    }
    if (notifyEventId) {
      await notify({
        tenantId,
        eventId: notifyEventId,
        type: "ESTIMATE_LOAD_WARNINGS",
        bodyText: `Estimate file ${opts.filename} has ${warnings.length} warning(s) awaiting owner accept/reject.`,
        actor: opts.actor,
      }).catch(() => undefined);
    }
    return {
      ok: true as const,
      pendingWarnings: true as const,
      loadRunId: run.id,
      errors,
      warnings,
      carCount: cars.length,
    };
  }

  // Apply loads
  const applied: Array<Record<string, unknown>> = [];
  for (const car of cars) {
    const event = await findOpenEventForCar(
      tenantId,
      car.carMark,
      car.carNumber,
      preferredEventId,
    );
    if (!event) {
      // Should have been WARNING; if force-accepted without event, skip with note
      findings.push({
        severity: "WARNING",
        code: "SKIPPED_NO_EVENT",
        message: `Skipped ${car.carMark} ${car.carNumber}: no open event`,
        carMark: car.carMark,
        carNumber: car.carNumber,
      });
      continue;
    }
    const loadKind = await estimateLoadKind(tenantId, String(event.id));
    const result = await applyCarEstimate({
      tenantId,
      eventId: String(event.id),
      car,
      loadKind,
      sourceFileId,
      actor: opts.actor,
      actorName,
      comment: opts.comment,
    });
    await q(
      `INSERT INTO repair.estimate_load_cars
         (tenant_id, load_run_id, car_mark, car_number, event_id, estimate_id,
          revision_id, load_kind, line_count, labor, material, total, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (load_run_id, car_mark, car_number) DO UPDATE
         SET estimate_id = EXCLUDED.estimate_id,
             revision_id = EXCLUDED.revision_id,
             load_kind = EXCLUDED.load_kind,
             line_count = EXCLUDED.line_count,
             labor = EXCLUDED.labor,
             material = EXCLUDED.material,
             total = EXCLUDED.total`,
      [
        tenantId,
        run.id,
        car.carMark,
        car.carNumber,
        event.id,
        result.estimateId,
        result.revisionId,
        loadKind,
        car.lines.length,
        result.labor,
        result.material,
        result.total,
        opts.actor,
      ],
    );

    // Manual_Gap #6: loading an estimate and picking the B/O also accepts it
    await q(
      `UPDATE repair.bad_orders
       SET lifecycle_status = CASE
             WHEN lifecycle_status IN ('QUEUED', 'ACCEPTED_PENDING') THEN 'ACCEPTED_WORKING'
             ELSE lifecycle_status
           END
       WHERE event_id = $1 AND deleted_at IS NULL`,
      [event.id],
    ).catch(() => undefined);

    applied.push({
      carMark: car.carMark,
      carNumber: car.carNumber,
      eventId: event.id,
      estimateId: result.estimateId,
      revisionId: result.revisionId,
      loadKind,
      total: result.total,
    });
  }

  await q(
    `UPDATE repair.estimate_load_runs SET status = 'LOADED' WHERE id = $1`,
    [run.id],
  );

  return {
    ok: true as const,
    pendingWarnings: false as const,
    loadRunId: run.id,
    errors,
    warnings,
    applied,
  };
}

export async function decideEstimateLoadWarnings(opts: {
  loadRunId: string;
  decision: "ACCEPT_WARNINGS" | "REJECT_WARNINGS";
  actor: string;
  reason?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT * FROM repair.estimate_load_runs
     WHERE id = $1 AND tenant_id = $2`,
    [opts.loadRunId, tenantId],
  );
  const run = rows[0];
  if (!run) return { ok: false as const, status: 404, error: "Load run not found" };
  if (run.status !== "PENDING_WARNINGS") {
    return {
      ok: false as const,
      status: 409,
      error: `Load run is ${run.status}, expected PENDING_WARNINGS`,
    };
  }

  await q(
    `INSERT INTO repair.estimate_load_decisions
       (tenant_id, load_run_id, decision, reason, actor, created_by)
     VALUES ($1,$2,$3,$4,$5,$5)`,
    [tenantId, opts.loadRunId, opts.decision, opts.reason ?? null, opts.actor],
  );

  if (opts.decision === "REJECT_WARNINGS") {
    await q(
      `UPDATE repair.estimate_load_runs SET status = 'REJECTED_WARNINGS' WHERE id = $1`,
      [opts.loadRunId],
    );
    await writeAudit({
      tenantId,
      entity: "estimate_load_run",
      entityId: opts.loadRunId,
      action: "ESTIMATE_LOAD_WARNINGS_REJECTED",
      after: { reason: opts.reason ?? null },
      actor: opts.actor,
      via: "UI",
    });
    return { ok: true as const, rejected: true as const };
  }

  // Re-load from stored document with forceAcceptWarnings
  const { rows: docs } = await q(
    `SELECT * FROM repair.documents WHERE id = $1`,
    [run.source_document_id],
  );
  const doc = docs[0];
  if (!doc) return { ok: false as const, status: 500, error: "Source document missing" };
  const stored = await getStorageProvider().get(String(doc.storage_key));
  if (!stored?.bytes?.length) {
    return { ok: false as const, status: 500, error: "Stored bytes missing" };
  }

  const result = await loadEstimateAar({
    bytes: stored.bytes,
    filename: String(doc.original_filename ?? "estimate.dat"),
    mime: String(doc.mime ?? "text/plain"),
    source: run.source,
    tenantId,
    actor: opts.actor,
    forceAcceptWarnings: true,
    existingLoadRunId: opts.loadRunId,
    eventId: undefined,
  });

  await writeAudit({
    tenantId,
    entity: "estimate_load_run",
    entityId: opts.loadRunId,
    action: "ESTIMATE_LOAD_WARNINGS_ACCEPTED",
    after: { applied: "applied" in result ? result.applied : null },
    actor: opts.actor,
    via: "UI",
  });

  return result;
}

export async function getEstimateLoadRun(loadRunId: string, tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT * FROM repair.estimate_load_runs WHERE id = $1 AND tenant_id = $2`,
    [loadRunId, tenantId],
  );
  if (!rows[0]) return null;
  const findings = await q(
    `SELECT * FROM repair.estimate_load_findings
     WHERE load_run_id = $1 ORDER BY created_at ASC`,
    [loadRunId],
  );
  const cars = await q(
    `SELECT * FROM repair.estimate_load_cars WHERE load_run_id = $1`,
    [loadRunId],
  );
  const decisions = await q(
    `SELECT * FROM repair.estimate_load_decisions
     WHERE load_run_id = $1 ORDER BY decided_at ASC`,
    [loadRunId],
  );
  return {
    ...rows[0],
    findings: findings.rows,
    cars: cars.rows,
    decisions: decisions.rows,
  };
}

/** Dev inbound-email path: attachment + optional event token. */
export async function loadEstimateFromInboundEmail(opts: {
  toAddress: string;
  fromAddress: string;
  subject?: string;
  textBody?: string;
  attachments: Array<{ filename: string; contentType?: string; contentBase64: string }>;
  eventToken?: string;
}) {
  const provider = getInboundEmailProvider();
  const ingested = await provider.ingest({
    to: opts.toAddress,
    from: opts.fromAddress,
    subject: opts.subject ?? "",
    raw: opts.textBody ?? "",
    receivedAt: new Date().toISOString(),
    eventToken: opts.eventToken,
    attachments: opts.attachments.map((a) => ({
      filename: a.filename,
      mime: a.contentType ?? "application/octet-stream",
      contentBase64: a.contentBase64,
    })),
  });

  const aar =
    ingested.attachments.find((a) =>
      /\.(txt|dat|aar|crip)$/i.test(a.filename) || a.mime.includes("text"),
    ) ?? ingested.attachments[0];
  if (!aar) {
    return { ok: false as const, status: 400, error: "No 500-byte attachment found" };
  }

  // Token from explicit arg, ingest parse, or estimate+/shop-estimate+ local-part
  let token = opts.eventToken ?? ingested.eventToken;
  if (!token) {
    const m = opts.toAddress.match(
      /(?:shop-estimate|estimate|shop-invoice|invoice)\+([^@]+)@/i,
    );
    if (m) token = m[1];
  }

  return loadEstimateAar({
    bytes: aar.bytes,
    filename: aar.filename,
    mime: aar.mime,
    source: "INBOUND_EMAIL",
    rawToken: token,
    actor: opts.fromAddress,
    actorName: opts.fromAddress,
  });
}
