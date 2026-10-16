/**
 * §G r2 — Shop clarity: BO lifecycle dates, status timeline, flags panel,
 * KPIs, missed POD reasons, owner decision comments for shop view.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { listComments, addComment } from "./comments";
import { enterPodErd, listPodDates, latestPodErd } from "./pod";
import { estimateHasOpenWreckFlags } from "./wreck-validate";
import { revokeShopLinksOnClose } from "./shop-workflow";
import {
  type BoStatus,
  buildCompactTimeline,
  formatBoStatusLine,
  formatFlagSummaryLine,
  listBoStatusHistory,
  setBoStatus,
  summarizeFlags,
  BO_STATUS_LABEL,
} from "./bo-status";

export type TimelineStep = {
  code: string;
  label: string;
  active: boolean;
  current: boolean;
  meaning: string;
  whoActsNext: string;
  at?: string | null;
};

export const STATUS_TIMELINE: Array<{
  code: string;
  label: string;
  meaning: string;
  whoActsNext: string;
}> = [
  {
    code: "OPEN",
    label: "Open",
    meaning: "Bad order assigned; awaiting shop confirmation.",
    whoActsNext: "Shop — confirm (accept) or decline",
  },
  {
    code: "CONFIRMED",
    label: "Confirmed",
    meaning: "Shop accepted the assignment; car not yet on hand.",
    whoActsNext: "Shop — mark on hand with arrival date/time",
  },
  {
    code: "ON_HAND",
    label: "On Hand",
    meaning: "Car arrived at shop; JIC/POD clocks may start.",
    whoActsNext: "Shop — prepare and submit estimate",
  },
  {
    code: "ESTIMATE_PENDING",
    label: "Estimate Pending",
    meaning: "Shop is preparing or has a draft estimate.",
    whoActsNext: "Shop — submit estimate",
  },
  {
    code: "UNDER_OWNER_REVIEW",
    label: "Under Owner Review",
    meaning: "Estimate submitted; owner/managing partner is reviewing.",
    whoActsNext: "Owner — approve, reject, or request adjustment",
  },
  {
    code: "REJECTED",
    label: "Rejected / Adjustment Requested",
    meaning: "Owner rejected or requested changes; see line comments.",
    whoActsNext: "Shop — address comments and resubmit",
  },
  {
    code: "APPROVED",
    label: "Approved",
    meaning: "Estimate approved; repair may start; watch open flags.",
    whoActsNext: "Shop — enter POD, start repair",
  },
  {
    code: "IN_REPAIR",
    label: "In Repair",
    meaning: "Car is in repair at the shop.",
    whoActsNext: "Shop — complete work, set completed/outbound",
  },
  {
    code: "COMPLETED",
    label: "Completed",
    meaning: "Repair completed; awaiting accepted invoice / close.",
    whoActsNext: "Shop — upload invoice; owner — accept and close",
  },
  {
    code: "CLOSED",
    label: "Closed (Invoiced)",
    meaning: "Completed with an accepted invoice. Closed only after both.",
    whoActsNext: "None — record closed",
  },
];

export function mapBoTimelineCode(opts: {
  eventStatus?: string;
  estimateStatus?: string | null;
  lifecycleStatus?: string | null;
  closedAt?: string | null;
  hasInvoice?: boolean;
  invoiceAccepted?: boolean;
  completed?: boolean;
}): string {
  if (
    opts.closedAt ||
    (opts.completed && (opts.invoiceAccepted || opts.hasInvoice))
  ) {
    // Prefer CLOSED only when invoice accepted or already closed_at set
    if (opts.closedAt || opts.invoiceAccepted) return "CLOSED";
  }
  if (opts.completed || opts.eventStatus === "COMPLETE") return "COMPLETED";
  if (opts.eventStatus === "IN_REPAIR") return "IN_REPAIR";
  const est = String(opts.estimateStatus ?? "");
  if (est === "APPROVED") return "APPROVED";
  if (est === "REVISION_REQUESTED" || est === "ADJUSTMENT_FOR_APPROVAL") {
    return "REJECTED";
  }
  if (est === "AWAITING_APPROVAL") return "UNDER_OWNER_REVIEW";
  if (est === "DRAFT" || est === "QUEUED") return "ESTIMATE_PENDING";
  if (opts.eventStatus === "ON_HAND") return "ON_HAND";
  if (
    opts.eventStatus === "ACCEPTED" ||
    opts.lifecycleStatus === "ACCEPTED_PENDING"
  ) {
    return "CONFIRMED";
  }
  if (opts.lifecycleStatus === "QUEUED" || !est) return "OPEN";
  return "OPEN";
}

export function buildStatusTimeline(opts: {
  currentCode: string;
  closedReason?: string | null;
  closedAt?: string | null;
  dates?: Record<string, string | null | undefined>;
}): TimelineStep[] {
  const order = STATUS_TIMELINE.map((s) => s.code);
  const curIdx = Math.max(0, order.indexOf(opts.currentCode));
  return STATUS_TIMELINE.map((s, i) => {
    const step: TimelineStep = {
      code: s.code,
      label: s.label,
      active: i <= curIdx,
      current: i === curIdx,
      meaning: s.meaning,
      whoActsNext: s.whoActsNext,
      at: null,
    };
    if (s.code === "CLOSED" && opts.closedAt) {
      step.at = opts.closedAt;
      if (opts.closedReason) {
        step.meaning = `${s.meaning} ${opts.closedReason}`;
      }
    }
    return step;
  });
}

export async function listMissedPodReasonCodes(tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT code, label, description, active, sort_order
     FROM repair.missed_pod_reason_codes
     WHERE tenant_id = $1 AND deleted_at IS NULL
     ORDER BY sort_order ASC, code ASC`,
    [tenantId],
  );
  return rows;
}

export type BoLifecycleDates = {
  arrival: string | null;
  inspected: string | null;
  estimateSubmitted: string | null;
  ownerApproval: string | null;
  repairStart: string | null;
  pod: string | null;
  completed: string | null;
  released: string | null;
  missedPodReasonCode: string | null;
  missedPodReasonNote: string | null;
  missedPodRequired: boolean;
};

function ymd(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function getBoLifecycleBundle(opts: {
  eventId: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows: boRows } = await q(
    `SELECT * FROM repair.bad_orders
     WHERE event_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [opts.eventId],
  );
  const bo = boRows[0] ?? null;

  const { rows: evRows } = await q(
    `SELECT e.*, s.code AS status_code
     FROM repair.events e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2`,
    [opts.eventId, tenantId],
  );
  const event = evRows[0];

  const { rows: estRows } = await q(
    `SELECT est.id, est.current_revision, st.code AS status_code,
            est.completed_at
     FROM repair.estimates est
     JOIN repair.statuses st ON st.id = est.status_id
     WHERE est.event_id = $1 AND est.deleted_at IS NULL
     ORDER BY est.created_at DESC LIMIT 1`,
    [opts.eventId],
  );
  const est = estRows[0] ?? null;

  const podHist = await listPodDates(opts.eventId, tenantId);
  const latest = await latestPodErd(opts.eventId, tenantId);
  const podDate = ymd(latest.POD?.date_value);

  const { rows: inv } = await q(
    `SELECT invoice_no, created_at, workflow_status, match_status
     FROM repair.invoices
     WHERE event_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [opts.eventId],
  ).catch(() => ({
    rows: [] as Array<{
      invoice_no?: string;
      created_at?: string;
      workflow_status?: string;
      match_status?: string;
    }>,
  }));

  const completed =
    Boolean(ymd(bo?.completed_date)) ||
    Boolean(est?.completed_at) ||
    event?.status_code === "COMPLETE";
  const released = ymd(bo?.released_at) || ymd(event?.actual_outbound_at);
  const today = new Date().toISOString().slice(0, 10);
  const missedPodRequired = Boolean(
    podDate && podDate < today && !released && !ymd(bo?.released_at),
  );

  const dates: BoLifecycleDates = {
    arrival: ymd(bo?.arrival_date) || ymd(event?.yard_arrived_at),
    inspected: ymd(bo?.inspected_at),
    estimateSubmitted: ymd(bo?.estimate_submitted_at),
    ownerApproval: ymd(bo?.owner_approved_at),
    repairStart: ymd(bo?.repair_started_at),
    pod: podDate,
    completed: ymd(bo?.completed_date) || ymd(est?.completed_at),
    released,
    missedPodReasonCode: bo?.missed_pod_reason_code
      ? String(bo.missed_pod_reason_code)
      : null,
    missedPodReasonNote: bo?.missed_pod_reason_note
      ? String(bo.missed_pod_reason_note)
      : null,
    missedPodRequired,
  };

  const isClosed = Boolean(bo?.closed_at) || String(bo?.lifecycle_status ?? "") === "CLOSED";
  const invoiceNo = inv[0]?.invoice_no ? String(inv[0].invoice_no) : null;
  const invoicedAt = ymd(inv[0]?.created_at);
  const invWf = String(inv[0]?.workflow_status ?? "");
  const invoiceAccepted =
    invWf === "ACCEPTED" ||
    invWf === "PAYABLE" ||
    invWf === "IN_BATCH" ||
    invWf === "EXPORTED" ||
    invWf === "PAID" ||
    invWf === "SHORT_PAID" ||
    String(inv[0]?.match_status ?? "") === "APPROVED";
  const invoiceWorkflow = inv[0]?.workflow_status
    ? String(inv[0].workflow_status)
    : null;
  const cancelled =
    Boolean(bo?.closed_reason) &&
    /cancell?ed/i.test(String(bo?.closed_reason ?? ""));
  const storedReason = bo?.closed_reason ? String(bo.closed_reason) : null;
  const closedReasonLine = isClosed
    ? storedReason && storedReason.startsWith("Closed:")
      ? storedReason
      : formatClosedReasonLine({
          completed: dates.completed,
          invoiceNo,
          invoicedAt,
          closedReason: storedReason,
          cancelled,
        })
    : null;

  // §G r5: single stored bo.status (fallback map for pre-migration rows)
  const legacyCode = mapBoTimelineCode({
    eventStatus: event?.status_code ? String(event.status_code) : undefined,
    estimateStatus: est?.status_code ? String(est.status_code) : null,
    lifecycleStatus: bo?.lifecycle_status ? String(bo.lifecycle_status) : null,
    closedAt: bo?.closed_at ? String(bo.closed_at) : null,
    hasInvoice: Boolean(inv[0]),
    invoiceAccepted,
    completed: Boolean(dates.completed),
  });
  const legacyToBo: Record<string, BoStatus> = {
    OPEN: "ASSIGNED",
    CONFIRMED: "ACCEPTED",
    ON_HAND: "ON_HAND",
    ESTIMATE_PENDING: "ESTIMATE_DRAFT",
    UNDER_OWNER_REVIEW: "UNDER_OWNER_REVIEW",
    REJECTED: "REJECTED",
    APPROVED: "APPROVED",
    IN_REPAIR: "IN_REPAIR",
    COMPLETED: "COMPLETED",
    CLOSED: "CLOSED",
  };
  const boStatus = (bo?.status
    ? String(bo.status)
    : legacyToBo[legacyCode] ?? "ASSIGNED") as BoStatus;
  // timelineCode = stored status (r5); smoke/UI should prefer `status`
  const timelineCode = boStatus;

  const history = await listBoStatusHistory({
    eventId: opts.eventId,
    tenantId,
  });
  const compact = buildCompactTimeline({
    status: boStatus,
    history: history.map((h) => ({
      to: h.to,
      at: h.at,
      actor: h.actor,
      note: h.note,
    })),
  });
  // Full timeline kept for smoke compat; UI uses compactTimeline
  const timeline = buildStatusTimeline({
    currentCode:
      boStatus === "ASSIGNED"
        ? "OPEN"
        : boStatus === "ACCEPTED"
          ? "CONFIRMED"
          : boStatus === "ESTIMATE_DRAFT"
            ? "ESTIMATE_PENDING"
            : boStatus === "ESTIMATE_SUBMITTED" ||
                boStatus === "UNDER_OWNER_REVIEW"
              ? "UNDER_OWNER_REVIEW"
              : boStatus === "INVOICE_SUBMITTED"
                ? "COMPLETED"
                : boStatus,
    closedReason: closedReasonLine,
    closedAt: bo?.closed_at ? String(bo.closed_at) : null,
  });

  // Flags ONLY when an estimate exists (never on Assigned/Accepted/On Hand)
  const flags: Array<{
    what: string;
    lineNo: number | null;
    blocksCompletion: boolean;
    whoClears: string;
    code: string;
  }> = [];
  if (est?.id) {
    const { rows: findings } = await q(
      `SELECT f.rule_code, f.message, f.line_no, f.severity, f.cleared_at
       FROM repair.estimate_validation_findings f
       JOIN repair.estimate_validation_runs r ON r.id = f.run_id
       WHERE r.estimate_id = $1 AND f.cleared_at IS NULL
         AND f.severity = 'FLAG'
       ORDER BY f.created_at DESC`,
      [est.id],
    );
    for (const f of findings) {
      const blocks =
        f.rule_code === "MISSING_CID" || f.rule_code === "MISSING_INVOICE_NO";
      flags.push({
        what: String(f.message),
        lineNo: f.line_no != null ? Number(f.line_no) : null,
        blocksCompletion: blocks,
        whoClears: "Owner / Managing Partner",
        code: String(f.rule_code),
      });
    }
    const openWreck = await estimateHasOpenWreckFlags(String(est.id)).catch(
      () => false,
    );
    if (openWreck) {
      flags.push({
        what: "Open wreck validation flag(s)",
        lineNo: null,
        blocksCompletion: true,
        whoClears: "Owner / Managing Partner",
        code: "WRECK_FLAG",
      });
    }
  }
  const flagSummary = summarizeFlags(flags);
  const flagSummaryLine = formatFlagSummaryLine(flagSummary);
  const openFlagCount = flags.filter((f) => f.blocksCompletion).length;
  const approvedWithFlags =
    boStatus === "APPROVED" && flags.some((f) => f.blocksCompletion);
  const statusLine =
    compact.statusLine ||
    formatBoStatusLine({
      status: boStatus,
      statusChangedAt: bo?.status_changed_at
        ? String(bo.status_changed_at)
        : null,
      arrivalAt: dates.arrival,
    });

  const inconsistency = detectClosedInconsistency({
    isClosed,
    completed: dates.completed,
    hasInvoice: Boolean(inv[0]),
    invoiceAccepted: inv[0] ? invoiceAccepted : undefined,
    openBlockingFlags: openFlagCount,
    cancelled,
  });

  const podHistory = podHist
    .filter((r) => r.kind === "POD")
    .map((r) => ({
      id: r.id,
      dateValue: ymd(r.date_value),
      priorDate: ymd(r.prior_date),
      reasonCode: r.reason_code ? String(r.reason_code) : null,
      reasonNote: r.reason ? String(r.reason) : null,
      who: String(r.entered_by ?? ""),
      when: r.entered_at ? String(r.entered_at) : null,
    }));

  return {
    dates,
    status: boStatus,
    statusLabel: BO_STATUS_LABEL[boStatus] ?? boStatus,
    statusLine,
    compactTimeline: compact.steps,
    timeline,
    timelineCode,
    flags: est?.id ? flags : [],
    flagSummary,
    flagSummaryLine,
    showFlags: Boolean(est?.id),
    approvedWithFlags,
    openFlagCount,
    podHistory,
    missedPodReasons: await listMissedPodReasonCodes(tenantId),
    estimateId: est?.id ? String(est.id) : null,
    estimateStatus: est?.status_code ? String(est.status_code) : null,
    isClosed,
    closedReasonLine,
    closedAt: bo?.closed_at ? String(bo.closed_at) : null,
    invoiceNo,
    invoiceAccepted,
    invoiceWorkflow,
    // Inconsistent state = owner-only; shops never see this block in UI
    inconsistentClosed: inconsistency.inconsistent,
    inconsistentClosedReasons: inconsistency.reasons,
  };
}

/** Shop KPIs for portal home. */
export async function shopKpis(opts: {
  shopId: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const today = new Date().toISOString().slice(0, 10);

  const { rows: missed } = await q(
    `SELECT count(*)::int AS n
     FROM repair.events e
     JOIN repair.pod_dates p ON p.event_id = e.id AND p.kind = 'POD'
     LEFT JOIN repair.bad_orders bo ON bo.event_id = e.id AND bo.deleted_at IS NULL
     WHERE e.shop_id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL
       AND p.entered_at = (
         SELECT max(p2.entered_at) FROM repair.pod_dates p2
         WHERE p2.event_id = e.id AND p2.kind = 'POD'
       )
       AND p.date_value::text < $3
       AND coalesce(bo.released_at::text, e.actual_outbound_at::text) IS NULL`,
    [opts.shopId, tenantId, today],
  );

  const { rows: avgRows } = await q(
    `SELECT avg(
       EXTRACT(EPOCH FROM (bo.owner_approved_at::timestamp - bo.arrival_date::timestamp)) / 86400.0
     ) AS avg_days
     FROM repair.bad_orders bo
     JOIN repair.events e ON e.id = bo.event_id
     WHERE e.shop_id = $1 AND e.tenant_id = $2 AND bo.deleted_at IS NULL
       AND bo.arrival_date IS NOT NULL AND bo.owner_approved_at IS NOT NULL`,
    [opts.shopId, tenantId],
  );

  return {
    missedPodCount: Number(missed[0]?.n ?? 0),
    avgDaysArrivalToApproval:
      avgRows[0]?.avg_days != null
        ? Math.round(Number(avgRows[0].avg_days) * 10) / 10
        : null,
  };
}

const SHOP_EDITABLE = new Set([
  "arrival",
  "pod",
  "missedPodReason",
  "completed",
  "released",
]);
const OWNER_EDITABLE = new Set([
  ...SHOP_EDITABLE,
  "inspected",
  "estimateSubmitted",
  "ownerApproval",
  "repairStart",
]);

export async function updateBoLifecycleDates(opts: {
  eventId: string;
  actor: string;
  actorRole: string;
  tenantId?: string;
  arrival?: string | null;
  inspected?: string | null;
  estimateSubmitted?: string | null;
  ownerApproval?: string | null;
  repairStart?: string | null;
  pod?: string | null;
  podReasonCode?: string | null;
  podReasonNote?: string | null;
  completed?: string | null;
  released?: string | null;
  missedPodReasonCode?: string | null;
  missedPodReasonNote?: string | null;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const role = String(opts.actorRole ?? "").toLowerCase();
  const isOwner =
    role === "owner" ||
    role === "managing_partner" ||
    role === "reviewer" ||
    role === "admin" ||
    role === "dev-bypass";
  const isShop = role === "shop" || role === "shop_user" || role === "shop_link";

  const allowed = isOwner ? OWNER_EDITABLE : isShop ? SHOP_EDITABLE : new Set<string>();
  if (!allowed.size) {
    return { ok: false as const, status: 403, error: "Not allowed to edit dates" };
  }

  const { rows: boRows } = await q(
    `SELECT id FROM repair.bad_orders
     WHERE event_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [opts.eventId],
  );
  if (!boRows[0]) {
    return { ok: false as const, status: 404, error: "Bad order not found" };
  }
  const boId = String(boRows[0].id);

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };

  if (opts.arrival !== undefined && allowed.has("arrival")) {
    push("arrival_date", opts.arrival || null);
    if (opts.arrival) {
      await q(
        `UPDATE repair.events SET yard_arrived_at = $1::date
         WHERE id = $2 AND yard_arrived_at IS NULL`,
        [opts.arrival, opts.eventId],
      ).catch(() => undefined);
    }
  }
  if (opts.inspected !== undefined && allowed.has("inspected")) {
    push("inspected_at", opts.inspected || null);
  }
  if (opts.estimateSubmitted !== undefined && allowed.has("estimateSubmitted")) {
    push("estimate_submitted_at", opts.estimateSubmitted || null);
  }
  if (opts.ownerApproval !== undefined && allowed.has("ownerApproval")) {
    push("owner_approved_at", opts.ownerApproval || null);
  }
  if (opts.repairStart !== undefined && allowed.has("repairStart")) {
    push("repair_started_at", opts.repairStart || null);
  }
  if (opts.completed !== undefined && allowed.has("completed")) {
    push("completed_date", opts.completed || null);
  }
  if (opts.released !== undefined && allowed.has("released")) {
    push("released_at", opts.released || null);
  }
  if (opts.missedPodReasonCode !== undefined && allowed.has("missedPodReason")) {
    push("missed_pod_reason_code", opts.missedPodReasonCode || null);
    push("missed_pod_reason_note", opts.missedPodReasonNote || null);
  }

  if (opts.pod !== undefined && allowed.has("pod")) {
    const latest = await latestPodErd(opts.eventId, tenantId);
    const prior = ymd(latest.POD?.date_value);
    if (prior && prior !== opts.pod && !opts.podReasonCode) {
      return {
        ok: false as const,
        status: 400,
        error: "POD change requires a reason code",
      };
    }
    const entered = await enterPodErd({
      eventId: opts.eventId,
      kind: "POD",
      dateValue: String(opts.pod),
      enteredBy: opts.actor,
      reason: opts.podReasonNote || opts.podReasonCode || undefined,
      reasonCode: opts.podReasonCode || undefined,
      tenantId,
      via: isShop ? "shop_portal" : "UI",
    });
    if (!entered.ok) return entered;
  }

  // Missed POD required check after edits
  const bundle = await getBoLifecycleBundle({ eventId: opts.eventId, tenantId });
  if (
    bundle.dates.missedPodRequired &&
    !bundle.dates.missedPodReasonCode &&
    !(opts.missedPodReasonCode || bundle.dates.missedPodReasonCode)
  ) {
    // Allow setting the reason in same call
    if (opts.missedPodReasonCode === undefined) {
      // only enforce when shop tries to set completed/released without reason
      if (opts.completed || opts.released) {
        return {
          ok: false as const,
          status: 400,
          error: "Missed POD reason required when today > POD and not released",
        };
      }
    }
  }

  if (sets.length) {
    params.push(boId);
    await q(
      `UPDATE repair.bad_orders SET ${sets.join(", ")} WHERE id = $${params.length}`,
      params,
    );
  }

  await writeAudit({
    tenantId,
    entity: "bad_orders",
    entityId: boId,
    action: "BO_LIFECYCLE_DATES_UPDATED",
    after: {
      arrival: opts.arrival,
      pod: opts.pod,
      completed: opts.completed,
      released: opts.released,
      missedPodReasonCode: opts.missedPodReasonCode,
    },
    actor: opts.actor,
    via: isShop ? "shop_portal" : "UI",
  });

  return {
    ok: true as const,
    bundle: await getBoLifecycleBundle({ eventId: opts.eventId, tenantId }),
  };
}

/** Owner reject/adjust line + estimate-level comments. */
export async function saveDecisionComments(opts: {
  eventId: string;
  estimateId: string;
  revisionId?: string;
  kind: "REJECT" | "ADJUST";
  estimateComment?: string | null;
  lineComments?: Array<{
    lineId?: string;
    lineNo?: number;
    jobCode?: string;
    body: string;
  }>;
  author: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const created: unknown[] = [];

  const estBody = (opts.estimateComment ?? "").trim();
  if (estBody) {
    const r = await addComment({
      eventId: opts.eventId,
      estimateId: opts.estimateId,
      revisionId: opts.revisionId,
      body: estBody,
      author: opts.author,
      tenantId,
      issue: opts.kind,
    });
    if (r.ok) {
      await q(
        `UPDATE repair.comments SET decision_kind = $1, line_no = NULL WHERE id = $2`,
        [opts.kind, r.comment.id],
      );
      created.push(r.comment);
    }
  }

  for (const lc of opts.lineComments ?? []) {
    const body = (lc.body ?? "").trim();
    if (!body) continue;
    const r = await addComment({
      eventId: opts.eventId,
      estimateId: opts.estimateId,
      revisionId: opts.revisionId,
      lineId: lc.lineId,
      body,
      author: opts.author,
      tenantId,
      issue: opts.kind,
    });
    if (r.ok) {
      await q(
        `UPDATE repair.comments
         SET decision_kind = $1, line_no = $2, job_code = $3
         WHERE id = $4`,
        [opts.kind, lc.lineNo ?? null, lc.jobCode ?? null, r.comment.id],
      );
      created.push({ ...r.comment, line_no: lc.lineNo, job_code: lc.jobCode });
    }
  }

  return { ok: true as const, comments: created };
}

export async function listDecisionComments(opts: {
  estimateId: string;
  tenantId?: string;
}) {
  const rows = await listComments({
    estimateId: opts.estimateId,
    tenantId: opts.tenantId,
  });
  const decision = rows.filter(
    (r) =>
      r.decision_kind === "REJECT" ||
      r.decision_kind === "ADJUST" ||
      r.issue === "REJECT" ||
      r.issue === "ADJUST",
  );
  const estimateLevel = decision.filter((r) => r.line_no == null && !r.line_id);
  const lineLevel = decision.filter((r) => r.line_no != null || r.line_id);
  return {
    estimateLevel: estimateLevel.map(formatDecisionComment),
    lineLevel: lineLevel.map(formatDecisionComment),
    all: decision.map(formatDecisionComment),
  };
}

function formatDecisionComment(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    body: String(r.body ?? ""),
    lineNo: r.line_no != null ? Number(r.line_no) : null,
    jobCode: r.job_code ? String(r.job_code) : null,
    kind: String(r.decision_kind ?? r.issue ?? "GENERAL"),
    author: String(r.author ?? ""),
    createdAt: r.created_at ? String(r.created_at) : null,
    resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
    resolvedBy: r.resolved_by ? String(r.resolved_by) : null,
  };
}

export async function resolveDecisionComment(opts: {
  commentId: string;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.comments
     SET resolved_at = now(), resolved_by = $1
     WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
     RETURNING *`,
    [opts.actor, opts.commentId, tenantId],
  );
  if (!rows[0]) {
    return { ok: false as const, status: 404, error: "Comment not found" };
  }
  await writeAudit({
    tenantId,
    entity: "comment",
    entityId: opts.commentId,
    action: "DECISION_COMMENT_RESOLVED",
    after: { resolvedBy: opts.actor },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, comment: formatDecisionComment(rows[0]) };
}

/** After resubmit: which commented lines changed vs prior revision. */
export async function commentedLinesDiff(opts: {
  estimateId: string;
  leftRevisionId: string;
  rightRevisionId: string;
  tenantId?: string;
}) {
  const comments = await listDecisionComments({
    estimateId: opts.estimateId,
    tenantId: opts.tenantId,
  });
  const { compareRevisions } = await import("./comments");
  const diff = await compareRevisions({
    leftRevisionId: opts.leftRevisionId,
    rightRevisionId: opts.rightRevisionId,
  });

  const changedLineNos = new Set<number>();
  for (const c of diff.changed) {
    const left = c.left as { line_no?: number };
    const right = c.right as { line_no?: number };
    if (left?.line_no != null) changedLineNos.add(Number(left.line_no));
    if (right?.line_no != null) changedLineNos.add(Number(right.line_no));
  }
  for (const a of diff.added as Array<{ line_no?: number }>) {
    if (a.line_no != null) changedLineNos.add(Number(a.line_no));
  }
  for (const r of diff.removed as Array<{ line_no?: number }>) {
    if (r.line_no != null) changedLineNos.add(Number(r.line_no));
  }

  const commentedChanged = comments.lineLevel.filter(
    (c) => c.lineNo != null && changedLineNos.has(c.lineNo),
  );
  const commentedUnchanged = comments.lineLevel.filter(
    (c) => c.lineNo != null && !changedLineNos.has(c.lineNo) && !c.resolvedAt,
  );

  return {
    diff,
    commentedChanged,
    commentedUnchanged,
    changedLineNos: [...changedLineNos],
  };
}

/** Format decision comments for email / outbox body. */
export function formatCommentsForEmail(
  comments: Awaited<ReturnType<typeof listDecisionComments>>,
): string[] {
  const lines: string[] = [];
  if (comments.estimateLevel.length === 0 && comments.lineLevel.length === 0) {
    return ["no change requested"];
  }
  for (const c of comments.estimateLevel) {
    lines.push(`Estimate: ${c.body}`);
  }
  for (const c of comments.lineLevel) {
    const tag =
      c.lineNo != null
        ? `Line ${c.lineNo}${c.jobCode ? ` (${c.jobCode})` : ""}`
        : "Line";
    lines.push(`${tag}: ${c.body}`);
  }
  return lines;
}

/** Relative luminance contrast helpers for AA smoke (no browser required). */
export function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const n =
    h.length === 3
      ? h.split("").map((c) => parseInt(c + c, 16))
      : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const [r, g, b] = n.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(fg: string, bg: string): number {
  const L1 = relativeLuminance(fg);
  const L2 = relativeLuminance(bg);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Shop / owner AA theme tokens — values near-black; labels muted ≥4.5:1 on white.
 *  Keep in sync with client repair CSS vars (--repair-*) / repairTokens.ts. */
export const SHOP_AA_TOKENS = {
  bg: "#f3f4f6",
  surface: "#ffffff",
  value: "#0f172a", // slate-900
  label: "#334155", // slate-700 — ≥4.5:1 on white
  mutedOk: "#475569", // slate-600
  border: "#94a3b8", // slate-400 — input border
  placeholder: "#475569", // slate-600 — ≥4.5:1 on white
  inputBg: "#ffffff",
  focusRing: "#334155", // slate-700
  btnDisabledBg: "#e2e8f0",
  btnDisabledText: "#334155", // ≥4.5:1 on disabled bg
  checkboxBg: "#ffffff",
  checkboxBorder: "#64748b",
  checkboxAccent: "#1e3a5f",
} as const;

function fmtMdY(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd));
  if (!m) return String(ymd).slice(0, 10);
  return `${Number(m[2])}/${Number(m[3])}/${m[1]!.slice(2)}`;
}

/**
 * One-line closed reason for shop home + BO detail timeline.
 * e.g. "Closed: repair completed 10/14 and invoiced INV#### on 10/15"
 * or "Closed: cancelled by owner (reason)".
 */
export function formatClosedReasonLine(opts: {
  completed?: string | null;
  invoiceNo?: string | null;
  invoicedAt?: string | null;
  closedReason?: string | null;
  cancelled?: boolean;
  cancelReason?: string | null;
}): string {
  if (opts.cancelled) {
    const why = (opts.cancelReason || opts.closedReason || "no reason").trim();
    return `Closed: cancelled by owner (${why})`;
  }
  const completed = fmtMdY(opts.completed);
  const inv = (opts.invoiceNo || "").trim() || "invoice";
  const invDate = fmtMdY(opts.invoicedAt);
  if (completed && invDate) {
    return `Closed: repair completed ${completed} and invoiced ${inv} on ${invDate}`;
  }
  if (completed) {
    return `Closed: repair completed ${completed} and invoiced ${inv}`;
  }
  if (opts.closedReason && String(opts.closedReason).trim()) {
    const r = String(opts.closedReason).trim();
    return r.startsWith("Closed:") ? r : `Closed: ${r}`;
  }
  return "Closed: repair completed and invoiced";
}

/** Closed with open flags / missing completed / missing accepted invoice → inconsistent. */
export function detectClosedInconsistency(opts: {
  isClosed: boolean;
  completed?: string | null;
  hasInvoice: boolean;
  invoiceAccepted?: boolean;
  openBlockingFlags: number;
  cancelled?: boolean;
}): { inconsistent: boolean; reasons: string[] } {
  if (!opts.isClosed) return { inconsistent: false, reasons: [] };
  if (opts.cancelled) return { inconsistent: false, reasons: [] };
  const reasons: string[] = [];
  if (!opts.completed) reasons.push("missing completed date");
  if (!opts.hasInvoice) reasons.push("missing invoice");
  else if (opts.invoiceAccepted === false) {
    reasons.push("invoice not accepted");
  }
  if (opts.openBlockingFlags > 0) {
    reasons.push(`${opts.openBlockingFlags} open blocking flag(s)`);
  }
  return { inconsistent: reasons.length > 0, reasons };
}

/**
 * Gate close transitions: completed + accepted invoice + no blocking flags.
 * Used by closeEvent / seed / any path that sets Closed.
 */
export async function assertCloseRequirements(opts: {
  eventId: string;
  tenantId?: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const bundle = await getBoLifecycleBundle({
    eventId: opts.eventId,
    tenantId,
  });
  const completed = bundle.dates.completed;
  const { rows: inv } = await q(
    `SELECT invoice_no, workflow_status, match_status FROM repair.invoices
     WHERE event_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [opts.eventId],
  ).catch(() => ({
    rows: [] as Array<{
      invoice_no?: string;
      workflow_status?: string;
      match_status?: string;
    }>,
  }));
  const blocking = bundle.openFlagCount;
  if (!completed) {
    return {
      ok: false,
      status: 409,
      error: "Cannot close: completed date required",
    };
  }
  if (!inv[0]) {
    return {
      ok: false,
      status: 409,
      error: "Cannot close: invoice required",
    };
  }
  const wf = String(inv[0].workflow_status ?? "");
  const accepted =
    wf === "ACCEPTED" ||
    wf === "PAYABLE" ||
    wf === "IN_BATCH" ||
    wf === "EXPORTED" ||
    wf === "PAID" ||
    wf === "SHORT_PAID" ||
    String(inv[0].match_status ?? "") === "APPROVED";
  if (!accepted) {
    return {
      ok: false,
      status: 409,
      error: "Cannot close: accepted invoice required",
    };
  }
  if (blocking > 0) {
    return {
      ok: false,
      status: 409,
      error: `Cannot close: ${blocking} open blocking flag(s)`,
    };
  }
  return { ok: true };
}

/** Persist Closed on bad_orders with a clear one-line reason (after assertCloseRequirements). */
export async function markBadOrderClosed(opts: {
  eventId: string;
  actor: string;
  tenantId?: string;
  invoiceNo?: string | null;
  invoicedAt?: string | null;
  cancelled?: boolean;
  cancelReason?: string | null;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (!opts.cancelled) {
    const gate = await assertCloseRequirements({
      eventId: opts.eventId,
      tenantId,
    });
    if (!gate.ok) return gate;
  }
  const bundle = await getBoLifecycleBundle({ eventId: opts.eventId, tenantId });
  const { rows: inv } = await q(
    `SELECT invoice_no, created_at FROM repair.invoices
     WHERE event_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [opts.eventId],
  ).catch(() => ({ rows: [] as Array<{ invoice_no?: string; created_at?: unknown }> }));
  const reason = formatClosedReasonLine({
    completed: bundle.dates.completed,
    invoiceNo: opts.invoiceNo ?? (inv[0]?.invoice_no ? String(inv[0].invoice_no) : null),
    invoicedAt: opts.invoicedAt ?? ymd(inv[0]?.created_at),
    cancelled: opts.cancelled,
    cancelReason: opts.cancelReason,
  });
  await q(
    `UPDATE repair.bad_orders
     SET closed_at = coalesce(closed_at, now()),
         closed_reason = $2,
         lifecycle_status = 'CLOSED'
     WHERE event_id = $1 AND deleted_at IS NULL`,
    [opts.eventId, reason],
  );
  await setBoStatus({
    eventId: opts.eventId,
    to: "CLOSED",
    actor: opts.actor,
    actionName: opts.cancelled ? "Cancel / close" : "Close bad order",
    note: reason,
    tenantId,
    force: true,
  });
  await writeAudit({
    tenantId,
    entity: "bad_order",
    entityId: opts.eventId,
    action: "BO_MARKED_CLOSED",
    after: { closedReason: reason, cancelled: Boolean(opts.cancelled) },
    actor: opts.actor,
    via: "UI",
  });
  await revokeShopLinksOnClose({
    eventId: opts.eventId,
    actor: opts.actor,
    tenantId,
  }).catch(() => 0);
  return { ok: true as const, closedReason: reason };
}
