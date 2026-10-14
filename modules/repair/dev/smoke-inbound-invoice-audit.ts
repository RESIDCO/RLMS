/**
 * Smoke: inbound shop 500-byte intake + CRB pre-pay audit (incl. Q18–Q20).
 * Cases: good file (blank invoice_no WARN), mismatched total (ACH blocked),
 * unknown car, hard duplicate (billing+invoice_no), soft scope WARN,
 * reviewer invoice_no entry, inbound email, append-only checks.
 *
 * Requires DATABASE_URL + migrated repair schema (incl. invoice_q18_q20).
 * Run: npm run repair:smoke-inbound-invoice
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createBadOrder } from "../services/bo";
import { issueEventLink } from "../services/event-links";
import { shopAccept, shopOnHand } from "../services/shop-actions";
import { uploadEstimate, approveEstimate, submitForApproval } from "../services/estimates";
import {
  submitShopCrbInvoice,
  ingestCrbInvoiceFromInboundEmail,
  decideInvoiceReview,
  listPrepayChecks,
  setInvoiceNumberByReviewer,
  reauditInvoiceTotals,
} from "../services/inbound-invoice-audit";
import { getInboundEmailProvider } from "../providers/inbound-email";
import { DEFAULT_TENANT_ID, q } from "../db";
import { parseAarFile, signedMaterialCents } from "../services/aar-parser";

const samplePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "reference/Sample_Shop_500byte_OFOX2609.txt",
);

async function seedOfoxVcf() {
  await q(
    `INSERT INTO public.railcars (id, car_number, car_initial, reporting_marks, active, assignment_label, lessee_name)
     VALUES (528313, '528313', 'OFOX', 'OFOX', true, 'SMOKE-OFOX', 'Smoke Lessee')
     ON CONFLICT (id) DO UPDATE SET car_initial = 'OFOX', car_number = '528313', active = true`,
  );
  await q(
    `INSERT INTO public.v_valid_export_rows_data
       (export_src, export_id, car_initial, car_number, active, rider, assignment, assignment_id, lessee, start_date, end_date)
     SELECT 1, 528313, 'OFOX', '528313', 1, 'R-OFOX', 'SMOKE-OFOX', 'A-OFOX', 'Smoke Lessee', '2026-01-01', NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM public.v_valid_export_rows_data
       WHERE car_initial = 'OFOX' AND car_number = '528313'
     )`,
  );
}

async function ensureTenantOwnerMark() {
  await q(
    `UPDATE repair.tenants
     SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
       'carOwnerMark', 'OFOX',
       'crbPaymentTermsDays', 30
     )
     WHERE id = $1`,
    [DEFAULT_TENANT_ID],
  );
}

async function apaShopId(): Promise<string> {
  const { rows } = await q(
    `SELECT id FROM repair.shops
     WHERE tenant_id = $1 AND reporting_mark = 'APA' AND deleted_at IS NULL`,
    [DEFAULT_TENANT_ID],
  );
  if (!rows[0]) throw new Error("APA shop not seeded");
  return String(rows[0].id);
}

async function seedEvent(opts: {
  carMark: string;
  carNumber: string;
  shopId: string;
  actor: string;
  withSampleEstimate: boolean;
  simpleTotal?: number;
}) {
  const bo = await createBadOrder({
    carMark: opts.carMark,
    carNumber: opts.carNumber,
    rule: "RULE_1",
    source: "INTERNAL",
    actor: opts.actor,
    shopId: opts.shopId,
  });
  if (!bo.ok) throw new Error(bo.error);
  const eventId = String(bo.event.id);
  const link = await issueEventLink({ eventId, scope: "SHOP", actor: opts.actor });
  const token = link.token;
  const acc = await shopAccept(token, "shop@smoke.invalid");
  if (!acc.ok) throw new Error(acc.error);
  const oh = await shopOnHand(token, "shop@smoke.invalid");
  if (!oh.ok) throw new Error(oh.error);

  const sampleBytes = opts.withSampleEstimate ? readFileSync(samplePath) : undefined;
  const est = await uploadEstimate({
    rawToken: token,
    actorName: "shop",
    actorEmail: "shop@smoke.invalid",
    via: "event_link",
    file: sampleBytes
      ? {
          filename: "Sample_Shop_500byte_OFOX2609.txt",
          mime: "text/plain",
          bytes: sampleBytes,
        }
      : undefined,
    lines: sampleBytes
      ? undefined
      : [
          {
            lineNo: 1,
            aarJobCode: "4800",
            labor: opts.simpleTotal ?? 100,
            material: 0,
            total: opts.simpleTotal ?? 100,
            respCode: "1",
          },
        ],
  });
  if (!est.ok) throw new Error(est.error);
  const estimateId = String(est.estimate.id);
  await submitForApproval({ estimateId, actor: "reviewer@smoke" });
  const appr = await approveEstimate({ estimateId, actor: "reviewer@smoke" });
  if (!appr.ok) throw new Error(appr.error);

  const { rows: tot } = await q(
    `SELECT total FROM repair.estimate_revisions
     WHERE estimate_id = $1 ORDER BY rev_no DESC LIMIT 1`,
    [estimateId],
  );
  return {
    eventId,
    estimateId,
    token,
    estimateTotal: Number(tot[0].total),
  };
}

function checkMap(rows: Array<{ check_code: string; result: string }>) {
  const m = new Map<string, string>();
  for (const r of rows) m.set(String(r.check_code), String(r.result));
  return m;
}

function mutateCarOnSample(bytes: Buffer, mark: string, number: string): Buffer {
  const text = bytes.toString("latin1");
  const ending = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out = lines.map((line) => {
    if (line.length !== 500 || line[0] !== "1") return line;
    const chars = line.split("");
    const m = mark.padEnd(4, " ").slice(0, 4);
    const n = number.padStart(6, "0").slice(-6);
    for (let i = 0; i < 4; i++) chars[47 + i] = m[i];
    for (let i = 0; i < 6; i++) chars[51 + i] = n[i];
    return chars.join("");
  });
  return Buffer.from(out.join(ending), "latin1");
}

/** Stamp a real invoice_number into Format 1 cols 14–29 (1-based; 0-based 13–28). */
function stampInvoiceNo(bytes: Buffer, invoiceNo: string): Buffer {
  const text = bytes.toString("latin1");
  const ending = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const padded = invoiceNo.padEnd(16, " ").slice(0, 16);
  const out = lines.map((line) => {
    if (line.length !== 500 || line[0] !== "1") return line;
    const chars = line.split("");
    for (let i = 0; i < 16; i++) chars[13 + i] = padded[i];
    return chars.join("");
  });
  return Buffer.from(out.join(ending), "latin1");
}

async function main() {
  const sampleBytes = readFileSync(samplePath);
  const parsed = parseAarFile(sampleBytes);
  const labor = parsed.lines.reduce((s, l) => s + (l.laborCents ?? 0), 0);
  const material = parsed.lines.reduce((s, l) => s + signedMaterialCents(l), 0);
  const expectedCents = labor + material;
  if (expectedCents !== 3673204) {
    throw new Error(`fixture total expected 3673204 cents, got ${expectedCents}`);
  }
  if (!parsed.flags.includes("detail_only_extract")) {
    throw new Error("fixture must be detail-only (no 8/9)");
  }

  await seedOfoxVcf();
  await ensureTenantOwnerMark();
  const shopId = await apaShopId();

  // ── 1) Good file (blank invoice_no → synthetic key + WARN) ─────────
  const good = await seedEvent({
    carMark: "OFOX",
    carNumber: "528313",
    shopId,
    actor: "smoke-inv",
    withSampleEstimate: true,
  });
  if (Math.round(good.estimateTotal * 100) !== expectedCents) {
    throw new Error(
      `estimate total ${good.estimateTotal} != fixture ${(expectedCents / 100).toFixed(2)}`,
    );
  }

  const goodIntake = await submitShopCrbInvoice({
    rawToken: good.token,
    bytes: sampleBytes,
    filename: "Sample_Shop_500byte_OFOX2609.txt",
    mime: "text/plain",
    actorEmail: "shop@smoke.invalid",
  });
  if (!goodIntake.ok) throw new Error(`good intake failed: ${goodIntake.error}`);
  if (goodIntake.reviewStatus !== "PENDING_REVIEW") {
    throw new Error("good file should enter PENDING_REVIEW");
  }
  if (goodIntake.matchStatus !== "MATCHED") {
    throw new Error(`expected MATCHED, got ${goodIntake.matchStatus}`);
  }
  if (!goodIntake.detailOnly) throw new Error("expected detailOnly");
  if (goodIntake.totalCents !== expectedCents) {
    throw new Error(`totalCents ${goodIntake.totalCents} != ${expectedCents}`);
  }
  if (!goodIntake.invoiceNoBlank) throw new Error("Q18 expected blank invoice_no");
  if (goodIntake.invoiceNoSource !== "SYNTHETIC") {
    throw new Error("Q18 expected SYNTHETIC invoice_no_source");
  }
  const syn = String(goodIntake.invoice.invoice_no);
  if (!syn.includes(good.eventId) || !syn.startsWith("APA-OFOX")) {
    throw new Error(`Q18 synthetic key unexpected: ${syn}`);
  }

  const goodChecks = checkMap(await listPrepayChecks(String(goodIntake.invoice.id)));
  for (const code of [
    "LINE_LENGTH",
    "DETAIL_TOTALS",
    "BILLING_PARTY",
    "BILLED_PARTY",
    "VCF_CAR",
    "TOTAL_MATCH",
    "JOB_CODE",
    "RESP_CODE",
    "DUPLICATE",
    "DUPLICATE_SCOPE",
  ]) {
    if (goodChecks.get(code) !== "PASS") {
      throw new Error(`good file check ${code} expected PASS, got ${goodChecks.get(code)}`);
    }
  }
  if (goodChecks.get("BLANK_INVOICE_NO") !== "WARN") {
    throw new Error("Q18 expected BLANK_INVOICE_NO WARN");
  }

  // Reviewer enters real invoice number
  const entered = await setInvoiceNumberByReviewer({
    invoiceId: String(goodIntake.invoice.id),
    invoiceNo: "SMOKE-INV-001",
    actor: "reviewer@smoke",
  });
  if (!entered.ok) throw new Error(entered.error);
  if (entered.invoice.invoice_no !== "SMOKE-INV-001") {
    throw new Error("reviewer invoice_no not applied");
  }
  if (entered.invoice.invoice_no_blank !== false) {
    throw new Error("invoice_no_blank should clear after reviewer entry");
  }
  if (entered.invoice.invoice_no_source !== "REVIEWER") {
    throw new Error("expected REVIEWER source");
  }

  const approved = await decideInvoiceReview({
    invoiceId: String(goodIntake.invoice.id),
    decision: "APPROVED_FOR_ACH",
    actor: "reviewer@smoke",
  });
  if (!approved.ok) throw new Error(approved.error);
  if (approved.invoice.review_status !== "APPROVED_FOR_ACH") {
    throw new Error("expected APPROVED_FOR_ACH");
  }
  if (approved.invoice.match_status !== "APPROVED") {
    throw new Error("ACH approve should stamp match_status APPROVED after MATCHED");
  }

  // Original document immutable — sha stored; re-fetch document sha matches file
  const { rows: docs } = await q(
    `SELECT sha256 FROM repair.documents WHERE id = $1`,
    [goodIntake.document.id],
  );
  if (String(docs[0].sha256) !== parsed.sha256) {
    throw new Error("document sha256 drift — original must be immutable");
  }

  // ── 2) Mismatched total — Q20 blocks ACH ───────────────────────────
  const mismatchEv = await seedEvent({
    carMark: "OFOX",
    carNumber: "528313",
    shopId,
    actor: "smoke-inv",
    withSampleEstimate: false,
    simpleTotal: 100,
  });
  // Stamp unique invoice_no so Q19(a) does not hard-block against prior synthetic/entered
  const mismatchBytes = stampInvoiceNo(sampleBytes, "MM-SMOKE-100");
  const mismatchIntake = await submitShopCrbInvoice({
    rawToken: mismatchEv.token,
    bytes: mismatchBytes,
    filename: "Sample_Shop_500byte_OFOX2609.txt",
    mime: "text/plain",
    actorEmail: "shop@smoke.invalid",
  });
  if (!mismatchIntake.ok) throw new Error(`mismatch intake: ${mismatchIntake.error}`);
  if (mismatchIntake.matchStatus !== "MISMATCH") {
    throw new Error("expected MISMATCH matchStatus");
  }
  const mmChecks = checkMap(await listPrepayChecks(String(mismatchIntake.invoice.id)));
  if (mmChecks.get("TOTAL_MATCH") !== "FAIL") {
    throw new Error("expected TOTAL_MATCH FAIL");
  }
  if (mmChecks.get("BLANK_INVOICE_NO") !== "PASS") {
    throw new Error("stamped invoice_no should PASS BLANK_INVOICE_NO");
  }
  // Soft scope may WARN (same car + total from other events with overlapping jobs)
  // Still queued for human review (not hard-rejected)
  if (mismatchIntake.reviewStatus !== "PENDING_REVIEW") {
    throw new Error("mismatch should still be PENDING_REVIEW");
  }

  const achBlocked = await decideInvoiceReview({
    invoiceId: String(mismatchIntake.invoice.id),
    decision: "APPROVED_FOR_ACH",
    actor: "reviewer@smoke",
  });
  if (achBlocked.ok) throw new Error("Q20: MISMATCH must not APPROVED_FOR_ACH");
  if (achBlocked.status !== 409) {
    throw new Error(`Q20 expected 409, got ${achBlocked.status}: ${achBlocked.error}`);
  }
  if (!String(achBlocked.error).includes("No override")) {
    throw new Error(`Q20 error should mention no override: ${achBlocked.error}`);
  }

  const reauditStillMismatch = await reauditInvoiceTotals({
    invoiceId: String(mismatchIntake.invoice.id),
    actor: "reviewer@smoke",
  });
  if (!reauditStillMismatch.ok) throw new Error(reauditStillMismatch.error);
  if (reauditStillMismatch.matchStatus !== "MISMATCH") {
    throw new Error("reaudit without Adjustment should remain MISMATCH");
  }

  const rejected = await decideInvoiceReview({
    invoiceId: String(mismatchIntake.invoice.id),
    decision: "REJECTED",
    reason: "Invoice total does not match approved final estimate",
    actor: "reviewer@smoke",
  });
  if (!rejected.ok) throw new Error(rejected.error);

  // ── 3) Unknown car (hard reject) ───────────────────────────────────
  const unknownBytes = mutateCarOnSample(sampleBytes, "ZZZX", "999999");
  const unknownEv = await seedEvent({
    carMark: "OFOX",
    carNumber: "528313",
    shopId,
    actor: "smoke-inv",
    withSampleEstimate: true,
  });
  const ghostBytes = mutateCarOnSample(sampleBytes, "GHOST", "000001");
  const ghostReject = await submitShopCrbInvoice({
    rawToken: unknownEv.token,
    bytes: ghostBytes,
    filename: "ghost.txt",
    mime: "text/plain",
    actorEmail: "shop@smoke.invalid",
  });
  if (ghostReject.ok) throw new Error("unknown/mismatched car should hard-reject");
  if (ghostReject.status !== 422) {
    throw new Error(`expected 422, got ${ghostReject.status}: ${ghostReject.error}`);
  }
  const notVcf = await createBadOrder({
    carMark: "GHOST",
    carNumber: "000001",
    actor: "smoke-inv",
    shopId,
  });
  if (notVcf.ok) throw new Error("GHOST car should not be in VCF");

  const zzzxIntake = await submitShopCrbInvoice({
    rawToken: unknownEv.token,
    bytes: unknownBytes,
    filename: "zzzx.txt",
    mime: "text/plain",
    actorEmail: "shop@smoke.invalid",
  });
  if (zzzxIntake.ok) throw new Error("ZZZX file on OFOX event should reject");
  if (zzzxIntake.status !== 422) throw new Error(`ZZZX expected 422 got ${zzzxIntake.status}`);

  // ── 4) Q19(a) hard duplicate: same billing + invoice_no any period ─
  const dupEv = await seedEvent({
    carMark: "OFOX",
    carNumber: "528313",
    shopId,
    actor: "smoke-inv",
    withSampleEstimate: true,
  });
  const numbered = stampInvoiceNo(sampleBytes, "APA-HARD-DUP-1");
  const first = await submitShopCrbInvoice({
    rawToken: dupEv.token,
    bytes: numbered,
    filename: "Sample_Shop_500byte_OFOX2609.txt",
    mime: "text/plain",
    actorEmail: "shop@smoke.invalid",
  });
  if (!first.ok) throw new Error(`dup first: ${first.error}`);

  const otherEv = await seedEvent({
    carMark: "OFOX",
    carNumber: "528313",
    shopId,
    actor: "smoke-inv",
    withSampleEstimate: true,
  });
  const hardDup = await submitShopCrbInvoice({
    rawToken: otherEv.token,
    bytes: numbered,
    filename: "Sample_Shop_500byte_OFOX2609.txt",
    mime: "text/plain",
    actorEmail: "shop@smoke.invalid",
  });
  if (hardDup.ok) throw new Error("Q19a: same billing+invoice_no must hard-block");
  if (hardDup.status !== 422) {
    throw new Error(`Q19a expected 422, got ${hardDup.status}: ${hardDup.error}`);
  }
  if (!String(hardDup.error).includes("Hard block")) {
    throw new Error(`Q19a error should say Hard block: ${hardDup.error}`);
  }

  // Same-event resubmit of blank synthetic (same day) also hard-blocks
  const blankEv = await seedEvent({
    carMark: "OFOX",
    carNumber: "528313",
    shopId,
    actor: "smoke-inv",
    withSampleEstimate: true,
  });
  const blankFirst = await submitShopCrbInvoice({
    rawToken: blankEv.token,
    bytes: sampleBytes,
    filename: "blank1.txt",
    mime: "text/plain",
    actorEmail: "shop@smoke.invalid",
  });
  if (!blankFirst.ok) throw new Error(`blank first: ${blankFirst.error}`);
  const blankSecond = await submitShopCrbInvoice({
    rawToken: blankEv.token,
    bytes: sampleBytes,
    filename: "blank2.txt",
    mime: "text/plain",
    actorEmail: "shop@smoke.invalid",
  });
  if (blankSecond.ok) throw new Error("same-day blank synthetic resubmit should hard-block");
  if (blankSecond.status !== 422) {
    throw new Error(`blank resubmit expected 422 got ${blankSecond.status}`);
  }

  // ── 5) Q19(b) soft WARN: same car + total + overlapping jobs (12mo) ─
  // first (APA-HARD-DUP-1) already MATCHED on OFOX 528313 with sample job codes.
  // Submit a different invoice_no on another event → soft scope WARN.
  const softEv = await seedEvent({
    carMark: "OFOX",
    carNumber: "528313",
    shopId,
    actor: "smoke-inv",
    withSampleEstimate: true,
  });
  const softBytes = stampInvoiceNo(sampleBytes, "APA-SOFT-SCOPE-1");
  const softIntake = await submitShopCrbInvoice({
    rawToken: softEv.token,
    bytes: softBytes,
    filename: "soft-scope.txt",
    mime: "text/plain",
    actorEmail: "shop@smoke.invalid",
  });
  if (!softIntake.ok) throw new Error(`soft scope intake: ${softIntake.error}`);
  const softChecks = checkMap(await listPrepayChecks(String(softIntake.invoice.id)));
  if (softChecks.get("DUPLICATE") !== "PASS") {
    throw new Error("different invoice_no should PASS hard DUPLICATE");
  }
  if (softChecks.get("DUPLICATE_SCOPE") !== "WARN") {
    throw new Error(
      `Q19b expected DUPLICATE_SCOPE WARN, got ${softChecks.get("DUPLICATE_SCOPE")}`,
    );
  }

  // ── 6) Dev inbound-email adapter ───────────────────────────────────
  const emailEv = await seedEvent({
    carMark: "OFOX",
    carNumber: "528313",
    shopId,
    actor: "smoke-inv",
    withSampleEstimate: true,
  });
  const emailBytes = stampInvoiceNo(sampleBytes, "APA-EMAIL-001");
  const inbound = await getInboundEmailProvider().ingest({
    from: "shop@apa.example",
    to: `shop-invoice+${emailEv.token}@inbound.dev`,
    subject: "Shop invoice OFOX 528313",
    raw: "Please find 500-byte invoice attached.",
    receivedAt: new Date().toISOString(),
    eventToken: emailEv.token,
    attachments: [
      {
        filename: "Sample_Shop_500byte_OFOX2609.txt",
        mime: "text/plain",
        contentBase64: emailBytes.toString("base64"),
      },
    ],
  });
  if (!inbound.parsed.shopInvoiceAttachment) {
    throw new Error("inbound adapter should detect shop invoice attachment");
  }
  const emailIntake = await ingestCrbInvoiceFromInboundEmail({
    bytes: inbound.attachments[0].bytes,
    filename: inbound.attachments[0].filename,
    mime: inbound.attachments[0].mime,
    actorEmail: "shop@apa.example",
    eventToken: inbound.eventToken,
    inboundEmailId: inbound.id,
  });
  if (!emailIntake.ok) throw new Error(`email intake: ${emailIntake.error}`);
  if (emailIntake.invoice.intake_channel !== "INBOUND_EMAIL") {
    throw new Error("expected INBOUND_EMAIL channel");
  }

  // Append-only: UPDATE on prepay_checks must fail
  let appendOnlyOk = false;
  try {
    await q(
      `UPDATE repair.invoice_prepay_checks SET result = 'PASS' WHERE invoice_id = $1`,
      [goodIntake.invoice.id],
    );
  } catch {
    appendOnlyOk = true;
  }
  if (!appendOnlyOk) throw new Error("prepay_checks should be append-only");

  console.log(
    JSON.stringify(
      {
        ok: true,
        fixture: {
          lines: parsed.lines.length,
          totalCents: expectedCents,
          totalDollars: (expectedCents / 100).toFixed(2),
          detailOnly: true,
          sha256: parsed.sha256,
        },
        q18: {
          blank: true,
          syntheticKey: syn,
          reviewerInvoiceNo: entered.invoice.invoice_no,
          blankWarn: goodChecks.get("BLANK_INVOICE_NO"),
        },
        q19: {
          hardDupStatus: hardDup.status,
          blankResubmitStatus: blankSecond.status,
          softScope: softChecks.get("DUPLICATE_SCOPE"),
        },
        q20: {
          mismatchAchBlocked: !achBlocked.ok,
          achStatus: achBlocked.status,
          reauditMatchStatus: reauditStillMismatch.matchStatus,
        },
        good: {
          invoiceId: goodIntake.invoice.id,
          matchStatus: goodIntake.matchStatus,
          reviewStatus: approved.invoice.review_status,
          checksPass: [...goodChecks.entries()].filter(([, r]) => r === "PASS").length,
        },
        mismatch: {
          matchStatus: mismatchIntake.matchStatus,
          totalMatch: mmChecks.get("TOTAL_MATCH"),
          reviewStatus: rejected.invoice.review_status,
        },
        unknownCar: {
          ghostStatus: ghostReject.status,
          zzzxStatus: zzzxIntake.status,
        },
        inboundEmail: {
          inboundId: inbound.id,
          invoiceId: emailIntake.invoice.id,
          channel: emailIntake.invoice.intake_channel,
        },
        appendOnlyOk,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
