/**
 * §G Shop portal — shop role scoped to own shop mark.
 * Never exposes other shops' data, lessee info, DV / settlement docs.
 * Open-Q defaults: (a) withdraw until review starts; (b) upload + hand entry;
 * (c) email contact LIST.
 */
import { createHash } from "crypto";
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { compareRevisions } from "./comments";
import { listViewerDocuments } from "./documents-viewer";
import { loadEstimateAar } from "./estimate-load";
import {
  submitForApproval,
  type EstimateLineInput,
} from "./estimates";
import { buildBrcPdf } from "./brc-pdf";
import { exportEstimatesAar500 } from "./gap-lifecycle-05";
import { notify } from "./notifications";
import {
  getRailincValidator,
  persistValidationRun,
  type ValidateResult,
  type ValidationFinding,
} from "./railinc-validator";
import { parseAarFile } from "./aar-parser";
import { getStatusByCode } from "./status-machine";
import {
  getBoLifecycleBundle,
  shopKpis,
  listDecisionComments,
  formatCommentsForEmail,
  commentedLinesDiff,
} from "./shop-clarity";
import {
  SHOP_STATUS_TILES,
  classifyBoTile,
  emptyTileCounts,
  ensureShopBoLink,
  type ShopStatusTile,
} from "./shop-workflow";

export type ShopActor = {
  role: string;
  shopMark: string;
  shopId?: string | null;
  actor: string;
  tenantId?: string;
};

const ESTIMATE_STATUS_BUCKETS = [
  "DRAFT",
  "QUEUED",
  "AWAITING_APPROVAL",
  "REVISION_REQUESTED",
  "ADJUSTMENT_FOR_APPROVAL",
  "APPROVED",
  "COMPLETED",
  "REJECTED",
] as const;

export type ShopStatusBucket =
  | "Draft"
  | "Submitted"
  | "Rejected"
  | "Adjustment for Approval"
  | "Approved"
  | "Completed";

function mapStatusLabel(code: string): ShopStatusBucket | string {
  switch (code) {
    case "QUEUED":
    case "DRAFT":
      return "Draft";
    case "AWAITING_APPROVAL":
      return "Submitted";
    case "REVISION_REQUESTED":
      return "Rejected";
    case "ADJUSTMENT_FOR_APPROVAL":
      return "Adjustment for Approval";
    case "APPROVED":
      return "Approved";
    case "COMPLETED":
      return "Completed";
    default:
      return code;
  }
}

function normalizeMark(v: string): string {
  return String(v ?? "")
    .trim()
    .toUpperCase();
}

const SHOP_WRITE_ROLES = new Set(["shop", "shop_user", "shop_link", "dev-bypass"]);
const SHOP_READONLY_ROLES = new Set(["owner", "managing_partner"]);

/** Owner/MP may view shop pages read-only; only shop roles may mutate. */
export function isShopReadOnlyRole(role: string): boolean {
  return SHOP_READONLY_ROLES.has(String(role ?? "").toLowerCase());
}

export function assertShopWriteRole(
  role: string,
): { ok: true } | { ok: false; status: 403; error: string } {
  const r = String(role ?? "").toLowerCase();
  if (SHOP_WRITE_ROLES.has(r)) return { ok: true };
  if (SHOP_READONLY_ROLES.has(r)) {
    return {
      ok: false,
      status: 403,
      error: "Read-only shop view (owner/managing partner)",
    };
  }
  return { ok: false, status: 403, error: "Shop portal write requires shop role" };
}

/** Resolve shop row for actor; 403 if mark mismatch / missing. */
export async function resolveShopContext(opts: ShopActor): Promise<
  | {
      ok: true;
      shop: Record<string, unknown>;
      tenantId: string;
      readOnly: boolean;
      viewingAsShopMark: string;
    }
  | { ok: false; status: number; error: string }
> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const role = String(opts.role ?? "").toLowerCase();
  const readOnly = isShopReadOnlyRole(role);
  if (
    role &&
    !SHOP_WRITE_ROLES.has(role) &&
    !SHOP_READONLY_ROLES.has(role)
  ) {
    // Lessee / unrelated roles stay blocked
    if (["reviewer", "admin", "lessee"].includes(role)) {
      return { ok: false, status: 403, error: "Shop portal only" };
    }
  }
  const mark = normalizeMark(opts.shopMark);
  if (!mark) {
    return { ok: false, status: 403, error: "Shop mark required" };
  }

  let shop: Record<string, unknown> | undefined;
  if (opts.shopId) {
    const { rows } = await q(
      `SELECT * FROM repair.shops
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [opts.shopId, tenantId],
    );
    shop = rows[0];
  }
  if (!shop) {
    const { rows } = await q(
      `SELECT * FROM repair.shops
       WHERE tenant_id = $1 AND deleted_at IS NULL
         AND (upper(coalesce(shop_mark,'')) = $2 OR upper(coalesce(reporting_mark,'')) = $2)
       ORDER BY active DESC, created_at ASC
       LIMIT 1`,
      [tenantId, mark],
    );
    shop = rows[0];
  }
  if (!shop) {
    return { ok: false, status: 403, error: "Shop not found for mark" };
  }
  const shopMark = normalizeMark(
    String(shop.shop_mark ?? shop.reporting_mark ?? ""),
  );
  if (shopMark !== mark && normalizeMark(String(shop.reporting_mark ?? "")) !== mark) {
    return { ok: false, status: 403, error: "Cross-shop access denied" };
  }
  return {
    ok: true,
    shop,
    tenantId,
    readOnly,
    viewingAsShopMark: shopMark || mark,
  };
}

async function assertEventOwnedByShop(
  eventId: string,
  shopId: string,
  tenantId: string,
): Promise<
  | { ok: true; event: Record<string, unknown> }
  | { ok: false; status: number; error: string }
> {
  const { rows } = await q(
    `SELECT e.*, s.code AS status_code
     FROM repair.events e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [eventId, tenantId],
  );
  const event = rows[0];
  if (!event) return { ok: false, status: 404, error: "Event not found" };
  if (String(event.shop_id) !== String(shopId)) {
    return { ok: false, status: 403, error: "Cross-shop access denied" };
  }
  return { ok: true, event };
}

async function assertEstimateOwnedByShop(
  estimateId: string,
  shopId: string,
  tenantId: string,
): Promise<
  | {
      ok: true;
      estimate: Record<string, unknown>;
      event: Record<string, unknown>;
    }
  | { ok: false; status: number; error: string }
> {
  const { rows } = await q(
    `SELECT est.*, st.code AS status_code, est.event_id
     FROM repair.estimates est
     JOIN repair.statuses st ON st.id = est.status_id
     WHERE est.id = $1 AND est.tenant_id = $2 AND est.deleted_at IS NULL`,
    [estimateId, tenantId],
  );
  const estimate = rows[0];
  if (!estimate) return { ok: false, status: 404, error: "Estimate not found" };
  const owned = await assertEventOwnedByShop(
    String(estimate.event_id),
    shopId,
    tenantId,
  );
  if (!owned.ok) return owned;
  return { ok: true, estimate, event: owned.event };
}

/** Shop home: BOs + estimates by status + clickable status tiles + car search. */
export async function shopPortalHome(opts: ShopActor & {
  carInitial?: string;
  carNumber?: string;
  status?: string;
  /** §G r4 tile filter (exact tile label) */
  tile?: string;
}) {
  const ctx = await resolveShopContext(opts);
  if (!ctx.ok) return ctx;
  const shopId = String(ctx.shop.id);
  const tenantId = ctx.tenantId;

  const carInitial = opts.carInitial ? normalizeMark(opts.carInitial) : null;
  const carNumber = opts.carNumber
    ? String(opts.carNumber).trim().replace(/^0+(?=\d)/, "")
    : null;

  const showSmoke = process.env.REPAIR_SHOW_SMOKE === "1";
  const { rows: bos } = await q(
    `SELECT e.id AS event_id, e.car_mark, e.car_number, e.rule, e.is_wreck,
            e.yard_arrived_at, e.acknowledged_at, s.code AS event_status,
            bo.id AS bad_order_id, bo.lifecycle_status, bo.shopping_reason,
            bo.bo_date, bo.bo_city, bo.bo_state, bo.comments AS owner_instructions,
            bo.arrival_date, bo.closed_at, bo.closed_reason,
            bo.completed_date, bo.missed_pod_reason_code,
            coalesce(e.is_smoke, false) OR coalesce(bo.is_smoke, false) AS is_smoke
     FROM repair.events e
     JOIN repair.statuses s ON s.id = e.status_id
     LEFT JOIN repair.bad_orders bo ON bo.event_id = e.id AND bo.deleted_at IS NULL
     WHERE e.tenant_id = $1 AND e.shop_id = $2 AND e.deleted_at IS NULL
       AND ($3::text IS NULL OR upper(e.car_mark) = $3)
       AND ($4::text IS NULL OR e.car_number = $4)
       AND ($5::boolean OR (coalesce(e.is_smoke,false) = false
            AND coalesce(bo.is_smoke,false) = false))
     ORDER BY e.created_at DESC
     LIMIT 200`,
    [tenantId, shopId, carInitial, carNumber, showSmoke],
  );

  const { rows: estimates } = await q(
    `SELECT est.id AS estimate_id, est.event_id, est.current_revision,
            st.code AS status_code, e.car_mark, e.car_number,
            e.yard_arrived_at, est.created_at,
            (SELECT total FROM repair.estimate_revisions er
             WHERE er.estimate_id = est.id
             ORDER BY er.rev_no DESC LIMIT 1) AS total
     FROM repair.estimates est
     JOIN repair.statuses st ON st.id = est.status_id
     JOIN repair.events e ON e.id = est.event_id
     WHERE est.tenant_id = $1 AND e.shop_id = $2 AND est.deleted_at IS NULL
       AND e.deleted_at IS NULL
       AND ($3::text IS NULL OR upper(e.car_mark) = $3)
       AND ($4::text IS NULL OR e.car_number = $4)
       AND ($5::boolean OR coalesce(e.is_smoke,false) = false)
     ORDER BY est.created_at DESC
     LIMIT 200`,
    [tenantId, shopId, carInitial, carNumber, showSmoke],
  );

  const byStatus: Record<string, number> = {};
  for (const b of [
    "Draft",
    "Submitted",
    "Rejected",
    "Adjustment for Approval",
    "Approved",
    "Completed",
  ]) {
    byStatus[b] = 0;
  }
  const estimateRows = estimates.map((r) => {
    const label = mapStatusLabel(String(r.status_code));
    if (label in byStatus) byStatus[label] += 1;
    return {
      ...r,
      statusLabel: label,
      // Never expose lessee
    };
  });
  const estByEvent = new Map<string, { status_code: string; estimate_id: string }>();
  for (const e of estimates) {
    const eid = String(e.event_id);
    if (!estByEvent.has(eid)) {
      estByEvent.set(eid, {
        status_code: String(e.status_code),
        estimate_id: String(e.estimate_id),
      });
    }
  }

  const kpisEarly = await shopKpis({ shopId, tenantId: ctx.tenantId });

  const { formatClosedReasonLine, detectClosedInconsistency } = await import(
    "./shop-clarity"
  );
  const allEventIds = bos.map((bo) => String(bo.event_id));
  const invByEvent = new Map<
    string,
    {
      invoice_no: string | null;
      created_at: string | null;
      completed: string | null;
      workflow_status: string | null;
      match_status: string | null;
    }
  >();
  if (allEventIds.length) {
    const { rows: invRows } = await q(
      `SELECT DISTINCT ON (i.event_id)
          i.event_id, i.invoice_no, i.created_at::text AS created_at,
          i.workflow_status, i.match_status,
          bo.completed_date::text AS completed
       FROM repair.invoices i
       LEFT JOIN repair.bad_orders bo
         ON bo.event_id = i.event_id AND bo.deleted_at IS NULL
       WHERE i.event_id = ANY($1::uuid[]) AND i.deleted_at IS NULL
       ORDER BY i.event_id, i.created_at DESC`,
      [allEventIds],
    ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
    for (const r of invRows) {
      invByEvent.set(String(r.event_id), {
        invoice_no: r.invoice_no ? String(r.invoice_no) : null,
        created_at: r.created_at ? String(r.created_at).slice(0, 10) : null,
        completed: r.completed ? String(r.completed).slice(0, 10) : null,
        workflow_status: r.workflow_status ? String(r.workflow_status) : null,
        match_status: r.match_status ? String(r.match_status) : null,
      });
    }
    const { rows: boDone } = await q(
      `SELECT event_id, completed_date::text AS completed, closed_reason,
              missed_pod_reason_code
       FROM repair.bad_orders
       WHERE event_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [allEventIds],
    ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
    for (const r of boDone) {
      const id = String(r.event_id);
      const cur = invByEvent.get(id) ?? {
        invoice_no: null,
        created_at: null,
        completed: null,
        workflow_status: null,
        match_status: null,
      };
      if (!cur.completed && r.completed) {
        cur.completed = String(r.completed).slice(0, 10);
      }
      invByEvent.set(id, cur);
    }
  }

  // Missed POD: today > POD and not released
  const today = new Date().toISOString().slice(0, 10);
  const missedPodEvents = new Set<string>();
  if (allEventIds.length) {
    const { rows: podRows } = await q(
      `SELECT DISTINCT ON (p.event_id) p.event_id, p.date_value::text AS pod
       FROM repair.pod_dates p
       WHERE p.event_id = ANY($1::uuid[]) AND p.kind = 'POD'
       ORDER BY p.event_id, p.entered_at DESC`,
      [allEventIds],
    ).catch(() => ({ rows: [] as Array<{ event_id: string; pod: string }> }));
    for (const p of podRows) {
      const pod = String(p.pod).slice(0, 10);
      if (pod && pod < today) missedPodEvents.add(String(p.event_id));
    }
  }

  const tileCounts = emptyTileCounts();
  const badOrdersAll = bos.map((bo) => {
    const eid = String(bo.event_id);
    const isClosed =
      Boolean(bo.closed_at) || String(bo.lifecycle_status ?? "") === "CLOSED";
    const meta = invByEvent.get(eid);
    const est = estByEvent.get(eid);
    const completed =
      (bo.completed_date ? String(bo.completed_date).slice(0, 10) : null) ||
      meta?.completed ||
      null;
    const invoiceAccepted =
      meta?.workflow_status === "ACCEPTED" || meta?.match_status === "APPROVED";
    const missedPodRequired =
      missedPodEvents.has(eid) &&
      !bo.missed_pod_reason_code &&
      !isClosed;
    const tile = classifyBoTile({
      eventStatus: bo.event_status ? String(bo.event_status) : null,
      lifecycleStatus: bo.lifecycle_status ? String(bo.lifecycle_status) : null,
      acknowledgedAt: bo.acknowledged_at ? String(bo.acknowledged_at) : null,
      yardArrivedAt: bo.yard_arrived_at ? String(bo.yard_arrived_at) : null,
      estimateStatus: est?.status_code ?? null,
      hasEstimate: Boolean(est),
      missedPodRequired,
      missedPodReasonCode: bo.missed_pod_reason_code
        ? String(bo.missed_pod_reason_code)
        : null,
      completed,
      invoiceWorkflow: meta?.workflow_status ?? null,
      hasInvoice: Boolean(meta?.invoice_no),
      closedAt: bo.closed_at ? String(bo.closed_at) : null,
      isClosed,
    });
    tileCounts[tile] += 1;

    if (!isClosed) {
      return {
        ...bo,
        statusTile: tile,
        closedReasonLine: null as string | null,
        inconsistentClosed: false,
        inconsistentClosedReasons: [] as string[],
      };
    }
    const cancelled = /cancell?ed/i.test(String(bo.closed_reason ?? ""));
    const closedReasonLine =
      (bo.closed_reason && String(bo.closed_reason).startsWith("Closed:")
        ? String(bo.closed_reason)
        : null) ||
      formatClosedReasonLine({
        completed: meta?.completed ?? completed,
        invoiceNo: meta?.invoice_no ?? null,
        invoicedAt: meta?.created_at ?? null,
        closedReason: bo.closed_reason ? String(bo.closed_reason) : null,
        cancelled,
      });
    const inconsistency = detectClosedInconsistency({
      isClosed: true,
      completed: meta?.completed ?? completed,
      hasInvoice: Boolean(meta?.invoice_no),
      invoiceAccepted: meta?.invoice_no ? invoiceAccepted : undefined,
      openBlockingFlags: 0,
      cancelled,
    });
    return {
      ...bo,
      lifecycle_status: "CLOSED",
      statusTile: tile,
      closedReasonLine,
      inconsistentClosed: inconsistency.inconsistent,
      inconsistentClosedReasons: inconsistency.reasons,
    };
  });

  const tileFilter = (opts.tile || opts.status || "").trim();
  const isKnownTile = (SHOP_STATUS_TILES as readonly string[]).includes(
    tileFilter,
  );
  let badOrders = badOrdersAll;
  let filteredEstimates = estimateRows;
  if (tileFilter && isKnownTile) {
    badOrders = badOrdersAll.filter((b) => b.statusTile === tileFilter);
    const keep = new Set(badOrders.map((b) => String(b.event_id)));
    filteredEstimates = estimateRows.filter((e) => keep.has(String(e.event_id)));
  } else if (opts.status) {
    const want = opts.status.toLowerCase();
    filteredEstimates = estimateRows.filter(
      (e) =>
        String(e.statusLabel).toLowerCase() === want ||
        String(e.status_code).toLowerCase() === want,
    );
  }

  return {
    ok: true as const,
    shop: {
      id: shopId,
      shopMark: ctx.shop.shop_mark ?? ctx.shop.reporting_mark,
      name: ctx.shop.name,
    },
    readOnly: ctx.readOnly,
    viewingAsShopMark: ctx.viewingAsShopMark,
    byStatus,
    byTile: tileCounts,
    statusTiles: [...SHOP_STATUS_TILES],
    activeTile: isKnownTile ? (tileFilter as ShopStatusTile) : null,
    kpis: kpisEarly,
    badOrders,
    estimates: filteredEstimates,
  };
}

/** Issue or reuse the one signed shop link for a BO (shop-authenticated). */
export async function shopIssueBoLink(opts: ShopActor & {
  eventId: string;
  forceNew?: boolean;
}) {
  const ctx = await resolveShopContext(opts);
  if (!ctx.ok) return ctx;
  if (ctx.readOnly) {
    return { ok: false as const, status: 403, error: "Read-only shop view" };
  }
  const shopId = String(ctx.shop.id);
  const owned = await assertEventOwnedByShop(
    opts.eventId,
    shopId,
    ctx.tenantId,
  );
  if (!owned.ok) return owned;
  const mark = String(ctx.shop.shop_mark ?? ctx.shop.reporting_mark ?? "");
  return ensureShopBoLink({
    eventId: opts.eventId,
    shopMark: mark,
    actor: opts.actor,
    tenantId: ctx.tenantId,
    forceNew: opts.forceNew,
  });
}

/** BO / event detail for shop — hides lessee; includes JIC clock for wrecks. */
export async function shopBoDetail(opts: ShopActor & { eventId: string }) {
  const ctx = await resolveShopContext(opts);
  if (!ctx.ok) return ctx;
  const shopId = String(ctx.shop.id);
  const owned = await assertEventOwnedByShop(opts.eventId, shopId, ctx.tenantId);
  if (!owned.ok) return owned;

  const { rows: boRows } = await q(
    `SELECT id, lifecycle_status, shopping_reason, bo_date, bo_city, bo_state,
            comments AS owner_instructions, arrival_date, wreck_estimate, source
     FROM repair.bad_orders
     WHERE event_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [opts.eventId],
  );

  let jic: Record<string, unknown> | null = null;
  if (owned.event.is_wreck) {
    const { rows: wreck } = await q(
      `SELECT id, jic_type, jic_prepared_at, jic_sent_to_owner_at,
              jic_forwarded_to_rr_at, jic_endorsed_at, jic_auto_endorsed,
              jic_endorsing_road, shop_arrival_date, status
       FROM repair.wreck_events
       WHERE event_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [opts.eventId],
    );
    if (wreck[0]) {
      jic = {
        wreckEventId: wreck[0].id,
        type: wreck[0].jic_type,
        preparedAt: wreck[0].jic_prepared_at,
        sentToOwnerAt: wreck[0].jic_sent_to_owner_at,
        forwardedToRrAt: wreck[0].jic_forwarded_to_rr_at,
        endorsedAt: wreck[0].jic_endorsed_at,
        autoEndorsed: wreck[0].jic_auto_endorsed,
        endorsingRoad: wreck[0].jic_endorsing_road,
        shopArrivalDate: wreck[0].shop_arrival_date,
        status: wreck[0].status,
      };
    }
  }

  const { rows: estimates } = await q(
    `SELECT est.id, est.current_revision, st.code AS status_code
     FROM repair.estimates est
     JOIN repair.statuses st ON st.id = est.status_id
     WHERE est.event_id = $1 AND est.deleted_at IS NULL
     ORDER BY est.created_at ASC`,
    [opts.eventId],
  );

  // §E viewer shop mode (view+add, never void)
  const docs = await listViewerDocuments({
    eventId: opts.eventId,
    actorRole: "shop",
    actor: opts.actor,
    tenantId: ctx.tenantId,
  });
  const docOk = docs && "ok" in docs && docs.ok === true ? docs : null;

  const clarity = await getBoLifecycleBundle({
    eventId: opts.eventId,
    tenantId: ctx.tenantId,
  });

  return {
    ok: true as const,
    event: {
      id: owned.event.id,
      carMark: owned.event.car_mark,
      carNumber: owned.event.car_number,
      rule: owned.event.rule,
      isWreck: owned.event.is_wreck,
      yardArrivedAt: owned.event.yard_arrived_at,
      statusCode: owned.event.status_code,
      // intentionally omit lessee / assignment / DV
    },
    badOrder: boRows[0]
      ? {
          id: boRows[0].id,
          lifecycleStatus: boRows[0].lifecycle_status,
          shoppingReason: boRows[0].shopping_reason,
          boDate: boRows[0].bo_date,
          location: [boRows[0].bo_city, boRows[0].bo_state]
            .filter(Boolean)
            .join(", "),
          ownerInstructions: boRows[0].owner_instructions,
          arrivalDate: boRows[0].arrival_date,
        }
      : null,
    jicClock: jic,
    estimates: estimates.map((e) => ({
      id: e.id,
      revision: e.current_revision,
      statusCode: e.status_code,
      statusLabel: mapStatusLabel(String(e.status_code)),
    })),
    documents: {
      permissions: ctx.readOnly
        ? { role: "owner", canAdd: false, canVoid: false }
        : docOk?.permissions ?? {
            role: "shop",
            canAdd: true,
            canVoid: false,
          },
      count: docOk?.documents?.length ?? 0,
    },
    /** §G r2 clarity: dates, POD history, timeline, flags */
    lifecycle: clarity,
    readOnly: ctx.readOnly,
    viewingAsShopMark: ctx.viewingAsShopMark,
  };
}

async function shopNotifyEmails(
  shop: Record<string, unknown>,
  tenantId: string,
): Promise<string[]> {
  const list: string[] = [];
  const portal = shop.portal_notify_emails;
  if (Array.isArray(portal)) {
    for (const e of portal) {
      const t = String(e).trim().toLowerCase();
      if (t.includes("@")) list.push(t);
    }
  }
  const { rows: contacts } = await q(
    `SELECT email FROM repair.contacts
     WHERE tenant_id = $1 AND party_type = 'shop' AND active AND deleted_at IS NULL
       AND email IS NOT NULL
       AND (party_ref = $2 OR party_ref = $3 OR party_ref = $4)`,
    [
      tenantId,
      String(shop.shop_mark ?? ""),
      String(shop.reporting_mark ?? ""),
      String(shop.id),
    ],
  );
  for (const r of contacts) {
    const t = String(r.email).trim().toLowerCase();
    if (t.includes("@") && !list.includes(t)) list.push(t);
  }
  const inbox = String(shop.default_inbox ?? "").trim().toLowerCase();
  if (inbox.includes("@") && !list.includes(inbox)) list.push(inbox);
  return list;
}

/** Write local email_outbox + notifications_log (never real send). */
export async function enqueueShopOutbox(opts: {
  tenantId: string;
  eventId: string;
  estimateId?: string;
  revisionId?: string | null;
  type: string;
  subject: string;
  bodyText: string;
  recipients: string[];
  actor: string;
  reasons?: string[];
}) {
  const recipients = opts.recipients.length
    ? opts.recipients
    : ["shop-portal@local.invalid"];
  const body =
    opts.reasons && opts.reasons.length
      ? `${opts.bodyText}\n\nReasons:\n- ${opts.reasons.join("\n- ")}`
      : opts.bodyText;

  const { rows } = await q(
    `INSERT INTO repair.email_outbox
       (tenant_id, event_id, estimate_id, revision_id, notification_type,
        recipients, subject, body_text, status, local_mode, created_by, note)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'logged',true,$9,$10)
     RETURNING id`,
    [
      opts.tenantId,
      opts.eventId,
      opts.estimateId ?? null,
      opts.revisionId ?? null,
      opts.type,
      JSON.stringify(recipients),
      opts.subject,
      body,
      opts.actor,
      "§G shop portal local outbox",
    ],
  );

  await notify({
    tenantId: opts.tenantId,
    eventId: opts.eventId,
    type: opts.type,
    subject: opts.subject,
    bodyText: body,
    extraTo: recipients,
    actor: opts.actor,
  }).catch(() => undefined);

  return { outboxId: String(rows[0].id), recipients };
}

/**
 * Validate + preview 500-byte (or hand-entry lines) without loading.
 */
export async function shopValidatePreview(opts: ShopActor & {
  bytes?: Buffer;
  filename?: string;
  lines?: EstimateLineInput[];
  mode?: "ESTIMATE" | "FINAL_INVOICE";
}): Promise<
  | {
      ok: true;
      validation: ValidateResult;
      preview: {
        header: Record<string, unknown>;
        lines: Array<Record<string, unknown>>;
        laborCents: number;
        materialCents: number;
        totalCents: number;
      };
    }
  | { ok: false; status: number; error: string; validation?: ValidateResult }
> {
  const write = assertShopWriteRole(opts.role);
  if (!write.ok) return write;
  const ctx = await resolveShopContext(opts);
  if (!ctx.ok) return ctx;

  const validator = getRailincValidator();
  let result: ValidateResult;

  if (opts.bytes) {
    result = await validator.validate({
      bytes: opts.bytes,
      mode: opts.mode ?? "ESTIMATE",
      tenantId: ctx.tenantId,
    });
  } else if (opts.lines && opts.lines.length) {
    // Hand-entry → synthesize minimal Format-1-like findings via stub on empty parse path
    // Build fake parsed lines for rule checks that need fields
    const synthetic: ValidateResult = {
      ok: true,
      outcome: "ACCEPTED",
      findings: [],
      hardRejects: [],
      flags: [],
      laborCents: 0,
      materialCents: 0,
      totalCents: 0,
      pricedQuarter: null,
      validator: validator.name,
      parsedLines: [],
    };
    // Run a light pass: require car via shop BO context later; here check line basics
    for (const [i, line] of opts.lines.entries()) {
      const labor = line.laborCents ?? Math.round((line.labor ?? 0) * 100);
      const material = line.materialCents ?? Math.round((line.material ?? 0) * 100);
      synthetic.laborCents += labor;
      synthetic.materialCents += material;
      if (!line.aarJobCode) {
        const f: ValidationFinding = {
          code: "MISSING_CRITICAL_HEADER",
          message: `Line ${i + 1}: missing applied job code`,
          severity: "HARD_REJECT",
          lineNo: i + 1,
        };
        synthetic.findings.push(f);
        synthetic.hardRejects.push(f);
      }
      if (!line.aarComponentId) {
        const f: ValidationFinding = {
          code: "MISSING_CID",
          message: `Line ${i + 1}: missing CID`,
          severity: "FLAG",
          lineNo: i + 1,
        };
        synthetic.findings.push(f);
        synthetic.flags.push(f);
      }
    }
    synthetic.totalCents = synthetic.laborCents + synthetic.materialCents;
    synthetic.ok = synthetic.hardRejects.length === 0;
    synthetic.outcome =
      synthetic.hardRejects.length > 0
        ? "HARD_REJECT"
        : synthetic.flags.length > 0
          ? "ACCEPTED_WITH_FLAGS"
          : "ACCEPTED";
    result = synthetic;
  } else {
    return { ok: false, status: 400, error: "Upload bytes or hand-entry lines required" };
  }

  const detail = result.parsedLines.filter((l) => l.recordFormat === "1");
  const header =
    detail[0]
      ? {
          billingParty: detail[0].fields.billing_party,
          billedParty: detail[0].fields.billed_party,
          accountDate: detail[0].fields.account_date_yymm,
          carInitial: detail[0].fields.car_initial,
          carNumber: detail[0].fields.car_number,
          shopMark: detail[0].fields.repairing_party,
          invoiceNumber: detail[0].fields.invoice_number,
        }
      : {};

  const previewLines =
    detail.length > 0
      ? detail.map((l) => ({
          lineNo: l.lineNo,
          job: l.appliedJobCode,
          qualifier: l.appliedQualifier,
          whyMade: l.whyMade,
          resp: l.respCode,
          laborCents: l.laborCents,
          materialCents: signedMaterialSafe(l),
          cid: l.aarComponentId,
        }))
      : (opts.lines ?? []).map((l, i) => ({
          lineNo: l.lineNo ?? i + 1,
          job: l.aarJobCode,
          qualifier: l.qualifier,
          whyMade: l.whyMade,
          resp: l.respCode,
          laborCents: l.laborCents ?? Math.round((l.labor ?? 0) * 100),
          materialCents: l.materialCents ?? Math.round((l.material ?? 0) * 100),
          cid: l.aarComponentId,
        }));

  return {
    ok: true,
    validation: result,
    preview: {
      header,
      lines: previewLines,
      laborCents: result.laborCents,
      materialCents: result.materialCents,
      totalCents: result.totalCents,
    },
  };
}

function signedMaterialSafe(l: {
  materialCents: number | null;
  materialSign: string | null;
}): number {
  const n = l.materialCents ?? 0;
  return String(l.materialSign ?? "D").toUpperCase() === "C" ? -n : n;
}

/**
 * Submit estimate from shop portal (upload or hand entry).
 * Hard reject → file not loaded. Flags → accepted with findings stored.
 */
export async function shopSubmitEstimate(opts: ShopActor & {
  eventId: string;
  bytes?: Buffer;
  filename?: string;
  lines?: EstimateLineInput[];
  comment?: string;
  forceAcceptFlags?: boolean;
}) {
  const write = assertShopWriteRole(opts.role);
  if (!write.ok) return write;
  const ctx = await resolveShopContext(opts);
  if (!ctx.ok) return ctx;
  const shopId = String(ctx.shop.id);
  const owned = await assertEventOwnedByShop(opts.eventId, shopId, ctx.tenantId);
  if (!owned.ok) return owned;

  const preview = await shopValidatePreview({
    ...opts,
    bytes: opts.bytes,
    lines: opts.lines,
    filename: opts.filename,
  });
  if (!preview.ok) return preview;

  if (!preview.validation.ok) {
    // Persist reject run against a placeholder? Use event-scoped audit only —
    // no estimate yet. Store via load path which also blocks.
    await writeAudit({
      tenantId: ctx.tenantId,
      entity: "event",
      entityId: opts.eventId,
      action: "SHOP_ESTIMATE_HARD_REJECT",
      after: {
        hardRejects: preview.validation.hardRejects,
        filename: opts.filename,
      },
      actor: opts.actor,
      via: "shop_portal",
    });
    return {
      ok: false as const,
      status: 422,
      error: "Hard reject — file not loaded",
      validation: preview.validation,
      preview: preview.preview,
    };
  }

  let loadResult: Awaited<ReturnType<typeof loadEstimateAar>> | null = null;
  let estimateId: string | null = null;
  let revisionId: string | null = null;

  if (opts.bytes) {
    // Prefer estimate-load for first intake; fall back to uploadEstimate (UI/reviewer
    // actor) when QUEUED→AWAITING is blocked for shop_link (post-withdraw resubmit).
    let loadErr: string | null = null;
    try {
      loadResult = await loadEstimateAar({
        bytes: opts.bytes,
        filename: opts.filename ?? "shop-upload.txt",
        source: "UI",
        eventId: opts.eventId,
        actor: opts.actor,
        forceAcceptWarnings: opts.forceAcceptFlags !== false,
        comment: opts.comment,
      });
      if (!loadResult.ok) {
        loadErr = loadResult.error ?? "Load failed";
      }
    } catch (err) {
      loadErr = err instanceof Error ? err.message : "Load failed";
      loadResult = null;
    }

    if (loadResult?.ok) {
      estimateId = String(
        (loadResult.applied?.[0] as { estimateId?: string } | undefined)?.estimateId ??
          "",
      );
      revisionId = String(
        (loadResult.applied?.[0] as { revisionId?: string } | undefined)?.revisionId ??
          "",
      );
    } else {
      const { uploadEstimate } = await import("./estimates");
      const parsed = parseAarFile(opts.bytes);
      const lines = parsed.lines
        .filter((l) => l.recordFormat === "1")
        .map((l) => ({
          lineNo: Number(l.fields.line_number ?? l.lineNo) || l.lineNo,
          aarJobCode: l.appliedJobCode ?? undefined,
          qualifier: l.appliedQualifier ?? undefined,
          whyMade: l.whyMade ?? undefined,
          conditionCode: String(l.fields.condition_code ?? "").trim() || undefined,
          respCode: l.respCode ?? undefined,
          laborCents: l.laborCents ?? 0,
          materialCents: signedMaterialSafe(l),
          aarComponentId: l.aarComponentId,
          ddctIncidentId: l.ddctIncidentId,
          rawLine: l.rawLine,
        }));
      const up = await uploadEstimate({
        eventId: opts.eventId,
        tenantId: ctx.tenantId,
        actorName: opts.actor,
        actorEmail: opts.actor,
        via: "UI",
        comment: opts.comment,
        lines,
        file: {
          filename: opts.filename ?? "shop-upload.txt",
          mime: "text/plain",
          bytes: opts.bytes,
        },
      });
      if (!up.ok) {
        return {
          ok: false as const,
          status: (loadResult && "status" in loadResult ? loadResult.status : 422) ??
            up.status ??
            422,
          error: loadErr ?? up.error ?? "Load failed",
          validation: preview.validation,
          load: loadResult,
        };
      }
      estimateId = String(up.estimate.id);
      revisionId = String(up.revision.id);
      loadResult = null;
    }
  } else if (opts.lines?.length) {
    // Hand entry: create/append revision via internal helper
    const hand = await handEntryRevision({
      tenantId: ctx.tenantId,
      eventId: opts.eventId,
      lines: opts.lines,
      actor: opts.actor,
      comment: opts.comment,
    });
    if (!hand.ok) return hand;
    estimateId = hand.estimateId;
    revisionId = hand.revisionId;
  } else {
    return { ok: false, status: 400, error: "Upload or hand-entry required" };
  }

  if (!estimateId) {
    return {
      ok: false as const,
      status: 500,
      error: "Estimate id missing after load",
      validation: preview.validation,
    };
  }

  const { runId } = await persistValidationRun({
    tenantId: ctx.tenantId,
    estimateId,
    revisionId,
    loadRunId:
      loadResult && "loadRunId" in loadResult
        ? String((loadResult as { loadRunId?: string }).loadRunId ?? "") || null
        : null,
    result: preview.validation,
    actor: opts.actor,
  });

  // Move Draft/Queued → Submitted (AWAITING_APPROVAL) when yard arrival set.
  // uploadEstimate may already have landed on AWAITING_APPROVAL for revisions.
  const { rows: curSt } = await q(
    `SELECT s.code FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id WHERE e.id = $1`,
    [estimateId],
  );
  let sub: { ok: boolean; error?: string } = { ok: true };
  if (curSt[0]?.code === "QUEUED") {
    sub = await submitForApproval({
      estimateId,
      actor: opts.actor,
      tenantId: ctx.tenantId,
      comment: opts.comment,
    });
  } else if (
    curSt[0]?.code === "AWAITING_APPROVAL" ||
    curSt[0]?.code === "ADJUSTMENT_FOR_APPROVAL"
  ) {
    sub = { ok: true };
  } else {
    sub = await submitForApproval({
      estimateId,
      actor: opts.actor,
      tenantId: ctx.tenantId,
      comment: opts.comment,
    });
  }

  const emails = await shopNotifyEmails(ctx.shop, ctx.tenantId);
  // Notify owners that estimate received
  await enqueueShopOutbox({
    tenantId: ctx.tenantId,
    eventId: opts.eventId,
    estimateId,
    revisionId,
    type: "ESTIMATE_RECEIVED",
    subject: `Estimate received — ${owned.event.car_mark} ${owned.event.car_number}`,
    bodyText: `Shop ${ctx.shop.shop_mark ?? ctx.shop.reporting_mark} submitted estimate ${estimateId} (rev run ${runId}).`,
    recipients: [], // rule resolves owner_users
    actor: opts.actor,
  });

  // Also ensure shop contact list is recorded for reject/approve later
  void emails;

  return {
    ok: true as const,
    estimateId,
    revisionId,
    validationRunId: runId,
    validation: preview.validation,
    preview: preview.preview,
    submitted: sub.ok,
    submitError: sub.ok ? null : sub.error,
    load: loadResult,
  };
}

async function handEntryRevision(opts: {
  tenantId: string;
  eventId: string;
  lines: EstimateLineInput[];
  actor: string;
  comment?: string;
}): Promise<
  | { ok: true; estimateId: string; revisionId: string }
  | { ok: false; status: number; error: string }
> {
  const { ensureEstimateForEvent } = await import("./shop-portal-hand");
  return ensureEstimateForEvent(opts);
}

/** Withdraw submitted estimate until owner review starts (open-Q default a). */
export async function shopWithdrawEstimate(opts: ShopActor & {
  estimateId: string;
  reason?: string;
}) {
  const write = assertShopWriteRole(opts.role);
  if (!write.ok) return write;
  const ctx = await resolveShopContext(opts);
  if (!ctx.ok) return ctx;
  const owned = await assertEstimateOwnedByShop(
    opts.estimateId,
    String(ctx.shop.id),
    ctx.tenantId,
  );
  if (!owned.ok) return owned;

  const code = String(owned.estimate.status_code);
  if (code !== "AWAITING_APPROVAL") {
    return {
      ok: false as const,
      status: 409,
      error: `Withdraw only while Submitted (AWAITING_APPROVAL); found ${code}`,
    };
  }

  // Review started = owner audit action after submit (approve / request revision / header edit / resp update)
  const { rows: reviewActs } = await q(
    `SELECT 1 FROM repair.audit_events
     WHERE entity = 'estimate' AND entity_id = $1
       AND action IN (
         'Approve', 'Reject / Request revision', 'HEADER_EDIT',
         'UPDATE_RESPONSIBILITY', 'RESPONSIBILITY_UPDATE',
         'REQUEST_REVISION', 'APPROVE'
       )
     LIMIT 1`,
    [opts.estimateId],
  );
  if (reviewActs[0]) {
    return {
      ok: false as const,
      status: 409,
      error: "Owner review has started — withdraw not allowed",
    };
  }

  const queued = await getStatusByCode(ctx.tenantId, "ESTIMATE", "QUEUED");
  if (!queued) return { ok: false as const, status: 500, error: "QUEUED status missing" };

  await q(
    `UPDATE repair.estimates SET status_id = $1 WHERE id = $2`,
    [queued.id, opts.estimateId],
  );

  const revNo = Number(owned.estimate.current_revision ?? 0) + 1;
  await q(
    `INSERT INTO repair.estimate_revisions
       (tenant_id, estimate_id, rev_no, action, actor_name, actor_email,
        labor, material, total, new_status, old_status, comment, created_by)
     VALUES ($1,$2,$3,'SHOP_WITHDRAW',$4,$4,0,0,0,'QUEUED',$5,$6,$4)`,
    [
      ctx.tenantId,
      opts.estimateId,
      revNo,
      opts.actor,
      code,
      opts.reason ?? "Shop withdrew before owner review",
    ],
  );
  await q(`UPDATE repair.estimates SET current_revision = $1 WHERE id = $2`, [
    revNo,
    opts.estimateId,
  ]);

  await writeAudit({
    tenantId: ctx.tenantId,
    entity: "estimate",
    entityId: opts.estimateId,
    action: "SHOP_WITHDRAW",
    after: { reason: opts.reason ?? null, from: code, to: "QUEUED" },
    actor: opts.actor,
    via: "shop_portal",
  });

  return { ok: true as const, statusCode: "QUEUED" };
}

/** Resubmit after reject/adjustment → new revision + diff vs prior. */
export async function shopResubmitEstimate(opts: ShopActor & {
  estimateId: string;
  bytes: Buffer;
  filename: string;
  comment?: string;
}) {
  const write = assertShopWriteRole(opts.role);
  if (!write.ok) return write;
  const ctx = await resolveShopContext(opts);
  if (!ctx.ok) return ctx;
  const owned = await assertEstimateOwnedByShop(
    opts.estimateId,
    String(ctx.shop.id),
    ctx.tenantId,
  );
  if (!owned.ok) return owned;

  const code = String(owned.estimate.status_code);
  if (!["REVISION_REQUESTED", "ADJUSTMENT_FOR_APPROVAL", "QUEUED"].includes(code)) {
    return {
      ok: false as const,
      status: 409,
      error: `Resubmit allowed from Rejected/Adjustment/Draft; found ${code}`,
    };
  }

  const { rows: priorRevs } = await q(
    `SELECT id, rev_no FROM repair.estimate_revisions
     WHERE estimate_id = $1
     ORDER BY rev_no DESC LIMIT 1`,
    [opts.estimateId],
  );
  const priorRevId = priorRevs[0] ? String(priorRevs[0].id) : null;

  const submitted = await shopSubmitEstimate({
    ...opts,
    eventId: String(owned.estimate.event_id),
    bytes: opts.bytes,
    filename: opts.filename,
    comment: opts.comment,
  });
  if (!submitted.ok) return submitted;

  let diff = null;
  let commentDiff = null;
  if (priorRevId && submitted.revisionId) {
    diff = await compareRevisions({
      leftRevisionId: priorRevId,
      rightRevisionId: submitted.revisionId,
    });
    commentDiff = await commentedLinesDiff({
      estimateId: opts.estimateId,
      leftRevisionId: priorRevId,
      rightRevisionId: String(submitted.revisionId),
      tenantId: ctx.tenantId,
    });
  }

  return {
    ...submitted,
    priorRevisionId: priorRevId,
    diff,
    commentDiff,
    newRevision: submitted.revisionId,
  };
}

/** Shop BRC PDF (no DV/internal) + own data file. */
export async function shopDownloadBrc(opts: ShopActor & { estimateId: string }) {
  const ctx = await resolveShopContext(opts);
  if (!ctx.ok) return ctx;
  const owned = await assertEstimateOwnedByShop(
    opts.estimateId,
    String(ctx.shop.id),
    ctx.tenantId,
  );
  if (!owned.ok) return owned;

  const built = await buildBrcPdf({
    estimateId: opts.estimateId,
    audience: "shop",
    tenantId: ctx.tenantId,
  });
  if (!built.ok) return built;
  return { ok: true as const, bytes: built.bytes, doc: built.doc, amountMoney: built.amountMoney };
}

export async function shopDownloadDataFile(opts: ShopActor & { estimateId: string }) {
  const ctx = await resolveShopContext(opts);
  if (!ctx.ok) return ctx;
  const owned = await assertEstimateOwnedByShop(
    opts.estimateId,
    String(ctx.shop.id),
    ctx.tenantId,
  );
  if (!owned.ok) return owned;

  const exported = await exportEstimatesAar500({
    estimateIds: [opts.estimateId],
    tenantId: ctx.tenantId,
  });
  const file = exported.files[0];
  if (!file) return { ok: false as const, status: 404, error: "No data file" };
  return {
    ok: true as const,
    filename: file.filename,
    content: file.content,
    sha256: createHash("sha256").update(file.content, "latin1").digest("hex"),
  };
}

/** Estimate detail for shop (validation results + rev history). */
export async function shopEstimateDetail(opts: ShopActor & { estimateId: string }) {
  const ctx = await resolveShopContext(opts);
  if (!ctx.ok) return ctx;
  const owned = await assertEstimateOwnedByShop(
    opts.estimateId,
    String(ctx.shop.id),
    ctx.tenantId,
  );
  if (!owned.ok) return owned;

  const { rows: revs } = await q(
    `SELECT id, rev_no, action, action_at, actor_name, labor, material, total,
            new_status, old_status, comment
     FROM repair.estimate_revisions
     WHERE estimate_id = $1
     ORDER BY rev_no ASC`,
    [opts.estimateId],
  );

  const { rows: valRuns } = await q(
    `SELECT r.*, 
        (SELECT jsonb_agg(jsonb_build_object(
           'code', f.rule_code, 'severity', f.severity, 'message', f.message,
           'refLink', f.ref_link, 'lineNo', f.line_no, 'clearedAt', f.cleared_at
         ) ORDER BY f.created_at)
         FROM repair.estimate_validation_findings f WHERE f.run_id = r.id) AS findings
     FROM repair.estimate_validation_runs r
     WHERE r.estimate_id = $1
     ORDER BY r.created_at DESC
     LIMIT 5`,
    [opts.estimateId],
  );

  const decisionComments = await listDecisionComments({
    estimateId: opts.estimateId,
    tenantId: ctx.tenantId,
  });
  const statusCode = String(owned.estimate.status_code);
  const showDecisionComments =
    statusCode === "REVISION_REQUESTED" ||
    statusCode === "ADJUSTMENT_FOR_APPROVAL";

  return {
    ok: true as const,
    estimate: {
      id: owned.estimate.id,
      statusCode: owned.estimate.status_code,
      statusLabel: mapStatusLabel(String(owned.estimate.status_code)),
      currentRevision: owned.estimate.current_revision,
      carMark: owned.event.car_mark,
      carNumber: owned.event.car_number,
      eventId: owned.event.id,
    },
    revisions: revs,
    validationRuns: valRuns,
    canWithdraw: !ctx.readOnly && statusCode === "AWAITING_APPROVAL",
    decisionComments: showDecisionComments
      ? decisionComments
      : { estimateLevel: [], lineLevel: [], all: [] },
    showDecisionComments,
    readOnly: ctx.readOnly,
    viewingAsShopMark: ctx.viewingAsShopMark,
  };
}

/** Owner-side helpers: notify shop on reject / adjustment / approve via outbox. */
export async function notifyShopEstimateDecision(opts: {
  estimateId: string;
  type:
    | "ESTIMATE_REJECTED"
    | "ESTIMATE_ADJUSTMENT_REQUESTED"
    | "ESTIMATE_APPROVED";
  reasons?: string[];
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT est.id, est.event_id, e.shop_id, e.car_mark, e.car_number,
            sh.shop_mark, sh.reporting_mark, sh.default_inbox, sh.portal_notify_emails
     FROM repair.estimates est
     JOIN repair.events e ON e.id = est.event_id
     LEFT JOIN repair.shops sh ON sh.id = e.shop_id
     WHERE est.id = $1 AND est.tenant_id = $2`,
    [opts.estimateId, tenantId],
  );
  const row = rows[0];
  if (!row?.shop_id) return { ok: false as const, error: "No shop on estimate" };

  const emails = await shopNotifyEmails(row, tenantId);
  const label = `${row.car_mark} ${row.car_number}`;
  const subjects: Record<string, string> = {
    ESTIMATE_REJECTED: `Estimate rejected — ${label}`,
    ESTIMATE_ADJUSTMENT_REQUESTED: `Adjustment requested — ${label}`,
    ESTIMATE_APPROVED: `Estimate approved — ${label}`,
  };

  let reasons = opts.reasons ?? [];
  if (
    opts.type === "ESTIMATE_REJECTED" ||
    opts.type === "ESTIMATE_ADJUSTMENT_REQUESTED"
  ) {
    const comments = await listDecisionComments({
      estimateId: opts.estimateId,
      tenantId,
    });
    const fromComments = formatCommentsForEmail(comments);
    if (fromComments.length && fromComments[0] !== "no change requested") {
      reasons = [...reasons, ...fromComments];
    } else if (!reasons.length) {
      reasons = fromComments;
    }
  }

  return enqueueShopOutbox({
    tenantId,
    eventId: String(row.event_id),
    estimateId: opts.estimateId,
    type: opts.type,
    subject: subjects[opts.type],
    bodyText: subjects[opts.type],
    recipients: emails,
    actor: opts.actor,
    reasons,
  });
}

// re-export buckets for UI
export { ESTIMATE_STATUS_BUCKETS, mapStatusLabel };
