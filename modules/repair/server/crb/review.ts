/**
 * CRB review actions: decisions, overrides, approval, pool, and rule admin.
 */
import { DEFAULT_TENANT_ID, q } from "../../db";
import { lookupRefCode, type RefLookupKind } from "../../services/ref-lookup";
import { flagOrphanBillerHeaders, logCrb, reauditInvoice, refreshErrorPanel } from "./ingest";
import { selectRuleVersion, type Severity } from "./rules";

const TENANT = DEFAULT_TENANT_ID;
const REASON_MIN = 8;

export type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string };

function fail(status: number, error: string): ActionResult<never> {
  return { ok: false, status, error };
}

async function hardStops(invoiceId: string): Promise<number> {
  const { rows } = await q<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM repair.audit_findings f
     JOIN repair.audit_rules r ON r.id = f.rule_id
     WHERE f.invoice_id = $1 AND f.status = 'OPEN' AND f.invalid = false
       AND r.severity = 'HARD_STOP'`,
    [invoiceId],
  );
  return Number(rows[0]?.n ?? 0);
}

async function refreshReady(invoiceId: string): Promise<string> {
  const { rows } = await q<{ status: string; pending: string; total: string }>(
    `SELECT i.status,
            COUNT(*) FILTER (WHERE c.status = 'PENDING')::text AS pending,
            COUNT(*)::text AS total
     FROM repair.crb_invoices i
     LEFT JOIN repair.crb_cars c ON c.invoice_id = i.id
     WHERE i.id = $1
     GROUP BY i.status`,
    [invoiceId],
  );
  const row = rows[0];
  if (!row) return "PENDING";
  if (["APPROVED", "RETURN_UNPAID", "APPROVED_WITH_EXCEPTIONS"].includes(row.status)) {
    return row.status;
  }
  const pending = Number(row.pending);
  const total = Number(row.total);
  let next = row.status;
  if (total > 0 && pending === 0) next = "READY";
  else if (row.status === "PENDING") next = "IN_REVIEW";
  else if (pending > 0 && row.status === "READY") next = "IN_REVIEW";
  if (next !== row.status) {
    await q(`UPDATE repair.crb_invoices SET status = $2 WHERE id = $1`, [invoiceId, next]);
  }
  return next;
}

export async function decideCar(opts: {
  carId: string;
  decision: "APPROVED" | "OVERRIDDEN" | "REJECTED";
  reason?: string;
  actor: string;
}): Promise<ActionResult<{ status: string }>> {
  if (opts.decision === "OVERRIDDEN" || opts.decision === "REJECTED") {
    if (!opts.reason || opts.reason.trim().length < REASON_MIN) {
      return fail(400, `Reason is required (at least ${REASON_MIN} characters).`);
    }
  }
  const { rows } = await q<{ id: string; invoice_id: string; status: string }>(
    `SELECT id, invoice_id, status FROM repair.crb_cars WHERE id = $1`,
    [opts.carId],
  );
  const car = rows[0];
  if (!car) return fail(404, "Car not found");
  if (opts.decision === "REJECTED") {
    await q(
      `UPDATE repair.crb_lines SET status = 'REJECTED' WHERE car_id = $1 AND status <> 'REJECTED'`,
      [car.id],
    );
  } else {
    await q(
      `UPDATE repair.crb_lines SET status = 'APPROVED'
       WHERE car_id = $1 AND status = 'PENDING'`,
      [car.id],
    );
  }
  await q(`UPDATE repair.crb_cars SET status = $2 WHERE id = $1`, [car.id, opts.decision]);
  const invoiceStatus = await refreshReady(car.invoice_id);
  await logCrb(opts.actor, "decide_car", "CAR", car.id, {
    decision: opts.decision,
    reason: opts.reason ?? null,
    invoiceStatus,
  });
  return { ok: true, status: opts.decision };
}

export async function rejectLine(opts: {
  lineId: string;
  reason: string;
  actor: string;
}): Promise<ActionResult> {
  if (!opts.reason || opts.reason.trim().length < REASON_MIN) {
    return fail(400, `Reason is required (at least ${REASON_MIN} characters).`);
  }
  const { rows } = await q<{ id: string; car_id: string; invoice_id: string }>(
    `SELECT id, car_id, invoice_id FROM repair.crb_lines WHERE id = $1`,
    [opts.lineId],
  );
  const line = rows[0];
  if (!line) return fail(404, "Line not found");
  await q(`UPDATE repair.crb_lines SET status = 'REJECTED' WHERE id = $1`, [line.id]);
  const { rows: counts } = await q<{ rejected: string; total: string }>(
    `SELECT COUNT(*) FILTER (WHERE status = 'REJECTED')::text AS rejected,
            COUNT(*)::text AS total
     FROM repair.crb_lines WHERE car_id = $1`,
    [line.car_id],
  );
  const rejected = Number(counts[0]?.rejected ?? 0);
  const total = Number(counts[0]?.total ?? 0);
  const carStatus = rejected === 0 ? "PENDING" : rejected === total ? "REJECTED" : "REJECTED_PARTIAL";
  await q(`UPDATE repair.crb_cars SET status = $2 WHERE id = $1`, [line.car_id, carStatus]);
  await refreshReady(line.invoice_id);
  await logCrb(opts.actor, "reject_line", "LINE", line.id, { reason: opts.reason, carStatus });
  return { ok: true, carStatus };
}

export async function createOverride(opts: {
  scope: "LINE" | "CAR" | "INVOICE" | "BILLER";
  targetId: string;
  findingId?: string | null;
  reason: string;
  actor: string;
  attachmentName?: string | null;
  attachment?: Buffer | null;
}): Promise<ActionResult<{ overrideId: string }>> {
  if (!opts.reason || opts.reason.trim().length < REASON_MIN) {
    return fail(400, `Reason is required (at least ${REASON_MIN} characters).`);
  }
  let ruleId: string | null = null;
  let ruleCode: string | null = null;
  let ruleVersion: number | null = null;
  let invoiceId: string | null = null;
  if (opts.findingId) {
    const { rows } = await q<{
      id: string;
      rule_id: string | null;
      rule_code: string;
      rule_version: number;
      invoice_id: string | null;
    }>(
      `SELECT id, rule_id, rule_code, rule_version, invoice_id
       FROM repair.audit_findings WHERE id = $1`,
      [opts.findingId],
    );
    if (!rows[0]) return fail(404, "Finding not found");
    ruleId = rows[0].rule_id;
    ruleCode = rows[0].rule_code;
    ruleVersion = rows[0].rule_version;
    invoiceId = rows[0].invoice_id;
    await q(`UPDATE repair.audit_findings SET status = 'OVERRIDDEN' WHERE id = $1`, [rows[0].id]);
  }
  const { rows } = await q<{ id: string }>(
    `INSERT INTO repair.crb_overrides
       (tenant_id, scope, target_id, finding_id, rule_id, rule_code, rule_version,
        reason, source, attachment_name, attachment_bytes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'user',$9,$10,$11)
     RETURNING id`,
    [
      TENANT,
      opts.scope,
      opts.targetId,
      opts.findingId ?? null,
      ruleId,
      ruleCode,
      ruleVersion,
      opts.reason.trim(),
      opts.attachmentName ?? null,
      opts.attachment ?? null,
      opts.actor,
    ],
  );
  if (opts.scope === "CAR") {
    await q(`UPDATE repair.crb_cars SET status = 'OVERRIDDEN' WHERE id = $1 AND status = 'PENDING'`, [
      opts.targetId,
    ]);
    const { rows: car } = await q<{ invoice_id: string }>(
      `SELECT invoice_id FROM repair.crb_cars WHERE id = $1`,
      [opts.targetId],
    );
    if (car[0]) await refreshReady(car[0].invoice_id);
  }
  if (invoiceId) await refreshErrorPanel(invoiceId);
  await logCrb(opts.actor, "override", opts.scope, opts.targetId, {
    findingId: opts.findingId ?? null,
    ruleCode,
    ruleVersion,
    reason: opts.reason.trim(),
  });
  return { ok: true, overrideId: rows[0].id };
}

async function openMonthId(preferredLabel: string | null): Promise<{ id: string; label: string } | null> {
  if (preferredLabel) {
    const { rows } = await q<{ id: string; month_label: string; status: string }>(
      `SELECT id, month_label, status FROM repair.accounting_months
       WHERE tenant_id = $1 AND month_label = $2 AND deleted_at IS NULL`,
      [TENANT, preferredLabel],
    );
    if (rows[0]?.status === "OPEN") return { id: rows[0].id, label: rows[0].month_label };
  }
  const { rows } = await q<{ id: string; month_label: string }>(
    `SELECT id, month_label FROM repair.accounting_months
     WHERE tenant_id = $1 AND status = 'OPEN' AND deleted_at IS NULL
     LIMIT 1`,
    [TENANT],
  );
  return rows[0] ? { id: rows[0].id, label: rows[0].month_label } : null;
}

export async function setInvoiceStatus(opts: {
  invoiceId: string;
  status: "APPROVED" | "RETURN_UNPAID" | "APPROVED_WITH_EXCEPTIONS";
  actor: string;
  monthBucketId?: string | null;
}): Promise<ActionResult<{ poolLines: number; monthLabel: string | null }>> {
  const { rows } = await q<{
    id: string;
    status: string;
    receipt_date: string | null;
  }>(
    `SELECT id, status, receipt_date::text FROM repair.crb_invoices WHERE id = $1`,
    [opts.invoiceId],
  );
  const inv = rows[0];
  if (!inv) return fail(404, "Invoice not found");
  const ready = await refreshReady(inv.id);
  const { rows: pending } = await q<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM repair.crb_cars WHERE invoice_id = $1 AND status = 'PENDING'`,
    [inv.id],
  );
  if (Number(pending[0]?.n ?? 0) > 0 || (ready !== "READY" && ready !== inv.status)) {
    if (Number(pending[0]?.n ?? 0) > 0) {
      return fail(409, "Invoice approve is disabled until every car is decided.");
    }
  }
  const stops = await hardStops(inv.id);
  if (stops > 0 && opts.status !== "RETURN_UNPAID") {
    return fail(409, `Unresolved hard stops (${stops}) block approval.`);
  }
  let monthLabel: string | null = null;
  let poolLines = 0;
  if (opts.status === "APPROVED" || opts.status === "APPROVED_WITH_EXCEPTIONS") {
    const receiptLabel = inv.receipt_date ? String(inv.receipt_date).slice(0, 7) : null;
    let month: { id: string; label: string } | null = null;
    if (opts.monthBucketId) {
      const { rows: chosen } = await q<{ id: string; month_label: string; status: string }>(
        `SELECT id, month_label, status FROM repair.accounting_months
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [opts.monthBucketId, TENANT],
      );
      if (!chosen[0]) return fail(404, "Month bucket not found");
      if (chosen[0].status !== "OPEN") {
        return fail(409, "Closed months are not reopened. Choose the open month.");
      }
      month = { id: chosen[0].id, label: chosen[0].month_label };
    } else {
      const preferred = await openMonthId(receiptLabel);
      if (!preferred) {
        return fail(409, "Receipt month is closed and there is no open month. Closed months stay closed.");
      }
      month = preferred;
    }
    monthLabel = month.label;
    if (opts.status === "APPROVED_WITH_EXCEPTIONS") {
      await q(
        `UPDATE repair.audit_findings
         SET status = 'ACCEPTED_AS_EXCEPTION'
         WHERE invoice_id = $1 AND status = 'OPEN'`,
        [inv.id],
      );
    }
    await q(
      `UPDATE repair.crb_lines SET status = 'APPROVED'
       WHERE invoice_id = $1 AND status = 'PENDING'`,
      [inv.id],
    );
    const { rows: lines } = await q<{
      id: string;
      bucket_hint: string | null;
      labor_cents: string;
      material_cents: string;
      car_initial: string;
      car_number: string;
      detail_source: string | null;
    }>(
      `SELECT l.id, l.bucket_hint, l.labor_cents::text, l.material_cents::text,
              c.car_initial, c.car_number, l.detail_source
       FROM repair.crb_lines l
       JOIN repair.crb_cars c ON c.id = l.car_id
       WHERE l.invoice_id = $1 AND l.status = 'APPROVED'`,
      [inv.id],
    );
    for (const line of lines) {
      await q(
        `INSERT INTO repair.month_pool_lines
           (tenant_id, accounting_month_id, source, crb_line_id, bucket_hint, amount_cents,
            car_initial, car_number, detail_source, created_by)
         VALUES ($1,$2,'CRB',$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (crb_line_id) DO NOTHING`,
        [
          TENANT,
          month.id,
          line.id,
          line.bucket_hint,
          Number(line.labor_cents) + Number(line.material_cents),
          line.car_initial,
          line.car_number,
          line.detail_source,
          opts.actor,
        ],
      );
      poolLines += 1;
    }
    await q(`UPDATE repair.crb_invoices SET month_bucket_id = $2 WHERE id = $1`, [inv.id, month.id]);
  }
  await q(`UPDATE repair.crb_invoices SET status = $2 WHERE id = $1`, [inv.id, opts.status]);
  await refreshErrorPanel(inv.id);
  await logCrb(opts.actor, "invoice_status", "INVOICE", inv.id, {
    status: opts.status,
    monthLabel,
    poolLines,
  });
  return { ok: true, poolLines, monthLabel };
}

export async function saveCorrection(opts: {
  scope: "CAR" | "LINE";
  id: string;
  field: string;
  value: string;
  reason: string;
  actor: string;
}): Promise<ActionResult> {
  if (!opts.reason || opts.reason.trim().length < REASON_MIN) {
    return fail(400, `Reason is required (at least ${REASON_MIN} characters).`);
  }
  if (!/^[a-z0-9_]+$/i.test(opts.field)) return fail(400, "Unknown field");
  const table = opts.scope === "CAR" ? "repair.crb_cars" : "repair.crb_lines";
  const { rows } = await q<{ id: string }>(`SELECT id FROM ${table} WHERE id = $1`, [opts.id]);
  if (!rows[0]) return fail(404, "Not found");
  await q(
    `UPDATE ${table}
     SET proposed_corrections = proposed_corrections || $2::jsonb
     WHERE id = $1`,
    [opts.id, JSON.stringify({ [opts.field]: opts.value })],
  );
  await logCrb(opts.actor, "proposed_correction", opts.scope, opts.id, {
    field: opts.field,
    value: opts.value,
    reason: opts.reason.trim(),
  });
  return { ok: true };
}

export async function upsertBillerHeader(opts: {
  billingParty: string;
  invoiceNumber: string;
  accountMonth: string;
  invoiceDate?: string | null;
  receivedDate?: string | null;
  totalCents?: number | null;
  carCount?: number | null;
  attachmentName?: string | null;
  attachment?: Buffer | null;
  actor: string;
}): Promise<ActionResult<{ id: string }>> {
  const billing = opts.billingParty.trim();
  const invoice = opts.invoiceNumber.trim();
  const account = opts.accountMonth.trim();
  if (!billing || !invoice || !/^\d{4}$/.test(account)) {
    return fail(400, "Billing party, invoice number, and account month (YYMM) are required.");
  }
  const { rows } = await q<{ id: string }>(
    `INSERT INTO repair.biller_invoice_headers
       (tenant_id, billing_party, invoice_number, account_month, invoice_date, received_date,
        total_cents, car_count, attachment_name, attachment_bytes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (tenant_id, billing_party, invoice_number, account_month)
     DO UPDATE SET invoice_date = EXCLUDED.invoice_date,
                   received_date = EXCLUDED.received_date,
                   total_cents = EXCLUDED.total_cents,
                   car_count = EXCLUDED.car_count,
                   attachment_name = COALESCE(EXCLUDED.attachment_name, repair.biller_invoice_headers.attachment_name),
                   attachment_bytes = COALESCE(EXCLUDED.attachment_bytes, repair.biller_invoice_headers.attachment_bytes)
     RETURNING id`,
    [
      TENANT,
      billing,
      invoice,
      account,
      opts.invoiceDate || null,
      opts.receivedDate || null,
      opts.totalCents ?? null,
      opts.carCount ?? null,
      opts.attachmentName ?? null,
      opts.attachment ?? null,
      opts.actor,
    ],
  );
  const { rows: match } = await q<{ id: string }>(
    `SELECT i.id FROM repair.crb_invoices i
     JOIN repair.crb_files f ON f.id = i.file_id AND f.version_status = 'ACTIVE'
     WHERE i.tenant_id = $1 AND i.billing_party = $2 AND i.invoice_number = $3 AND i.account_date = $4
     ORDER BY i.created_at DESC LIMIT 1`,
    [TENANT, billing, invoice, account],
  );
  if (match[0]) await reauditInvoice(match[0].id, opts.actor);
  await flagOrphanBillerHeaders();
  await logCrb(opts.actor, "biller_header", "BILLER", rows[0].id, {
    billing,
    invoice,
    account,
  });
  return { ok: true, id: rows[0].id };
}

export async function listCrbFiles(): Promise<Record<string, unknown>[]> {
  const { rows } = await q(
    `SELECT id, file_name, sha256, control_status, version_status, record_counts,
            account_months, billed_party, uploaded_at, dx_outbound_date, parse_errors,
            superseded_by
     FROM repair.crb_files
     WHERE tenant_id = $1
     ORDER BY uploaded_at DESC`,
    [TENANT],
  );
  return rows;
}

export async function listUnmatchedBillerHeaders(): Promise<Record<string, unknown>[]> {
  const { rows } = await q(
    `SELECT h.id, h.billing_party, h.invoice_number, h.account_month, h.total_cents, h.car_count,
            f.message
     FROM repair.biller_invoice_headers h
     JOIN repair.audit_findings f
       ON f.target_id = h.id
      AND f.rule_code = 'BILLER_RECON'
      AND f.status = 'OPEN'
      AND f.message LIKE 'BILLER_INVOICE_WITHOUT_CRB%'
     WHERE h.tenant_id = $1
     ORDER BY h.account_month DESC, h.billing_party, h.invoice_number`,
    [TENANT],
  );
  return rows;
}

export async function listCrbInvoices(filters: {
  biller?: string;
  billedParty?: string;
  accountMonth?: string;
  status?: string;
  hasExceptions?: boolean;
  hardStops?: boolean;
  minCents?: number | null;
  maxCents?: number | null;
  dueSoon?: boolean;
  carNumbers?: string[];
}): Promise<Record<string, unknown>[]> {
  const where = ["i.tenant_id = $1", "f.version_status = 'ACTIVE'"];
  const params: unknown[] = [TENANT];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (filters.biller) add("i.billing_party = ?", filters.biller);
  if (filters.billedParty) add("i.billed_party = ?", filters.billedParty);
  if (filters.accountMonth) add("i.account_date = ?", filters.accountMonth);
  if (filters.status) add("i.status = ?", filters.status);
  if (filters.minCents != null) add("i.grand_total_cents >= ?", filters.minCents);
  if (filters.maxCents != null) add("i.grand_total_cents <= ?", filters.maxCents);
  const carTokens = (filters.carNumbers ?? []).map((token) => token.trim().toUpperCase()).filter(Boolean);
  if (carTokens.length) {
    params.push(carTokens);
    const tokenParam = `$${params.length}`;
    where.push(`EXISTS (
      SELECT 1 FROM repair.crb_cars c
      WHERE c.invoice_id = i.id
        AND (
          upper(btrim(c.car_number)) = ANY(${tokenParam}::text[])
          OR upper(btrim(c.car_initial) || btrim(c.car_number)) = ANY(${tokenParam}::text[])
          OR upper(btrim(c.car_initial) || ' ' || btrim(c.car_number)) = ANY(${tokenParam}::text[])
        )
    )`);
  }
  const { rows } = await q<Record<string, unknown>>(
    `SELECT i.id, i.invoice_number, i.billing_party, i.billed_party, i.account_date, i.status,
            i.grand_total_cents, i.car_count, i.control_ok, i.error_panel, i.receipt_date,
            i.currency, i.resubmitted, i.reviewed,
            (SELECT COUNT(*) FROM repair.crb_cars c WHERE c.invoice_id = i.id AND c.status <> 'PENDING') AS cars_decided,
            (SELECT COUNT(*) FROM repair.crb_cars c WHERE c.invoice_id = i.id) AS cars_total,
            (SELECT COUNT(*) FROM repair.audit_findings af
              JOIN repair.audit_rules ar ON ar.id = af.rule_id
              WHERE af.invoice_id = i.id AND af.status = 'OPEN' AND ar.severity = 'HARD_STOP') AS hard_stops,
            (SELECT COUNT(*) FROM repair.audit_findings af
              WHERE af.invoice_id = i.id AND af.status IN ('OPEN','ACCEPTED_AS_EXCEPTION')
                AND af.invalid = false AND af.amount_in_question_cents <> 0) AS exceptions
     FROM repair.crb_invoices i
     JOIN repair.crb_files f ON f.id = i.file_id
     WHERE ${where.join(" AND ")}
     ORDER BY i.account_date DESC, i.billing_party, i.invoice_number`,
    params,
  );
  return rows.filter((row) => {
    if (filters.hasExceptions && Number(row.exceptions) <= 0) return false;
    if (filters.hardStops && Number(row.hard_stops) <= 0) return false;
    if (filters.dueSoon) {
      const panel = row.error_panel as { countdowns?: Array<{ daysLeft: number | null; tone: string }> } | null;
      const soon = panel?.countdowns?.some((c) => c.tone === "warn" || c.tone === "stop");
      if (!soon) return false;
    }
    return true;
  });
}

export async function getCrbInvoice(id: string): Promise<Record<string, unknown> | null> {
  const { rows } = await q(
    `SELECT i.*, h.id AS biller_header_id, h.total_cents AS biller_total_cents,
            h.car_count AS biller_car_count, h.received_date AS biller_received_date,
            h.invoice_date AS biller_invoice_date
     FROM repair.crb_invoices i
     LEFT JOIN repair.biller_invoice_headers h ON h.crb_invoice_id = i.id
     WHERE i.id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: cars } = await q(
    `SELECT id, car_initial, car_number, kind, status, lessee_name, owned_on_repair_date,
            line_count, labor_cents, material_cents, total_cents, flags, lease_id, repair_date,
            (
              SELECT COUNT(*)::int
              FROM repair.audit_findings f
              WHERE f.invoice_id = repair.crb_cars.invoice_id
                AND (
                  f.target_id = repair.crb_cars.id
                  OR f.target_id IN (SELECT l.id FROM repair.crb_lines l WHERE l.car_id = repair.crb_cars.id)
                )
            ) AS finding_count
     FROM repair.crb_cars WHERE invoice_id = $1
     ORDER BY car_number, car_initial`,
    [id],
  );
  const { rows: packages } = await q(
    `SELECT id, type, letter_seq, status, filed_at, filed_by, response_code, response_at,
            cba_no, cba_amount_cents, cba_date, pdf_path, xlsx_path, draft500_path, created_at
     FROM repair.exception_packages WHERE invoice_id = $1 ORDER BY letter_seq, created_at`,
    [id],
  );
  const { rows: findings } = await q(
    `SELECT f.id, f.rule_code, f.rule_version, f.scope, f.message, f.status, f.invalid,
            f.amount_in_question_cents, f.exempt_type, r.severity, r.rule_ref
     FROM repair.audit_findings f
     LEFT JOIN repair.audit_rules r ON r.id = f.rule_id
     WHERE f.invoice_id = $1
     ORDER BY f.created_at`,
    [id],
  );
  return { ...rows[0], cars, packages, findings };
}

type CodeFace = { found: boolean; description: string };

async function codeFace(kind: RefLookupKind, code: string, qualifier?: string | null): Promise<CodeFace> {
  const hit = await lookupRefCode({ kind, code: code.trim(), qualifier });
  return {
    found: hit.found,
    description: hit.found ? hit.description : "Not in reference table",
  };
}

async function withDecodedCodes(lines: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const cache = new Map<string, Promise<CodeFace>>();
  function load(kind: RefLookupKind, code: string, qualifier?: string | null): Promise<CodeFace> {
    const key = `${kind}|${code.trim()}|${qualifier ?? ""}`;
    const pending = cache.get(key);
    if (pending) return pending;
    const next = codeFace(kind, code, qualifier);
    cache.set(key, next);
    return next;
  }
  const decoded = await Promise.all(lines.map(async (line) => {
    const job = String(line.applied_job_code ?? "");
    const qualifier = String(line.applied_qualifier ?? "");
    const [jobFace, qualifierFace, whyMade, condition, location, responsibility, recordFormat] = await Promise.all([
      load("job", job),
      load("qualifier", job, qualifier),
      load("why_made", String(line.why_made ?? "")),
      load("condition", String(line.condition_code ?? "")),
      load("location", String(line.location_on_car ?? "")),
      load("responsibility", String(line.responsibility ?? "")),
      load("record_format", String(line.record_format ?? "")),
    ]);
    return {
      ...line,
      decoded: {
        job: jobFace,
        qualifier: qualifierFace,
        why_made: whyMade,
        condition,
        location,
        responsibility,
        record_format: recordFormat,
      },
    };
  }));
  return decoded;
}

export async function getCrbCar(carId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await q(
    `SELECT c.*, i.invoice_number, i.billing_party, i.billed_party, i.account_date, i.currency,
            i.id AS invoice_id, i.status AS invoice_status
     FROM repair.crb_cars c
     JOIN repair.crb_invoices i ON i.id = c.invoice_id
     WHERE c.id = $1`,
    [carId],
  );
  if (!rows[0]) return null;
  const { rows: lines } = await q(
    `SELECT l.*, r.raw_line, r.record_format
     FROM repair.crb_lines l
     LEFT JOIN repair.crb_records r ON r.id = l.record_id
     WHERE l.car_id = $1
     ORDER BY l.sort_order`,
    [carId],
  );
  const lineIds = lines.map((line) => line.id);
  const { rows: findings } = lineIds.length
    ? await q(
        `SELECT f.*, ar.severity, ar.rule_ref
         FROM repair.audit_findings f
         LEFT JOIN repair.audit_rules ar ON ar.id = f.rule_id
         WHERE f.target_id = ANY($1::uuid[]) OR (f.scope = 'CAR' AND f.target_id = $2)`,
        [lineIds, carId],
      )
    : { rows: [] };
  const { rows: neighbors } = await q<{ id: string; car_number: string }>(
    `SELECT id, car_number FROM repair.crb_cars WHERE invoice_id = $1 ORDER BY car_number, car_initial`,
    [rows[0].invoice_id],
  );
  const idx = neighbors.findIndex((n) => n.id === carId);
  return {
    ...rows[0],
    lines: await withDecodedCodes(lines),
    findings,
    prevCarId: idx > 0 ? neighbors[idx - 1].id : null,
    nextCarId: idx >= 0 && idx < neighbors.length - 1 ? neighbors[idx + 1].id : null,
  };
}

export async function nextUndecidedCar(afterId?: string | null): Promise<{ carId: string; invoiceId: string } | null> {
  const { rows } = await q<{ id: string; invoice_id: string }>(
    `SELECT c.id, c.invoice_id
     FROM repair.crb_cars c
     JOIN repair.crb_invoices i ON i.id = c.invoice_id
     JOIN repair.crb_files f ON f.id = i.file_id AND f.version_status = 'ACTIVE'
     WHERE c.status = 'PENDING' AND c.tenant_id = $1
     ORDER BY i.account_date, i.invoice_number, c.car_number, c.id`,
    [TENANT],
  );
  if (!rows.length) return null;
  if (!afterId) return { carId: rows[0].id, invoiceId: rows[0].invoice_id };
  const idx = rows.findIndex((row) => row.id === afterId);
  const next = rows[(idx + 1) % rows.length];
  return { carId: next.id, invoiceId: next.invoice_id };
}

export async function markInvoicesReviewed(ids: string[], actor: string): Promise<ActionResult<{ updated: number }>> {
  if (!ids.length) return fail(400, "Select at least one invoice.");
  const { rowCount } = await q(
    `UPDATE repair.crb_invoices
     SET reviewed = true,
         status = CASE WHEN status = 'PENDING' THEN 'IN_REVIEW' ELSE status END
     WHERE id = ANY($1::uuid[]) AND status NOT IN ('APPROVED', 'RETURN_UNPAID', 'APPROVED_WITH_EXCEPTIONS')`,
    [ids],
  );
  await logCrb(actor, "mark_reviewed", "INVOICE", null, { ids });
  return { ok: true, updated: rowCount ?? 0 };
}

type RuleRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  rule_ref: string | null;
  params: Record<string, unknown>;
  enabled: boolean;
  severity: Severity;
  effective_from: string;
  effective_to: string | null;
  version: number;
  created_by: string | null;
  created_at: string;
};

export async function listAuditRules(): Promise<RuleRow[]> {
  const { rows } = await q<RuleRow>(
    `SELECT id, code, name, description, rule_ref, params, enabled, severity,
            effective_from::text, effective_to::text, version, created_by, created_at::text
     FROM repair.audit_rules WHERE tenant_id = $1
     ORDER BY code, version`,
    [TENANT],
  );
  return rows;
}

async function ruleInClosedMonth(ruleId: string): Promise<boolean> {
  const { rows } = await q<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM repair.audit_findings f
     JOIN repair.crb_invoices i ON i.id = f.invoice_id
     JOIN repair.accounting_months m ON m.id = i.month_bucket_id
     WHERE f.rule_id = $1 AND m.status = 'CLOSED' AND m.deleted_at IS NULL`,
    [ruleId],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

export async function updateAuditRule(opts: {
  id: string;
  params?: Record<string, unknown>;
  enabled?: boolean;
  severity?: Severity;
  actor: string;
}): Promise<ActionResult> {
  if (await ruleInClosedMonth(opts.id)) {
    return fail(409, "This version is in use by a closed month. Clone a new version instead.");
  }
  const sets: string[] = [];
  const params: unknown[] = [opts.id];
  if (opts.params) {
    params.push(JSON.stringify(opts.params));
    sets.push(`params = $${params.length}::jsonb`);
  }
  if (opts.enabled != null) {
    params.push(opts.enabled);
    sets.push(`enabled = $${params.length}`);
  }
  if (opts.severity) {
    params.push(opts.severity);
    sets.push(`severity = $${params.length}`);
  }
  if (!sets.length) return fail(400, "Nothing to update");
  params.push(TENANT);
  await q(
    `UPDATE repair.audit_rules SET ${sets.join(", ")} WHERE id = $1 AND tenant_id = $${params.length}`,
    params,
  );
  await logCrb(opts.actor, "edit_rule", "RULE", opts.id, {
    enabled: opts.enabled ?? null,
    severity: opts.severity ?? null,
  });
  return { ok: true };
}

export async function cloneAuditRule(opts: {
  id: string;
  effectiveFrom: string;
  params?: Record<string, unknown>;
  severity?: Severity;
  enabled?: boolean;
  actor: string;
}): Promise<ActionResult<{ id: string; version: number }>> {
  const { rows } = await q<RuleRow>(
    `SELECT * FROM repair.audit_rules WHERE id = $1 AND tenant_id = $2`,
    [opts.id, TENANT],
  );
  const current = rows[0];
  if (!current) return fail(404, "Rule not found");
  const { rows: max } = await q<{ v: number }>(
    `SELECT COALESCE(MAX(version), 0)::int AS v FROM repair.audit_rules
     WHERE tenant_id = $1 AND code = $2`,
    [TENANT, current.code],
  );
  const version = Number(max[0]?.v ?? 0) + 1;
  const from = opts.effectiveFrom;
  await q(
    `UPDATE repair.audit_rules
     SET effective_to = ($3::date - INTERVAL '1 day')::date
     WHERE tenant_id = $1 AND code = $2 AND effective_to IS NULL AND id <> $4`,
    [TENANT, current.code, from, opts.id],
  );
  await q(
    `UPDATE repair.audit_rules SET effective_to = ($2::date - INTERVAL '1 day')::date
     WHERE id = $1 AND (effective_to IS NULL OR effective_to >= $2::date)`,
    [current.id, from],
  );
  const { rows: created } = await q<{ id: string }>(
    `INSERT INTO repair.audit_rules
       (tenant_id, code, name, description, rule_ref, params, enabled, severity,
        effective_from, version, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      TENANT,
      current.code,
      current.name,
      current.description,
      current.rule_ref,
      JSON.stringify(opts.params ?? current.params),
      opts.enabled ?? current.enabled,
      opts.severity ?? current.severity,
      from,
      version,
      opts.actor,
    ],
  );
  await logCrb(opts.actor, "clone_rule", "RULE", created[0].id, {
    from: current.id,
    version,
    effectiveFrom: from,
  });
  return { ok: true, id: created[0].id, version };
}

export async function listStandingExceptions(): Promise<Record<string, unknown>[]> {
  const { rows } = await q(
    `SELECT * FROM repair.standing_exceptions WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [TENANT],
  );
  return rows;
}

export async function createStandingException(opts: {
  ruleCode: string;
  reason: string;
  actor: string;
  biller?: string | null;
  repairingParty?: string | null;
  leaseId?: string | null;
  lesseeId?: string | null;
  carMark?: string | null;
  carNumberFrom?: string | null;
  carNumberTo?: string | null;
  jobCode?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  if (!opts.reason || opts.reason.trim().length < REASON_MIN) {
    return fail(400, `Reason is required (at least ${REASON_MIN} characters).`);
  }
  const { rows } = await q<{ id: string }>(
    `INSERT INTO repair.standing_exceptions
       (tenant_id, rule_code, biller, repairing_party, lease_id, lessee_id, car_mark,
        car_number_from, car_number_to, job_code, reason, effective_from, effective_to, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      TENANT,
      opts.ruleCode,
      opts.biller ?? null,
      opts.repairingParty ?? null,
      opts.leaseId ?? null,
      opts.lesseeId ?? null,
      opts.carMark ?? null,
      opts.carNumberFrom ?? null,
      opts.carNumberTo ?? null,
      opts.jobCode ?? null,
      opts.reason.trim(),
      opts.effectiveFrom,
      opts.effectiveTo ?? null,
      opts.actor,
    ],
  );
  await logCrb(opts.actor, "standing_exception", "RULE", rows[0].id, { ruleCode: opts.ruleCode });
  return { ok: true, id: rows[0].id };
}

export function ruleVersionForAccount(
  rules: Array<{ code: string; version: number; enabled: boolean; effectiveFrom: string; effectiveTo: string | null; params: Record<string, unknown>; severity: Severity }>,
  code: string,
  accountYymm: string,
) {
  return selectRuleVersion(rules, code, accountYymm);
}
