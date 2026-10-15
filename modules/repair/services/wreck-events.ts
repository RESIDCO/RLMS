/**
 * Wreck event dual-track — create/link BO, DDCT, owner + Resp3 estimates, shared docs.
 */
import { DEFAULT_TENANT_ID, q, withTransaction } from "../db";
import { writeAudit } from "./audit";
import { buildJicTracker, assertEstimateUploadAllowed } from "./wreck-jic";
import {
  canClearWreckFlags,
  getCurrentAarLaborRateCents,
  type WreckLoadMode,
} from "./wreck-validate";
import { getRule107Calculator } from "../providers/rule107-calculator";

const DDCT_RE = /^[A-Za-z0-9]{4}\d{8}$/;

export function normalizeDdctIncidentId(raw: string): string | null {
  const v = String(raw ?? "").trim().toUpperCase();
  if (!v) return null;
  if (!DDCT_RE.test(v)) return null;
  return v;
}

async function insertTrack(
  client: import("pg").PoolClient,
  tenantId: string,
  eventId: string,
  trackType: "OWNER_CONTRACT" | "R107_RESP3",
  actor?: string,
) {
  await client.query(
    `INSERT INTO repair.event_tracks (tenant_id, event_id, track_type, created_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (event_id, track_type) DO NOTHING`,
    [tenantId, eventId, trackType, actor ?? "system"],
  );
}

export async function createWreckEvent(opts: {
  tenantId?: string;
  actor: string;
  carMark: string;
  carNumber: string;
  shopId?: string | null;
  badOrderId?: string | null;
  eventId?: string | null;
  ddctIncidentId: string;
  incidentDate?: string | null;
  splc?: string | null;
  damagingRoad?: string | null;
  handlingRoad?: string | null;
  ruleBasis?: string;
  fm95aCondition?: string | null;
  lastCommodity?: string | null;
  stcc?: string | null;
  disposition?: string | null;
  shopArrivalDate?: string | null;
  jicType?: "STANDARD" | "ALTERNATE" | null;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const ddct = normalizeDdctIncidentId(opts.ddctIncidentId);
  if (!ddct) {
    return {
      ok: false as const,
      status: 400,
      error: "DDCT Incident ID required as XXXX99999999 (CRB App. G col 341)",
    };
  }
  const carMark = opts.carMark.trim().toUpperCase();
  const carNumber = opts.carNumber.trim().replace(/^0+(?=\d)/, "");
  if (!carMark || !carNumber) {
    return { ok: false as const, status: 400, error: "Car mark and number required" };
  }

  // Resolve / create underlying event
  let eventId = opts.eventId ?? null;
  let badOrderId = opts.badOrderId ?? null;
  let shopId = opts.shopId ?? null;

  if (badOrderId) {
    const { rows } = await q(
      `SELECT bo.*, e.car_mark, e.car_number, e.shop_id, e.is_wreck
       FROM repair.bad_orders bo
       JOIN repair.events e ON e.id = bo.event_id
       WHERE bo.id = $1 AND bo.tenant_id = $2 AND bo.deleted_at IS NULL`,
      [badOrderId, tenantId],
    );
    if (!rows[0]) return { ok: false as const, status: 404, error: "Bad order not found" };
    eventId = String(rows[0].event_id);
    shopId = shopId ?? (rows[0].shop_id ? String(rows[0].shop_id) : null);
  }

  if (eventId) {
    const { rows } = await q(
      `SELECT * FROM repair.events WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [eventId, tenantId],
    );
    if (!rows[0]) return { ok: false as const, status: 404, error: "Event not found" };
    shopId = shopId ?? (rows[0].shop_id ? String(rows[0].shop_id) : null);
  }

  if (!eventId && !shopId) {
    return {
      ok: false as const,
      status: 400,
      error: "Creating a wreck event requires car + shop (or a Bad Order that supplies them)",
    };
  }

  const packed = await withTransaction(async (client) => {
    if (!eventId) {
      const status = await client.query(
        `SELECT id FROM repair.statuses
         WHERE tenant_id = $1 AND entity = 'EVENT' AND code = 'OPEN' LIMIT 1`,
        [tenantId],
      );
      const statusId = status.rows[0]?.id;
      if (!statusId) throw new Error("EVENT/OPEN status missing");
      const ev = await client.query(
        `INSERT INTO repair.events
           (tenant_id, car_mark, car_number, shop_id, rule, damaging_road,
            ddct_incident_id, origin, status_id, is_wreck, created_by)
         VALUES ($1,$2,$3,$4,'RULE_107',$5,$6,'BO',$7,true,$8)
         RETURNING *`,
        [
          tenantId,
          carMark,
          carNumber,
          shopId,
          opts.damagingRoad?.trim().toUpperCase() || null,
          ddct,
          statusId,
          opts.actor,
        ],
      );
      eventId = String(ev.rows[0].id);
      await insertTrack(client, tenantId, eventId, "OWNER_CONTRACT", opts.actor);
      await insertTrack(client, tenantId, eventId, "R107_RESP3", opts.actor);
    } else {
      await client.query(
        `UPDATE repair.events
         SET is_wreck = true, rule = 'RULE_107',
             ddct_incident_id = COALESCE($2, ddct_incident_id),
             damaging_road = COALESCE($3, damaging_road)
         WHERE id = $1`,
        [
          eventId,
          ddct,
          opts.damagingRoad?.trim().toUpperCase() || null,
        ],
      );
      await insertTrack(client, tenantId, eventId!, "OWNER_CONTRACT", opts.actor);
      await insertTrack(client, tenantId, eventId!, "R107_RESP3", opts.actor);
    }

    const existing = await client.query(
      `SELECT id FROM repair.wreck_events
       WHERE event_id = $1 AND deleted_at IS NULL`,
      [eventId],
    );
    if (existing.rows[0]) {
      return { wreckId: String(existing.rows[0].id), eventId: eventId!, created: false };
    }

    const we = await client.query(
      `INSERT INTO repair.wreck_events
         (tenant_id, event_id, bad_order_id, car_mark, car_number, shop_id,
          ddct_incident_id, incident_date, splc, damaging_road, handling_road,
          rule_basis, fm_95a_condition, last_commodity, stcc, disposition,
          shop_arrival_date, jic_type, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12,$13,$14,$15,$16,$17::date,$18,$19)
       RETURNING *`,
      [
        tenantId,
        eventId,
        badOrderId,
        carMark,
        carNumber,
        shopId,
        ddct,
        opts.incidentDate ?? null,
        opts.splc ?? null,
        opts.damagingRoad?.trim().toUpperCase() || null,
        opts.handlingRoad?.trim().toUpperCase() || null,
        opts.ruleBasis ?? "107",
        opts.fm95aCondition ?? null,
        opts.lastCommodity ?? null,
        opts.stcc ?? null,
        opts.disposition ?? null,
        opts.shopArrivalDate ?? null,
        opts.jicType ?? "STANDARD",
        opts.actor,
      ],
    );
    return { wreckId: String(we.rows[0].id), eventId: eventId!, created: true, row: we.rows[0] };
  });

  await writeAudit({
    tenantId,
    entity: "wreck_event",
    entityId: packed.wreckId,
    action: packed.created ? "WRECK_EVENT_CREATED" : "WRECK_EVENT_LINKED",
    after: { eventId: packed.eventId, ddctIncidentId: ddct },
    actor: opts.actor,
    via: "UI",
  });

  return { ok: true as const, wreckEventId: packed.wreckId, eventId: packed.eventId };
}

export async function getWreckEvent(wreckEventId: string, tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT w.*,
            sh.name AS shop_name, sh.reporting_mark AS shop_mark,
            sh.city AS shop_city, sh.state AS shop_state
     FROM repair.wreck_events w
     LEFT JOIN repair.shops sh ON sh.id = w.shop_id
     WHERE w.id = $1 AND w.tenant_id = $2 AND w.deleted_at IS NULL`,
    [wreckEventId, tenantId],
  );
  if (!rows[0]) return null;
  const w = rows[0];

  const tracks = await q(
    `SELECT t.*, e.id AS est_id, s.code AS estimate_status,
            e.priced_quarter, e.wreck_flags_block, e.wreck_track_type
     FROM repair.event_tracks t
     LEFT JOIN repair.estimates e ON e.id = t.estimate_id AND e.deleted_at IS NULL
     LEFT JOIN repair.statuses s ON s.id = e.status_id
     WHERE t.event_id = $1 AND t.deleted_at IS NULL
     ORDER BY t.track_type`,
    [w.event_id],
  );

  const docs = await q(
    `SELECT id, kind, original_filename, mime, size, jic_photo, created_at, uploaded_by
     FROM repair.documents
     WHERE (wreck_event_id = $1 OR event_id = $2) AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [wreckEventId, w.event_id],
  );

  const flags = await q(
    `SELECT * FROM repair.wreck_flags
     WHERE wreck_event_id = $1 AND cleared_at IS NULL
     ORDER BY created_at ASC`,
    [wreckEventId],
  );

  const settlement = w.settlement_calc_id
    ? (
        await q(`SELECT * FROM repair.wreck_settlement_calcs WHERE id = $1`, [
          w.settlement_calc_id,
        ])
      ).rows[0]
    : null;

  const jic = buildJicTracker({
    shopArrivalDate: w.shop_arrival_date,
    jicType: w.jic_type,
    jicAmountCents: w.jic_amount_cents != null ? Number(w.jic_amount_cents) : null,
    jicPreparedAt: w.jic_prepared_at,
    jicSentToOwnerAt: w.jic_sent_to_owner_at,
    jicForwardedToRrAt: w.jic_forwarded_to_rr_at,
    jicEndorsedAt: w.jic_endorsed_at,
    jicAutoEndorsed: w.jic_auto_endorsed,
    repairCompleteAt: w.repair_complete_at,
  });

  const rate = await getCurrentAarLaborRateCents(tenantId);

  // Owner-only DV — never expose to shop/lessee callers (API layer enforces)
  const ownerDv = {
    originalCostCents:
      w.original_cost_cents != null ? Number(w.original_cost_cents) : null,
    buildDate: w.build_date,
    rebuiltIlsDate: w.rebuilt_ils_date,
    carTypeClass: w.car_type_class,
    abItems: w.ab_items_json,
    lightweightLb: w.lightweight_lb,
    nonMetallicLb: w.non_metallic_lb,
    aluminumLb: w.aluminum_lb,
    stainlessLb: w.stainless_lb,
    ddctEstimatedDvCents:
      w.ddct_estimated_dv_cents != null ? Number(w.ddct_estimated_dv_cents) : null,
    ddctActualDvCents:
      w.ddct_actual_dv_cents != null ? Number(w.ddct_actual_dv_cents) : null,
    exhibitEdition: w.exhibit_edition,
    settlement,
    provider: await getRule107Calculator().calculate({
      wreckEventId,
      inputs: {
        originalCostCents:
          w.original_cost_cents != null ? Number(w.original_cost_cents) : null,
      },
    }),
  };

  const jicPhotoCount = docs.rows.filter((d) => d.jic_photo).length;

  return {
    ...w,
    tracks: tracks.rows,
    documents: docs.rows,
    openFlags: flags.rows,
    jic,
    ownerDv,
    aarLaborRate: rate,
    jicPhotoCount,
    twoFilesRequiredCopy:
      "Shops must upload two separate 500-byte files after JIC endorsement: (1) owner/non–Resp 3, (2) Resp 3 only. Mixed files are HARD REJECTED.",
    rebillNotes:
      "Shop bills car owner for Resp 3. Owner rebills damaging road via CRB (detail source JI/DC/JD/DR/JR). Never Send Lessee on wreck. No tax lines on Resp 3.",
  };
}

export async function getWreckEventByEventId(
  eventId: string,
  tenantId = DEFAULT_TENANT_ID,
) {
  const { rows } = await q(
    `SELECT id FROM repair.wreck_events
     WHERE event_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [eventId, tenantId],
  );
  if (!rows[0]) return null;
  return getWreckEvent(String(rows[0].id), tenantId);
}

export async function updateWreckEvent(opts: {
  wreckEventId: string;
  tenantId?: string;
  actor: string;
  patch: Record<string, unknown>;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const allowed = [
    "incident_date",
    "splc",
    "damaging_road",
    "handling_road",
    "rule_basis",
    "fm_95a_condition",
    "last_commodity",
    "stcc",
    "disposition",
    "shop_arrival_date",
    "notified_at",
    "owner_reply_at",
    "inspection_at",
    "jic_type",
    "jic_prepared_at",
    "jic_sent_to_owner_at",
    "jic_forwarded_to_rr_at",
    "jic_endorsed_at",
    "jic_auto_endorsed",
    "jic_endorsing_road",
    "jic_decline_reason",
    "jic_amount_cents",
    "repair_complete_at",
    "billed_at",
    "original_cost_cents",
    "build_date",
    "rebuilt_ils_date",
    "car_type_class",
    "ab_items_json",
    "lightweight_lb",
    "non_metallic_lb",
    "aluminum_lb",
    "stainless_lb",
    "ddct_estimated_dv_cents",
    "ddct_actual_dv_cents",
    "exhibit_edition",
    "notes",
    "status",
  ] as const;

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(opts.patch, key)) {
      sets.push(`${key} = $${i++}`);
      vals.push(opts.patch[key]);
    }
  }
  if (opts.patch.ddctIncidentId != null) {
    const ddct = normalizeDdctIncidentId(String(opts.patch.ddctIncidentId));
    if (!ddct) {
      return { ok: false as const, status: 400, error: "Invalid DDCT Incident ID" };
    }
    sets.push(`ddct_incident_id = $${i++}`);
    vals.push(ddct);
  }
  if (!sets.length) {
    return { ok: false as const, status: 400, error: "No fields to update" };
  }
  sets.push(`updated_at = now()`, `updated_by = $${i++}`);
  vals.push(opts.actor);
  vals.push(opts.wreckEventId, tenantId);

  const { rows } = await q(
    `UPDATE repair.wreck_events
     SET ${sets.join(", ")}
     WHERE id = $${i++} AND tenant_id = $${i} AND deleted_at IS NULL
     RETURNING *`,
    vals,
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Wreck event not found" };

  await writeAudit({
    tenantId,
    entity: "wreck_event",
    entityId: opts.wreckEventId,
    action: "WRECK_EVENT_UPDATED",
    after: opts.patch,
    actor: opts.actor,
    via: "UI",
  });

  return { ok: true as const, wreck: rows[0] };
}

/** Persist ACCEPT+FLAG findings; set wreck_flags_block on estimate. */
export async function persistWreckFlags(opts: {
  tenantId?: string;
  wreckEventId: string;
  estimateId: string;
  loadRunId?: string | null;
  findings: Array<{
    severity: string;
    code: string;
    message: string;
    lineNo?: number;
    detail?: Record<string, unknown>;
  }>;
  actor: string;
  pricedQuarter?: string | null;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const flagRows = opts.findings.filter(
    (f) => f.severity === "WARNING" || f.severity === "FLAG",
  );
  for (const f of flagRows) {
    await q(
      `INSERT INTO repair.wreck_flags
         (tenant_id, wreck_event_id, estimate_id, load_run_id, severity, code,
          message, line_no, detail, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [
        tenantId,
        opts.wreckEventId,
        opts.estimateId,
        opts.loadRunId ?? null,
        f.severity === "FLAG" ? "FLAG" : "WARNING",
        f.code,
        f.message,
        f.lineNo ?? null,
        JSON.stringify(f.detail ?? {}),
        opts.actor,
      ],
    );
  }
  const block = flagRows.length > 0;
  await q(
    `UPDATE repair.estimates
     SET wreck_flags_block = $2,
         priced_quarter = COALESCE($3, priced_quarter),
         wreck_track_type = 'R107_RESP3'
     WHERE id = $1`,
    [opts.estimateId, block, opts.pricedQuarter ?? null],
  );
  return { flagCount: flagRows.length, block };
}

export async function clearWreckFlags(opts: {
  wreckEventId: string;
  estimateId?: string;
  flagIds?: string[];
  actor: string;
  actorRole?: string;
  reason: string;
  tenantId?: string;
}) {
  if (!canClearWreckFlags(opts.actorRole)) {
    return {
      ok: false as const,
      status: 403,
      error: "Only car owner or managing partner may clear wreck flags",
    };
  }
  if (!opts.reason?.trim()) {
    return { ok: false as const, status: 400, error: "Clear reason required" };
  }
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.wreck_flags
     SET cleared_at = now(), cleared_by = $1, clear_reason = $2
     WHERE wreck_event_id = $3 AND tenant_id = $4 AND cleared_at IS NULL
       AND ($5::uuid IS NULL OR estimate_id = $5)
       AND ($6::uuid[] IS NULL OR id = ANY($6))
     RETURNING id, estimate_id`,
    [
      opts.actor,
      opts.reason.trim(),
      opts.wreckEventId,
      tenantId,
      opts.estimateId ?? null,
      opts.flagIds?.length ? opts.flagIds : null,
    ],
  );

  const estimateIds = [
    ...new Set(rows.map((r) => String(r.estimate_id)).filter(Boolean)),
  ];
  for (const eid of estimateIds) {
    const open = await q(
      `SELECT 1 FROM repair.wreck_flags
       WHERE estimate_id = $1 AND cleared_at IS NULL LIMIT 1`,
      [eid],
    );
    if (!open.rows[0]) {
      await q(
        `UPDATE repair.estimates SET wreck_flags_block = false WHERE id = $1`,
        [eid],
      );
    }
  }

  await writeAudit({
    tenantId,
    entity: "wreck_event",
    entityId: opts.wreckEventId,
    action: "WRECK_FLAGS_CLEARED",
    after: {
      cleared: rows.length,
      reason: opts.reason,
      estimateIds,
    },
    actor: opts.actor,
    via: "UI",
  });

  return { ok: true as const, cleared: rows.length };
}

/** Bind loaded estimate to the correct wreck track. */
export async function attachEstimateToWreckTrack(opts: {
  eventId: string;
  estimateId: string;
  trackType: "OWNER_CONTRACT" | "R107_RESP3";
  wreckEventId?: string | null;
  tenantId?: string;
  actor: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  await q(
    `UPDATE repair.event_tracks
     SET estimate_id = $1
     WHERE event_id = $2 AND track_type = $3 AND deleted_at IS NULL`,
    [opts.estimateId, opts.eventId, opts.trackType],
  );
  await q(
    `UPDATE repair.estimates
     SET wreck_track_type = $2
     WHERE id = $1`,
    [opts.estimateId, opts.trackType],
  );
  if (opts.wreckEventId) {
    const col =
      opts.trackType === "R107_RESP3" ? "wreck_estimate_id" : "owner_estimate_id";
    await q(
      `UPDATE repair.wreck_events SET ${col} = $1, updated_at = now(), updated_by = $3
       WHERE id = $2`,
      [opts.estimateId, opts.wreckEventId, opts.actor],
    );
  }
}

export async function assertWreckEstimateUploadGate(eventId: string, tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT * FROM repair.wreck_events
     WHERE event_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [eventId, tenantId],
  );
  if (!rows[0]) return { ok: true as const, wreck: null };
  const gate = assertEstimateUploadAllowed({
    shopArrivalDate: rows[0].shop_arrival_date,
    jicType: rows[0].jic_type,
    jicAmountCents:
      rows[0].jic_amount_cents != null ? Number(rows[0].jic_amount_cents) : null,
    jicEndorsedAt: rows[0].jic_endorsed_at,
    jicAutoEndorsed: rows[0].jic_auto_endorsed,
  });
  if (!gate.ok) {
    return { ok: false as const, status: 409, error: gate.error!, wreck: rows[0] };
  }
  return { ok: true as const, wreck: rows[0] };
}

export type { WreckLoadMode };
