/**
 * Shop invoice upload on event link.
 * Match = invoice total vs approved final estimate TOTAL.
 * Mismatches flagged for review.
 * Optional OTP per shop (shops.settings.otpSteps.invoice_submit; default off).
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { resolveActiveLink } from "./event-links";
import { requireVcfCar } from "./vcf";
import { getStorageProvider } from "../providers/storage";
import { notify } from "./notifications";
import { isOtpRequired, verifyStepOtp } from "./otp";
import { maybeMarkReadyToClose } from "./close";
import { centsToDollars, dollarsToCents, formatDollars } from "./money";

async function approvedFinalEstimateTotal(
  eventId: string,
  tenantId: string,
): Promise<{ total: number; estimateId: string; revisionId: string } | null> {
  const { rows } = await q(
    `SELECT e.id AS estimate_id, r.id AS revision_id, r.total
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     JOIN repair.estimate_revisions r
       ON r.estimate_id = e.id AND r.rev_no = e.current_revision
     WHERE e.event_id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL
       AND s.code IN ('APPROVED','COMPLETED')
     ORDER BY e.created_at ASC
     LIMIT 1`,
    [eventId, tenantId],
  );
  if (!rows[0]) return null;
  return {
    total: Number(rows[0].total),
    estimateId: String(rows[0].estimate_id),
    revisionId: String(rows[0].revision_id),
  };
}

export async function submitShopInvoice(opts: {
  rawToken: string;
  invoiceNo: string;
  total: number;
  actorEmail: string;
  otpCode?: string;
  file?: { filename: string; mime: string; bytes: Buffer };
}) {
  const resolved = await resolveActiveLink(opts.rawToken, "SHOP");
  if (!resolved) return { ok: false as const, status: 401, error: "Invalid or revoked link" };

  const event = resolved.event;
  const tenantId = String(event.tenant_id ?? DEFAULT_TENANT_ID);
  const eventId = String(event.id);

  const vcf = await requireVcfCar(String(event.car_mark), String(event.car_number));
  if (!vcf.ok) return { ok: false as const, status: 422, error: vcf.reason };

  if (!opts.invoiceNo?.trim()) {
    return { ok: false as const, status: 400, error: "invoiceNo required" };
  }
  if (!Number.isFinite(opts.total) || opts.total < 0) {
    return { ok: false as const, status: 400, error: "total must be a non-negative number" };
  }
  if (!opts.file?.bytes?.length) {
    return { ok: false as const, status: 400, error: "Invoice PDF/file required" };
  }

  const shopId = event.shop_id ? String(event.shop_id) : null;
  const otpNeeded = await isOtpRequired("invoice_submit", { shopId, eventId, tenantId });
  if (otpNeeded) {
    if (!opts.otpCode) {
      return {
        ok: false as const,
        status: 403,
        error: "One-time code required for invoice submit (request OTP first)",
        otpRequired: true as const,
      };
    }
    const verified = await verifyStepOtp({
      eventId,
      step: "invoice_submit",
      email: opts.actorEmail,
      code: opts.otpCode,
      tenantId,
    });
    if (!verified.ok) {
      return { ok: false as const, status: verified.status, error: verified.error };
    }
  }

  const approved = await approvedFinalEstimateTotal(eventId, tenantId);
  if (!approved) {
    return {
      ok: false as const,
      status: 409,
      error: "No approved/completed estimate total to match against",
    };
  }

  const invoiceCents = dollarsToCents(opts.total);
  const estimateCents = dollarsToCents(approved.total);
  const invoiceTotal = centsToDollars(invoiceCents);
  const estimateTotal = centsToDollars(estimateCents);
  const matched = invoiceCents === estimateCents;
  const matchStatus = matched ? "MATCHED" : "MISMATCH";

  const stored = await getStorageProvider().put({
    tenantId,
    kind: "invoice",
    filename: opts.file.filename,
    mime: opts.file.mime || "application/pdf",
    bytes: opts.file.bytes,
  });

  const { rows: docs } = await q(
    `INSERT INTO repair.documents
       (tenant_id, event_id, kind, storage_key, sha256, size, mime,
        uploaded_by, created_by, original_filename)
     VALUES ($1,$2,'invoice',$3,$4,$5,$6,$7,$7,$8)
     RETURNING *`,
    [
      tenantId,
      eventId,
      stored.storageKey,
      stored.sha256,
      stored.size,
      stored.mime,
      opts.actorEmail,
      opts.file.filename,
    ],
  );

  const entityCode =
    event.entity_code != null
      ? String(event.entity_code)
      : (
          await q(
            `SELECT entity_code FROM repair.estimates
             WHERE event_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
             ORDER BY created_at ASC LIMIT 1`,
            [eventId, tenantId],
          )
        ).rows[0]?.entity_code ?? null;

  const { rows } = await q(
    `INSERT INTO repair.invoices
       (tenant_id, event_id, shop_id, invoice_no, total, estimate_total,
        document_id, match_status, mismatch_flagged, submitted_by_email, created_by,
        entity_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11)
     RETURNING *`,
    [
      tenantId,
      eventId,
      event.shop_id ?? null,
      opts.invoiceNo.trim(),
      invoiceTotal,
      estimateTotal,
      docs[0].id,
      matchStatus,
      !matched,
      opts.actorEmail,
      entityCode,
    ],
  );

  await writeAudit({
    tenantId,
    entity: "invoice",
    entityId: rows[0].id,
    action: matched ? "INVOICE_MATCHED" : "INVOICE_MISMATCH",
    after: {
      invoiceNo: opts.invoiceNo.trim(),
      total: invoiceTotal,
      estimateTotal,
      matchStatus,
    },
    actor: opts.actorEmail,
    via: "event_link",
  });

  await notify({
    tenantId,
    eventId,
    type: "INVOICE_LOADED",
    subject: matched
      ? `Invoice matched — ${event.car_mark} ${event.car_number}`
      : `Invoice MISMATCH — ${event.car_mark} ${event.car_number}`,
    bodyText: [
      `Invoice ${opts.invoiceNo.trim()} for ${event.car_mark} ${event.car_number}`,
      `Shop invoice total: ${formatDollars(invoiceTotal)}`,
      `Approved final estimate total: ${formatDollars(estimateTotal)}`,
      `Match status: ${matchStatus}`,
      matched ? "" : "Flagged for review — totals do not match.",
      "Invoice PDF attached (storage key only in log).",
    ]
      .filter(Boolean)
      .join("\n"),
    attachments: [
      {
        filename: opts.file.filename,
        contentType: stored.mime,
        storageKey: stored.storageKey,
        size: stored.size,
      },
    ],
    actor: opts.actorEmail,
  });

  let readyToClose: Awaited<ReturnType<typeof maybeMarkReadyToClose>> | null = null;
  if (matched) {
    readyToClose = await maybeMarkReadyToClose({
      eventId,
      tenantId,
      actor: opts.actorEmail,
    });
  }

  return {
    ok: true as const,
    invoice: rows[0],
    document: docs[0],
    matchStatus,
    mismatchFlagged: !matched,
    otpUsed: otpNeeded,
    readyToClose,
  };
}

export async function listInvoicesForEvent(eventId: string, tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT * FROM repair.invoices
     WHERE event_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [eventId, tenantId],
  );
  return rows;
}

export async function approveInvoiceMatch(opts: {
  invoiceId: string;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.invoices
     SET match_status = 'APPROVED', approved_by = $1, approved_at = now()
     WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
     RETURNING *`,
    [opts.actor, opts.invoiceId, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Invoice not found" };
  await writeAudit({
    tenantId,
    entity: "invoice",
    entityId: opts.invoiceId,
    action: "INVOICE_APPROVED",
    after: { match_status: "APPROVED" },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, invoice: rows[0] };
}
