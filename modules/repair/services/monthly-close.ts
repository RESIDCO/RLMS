/**
 * Monthly close: collect CLOSED events with lessee (Resp 6) responsibility,
 * bill only at close, generate local CRIPYYMM file, bulk lessee rebuttal invoices.
 * Append-only close_runs / billing_lines / rebuttal_invoices; locks events.
 * No FTP.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { DEFAULT_TENANT_ID, q, withTransaction } from "../db";
import { writeAudit } from "./audit";
import { buildCripFile, type CrbInvoiceInput } from "./crb-writer";
import { validateCripBytes } from "./crb-validate";

const LESSEE_RESP = "6";

export type CloseEligibleEvent = {
  eventId: string;
  estimateId: string;
  revisionId: string;
  carMark: string;
  carNumber: string;
  lesseeMark: string;
  lesseeEmail: string | null;
  laborCents: number;
  materialCents: number;
  lines: Array<{
    lineNo: number;
    respCode: string;
    laborCents: number;
    materialCents: number;
    rawLine: string | null;
    aarJobCode: string | null;
    qualifier: string | null;
    whyMade: string | null;
    conditionCode: string | null;
  }>;
};

async function tenantSettings(tenantId: string): Promise<Record<string, unknown>> {
  const { rows } = await q(`SELECT settings FROM repair.tenants WHERE id = $1`, [tenantId]);
  return (rows[0]?.settings as Record<string, unknown>) ?? {};
}

function yymmFromDate(d = new Date()): string {
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
}

function invoiceDateYymmdd(accountMonth: string): string {
  // Last calendar day of account month (UTC approx)
  const yy = 2000 + Number(accountMonth.slice(0, 2));
  const mm = Number(accountMonth.slice(2, 4));
  const last = new Date(Date.UTC(yy, mm, 0));
  const dd = String(last.getUTCDate()).padStart(2, "0");
  return `${accountMonth}${dd}`;
}

function dueDateYymmdd(accountMonth: string, termsDays: number): string {
  const yy = 2000 + Number(accountMonth.slice(0, 2));
  const mm = Number(accountMonth.slice(2, 4));
  const base = new Date(Date.UTC(yy, mm, 0)); // end of account month
  base.setUTCDate(base.getUTCDate() + termsDays);
  const y = String(base.getUTCFullYear()).slice(-2);
  const m = String(base.getUTCMonth() + 1).padStart(2, "0");
  const d = String(base.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** Ensure billing period row exists (open until close run freezes it). */
export async function ensureBillingPeriod(opts: {
  accountMonth: string;
  tenantId?: string;
  actor?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const month = opts.accountMonth.replace(/\D/g, "").slice(0, 4);
  if (!/^\d{4}$/.test(month)) {
    return { ok: false as const, status: 400, error: "accountMonth must be YYMM" };
  }
  const { rows } = await q(
    `INSERT INTO repair.billing_periods (tenant_id, account_month, status, created_by)
     VALUES ($1,$2,'open',$3)
     ON CONFLICT (tenant_id, account_month) DO UPDATE
       SET account_month = EXCLUDED.account_month
     RETURNING *`,
    [tenantId, month, opts.actor ?? "system"],
  );
  return { ok: true as const, period: rows[0] };
}

/**
 * CLOSED events with Resp 6 lines that are not yet billing-locked.
 */
export async function collectLesseeRebillEvents(opts: {
  accountMonth?: string;
  tenantId?: string;
}): Promise<CloseEligibleEvent[]> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  // Use the latest revision that still has line rows (approve / lessee history
  // revisions bump current_revision without copying lines).
  const { rows } = await q(
    `SELECT e.id AS event_id, e.car_mark, e.car_number,
            est.id AS estimate_id, rev.id AS revision_id,
            (
              SELECT c.party_ref FROM repair.contacts c
              WHERE c.tenant_id = e.tenant_id AND c.party_type = 'lessee'
                AND c.active AND c.deleted_at IS NULL
              ORDER BY c.created_at ASC LIMIT 1
            ) AS lessee_mark,
            (
              SELECT c.email FROM repair.contacts c
              WHERE c.tenant_id = e.tenant_id AND c.party_type = 'lessee'
                AND c.active AND c.deleted_at IS NULL AND c.email IS NOT NULL
              ORDER BY c.created_at ASC LIMIT 1
            ) AS lessee_email
     FROM repair.events e
     JOIN repair.statuses s ON s.id = e.status_id
     JOIN repair.estimates est
       ON est.event_id = e.id AND est.tenant_id = e.tenant_id AND est.deleted_at IS NULL
     JOIN LATERAL (
       SELECT r.id
       FROM repair.estimate_revisions r
       WHERE r.estimate_id = est.id
         AND EXISTS (
           SELECT 1 FROM repair.estimate_lines el
           WHERE el.revision_id = r.id AND el.resp_code = $2
         )
       ORDER BY r.rev_no DESC
       LIMIT 1
     ) rev ON true
     WHERE e.tenant_id = $1
       AND e.deleted_at IS NULL
       AND s.code = 'CLOSED'
       AND e.billing_locked_at IS NULL
     ORDER BY e.car_mark, e.car_number`,
    [tenantId, LESSEE_RESP],
  );

  const out: CloseEligibleEvent[] = [];
  for (const r of rows) {
    const { rows: lines } = await q(
      `SELECT line_no, resp_code, labor_cents, material_cents, labor, material,
              raw_line, aar_job_code, qualifier, why_made, condition_code
       FROM repair.estimate_lines
       WHERE revision_id = $1 AND resp_code = $2
       ORDER BY line_no ASC`,
      [r.revision_id, LESSEE_RESP],
    );
    let laborCents = 0;
    let materialCents = 0;
    const mapped = lines.map((l) => {
      const lc =
        l.labor_cents != null
          ? Number(l.labor_cents)
          : Math.round(Number(l.labor ?? 0) * 100);
      const mc =
        l.material_cents != null
          ? Number(l.material_cents)
          : Math.round(Number(l.material ?? 0) * 100);
      laborCents += lc;
      materialCents += mc;
      return {
        lineNo: Number(l.line_no),
        respCode: String(l.resp_code),
        laborCents: lc,
        materialCents: mc,
        rawLine: l.raw_line ? String(l.raw_line) : null,
        aarJobCode: l.aar_job_code ? String(l.aar_job_code) : null,
        qualifier: l.qualifier ? String(l.qualifier) : null,
        whyMade: l.why_made ? String(l.why_made) : null,
        conditionCode: l.condition_code ? String(l.condition_code) : null,
      };
    });
    out.push({
      eventId: String(r.event_id),
      estimateId: String(r.estimate_id),
      revisionId: String(r.revision_id),
      carMark: String(r.car_mark),
      carNumber: String(r.car_number),
      lesseeMark: String(r.lessee_mark ?? "LSEE").slice(0, 4).toUpperCase().padEnd(4, " "),
      lesseeEmail: r.lessee_email ? String(r.lessee_email) : null,
      laborCents,
      materialCents,
      lines: mapped,
    });
  }
  return out;
}

export async function runMonthlyClose(opts: {
  accountMonth?: string;
  tenantId?: string;
  actor: string;
  exportDir?: string;
  /** Dry-run: validate build but do not write DB locks / files */
  dryRun?: boolean;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const settings = await tenantSettings(tenantId);
  const accountMonth = (opts.accountMonth ?? yymmFromDate()).replace(/\D/g, "").slice(0, 4);
  if (!/^\d{4}$/.test(accountMonth)) {
    return { ok: false as const, status: 400, error: "accountMonth must be YYMM" };
  }

  const periodRes = await ensureBillingPeriod({
    accountMonth,
    tenantId,
    actor: opts.actor,
  });
  if (!periodRes.ok) return periodRes;
  if (periodRes.period.status === "closed" || periodRes.period.status === "frozen") {
    return {
      ok: false as const,
      status: 409,
      error: `Billing period ${accountMonth} is already ${periodRes.period.status}`,
    };
  }

  const events = await collectLesseeRebillEvents({ accountMonth, tenantId });
  if (!events.length) {
    return {
      ok: false as const,
      status: 404,
      error: "No CLOSED events with unlocked Resp 6 lines for this period",
    };
  }

  const billingParty = String(settings.crbBillingPartyMark ?? "OFOX");
  const currency = String(settings.crbCurrency ?? "U");
  const taxpayerId = String(settings.crbTaxpayerId ?? "");
  const paymentTerms = String(settings.crbPaymentTerms ?? "30");
  const termsDays = Number(paymentTerms) || 30;
  const invDate = invoiceDateYymmdd(accountMonth);
  const dueDate = dueDateYymmdd(accountMonth, termsDays);

  // Bulk rebuttal invoices: one per lessee mark
  const byLessee = new Map<string, CloseEligibleEvent[]>();
  for (const ev of events) {
    const key = ev.lesseeMark.trim().toUpperCase() || "LSEE";
    const list = byLessee.get(key) ?? [];
    list.push(ev);
    byLessee.set(key, list);
  }

  const invoices: CrbInvoiceInput[] = [];
  const rebuttalMeta: Array<{
    lesseeMark: string;
    lesseeEmail: string | null;
    invoiceNumber: string;
    eventIds: string[];
    laborCents: number;
    materialCents: number;
    detailCount: number;
  }> = [];

  let invSeq = 1;
  for (const [lesseeMark, group] of byLessee) {
    const invoiceNumber = `RB${accountMonth}${String(invSeq).padStart(4, "0")}`;
    invSeq++;
    let labor = 0;
    let material = 0;
    const details: CrbInvoiceInput["details"] = [];
    let lineNo = 1;
    for (const ev of group) {
      for (const ln of ev.lines) {
        details.push({
          rawLine: ln.rawLine,
          carInitial: ev.carMark,
          carNumber: ev.carNumber,
          repairDateYymmdd: invDate,
          repairingParty: billingParty,
          appliedJobCode: ln.aarJobCode ?? "0000",
          appliedQualifier: ln.qualifier ?? undefined,
          whyMade: ln.whyMade ?? undefined,
          conditionCode: ln.conditionCode ?? undefined,
          responsibilityCode: LESSEE_RESP,
          laborCents: ln.laborCents,
          materialCents: ln.materialCents,
          lineNumber: lineNo++,
          detailSource: "RE",
          description: `RESP6 REBILL ${ev.carMark} ${ev.carNumber}`.slice(0, 50),
        });
        labor += ln.laborCents;
        material += ln.materialCents;
      }
    }
    const email = group.find((g) => g.lesseeEmail)?.lesseeEmail ?? null;
    invoices.push({
      billedParty: lesseeMark,
      invoiceNumber,
      invoiceDateYymmdd: invDate,
      paymentDueYymmdd: dueDate,
      contact: {
        companyName: `Lessee ${lesseeMark.trim()}`,
        email: email ?? undefined,
        address1: "SEE CONTACT BANK",
        country: "US",
      },
      details,
    });
    rebuttalMeta.push({
      lesseeMark,
      lesseeEmail: email,
      invoiceNumber,
      eventIds: group.map((g) => g.eventId),
      laborCents: labor,
      materialCents: material,
      detailCount: details.length,
    });
  }

  const built = buildCripFile({
    billingParty,
    accountMonthYymm: accountMonth,
    currency,
    taxpayerId,
    paymentTerms,
    invoices,
  });
  const validation = validateCripBytes(built.bytes);
  if (!validation.ok) {
    return {
      ok: false as const,
      status: 422,
      error: "CRB validation failed",
      validation,
      filename: built.filename,
    };
  }

  const exportDir =
    opts.exportDir ??
    String(settings.crbExportDir ?? "modules/repair/dev/exports");
  const localPath = join(exportDir, built.filename);

  if (opts.dryRun) {
    return {
      ok: true as const,
      dryRun: true,
      accountMonth,
      eventCount: events.length,
      invoiceCount: invoices.length,
      filename: built.filename,
      validation,
      laborCents: built.laborCents,
      materialCents: built.materialCents,
    };
  }

  mkdirSync(exportDir, { recursive: true });
  writeFileSync(localPath, built.bytes);

  const result = await withTransaction(async (client) => {
    const run = await client.query(
      `INSERT INTO repair.close_runs
         (tenant_id, period_id, account_month, status, event_count, invoice_count,
          detail_count, labor_cents, material_cents, crb_filename, crb_sha256,
          crb_local_path, validation_ok, validation_errors, created_by)
       VALUES ($1,$2,$3,'COMPLETED',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
       RETURNING *`,
      [
        tenantId,
        periodRes.period.id,
        accountMonth,
        events.length,
        invoices.length,
        built.detailCount,
        built.laborCents,
        built.materialCents,
        built.filename,
        built.sha256,
        localPath,
        validation.ok,
        JSON.stringify(validation.errors),
        opts.actor,
      ],
    );
    const closeRun = run.rows[0];

    for (const ev of events) {
      await client.query(
        `INSERT INTO repair.close_run_events
           (tenant_id, close_run_id, event_id, estimate_id, revision_id,
            lessee_mark, lessee_email, labor_cents, material_cents, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          tenantId,
          closeRun.id,
          ev.eventId,
          ev.estimateId,
          ev.revisionId,
          ev.lesseeMark,
          ev.lesseeEmail,
          ev.laborCents,
          ev.materialCents,
          opts.actor,
        ],
      );
      await client.query(
        `UPDATE repair.events
         SET billing_locked_at = now(), billing_close_run_id = $1
         WHERE id = $2 AND tenant_id = $3 AND billing_locked_at IS NULL`,
        [closeRun.id, ev.eventId, tenantId],
      );
      for (const ln of ev.lines) {
        await client.query(
          `INSERT INTO repair.billing_lines
             (tenant_id, period_id, close_run_id, event_id, source, car_mark, car_number,
              resp_code, labor_cents, material_cents, total_cents, billed_party,
              invoice_number, raw_record, car_lease_snapshot, created_by)
           VALUES ($1,$2,$3,$4,'REBUTTAL',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)`,
          [
            tenantId,
            periodRes.period.id,
            closeRun.id,
            ev.eventId,
            ev.carMark,
            ev.carNumber,
            LESSEE_RESP,
            ln.laborCents,
            ln.materialCents,
            ln.laborCents + ln.materialCents,
            ev.lesseeMark,
            rebuttalMeta.find((m) => m.eventIds.includes(ev.eventId))?.invoiceNumber ??
              null,
            ln.rawLine,
            JSON.stringify({
              estimateId: ev.estimateId,
              revisionId: ev.revisionId,
              accountMonth,
            }),
            opts.actor,
          ],
        );
      }
    }

    for (const meta of rebuttalMeta) {
      await client.query(
        `INSERT INTO repair.rebuttal_invoices
           (tenant_id, period_id, close_run_id, lessee_mark, lessee_email,
            invoice_number, labor_cents, material_cents, total_cents,
            event_ids, detail_count, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[],$11,$12)`,
        [
          tenantId,
          periodRes.period.id,
          closeRun.id,
          meta.lesseeMark,
          meta.lesseeEmail,
          meta.invoiceNumber,
          meta.laborCents,
          meta.materialCents,
          meta.laborCents + meta.materialCents,
          meta.eventIds,
          meta.detailCount,
          opts.actor,
        ],
      );
    }

    await client.query(
      `INSERT INTO repair.crb_export_files
         (tenant_id, close_run_id, filename, local_path, sha256, byte_length,
          record_count, validation_ok, validation_errors, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [
        tenantId,
        closeRun.id,
        built.filename,
        localPath,
        built.sha256,
        built.bytes.length,
        built.records.length,
        validation.ok,
        JSON.stringify(validation.errors),
        opts.actor,
      ],
    );

    await client.query(
      `UPDATE repair.billing_periods
       SET status = 'closed', closed_at = now(), closed_by = $1
       WHERE id = $2`,
      [opts.actor, periodRes.period.id],
    );

    return closeRun;
  });

  await writeAudit({
    tenantId,
    entity: "close_run",
    entityId: result.id,
    action: "MONTHLY_CLOSE",
    after: {
      accountMonth,
      eventCount: events.length,
      invoiceCount: invoices.length,
      filename: built.filename,
      sha256: built.sha256,
      localPath,
      laborCents: built.laborCents,
      materialCents: built.materialCents,
      validationOk: validation.ok,
    },
    actor: opts.actor,
    via: "UI",
  });

  return {
    ok: true as const,
    closeRun: result,
    accountMonth,
    eventCount: events.length,
    invoiceCount: invoices.length,
    filename: built.filename,
    localPath,
    sha256: built.sha256,
    validation,
    laborCents: built.laborCents,
    materialCents: built.materialCents,
    rebuttalInvoices: rebuttalMeta,
  };
}

export async function listCloseRuns(tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT * FROM repair.close_runs
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId],
  );
  return rows;
}
