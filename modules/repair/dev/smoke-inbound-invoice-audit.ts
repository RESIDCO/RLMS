/**
 * Smoke: inbound shop 500-byte intake + CRB pre-pay audit.
 * Cases: good file, mismatched total, unknown car, duplicate.
 * Also exercises DevInboundEmailProvider attachment path.
 *
 * Requires DATABASE_URL + migrated repair schema (incl. inbound_invoice_audit).
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

  // ── 1) Good file ───────────────────────────────────────────────────
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
  ]) {
    if (goodChecks.get(code) !== "PASS") {
      throw new Error(`good file check ${code} expected PASS, got ${goodChecks.get(code)}`);
    }
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

  // Original document immutable — sha stored; re-fetch document sha matches file
  const { rows: docs } = await q(
    `SELECT sha256 FROM repair.documents WHERE id = $1`,
    [goodIntake.document.id],
  );
  if (String(docs[0].sha256) !== parsed.sha256) {
    throw new Error("document sha256 drift — original must be immutable");
  }

  // ── 2) Mismatched total ────────────────────────────────────────────
  const mismatchEv = await seedEvent({
    carMark: "OFOX",
    carNumber: "528313",
    shopId,
    actor: "smoke-inv",
    withSampleEstimate: false,
    simpleTotal: 100,
  });
  const mismatchIntake = await submitShopCrbInvoice({
    rawToken: mismatchEv.token,
    bytes: sampleBytes,
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
  // Still queued for human review (not hard-rejected)
  if (mismatchIntake.reviewStatus !== "PENDING_REVIEW") {
    throw new Error("mismatch should still be PENDING_REVIEW");
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
  // Event still OFOX — car mismatch OR not in VCF. Use a dedicated event + unknown file car.
  // Hard reject path: car not owned/managed (not in VCF).
  const unknownEv = await seedEvent({
    carMark: "OFOX",
    carNumber: "528313",
    shopId,
    actor: "smoke-inv",
    withSampleEstimate: true,
  });
  // Mutate sample car to something not in VCF at all
  const ghostBytes = mutateCarOnSample(sampleBytes, "GHOST", "000001");
  // Align event car temporarily by creating BO for ghost — but ghost not in VCF.
  // Direct intake against unknownEv token will fail car-match first.
  // Use ingest with eventId after temporarily... better: call with token of OFOX event
  // and ghost file → 422 car mismatch. Also test pure VCF reject via inbound with
  // a ghost event — createBadOrder for ghost should fail. So:
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
  // Pure VCF reject: mutate unknownBytes and try createBadOrder
  const notVcf = await createBadOrder({
    carMark: "GHOST",
    carNumber: "000001",
    actor: "smoke-inv",
    shopId,
  });
  if (notVcf.ok) throw new Error("GHOST car should not be in VCF");

  // Also confirm unknownBytes (ZZZX 999999) — stub may have ZZZX railcar but not VCF row
  const zzzxIntake = await submitShopCrbInvoice({
    rawToken: unknownEv.token,
    bytes: unknownBytes,
    filename: "zzzx.txt",
    mime: "text/plain",
    actorEmail: "shop@smoke.invalid",
  });
  if (zzzxIntake.ok) throw new Error("ZZZX file on OFOX event should reject");
  if (zzzxIntake.status !== 422) throw new Error(`ZZZX expected 422 got ${zzzxIntake.status}`);

  // ── 4) Duplicate ───────────────────────────────────────────────────
  const dupEv = await seedEvent({
    carMark: "OFOX",
    carNumber: "528313",
    shopId,
    actor: "smoke-inv",
    withSampleEstimate: true,
  });
  const first = await submitShopCrbInvoice({
    rawToken: dupEv.token,
    bytes: sampleBytes,
    filename: "Sample_Shop_500byte_OFOX2609.txt",
    mime: "text/plain",
    actorEmail: "shop@smoke.invalid",
  });
  if (!first.ok) throw new Error(`dup first: ${first.error}`);
  const second = await submitShopCrbInvoice({
    rawToken: dupEv.token,
    bytes: sampleBytes,
    filename: "Sample_Shop_500byte_OFOX2609.txt",
    mime: "text/plain",
    actorEmail: "shop@smoke.invalid",
  });
  if (!second.ok) throw new Error(`dup second: ${second.error}`);
  const dupChecks = checkMap(await listPrepayChecks(String(second.invoice.id)));
  if (dupChecks.get("DUPLICATE") !== "FAIL") {
    throw new Error("expected DUPLICATE FAIL on second submit");
  }

  // ── 5) Dev inbound-email adapter ───────────────────────────────────
  const emailEv = await seedEvent({
    carMark: "OFOX",
    carNumber: "528313",
    shopId,
    actor: "smoke-inv",
    withSampleEstimate: true,
  });
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
        contentBase64: sampleBytes.toString("base64"),
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
        duplicate: {
          secondInvoiceId: second.invoice.id,
          duplicateCheck: dupChecks.get("DUPLICATE"),
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
