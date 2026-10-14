/**
 * Monthly close: collect CLOSED events with rebill responsibility (Resp 6 lessee /
 * Resp 3 railroad), bill only at close, generate local CRIPYYMM file, bulk rebuttal
 * invoices. Append-only close_runs / billing_lines / rebuttal_invoices; locks events.
 * No FTP.
 *
 * Q14–Q17: outbound billing party = tenant carOwnerMark; billed party from
 * billed_party_mappings (block if missing); account month stamped by this close run;
 * unprocessed (unlocked) items roll into the next close.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { DEFAULT_TENANT_ID, q, withTransaction } from "../db";
import { writeAudit } from "./audit";
import { buildCripFile, type CrbInvoiceInput } from "./crb-writer";
import { validateCripBytes } from "./crb-validate";
import {
  getCarOwnerMark,
  getDefaultPaymentTermsDays,
  getTaxpayerId,
  partyRoleForRespCode,
  resolveBilledParty,
  type MissingBilledParty,
  type PartyRole,
} from "./billed-party-map";
import { getCarsRef } from "../integration/rlms";
import { dollarsToCents } from "./money";

const REBILL_RESP_CODES = ["6", "3"] as const;

export type CloseEligibleGroup = {
  eventId: string;
  estimateId: string;
  revisionId: string;
  carMark: string;
  carNumber: string;
  leaseRider: string | null;
  /** Snapshot entity tag (MAIN / COAL / RPS) for accounting segregation */
  entityCode: string | null;
  partyRole: PartyRole;
  billedPartyMark: string;
  paymentTermsDays: number | null;
  contactEmail: string | null;
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

export type EntityCloseSubtotal = {
  entityCode: string;
  rebillCents: number;
  inboundShopPaymentCents: number;
  resp7Cents: number;
  totalCents: number;
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
  const yy = 2000 + Number(accountMonth.slice(0, 2));
  const mm = Number(accountMonth.slice(2, 4));
  const last = new Date(Date.UTC(yy, mm, 0));
  const dd = String(last.getUTCDate()).padStart(2, "0");
  return `${accountMonth}${dd}`;
}

function dueDateYymmdd(accountMonth: string, termsDays: number): string {
  const yy = 2000 + Number(accountMonth.slice(0, 2));
  const mm = Number(accountMonth.slice(2, 4));
  const base = new Date(Date.UTC(yy, mm, 0));
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
 * CLOSED events with unlocked Resp 6 / Resp 3 lines.
 * Account month is NOT filtered by repair date — membership is “picked up by
 * this close run” (Q17). Unlocked items roll into the next close.
 */
export async function collectRebillEvents(opts: {
  tenantId?: string;
}): Promise<
  | { ok: true; groups: CloseEligibleGroup[] }
  | { ok: false; status: 422; error: string; missing: MissingBilledParty[] }
> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT e.id AS event_id, e.car_mark, e.car_number,
            COALESCE(est.entity_code, e.entity_code) AS entity_code,
            est.id AS estimate_id, rev.id AS revision_id
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
           WHERE el.revision_id = r.id AND el.resp_code = ANY($2::text[])
         )
       ORDER BY r.rev_no DESC
       LIMIT 1
     ) rev ON true
     WHERE e.tenant_id = $1
       AND e.deleted_at IS NULL
       AND s.code = 'CLOSED'
       AND e.billing_locked_at IS NULL
     ORDER BY e.car_mark, e.car_number`,
    [tenantId, [...REBILL_RESP_CODES]],
  );

  const groups: CloseEligibleGroup[] = [];
  const missing: MissingBilledParty[] = [];

  for (const r of rows) {
    const carMark = String(r.car_mark);
    const carNumber = String(r.car_number);
    const car = await getCarsRef(carMark, carNumber);
    const leaseRider = car?.lease_rider ? String(car.lease_rider) : null;

    const { rows: lines } = await q(
      `SELECT line_no, resp_code, labor_cents, material_cents, labor, material,
              raw_line, aar_job_code, qualifier, why_made, condition_code
       FROM repair.estimate_lines
       WHERE revision_id = $1 AND resp_code = ANY($2::text[])
       ORDER BY line_no ASC`,
      [r.revision_id, [...REBILL_RESP_CODES]],
    );

    const byRole = new Map<PartyRole, typeof lines>();
    for (const ln of lines) {
      const role = partyRoleForRespCode(String(ln.resp_code));
      if (!role) continue;
      const list = byRole.get(role) ?? [];
      list.push(ln);
      byRole.set(role, list);
    }

    for (const [partyRole, roleLines] of byRole) {
      const resolved = await resolveBilledParty({
        carMark,
        carNumber,
        partyRole,
        tenantId,
        leaseRider,
      });
      if (!resolved.ok) {
        missing.push(resolved.missing);
        continue;
      }

      let laborCents = 0;
      let materialCents = 0;
      const mapped = roleLines.map((l) => {
        const lc =
          l.labor_cents != null
            ? Number(l.labor_cents)
            : dollarsToCents(l.labor);
        const mc =
          l.material_cents != null
            ? Number(l.material_cents)
            : dollarsToCents(l.material);
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

      let contactEmail: string | null = null;
      if (partyRole === "LESSEE") {
        const { rows: contacts } = await q(
          `SELECT email FROM repair.contacts
           WHERE tenant_id = $1 AND party_type = 'lessee'
             AND active AND deleted_at IS NULL AND email IS NOT NULL
             AND (party_ref IS NULL OR upper(party_ref) = $2)
           ORDER BY created_at ASC LIMIT 1`,
          [tenantId, resolved.resolved.mark],
        );
        contactEmail = contacts[0]?.email ? String(contacts[0].email) : null;
      }

      groups.push({
        eventId: String(r.event_id),
        estimateId: String(r.estimate_id),
        revisionId: String(r.revision_id),
        carMark,
        carNumber,
        leaseRider,
        entityCode: r.entity_code != null ? String(r.entity_code) : null,
        partyRole,
        billedPartyMark: resolved.resolved.mark,
        paymentTermsDays: resolved.resolved.paymentTermsDays,
        contactEmail,
        laborCents,
        materialCents,
        lines: mapped,
      });
    }
  }

  if (missing.length) {
    return {
      ok: false,
      status: 422,
      error: "Missing billed-party mapping(s); export blocked",
      missing,
    };
  }
  return { ok: true, groups };
}

/** @deprecated use collectRebillEvents — kept for callers expecting prior name */
export async function collectLesseeRebillEvents(opts: {
  accountMonth?: string;
  tenantId?: string;
}): Promise<CloseEligibleGroup[]> {
  const res = await collectRebillEvents({ tenantId: opts.tenantId });
  if (!res.ok) return [];
  return res.groups.filter((g) => g.partyRole === "LESSEE");
}

export async function runMonthlyClose(opts: {
  accountMonth?: string;
  tenantId?: string;
  actor: string;
  exportDir?: string;
  dryRun?: boolean;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const settings = await tenantSettings(tenantId);
  const accountMonth = (opts.accountMonth ?? yymmFromDate()).replace(/\D/g, "").slice(0, 4);
  if (!/^\d{4}$/.test(accountMonth)) {
    return { ok: false as const, status: 400, error: "accountMonth must be YYMM" };
  }

  const owner = await getCarOwnerMark(tenantId);
  if (!owner.ok) {
    return { ok: false as const, status: 422, error: owner.error };
  }
  const billingParty = owner.mark;

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

  const collected = await collectRebillEvents({ tenantId });
  if (!collected.ok) {
    return {
      ok: false as const,
      status: collected.status,
      error: collected.error,
      missing: collected.missing,
    };
  }
  const groups = collected.groups;
  if (!groups.length) {
    return {
      ok: false as const,
      status: 404,
      error:
        "No CLOSED events with unlocked Resp 6/3 rebill lines (unprocessed items roll into the next close)",
    };
  }

  const currency = String(settings.crbCurrency ?? "U");
  const taxpayerId = await getTaxpayerId(tenantId);
  const defaultTerms = await getDefaultPaymentTermsDays(tenantId);
  const invDate = invoiceDateYymmdd(accountMonth);

  // Bulk rebuttal invoices: one per (billed party mark + party role)
  const byInvoiceKey = new Map<string, CloseEligibleGroup[]>();
  for (const g of groups) {
    const key = `${g.partyRole}|${g.billedPartyMark}`;
    const list = byInvoiceKey.get(key) ?? [];
    list.push(g);
    byInvoiceKey.set(key, list);
  }

  const invoices: CrbInvoiceInput[] = [];
  const rebuttalMeta: Array<{
    billedPartyMark: string;
    partyRole: PartyRole;
    contactEmail: string | null;
    invoiceNumber: string;
    eventIds: string[];
    laborCents: number;
    materialCents: number;
    detailCount: number;
    paymentTermsDays: number;
  }> = [];

  let invSeq = 1;
  for (const [, group] of byInvoiceKey) {
    const billedMark = group[0].billedPartyMark;
    const partyRole = group[0].partyRole;
    const termsDays =
      group.find((g) => g.paymentTermsDays != null)?.paymentTermsDays ?? defaultTerms;
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
          // Outbound rebuttal: repairing/billing party = car owner (not shop)
          repairingParty: billingParty,
          appliedJobCode: ln.aarJobCode ?? "0000",
          appliedQualifier: ln.qualifier ?? undefined,
          whyMade: ln.whyMade ?? undefined,
          conditionCode: ln.conditionCode ?? undefined,
          responsibilityCode: ln.respCode,
          laborCents: ln.laborCents,
          materialCents: ln.materialCents,
          lineNumber: lineNo++,
          detailSource: "RE",
          description: `${partyRole} REBILL ${ev.carMark} ${ev.carNumber}`.slice(0, 50),
        });
        labor += ln.laborCents;
        material += ln.materialCents;
      }
    }
    const email = group.find((g) => g.contactEmail)?.contactEmail ?? null;
    invoices.push({
      billedParty: billedMark,
      invoiceNumber,
      invoiceDateYymmdd: invDate,
      paymentDueYymmdd: dueDateYymmdd(accountMonth, termsDays),
      contact: {
        companyName:
          partyRole === "RAILROAD"
            ? `Railroad ${billedMark.trim()}`
            : `Lessee ${billedMark.trim()}`,
        email: email ?? undefined,
        address1: "SEE CONTACT BANK",
        country: "US",
      },
      details,
    });
    rebuttalMeta.push({
      billedPartyMark: billedMark,
      partyRole,
      contactEmail: email,
      invoiceNumber,
      eventIds: [...new Set(group.map((g) => g.eventId))],
      laborCents: labor,
      materialCents: material,
      detailCount: details.length,
      paymentTermsDays: termsDays,
    });
  }

  const built = buildCripFile({
    billingParty,
    accountMonthYymm: accountMonth,
    currency,
    taxpayerId,
    paymentTerms: String(defaultTerms).padStart(2, "0").slice(-2),
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
    const entitySubtotals = await buildEntityCloseSubtotals({
      tenantId,
      accountMonth,
      rebillGroups: groups,
    });
    return {
      ok: true as const,
      dryRun: true,
      accountMonth,
      billingParty,
      eventCount: new Set(groups.map((g) => g.eventId)).size,
      invoiceCount: invoices.length,
      filename: built.filename,
      validation,
      laborCents: built.laborCents,
      materialCents: built.materialCents,
      entitySubtotals,
    };
  }

  mkdirSync(exportDir, { recursive: true });
  writeFileSync(localPath, built.bytes);

  const eventIds = [...new Set(groups.map((g) => g.eventId))];

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
        eventIds.length,
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

    for (const ev of groups) {
      await client.query(
        `INSERT INTO repair.close_run_events
           (tenant_id, close_run_id, event_id, estimate_id, revision_id,
            lessee_mark, lessee_email, labor_cents, material_cents,
            account_month, created_by, entity_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          tenantId,
          closeRun.id,
          ev.eventId,
          ev.estimateId,
          ev.revisionId,
          ev.billedPartyMark,
          ev.contactEmail,
          ev.laborCents,
          ev.materialCents,
          accountMonth,
          opts.actor,
          ev.entityCode,
        ],
      );

      for (const ln of ev.lines) {
        const invNo =
          rebuttalMeta.find(
            (m) =>
              m.eventIds.includes(ev.eventId) &&
              m.billedPartyMark === ev.billedPartyMark &&
              m.partyRole === ev.partyRole,
          )?.invoiceNumber ?? null;
        await client.query(
          `INSERT INTO repair.billing_lines
             (tenant_id, period_id, close_run_id, event_id, source, car_mark, car_number,
              resp_code, labor_cents, material_cents, total_cents, billed_party,
              invoice_number, raw_record, car_lease_snapshot, account_month, created_by,
              entity_code)
           VALUES ($1,$2,$3,$4,'REBUTTAL',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17)`,
          [
            tenantId,
            periodRes.period.id,
            closeRun.id,
            ev.eventId,
            ev.carMark,
            ev.carNumber,
            ln.respCode,
            ln.laborCents,
            ln.materialCents,
            ln.laborCents + ln.materialCents,
            ev.billedPartyMark,
            invNo,
            ln.rawLine,
            JSON.stringify({
              estimateId: ev.estimateId,
              revisionId: ev.revisionId,
              accountMonth,
              partyRole: ev.partyRole,
              leaseRider: ev.leaseRider,
              billingParty,
              direction: "outbound_rebuttal",
              entityCode: ev.entityCode,
            }),
            accountMonth,
            opts.actor,
            ev.entityCode,
          ],
        );
      }
    }

    for (const eventId of eventIds) {
      await client.query(
        `UPDATE repair.events
         SET billing_locked_at = now(), billing_close_run_id = $1
         WHERE id = $2 AND tenant_id = $3 AND billing_locked_at IS NULL`,
        [closeRun.id, eventId, tenantId],
      );
    }

    for (const meta of rebuttalMeta) {
      await client.query(
        `INSERT INTO repair.rebuttal_invoices
           (tenant_id, period_id, close_run_id, lessee_mark, lessee_email,
            invoice_number, labor_cents, material_cents, total_cents,
            event_ids, detail_count, account_month, party_role,
            payment_terms_days, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[],$11,$12,$13,$14,$15)`,
        [
          tenantId,
          periodRes.period.id,
          closeRun.id,
          meta.billedPartyMark,
          meta.contactEmail,
          meta.invoiceNumber,
          meta.laborCents,
          meta.materialCents,
          meta.laborCents + meta.materialCents,
          meta.eventIds,
          meta.detailCount,
          accountMonth,
          meta.partyRole,
          meta.paymentTermsDays,
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

  const entitySubtotals = await buildEntityCloseSubtotals({
    tenantId,
    accountMonth,
    closeRunId: String(result.id),
    rebillGroups: groups,
  });

  await writeAudit({
    tenantId,
    entity: "close_run",
    entityId: result.id,
    action: "MONTHLY_CLOSE",
    after: {
      accountMonth,
      billingParty,
      direction: "outbound_rebuttal",
      eventCount: eventIds.length,
      invoiceCount: invoices.length,
      filename: built.filename,
      sha256: built.sha256,
      localPath,
      laborCents: built.laborCents,
      materialCents: built.materialCents,
      validationOk: validation.ok,
      entitySubtotals,
    },
    actor: opts.actor,
    via: "UI",
  });

  return {
    ok: true as const,
    closeRun: result,
    accountMonth,
    billingParty,
    eventCount: eventIds.length,
    invoiceCount: invoices.length,
    filename: built.filename,
    localPath,
    sha256: built.sha256,
    validation,
    laborCents: built.laborCents,
    materialCents: built.materialCents,
    entitySubtotals,
    rebuttalInvoices: rebuttalMeta,
  };
}

/**
 * Monthly close totals subtotaled by entity for accounting segregation:
 * inbound shop payments, rebills (Resp 6/3), and Resp 7 lines.
 */
export async function buildEntityCloseSubtotals(opts: {
  tenantId: string;
  accountMonth: string;
  closeRunId?: string;
  rebillGroups: CloseEligibleGroup[];
}): Promise<EntityCloseSubtotal[]> {
  const map = new Map<
    string,
    { rebillCents: number; inboundShopPaymentCents: number; resp7Cents: number }
  >();

  const bump = (
    entityCode: string | null | undefined,
    field: "rebillCents" | "inboundShopPaymentCents" | "resp7Cents",
    cents: number,
  ) => {
    const key = (entityCode || "UNASSIGNED").toUpperCase();
    const cur = map.get(key) ?? {
      rebillCents: 0,
      inboundShopPaymentCents: 0,
      resp7Cents: 0,
    };
    cur[field] += cents;
    map.set(key, cur);
  };

  for (const g of opts.rebillGroups) {
    bump(g.entityCode, "rebillCents", g.laborCents + g.materialCents);
  }

  // Inbound shop payments: matched / ACH-approved invoices (integer cents)
  const { rows: inbound } = await q(
    `SELECT COALESCE(i.entity_code, e.entity_code, est.entity_code) AS entity_code,
            COALESCE(
              i.total_cents,
              ROUND(COALESCE(i.total, 0) * 100)::bigint
            ) AS cents
     FROM repair.invoices i
     JOIN repair.events e ON e.id = i.event_id
     LEFT JOIN LATERAL (
       SELECT entity_code FROM repair.estimates
       WHERE event_id = e.id AND deleted_at IS NULL
       ORDER BY created_at ASC LIMIT 1
     ) est ON true
     WHERE i.tenant_id = $1 AND i.deleted_at IS NULL
       AND (
         COALESCE(i.account_month, '') = $2
         OR i.match_status IN ('MATCHED', 'APPROVED', 'APPROVED_FOR_ACH')
       )`,
    [opts.tenantId, opts.accountMonth],
  ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));

  for (const r of inbound.rows) {
    bump(
      r.entity_code != null ? String(r.entity_code) : null,
      "inboundShopPaymentCents",
      Number(r.cents) || 0,
    );
  }

  // Resp 7 lines on estimates closed in this period / unlocked at close
  const { rows: resp7 } = await q(
    `SELECT COALESCE(est.entity_code, e.entity_code) AS entity_code,
            COALESCE(el.labor_cents, 0) + COALESCE(el.material_cents, 0) AS cents
     FROM repair.estimate_lines el
     JOIN repair.estimate_revisions rev ON rev.id = el.revision_id
     JOIN repair.estimates est ON est.id = rev.estimate_id
     JOIN repair.events e ON e.id = est.event_id
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE est.tenant_id = $1
       AND el.resp_code = '7'
       AND est.deleted_at IS NULL
       AND e.deleted_at IS NULL
       AND s.code IN ('CLOSED', 'READY_TO_CLOSE')
       AND ($2::uuid IS NULL OR e.billing_close_run_id = $2::uuid
            OR e.billing_locked_at IS NOT NULL)`,
    [opts.tenantId, opts.closeRunId ?? null],
  ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));

  for (const r of resp7.rows) {
    bump(
      r.entity_code != null ? String(r.entity_code) : null,
      "resp7Cents",
      Number(r.cents) || 0,
    );
  }

  return [...map.entries()]
    .map(([entityCode, v]) => ({
      entityCode,
      rebillCents: v.rebillCents,
      inboundShopPaymentCents: v.inboundShopPaymentCents,
      resp7Cents: v.resp7Cents,
      totalCents:
        v.rebillCents + v.inboundShopPaymentCents + v.resp7Cents,
    }))
    .sort((a, b) => a.entityCode.localeCompare(b.entityCode));
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
