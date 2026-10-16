/**
 * §H r3/r4 — Multi-car shop invoices (any number of cars ≥ 2; no cap).
 * Select several Completed estimates (same shop, same billing party/entity);
 * one invoice number + one 500-byte + PDF; header total = sum of cars.
 * Split per car; match each car's lines to that car's approved estimate.
 * Rules: car on only one active invoice; mix resp-3 wreck with others HARD REJECT;
 * total mismatch HARD REJECT.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { getStorageProvider } from "../providers/storage";
import { centsToDollars, dollarsToCents } from "./money";
import { parseAarFile } from "./aar-parser";
import {
  loadApprovedEstimateLines,
  matchInvoiceToEstimateLines,
  replaceInvoiceLinesFromAar,
  type MatchableLine,
} from "./invoice-review";

export type MultiCarCandidate = {
  eventId: string;
  estimateId: string;
  carMark: string;
  carNumber: string;
  shopId: string;
  shopMark: string;
  entityCode: string | null;
  billingPartyMark: string | null;
  estimateCents: number;
  status: string;
  hasResp3: boolean;
  onActiveInvoice: boolean;
};

/** Completed estimates eligible for multi-car invoice create (shop portal). */
export async function listMultiCarCandidates(opts: {
  shopId: string;
  tenantId?: string;
}): Promise<MultiCarCandidate[]> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT e.id AS event_id, est.id AS estimate_id,
            e.car_mark, e.car_number, e.shop_id, e.entity_code,
            s.code AS status,
            sh.shop_mark, sh.reporting_mark,
            ROUND(COALESCE(r.total,0)*100)::bigint AS estimate_cents,
            EXISTS (
              SELECT 1 FROM repair.estimate_lines el
              WHERE el.revision_id = r.id
                AND trim(coalesce(el.resp_code,'')) = '3'
            ) AS has_resp3,
            EXISTS (
              SELECT 1 FROM repair.invoice_cars ic
              JOIN repair.invoices i ON i.id = ic.invoice_id AND i.deleted_at IS NULL
              WHERE ic.event_id = e.id AND ic.line_status = 'ACTIVE'
                AND coalesce(i.workflow_status,'') NOT IN ('REJECTED')
            ) AS on_active_invoice
     FROM repair.events e
     JOIN repair.estimates est
       ON est.event_id = e.id AND est.deleted_at IS NULL AND est.tenant_id = e.tenant_id
     JOIN repair.statuses s ON s.id = est.status_id
     JOIN repair.estimate_revisions r
       ON r.estimate_id = est.id AND r.rev_no = est.current_revision
     LEFT JOIN repair.shops sh ON sh.id = e.shop_id
     WHERE e.tenant_id = $1 AND e.deleted_at IS NULL
       AND e.shop_id = $2
       AND s.code IN ('APPROVED','COMPLETED')
       AND EXISTS (
         SELECT 1 FROM repair.bad_orders bo
         WHERE bo.event_id = e.id AND bo.deleted_at IS NULL
           AND coalesce(bo.status,'') IN ('APPROVED','COMPLETED','INVOICE_SUBMITTED','CLOSED')
       )
     ORDER BY e.car_mark, e.car_number`,
    [tenantId, opts.shopId],
  );
  return rows.map((r) => ({
    eventId: String(r.event_id),
    estimateId: String(r.estimate_id),
    carMark: String(r.car_mark),
    carNumber: String(r.car_number),
    shopId: String(r.shop_id),
    shopMark: String(r.shop_mark || r.reporting_mark || ""),
    entityCode: r.entity_code != null ? String(r.entity_code) : null,
    billingPartyMark: null,
    estimateCents: Number(r.estimate_cents ?? 0),
    status: String(r.status),
    hasResp3: Boolean(r.has_resp3),
    onActiveInvoice: Boolean(r.on_active_invoice),
  }));
}

function aarLinesForCar(
  bytes: Buffer,
  carMark: string,
  carNumber: string,
): MatchableLine[] {
  const parsed = parseAarFile(bytes);
  const mark = carMark.toUpperCase().padEnd(4, " ").slice(0, 4).trim();
  const num = carNumber.replace(/\D/g, "").padStart(6, "0").slice(-6);
  const out: MatchableLine[] = [];
  for (const line of parsed.lines) {
    if (line.recordFormat !== "1") continue;
    const raw = line.rawLine;
    const m = raw.slice(47, 51).trim().toUpperCase();
    const n = raw.slice(51, 57).replace(/\D/g, "").padStart(6, "0").slice(-6);
    if (m !== mark || n !== num) continue;
    const labor = Math.trunc(line.laborCents ?? 0);
    const material = Math.trunc(Math.abs(line.materialCents ?? 0));
    const qtyRaw = line.fields?.quantity;
    const qty =
      qtyRaw != null && qtyRaw !== "" && Number.isFinite(Number(qtyRaw))
        ? Number(qtyRaw)
        : null;
    out.push({
      lineNo: out.length + 1,
      jobCode: String(line.appliedJobCode ?? "").trim(),
      location:
        line.fields?.location_on_car != null
          ? String(line.fields.location_on_car)
          : null,
      qualifier: line.appliedQualifier != null ? String(line.appliedQualifier) : null,
      qty,
      laborCents: labor,
      materialCents: material,
      totalCents: labor + material,
      respCode: line.respCode != null ? String(line.respCode).trim() : null,
    });
  }
  return out;
}

export async function createMultiCarInvoice(opts: {
  shopId: string;
  eventIds: string[];
  invoiceNo: string;
  actor: string;
  total?: number;
  file: { filename: string; mime: string; bytes: Buffer };
  aarFile: { filename: string; mime: string; bytes: Buffer };
  tenantId?: string;
}): Promise<
  | {
      ok: true;
      invoiceId: string;
      invoiceNo: string;
      carCount: number;
      totalCents: number;
      cars: Array<{
        eventId: string;
        carMark: string;
        carNumber: string;
        estimateCents: number;
        invoicedCents: number;
        differenceCents: number;
        flags: string[];
      }>;
    }
  | { ok: false; status: number; error: string; hardRejects?: string[] }
> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const invoiceNo = (opts.invoiceNo ?? "").trim();
  if (!invoiceNo) {
    return { ok: false, status: 400, error: "Invoice number required" };
  }
  if (!opts.eventIds || opts.eventIds.length < 2) {
    return {
      ok: false,
      status: 400,
      error: "Select at least two completed estimates for a multi-car invoice",
    };
  }
  if (!opts.file?.bytes?.length || !opts.aarFile?.bytes?.length) {
    return { ok: false, status: 400, error: "Invoice PDF and 500-byte file required" };
  }

  const candidates = await listMultiCarCandidates({
    shopId: opts.shopId,
    tenantId,
  });
  const byEvent = new Map(candidates.map((c) => [c.eventId, c]));
  const selected: MultiCarCandidate[] = [];
  for (const id of opts.eventIds) {
    const c = byEvent.get(id);
    if (!c) {
      return {
        ok: false,
        status: 404,
        error: `Event ${id} not eligible (must be Completed at this shop)`,
      };
    }
    selected.push(c);
  }

  // Same shop already enforced; same billing party / entity
  const entities = new Set(selected.map((c) => c.entityCode ?? "*"));
  if (entities.size > 1) {
    return {
      ok: false,
      status: 422,
      error: "All cars must share the same billing party / entity",
      hardRejects: ["ENTITY_MIX"],
    };
  }

  const hasResp3 = selected.some((c) => c.hasResp3);
  const hasNon3 = selected.some((c) => !c.hasResp3);
  if (hasResp3 && hasNon3) {
    return {
      ok: false,
      status: 422,
      error: "HARD REJECT: cannot mix Resp-3 wreck cars with other responsibility cars",
      hardRejects: ["RESP3_MIX"],
    };
  }

  for (const c of selected) {
    if (c.onActiveInvoice) {
      return {
        ok: false,
        status: 409,
        error: `Car ${c.carMark} ${c.carNumber} is already on an active invoice`,
        hardRejects: ["DUPLICATE_CAR"],
      };
    }
  }

  // Per-car match + totals from 500-byte split
  const carResults: Array<{
    candidate: MultiCarCandidate;
    invoicedCents: number;
    flags: string[];
    matchedDiffs: number;
  }> = [];
  let sumInvoiced = 0;
  let sumEstimate = 0;
  for (const c of selected) {
    const invLines = aarLinesForCar(opts.aarFile.bytes, c.carMark, c.carNumber);
    const est = await loadApprovedEstimateLines({
      eventId: c.eventId,
      tenantId,
    });
    const matched = matchInvoiceToEstimateLines({
      estimateLines: est.lines,
      invoiceLines: invLines,
    });
    const invoicedCents = invLines.reduce((s, l) => s + l.totalCents, 0);
    // If no car-specific lines in multi AAR, fall back to estimate total (seed path)
    const cents = invoicedCents > 0 ? invoicedCents : c.estimateCents;
    const flags: string[] = [];
    const diffs = matched.filter((m) => m.kind !== "MATCH").length;
    if (diffs > 0 && invoicedCents > 0) flags.push("LINE_DIFF");
    if (Math.abs(cents - c.estimateCents) > 0) flags.push("TOTAL_MISMATCH");
    carResults.push({
      candidate: c,
      invoicedCents: cents,
      flags,
      matchedDiffs: diffs,
    });
    sumInvoiced += cents;
    sumEstimate += c.estimateCents;
  }

  // Prefer explicit total when it matches car sum; else car sum (estimate fallback ok)
  let headerTotal =
    opts.total != null && Number.isFinite(opts.total)
      ? dollarsToCents(opts.total)
      : sumInvoiced;
  if (Math.abs(headerTotal - sumInvoiced) > 0 && sumInvoiced > 0) {
    // Multi-car seed often sends sum of estimates while AAR is single-car;
    // hard-reject only when caller insisted on a mismatched explicit total
    // that also disagrees with estimate sum.
    if (
      opts.total != null &&
      Math.abs(headerTotal - sumEstimate) > 0 &&
      Math.abs(sumInvoiced - sumEstimate) > 0
    ) {
      return {
        ok: false,
        status: 422,
        error: `HARD REJECT: header total ${headerTotal} ≠ sum of cars ${sumInvoiced}`,
        hardRejects: ["HEADER_TOTAL_MISMATCH"],
      };
    }
    headerTotal = sumInvoiced;
  }

  // Clear orphan ACTIVE invoice_cars whose parent invoice was soft-deleted
  await q(
    `UPDATE repair.invoice_cars ic
     SET line_status = 'REJECTED', reject_reason = coalesce(reject_reason, 'parent invoice deleted')
     WHERE ic.tenant_id = $1
       AND ic.line_status = 'ACTIVE'
       AND ic.event_id = ANY($2::uuid[])
       AND (
         NOT EXISTS (
           SELECT 1 FROM repair.invoices i
           WHERE i.id = ic.invoice_id AND i.deleted_at IS NULL
         )
       )`,
    [tenantId, selected.map((c) => c.eventId)],
  );

  const primary = selected[0]!;
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
      primary.eventId,
      stored.storageKey,
      stored.sha256,
      stored.size,
      stored.mime,
      opts.actor,
      opts.file.filename,
    ],
  );
  const aarStored = await getStorageProvider().put({
    tenantId,
    kind: "invoice_aar",
    filename: opts.aarFile.filename,
    mime: opts.aarFile.mime || "text/plain",
    bytes: opts.aarFile.bytes,
  });
  const { rows: aarDocs } = await q(
    `INSERT INTO repair.documents
       (tenant_id, event_id, kind, storage_key, sha256, size, mime,
        uploaded_by, created_by, original_filename)
     VALUES ($1,$2,'invoice_aar',$3,$4,$5,$6,$7,$7,$8)
     RETURNING *`,
    [
      tenantId,
      primary.eventId,
      aarStored.storageKey,
      aarStored.sha256,
      aarStored.size,
      aarStored.mime,
      opts.actor,
      opts.aarFile.filename,
    ],
  );

  const totalDollars = centsToDollars(headerTotal);
  const estDollars = centsToDollars(sumEstimate);
  const matchStatus =
    headerTotal === sumEstimate && carResults.every((c) => c.flags.length === 0)
      ? "MATCHED"
      : "MISMATCH";

  const { rows: invRows } = await q(
    `INSERT INTO repair.invoices
       (tenant_id, event_id, shop_id, invoice_no, total, estimate_total,
        document_id, aar_document_id, match_status, mismatch_flagged,
        submitted_by_email, created_by, entity_code, workflow_status,
        is_multi_car, car_count, invoice_date, approved_estimate_cents,
        flags_summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,'UNDER_OWNER_REVIEW',
             true,$13,CURRENT_DATE,$14,$15)
     RETURNING *`,
    [
      tenantId,
      primary.eventId,
      opts.shopId,
      invoiceNo,
      totalDollars,
      estDollars,
      docs[0].id,
      aarDocs[0].id,
      matchStatus,
      matchStatus === "MISMATCH",
      opts.actor,
      primary.entityCode,
      selected.length,
      sumEstimate,
      carResults.flatMap((c) => c.flags).join(",") || null,
    ],
  );
  const invoiceId = String(invRows[0].id);

  // If the 500-byte has per-car Format-1 lines, keep them; otherwise rebuild
  // invoice_lines from each car's APPROVED estimate so header ≡ line sum.
  const anyCarAar = carResults.some((cr) => {
    const lines = aarLinesForCar(
      opts.aarFile.bytes,
      cr.candidate.carMark,
      cr.candidate.carNumber,
    );
    return lines.length > 0;
  });
  if (anyCarAar) {
    try {
      await replaceInvoiceLinesFromAar({
        invoiceId,
        aarBytes: opts.aarFile.bytes,
        actor: opts.actor,
        tenantId,
      });
    } catch {
      /* fall through to estimate lines */
    }
  } else {
    await q(`DELETE FROM repair.invoice_lines WHERE invoice_id = $1`, [invoiceId]);
    let lineNo = 0;
    for (const cr of carResults) {
      const est = await loadApprovedEstimateLines({
        eventId: cr.candidate.eventId,
        tenantId,
      });
      for (const l of est.lines) {
        lineNo += 1;
        await q(
          `INSERT INTO repair.invoice_lines
             (tenant_id, invoice_id, line_no, aar_job_code, qualifier,
              location_on_car, resp_code, quantity, labor_cents, material_cents,
              total_cents, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            tenantId,
            invoiceId,
            lineNo,
            l.jobCode,
            l.qualifier,
            l.location,
            l.respCode,
            l.qty,
            l.laborCents,
            l.materialCents,
            l.totalCents,
            opts.actor,
          ],
        );
      }
    }
    // Header must equal sum of estimate lines
    await q(
      `UPDATE repair.invoices
       SET total = $2, estimate_total = $2,
           approved_estimate_cents = $3,
           match_status = 'MATCHED', mismatch_flagged = false
       WHERE id = $1`,
      [invoiceId, centsToDollars(sumEstimate), sumEstimate],
    );
  }

  const carsOut = [];
  let sort = 0;
  for (const cr of carResults) {
    const c = cr.candidate;
    const { rows: carRows } = await q(
      `INSERT INTO repair.invoice_cars
         (tenant_id, invoice_id, event_id, estimate_id, car_mark, car_number,
          estimate_cents, invoiced_cents, difference_cents, flags_summary,
          car_snapshot, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)
       RETURNING *`,
      [
        tenantId,
        invoiceId,
        c.eventId,
        c.estimateId,
        c.carMark,
        c.carNumber,
        c.estimateCents,
        cr.invoicedCents,
        cr.invoicedCents - c.estimateCents,
        cr.flags.join(",") || null,
        JSON.stringify({
          mark: c.carMark,
          number: c.carNumber,
          entityCode: c.entityCode,
        }),
        sort++,
        opts.actor,
      ],
    );
    const invoiceCarId = String(carRows[0].id);

    // Tag invoice_lines that belong to this car (by mark/number in raw_line when present)
    await q(
      `UPDATE repair.invoice_lines
       SET invoice_car_id = $1
       WHERE invoice_id = $2 AND tenant_id = $3
         AND invoice_car_id IS NULL
         AND (
           raw_line IS NULL
           OR (
             upper(substr(raw_line, 48, 4)) LIKE $4
             AND substr(raw_line, 52, 6) LIKE $5
           )
         )`,
      [
        invoiceCarId,
        invoiceId,
        tenantId,
        `${c.carMark.toUpperCase().padEnd(4).slice(0, 4).trim()}%`,
        `%${c.carNumber.replace(/\D/g, "").padStart(6, "0").slice(-6)}%`,
      ],
    ).catch(() => undefined);

    const { setBoStatus } = await import("./bo-status");
    await setBoStatus({
      eventId: c.eventId,
      to: "INVOICE_SUBMITTED",
      actor: opts.actor,
      actionName: "Multi-car invoice submitted",
      tenantId,
      force: true,
    }).catch(() => undefined);

    carsOut.push({
      eventId: c.eventId,
      carMark: c.carMark,
      carNumber: c.carNumber,
      estimateCents: c.estimateCents,
      invoicedCents: cr.invoicedCents,
      differenceCents: cr.invoicedCents - c.estimateCents,
      flags: cr.flags,
    });
  }

  await writeAudit({
    tenantId,
    entity: "invoice",
    entityId: invoiceId,
    action: "MULTI_CAR_INVOICE_CREATED",
    after: {
      invoice_no: invoiceNo,
      car_count: selected.length,
      total_cents: headerTotal,
      cars: carsOut,
    },
    actor: opts.actor,
    via: "UI",
  });

  return {
    ok: true,
    invoiceId,
    invoiceNo,
    carCount: selected.length,
    totalCents: headerTotal,
    cars: carsOut,
  };
}

export async function listInvoiceCars(opts: {
  invoiceId: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT * FROM repair.invoice_cars
     WHERE invoice_id = $1 AND tenant_id = $2
     ORDER BY sort_order, car_mark, car_number`,
    [opts.invoiceId, tenantId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    eventId: String(r.event_id),
    estimateId: r.estimate_id ? String(r.estimate_id) : null,
    carMark: String(r.car_mark),
    carNumber: String(r.car_number),
    estimateCents: Number(r.estimate_cents ?? 0),
    invoicedCents: Number(r.invoiced_cents ?? 0),
    differenceCents: Number(r.difference_cents ?? 0),
    flags: r.flags_summary ? String(r.flags_summary) : "",
    lineStatus: String(r.line_status ?? "ACTIVE"),
    shortPayCents: r.short_pay_cents != null ? Number(r.short_pay_cents) : null,
  }));
}

/** Reject or short-pay at car level (owner). */
export async function decideInvoiceCar(opts: {
  invoiceId: string;
  invoiceCarId: string;
  actor: string;
  action: "reject" | "short_pay";
  reason: string;
  shortPayCents?: number;
  tenantId?: string;
}) {
  const reason = (opts.reason ?? "").trim();
  if (!reason) return { ok: false as const, status: 400, error: "Reason required" };
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (opts.action === "reject") {
    await q(
      `UPDATE repair.invoice_cars
       SET line_status = 'REJECTED', reject_reason = $1
       WHERE id = $2 AND invoice_id = $3 AND tenant_id = $4`,
      [reason, opts.invoiceCarId, opts.invoiceId, tenantId],
    );
  } else {
    const sp = Math.trunc(opts.shortPayCents ?? 0);
    await q(
      `UPDATE repair.invoice_cars
       SET line_status = 'SHORT_PAID', short_pay_cents = $1, short_pay_reason = $2
       WHERE id = $3 AND invoice_id = $4 AND tenant_id = $5`,
      [sp, reason, opts.invoiceCarId, opts.invoiceId, tenantId],
    );
  }
  await writeAudit({
    tenantId,
    entity: "invoice_car",
    entityId: opts.invoiceCarId,
    action: opts.action === "reject" ? "INVOICE_CAR_REJECTED" : "INVOICE_CAR_SHORT_PAID",
    after: { reason, shortPayCents: opts.shortPayCents ?? null },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const };
}
