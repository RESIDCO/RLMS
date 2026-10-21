/**
 * Draft exception packages. Files are written to the local outbox only.
 * Nothing is transmitted.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { DEFAULT_TENANT_ID, q } from "../../db";
import { buildRecord, isoToYymmdd } from "./parse500";
import { logCrb, refreshErrorPanel } from "./ingest";
import { SEED_RULES } from "./rules";
import type { ActionResult } from "./review";

const TENANT = DEFAULT_TENANT_ID;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function crbOutboxDir(): string {
  return process.env.REPAIR_CRB_OUTBOX
    ? path.resolve(process.env.REPAIR_CRB_OUTBOX)
    : path.resolve(__dirname, "../../dev/crb-outbox");
}

export type PackageType =
  | "RETURN_UNPAID_HEADER"
  | "RETURN_UNPAID_LINES"
  | "PAID_EXCEPTION_LETTER_n"
  | "REBUTTAL_DR_JR"
  | "RULE122_PACKET";

const EE_COLUMNS = [
  "Record format",
  "Billing Party",
  "Billed Party",
  "Account Date",
  "Total Invoice Amount",
  "Invoice Number",
  "DX Outbound Date",
  "Car Initial",
  "Car Number",
  "Repair Date",
  "SPLC",
  "Repairing Party",
  "Invoice Header Level Exception",
  "BRC Header Level Exception",
  "Line Number",
  "Currency Indicator",
  "Submission Date",
  "Detail Source",
  "Exception Letter Counter",
  "Description",
  "Amount",
  "Amount Indicator",
  "Response Indicator",
  "Attachment",
] as const;

function safeToken(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "NA";
}

function pdfBytes(lines: string[]): Buffer {
  const escaped = lines
    .map((line) => line.replace(/[()\\]/g, " "))
    .slice(0, 40);
  const commands = ["BT", "/F1 10 Tf", "48 740 Td", "14 TL"];
  escaped.forEach((line, i) => {
    if (i === 0) commands.push(`(${line}) Tj`);
    else commands.push(`T* (${line}) Tj`);
  });
  commands.push("ET");
  const stream = commands.join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n",
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n`,
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += obj;
  }
  const xref = body.length;
  let xrefBody = `xref\n0 ${objects.length + 1}\n`;
  xrefBody += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    xrefBody += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += xrefBody;
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

type FindingRow = {
  id: string;
  rule_code: string;
  rule_version: number;
  message: string;
  amount_in_question_cents: string;
  exempt_type: string | null;
  target_id: string | null;
  scope: string;
  status: string;
};

type LinePack = {
  id: string;
  line_number: string | null;
  detail_source: string | null;
  car_initial: string;
  car_number: string;
  repair_date: string | null;
  splc: string | null;
  repairing_party: string | null;
  responsibility: string | null;
  labor_cents: string;
  material_cents: string;
};

export async function generatePackage(opts: {
  invoiceId: string;
  type: PackageType;
  actor: string;
}): Promise<ActionResult<{ id: string; pdfPath: string; xlsxPath: string; draftPath: string }>> {
  const { rows: invRows } = await q<{
    id: string;
    billing_party: string;
    billed_party: string | null;
    invoice_number: string;
    account_date: string;
    currency: string | null;
    grand_total_cents: string;
    dx_available_date: string | null;
    error_panel: { belowMinimum?: boolean; exemptTypesPresent?: string[]; aggregateCents?: number } | null;
  }>(
    `SELECT id, billing_party, billed_party, invoice_number, account_date, currency,
            grand_total_cents::text, dx_available_date::text, error_panel
     FROM repair.crb_invoices WHERE id = $1`,
    [opts.invoiceId],
  );
  const inv = invRows[0];
  if (!inv) return { ok: false, status: 404, error: "Invoice not found" };

  const { rows: prior } = await q<{ letter_seq: number; type: string }>(
    `SELECT letter_seq, type FROM repair.exception_packages
     WHERE invoice_id = $1 AND type = 'PAID_EXCEPTION_LETTER_n'
     ORDER BY letter_seq DESC`,
    [inv.id],
  );
  const letterSeq =
    opts.type === "PAID_EXCEPTION_LETTER_n" ? (prior[0]?.letter_seq ?? 0) + 1 : 1;

  const { rows: findings } = await q<FindingRow>(
    `SELECT id, rule_code, rule_version, message, amount_in_question_cents::text,
            exempt_type, target_id, scope, status
     FROM repair.audit_findings
     WHERE invoice_id = $1
       AND status IN ('OPEN', 'ACCEPTED_AS_EXCEPTION')
       AND invalid = false`,
    [inv.id],
  );

  const allAtOnce = SEED_RULES.find((rule) => rule.code === "R112_ALL_AT_ONCE");
  const exempt = new Set(
    ((allAtOnce?.params.exempt as string[]) ?? []).concat(["DUPLICATE", "WRONG_REPAIR"]),
  );
  let selected = findings;
  if (opts.type === "PAID_EXCEPTION_LETTER_n" && prior.length > 0) {
    selected = findings.filter((f) => f.exempt_type && exempt.has(f.exempt_type));
    if (!selected.length) {
      return {
        ok: false,
        status: 409,
        error: "Later letters may include only exempt types (all-exceptions-at-once).",
      };
    }
  }
  if (opts.type === "PAID_EXCEPTION_LETTER_n" && prior.length === 0 && inv.error_panel?.belowMinimum) {
    const present = new Set(findings.map((f) => f.exempt_type).filter(Boolean));
    const minExempt = new Set(["CAR_NUMBER", "REPORTING_MARK", "PRICE_MASTER", "TIME_LIMIT_GUARANTEE"]);
    const hasExempt = Array.from(present).some((t) => t && minExempt.has(t));
    if (!hasExempt) {
      return {
        ok: false,
        status: 409,
        error: "Aggregate is under $100 and no exempt type is present.",
      };
    }
  }
  if (opts.type === "REBUTTAL_DR_JR") {
    selected = findings.filter((f) => f.rule_code === "RESP_CODE" || f.message.includes("damaging"));
  }

  const { rows: lines } = await q<LinePack>(
    `SELECT l.id, l.line_number, l.detail_source, c.car_initial, c.car_number,
            l.repair_date::text, l.splc, l.repairing_party, l.responsibility,
            l.labor_cents::text, l.material_cents::text
     FROM repair.crb_lines l
     JOIN repair.crb_cars c ON c.id = l.car_id
     WHERE l.invoice_id = $1`,
    [inv.id],
  );
  const headerLevel = opts.type === "RETURN_UNPAID_HEADER" ? "Y" : "N";
  const detailSource = opts.type.startsWith("RETURN_UNPAID") ? "RJ" : "EE";
  const affected =
    headerLevel === "Y"
      ? lines
      : lines.filter((line) => selected.some((f) => f.target_id === line.id));
  const seq = String(letterSeq).padStart(2, "0");
  const dx = isoToYymmdd(inv.dx_available_date);
  const today = isoToYymmdd(new Date().toISOString().slice(0, 10));
  const drafts: string[] = [];
  const sheetRows: string[][] = [];
  const packLines = affected.length ? affected : lines.slice(0, 1);
  for (const line of packLines) {
    const finding = selected.find((f) => f.target_id === line.id);
    const amount = Math.abs(Number(finding?.amount_in_question_cents ?? 0));
    const sign = Number(finding?.amount_in_question_cents ?? 0) < 0 ? "C" : "D";
    const description = [
      finding?.message ?? opts.type,
      finding ? `${finding.rule_code} v${finding.rule_version}` : "",
    ]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 340);
    const values = {
      billing_party: inv.billing_party,
      billed_party: inv.billed_party ?? "",
      account_date_yymm: inv.account_date,
      total_invoice_cents: Math.abs(Number(inv.grand_total_cents)),
      invoice_number: inv.invoice_number,
      dx_outbound_date: dx,
      car_initial: line.car_initial,
      car_number: line.car_number,
      repair_date_yymmdd: isoToYymmdd(line.repair_date),
      splc: (line.splc ?? "").padStart(9, "0"),
      repairing_party: line.repairing_party ?? "",
      invoice_header_exception: headerLevel,
      brc_header_exception: headerLevel === "Y" ? "N" : "Y",
      line_number: line.line_number ?? "0",
      currency: inv.currency || "U",
      submission_date: today,
      detail_source: detailSource,
      letter_counter: seq,
      description,
      amount_cents: amount,
      amount_sign: sign,
      response_indicator: "",
      attachment: "",
    };
    drafts.push(buildRecord("2", values));
    sheetRows.push([
      "2",
      inv.billing_party,
      inv.billed_party ?? "",
      inv.account_date,
      String(Math.abs(Number(inv.grand_total_cents))),
      inv.invoice_number,
      dx,
      line.car_initial,
      line.car_number,
      isoToYymmdd(line.repair_date),
      values.splc as string,
      line.repairing_party ?? "",
      headerLevel,
      headerLevel === "Y" ? "N" : "Y",
      line.line_number ?? "",
      inv.currency || "U",
      today,
      detailSource,
      seq,
      description,
      String(amount),
      sign,
      "",
      "",
    ]);
  }

  const base = [
    safeToken(inv.billing_party),
    safeToken(inv.billed_party ?? "DEMO"),
    safeToken(inv.invoice_number),
    inv.account_date,
    seq,
  ].join("_");
  const dir = crbOutboxDir();
  await mkdir(dir, { recursive: true });
  const pdfPath = path.join(dir, `${base}.pdf`);
  const xlsxPath = path.join(dir, `${base}.xlsx`);
  const draftPath = path.join(dir, `${base}.txt`);
  const summary = [
    "repairSMART CRB package (DRAFT — not transmitted)",
    `Type ${opts.type} letter ${seq}`,
    `Invoice ${inv.billing_party} ${inv.invoice_number} account ${inv.account_date}`,
    `Lines ${packLines.length}. File this in Railinc yourself.`,
    ...selected.slice(0, 12).map((f) => `${f.rule_code}: ${f.message}`),
  ];
  await writeFile(pdfPath, pdfBytes(summary));
  await writeFile(draftPath, drafts.join("\n") + (drafts.length ? "\n" : ""));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("EE");
  ws.addRow([...EE_COLUMNS]);
  for (const row of sheetRows) ws.addRow(row);
  await wb.xlsx.writeFile(xlsxPath);

  const { rows: saved } = await q<{ id: string }>(
    `INSERT INTO repair.exception_packages
       (tenant_id, invoice_id, type, letter_seq, contents, pdf_path, xlsx_path, draft500_path, status, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,'DRAFT',$9)
     RETURNING id`,
    [
      TENANT,
      inv.id,
      opts.type,
      letterSeq,
      JSON.stringify({
        findings: selected.map((f) => f.id),
        lineIds: packLines.map((l) => l.id),
        note: "Local draft only. No network send.",
      }),
      pdfPath,
      xlsxPath,
      draftPath,
      opts.actor,
    ],
  );
  await logCrb(opts.actor, "package_draft", "INVOICE", inv.id, {
    type: opts.type,
    letterSeq,
    pdfPath,
    xlsxPath,
    draftPath,
  });
  return { ok: true, id: saved[0].id, pdfPath, xlsxPath, draftPath };
}

export async function markPackageFiled(opts: {
  packageId: string;
  filedAt: string;
  actor: string;
}): Promise<ActionResult> {
  const { rows } = await q<{ id: string; invoice_id: string }>(
    `UPDATE repair.exception_packages
     SET status = 'FILED_MANUALLY', filed_at = $2, filed_by = $3
     WHERE id = $1
     RETURNING id, invoice_id`,
    [opts.packageId, opts.filedAt, opts.actor],
  );
  if (!rows[0]) return { ok: false, status: 404, error: "Package not found" };
  await refreshErrorPanel(rows[0].invoice_id);
  await logCrb(opts.actor, "mark_filed", "INVOICE", rows[0].invoice_id, {
    packageId: opts.packageId,
    filedAt: opts.filedAt,
  });
  return { ok: true };
}

export async function recordPackageResponse(opts: {
  packageId: string;
  code: "A" | "P" | "D";
  responseAt: string;
  actor: string;
  cbaNo?: string | null;
  cbaAmountCents?: number | null;
  cbaDate?: string | null;
}): Promise<ActionResult> {
  const hasCba = Boolean(opts.cbaNo);
  const { rows } = await q<{ invoice_id: string }>(
    `UPDATE repair.exception_packages
     SET status = $2,
         response_code = $3,
         response_at = $4,
         cba_no = $5,
         cba_amount_cents = $6,
         cba_date = $7
     WHERE id = $1
     RETURNING invoice_id`,
    [
      opts.packageId,
      hasCba ? "CBA_RECEIVED" : "RESPONSE_RECEIVED",
      opts.code,
      opts.responseAt,
      opts.cbaNo ?? null,
      opts.cbaAmountCents ?? null,
      opts.cbaDate ?? null,
    ],
  );
  if (!rows[0]) return { ok: false, status: 404, error: "Package not found" };
  await logCrb(opts.actor, "package_response", "INVOICE", rows[0].invoice_id, {
    packageId: opts.packageId,
    code: opts.code,
  });
  return { ok: true };
}
