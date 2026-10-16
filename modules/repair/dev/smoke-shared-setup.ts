/**
 * Shared smoke helpers for older lifecycle smokes (pod / RTC / monthly / inbound).
 *
 * Current validation requires yard_arrived_at before QUEUED → AWAITING_APPROVAL.
 * shopOnHand alone does not set yard arrival — callers must use ensureYardArrival
 * (or shopArrivalDate) before submitForApproval.
 *
 * submitShopInvoice also requires a companion 500-byte AAR file (aarFile).
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { shopArrivalDate } from "../services/bo-lifecycle";
import {
  approveEstimate,
  submitForApproval,
  uploadEstimate,
  type EstimateLineInput,
} from "../services/estimates";
import { q } from "../db";

const SAMPLE_AAR_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "reference/Sample_Shop_500byte_OFOX2609.txt",
);

/** Companion 500-byte invoice file required by submitShopInvoice. */
export function sampleAarInvoiceFile(filename = "inv.dat") {
  return {
    filename,
    mime: "text/plain",
    bytes: readFileSync(SAMPLE_AAR_PATH),
  };
}

/** Clear per-shop invoice OTP so older smokes are not poisoned by prior runs. */
export async function ensureInvoiceOtpOff(shopId: string): Promise<void> {
  const { setShopOtpStepFlag } = await import("../services/otp");
  await setShopOtpStepFlag({
    shopId,
    step: "invoice_submit",
    enabled: false,
  });
}

/** Valid manual line under current job-code validation (not DUMMY). */
export const VALID_SMOKE_LINE: EstimateLineInput = {
  lineNo: 1,
  aarJobCode: "4800",
  labor: 100,
  material: 50,
  total: 150,
  respCode: "1",
};

export async function ensureYardArrival(opts: {
  eventId: string;
  rawToken: string;
  actorEmail: string;
  arrivalIso?: string;
}): Promise<void> {
  const arrivalIso = opts.arrivalIso ?? "2026-10-01T12:00:00.000Z";
  const viaApi = await shopArrivalDate(
    opts.rawToken,
    opts.actorEmail,
    arrivalIso,
  );
  if (viaApi.ok) return;

  // Fallback: event may already be ON_HAND via shopOnHand without BO status sync.
  await q(
    `UPDATE repair.events
     SET yard_arrived_at = coalesce(yard_arrived_at, $2::timestamptz),
         yard_arrived_by = coalesce(yard_arrived_by, $3)
     WHERE id = $1::uuid`,
    [opts.eventId, arrivalIso, opts.actorEmail],
  );
  await q(
    `UPDATE repair.bad_orders
     SET arrival_date = coalesce(arrival_date, $2::date)
     WHERE event_id = $1::uuid AND deleted_at IS NULL`,
    [opts.eventId, arrivalIso.slice(0, 10)],
  );
  const { rows } = await q(
    `SELECT yard_arrived_at FROM repair.events WHERE id = $1::uuid`,
    [opts.eventId],
  );
  if (!rows[0]?.yard_arrived_at) {
    throw new Error(
      `ensureYardArrival failed for ${opts.eventId}: ${JSON.stringify(viaApi)}`,
    );
  }
}

/**
 * Upload a valid estimate, log submitForApproval, and approve.
 * Throws if submit or approve fails (does not swallow yard-gate errors).
 */
export async function uploadSubmitAndApprove(opts: {
  eventId: string;
  rawToken: string;
  actorEmail?: string;
  reviewer?: string;
  lines?: EstimateLineInput[];
  file?: {
    filename: string;
    mime: string;
    bytes: Buffer;
  };
  arrivalIso?: string;
}): Promise<{ estimateId: string; revisionId?: string }> {
  const actorEmail = opts.actorEmail ?? "shop@smoke.invalid";
  const reviewer = opts.reviewer ?? "reviewer@smoke";

  await ensureYardArrival({
    eventId: opts.eventId,
    rawToken: opts.rawToken,
    actorEmail,
    arrivalIso: opts.arrivalIso,
  });

  const est = await uploadEstimate({
    rawToken: opts.rawToken,
    actorName: "shop",
    actorEmail,
    via: "event_link",
    file: opts.file,
    lines: opts.file ? undefined : (opts.lines ?? [VALID_SMOKE_LINE]),
  });
  if (!est.ok) {
    throw new Error(`uploadEstimate failed: ${JSON.stringify(est)}`);
  }
  const estimateId = String(est.estimate.id);
  const revisionId = est.revision?.id != null ? String(est.revision.id) : undefined;

  const sub = await submitForApproval({ estimateId, actor: reviewer });
  console.log("submitForApproval →", JSON.stringify(sub));
  if (!sub.ok) {
    throw new Error(`submitForApproval failed: ${JSON.stringify(sub)}`);
  }

  const appr = await approveEstimate({ estimateId, actor: reviewer });
  if (!appr.ok) {
    throw new Error(`approveEstimate failed: ${JSON.stringify(appr)}`);
  }

  return { estimateId, revisionId };
}
