/**
 * §G r5 — One stored BO status, one state machine.
 * Every screen reads `bad_orders.status`. Transitions are forward-only
 * (except Rejected → shop resubmit back through estimate draft/submit).
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { getStatusByCode } from "./status-machine";

export const BO_STATUSES = [
  "ASSIGNED",
  "ACCEPTED",
  "ON_HAND",
  "ESTIMATE_DRAFT",
  "ESTIMATE_SUBMITTED",
  "UNDER_OWNER_REVIEW",
  "REJECTED",
  "APPROVED",
  "IN_REPAIR",
  "COMPLETED",
  "INVOICE_SUBMITTED",
  "CLOSED",
  "DECLINED",
] as const;

export type BoStatus = (typeof BO_STATUSES)[number];

/** Shop-home tile labels — 1:1 with stored status (except DECLINED). */
export const BO_STATUS_TILE: Record<Exclude<BoStatus, "DECLINED">, string> = {
  ASSIGNED: "Awaiting Shop Acceptance",
  ACCEPTED: "Accepted – awaiting arrival",
  ON_HAND: "On Hand",
  ESTIMATE_DRAFT: "Estimate Draft",
  ESTIMATE_SUBMITTED: "Estimate Submitted",
  UNDER_OWNER_REVIEW: "Under Owner Review",
  REJECTED: "Rejected / Adjustment Requested",
  APPROVED: "Approved",
  IN_REPAIR: "In Repair",
  COMPLETED: "Completed",
  INVOICE_SUBMITTED: "Invoice Submitted",
  CLOSED: "Closed",
};

/** Overlay tile: BOs past POD (alongside base stored status). */
export const MISSED_POD_TILE = "Missed POD";

export const SHOP_STATUS_TILES = [
  BO_STATUS_TILE.ASSIGNED,
  BO_STATUS_TILE.ACCEPTED,
  BO_STATUS_TILE.ON_HAND,
  BO_STATUS_TILE.ESTIMATE_DRAFT,
  BO_STATUS_TILE.ESTIMATE_SUBMITTED,
  BO_STATUS_TILE.UNDER_OWNER_REVIEW,
  BO_STATUS_TILE.REJECTED,
  BO_STATUS_TILE.APPROVED,
  BO_STATUS_TILE.IN_REPAIR,
  BO_STATUS_TILE.COMPLETED,
  MISSED_POD_TILE,
  BO_STATUS_TILE.INVOICE_SUBMITTED,
  BO_STATUS_TILE.CLOSED,
] as const;

export type ShopStatusTile = (typeof SHOP_STATUS_TILES)[number];

export const BO_STATUS_LABEL: Record<BoStatus, string> = {
  ASSIGNED: "Assigned",
  ACCEPTED: "Accepted",
  ON_HAND: "On Hand",
  ESTIMATE_DRAFT: "Estimate Draft",
  ESTIMATE_SUBMITTED: "Estimate Submitted",
  UNDER_OWNER_REVIEW: "Under Owner Review",
  REJECTED: "Rejected / Adjustment Requested",
  APPROVED: "Approved",
  IN_REPAIR: "In Repair",
  COMPLETED: "Completed",
  INVOICE_SUBMITTED: "Invoice Submitted",
  CLOSED: "Closed",
  DECLINED: "Declined",
};

/** Plain-language top status line. */
export function formatBoStatusLine(opts: {
  status: BoStatus;
  statusChangedAt?: string | null;
  arrivalAt?: string | null;
}): string {
  const d = opts.statusChangedAt
    ? new Date(opts.statusChangedAt)
    : opts.arrivalAt
      ? new Date(opts.arrivalAt)
      : null;
  const datePart =
    d && !Number.isNaN(d.getTime())
      ? `${d.getMonth() + 1}/${d.getDate()}`
      : null;
  switch (opts.status) {
    case "ASSIGNED":
      return "Assigned – awaiting shop acceptance.";
    case "ACCEPTED":
      return datePart
        ? `Accepted ${datePart} – waiting for car to arrive.`
        : "Accepted – waiting for car to arrive.";
    case "ON_HAND":
      return datePart ? `On hand ${datePart}.` : "On hand.";
    case "ESTIMATE_DRAFT":
      return "Estimate draft – shop preparing.";
    case "ESTIMATE_SUBMITTED":
      return "Estimate submitted – awaiting owner review.";
    case "UNDER_OWNER_REVIEW":
      return "Under owner review.";
    case "REJECTED":
      return "Rejected / adjustment requested – back to shop.";
    case "APPROVED":
      return datePart ? `Approved ${datePart}.` : "Approved.";
    case "IN_REPAIR":
      return "In repair.";
    case "COMPLETED":
      return datePart ? `Completed ${datePart}.` : "Completed.";
    case "INVOICE_SUBMITTED":
      return "Invoice submitted – awaiting owner accept.";
    case "CLOSED":
      return datePart ? `Closed ${datePart}.` : "Closed.";
    case "DECLINED":
      return "Declined by shop.";
    default:
      return BO_STATUS_LABEL[opts.status] ?? String(opts.status);
  }
}

/** Forward (and reject→draft) edges. */
const ALLOWED: Record<BoStatus, BoStatus[]> = {
  ASSIGNED: ["ACCEPTED", "DECLINED"],
  ACCEPTED: ["ON_HAND", "DECLINED"],
  ON_HAND: ["ESTIMATE_DRAFT", "ESTIMATE_SUBMITTED"],
  ESTIMATE_DRAFT: ["ESTIMATE_SUBMITTED", "UNDER_OWNER_REVIEW"],
  ESTIMATE_SUBMITTED: ["UNDER_OWNER_REVIEW", "REJECTED", "APPROVED"],
  UNDER_OWNER_REVIEW: ["REJECTED", "APPROVED"],
  REJECTED: ["ESTIMATE_DRAFT", "ESTIMATE_SUBMITTED", "UNDER_OWNER_REVIEW"],
  APPROVED: ["IN_REPAIR", "COMPLETED"],
  IN_REPAIR: ["COMPLETED"],
  COMPLETED: ["INVOICE_SUBMITTED", "CLOSED"],
  INVOICE_SUBMITTED: ["COMPLETED", "CLOSED"], // COMPLETED only if invoice rejected → resubmit stays INVOICE_SUBMITTED
  CLOSED: [],
  DECLINED: ["ASSIGNED"], // owner reassign
};

/** Event status to keep in sync (legacy event machine). */
const EVENT_SYNC: Partial<Record<BoStatus, string>> = {
  ASSIGNED: "SHOP_ASSIGNED",
  ACCEPTED: "ACCEPTED",
  ON_HAND: "ON_HAND",
  IN_REPAIR: "IN_REPAIR",
  COMPLETED: "COMPLETE",
  CLOSED: "CLOSED",
};

/** lifecycle_status bridge for owner Bad Orders grid. */
const LIFECYCLE_SYNC: Partial<Record<BoStatus, string>> = {
  ASSIGNED: "QUEUED",
  ACCEPTED: "ACCEPTED_PENDING",
  ON_HAND: "ACCEPTED_WORKING",
  ESTIMATE_DRAFT: "ACCEPTED_WORKING",
  ESTIMATE_SUBMITTED: "ACCEPTED_WORKING",
  UNDER_OWNER_REVIEW: "ACCEPTED_WORKING",
  REJECTED: "ACCEPTED_WORKING",
  APPROVED: "ACCEPTED_WORKING",
  IN_REPAIR: "ACCEPTED_WORKING",
  COMPLETED: "ACCEPTED_WORKING",
  INVOICE_SUBMITTED: "ACCEPTED_WORKING",
  CLOSED: "CLOSED",
  DECLINED: "DECLINED",
};

export function tileForStatus(status: BoStatus | string | null | undefined): ShopStatusTile {
  const s = String(status ?? "ASSIGNED") as BoStatus;
  if (s === "DECLINED") return BO_STATUS_TILE.ASSIGNED;
  return (BO_STATUS_TILE[s as Exclude<BoStatus, "DECLINED">] ??
    BO_STATUS_TILE.ASSIGNED) as ShopStatusTile;
}

export function emptyTileCounts(): Record<ShopStatusTile, number> {
  const out = {} as Record<ShopStatusTile, number>;
  for (const t of SHOP_STATUS_TILES) out[t] = 0;
  return out;
}

export function statusFromTile(tile: string): BoStatus | null {
  if (tile === MISSED_POD_TILE) return null; // overlay — not a stored status
  for (const [code, label] of Object.entries(BO_STATUS_TILE)) {
    if (label === tile) return code as BoStatus;
  }
  return null;
}

/** Display label for bad-order lists — never blank for known statuses. */
export function displayBoStatusLabel(
  status: string | null | undefined,
  lifecycleFallback?: string | null,
): string {
  const s = String(status ?? "").trim();
  if (s && BO_STATUS_LABEL[s as BoStatus]) return BO_STATUS_LABEL[s as BoStatus];
  if (s === "CLOSED" || String(lifecycleFallback ?? "").toUpperCase() === "CLOSED") {
    return "Closed";
  }
  const life = String(lifecycleFallback ?? "").trim();
  if (life === "CLOSED") return "Closed";
  if (life) return life;
  return s || "—";
}

export async function getBoStoredStatus(opts: {
  eventId: string;
  tenantId?: string;
}): Promise<{
  badOrderId: string;
  status: BoStatus;
  statusChangedAt: string | null;
  statusChangedBy: string | null;
} | null> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT id, status, status_changed_at, status_changed_by
     FROM repair.bad_orders
     WHERE event_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [opts.eventId, tenantId],
  );
  if (!rows[0]) return null;
  return {
    badOrderId: String(rows[0].id),
    status: String(rows[0].status ?? "ASSIGNED") as BoStatus,
    statusChangedAt: rows[0].status_changed_at
      ? String(rows[0].status_changed_at)
      : null,
    statusChangedBy: rows[0].status_changed_by
      ? String(rows[0].status_changed_by)
      : null,
  };
}

function canTransition(from: BoStatus, to: BoStatus): boolean {
  if (from === to) return true;
  return (ALLOWED[from] ?? []).includes(to);
}

/**
 * Persist BO status. Idempotent when already at `to`.
 * Syncs event status + lifecycle_status and appends history.
 */
export async function setBoStatus(opts: {
  eventId: string;
  to: BoStatus;
  actor: string;
  actionName: string;
  note?: string | null;
  tenantId?: string;
  occurredAt?: string | null;
  /** Skip edge check (repair/migration only). */
  force?: boolean;
}): Promise<
  | { ok: true; from: BoStatus; to: BoStatus; unchanged: boolean }
  | { ok: false; status: number; error: string }
> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const current = await getBoStoredStatus({
    eventId: opts.eventId,
    tenantId,
  });
  if (!current) {
    return { ok: false, status: 404, error: "Bad order not found for event" };
  }
  const from = current.status;
  const to = opts.to;
  if (from === to) {
    return { ok: true, from, to, unchanged: true };
  }
  if (!opts.force && !canTransition(from, to)) {
    return {
      ok: false,
      status: 409,
      error: `Cannot transition BO status ${from} → ${to}`,
    };
  }

  const occurredAt = opts.occurredAt
    ? new Date(opts.occurredAt).toISOString()
    : new Date().toISOString();
  const life = LIFECYCLE_SYNC[to] ?? null;

  const { rows: updated } = await q(
    `UPDATE repair.bad_orders
     SET status = $1,
         status_changed_at = $2::timestamptz,
         status_changed_by = $3,
         lifecycle_status = coalesce($4, lifecycle_status)
     WHERE id = $5 AND deleted_at IS NULL AND status = $6
     RETURNING id, status`,
    [to, occurredAt, opts.actor, life, current.badOrderId, from],
  );
  if (!updated[0]) {
    // Concurrent change — re-read
    const again = await getBoStoredStatus({
      eventId: opts.eventId,
      tenantId,
    });
    if (again?.status === to) {
      return { ok: true, from, to, unchanged: true };
    }
    return {
      ok: false,
      status: 409,
      error: `BO status changed concurrently (expected ${from})`,
    };
  }

  await q(
    `INSERT INTO repair.bo_status_history
       (tenant_id, bad_order_id, event_id, from_status, to_status,
        action_name, actor, note, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz)`,
    [
      tenantId,
      current.badOrderId,
      opts.eventId,
      from,
      to,
      opts.actionName,
      opts.actor,
      opts.note ?? null,
      occurredAt,
    ],
  );

  // Sync event status when mapped
  const eventCode = EVENT_SYNC[to];
  if (eventCode) {
    const st = await getStatusByCode(tenantId, "EVENT", eventCode);
    if (st) {
      await q(
        `UPDATE repair.events SET status_id = $1
         WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL`,
        [st.id, opts.eventId, tenantId],
      );
    }
  }

  await writeAudit({
    tenantId,
    entity: "bad_order",
    entityId: current.badOrderId,
    action: "BO_STATUS",
    before: { status: from },
    after: { status: to, actionName: opts.actionName },
    actor: opts.actor,
    via: "UI",
  });

  return { ok: true, from, to, unchanged: false };
}

export async function listBoStatusHistory(opts: {
  eventId: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT from_status, to_status, action_name, actor, note, occurred_at
     FROM repair.bo_status_history
     WHERE event_id = $1 AND tenant_id = $2
     ORDER BY occurred_at ASC, created_at ASC`,
    [opts.eventId, tenantId],
  );
  return rows.map((r) => ({
    from: r.from_status ? (String(r.from_status) as BoStatus) : null,
    to: String(r.to_status) as BoStatus,
    actionName: String(r.action_name),
    actor: String(r.actor),
    note: r.note ? String(r.note) : null,
    at: String(r.occurred_at),
  }));
}

export type CompactTimelineStep = {
  code: BoStatus;
  label: string;
  kind: "done" | "current" | "next";
  at: string | null;
  who: string | null;
  meaning: string;
};

const TIMELINE_ORDER: BoStatus[] = [
  "ASSIGNED",
  "ACCEPTED",
  "ON_HAND",
  "ESTIMATE_DRAFT",
  "ESTIMATE_SUBMITTED",
  "UNDER_OWNER_REVIEW",
  "REJECTED",
  "APPROVED",
  "IN_REPAIR",
  "COMPLETED",
  "INVOICE_SUBMITTED",
  "CLOSED",
];

/**
 * Compact timeline: completed steps (with dates) + current + next only.
 * Rejected is included when it occurred; skipped otherwise.
 */
export function buildCompactTimeline(opts: {
  status: BoStatus;
  history: Array<{
    to: BoStatus;
    at: string;
    actor: string;
    note?: string | null;
  }>;
}): { steps: CompactTimelineStep[]; statusLine: string } {
  const byTo = new Map<string, { at: string; actor: string }>();
  for (const h of opts.history) {
    byTo.set(h.to, { at: h.at, actor: h.actor });
  }

  const cur = opts.status === "DECLINED" ? "DECLINED" : opts.status;
  const curIdx =
    cur === "DECLINED"
      ? -1
      : Math.max(0, TIMELINE_ORDER.indexOf(cur as BoStatus));

  const nextCode =
    cur === "DECLINED" || cur === "CLOSED" || curIdx < 0
      ? null
      : cur === "REJECTED"
        ? ("ESTIMATE_DRAFT" as BoStatus)
        : (TIMELINE_ORDER[curIdx + 1] ?? null);

  const steps: CompactTimelineStep[] = [];

  if (cur === "DECLINED") {
    const h = byTo.get("DECLINED");
    steps.push({
      code: "DECLINED",
      label: BO_STATUS_LABEL.DECLINED,
      kind: "current",
      at: h?.at ?? null,
      who: h?.actor ?? null,
      meaning: "Shop declined the assignment.",
    });
    return {
      steps,
      statusLine: formatBoStatusLine({ status: "DECLINED", statusChangedAt: h?.at }),
    };
  }

  for (let i = 0; i < TIMELINE_ORDER.length; i++) {
    const code = TIMELINE_ORDER[i];
    // Skip REJECTED unless current or in history
    if (code === "REJECTED" && cur !== "REJECTED" && !byTo.has("REJECTED")) {
      continue;
    }
    // Skip estimate draft if jumped straight to submitted
    if (
      code === "ESTIMATE_DRAFT" &&
      cur !== "ESTIMATE_DRAFT" &&
      !byTo.has("ESTIMATE_DRAFT") &&
      (byTo.has("ESTIMATE_SUBMITTED") ||
        byTo.has("UNDER_OWNER_REVIEW") ||
        curIdx > TIMELINE_ORDER.indexOf("ESTIMATE_DRAFT"))
    ) {
      // still show if we have no later estimate step yet — keep simple: show if history or current
      if (!byTo.has(code) && code !== cur) continue;
    }

    const h = byTo.get(code);
    const isCurrent = code === cur;
    const isNext = nextCode === code;
    const isDone = i < curIdx || (h != null && i <= curIdx);

    if (!isDone && !isCurrent && !isNext) continue;
    // For steps after reject path, only show relevant ones
    if (code === "REJECTED" && !isCurrent && !h) continue;

    let kind: CompactTimelineStep["kind"] = "done";
    if (isCurrent) kind = "current";
    else if (isNext) kind = "next";
    else if (!isDone) continue;

    steps.push({
      code,
      label: BO_STATUS_LABEL[code],
      kind,
      at: h?.at ?? null,
      who: h?.actor ?? null,
      meaning:
        kind === "next"
          ? `Next: ${BO_STATUS_LABEL[code]}`
          : kind === "current"
            ? formatBoStatusLine({
                status: code,
                statusChangedAt: h?.at ?? null,
              })
            : `${BO_STATUS_LABEL[code]} completed`,
    });
  }

  // Ensure next is present even without history
  if (nextCode && !steps.some((s) => s.code === nextCode && s.kind === "next")) {
    if (!steps.some((s) => s.code === nextCode)) {
      steps.push({
        code: nextCode,
        label: BO_STATUS_LABEL[nextCode],
        kind: "next",
        at: null,
        who: null,
        meaning: `Next: ${BO_STATUS_LABEL[nextCode]}`,
      });
    }
  }

  const curHist = byTo.get(cur);
  return {
    steps,
    statusLine: formatBoStatusLine({
      status: cur as BoStatus,
      statusChangedAt: curHist?.at ?? null,
    }),
  };
}

/** Summarize validation flags by rule code. */
export function summarizeFlags(
  flags: Array<{ code: string; what: string; lineNo?: number | null }>,
): {
  total: number;
  byCode: Array<{ code: string; count: number; label: string }>;
} {
  const map = new Map<string, { count: number; label: string }>();
  for (const f of flags) {
    const cur = map.get(f.code) ?? { count: 0, label: f.what };
    cur.count += 1;
    map.set(f.code, cur);
  }
  const byCode = [...map.entries()].map(([code, v]) => ({
    code,
    count: v.count,
    label: humanFlagLabel(code, v.label),
  }));
  byCode.sort((a, b) => b.count - a.count);
  return { total: flags.length, byCode };
}

function humanFlagLabel(code: string, fallback: string): string {
  switch (code) {
    case "MISSING_CID":
      return "missing CID";
    case "UNKNOWN_QUALIFIER":
      return "unknown qualifier";
    case "MISSING_INVOICE_NO":
      return "missing invoice #";
    default:
      return fallback.length > 40 ? code.toLowerCase().replace(/_/g, " ") : fallback;
  }
}

export function formatFlagSummaryLine(summary: {
  total: number;
  byCode: Array<{ code: string; count: number; label: string }>;
}): string {
  if (summary.total === 0) return "0 flags";
  const parts = summary.byCode.map((c) => `${c.count} ${c.label}`);
  return `${summary.total} flag${summary.total === 1 ? "" : "s"}: ${parts.join(", ")}`;
}
