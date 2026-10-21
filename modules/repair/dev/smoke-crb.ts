/**
 * §I CRB staging smoke. Local Postgres only.
 * Run: npm run repair:smoke-crb
 */
import { existsSync, readFileSync } from "fs";
import { createRequire } from "module";
import { crc32 } from "node:zlib";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CrbBillingLine } from "../../../client/src/pages/repair/CrbGrid";
import { DEFAULT_TENANT_ID, q } from "../db";
import { migrateLocal } from "./migrate-local";
import {
  LAYOUT_CORRECTIONS,
  assertLayouts,
  balanceReport,
  buildRecord,
  isTimeBarred,
  parseText,
  parseUpload,
  zipStored,
} from "../server/crb/parse500";
import {
  SEED_RULES,
  buildErrorPanel,
  evaluateLine,
  exceedsLimit,
  limitPctForTotal,
  receiptDateOf,
  selectRuleVersion,
  tiersFrom,
  type LineFacts,
  type RuleVersion,
} from "../server/crb/rules";
import { uploadCrbFile } from "../server/crb/ingest";
import { lookupRefCode } from "../services/ref-lookup";
import {
  cloneAuditRule,
  createOverride,
  decideCar,
  listAuditRules,
  setInvoiceStatus,
  upsertBillerHeader,
} from "../server/crb/review";
import { generatePackage } from "../server/crb/packages";

const TENANT = DEFAULT_TENANT_ID;
const VERSIONS: RuleVersion[] = SEED_RULES.map((rule) => ({
  code: rule.code,
  version: 1,
  params: rule.params,
  severity: rule.severity,
  enabled: true,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
}));
const TIERS = tiersFrom(VERSIONS.find((rule) => rule.code === "R112_ERROR_TIERS")?.params);

function bad(label: string, detail?: string): never {
  throw new Error(detail ? `${label}: ${detail}` : label);
}
function ok(msg: string) {
  console.log(`  OK  ${msg}`);
}

function facts(over: Partial<LineFacts> = {}): LineFacts {
  return {
    detailSource: "BR",
    responsibility: "1",
    dcParty: "",
    dcDate: "",
    repairDate: "260510",
    accountDate: "2605",
    laborCents: 1000,
    materialCents: 0,
    machinePriceable: "N",
    wrongRepair: "N",
    whyMade: "01",
    loadEmpty: "L",
    kindOfCar: "G",
    narrative: "DEMO",
    laborRateCents: 0,
    resubmitted: "",
    priceTableLoaded: true,
    priceMasterCents: 1000,
    duplicate: false,
    owned: true,
    markResidco: true,
    ...over,
  };
}

function codes(over: Partial<LineFacts>): string[] {
  return evaluateLine(facts(over), VERSIONS).map((finding) => finding.code);
}

function detail(opts: {
  billing?: string;
  invoice: string;
  account?: string;
  car?: string;
  num?: string;
  labor: number;
  material?: number;
  sign?: string;
  job?: string;
  qual?: string;
  loc?: string;
  repair?: string;
  detail?: string;
  why?: string;
  wrong?: string;
  resp?: string;
  machine?: string;
  rate?: number;
  load?: string;
  repairingInvoice?: string;
  lineNo?: number;
}): string {
  return buildRecord("1", {
    billing_party: opts.billing ?? "SMOK",
    billed_party: "SMOK",
    account_date_yymm: opts.account ?? "2610",
    invoice_number: opts.invoice,
    currency: "U",
    detail_source: opts.detail ?? "BR",
    car_initial: opts.car ?? "SMOK",
    car_number: opts.num ?? "200001",
    kind_of_car: "G",
    load_empty: opts.load ?? "L",
    repair_date_yymmdd: opts.repair ?? "261001",
    splc: "123456",
    repairing_party: "DMSH",
    repairing_party_invoice: opts.repairingInvoice ?? "",
    facility_type: "RT",
    location_on_car: opts.loc ?? "A1",
    quantity: 1,
    applied_job_code: opts.job ?? "1001",
    applied_qualifier: opts.qual ?? "001",
    why_made: opts.why ?? "01",
    responsibility: opts.resp ?? "1",
    labor_cents: opts.labor,
    material_cents: Math.abs(opts.material ?? 0),
    material_sign: opts.sign ?? "D",
    machine_priceable: opts.machine ?? "N",
    wrong_repair: opts.wrong ?? "N",
    narrative_non_wheel: "DEMO smoke line",
    labor_rate: opts.rate ?? 0,
    line_number: opts.lineNo ?? 1,
    railinc_outbound_date: "261005",
  });
}

function subtotal(opts: {
  billing?: string;
  invoice: string;
  account?: string;
  ds: string;
  count: number;
  labor: number;
  material?: number;
}): string {
  return buildRecord("8", {
    billing_party: opts.billing ?? "SMOK",
    billed_party: "SMOK",
    account_date_yymm: opts.account ?? "2610",
    invoice_number: opts.invoice,
    currency: "U",
    detail_source: opts.ds,
    record_count: opts.count,
    labor_cents: opts.labor,
    material_cents: Math.abs(opts.material ?? 0),
    material_sign: (opts.material ?? 0) < 0 ? "C" : "D",
    invoice_date: "261015",
    railinc_outbound_date: "261005",
  });
}

function file9(count: number, labor: number, material = 0, account = "2610"): string {
  return buildRecord("9", {
    filler_billing: "ZZZZ",
    billed_party: "SMOK",
    account_date_yymm: account,
    filler_invoice: "Z".repeat(16),
    filler_currency: "Z",
    filler_detail: "ZZ",
    record_count: count,
    labor_cents: labor,
    material_cents: Math.abs(material),
    material_sign: material < 0 ? "C" : "D",
  });
}

function balanced(lines: string[], account = "2610"): string {
  const parsed = parseText(lines.join("\n"));
  let labor = 0;
  let material = 0;
  const groups = new Map<string, { count: number; labor: number; material: number; billing: string; invoice: string }>();
  for (const rec of parsed.records) {
    labor += rec.cents.labor_cents ?? 0;
    const sign = rec.fields.material_sign?.trim() === "C" ? -1 : 1;
    material += sign * Math.abs(rec.cents.material_cents ?? 0);
    const invoice = rec.fields.invoice_number.trim();
    const ds = rec.fields.detail_source.trim() || "BR";
    const key = `${invoice}|${ds}`;
    const cur = groups.get(key) ?? { count: 0, labor: 0, material: 0, billing: rec.fields.billing_party.trim(), invoice };
    cur.count += 1;
    cur.labor += rec.cents.labor_cents ?? 0;
    cur.material += sign * Math.abs(rec.cents.material_cents ?? 0);
    groups.set(key, cur);
  }
  const byInvoice = new Map<string, { count: number; labor: number; material: number; billing: string }>();
  const subs: string[] = [];
  for (const [key, group] of Array.from(groups.entries())) {
    const ds = key.split("|")[1] ?? "BR";
    subs.push(subtotal({
      billing: group.billing,
      invoice: group.invoice,
      account,
      ds,
      count: group.count,
      labor: group.labor,
      material: group.material,
    }));
    const inv = byInvoice.get(group.invoice) ?? { count: 0, labor: 0, material: 0, billing: group.billing };
    inv.count += group.count;
    inv.labor += group.labor;
    inv.material += group.material;
    byInvoice.set(group.invoice, inv);
  }
  const totals = Array.from(byInvoice.entries()).map(([invoice, inv]) => subtotal({
    billing: inv.billing,
    invoice,
    account,
    ds: "ZZ",
    count: inv.count,
    labor: inv.labor,
    material: inv.material,
  }));
  return [...lines, ...subs, ...totals, file9(parsed.records.length, labor, material, account), ""].join("\n");
}

async function ensureCar(num: string, lease: boolean) {
  await q(
    `INSERT INTO public.railcars (id, car_number, car_initial, reporting_marks, active, entity, lessee_name)
     SELECT GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.railcars), 80000) + 1,
            $1, 'SMOK', 'SMOK', true, 'Main', $2
     WHERE NOT EXISTS (SELECT 1 FROM public.railcars WHERE car_initial = 'SMOK' AND car_number = $1)`,
    [num, lease ? "SMOKE LESSEE" : null],
  );
  await q(
    `INSERT INTO public.v_valid_export_rows_data
       (export_src, export_id, car_initial, car_number, active, rider, assignment, assignment_id, lessee, start_date, end_date)
     SELECT 1, 89000, 'SMOK', $1, 1, $2, 'SMOKE', $3, $4, '2020-01-01', NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM public.v_valid_export_rows_data WHERE car_initial = 'SMOK' AND car_number = $1
     )`,
    [num, lease ? "R1" : null, lease ? "AG-S" : null, lease ? "SMOKE LESSEE" : null],
  );
}

function zipTwo(a: string, b: string): Buffer {
  const part = (name: string, text: string) => {
    const data = Buffer.from(text, "latin1");
    const nameB = Buffer.from(name);
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30 + nameB.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 16);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    nameB.copy(local, 30);
    return Buffer.concat([local, data]);
  };
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  return Buffer.concat([part("a.txt", a), part("b.txt", b), eocd]);
}

async function resetSmoke() {
  await q(
    `DELETE FROM repair.audit_findings f
     USING repair.biller_invoice_headers h
     WHERE f.target_id = h.id AND h.billing_party = 'SMOK'`,
  );
  await q(`DELETE FROM repair.biller_invoice_headers WHERE tenant_id = $1 AND billing_party = 'SMOK'`, [TENANT]);
  await q(`DELETE FROM repair.crb_files WHERE tenant_id = $1 AND billed_party = 'SMOK'`, [TENANT]);
}

async function openMonth(): Promise<string> {
  const { rows } = await q<{ id: string }>(
    `SELECT id FROM repair.accounting_months
     WHERE tenant_id = $1 AND status = 'OPEN' AND deleted_at IS NULL LIMIT 1`,
    [TENANT],
  );
  if (rows[0]) return rows[0].id;
  const { rows: created } = await q<{ id: string }>(
    `INSERT INTO repair.accounting_months (tenant_id, month_label, status, opened_by, created_by)
     VALUES ($1, '2026-10', 'OPEN', 'smoke-crb', 'smoke-crb')
     RETURNING id`,
    [TENANT],
  );
  return created[0].id;
}

function drillDownChecks() {
  (globalThis as { React?: typeof React }).React = React;
  const require = createRequire(import.meta.url);
  const { CrbBillingLines } = require("../../../client/src/pages/repair/CrbGrid.tsx") as {
    CrbBillingLines: (props: {
      lines: CrbBillingLine[];
      findings: Array<{
        id: string;
        rule_code: string;
        rule_version: number;
        rule_ref: string | null;
        severity: string | null;
        scope: string;
        target_id: string;
        message: string;
        status: string;
        invalid: boolean;
      }>;
      onReject: (lineId: string) => void;
      onOverride: (lineId: string, finding: null) => void;
    }) => React.ReactElement;
  };
  const { formatCodeTip, repairCodeText } = require("../../../client/src/pages/repair/CodeHover.tsx") as {
    formatCodeTip: (code: string, found: boolean, description: string) => string;
    repairCodeText: (code: string | null | undefined, face: { found: boolean; description: string } | null | undefined) => string;
  };
  if (formatCodeTip("1001", true, "DEMO job description") !== "1001 – DEMO job description") {
    bad("estimate tip", "decoded description");
  }
  if (formatCodeTip("ZZZZ", false, "Not in reference table") !== "ZZZZ – not in reference table") {
    bad("estimate tip", "not in reference table");
  }
  if (repairCodeText("ZZZZ", { found: false, description: "Not in reference table" }) !== "ZZZZ – unknown code") {
    bad("unknown code");
  }
  const html = renderToStaticMarkup(
    createElement(CrbBillingLines, {
      lines: [
        {
          id: "line-1",
          line_number: "7",
          sort_order: 7,
          record_format: "1",
          applied_job_code: "1001",
          applied_qualifier: "001",
          condition_code: "9",
          why_made: "01",
          location_on_car: "A1",
          quantity: "0004",
          labor_cents: 30000,
          material_cents: 5000,
          material_sign: "D",
          responsibility: "1",
          status: "PENDING",
          parsed: {
            labor_rate: "10000",
            narrative: "WHEEL NARRATIVE",
            narrative_non_wheel: "NONWHEEL NARRATIVE",
          },
          decoded: {
            job: { found: true, description: "DEMO job description" },
            qualifier: { found: false, description: "Not in reference table" },
            why_made: { found: true, description: "DEMO why made" },
            condition: { found: false, description: "Not in reference table" },
            location: { found: true, description: "DEMO location" },
            responsibility: { found: true, description: "DEMO responsibility" },
            record_format: { found: true, description: "Detail billing line" },
          },
        },
      ],
      findings: [
        {
          id: "f1",
          rule_code: "DEMO_RULE",
          rule_version: 1,
          rule_ref: "OM 112.H.3",
          severity: "WARN",
          scope: "LINE",
          target_id: "line-1",
          message: "DEMO finding text for the line",
          status: "OPEN",
          invalid: false,
        },
      ],
      onReject: () => undefined,
      onOverride: () => undefined,
    }),
  );
  for (const label of [
    "Billing lines",
    "Record format",
    "Job code",
    "Why made",
    "Location / position",
    "Condition",
    "Qualifier",
    "Qty",
    "Labor hrs",
    "Material",
    "Total",
    "Responsibility",
    "Audit",
    "Reject",
    "Override",
    "DEMO finding text for the line",
    "DEMO job description",
    "DEMO why made",
    "DEMO location",
    "DEMO responsibility",
    "Detail billing line",
    "unknown code",
    "not in reference table",
    "Narrative: WHEEL NARRATIVE",
    "Non-wheel narrative: NONWHEEL NARRATIVE",
    "crb-lines",
    "repair-brand-fill",
    ">4<",
    ">3<",
  ]) {
    if (!html.includes(label)) bad("line drill-down render", label);
  }
  const headerOrder = [
    ">Line<",
    ">Record format<",
    ">Location / position<",
    ">Job code<",
    ">Condition<",
    ">Qualifier<",
    ">Why made<",
    ">Responsibility<",
    ">Qty<",
    ">Labor hrs<",
    ">Labor<",
    ">Material<",
    ">Total<",
  ];
  let headerAt = -1;
  for (const header of headerOrder) {
    const next = html.indexOf(header, headerAt + 1);
    if (next < 0) bad("line column order", header);
    headerAt = next;
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const grid = readFileSync(join(root, "client/src/pages/repair/CrbGrid.tsx"), "utf8");
  const home = readFileSync(join(root, "client/src/pages/repair/CrbHome.tsx"), "utf8");
  const invoice = readFileSync(join(root, "client/src/pages/repair/CrbInvoice.tsx"), "utf8");
  const car = readFileSync(join(root, "client/src/pages/repair/CrbCar.tsx"), "utf8");
  const nav = readFileSync(join(root, "client/src/pages/repair/RepairModuleNav.tsx"), "utf8");
  const estimate = readFileSync(join(root, "client/src/pages/repair/EstimateDataFile.tsx"), "utf8");
  const seed = readFileSync(join(root, "modules/repair/dev/seed-crb-demo.ts"), "utf8");
  if (!grid.includes('from "./CodeHover"') || !estimate.includes('from "./CodeHover"')) {
    bad("shared CodeHover", "CRB and estimate review");
  }
  for (const src of [home, invoice, car, nav]) {
    if (!src.includes("CRB Staging")) bad("CRB Staging label", "missing");
    if (src.includes("Invoice Worklist")) bad("CRB Staging label", "Invoice Worklist remains");
  }
  if (!nav.includes('label: "Invoices"') || !nav.includes('href: "/repair/invoices"')) bad("shop invoices nav");
  if (!home.includes('useCrbTitle("CRB Staging")')) bad("document title", "CRB Staging");
  if (!invoice.includes("CRB Staging › ${invoiceHeading}")) bad("document title", "CRB Staging › Invoice");
  if (!car.includes("CRB Staging › ${carHeading}")) bad("document title", "CRB Staging › Car");
  for (const label of ["Open BRC", "Expand all", "Collapse all", "scope: \"LINE\"", "/lines/"]) {
    if (!grid.includes(label)) bad("line drill-down wiring", label);
  }
  if (!home.includes("CrbCarTable") || !home.includes("Expand all") || !invoice.includes("CrbCarTable")) {
    bad("line drill-down parents");
  }
  if (!car.includes("CrbBillingLines")) bad("car card lines grid");
  if (!seed.includes("[8, 7, 6, 5, 4, 3, 8, 6]")) bad("demo line counts", "expected cars with 3 to 8 lines");
  ok("billing-line drill-down renders decoded descriptions, tooltips, and CRB Staging titles");
}

function pureChecks() {
  drillDownChecks();
  const layout = assertLayouts();
  if (layout.length) bad("layouts", layout.join("; "));
  ok("column spec contiguous and each format sums to 500");
  const notes = LAYOUT_CORRECTIONS.join(" ");
  if (!notes.includes("111") || !notes.includes("167")) bad("corrections", "missing 111/167 notes");
  ok("layout corrections recorded for 111–112 and 167–216");

  for (const fmt of ["1", "2", "6", "8", "9", "9I"] as const) {
    const line = buildRecord(fmt, fmt === "9I" ? { billing_party: "SMOK", filler_billed: "ZZZZ" } : { billed_party: "SMOK", filler_billing: "ZZZZ" });
    if (line.length !== 500) bad("build", `${fmt} ${line.length}`);
    const parsed = parseText(line);
    if (fmt === "9I") {
      if (parsed.records[0]?.format9Kind !== "INPUT") bad("fmt9 input");
    } else if (fmt === "9") {
      if (parsed.records[0]?.format9Kind !== "OUTPUT") bad("fmt9 output");
    } else if (parsed.records[0]?.recordFormat !== fmt) bad("parse fmt", fmt);
  }
  ok("parse formats 1, 2, 6, 8, 9 output, 9 input");

  const short = parseText("1");
  if (short.records[0]?.rawLine.length !== 500) bad("pad", String(short.records[0]?.rawLine.length));
  const long = parseText(`${"1"}${"X".repeat(510)}`);
  if (!long.errors.some((err) => err.includes("> 500"))) bad("long", long.errors.join(","));
  const unknown = parseText(`${"7"}${" ".repeat(499)}`);
  if (!unknown.records[0]?.warning?.includes("unknown")) bad("unknown");
  ok("short pad, long flag, unknown format kept");

  const one = detail({ invoice: "INV-A", labor: 5000 });
  const pass = balanceReport(parseText(balanced([one])).records);
  if (!pass.ok) bad("balance pass", pass.issues.map((issue) => issue.message).join(";"));
  const failZz = balanceReport(parseText([one, subtotal({ invoice: "INV-A", ds: "BR", count: 1, labor: 5000 }), subtotal({ invoice: "INV-A", ds: "ZZ", count: 1, labor: 4999 }), file9(1, 5000), ""].join("\n")).records);
  if (failZz.ok || !failZz.issues.some((issue) => issue.kind === "ZZ_VS_SUBTOTALS")) bad("zz fail");
  const fail9 = balanceReport(parseText([one, subtotal({ invoice: "INV-A", ds: "BR", count: 1, labor: 5000 }), subtotal({ invoice: "INV-A", ds: "ZZ", count: 1, labor: 5000 }), file9(1, 4000), ""].join("\n")).records);
  if (!fail9.issues.some((issue) => issue.kind === "FILE_FMT9")) bad("fmt9 fail");
  const failDs = balanceReport(parseText([one, subtotal({ invoice: "INV-A", ds: "BR", count: 1, labor: 111 }), subtotal({ invoice: "INV-A", ds: "ZZ", count: 1, labor: 111 }), file9(1, 5000), ""].join("\n")).records);
  if (!failDs.issues.some((issue) => issue.message.includes("DETAIL_SOURCE_SUBTOTAL_MISMATCH"))) bad("detail mismatch");
  ok("balance pass, ZZ fail, format 9 fail, detail-source fail");

  const zipped = zipStored("one.txt", one);
  const unzipped = parseUpload("one.zip", zipped);
  if (unzipped.records.length !== 1) bad("zip", String(unzipped.records.length));
  let twoFailed = false;
  try {
    parseUpload("two.zip", zipTwo(one, one));
  } catch (err) {
    twoFailed = err instanceof Error && err.message.includes("exactly one");
  }
  if (!twoFailed) bad("zip two");
  ok("zip with one text file parses");

  if (isTimeBarred("260115", "2605", 3)) bad("time bar may", "January on the May DX is allowed");
  if (!isTimeBarred("260115", "2606", 3)) bad("time bar june");
  ok("time bar: January repair allowed on the May DX, barred in June");

  if (limitPctForTotal(1_000_000, TIERS) !== 10) bad("tier 10000.00");
  if (limitPctForTotal(1_000_001, TIERS) !== 7.5) bad("tier 10000.01");
  if (limitPctForTotal(20_000_000, TIERS) !== 7.5) bad("tier 200000.00");
  if (limitPctForTotal(20_000_001, TIERS) !== 5) bad("tier 200000.01");
  if (exceedsLimit(100_000, 1_000_000, 10)) bad("exact 10% must not exceed");
  if (!exceedsLimit(100_001, 1_000_000, 10)) bad("10% plus one cent must exceed");
  ok("error % tiers at 10000.00 / 10000.01 / 200000.00 / 200000.01");

  const covered = new Set<string>();
  const expectCode = (label: string, found: string[], code: string) => {
    if (!found.includes(code)) bad(label, found.join(",") || "(none)");
    covered.add(code);
  };
  expectCode("time", codes({ repairDate: "240115", detailSource: "BR" }), "R112_BILLING_TIME_LIMIT");
  expectCode("resubmit", codes({ resubmitted: "R", repairDate: "200101" }), "R112_RESUBMIT_24MO");
  expectCode("price miss", codes({ machinePriceable: "Y", priceMasterCents: null }), "R111_PRICE");
  const over = evaluateLine(facts({ machinePriceable: "Y", laborCents: 5000, priceMasterCents: 1000 }), VERSIONS);
  expectCode("price over", over.map((f) => f.code), "R111_PRICE");
  if (over.some((f) => f.invalid)) bad("overcharge invalid");
  const under = evaluateLine(facts({ machinePriceable: "Y", laborCents: 100, priceMasterCents: 1000 }), VERSIONS);
  if (!under.some((f) => f.code === "R111_PRICE" && f.invalid)) bad("invalid guard");
  covered.add("INVALID_EXCEPTION_GUARD");
  expectCode("wrong", codes({ whyMade: "08" }), "R111_WRONG_REPAIR");
  expectCode("labor", codes({ loadEmpty: "E", laborCents: 200000, laborRateCents: 10000 }), "FM1_LABOR_LIMITS");
  expectCode("resp2", codes({ responsibility: "2" }), "RESP_CODE");
  expectCode("resp3", codes({ responsibility: "3", dcParty: "" }), "RESP_CODE");
  expectCode("dc", codes({ detailSource: "DC", dcDate: "200101", repairDate: "260510" }), "DC_VALIDITY");
  expectCode("dup", codes({ duplicate: true }), "DUPLICATE_BILLING");
  expectCode("owned", codes({ owned: false }), "NOT_OWNED");
  expectCode("mark", codes({ markResidco: false }), "MARK_NOT_RESIDCO");
  ok("line rules fire, including the invalid overcharge guard");

  if (receiptDateOf("2026-10-05", "2026-10-01") !== "2026-10-05") bad("receipt");
  covered.add("R112_RECEIPT_DATE");
  const panel = buildErrorPanel({
    totalCents: 1_200_000,
    findings: [{ status: "OPEN", amountInQuestionCents: 119_000, invalid: false, exemptType: "WRONG_REPAIR" }],
    tiers: TIERS,
    minAggregateCents: 10000,
    minExempt: ["CAR_NUMBER", "REPORTING_MARK", "PRICE_MASTER", "TIME_LIMIT_GUARANTEE"],
    improperlyRendered: false,
    receiptDate: "2026-10-05",
    today: "2026-10-21",
    returnDays: 60,
    paidMonths: 7,
    leasedOffsetMonths: 10,
    responseInitialDays: 120,
    responseSubsequentDays: 90,
    cbMonths: 6,
    filedAt: null,
    responseRound: 0,
  });
  if (panel.suggested !== "RETURN_UNPAID") bad("suggest", panel.suggestedLabel);
  if (!panel.countdowns.some((c) => c.label.includes("60"))) bad("60d");
  if (!panel.countdowns.some((c) => c.label.includes("7 mo"))) bad("7 mo");
  if (!panel.countdowns.some((c) => c.label.includes("10 mo"))) bad("10 mo");
  if (!panel.countdowns.some((c) => c.text.includes("120"))) bad("120d");
  covered.add("R112_RETURN_WINDOW");
  covered.add("R112_ERROR_TIERS");
  covered.add("R112_PAID_EXC_WINDOW");
  covered.add("R112_RESPONSE_DUE");
  const small = buildErrorPanel({
    ...{
      totalCents: 50000,
      findings: [{ status: "OPEN", amountInQuestionCents: 4000, invalid: false, exemptType: "WRONG_REPAIR" }],
      tiers: TIERS,
      minAggregateCents: 10000,
      minExempt: ["PRICE_MASTER"],
      improperlyRendered: false,
      receiptDate: "2026-10-05",
      today: "2026-10-21",
      returnDays: 60,
      paidMonths: 7,
      leasedOffsetMonths: 10,
      responseInitialDays: 120,
      responseSubsequentDays: 90,
      cbMonths: 6,
      filedAt: null,
      responseRound: 0,
    },
  });
  if (!small.belowMinimum) bad("minimum");
  covered.add("R112_MIN_AGGREGATE");
  const credit = buildErrorPanel({
    totalCents: -100,
    findings: [],
    tiers: TIERS,
    minAggregateCents: 10000,
    minExempt: [],
    improperlyRendered: false,
    receiptDate: null,
    today: "2026-10-21",
    returnDays: 60,
    paidMonths: 7,
    leasedOffsetMonths: 10,
    responseInitialDays: 120,
    responseSubsequentDays: 90,
    cbMonths: 6,
    filedAt: "2026-10-21",
    responseRound: 1,
  });
  if (!credit.na || !credit.suggestedLabel.includes("CBA")) bad("credit na");
  if (!credit.countdowns.some((c) => c.text.includes("90"))) bad("90d");
  if (!credit.countdowns.some((c) => c.label.toLowerCase().includes("cb"))) bad("cb clock");
  ok("error panel windows, minimum, and credit N/A");

  const v1 = selectRuleVersion(
    [
      VERSIONS[0]!,
      { ...VERSIONS[0]!, version: 2, effectiveFrom: "2099-01-01", params: { months: 1 } },
    ],
    VERSIONS[0]!.code,
    "2605",
  );
  const v2 = selectRuleVersion(
    [
      { ...VERSIONS[0]!, effectiveTo: "2098-12-31" },
      { ...VERSIONS[0]!, version: 2, effectiveFrom: "2099-01-01", params: { months: 1 } },
    ],
    VERSIONS[0]!.code,
    "9901",
  );
  if (v1?.version !== 1 || v2?.version !== 2) bad("version pick", `${v1?.version}/${v2?.version}`);
  ok("rule version follows the account month");

  for (const rule of SEED_RULES) {
    if (!covered.has(rule.code) && !["NO_LEASE", "CONTROL_TOTALS", "R112_PROPERLY_RENDERED", "BILLER_RECON", "R112_ALL_AT_ONCE"].includes(rule.code)) {
      bad("uncovered rule", rule.code);
    }
  }
}

async function dbChecks() {
  await migrateLocal();
  await resetSmoke();
  await ensureCar("200001", true);
  await ensureCar("200003", false);
  await openMonth();
  const { rows: closed } = await q<{ id: string }>(
    `INSERT INTO repair.accounting_months (tenant_id, month_label, status, opened_by, closed_by, created_by)
     VALUES ($1, '1999-01', 'CLOSED', 'smoke-crb', 'smoke-crb', 'smoke-crb')
     ON CONFLICT (tenant_id, month_label) DO UPDATE SET status = 'CLOSED'
     RETURNING id`,
    [TENANT],
  );

  const clean = balanced([detail({ invoice: "INV-CLEAN", labor: 8000, num: "200001" })]);
  const first = await uploadCrbFile({ filename: "smoke-clean.txt", bytes: Buffer.from(clean, "latin1"), actor: "smoke-crb" });
  if (first.noop || first.controlStatus !== "BALANCED") bad("clean upload", first.controlStatus);
  const again = await uploadCrbFile({ filename: "smoke-clean.txt", bytes: Buffer.from(clean, "latin1"), actor: "smoke-crb" });
  if (!again.noop || again.fileId !== first.fileId) bad("noop");
  ok("idempotent re-upload");

  const changed = balanced([detail({ invoice: "INV-CLEAN", labor: 8100, num: "200001" })]);
  const next = await uploadCrbFile({ filename: "smoke-clean-v2.txt", bytes: Buffer.from(changed, "latin1"), actor: "smoke-crb" });
  if (next.noop || !next.superseded.includes(first.fileId)) bad("supersede", next.superseded.join(","));
  const { rows: prior } = await q<{ version_status: string }>(`SELECT version_status FROM repair.crb_files WHERE id = $1`, [first.fileId]);
  if (prior[0]?.version_status !== "SUPERSEDED") bad("prior status", prior[0]?.version_status);
  ok("new hash supersedes; earlier file kept");

  const linkText = balanced([
    detail({ invoice: "INV-LINK", account: "2611", labor: 1000, num: "200001", lineNo: 1 }),
    detail({ invoice: "INV-LINK", account: "2611", labor: 1000, num: "200003", lineNo: 2 }),
    detail({ invoice: "INV-LINK", account: "2611", labor: 1000, car: "OTHR", num: "999002", lineNo: 3 }),
  ], "2611");
  await uploadCrbFile({ filename: "smoke-link.txt", bytes: Buffer.from(linkText, "latin1"), actor: "smoke-crb" });
  const { rows: linkCars } = await q<{ car_initial: string; car_number: string; flags: string[]; lease_id: string | null }>(
    `SELECT c.car_initial, c.car_number, c.flags, c.lease_id
     FROM repair.crb_cars c
     JOIN repair.crb_invoices i ON i.id = c.invoice_id
     WHERE i.invoice_number = 'INV-LINK'`,
  );
  const owned = linkCars.find((car) => car.car_number.includes("200001"));
  const noLease = linkCars.find((car) => car.car_number.includes("200003"));
  const other = linkCars.find((car) => car.car_initial === "OTHR" || car.car_number.includes("999002"));
  if (!owned || owned.flags.includes("NOT_OWNED_ON_REPAIR_DATE") || !owned.lease_id) bad("owned link", JSON.stringify(owned));
  if (!noLease?.flags.includes("NO_ACTIVE_LEASE")) bad("no lease", JSON.stringify(noLease));
  if (!other?.flags.includes("NOT_OWNED_ON_REPAIR_DATE") || !other.flags.includes("MARK_NOT_RESIDCO")) bad("not residco", JSON.stringify(other));
  const { rows: leaseFinding } = await q<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM repair.audit_findings WHERE rule_code = 'NO_LEASE' AND message = 'NO_ACTIVE_LEASE'`,
  );
  if (Number(leaseFinding[0]?.n ?? 0) < 1) bad("NO_LEASE finding");
  ok("linkage: owned, no lease, not owned, mark not RESIDCO");

  const dupText = balanced([
    detail({ invoice: "INV-D1", account: "2612", labor: 1500, num: "200001", lineNo: 1 }),
    detail({ invoice: "INV-D2", account: "2612", labor: 1500, num: "200001", lineNo: 2 }),
  ], "2612");
  await uploadCrbFile({ filename: "smoke-dup.txt", bytes: Buffer.from(dupText, "latin1"), actor: "smoke-crb" });
  const { rows: dups } = await q<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM repair.audit_findings f
     JOIN repair.crb_invoices i ON i.id = f.invoice_id
     WHERE f.rule_code = 'DUPLICATE_BILLING' AND i.invoice_number = 'INV-D2'`,
  );
  if (Number(dups[0]?.n ?? 0) < 1) bad("duplicate");
  ok("duplicate billing across CRB invoices");

  const badFile = [
    detail({ invoice: "INV-OOB", account: "2613", labor: 4000, num: "200001" }),
    subtotal({ invoice: "INV-OOB", account: "2613", ds: "BR", count: 1, labor: 4000 }),
    subtotal({ invoice: "INV-OOB", account: "2613", ds: "ZZ", count: 1, labor: 1111 }),
    file9(1, 1111, 0, "2613"),
    "",
  ].join("\n");
  const oob = await uploadCrbFile({ filename: "smoke-oob.txt", bytes: Buffer.from(badFile, "latin1"), actor: "smoke-crb" });
  if (oob.controlStatus !== "OUT_OF_BALANCE") bad("oob status", oob.controlStatus);
  const { rows: oobInv } = await q<{ id: string; control_ok: boolean }>(
    `SELECT id, control_ok FROM repair.crb_invoices WHERE invoice_number = 'INV-OOB' AND file_id = $1`,
    [oob.fileId],
  );
  if (!oobInv[0] || oobInv[0].control_ok) bad("oob invoice still viewable and out of balance");
  const { rows: stops } = await q<{ message: string }>(
    `SELECT message FROM repair.audit_findings WHERE invoice_id = $1 AND rule_code IN ('CONTROL_TOTALS','R112_PROPERLY_RENDERED')`,
    [oobInv[0].id],
  );
  const blob = stops.map((row) => row.message).join(" ");
  if (!blob.includes("CONTROL_TOTALS") || !blob.includes("DETAIL_SOURCE_SUBTOTAL_MISMATCH")) bad("control findings", blob);
  const { rows: oobCars } = await q<{ id: string }>(`SELECT id FROM repair.crb_cars WHERE invoice_id = $1`, [oobInv[0].id]);
  const decided = await decideCar({ carId: oobCars[0].id, decision: "APPROVED", actor: "smoke-crb" });
  if (!decided.ok) bad("decide oob", decided.error);
  const blocked = await setInvoiceStatus({ invoiceId: oobInv[0].id, status: "APPROVED", actor: "smoke-crb" });
  if (blocked.ok || blocked.status !== 409) bad("hard stop gate", JSON.stringify(blocked));
  const returned = await setInvoiceStatus({ invoiceId: oobInv[0].id, status: "RETURN_UNPAID", actor: "smoke-crb" });
  if (!returned.ok) bad("return", returned.error);
  ok("out of balance hard-stops approval and still allows return unpaid");

  const { rows: cleanInv } = await q<{ id: string }>(
    `SELECT i.id FROM repair.crb_invoices i
     JOIN repair.crb_files f ON f.id = i.file_id
     WHERE i.invoice_number = 'INV-CLEAN' AND f.version_status = 'ACTIVE'`,
  );
  const pending = await setInvoiceStatus({ invoiceId: cleanInv[0].id, status: "APPROVED", actor: "smoke-crb" });
  if (pending.ok || !pending.error.includes("until every car")) bad("pending gate", pending.ok ? "ok" : pending.error);
  const { rows: cleanCars } = await q<{ id: string }>(`SELECT id FROM repair.crb_cars WHERE invoice_id = $1`, [cleanInv[0].id]);
  const approvedCar = await decideCar({ carId: cleanCars[0].id, decision: "APPROVED", actor: "smoke-crb" });
  if (!approvedCar.ok) bad("decide clean", approvedCar.error);
  const closedTry = await setInvoiceStatus({
    invoiceId: cleanInv[0].id,
    status: "APPROVED",
    actor: "smoke-crb",
    monthBucketId: closed[0].id,
  });
  if (closedTry.ok || closedTry.status !== 409) bad("closed month", JSON.stringify(closedTry));
  const pooled = await setInvoiceStatus({ invoiceId: cleanInv[0].id, status: "APPROVED", actor: "smoke-crb" });
  if (!pooled.ok) bad("pool", pooled.error);
  const { rows: pool } = await q<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM repair.month_pool_lines
     WHERE source = 'CRB' AND crb_line_id IN (SELECT id FROM repair.crb_lines WHERE invoice_id = $1)`,
    [cleanInv[0].id],
  );
  if (Number(pool[0]?.n ?? 0) < 1) bad("pool rows");
  ok("approve waits for every car, refuses a closed month, and pools CRB lines");

  const { rows: lineFinding } = await q<{ id: string; target_id: string }>(
    `SELECT f.id, f.target_id FROM repair.audit_findings f
     JOIN repair.crb_invoices i ON i.id = f.invoice_id
     WHERE f.rule_code = 'DUPLICATE_BILLING' AND f.status = 'OPEN' AND i.invoice_number = 'INV-D2'
     LIMIT 1`,
  );
  if (!lineFinding[0]) bad("override target");
  const over = await createOverride({
    scope: "LINE",
    targetId: lineFinding[0].target_id,
    findingId: lineFinding[0].id,
    reason: "DEMO smoke override reason",
    actor: "smoke-crb",
  });
  if (!over.ok) bad("override", over.error);
  const { rows: audit } = await q<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM repair.crb_audit_log WHERE action = 'override' AND actor = 'smoke-crb'`,
  );
  const { rows: ov } = await q<{ status: string }>(`SELECT status FROM repair.audit_findings WHERE id = $1`, [lineFinding[0].id]);
  if (Number(audit[0]?.n ?? 0) < 1 || ov[0]?.status !== "OVERRIDDEN") bad("audit trail", ov[0]?.status);
  ok("override is append-only and written to the audit log");

  const minText = balanced([
    detail({ invoice: "INV-MIN", account: "2614", labor: 4000, num: "200001", why: "08", wrong: "Y" }),
  ], "2614");
  const minUp = await uploadCrbFile({ filename: "smoke-min.txt", bytes: Buffer.from(minText, "latin1"), actor: "smoke-crb" });
  const { rows: minInv } = await q<{ id: string }>(
    `SELECT id FROM repair.crb_invoices WHERE file_id = $1 AND invoice_number = 'INV-MIN'`,
    [minUp.fileId],
  );
  const minPkg = await generatePackage({ invoiceId: minInv[0].id, type: "PAID_EXCEPTION_LETTER_n", actor: "smoke-crb" });
  if (minPkg.ok || minPkg.status !== 409) bad("under 100", JSON.stringify(minPkg));
  ok("paid exception letter blocked under $100");

  const bigText = balanced([
    detail({
      invoice: "INV-LET",
      account: "2615",
      labor: 200000,
      num: "200001",
      load: "E",
      rate: 10000,
      job: "2222",
      loc: "B2",
      repair: "261020",
    }),
  ], "2615");
  const bigUp = await uploadCrbFile({ filename: "smoke-letter.txt", bytes: Buffer.from(bigText, "latin1"), actor: "smoke-crb" });
  const { rows: bigInv } = await q<{ id: string }>(
    `SELECT id FROM repair.crb_invoices WHERE file_id = $1`,
    [bigUp.fileId],
  );
  const letter = await generatePackage({ invoiceId: bigInv[0].id, type: "PAID_EXCEPTION_LETTER_n", actor: "smoke-crb" });
  if (!letter.ok) bad("letter", letter.error);
  if (!existsSync(letter.pdfPath) || !existsSync(letter.xlsxPath) || !existsSync(letter.draftPath)) bad("package files");
  const { rows: pkg } = await q<{ status: string }>(`SELECT status FROM repair.exception_packages WHERE id = $1`, [letter.id]);
  if (pkg[0]?.status !== "DRAFT") bad("draft", pkg[0]?.status);
  const second = await generatePackage({ invoiceId: bigInv[0].id, type: "PAID_EXCEPTION_LETTER_n", actor: "smoke-crb" });
  if (second.ok || second.status !== 409) bad("all at once", JSON.stringify(second));
  ok("package files are local drafts; a later letter cannot add a non-exempt type");

  const rules = await listAuditRules();
  const sample = rules.find((rule) => rule.code === "R112_RECEIPT_DATE" && rule.version === 1);
  if (!sample) bad("seeded rules");
  const cloned = await cloneAuditRule({
    id: sample.id,
    effectiveFrom: "2099-01-01",
    actor: "smoke-crb",
    params: sample.params,
  });
  if (!cloned.ok) bad("clone", cloned.error);
  const after = await listAuditRules();
  const picked = selectRuleVersion(
    after.filter((rule) => rule.code === "R112_RECEIPT_DATE").map((rule) => ({
      code: rule.code,
      version: rule.version,
      params: rule.params,
      severity: rule.severity,
      enabled: rule.enabled,
      effectiveFrom: String(rule.effective_from).slice(0, 10),
      effectiveTo: rule.effective_to ? String(rule.effective_to).slice(0, 10) : null,
    })),
    "R112_RECEIPT_DATE",
    "2610",
  );
  if (picked?.version !== 1) bad("account month still on v1", String(picked?.version));
  ok("cloned rule applies only from its effective account month");

  const matched = await upsertBillerHeader({
    billingParty: "SMOK",
    invoiceNumber: "INV-CLEAN",
    accountMonth: "2610",
    totalCents: 8100,
    carCount: 1,
    actor: "smoke-crb",
  });
  if (!matched.ok) bad("matched header", matched.error);
  const ghost = await upsertBillerHeader({
    billingParty: "SMOK",
    invoiceNumber: "INV-GHOST",
    accountMonth: "2610",
    totalCents: 100,
    carCount: 1,
    actor: "smoke-crb",
  });
  if (!ghost.ok) bad("ghost header", ghost.error);
  const { rows: stale } = await q<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM repair.audit_findings
     WHERE status = 'OPEN' AND message LIKE 'BILLER_INVOICE_WITHOUT_CRB%INV-CLEAN%'`,
  );
  if (Number(stale[0]?.n ?? 0) !== 0) bad("matched header still flagged without CRB");
  const { rows: ghostFinding } = await q<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM repair.audit_findings
     WHERE status = 'OPEN' AND message LIKE 'BILLER_INVOICE_WITHOUT_CRB%INV-GHOST%'`,
  );
  if (Number(ghostFinding[0]?.n ?? 0) < 1) bad("ghost header finding");
  const { rows: missing } = await q<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM repair.audit_findings f
     JOIN repair.crb_invoices i ON i.id = f.invoice_id
     WHERE i.invoice_number = 'INV-OOB' AND f.message = 'CRB_WITHOUT_BILLER_INVOICE' AND f.status = 'OPEN'`,
  );
  if (Number(missing[0]?.n ?? 0) < 1) bad("crb without biller");
  ok("biller recon codes are the messages the loader writes");

  const knownFormat = await lookupRefCode({ kind: "record_format", code: "1" });
  if (!knownFormat.found || knownFormat.description !== "Detail billing line") {
    bad("record format lookup", knownFormat.description);
  }
  const unknownFormat = await lookupRefCode({ kind: "record_format", code: "7" });
  if (unknownFormat.found || unknownFormat.description !== "Not in reference table") {
    bad("unknown record format", unknownFormat.description);
  }
  const unknownJob = await lookupRefCode({ kind: "job", code: "ZZZZ" });
  if (unknownJob.found || unknownJob.description !== "Not in reference table") {
    bad("unknown job code", unknownJob.description);
  }
  ok("reference lookup decodes record format and reports an unknown code");
}

async function main() {
  console.log("=== repair:smoke-crb ===");
  process.env.REPAIR_LOCAL_DB = "1";
  process.env.REPAIR_DEV_BYPASS_AUTH = "1";
  if (!process.env.DATABASE_URL && !process.env.REPAIR_DATABASE_URL) {
    process.env.DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev";
  }
  pureChecks();
  await dbChecks();
  console.log("=== repair:smoke-crb PASS ===");
}

const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : err);
    process.exit(1);
  });
}
