/**
 * Load a CRB file into the repair schema, link cars, and run audit rules.
 * Local Postgres only. No outbound network calls.
 */
import { createHash } from "node:crypto";
import { DEFAULT_TENANT_ID, q } from "../../db";
import {
  balanceReport,
  invoiceKeyOf,
  parseUpload,
  signedMaterial,
  trimField,
  yymmddToIso,
  type ParsedRecord,
} from "./parse500";
import {
  SEED_RULES,
  bucketHintFor,
  buildErrorPanel,
  datesWithin,
  evaluateLine,
  receiptDateOf,
  repairIso,
  selectRuleVersion,
  tiersFrom,
  type FindingDraft,
  type LineFacts,
  type RuleVersion,
  type Severity,
} from "./rules";

const TENANT = DEFAULT_TENANT_ID;

export type UploadResult = {
  fileId: string;
  noop: boolean;
  controlStatus: "BALANCED" | "OUT_OF_BALANCE";
  superseded: string[];
};

type DbRule = RuleVersion & { id: string; name: string; severity: Severity };

export async function ensureAuditRules(actor = "crb-seed"): Promise<void> {
  for (const rule of SEED_RULES) {
    await q(
      `INSERT INTO repair.audit_rules
         (tenant_id, code, name, description, rule_ref, params, enabled, severity,
          effective_from, version, created_by)
       SELECT $1, $2, $3, $4, $5, $6::jsonb, true, $7, DATE '2026-01-01', 1, $8
       WHERE NOT EXISTS (
         SELECT 1 FROM repair.audit_rules
         WHERE tenant_id = $1 AND code = $2 AND version = 1
       )`,
      [
        TENANT,
        rule.code,
        rule.name,
        rule.description,
        rule.ruleRef,
        JSON.stringify(rule.params),
        rule.severity,
        actor,
      ],
    );
  }
}

async function loadRules(): Promise<DbRule[]> {
  const { rows } = await q<{
    id: string;
    code: string;
    version: number;
    params: Record<string, unknown>;
    severity: Severity;
    enabled: boolean;
    effective_from: string;
    effective_to: string | null;
    name: string;
  }>(
    `SELECT id, code, version, params, severity, enabled,
            effective_from::text, effective_to::text, name
     FROM repair.audit_rules
     WHERE tenant_id = $1`,
    [TENANT],
  );
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    version: Number(row.version),
    params: row.params ?? {},
    severity: row.severity,
    enabled: row.enabled,
    effectiveFrom: String(row.effective_from).slice(0, 10),
    effectiveTo: row.effective_to ? String(row.effective_to).slice(0, 10) : null,
    name: row.name,
  }));
}

export async function logCrb(
  actor: string,
  action: string,
  scope: string | null,
  targetId: string | null,
  detail: Record<string, unknown>,
): Promise<void> {
  await q(
    `INSERT INTO repair.crb_audit_log (tenant_id, actor, action, scope, target_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [TENANT, actor, action, scope, targetId, JSON.stringify(detail)],
  );
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = "";
  let n = 0;
  for (const [key, count] of Array.from(counts.entries())) {
    if (count > n) {
      best = key;
      n = count;
    }
  }
  return best;
}

type ShopHit = {
  invoiceNo: string;
  carMark: string;
  carNumber: string;
  job: string;
  qualifier: string;
  location: string;
  repairDate: string | null;
};

async function shopHits(): Promise<ShopHit[]> {
  const { rows } = await q<{
    invoice_no: string;
    car_mark: string;
    car_number: string;
    aar_job_code: string | null;
    qualifier: string | null;
    location_on_car: string | null;
    raw_line: string | null;
  }>(
    `SELECT i.invoice_no, e.car_mark, e.car_number,
            il.aar_job_code, il.qualifier, il.location_on_car, il.raw_line
     FROM repair.invoice_lines il
     JOIN repair.invoices i ON i.id = il.invoice_id AND i.deleted_at IS NULL
     JOIN repair.events e ON e.id = i.event_id AND e.deleted_at IS NULL
     WHERE i.tenant_id = $1`,
    [TENANT],
  );
  return rows.map((row) => {
    const raw = row.raw_line ?? "";
    const repair = raw.length >= 65 ? repairIso(raw.slice(59, 65)) : null;
    return {
      invoiceNo: trimField(row.invoice_no),
      carMark: trimField(row.car_mark).toUpperCase(),
      carNumber: trimField(row.car_number).replace(/\D/g, "").padStart(6, "0"),
      job: trimField(row.aar_job_code),
      qualifier: trimField(row.qualifier),
      location: trimField(row.location_on_car),
      repairDate: repair,
    };
  });
}

function normCar(num: string): string {
  const digits = num.replace(/\D/g, "");
  return (digits || num).padStart(6, "0");
}

type LineRow = {
  id: string;
  invoice_id: string;
  car_id: string;
  line_number: string | null;
  detail_source: string | null;
  responsibility: string | null;
  dc_party: string | null;
  labor_cents: string;
  material_cents: string;
  machine_priceable: string | null;
  wrong_repair: string | null;
  why_made: string | null;
  narrative: string | null;
  applied_job_code: string | null;
  applied_qualifier: string | null;
  location_on_car: string | null;
  repairing_party: string | null;
  repairing_party_invoice: string | null;
  repair_date: string | null;
  kind_of_car: string | null;
  load_empty: string | null;
  parsed: Record<string, string>;
  car_initial: string;
  car_number: string;
  lease_id: string | null;
  lessee_id: string | null;
  owned_on_repair_date: boolean | null;
  valid_car_id: string | null;
  billing_party: string;
  account_date: string;
  invoice_number: string;
};

export async function reauditInvoice(invoiceId: string, actor: string): Promise<void> {
  await ensureAuditRules(actor);
  const rules = await loadRules();
  await q(
    `DELETE FROM repair.audit_findings
     WHERE invoice_id = $1 AND status <> 'OVERRIDDEN'`,
    [invoiceId],
  );
  await auditInvoice(invoiceId, rules);
  await applyStanding(invoiceId, actor);
  await refreshErrorPanel(invoiceId);
  await logCrb(actor, "reaudit", "INVOICE", invoiceId, {});
}

async function priceFor(job: string, qualifier: string): Promise<{ loaded: boolean; cents: number | null }> {
  const { rows: countRows } = await q<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM repair.ref_job_code_prices
     WHERE tenant_id = $1 AND deleted_at IS NULL AND active = true`,
    [TENANT],
  );
  const loaded = Number(countRows[0]?.n ?? 0) > 0;
  if (!loaded || !job) return { loaded, cents: null };
  const { rows } = await q<{ labor_cents: string | null; material_cents: string | null; price_cents: string | null }>(
    `SELECT labor_cents, material_cents, price_cents
     FROM repair.ref_job_code_prices
     WHERE tenant_id = $1 AND deleted_at IS NULL AND active = true
       AND job_code = $2
       AND (qualifier IS NULL OR qualifier = '' OR qualifier = $3)
     ORDER BY CASE WHEN qualifier = $3 THEN 0 ELSE 1 END
     LIMIT 1`,
    [TENANT, job, qualifier],
  );
  if (!rows[0]) return { loaded: true, cents: null };
  const labor = Number(rows[0].labor_cents ?? 0);
  const material = Number(rows[0].material_cents ?? 0);
  const price = rows[0].price_cents != null ? Number(rows[0].price_cents) : labor + material;
  return { loaded: true, cents: price };
}

async function insertFinding(
  invoiceId: string | null,
  rules: DbRule[],
  accountDate: string,
  draft: FindingDraft,
  targetId: string | null,
): Promise<void> {
  const version = selectRuleVersion(rules, draft.code, accountDate);
  if (!version?.id) return;
  if (targetId) {
    const { rows } = await q<{ id: string }>(
      `SELECT id FROM repair.audit_findings
       WHERE rule_code = $1 AND target_id = $2 AND status = 'OVERRIDDEN'
       LIMIT 1`,
      [draft.code, targetId],
    );
    if (rows[0]) return;
  }
  await q(
    `INSERT INTO repair.audit_findings
       (tenant_id, rule_id, rule_code, rule_version, scope, target_id, invoice_id,
        amount_in_question_cents, suggested_correct_amount_cents, message, status, invalid, exempt_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'OPEN',$11,$12)`,
    [
      TENANT,
      version.id,
      draft.code,
      version.version,
      draft.scope,
      targetId,
      invoiceId,
      draft.amountInQuestionCents,
      draft.suggestedCorrectCents,
      draft.message,
      draft.invalid,
      draft.exemptType,
    ],
  );
}

async function auditInvoice(invoiceId: string, rules: DbRule[]): Promise<void> {
  const { rows: invRows } = await q<{
    id: string;
    billing_party: string;
    invoice_number: string;
    account_date: string;
    control_ok: boolean;
    file_id: string;
    grand_total_cents: string;
    car_count: number;
  }>(
    `SELECT id, billing_party, invoice_number, account_date, control_ok, file_id,
            grand_total_cents::text, car_count
     FROM repair.crb_invoices WHERE id = $1`,
    [invoiceId],
  );
  const inv = invRows[0];
  if (!inv) return;
  const dupRule = selectRuleVersion(rules, "DUPLICATE_BILLING", inv.account_date);
  const windowDays = Number(dupRule?.params.window_days ?? 30);
  const shops = await shopHits();
  const { rows: lines } = await q<LineRow>(
    `SELECT l.id, l.invoice_id, l.car_id, l.line_number, l.detail_source, l.responsibility,
            l.dc_party, l.labor_cents::text, l.material_cents::text, l.machine_priceable,
            l.wrong_repair, l.why_made, l.narrative, l.applied_job_code, l.applied_qualifier,
            l.location_on_car, l.repairing_party, l.repairing_party_invoice,
            l.repair_date::text, l.kind_of_car, l.load_empty, l.parsed,
            c.car_initial, c.car_number, c.lease_id, c.lessee_id, c.owned_on_repair_date,
            c.valid_car_id::text, i.billing_party, i.account_date, i.invoice_number
     FROM repair.crb_lines l
     JOIN repair.crb_cars c ON c.id = l.car_id
     JOIN repair.crb_invoices i ON i.id = l.invoice_id
     WHERE l.invoice_id = $1
     ORDER BY l.sort_order`,
    [invoiceId],
  );
  const { rows: peers } = await q<{
    id: string;
    car_initial: string;
    car_number: string;
    applied_job_code: string | null;
    applied_qualifier: string | null;
    location_on_car: string | null;
    repairing_party_invoice: string | null;
    repair_date: string | null;
    invoice_id: string;
  }>(
    `SELECT l.id, c.car_initial, c.car_number, l.applied_job_code, l.applied_qualifier,
            l.location_on_car, l.repairing_party_invoice, l.repair_date::text, l.invoice_id
     FROM repair.crb_lines l
     JOIN repair.crb_cars c ON c.id = l.car_id
     JOIN repair.crb_invoices i ON i.id = l.invoice_id
     JOIN repair.crb_files f ON f.id = i.file_id AND f.version_status = 'ACTIVE'
     WHERE l.invoice_id <> $1`,
    [invoiceId],
  );

  const seenLease = new Set<string>();
  for (const line of lines) {
    const job = trimField(line.applied_job_code);
    const qual = trimField(line.applied_qualifier);
    const loc = trimField(line.location_on_car);
    const carNum = normCar(line.car_number);
    const repair = line.repair_date ? String(line.repair_date).slice(0, 10) : null;
    const shopDup = shops.some((hit) => {
      if (hit.carMark !== line.car_initial.trim().toUpperCase()) return false;
      if (hit.carNumber !== carNum) return false;
      if (hit.job !== job || hit.qualifier !== qual || hit.location !== loc) return false;
      const invoiceMatch = hit.invoiceNo !== "" && hit.invoiceNo === trimField(line.repairing_party_invoice);
      const dateMatch = datesWithin(hit.repairDate, repair, windowDays);
      return invoiceMatch || dateMatch;
    });
    const crbDup = peers.some((peer) => {
      if (normCar(peer.car_number) !== carNum) return false;
      if (trimField(peer.car_initial).toUpperCase() !== line.car_initial.trim().toUpperCase()) return false;
      if (trimField(peer.applied_job_code) !== job) return false;
      if (trimField(peer.applied_qualifier) !== qual) return false;
      if (trimField(peer.location_on_car) !== loc) return false;
      const invoiceMatch =
        trimField(peer.repairing_party_invoice) !== "" &&
        trimField(peer.repairing_party_invoice) === trimField(line.repairing_party_invoice);
      const dateMatch = datesWithin(
        peer.repair_date ? String(peer.repair_date).slice(0, 10) : null,
        repair,
        windowDays,
      );
      return invoiceMatch || dateMatch;
    });
    const price = await priceFor(job, qual);
    const yymmdd = String(line.parsed.repair_date_yymmdd ?? "");
    const facts: LineFacts = {
      detailSource: trimField(line.detail_source),
      responsibility: trimField(line.responsibility),
      dcParty: trimField(line.dc_party),
      dcDate: trimField(line.parsed.dc_jic_date),
      repairDate: yymmdd.trim() || (repair ? repair.slice(2, 4) + repair.slice(5, 7) + repair.slice(8, 10) : ""),
      accountDate: inv.account_date,
      laborCents: Number(line.labor_cents),
      materialCents: Number(line.material_cents),
      machinePriceable: trimField(line.machine_priceable),
      wrongRepair: trimField(line.wrong_repair),
      whyMade: trimField(line.why_made),
      loadEmpty: trimField(line.load_empty),
      kindOfCar: trimField(line.kind_of_car),
      narrative: line.narrative ?? "",
      laborRateCents: Number(trimField(line.parsed.labor_rate) || 0),
      resubmitted: trimField(line.parsed.resubmitted_ind),
      priceTableLoaded: price.loaded,
      priceMasterCents: price.cents,
      duplicate: shopDup || crbDup,
      owned: line.owned_on_repair_date,
      markResidco: line.valid_car_id != null,
    };
    const hasLease = Boolean(line.lease_id);
    const hint = bucketHintFor(facts, hasLease);
    await q(`UPDATE repair.crb_lines SET bucket_hint = $2 WHERE id = $1`, [line.id, hint]);
    for (const draft of evaluateLine(facts, rules)) {
      await insertFinding(invoiceId, rules, inv.account_date, draft, line.id);
    }
    if (line.owned_on_repair_date === true && !line.lease_id && !seenLease.has(line.car_id)) {
      seenLease.add(line.car_id);
      await insertFinding(
        invoiceId,
        rules,
        inv.account_date,
        {
          code: "NO_LEASE",
          scope: "CAR",
          message: "NO_ACTIVE_LEASE",
          amountInQuestionCents: 0,
          suggestedCorrectCents: null,
          invalid: false,
          exemptType: null,
          bucketHint: null,
        },
        line.car_id,
      );
    }
  }

  if (!inv.control_ok) {
    const { rows: fileRows } = await q<{ parse_errors: unknown }>(
      `SELECT parse_errors FROM repair.crb_files WHERE id = $1`,
      [inv.file_id],
    );
    const errors = JSON.stringify(fileRows[0]?.parse_errors ?? []);
    if (errors.includes("FILE_FMT9") || errors.includes("MISSING_FMT9")) {
      await insertFinding(
        invoiceId,
        rules,
        inv.account_date,
        {
          code: "CONTROL_TOTALS",
          scope: "INVOICE",
          message: "CONTROL_TOTALS: format 9 does not match format 1.",
          amountInQuestionCents: 0,
          suggestedCorrectCents: null,
          invalid: false,
          exemptType: null,
          bucketHint: null,
        },
        invoiceId,
      );
    }
    await insertFinding(
      invoiceId,
      rules,
      inv.account_date,
      {
        code: "R112_PROPERLY_RENDERED",
        scope: "INVOICE",
        message: "DETAIL_SOURCE_SUBTOTAL_MISMATCH: invoice subtotals or grand total do not match the DX.",
        amountInQuestionCents: 0,
        suggestedCorrectCents: null,
        invalid: false,
        exemptType: null,
        bucketHint: null,
      },
      invoiceId,
    );
  }
  await reconcileBiller(inv.id, rules);
}

async function reconcileBiller(invoiceId: string, rules: DbRule[]): Promise<void> {
  const { rows } = await q<{
    id: string;
    billing_party: string;
    invoice_number: string;
    account_date: string;
    grand_total_cents: string;
    car_count: number;
    header_id: string | null;
    total_cents: string | null;
    header_cars: number | null;
  }>(
    `SELECT i.id, i.billing_party, i.invoice_number, i.account_date,
            i.grand_total_cents::text, i.car_count,
            h.id AS header_id, h.total_cents::text, h.car_count AS header_cars
     FROM repair.crb_invoices i
     LEFT JOIN repair.biller_invoice_headers h
       ON h.tenant_id = i.tenant_id
      AND h.billing_party = i.billing_party
      AND h.invoice_number = i.invoice_number
      AND h.account_month = i.account_date
     WHERE i.id = $1`,
    [invoiceId],
  );
  const inv = rows[0];
  if (!inv) return;
  if (inv.header_id) {
    await q(`UPDATE repair.biller_invoice_headers SET crb_invoice_id = $2 WHERE id = $1`, [
      inv.header_id,
      invoiceId,
    ]);
    if (inv.total_cents != null && Number(inv.total_cents) !== Number(inv.grand_total_cents)) {
      await insertFinding(
        invoiceId,
        rules,
        inv.account_date,
        {
          code: "BILLER_RECON",
          scope: "INVOICE",
          message: `TOTAL_MISMATCH: biller header ${inv.total_cents} vs CRB ${inv.grand_total_cents}.`,
          amountInQuestionCents: Number(inv.grand_total_cents) - Number(inv.total_cents),
          suggestedCorrectCents: Number(inv.total_cents),
          invalid: false,
          exemptType: null,
          bucketHint: null,
        },
        invoiceId,
      );
    }
    if (inv.header_cars != null && Number(inv.header_cars) !== Number(inv.car_count)) {
      await insertFinding(
        invoiceId,
        rules,
        inv.account_date,
        {
          code: "BILLER_RECON",
          scope: "INVOICE",
          message: `CAR_COUNT_MISMATCH: biller header ${inv.header_cars} vs CRB ${inv.car_count}.`,
          amountInQuestionCents: 0,
          suggestedCorrectCents: null,
          invalid: false,
          exemptType: null,
          bucketHint: null,
        },
        invoiceId,
      );
    }
  } else {
    await insertFinding(
      invoiceId,
      rules,
      inv.account_date,
      {
        code: "BILLER_RECON",
        scope: "INVOICE",
        message: "CRB_WITHOUT_BILLER_INVOICE",
        amountInQuestionCents: 0,
        suggestedCorrectCents: null,
        invalid: false,
        exemptType: null,
        bucketHint: null,
      },
      invoiceId,
    );
  }
}

export async function flagOrphanBillerHeaders(): Promise<void> {
  const rules = await loadRules();
  await q(
    `UPDATE repair.audit_findings f
     SET status = 'RESOLVED'
     FROM repair.biller_invoice_headers h
     WHERE f.tenant_id = $1
       AND f.target_id = h.id
       AND f.rule_code = 'BILLER_RECON'
       AND f.message LIKE 'BILLER_INVOICE_WITHOUT_CRB%'
       AND f.status = 'OPEN'
       AND EXISTS (
         SELECT 1 FROM repair.crb_invoices i
         JOIN repair.crb_files cf ON cf.id = i.file_id AND cf.version_status = 'ACTIVE'
         WHERE i.tenant_id = h.tenant_id
           AND i.billing_party = h.billing_party
           AND i.invoice_number = h.invoice_number
           AND i.account_date = h.account_month
       )`,
    [TENANT],
  );
  const { rows } = await q<{ id: string; billing_party: string; invoice_number: string; account_month: string }>(
    `SELECT h.id, h.billing_party, h.invoice_number, h.account_month
     FROM repair.biller_invoice_headers h
     WHERE h.tenant_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM repair.crb_invoices i
         JOIN repair.crb_files cf ON cf.id = i.file_id AND cf.version_status = 'ACTIVE'
         WHERE i.tenant_id = h.tenant_id
           AND i.billing_party = h.billing_party
           AND i.invoice_number = h.invoice_number
           AND i.account_date = h.account_month
       )`,
    [TENANT],
  );
  for (const header of rows) {
    const { rows: existing } = await q<{ id: string }>(
      `SELECT id FROM repair.audit_findings
       WHERE target_id = $1 AND message LIKE 'BILLER_INVOICE_WITHOUT_CRB%' AND status = 'OPEN'`,
      [header.id],
    );
    if (existing[0]) continue;
    await insertFinding(
      null,
      rules,
      header.account_month,
      {
        code: "BILLER_RECON",
        scope: "FILE",
        message: `BILLER_INVOICE_WITHOUT_CRB: ${header.billing_party} ${header.invoice_number} ${header.account_month}`,
        amountInQuestionCents: 0,
        suggestedCorrectCents: null,
        invalid: false,
        exemptType: null,
        bucketHint: null,
      },
      header.id,
    );
  }
}

async function applyStanding(invoiceId: string, actor: string): Promise<void> {
  const { rows: exceptions } = await q<{
    id: string;
    rule_code: string;
    biller: string | null;
    repairing_party: string | null;
    lease_id: string | null;
    lessee_id: string | null;
    car_mark: string | null;
    car_number_from: string | null;
    car_number_to: string | null;
    job_code: string | null;
    reason: string;
    effective_from: string;
    effective_to: string | null;
  }>(
    `SELECT id, rule_code, biller, repairing_party, lease_id, lessee_id, car_mark,
            car_number_from, car_number_to, job_code, reason,
            effective_from::text, effective_to::text
     FROM repair.standing_exceptions
     WHERE tenant_id = $1 AND enabled = true`,
    [TENANT],
  );
  if (!exceptions.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const { rows: findings } = await q<{
    id: string;
    rule_code: string;
    rule_id: string | null;
    rule_version: number;
    target_id: string | null;
    scope: string;
  }>(
    `SELECT id, rule_code, rule_id, rule_version, target_id, scope
     FROM repair.audit_findings
     WHERE invoice_id = $1 AND status = 'OPEN'`,
    [invoiceId],
  );
  for (const finding of findings) {
    const { rows: ctx } = await q<{
      billing_party: string;
      repairing_party: string | null;
      lease_id: string | null;
      lessee_id: string | null;
      car_initial: string | null;
      car_number: string | null;
      applied_job_code: string | null;
    }>(
      `SELECT i.billing_party, l.repairing_party, c.lease_id, c.lessee_id,
              c.car_initial, c.car_number, l.applied_job_code
       FROM repair.crb_invoices i
       LEFT JOIN repair.crb_lines l ON l.id = $2
       LEFT JOIN repair.crb_cars c ON c.id = COALESCE(l.car_id, $2)
       WHERE i.id = $1`,
      [invoiceId, finding.target_id],
    );
    const row = ctx[0];
    if (!row) continue;
    const hit = exceptions.find((ex) => {
      if (ex.rule_code !== finding.rule_code) return false;
      const from = String(ex.effective_from).slice(0, 10);
      const to = ex.effective_to ? String(ex.effective_to).slice(0, 10) : null;
      if (from > today) return false;
      if (to && to < today) return false;
      if (ex.biller && ex.biller !== row.billing_party) return false;
      if (ex.repairing_party && ex.repairing_party !== trimField(row.repairing_party)) return false;
      if (ex.lease_id && ex.lease_id !== row.lease_id) return false;
      if (ex.lessee_id && ex.lessee_id !== row.lessee_id) return false;
      if (ex.car_mark && ex.car_mark !== trimField(row.car_initial)) return false;
      if (ex.job_code && ex.job_code !== trimField(row.applied_job_code)) return false;
      const num = normCar(row.car_number ?? "");
      if (ex.car_number_from && num < normCar(ex.car_number_from)) return false;
      if (ex.car_number_to && num > normCar(ex.car_number_to)) return false;
      return true;
    });
    if (!hit) continue;
    await q(
      `UPDATE repair.audit_findings SET status = 'OVERRIDDEN' WHERE id = $1 AND status = 'OPEN'`,
      [finding.id],
    );
    await q(
      `INSERT INTO repair.crb_overrides
         (tenant_id, scope, target_id, finding_id, rule_id, rule_code, rule_version,
          reason, source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'standing', $9)`,
      [
        TENANT,
        finding.scope === "LINE" || finding.scope === "CAR" || finding.scope === "INVOICE"
          ? finding.scope
          : "INVOICE",
        finding.target_id,
        finding.id,
        finding.rule_id,
        finding.rule_code,
        finding.rule_version,
        hit.reason.length >= 8 ? hit.reason : `${hit.reason} (standing)`,
        actor,
      ],
    );
  }
}

export async function refreshErrorPanel(invoiceId: string): Promise<void> {
  const rules = await loadRules();
  const { rows: invRows } = await q<{
    account_date: string;
    grand_total_cents: string;
    control_ok: boolean;
    dx_available_date: string | null;
    receipt_date: string | null;
  }>(
    `SELECT i.account_date, i.grand_total_cents::text, i.control_ok,
            i.dx_available_date::text, i.receipt_date::text,
            h.received_date::text AS received
     FROM repair.crb_invoices i
     LEFT JOIN repair.biller_invoice_headers h ON h.crb_invoice_id = i.id
     WHERE i.id = $1`,
    [invoiceId],
  );
  const inv = invRows[0] as (typeof invRows)[0] & { received?: string | null };
  if (!inv) return;
  const { rows: header } = await q<{ received_date: string | null }>(
    `SELECT received_date::text FROM repair.biller_invoice_headers WHERE crb_invoice_id = $1 LIMIT 1`,
    [invoiceId],
  );
  const dx = inv.dx_available_date ? String(inv.dx_available_date).slice(0, 10) : null;
  const received = header[0]?.received_date ? String(header[0].received_date).slice(0, 10) : null;
  const receipt = receiptDateOf(dx, received);
  await q(`UPDATE repair.crb_invoices SET receipt_date = $2 WHERE id = $1`, [invoiceId, receipt]);
  const { rows: findings } = await q<{
    status: string;
    amount_in_question_cents: string;
    invalid: boolean;
    exempt_type: string | null;
  }>(
    `SELECT status, amount_in_question_cents::text, invalid, exempt_type
     FROM repair.audit_findings WHERE invoice_id = $1`,
    [invoiceId],
  );
  const versionFor = (code: string) => selectRuleVersion(rules, code, inv.account_date);
  const tiers = tiersFrom(versionFor("R112_ERROR_TIERS")?.params);
  const min = Number(versionFor("R112_MIN_AGGREGATE")?.params.min ?? 100) * 100;
  const minExempt = (versionFor("R112_MIN_AGGREGATE")?.params.exempt_types as string[]) ?? [];
  const returnDays = Number(versionFor("R112_RETURN_WINDOW")?.params.days ?? 60);
  const paid = versionFor("R112_PAID_EXC_WINDOW")?.params ?? {};
  const response = versionFor("R112_RESPONSE_DUE")?.params ?? {};
  const { rows: filed } = await q<{ filed_at: string | null; n: string }>(
    `SELECT MAX(filed_at)::text AS filed_at, COUNT(*) FILTER (WHERE filed_at IS NOT NULL)::text AS n
     FROM repair.exception_packages WHERE invoice_id = $1`,
    [invoiceId],
  );
  const panel = buildErrorPanel({
    totalCents: Number(inv.grand_total_cents),
    findings: findings.map((f) => ({
      status: f.status,
      amountInQuestionCents: Number(f.amount_in_question_cents),
      invalid: f.invalid,
      exemptType: f.exempt_type,
    })),
    tiers,
    minAggregateCents: min,
    minExempt,
    improperlyRendered: !inv.control_ok,
    receiptDate: receipt,
    today: new Date().toISOString().slice(0, 10),
    returnDays,
    paidMonths: Number(paid.months ?? 7),
    leasedOffsetMonths: Number(paid.leased_offset_months ?? 10),
    responseInitialDays: Number(response.initial_days ?? 120),
    responseSubsequentDays: Number(response.subsequent_days ?? 90),
    cbMonths: 6,
    filedAt: filed[0]?.filed_at ? String(filed[0].filed_at).slice(0, 10) : null,
    responseRound: Number(filed[0]?.n ?? 0) > 0 ? 1 : 0,
  });
  await q(`UPDATE repair.crb_invoices SET error_panel = $2::jsonb WHERE id = $1`, [
    invoiceId,
    JSON.stringify(panel),
  ]);
}

async function linkCars(invoiceId: string): Promise<void> {
  const { rows: cars } = await q<{ id: string; car_initial: string; car_number: string }>(
    `SELECT id, car_initial, car_number FROM repair.crb_cars WHERE invoice_id = $1`,
    [invoiceId],
  );
  for (const car of cars) {
    const mark = car.car_initial.trim().toUpperCase();
    const num = normCar(car.car_number);
    const { rows: ref } = await q<{ rlms_railcar_id: string; in_vcf: boolean; lessee_name: string | null }>(
      `SELECT rlms_railcar_id::text, in_vcf, lessee_name
       FROM repair.cars_ref
       WHERE upper(car_mark) = $1
         AND (
           car_number = $2
           OR lpad(regexp_replace(COALESCE(car_number, ''), '[^0-9]', '', 'g'), 6, '0') = $3
         )
       LIMIT 1`,
      [mark, car.car_number.trim(), num],
    );
    const { rows: dates } = await q<{
      repair_date: string | null;
    }>(`SELECT repair_date::text FROM repair.crb_lines WHERE car_id = $1 AND repair_date IS NOT NULL`, [
      car.id,
    ]);
    const repairDates = dates.map((d) => String(d.repair_date).slice(0, 10)).sort();
    const latest = repairDates[repairDates.length - 1] ?? null;
    const { rows: vcf } = await q<{
      assignment_id: string | null;
      lessee: string | null;
      rider: string | null;
      start_date: string | null;
      end_date: string | null;
      active: number | null;
    }>(
      `SELECT assignment_id, lessee, rider, start_date, end_date, active
       FROM public.v_valid_export_rows
       WHERE upper(coalesce(car_initial, '')) = $1
         AND (
           car_number = $2
           OR lpad(regexp_replace(COALESCE(car_number, ''), '[^0-9]', '', 'g'), 6, '0') = $3
         )`,
      [mark, car.car_number.trim(), num],
    );
    const covers = (iso: string | null) =>
      vcf.filter((row) => {
        if (!iso) return Number(row.active) === 1;
        const start = row.start_date?.trim() || null;
        const end = row.end_date?.trim() || null;
        if (start && start > iso) return false;
        if (end && end < iso) return false;
        return true;
      });
    const covered = covers(latest);
    const owned = Boolean(ref[0]) && covered.length > 0;
    const leaseRow = covered.find((row) => trimField(row.lessee) || trimField(row.rider)) ?? null;
    const flags: string[] = [];
    if (!ref[0]) flags.push("MARK_NOT_RESIDCO");
    if (!owned) flags.push("NOT_OWNED_ON_REPAIR_DATE");
    if (owned && !leaseRow) flags.push("NO_ACTIVE_LEASE");
    const distinct = new Set(repairDates);
    if (distinct.size > 1) flags.push("LEASE_DIFFERS_BY_LINE");
    await q(
      `UPDATE repair.crb_cars
       SET valid_car_id = $2, lease_id = $3, lessee_id = $4, lessee_name = $5,
           owned_on_repair_date = $6, repair_date = $7, flags = $8::jsonb
       WHERE id = $1`,
      [
        car.id,
        ref[0] ? Number(ref[0].rlms_railcar_id) : null,
        leaseRow ? trimField(leaseRow.assignment_id) || trimField(leaseRow.rider) || null : null,
        leaseRow ? trimField(leaseRow.lessee) || null : null,
        leaseRow ? trimField(leaseRow.lessee) || ref[0]?.lessee_name || null : null,
        owned,
        latest,
        JSON.stringify(flags),
      ],
    );
  }
}

function moneyOf(rec: ParsedRecord): { labor: number; material: number } {
  return {
    labor: rec.cents.labor_cents ?? 0,
    material: signedMaterial(rec.cents.material_cents ?? 0, rec.fields.material_sign),
  };
}

export async function uploadCrbFile(opts: {
  filename: string;
  bytes: Buffer;
  actor: string;
}): Promise<UploadResult> {
  await ensureAuditRules(opts.actor);
  const sha = createHash("sha256").update(opts.bytes).digest("hex");
  const { rows: existing } = await q<{ id: string; control_status: "BALANCED" | "OUT_OF_BALANCE" }>(
    `SELECT id, control_status FROM repair.crb_files WHERE tenant_id = $1 AND sha256 = $2`,
    [TENANT, sha],
  );
  if (existing[0]) {
    return { fileId: existing[0].id, noop: true, controlStatus: existing[0].control_status, superseded: [] };
  }
  const parsed = parseUpload(opts.filename, opts.bytes);
  const balance = balanceReport(parsed.records);
  const counts: Record<string, number> = {};
  const billed: string[] = [];
  const months = new Set<string>();
  let dx: string | null = null;
  for (const rec of parsed.records) {
    counts[rec.recordFormat] = (counts[rec.recordFormat] ?? 0) + 1;
    const party = trimField(rec.fields.billed_party);
    if (party && party !== "ZZZZ") billed.push(party);
    const acct = trimField(rec.fields.account_date_yymm);
    if (/^\d{4}$/.test(acct)) months.add(acct);
    const outbound = yymmddToIso(rec.fields.railinc_outbound_date ?? "");
    if (outbound && (!dx || outbound > dx)) dx = outbound;
  }
  const billedParty = mostCommon(billed);
  const controlStatus = balance.ok ? "BALANCED" : "OUT_OF_BALANCE";
  const parseErrors = [
    ...parsed.errors,
    ...balance.issues.map((issue) => issue.message),
  ];
  const { rows: inserted } = await q<{ id: string }>(
    `INSERT INTO repair.crb_files
       (tenant_id, file_name, sha256, raw_bytes, uploaded_by, billed_party, account_months,
        dx_outbound_date, record_counts, control_status, parse_errors)
     VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9::jsonb,$10,$11::jsonb)
     RETURNING id`,
    [
      TENANT,
      opts.filename,
      sha,
      opts.bytes,
      opts.actor,
      billedParty,
      Array.from(months),
      dx,
      JSON.stringify(counts),
      controlStatus,
      JSON.stringify(parseErrors),
    ],
  );
  const fileId = inserted[0].id;
  try {
  const recordIds = new Map<number, string>();
  for (const rec of parsed.records) {
    const { rows } = await q<{ id: string }>(
      `INSERT INTO repair.crb_records
         (tenant_id, file_id, line_no, record_format, raw_line, parsed, warning)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       RETURNING id`,
      [
        TENANT,
        fileId,
        rec.lineNo,
        rec.recordFormat,
        rec.rawLine,
        JSON.stringify({ ...rec.fields, cents: rec.cents, format9Kind: rec.format9Kind }),
        rec.warning,
      ],
    );
    recordIds.set(rec.lineNo, rows[0].id);
  }

  const groups = new Map<string, ParsedRecord[]>();
  for (const rec of parsed.records) {
    if (!["1", "6", "8"].includes(rec.recordFormat)) continue;
    const key = invoiceKeyOf(rec.fields);
    if (!trimField(rec.fields.invoice_number) && rec.recordFormat !== "1") continue;
    const list = groups.get(key) ?? [];
    list.push(rec);
    groups.set(key, list);
  }
  const badKeys = new Set(balance.issues.map((issue) => issue.invoiceKey));
  const fileBad = balance.issues.some((issue) => issue.kind === "FILE_FMT9" || issue.kind === "MISSING_FMT9");

  for (const [key, recs] of Array.from(groups.entries())) {
    const details = recs.filter((rec) => rec.recordFormat === "1");
    if (!details.length && !recs.some((rec) => rec.recordFormat === "8")) continue;
    const sample = details[0] ?? recs[0];
    const billing = trimField(sample.fields.billing_party);
    const invoiceNo = trimField(sample.fields.invoice_number);
    const account = trimField(sample.fields.account_date_yymm);
    if (!billing || !invoiceNo || !account) continue;
    const zz = recs.find((rec) => rec.recordFormat === "8" && trimField(rec.fields.detail_source) === "ZZ");
    const subs = recs
      .filter((rec) => rec.recordFormat === "8")
      .map((rec) => ({
        detailSource: trimField(rec.fields.detail_source),
        count: rec.cents.record_count ?? 0,
        laborCents: rec.cents.labor_cents ?? 0,
        materialCents: signedMaterial(rec.cents.material_cents ?? 0, rec.fields.material_sign),
        invoiceDate: yymmddToIso(rec.fields.invoice_date ?? ""),
        taxpayerId: trimField(rec.fields.taxpayer_id),
        terms: trimField(rec.fields.terms),
        dueDate: yymmddToIso(rec.fields.due_date ?? ""),
      }));
    const contacts = recs
      .filter((rec) => rec.recordFormat === "6")
      .map((rec) => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(rec.fields)) out[k] = trimField(v);
        return out;
      });
    let labor = 0;
    let material = 0;
    for (const line of details) {
      const money = moneyOf(line);
      labor += money.labor;
      material += money.material;
    }
    const grand = zz
      ? (zz.cents.labor_cents ?? 0) + signedMaterial(zz.cents.material_cents ?? 0, zz.fields.material_sign)
      : labor + material;
    const resub = details.some((rec) => trimField(rec.fields.resubmitted_ind).toUpperCase() === "R");
    const original = details.find((rec) => trimField(rec.fields.original_invoice));
    const controlOk = !fileBad && !badKeys.has(key);
    const { rows: invIns } = await q<{ id: string }>(
      `INSERT INTO repair.crb_invoices
         (tenant_id, file_id, billing_party, billed_party, invoice_number, account_date,
          currency, invoice_date, detail_subtotals, grand_total_cents, computed_total_cents,
          contacts, resubmitted, original_invoice, original_account_date, dx_available_date,
          control_ok, car_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,0)
       RETURNING id`,
      [
        TENANT,
        fileId,
        billing,
        trimField(sample.fields.billed_party),
        invoiceNo,
        account,
        trimField(sample.fields.currency),
        zz ? yymmddToIso(zz.fields.invoice_date ?? "") : null,
        JSON.stringify(subs),
        grand,
        labor + material,
        JSON.stringify(contacts),
        resub,
        original ? trimField(original.fields.original_invoice) : null,
        original ? trimField(original.fields.original_account_date) : null,
        dx,
        controlOk,
      ],
    );
    const invoiceId = invIns[0].id;
    const carMap = new Map<string, string>();
    let sort = 0;
    for (const line of details) {
      const initial = trimField(line.fields.car_initial).toUpperCase();
      const number = trimField(line.fields.car_number);
      const carKey = `${initial}|${number}`;
      let carId = carMap.get(carKey);
      if (!carId) {
        const { rows: carIns } = await q<{ id: string }>(
          `INSERT INTO repair.crb_cars
             (tenant_id, invoice_id, car_initial, car_number, kind)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id`,
          [TENANT, invoiceId, initial, number, trimField(line.fields.kind_of_car)],
        );
        carId = carIns[0].id;
        carMap.set(carKey, carId);
      }
      const money = moneyOf(line);
      sort += 1;
      const wheel = {
        appliedDate: trimField(line.fields.applied_wheel_date),
        appliedMfr: trimField(line.fields.applied_wheel_mfr),
        appliedClass: trimField(line.fields.applied_wheel_class),
        appliedSide: trimField(line.fields.applied_side_reading),
        appliedFinger: trimField(line.fields.applied_finger_reading),
        removedDate: trimField(line.fields.removed_wheel_date),
        removedMfr: trimField(line.fields.removed_wheel_mfr),
        removedClass: trimField(line.fields.removed_wheel_class),
        removedSide: trimField(line.fields.removed_side_reading),
        removedFinger: trimField(line.fields.removed_finger_reading),
        narrativeNonWheel: trimField(line.fields.narrative_non_wheel),
      };
      await q(
        `INSERT INTO repair.crb_lines
           (tenant_id, invoice_id, car_id, record_id, line_number, detail_source, responsibility,
            dc_party, dc_date, labor_cents, material_cents, material_sign, machine_priceable,
            wrong_repair, narrative, wheel, ddct_incident_id, cid, applied_job_code, applied_qualifier,
            removed_job_code, removed_qualifier, why_made, condition_code, location_on_car, facility_type,
            quantity, repairing_party, repairing_party_invoice, repair_date, kind_of_car, load_empty,
            splc, doc_ref, parsed, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,
                 $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35::jsonb,$36)`,
        [
          TENANT,
          invoiceId,
          carId,
          recordIds.get(line.lineNo) ?? null,
          trimField(line.fields.line_number),
          trimField(line.fields.detail_source),
          trimField(line.fields.responsibility),
          trimField(line.fields.dc_jic_party),
          yymmddToIso(line.fields.dc_jic_date ?? ""),
          money.labor,
          money.material,
          trimField(line.fields.material_sign) || "D",
          trimField(line.fields.machine_priceable),
          trimField(line.fields.wrong_repair),
          trimField(line.fields.narrative_non_wheel) || trimField(line.fields.narrative),
          JSON.stringify(wheel),
          trimField(line.fields.ddct_incident),
          trimField(line.fields.cid),
          trimField(line.fields.applied_job_code),
          trimField(line.fields.applied_qualifier),
          trimField(line.fields.removed_job_code),
          trimField(line.fields.removed_qualifier),
          trimField(line.fields.why_made),
          trimField(line.fields.condition_code),
          trimField(line.fields.location_on_car),
          trimField(line.fields.facility_type),
          trimField(line.fields.quantity),
          trimField(line.fields.repairing_party),
          trimField(line.fields.repairing_party_invoice),
          yymmddToIso(line.fields.repair_date_yymmdd ?? ""),
          trimField(line.fields.kind_of_car),
          trimField(line.fields.load_empty),
          trimField(line.fields.splc),
          trimField(line.fields.document_reference),
          JSON.stringify(line.fields),
          sort,
        ],
      );
    }
    for (const carId of Array.from(carMap.values())) {
      await q(
        `UPDATE repair.crb_cars c SET
           line_count = (SELECT COUNT(*) FROM repair.crb_lines l WHERE l.car_id = c.id),
           labor_cents = (SELECT COALESCE(SUM(labor_cents),0) FROM repair.crb_lines l WHERE l.car_id = c.id),
           material_cents = (SELECT COALESCE(SUM(material_cents),0) FROM repair.crb_lines l WHERE l.car_id = c.id),
           total_cents = (SELECT COALESCE(SUM(labor_cents + material_cents),0) FROM repair.crb_lines l WHERE l.car_id = c.id)
         WHERE c.id = $1`,
        [carId],
      );
    }
    await q(
      `UPDATE repair.crb_invoices SET car_count = $2 WHERE id = $1`,
      [invoiceId, carMap.size],
    );
    await linkCars(invoiceId);
    const rules = await loadRules();
    await auditInvoice(invoiceId, rules);
    await applyStanding(invoiceId, opts.actor);
    await refreshErrorPanel(invoiceId);
  }

  const { rows: prior } = await q<{ id: string }>(
    `UPDATE repair.crb_files
     SET version_status = 'SUPERSEDED', superseded_by = $1
     WHERE tenant_id = $2 AND id <> $1 AND version_status = 'ACTIVE'
       AND billed_party = $3
       AND account_months && $4::text[]
     RETURNING id`,
    [fileId, TENANT, billedParty, Array.from(months)],
  );
  await logCrb(opts.actor, "upload", "FILE", fileId, {
    sha,
    controlStatus,
    superseded: prior.map((row) => row.id),
  });
  await flagOrphanBillerHeaders();
  return {
    fileId,
    noop: false,
    controlStatus,
    superseded: prior.map((row) => row.id),
  };
  } catch (err) {
    await q(`DELETE FROM repair.crb_files WHERE id = $1`, [fileId]);
    throw err;
  }
}
