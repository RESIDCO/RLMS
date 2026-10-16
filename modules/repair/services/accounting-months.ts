/**
 * §H r3 — Accounting months for shop invoice payment scheduling.
 * Replaces any fixed pay-cycle cutoff: owner/MP closes one open month when ready.
 * Approved invoices land in the current OPEN month; close freezes them → MONTH_CLOSED
 * (eligible for AP / payment batch). Paid only when payment date + ref recorded.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";

export type AccountingMonthStatus = "OPEN" | "CLOSED";

export type AccountingMonthRow = {
  id: string;
  monthLabel: string;
  status: AccountingMonthStatus;
  openedAt: string | null;
  openedBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
  reopenReason: string | null;
  closeTotals: CloseTotals | null;
  note: string | null;
  invoiceCount: number;
};

export type CloseTotals = {
  byShop: Array<{ shopMark: string; cents: number; count: number }>;
  byResp: {
    ownerCents: number;
    lessee6Cents: number;
    road3Cents: number;
    otherCents: number;
  };
  lesseeRebillPendingCents: number;
  roadRebillPendingCents: number;
  crbReceivedPlaceholder: string;
  lesseeRebillOutputPlaceholder: string;
  totalCents: number;
  invoiceCount: number;
};

function currentMonthLabel(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Compare YYYY-MM labels: -1 if a<b, 0 equal, 1 if a>b. */
export function compareMonthLabels(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Refuse opening or closing months after the current calendar month. */
export function isFutureMonthLabel(
  monthLabel: string,
  now = new Date(),
): boolean {
  return compareMonthLabels(monthLabel, currentMonthLabel(now)) > 0;
}

function mapMonth(r: Record<string, unknown>, invoiceCount = 0): AccountingMonthRow {
  return {
    id: String(r.id),
    monthLabel: String(r.month_label),
    status: String(r.status) as AccountingMonthStatus,
    openedAt: r.opened_at != null ? String(r.opened_at) : null,
    openedBy: r.opened_by != null ? String(r.opened_by) : null,
    closedAt: r.closed_at != null ? String(r.closed_at) : null,
    closedBy: r.closed_by != null ? String(r.closed_by) : null,
    reopenReason: r.reopen_reason != null ? String(r.reopen_reason) : null,
    closeTotals: (r.close_totals as CloseTotals) ?? null,
    note: r.note != null ? String(r.note) : null,
    invoiceCount,
  };
}

/** Ensure exactly one OPEN accounting month (create current YYYY-MM if none). */
export async function ensureOpenAccountingMonth(opts?: {
  tenantId?: string;
  actor?: string;
  monthLabel?: string;
}): Promise<AccountingMonthRow> {
  const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
  const { rows: open } = await q(
    `SELECT * FROM repair.accounting_months
     WHERE tenant_id = $1 AND status = 'OPEN' AND deleted_at IS NULL
     ORDER BY opened_at DESC LIMIT 1`,
    [tenantId],
  );
  if (open[0]) {
    const count = await countInvoicesInMonth(String(open[0].id), tenantId);
    return mapMonth(open[0], count);
  }
  const label = opts?.monthLabel ?? currentMonthLabel();
  if (isFutureMonthLabel(label)) {
    throw new Error(
      `Cannot open future accounting month ${label} (current is ${currentMonthLabel()})`,
    );
  }
  const actor = opts?.actor ?? "system";
  const { rows } = await q(
    `INSERT INTO repair.accounting_months
       (tenant_id, month_label, status, opened_by, created_by)
     VALUES ($1,$2,'OPEN',$3,$3)
     ON CONFLICT (tenant_id, month_label) DO UPDATE
       SET status = 'OPEN',
           opened_at = now(),
           opened_by = EXCLUDED.opened_by,
           closed_at = NULL,
           closed_by = NULL,
           deleted_at = NULL
     WHERE repair.accounting_months.status = 'CLOSED'
        OR repair.accounting_months.deleted_at IS NOT NULL
     RETURNING *`,
    [tenantId, label, actor],
  );
  if (!rows[0]) {
    // Conflict with already-open different month — re-read
    const { rows: again } = await q(
      `SELECT * FROM repair.accounting_months
       WHERE tenant_id = $1 AND status = 'OPEN' AND deleted_at IS NULL
       LIMIT 1`,
      [tenantId],
    );
    if (!again[0]) {
      throw new Error(`Could not open accounting month ${label}`);
    }
    return mapMonth(again[0], await countInvoicesInMonth(String(again[0].id), tenantId));
  }
  return mapMonth(rows[0], 0);
}

async function countInvoicesInMonth(monthId: string, tenantId: string): Promise<number> {
  const { rows } = await q(
    `SELECT count(*)::int AS n FROM repair.invoices
     WHERE accounting_month_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [monthId, tenantId],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function listAccountingMonths(opts?: {
  tenantId?: string;
}): Promise<AccountingMonthRow[]> {
  const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT m.*,
            (SELECT count(*)::int FROM repair.invoices i
             WHERE i.accounting_month_id = m.id AND i.deleted_at IS NULL) AS invoice_count
     FROM repair.accounting_months m
     WHERE m.tenant_id = $1 AND m.deleted_at IS NULL
     ORDER BY m.month_label DESC`,
    [tenantId],
  );
  return rows.map((r) => mapMonth(r, Number(r.invoice_count ?? 0)));
}

export async function getAccountingMonth(opts: {
  monthId: string;
  tenantId?: string;
}): Promise<AccountingMonthRow | null> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT m.*,
            (SELECT count(*)::int FROM repair.invoices i
             WHERE i.accounting_month_id = m.id AND i.deleted_at IS NULL) AS invoice_count
     FROM repair.accounting_months m
     WHERE m.id = $1 AND m.tenant_id = $2 AND m.deleted_at IS NULL`,
    [opts.monthId, tenantId],
  );
  if (!rows[0]) return null;
  return mapMonth(rows[0], Number(rows[0].invoice_count ?? 0));
}

/** Preview close totals (by shop + resp) without freezing. */
export async function previewMonthClose(opts: {
  monthId: string;
  tenantId?: string;
}): Promise<{ ok: true; month: AccountingMonthRow; totals: CloseTotals } | { ok: false; status: number; error: string }> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const month = await getAccountingMonth({ monthId: opts.monthId, tenantId });
  if (!month) return { ok: false, status: 404, error: "Accounting month not found" };
  if (month.status !== "OPEN") {
    return { ok: false, status: 409, error: "Month is already closed" };
  }
  const totals = await computeCloseTotals(opts.monthId, tenantId);
  return { ok: true, month, totals };
}

async function computeCloseTotals(
  monthId: string,
  tenantId: string,
): Promise<CloseTotals> {
  const { rows: byShop } = await q(
    `SELECT coalesce(s.shop_mark, '—') AS shop_mark,
            count(*)::int AS count,
            coalesce(sum(coalesce(i.approved_amount_cents,
              round(coalesce(i.total,0)*100)::bigint)), 0)::bigint AS cents
     FROM repair.invoices i
     LEFT JOIN repair.shops s ON s.id = i.shop_id
     WHERE i.accounting_month_id = $1 AND i.tenant_id = $2 AND i.deleted_at IS NULL
       AND coalesce(i.workflow_status,'') IN (
         'APPROVED_IN_OPEN_MONTH','SHORT_PAID','PAYABLE'
       )
     GROUP BY coalesce(s.shop_mark, '—')
     ORDER BY shop_mark`,
    [monthId, tenantId],
  );

  const { rows: invs } = await q(
    `SELECT i.id, i.rebill_status,
            coalesce(i.approved_amount_cents, round(coalesce(i.total,0)*100)::bigint) AS amt
     FROM repair.invoices i
     WHERE i.accounting_month_id = $1 AND i.tenant_id = $2 AND i.deleted_at IS NULL
       AND coalesce(i.workflow_status,'') IN (
         'APPROVED_IN_OPEN_MONTH','SHORT_PAID','PAYABLE'
       )`,
    [monthId, tenantId],
  );

  let ownerCents = 0;
  let lessee6Cents = 0;
  let road3Cents = 0;
  let otherCents = 0;
  let lesseeRebillPendingCents = 0;
  let roadRebillPendingCents = 0;
  let totalCents = 0;

  for (const inv of invs) {
    const amt = Number(inv.amt ?? 0);
    totalCents += amt;
    const { rows: lines } = await q(
      `SELECT coalesce(resp_code,'') AS resp_code,
              coalesce(total_cents,0)::bigint AS total_cents
       FROM repair.invoice_lines WHERE invoice_id = $1`,
      [inv.id],
    );
    if (!lines.length) {
      ownerCents += amt;
    } else {
      for (const ln of lines) {
        const c = Number(ln.total_cents ?? 0);
        const resp = String(ln.resp_code ?? "").trim();
        if (resp === "6") lessee6Cents += c;
        else if (resp === "3") road3Cents += c;
        else if (resp === "1" || resp === "2" || resp === "" || resp === "7") ownerCents += c;
        else otherCents += c;
      }
    }
    if (String(inv.rebill_status) === "REBILL_PENDING") {
      // Approximate pending rebill from line resp when flagged
      lesseeRebillPendingCents += lines
        .filter((l) => String(l.resp_code).trim() === "6")
        .reduce((s, l) => s + Number(l.total_cents ?? 0), 0);
      roadRebillPendingCents += lines
        .filter((l) => String(l.resp_code).trim() === "3")
        .reduce((s, l) => s + Number(l.total_cents ?? 0), 0);
    }
  }

  return {
    byShop: byShop.map((r) => ({
      shopMark: String(r.shop_mark),
      cents: Number(r.cents ?? 0),
      count: Number(r.count ?? 0),
    })),
    byResp: { ownerCents, lessee6Cents, road3Cents, otherCents },
    lesseeRebillPendingCents,
    roadRebillPendingCents,
    crbReceivedPlaceholder: "CRB received — later phase",
    lesseeRebillOutputPlaceholder: "Lessee rebill output — later phase",
    totalCents,
    invoiceCount: invs.length,
  };
}

/**
 * Close open month: freeze invoices → MONTH_CLOSED (AP-eligible).
 * Opens next calendar month as the new OPEN month.
 */
export async function closeAccountingMonth(opts: {
  monthId: string;
  actor: string;
  tenantId?: string;
  confirm?: boolean;
}): Promise<
  | {
      ok: true;
      month: AccountingMonthRow;
      totals: CloseTotals;
      nextOpen: AccountingMonthRow;
      invoicesClosed: number;
    }
  | { ok: false; status: number; error: string }
> {
  if (!opts.confirm) {
    return {
      ok: false,
      status: 400,
      error: "Confirm required to close accounting month",
    };
  }
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const preview = await previewMonthClose({ monthId: opts.monthId, tenantId });
  if (!preview.ok) return preview;
  if (isFutureMonthLabel(preview.month.monthLabel)) {
    return {
      ok: false,
      status: 422,
      error: `Cannot close future accounting month ${preview.month.monthLabel}`,
    };
  }
  const { totals } = preview;

  const { rowCount } = await q(
    `UPDATE repair.invoices
     SET workflow_status = 'MONTH_CLOSED',
         payment_status = 'MONTH_CLOSED'
     WHERE accounting_month_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       AND coalesce(workflow_status,'') IN (
         'APPROVED_IN_OPEN_MONTH','SHORT_PAID','PAYABLE'
       )`,
    [opts.monthId, tenantId],
  );

  const { rows } = await q(
    `UPDATE repair.accounting_months
     SET status = 'CLOSED',
         closed_at = now(),
         closed_by = $1,
         close_totals = $4::jsonb
     WHERE id = $2 AND tenant_id = $3 AND status = 'OPEN' AND deleted_at IS NULL
     RETURNING *`,
    [opts.actor, opts.monthId, tenantId, JSON.stringify(totals)],
  );
  if (!rows[0]) {
    return { ok: false, status: 409, error: "Month not open or already closed" };
  }

  // Next open month = following calendar month from closed label —
  // but never open a future calendar month (stay with current if next would be future).
  const [yStr, mStr] = String(rows[0].month_label).split("-");
  let y = Number(yStr);
  let m = Number(mStr) + 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  let nextLabel = `${y}-${String(m).padStart(2, "0")}`;
  if (isFutureMonthLabel(nextLabel)) {
    nextLabel = currentMonthLabel();
    // If we just closed the current month, there is no safe next open month yet —
    // reopen current as a soft "pending" by creating/opening current only when
    // the closed label is strictly before current; otherwise leave no OPEN and
    // let ensureOpenAccountingMonth create current on next approve.
    if (compareMonthLabels(String(rows[0].month_label), currentMonthLabel()) >= 0) {
      // Closed current (or somehow future) — do not auto-open a future month.
      await writeAudit({
        tenantId,
        entity: "accounting_month",
        entityId: opts.monthId,
        action: "ACCOUNTING_MONTH_CLOSED",
        after: {
          month_label: rows[0].month_label,
          totals,
          invoices_closed: rowCount ?? 0,
          next_open: null,
          deferred_future_open: true,
        },
        actor: opts.actor,
        via: "UI",
      });
      // Synthetic nextOpen = closed month row for type stability; caller should
      // treat deferred_future_open via ensureOpen on next use.
      const placeholder = mapMonth(rows[0], totals.invoiceCount);
      return {
        ok: true,
        month: placeholder,
        totals,
        nextOpen: placeholder,
        invoicesClosed: rowCount ?? 0,
      };
    }
  }
  const nextOpen = await ensureOpenAccountingMonth({
    tenantId,
    actor: opts.actor,
    monthLabel: nextLabel,
  });

  await writeAudit({
    tenantId,
    entity: "accounting_month",
    entityId: opts.monthId,
    action: "ACCOUNTING_MONTH_CLOSED",
    after: {
      month_label: rows[0].month_label,
      totals,
      invoices_closed: rowCount ?? 0,
      next_open: nextOpen.monthLabel,
    },
    actor: opts.actor,
    via: "UI",
  });

  return {
    ok: true,
    month: mapMonth(rows[0], totals.invoiceCount),
    totals,
    nextOpen,
    invoicesClosed: rowCount ?? 0,
  };
}

/**
 * Demo/seed helper: force Sep 2026 CLOSED + Oct 2026 OPEN.
 * Soft-deletes any OPEN months after 2026-10; never leaves a future month open.
 */
export async function resetDemoAccountingMonths(opts?: {
  tenantId?: string;
  actor?: string;
  openLabel?: string;
  closedLabel?: string;
}): Promise<{ open: AccountingMonthRow; closed: AccountingMonthRow }> {
  const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
  const actor = opts?.actor ?? "seed-shop-demo";
  const openLabel = opts?.openLabel ?? "2026-10";
  const closedLabel = opts?.closedLabel ?? "2026-09";
  if (isFutureMonthLabel(openLabel)) {
    throw new Error(`Demo open month ${openLabel} is in the future`);
  }

  // Close / hide any OPEN months that aren't the desired open label
  await q(
    `UPDATE repair.accounting_months
     SET status = 'CLOSED',
         closed_at = coalesce(closed_at, now()),
         closed_by = coalesce(closed_by, $1),
         deleted_at = CASE
           WHEN month_label > $2 THEN coalesce(deleted_at, now())
           ELSE deleted_at END,
         deleted_by = CASE
           WHEN month_label > $2 THEN coalesce(deleted_by, $1)
           ELSE deleted_by END
     WHERE tenant_id = $3 AND status = 'OPEN' AND deleted_at IS NULL
       AND month_label IS DISTINCT FROM $2`,
    [actor, openLabel, tenantId],
  );

  // Ensure closed Sep exists as CLOSED
  await q(
    `INSERT INTO repair.accounting_months
       (tenant_id, month_label, status, opened_by, closed_by, closed_at, created_by)
     VALUES ($1,$2,'CLOSED',$3,$3,now(),$3)
     ON CONFLICT (tenant_id, month_label) DO UPDATE
       SET status = 'CLOSED',
           closed_at = coalesce(repair.accounting_months.closed_at, now()),
           closed_by = coalesce(repair.accounting_months.closed_by, EXCLUDED.closed_by),
           deleted_at = NULL`,
    [tenantId, closedLabel, actor],
  );

  // Ensure Oct is OPEN
  await q(
    `INSERT INTO repair.accounting_months
       (tenant_id, month_label, status, opened_by, created_by)
     VALUES ($1,$2,'OPEN',$3,$3)
     ON CONFLICT (tenant_id, month_label) DO UPDATE
       SET status = 'OPEN',
           opened_at = now(),
           opened_by = EXCLUDED.opened_by,
           closed_at = NULL,
           closed_by = NULL,
           deleted_at = NULL`,
    [tenantId, openLabel, actor],
  );

  const open = await ensureOpenAccountingMonth({
    tenantId,
    actor,
    monthLabel: openLabel,
  });
  const closed = (await getAccountingMonthByLabel({
    monthLabel: closedLabel,
    tenantId,
  }))!;
  return { open, closed };
}

async function getAccountingMonthByLabel(opts: {
  monthLabel: string;
  tenantId?: string;
}): Promise<AccountingMonthRow | null> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT m.*,
            (SELECT count(*)::int FROM repair.invoices i
             WHERE i.accounting_month_id = m.id AND i.deleted_at IS NULL) AS invoice_count
     FROM repair.accounting_months m
     WHERE m.tenant_id = $1 AND m.month_label = $2 AND m.deleted_at IS NULL`,
    [tenantId, opts.monthLabel],
  );
  if (!rows[0]) return null;
  return mapMonth(rows[0], Number(rows[0].invoice_count ?? 0));
}

/** Owner-only reopen of a closed month (with reason). Closes any current OPEN first. */
export async function reopenAccountingMonth(opts: {
  monthId: string;
  actor: string;
  reason: string;
  tenantId?: string;
}): Promise<
  | { ok: true; month: AccountingMonthRow }
  | { ok: false; status: number; error: string }
> {
  const reason = (opts.reason ?? "").trim();
  if (!reason) {
    return { ok: false, status: 400, error: "Reopen reason required" };
  }
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const month = await getAccountingMonth({ monthId: opts.monthId, tenantId });
  if (!month) return { ok: false, status: 404, error: "Accounting month not found" };
  if (month.status !== "CLOSED") {
    return { ok: false, status: 409, error: "Only closed months can be reopened" };
  }

  // Close current open month without moving invoices (force swap)
  await q(
    `UPDATE repair.accounting_months
     SET status = 'CLOSED',
         closed_at = coalesce(closed_at, now()),
         closed_by = coalesce(closed_by, $1),
         note = coalesce(note, '') || ' [auto-closed for reopen of ' || $2 || ']'
     WHERE tenant_id = $3 AND status = 'OPEN' AND deleted_at IS NULL AND id <> $4`,
    [opts.actor, month.monthLabel, tenantId, opts.monthId],
  );

  const { rows } = await q(
    `UPDATE repair.accounting_months
     SET status = 'OPEN',
         reopen_reason = $1,
         reopened_at = now(),
         reopened_by = $2,
         closed_at = NULL,
         closed_by = NULL
     WHERE id = $3 AND tenant_id = $4
     RETURNING *`,
    [reason, opts.actor, opts.monthId, tenantId],
  );
  if (!rows[0]) return { ok: false, status: 500, error: "Reopen failed" };

  // Invoices in this month that were MONTH_CLOSED roll back to APPROVED_IN_OPEN_MONTH
  await q(
    `UPDATE repair.invoices
     SET workflow_status = 'APPROVED_IN_OPEN_MONTH',
         payment_status = 'APPROVED_IN_OPEN_MONTH'
     WHERE accounting_month_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       AND coalesce(workflow_status,'') = 'MONTH_CLOSED'
       AND payment_status IS DISTINCT FROM 'PAID'
       AND payment_batch_id IS NULL`,
    [opts.monthId, tenantId],
  );

  await writeAudit({
    tenantId,
    entity: "accounting_month",
    entityId: opts.monthId,
    action: "ACCOUNTING_MONTH_REOPENED",
    after: { reason, month_label: rows[0].month_label },
    actor: opts.actor,
    via: "UI",
  });

  return {
    ok: true,
    month: mapMonth(rows[0], await countInvoicesInMonth(opts.monthId, tenantId)),
  };
}

/** Plain-English status for owner queue / review. */
export function invoiceStatusPlain(opts: {
  workflowStatus?: string | null;
  paymentStatus?: string | null;
  monthLabel?: string | null;
  paidAt?: string | null;
  paidRef?: string | null;
}): string {
  const paid = opts.paymentStatus === "PAID" || opts.workflowStatus === "PAID";
  if (paid) {
    const d = opts.paidAt ? ` ${opts.paidAt}` : "";
    const r = opts.paidRef ? ` ref ${opts.paidRef}` : "";
    return `Paid${d}${r}`.trim();
  }
  const wf = opts.workflowStatus ?? "";
  const pay = opts.paymentStatus ?? "";
  if (wf === "REJECTED") return "Rejected";
  if (wf === "UNDER_OWNER_REVIEW" || wf === "INVOICE_SUBMITTED") {
    return "Under owner review";
  }
  if (wf === "APPROVED_IN_OPEN_MONTH" || pay === "APPROVED_IN_OPEN_MONTH") {
    return "Approved – In Open Month";
  }
  if (wf === "MONTH_CLOSED" || pay === "MONTH_CLOSED" || pay === "PAYABLE") {
    return "Month Closed";
  }
  if (
    wf === "SENT_TO_AP" ||
    pay === "SENT_TO_AP" ||
    pay === "IN_BATCH" ||
    pay === "EXPORTED" ||
    wf === "IN_BATCH" ||
    wf === "EXPORTED"
  ) {
    return "Sent to AP";
  }
  if (wf === "SHORT_PAID" || pay === "SHORT_PAID") return "Short-paid";
  if (wf === "PAYABLE") return "Month Closed";
  return wf || pay || "—";
}

/** Shop-facing status line. */
export function shopInvoiceStatusPlain(opts: {
  workflowStatus?: string | null;
  paymentStatus?: string | null;
  monthLabel?: string | null;
  paidAt?: string | null;
  paidRef?: string | null;
}): string {
  const paid = opts.paymentStatus === "PAID" || opts.workflowStatus === "PAID";
  if (paid) {
    return `Paid ${opts.paidAt ?? ""}${opts.paidRef ? ` ref ${opts.paidRef}` : ""}`.trim();
  }
  if (
    opts.workflowStatus === "APPROVED_IN_OPEN_MONTH" ||
    opts.paymentStatus === "APPROVED_IN_OPEN_MONTH"
  ) {
    const m = opts.monthLabel ? ` with ${opts.monthLabel} close` : "";
    return `Approved – scheduled${m}`;
  }
  return invoiceStatusPlain(opts);
}
