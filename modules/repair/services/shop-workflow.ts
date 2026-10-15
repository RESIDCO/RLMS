/**
 * §G r4/r5 — Shop BO workflow helpers: status tiles from stored bo.status,
 * next-step copy, one reusable signed shop link per BO until close.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { issueEventLink, revokeEventLink } from "./event-links";
import { writeAudit } from "./audit";
import {
  SHOP_STATUS_TILES,
  type ShopStatusTile,
  type BoStatus,
  tileForStatus,
  emptyTileCounts,
  BO_STATUS_TILE,
} from "./bo-status";

export {
  SHOP_STATUS_TILES,
  type ShopStatusTile,
  emptyTileCounts,
  BO_STATUS_TILE,
};

export type BoTileInput = {
  /** §G r5 — preferred: stored bad_orders.status */
  boStatus?: string | null;
  eventStatus?: string | null;
  lifecycleStatus?: string | null;
  acknowledgedAt?: string | null;
  yardArrivedAt?: string | null;
  estimateStatus?: string | null;
  hasEstimate?: boolean;
  missedPodRequired?: boolean;
  missedPodReasonCode?: string | null;
  completed?: string | null;
  invoiceWorkflow?: string | null;
  hasInvoice?: boolean;
  closedAt?: string | null;
  isClosed?: boolean;
};

/**
 * Tile from stored bo.status (r5). Fallback derivation only when status null
 * (pre-migration rows).
 */
export function classifyBoTile(row: BoTileInput): ShopStatusTile {
  if (row.boStatus) {
    return tileForStatus(row.boStatus);
  }
  if (row.isClosed || row.closedAt || String(row.lifecycleStatus ?? "") === "CLOSED") {
    return BO_STATUS_TILE.CLOSED;
  }
  const invWf = String(row.invoiceWorkflow ?? "");
  if (
    invWf === "INVOICE_SUBMITTED" ||
    invWf === "UNDER_OWNER_REVIEW" ||
    invWf === "REJECTED"
  ) {
    return BO_STATUS_TILE.INVOICE_SUBMITTED;
  }
  if (row.completed && !row.hasInvoice) {
    return BO_STATUS_TILE.COMPLETED;
  }
  const est = String(row.estimateStatus ?? "");
  const ev = String(row.eventStatus ?? "");
  if (ev === "IN_REPAIR") return BO_STATUS_TILE.IN_REPAIR;
  if (est === "APPROVED") return BO_STATUS_TILE.APPROVED;
  if (est === "REVISION_REQUESTED" || est === "ADJUSTMENT_FOR_APPROVAL") {
    return BO_STATUS_TILE.REJECTED;
  }
  if (est === "AWAITING_APPROVAL") return BO_STATUS_TILE.UNDER_OWNER_REVIEW;
  if (est === "DRAFT" || est === "QUEUED") return BO_STATUS_TILE.ESTIMATE_DRAFT;
  if (ev === "ON_HAND" || (row.yardArrivedAt && !row.hasEstimate)) {
    return BO_STATUS_TILE.ON_HAND;
  }
  if (
    ev === "ACCEPTED" ||
    String(row.lifecycleStatus ?? "") === "ACCEPTED_PENDING"
  ) {
    return BO_STATUS_TILE.ACCEPTED;
  }
  return BO_STATUS_TILE.ASSIGNED;
}

export type { BoStatus };

export type NextShopStep = {
  code: string;
  title: string;
  instruction: string;
  actions: string[];
};

/** Human-readable next action for the signed shop link page. */
export function describeNextShopStep(opts: {
  eventStatus: string;
  estimateStatus?: string | null;
  estimateLocked?: boolean;
  hasInvoice?: boolean;
  invoiceWorkflow?: string | null;
  isClosed?: boolean;
  completed?: boolean;
}): NextShopStep {
  if (opts.isClosed) {
    return {
      code: "CLOSED",
      title: "Closed",
      instruction:
        "This bad order is closed. The shop link is no longer active for new work.",
      actions: ["upload-document"],
    };
  }
  const ev = opts.eventStatus;
  const est = String(opts.estimateStatus ?? "");
  const invWf = String(opts.invoiceWorkflow ?? "");

  if (ev === "SHOP_ASSIGNED" || ev === "ASSIGNED") {
    return {
      code: "CONFIRM",
      title: "Awaiting shop acceptance",
      instruction:
        "Accept this assignment, or Decline with a reason (owner is notified via local outbox).",
      actions: ["accept", "reject"],
    };
  }
  if (ev === "ACCEPTED") {
    return {
      code: "ON_HAND",
      title: "Mark on hand",
      instruction:
        "Accepted – awaiting arrival. Enter arrival date/time (required) and optional yard/track note. Only next action: Mark on hand.",
      actions: ["on-hand"],
    };
  }
  if (est === "AWAITING_APPROVAL") {
    return {
      code: "WAIT_OWNER",
      title: "Awaiting owner review",
      instruction:
        "Estimate is submitted. Wait for owner approval, rejection, or adjustment request.",
      actions: ["upload-document"],
    };
  }
  if (
    (ev === "ON_HAND" || ev === "IN_REPAIR") &&
    (!est ||
      est === "DRAFT" ||
      est === "QUEUED" ||
      est === "REVISION_REQUESTED" ||
      est === "ADJUSTMENT_FOR_APPROVAL")
  ) {
    const resubmit =
      est === "REVISION_REQUESTED" || est === "ADJUSTMENT_FOR_APPROVAL";
    return {
      code: "ESTIMATE",
      title: resubmit ? "Resubmit estimate" : "Submit estimate",
      instruction: resubmit
        ? "Address owner line comments, then upload a 500-byte estimate (and photos/docs) and submit."
        : "Upload a 500-byte estimate (and photos/docs), validate, then submit. Draft = loaded not submitted.",
      actions: ["upload-estimate", "pod", "upload-document"],
    };
  }
  if ((est === "APPROVED" || ev === "IN_REPAIR") && !opts.completed) {
    return {
      code: "REPAIR",
      title: "POD / repair / complete",
      instruction:
        "After approval: set POD, repair start, and completed date. Then upload the final invoice.",
      actions: ["pod", "complete", "invoice", "upload-document"],
    };
  }
  if (invWf === "REJECTED") {
    return {
      code: "INVOICE_RETRY",
      title: "Invoice rejected — resubmit",
      instruction:
        "Owner rejected the invoice. Upload a corrected 500-byte + invoice PDF with invoice number.",
      actions: ["invoice", "upload-document"],
    };
  }
  if (invWf === "INVOICE_SUBMITTED" || invWf === "UNDER_OWNER_REVIEW") {
    return {
      code: "INVOICE_REVIEW",
      title: "Invoice under owner review",
      instruction:
        "Invoice is submitted. Owner reviews in Estimate Review (read-only). Closed requires an accepted invoice.",
      actions: ["upload-document"],
    };
  }
  if (invWf === "ACCEPTED") {
    return {
      code: "AWAIT_CLOSE",
      title: "Invoice accepted — awaiting close",
      instruction: "Invoice accepted. Owner may close the bad order.",
      actions: ["upload-document"],
    };
  }
  if (opts.completed || ev === "COMPLETE" || ev === "READY_TO_CLOSE") {
    return {
      code: "INVOICE",
      title: "Upload invoice",
      instruction:
        "Upload final invoice 500-byte + invoice PDF. Invoice number required. Totals must match the approved estimate (tolerance placeholder).",
      actions: ["invoice", "upload-document"],
    };
  }
  return {
    code: "CONTINUE",
    title: "Continue work",
    instruction: "Use the actions below for the current status.",
    actions: ["upload-estimate", "pod", "upload-document"],
  };
}

/** Issue one SHOP link per BO+shop mark; reuse active link id (token only on first issue / force). */
export async function ensureShopBoLink(opts: {
  eventId: string;
  shopMark: string;
  actor?: string;
  tenantId?: string;
  /** When true, revoke active and mint a new token (e.g. lost link). */
  forceNew?: boolean;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const mark = opts.shopMark.trim().toUpperCase();
  const { rows: existing } = await q(
    `SELECT id, issued_at, party_ref
     FROM repair.event_links
     WHERE event_id = $1 AND tenant_id = $2 AND scope = 'SHOP'
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
       AND (party_ref IS NULL OR upper(party_ref) = $3)
     ORDER BY issued_at ASC
     LIMIT 1`,
    [opts.eventId, tenantId, mark],
  );
  if (existing[0] && !opts.forceNew) {
    return {
      ok: true as const,
      reused: true as const,
      linkId: String(existing[0].id),
      token: null as string | null,
      path: null as string | null,
    };
  }
  if (existing[0] && opts.forceNew) {
    await revokeEventLink({
      linkId: String(existing[0].id),
      actor: opts.actor,
      tenantId,
    });
  }
  const issued = await issueEventLink({
    tenantId,
    eventId: opts.eventId,
    scope: "SHOP",
    partyRef: mark,
    actor: opts.actor ?? "system",
    expiresAt: null,
  });
  return {
    ok: true as const,
    reused: false as const,
    linkId: String(issued.link.id),
    token: issued.token,
    path: `/repair/e/${issued.token}`,
  };
}

/** Revoke active SHOP links when BO closes. */
export async function revokeShopLinksOnClose(opts: {
  eventId: string;
  actor?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.event_links
     SET revoked_at = now(), revoked_by = $3
     WHERE event_id = $1 AND tenant_id = $2 AND scope = 'SHOP'
       AND revoked_at IS NULL
     RETURNING id`,
    [opts.eventId, tenantId, opts.actor ?? "system"],
  );
  for (const r of rows) {
    await writeAudit({
      tenantId,
      entity: "event_link",
      entityId: String(r.id),
      action: "LINK_REVOKED",
      after: { reason: "bo_closed" },
      actor: opts.actor ?? "system",
      via: "system",
    });
  }
  return rows.length;
}
