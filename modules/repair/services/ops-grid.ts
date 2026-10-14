/**
 * Smaller Phase 1 ops: attachments, outbound target/actual, dispo queue,
 * multi-estimate invoice links, estimate grid filters/summary/export,
 * email opt-out + $ threshold, monthly bill summary.
 * Phase 2 hooks (carMARQS/CROP) — design only.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { getStorageProvider } from "../providers/storage";
import { assertOutboundAllowed } from "./tank-docs";
import { notify } from "./notifications";
import { listDispo } from "./dispo";

export async function listAttachmentCategories(tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT * FROM repair.attachment_categories
     WHERE tenant_id = $1 AND deleted_at IS NULL AND active
     ORDER BY sort_order`,
    [tenantId],
  );
  return rows;
}

export async function listEventDocuments(opts: {
  eventId: string;
  categoryCode?: string;
  sharedOnly?: boolean;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT * FROM repair.documents
     WHERE event_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       AND ($3::text IS NULL OR category_code = $3 OR kind = $3)
       AND ($4::boolean IS NULL OR is_shared = $4)
     ORDER BY uploaded_at DESC`,
    [opts.eventId, tenantId, opts.categoryCode ?? null, opts.sharedOnly ?? null],
  );
  return rows;
}

export async function downloadAllDocuments(opts: {
  eventId: string;
  tenantId?: string;
}): Promise<{
  ok: true;
  files: Array<{ filename: string; mime: string; bytes: Buffer; sha256: string }>;
}> {
  const docs = await listEventDocuments({
    eventId: opts.eventId,
    tenantId: opts.tenantId,
  });
  const files: Array<{ filename: string; mime: string; bytes: Buffer; sha256: string }> = [];
  for (const d of docs) {
    const stored = await getStorageProvider().get(String(d.storage_key));
    files.push({
      filename: String(d.original_filename ?? d.kind ?? d.id),
      mime: String(d.mime ?? "application/octet-stream"),
      bytes: stored.bytes,
      sha256: stored.sha256,
    });
  }
  return { ok: true, files };
}

export async function markDocumentShared(opts: {
  documentId: string;
  shared: boolean;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.documents
     SET is_shared = $1, category_code = COALESCE(category_code, 'shared')
     WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
     RETURNING *`,
    [opts.shared, opts.documentId, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Document not found" };
  await writeAudit({
    tenantId,
    entity: "document",
    entityId: opts.documentId,
    action: opts.shared ? "DOCUMENT_SHARED" : "DOCUMENT_UNSHARED",
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, document: rows[0] };
}

export async function setTargetOutboundBulk(opts: {
  eventIds: string[];
  targetDate: string;
  actor: string;
  note?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (!opts.eventIds.length) {
    return { ok: false as const, status: 400, error: "eventIds required" };
  }
  const { rows: setRows } = await q(
    `INSERT INTO repair.outbound_bulk_sets
       (tenant_id, target_date, note, created_by)
     VALUES ($1,$2::date,$3,$4)
     RETURNING *`,
    [tenantId, opts.targetDate, opts.note ?? null, opts.actor],
  );
  const bulkSetId = setRows[0].id;
  for (const eventId of opts.eventIds) {
    await q(
      `UPDATE repair.events SET target_outbound_at = $1::date WHERE id = $2 AND tenant_id = $3`,
      [opts.targetDate, eventId, tenantId],
    );
    await q(
      `INSERT INTO repair.outbound_bulk_set_events
         (tenant_id, bulk_set_id, event_id, created_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`,
      [tenantId, bulkSetId, eventId, opts.actor],
    );
  }
  await writeAudit({
    tenantId,
    entity: "outbound_bulk_set",
    entityId: bulkSetId,
    action: "TARGET_OUTBOUND_BULK",
    after: { targetDate: opts.targetDate, count: opts.eventIds.length },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, bulkSetId, count: opts.eventIds.length };
}

export async function setActualOutbound(opts: {
  eventId: string;
  actualDate: string;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const gate = await assertOutboundAllowed({ eventId: opts.eventId, tenantId });
  if (!gate.ok) return gate;

  const { rows } = await q(
    `UPDATE repair.events
     SET actual_outbound_at = $1::date
     WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
     RETURNING *`,
    [opts.actualDate, opts.eventId, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Event not found" };
  await writeAudit({
    tenantId,
    entity: "event",
    entityId: opts.eventId,
    action: "ACTUAL_OUTBOUND",
    after: { actualDate: opts.actualDate },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, event: rows[0] };
}

/** Dispo queue: events with pending to_shop dispo needing follow-up + email lessee option. */
export async function listDispoQueue(tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT DISTINCT ON (e.id)
        e.id AS event_id, e.car_mark, e.car_number, e.shop_id,
        d.id AS dispo_id, d.direction, d.instructions, d.at AS dispo_at,
        s.code AS status_code
     FROM repair.events e
     JOIN repair.statuses s ON s.id = e.status_id
     JOIN repair.dispo d ON d.event_id = e.id AND d.deleted_at IS NULL
     WHERE e.tenant_id = $1 AND e.deleted_at IS NULL
       AND s.code NOT IN ('CLOSED', 'VOIDED')
     ORDER BY e.id, d.at DESC`,
    [tenantId],
  );
  return rows;
}

export async function emailLesseeDispo(opts: {
  eventId: string;
  actor: string;
  tenantId?: string;
  extraTo?: string[];
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const items = await listDispo(opts.eventId, tenantId);
  const latest = items[items.length - 1];
  if (!latest) {
    return { ok: false as const, status: 404, error: "No dispo on event" };
  }
  await notify({
    tenantId,
    eventId: opts.eventId,
    type: "DISPO_LESSEE",
    bodyText: `Disposition update:\n\n${latest.instructions}\n\n(Information only.)`,
    extraTo: opts.extraTo,
    actor: opts.actor,
    forceExclude: ["shop", "shop_contact"],
  });
  await writeAudit({
    tenantId,
    entity: "dispo",
    entityId: latest.id,
    action: "DISPO_EMAILED_LESSEE",
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const };
}

/** Link one shop invoice to multiple completed estimates. */
export async function linkInvoiceToEstimates(opts: {
  invoiceId: string;
  estimateIds: string[];
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const linked: string[] = [];
  for (const estimateId of opts.estimateIds) {
    const { rows: est } = await q(
      `SELECT e.id, s.code AS status_code
       FROM repair.estimates e
       JOIN repair.statuses s ON s.id = e.status_id
       WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
      [estimateId, tenantId],
    );
    if (!est[0]) continue;
    if (est[0].status_code !== "COMPLETED" && est[0].status_code !== "APPROVED") {
      continue;
    }
    await q(
      `INSERT INTO repair.invoice_estimate_links
         (tenant_id, invoice_id, estimate_id, created_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (invoice_id, estimate_id) DO NOTHING`,
      [tenantId, opts.invoiceId, estimateId, opts.actor],
    );
    linked.push(estimateId);
  }
  await writeAudit({
    tenantId,
    entity: "invoice",
    entityId: opts.invoiceId,
    action: "INVOICE_LINKED_ESTIMATES",
    after: { estimateIds: linked },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, linked };
}

export type EstimateGridFilters = {
  statusCodes?: string[];
  shopId?: string;
  carMark?: string;
  carNumber?: string;
  fromDate?: string;
  toDate?: string;
  minTotal?: number;
  maxTotal?: number;
  includeHidden?: boolean;
  /** When true, include Queued shop-only drafts (owner_visible=false) */
  includeShopDraft?: boolean;
  tenantId?: string;
  limit?: number;
  offset?: number;
};

export async function queryEstimateGrid(filters: EstimateGridFilters = {}) {
  const tenantId = filters.tenantId ?? DEFAULT_TENANT_ID;
  const limit = Math.min(filters.limit ?? 200, 1000);
  const offset = filters.offset ?? 0;

  // Manual_Gap #16: default open statuses when none specified
  const defaultOpen = [
    "QUEUED",
    "AWAITING_APPROVAL",
    "REVISION_REQUESTED",
    "ADJUSTMENT_FOR_APPROVAL",
    "APPROVED",
    "AWAITING_TERMINATE",
    "AWAITING_DELETE",
  ];
  const statusCodes =
    filters.statusCodes?.length ? filters.statusCodes : defaultOpen;

  const { rows } = await q(
    `SELECT e.id AS estimate_id, e.event_id, e.current_revision, e.locked,
            e.completed_at, e.created_at,
            s.code AS status_code, s.display_name AS status_name,
            s.owner_visible, s.hidden,
            ev.car_mark, ev.car_number, ev.shop_id, ev.is_wreck, ev.is_tank_car,
            ev.yard_arrived_at, ev.target_outbound_at, ev.actual_outbound_at,
            sh.reporting_mark AS shop_mark, sh.name AS shop_name,
            r.labor, r.material, r.total,
            EXISTS (
              SELECT 1 FROM repair.estimate_load_cars lc
              JOIN repair.estimate_load_findings f ON f.load_run_id = lc.load_run_id
              WHERE lc.estimate_id = e.id AND f.severity IN ('ERROR','WARNING')
            ) AS has_issues,
            (SELECT COUNT(*)::int FROM repair.documents d
             WHERE d.event_id = e.event_id AND d.deleted_at IS NULL) AS attachment_count
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     JOIN repair.events ev ON ev.id = e.event_id
     LEFT JOIN repair.shops sh ON sh.id = ev.shop_id
     LEFT JOIN repair.estimate_revisions r
       ON r.estimate_id = e.id AND r.rev_no = e.current_revision
     WHERE e.tenant_id = $1
       AND (e.deleted_at IS NULL OR $2::boolean = true)
       AND (s.hidden = false OR $2::boolean = true)
       AND (s.owner_visible = true OR $2::boolean = true OR $13::boolean = true)
       AND ($3::text[] IS NULL OR s.code = ANY($3))
       AND ($4::uuid IS NULL OR ev.shop_id = $4)
       AND ($5::text IS NULL OR upper(ev.car_mark) = upper($5))
       AND ($6::text IS NULL OR ev.car_number = $6)
       AND ($7::timestamptz IS NULL OR e.created_at >= $7::timestamptz)
       AND ($8::timestamptz IS NULL OR e.created_at <= $8::timestamptz)
       AND ($9::numeric IS NULL OR COALESCE(r.total,0) >= $9)
       AND ($10::numeric IS NULL OR COALESCE(r.total,0) <= $10)
     ORDER BY e.created_at DESC
     LIMIT $11 OFFSET $12`,
    [
      tenantId,
      filters.includeHidden ?? false,
      statusCodes,
      filters.shopId ?? null,
      filters.carMark ?? null,
      filters.carNumber ?? null,
      filters.fromDate ?? null,
      filters.toDate ?? null,
      filters.minTotal ?? null,
      filters.maxTotal ?? null,
      limit,
      offset,
      filters.includeShopDraft ?? false,
    ],
  );

  const estimates = rows.length;
  const cars = new Set(rows.map((r) => `${r.car_mark}|${r.car_number}`)).size;
  const clients = new Set(rows.map((r) => r.shop_mark).filter(Boolean)).size;
  const totalCost = rows.reduce((s, r) => s + Number(r.total ?? 0), 0);

  return {
    rows,
    summary: {
      estimates,
      cars,
      clients,
      totalCost,
      perEstimate: estimates ? totalCost / estimates : 0,
      perCar: cars ? totalCost / cars : 0,
      perClient: clients ? totalCost / clients : 0,
    },
  };
}

export async function exportEstimateGridCsv(filters: EstimateGridFilters = {}) {
  const grid = await queryEstimateGrid({ ...filters, limit: 5000 });
  const header = [
    "estimate_id",
    "event_id",
    "car_mark",
    "car_number",
    "shop_mark",
    "status",
    "labor",
    "material",
    "total",
    "revision",
    "created_at",
  ];
  const lines = [header.join(",")];
  for (const r of grid.rows) {
    lines.push(
      [
        r.estimate_id,
        r.event_id,
        r.car_mark,
        r.car_number,
        r.shop_mark ?? "",
        r.status_code,
        r.labor ?? 0,
        r.material ?? 0,
        r.total ?? 0,
        r.current_revision,
        r.created_at,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
  }
  return { csv: lines.join("\n"), summary: grid.summary };
}

export async function setUserEmailOptOut(opts: {
  email: string;
  optedOut: boolean;
  optOutTypes?: string[];
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `INSERT INTO repair.user_email_prefs
       (tenant_id, email, opted_out, opt_out_types, created_by, updated_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,now())
     ON CONFLICT (tenant_id, email) DO UPDATE
       SET opted_out = EXCLUDED.opted_out,
           opt_out_types = EXCLUDED.opt_out_types,
           updated_at = now()
     RETURNING *`,
    [
      tenantId,
      opts.email.toLowerCase(),
      opts.optedOut,
      JSON.stringify(opts.optOutTypes ?? []),
      opts.actor,
    ],
  );
  return { ok: true as const, pref: rows[0] };
}

export async function setNotificationRuleMinAmount(opts: {
  notificationType: string;
  minAmountCents: number | null;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.notification_rules
     SET min_amount_cents = $1
     WHERE tenant_id = $2 AND notification_type = $3 AND deleted_at IS NULL
     RETURNING *`,
    [opts.minAmountCents, tenantId, opts.notificationType],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Rule not found" };
  await writeAudit({
    tenantId,
    entity: "notification_rule",
    entityId: rows[0].id,
    action: "RULE_MIN_AMOUNT",
    after: { minAmountCents: opts.minAmountCents },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, rule: rows[0] };
}

export async function buildMonthlyBillSummary(opts: {
  accountMonth: string;
  closeRunId?: string;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  // Aggregate billing_lines by billed party for account month
  const { rows } = await q(
    `SELECT COALESCE(NULLIF(btrim(billed_party), ''), 'UNKNOWN') AS billed_party_mark,
            COUNT(*)::int AS line_count,
            COALESCE(SUM(total_cents), 0)::bigint AS total_cents
     FROM repair.billing_lines
     WHERE tenant_id = $1 AND account_month = $2
     GROUP BY 1`,
    [tenantId, opts.accountMonth],
  );

  const summaries = [];
  for (const row of rows) {
    const { rows: s } = await q(
      `INSERT INTO repair.monthly_bill_summaries
         (tenant_id, account_month, billed_party_mark, line_count, total_cents,
          exception_count, close_run_id, created_by)
       VALUES ($1,$2,$3,$4,$5,0,$6,$7)
       ON CONFLICT (tenant_id, account_month, billed_party_mark) DO UPDATE
         SET line_count = EXCLUDED.line_count,
             total_cents = EXCLUDED.total_cents,
             close_run_id = COALESCE(EXCLUDED.close_run_id, repair.monthly_bill_summaries.close_run_id)
       RETURNING *`,
      [
        tenantId,
        opts.accountMonth,
        row.billed_party_mark,
        row.line_count,
        row.total_cents,
        opts.closeRunId ?? null,
        opts.actor,
      ],
    );
    summaries.push(s[0]);
  }

  // Exceptions: missing billed party mark
  const missing = await q(
    `SELECT e.id AS event_id
     FROM repair.events e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.tenant_id = $1 AND s.code = 'CLOSED'
       AND NOT EXISTS (
         SELECT 1 FROM repair.billed_party_mappings m
         WHERE m.tenant_id = e.tenant_id AND m.deleted_at IS NULL AND m.active
           AND upper(m.car_mark) = upper(e.car_mark) AND m.car_number = e.car_number
       )`,
    [tenantId],
  );

  for (const miss of missing.rows) {
    const summary =
      summaries[0] ??
      (
        await q(
          `INSERT INTO repair.monthly_bill_summaries
             (tenant_id, account_month, billed_party_mark, created_by)
           VALUES ($1,$2,'EXCEPTIONS',$3)
           ON CONFLICT (tenant_id, account_month, billed_party_mark) DO UPDATE
             SET exception_count = repair.monthly_bill_summaries.exception_count
           RETURNING *`,
          [tenantId, opts.accountMonth, opts.actor],
        )
      ).rows[0];
    await q(
      `INSERT INTO repair.monthly_bill_exceptions
         (tenant_id, summary_id, account_month, billed_party_mark, code, message, event_id, created_by)
       VALUES ($1,$2,$3,'EXCEPTIONS','MISSING_BILLED_PARTY','No billed-party mapping for closed event',$4,$5)`,
      [tenantId, summary.id, opts.accountMonth, miss.event_id, opts.actor],
    );
    await q(
      `UPDATE repair.monthly_bill_summaries
       SET exception_count = exception_count + 1 WHERE id = $1`,
      [summary.id],
    );
  }

  return { ok: true as const, summaries, exceptionHints: missing.rows.length };
}

export async function getPhase2Hooks(tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT phase2_hooks FROM repair.tenants WHERE id = $1`,
    [tenantId],
  );
  return (
    rows[0]?.phase2_hooks ?? {
      carMarqs: { enabled: false, note: "Phase 2 — design hook only" },
      crop: { enabled: false, note: "Phase 2 — design hook only" },
    }
  );
}
