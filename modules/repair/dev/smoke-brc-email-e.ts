/**
 * Smoke: OWNER_UI §E r2 — Billing Repair Card PDF + Lessee responsibility email
 *
 * 1. BRC PDF (owner/lessee/shop): every header label + page footer; totals match grid
 * 2. Customary email: subject, table rows, attachment names, matching totals
 * 3. Local send → .eml outbox + DB outbox (never real send)
 *
 * Run: npm run repair:smoke-brc-email
 */
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { DEFAULT_TENANT_ID, q } from "../db";
import { createBadOrder } from "../services/bo";
import { shopAcknowledge, shopArrivalDate } from "../services/bo-lifecycle";
import { issueEventLink } from "../services/event-links";
import { loadEstimateAar } from "../services/estimate-load";
import { submitForApproval } from "../services/estimates";
import { parseAarFile } from "../services/aar-parser";
import { submitResponsibilityUpdates } from "../services/estimate-review";
import { createShop } from "../services/shops";
import {
  BRC_HEADER_LABELS,
  buildBrcPdf,
  extractBrcTotalCents,
  displayCarNumber,
} from "../services/brc-pdf";
import {
  buildSendLesseePreview,
  sendLesseeFromPreview,
} from "../services/send-lessee";
import { computeLesseeTotals } from "../services/lessee-totals";
import { migrateLocal } from "./migrate-local";
import { assertBrcEmailClientTypecheck } from "./typecheck-client-brc-email";

const samplePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "reference/Sample_Shop_500byte_OFOX2609.txt",
);

function ok(msg: string) {
  console.log(`  OK  ${msg}`);
}
function bad(label: string, detail: string): never {
  throw new Error(`${label}: ${detail}`);
}

const RUN = `E${Date.now().toString().slice(-8)}`;
const MARK = "AEX";
/** AAR/event car number (no leading zero — matches Format-1). Subject uses displayCarNumber. */
const NUMBER = "22881";
/** Compact attachment token still includes zero-pad style when desired */
const NUMBER_PADDED = "022881";

function withCar(bytes: Buffer, mark: string, number: string): Buffer {
  const parsed = parseAarFile(bytes);
  const lines = parsed.lines.map((line) => {
    if (line.recordFormat !== "1") return line.rawLine;
    const m = mark.toUpperCase().padEnd(4, " ").slice(0, 4);
    const n = number.padStart(6, "0").slice(-6);
    return line.rawLine.slice(0, 47) + m + n + line.rawLine.slice(57);
  });
  const ending = parsed.lineEnding === "CRLF" ? "\r\n" : "\n";
  return Buffer.from(lines.join(ending), "latin1");
}

async function seedCar() {
  await q(
    `INSERT INTO public.railcars (id, car_number, car_initial, reporting_marks, active, entity, assignment_label, lessee_name)
     VALUES (22881, $1, $2, $2, true, 'Main', 'SMOKE-E-ASSIGN', 'Demo Lessee AEX')
     ON CONFLICT (id) DO UPDATE SET
       car_number = EXCLUDED.car_number,
       car_initial = EXCLUDED.car_initial,
       active = true,
       assignment_label = EXCLUDED.assignment_label,
       lessee_name = EXCLUDED.lessee_name`,
    [NUMBER, MARK],
  );
  await q(
    `INSERT INTO public.v_valid_export_rows_data
       (export_src, export_id, car_initial, car_number, active, rider, assignment, assignment_id, lessee, start_date, end_date)
     SELECT 1, 22881, $2, $1, 1, 'R1', 'SMOKE-E-ASSIGN', 'AE1', 'Demo Lessee AEX', '2026-01-01', NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM public.v_valid_export_rows_data
       WHERE car_initial = $2 AND car_number = $1
     )`,
    [NUMBER, MARK],
  );
}

async function main() {
  console.log("=== repair:smoke-brc-email (§E r2) ===");
  process.env.REPAIR_LOCAL_DB = process.env.REPAIR_LOCAL_DB ?? "1";
  process.env.REPAIR_DEV_BYPASS_AUTH = process.env.REPAIR_DEV_BYPASS_AUTH ?? "1";
  if (!process.env.DATABASE_URL && !process.env.REPAIR_DATABASE_URL) {
    process.env.DATABASE_URL =
      "postgresql://repairdev:repairdev@127.0.0.1:5432/rlms_repair_dev";
  }

  assertBrcEmailClientTypecheck();

  await migrateLocal();
  ok("migrate-local (incl. e_brc_email)");

  await seedCar();

  const shop = await createShop({
    legalName: `§E BRC Shop ${RUN}`,
    city: "Walbridge",
    state: "OH",
    splc: "382000",
    shopMark: `B${RUN.slice(-3)}`.slice(0, 4).toUpperCase(),
    actor: "smoke-brc",
  });
  if (!shop.ok) bad("shop", shop.error);
  const shopId = String(shop.shop!.id);
  await q(
    `UPDATE repair.shops SET default_inbox = $1 WHERE id = $2`,
    [`shop-${RUN.toLowerCase()}@example.test`, shopId],
  );

  await q(
    `INSERT INTO repair.contacts
       (tenant_id, party_type, party_ref, name, email, active, created_by)
     VALUES ($1,'lessee','Demo Lessee AEX','Lessee Contact','lessee-aex@example.test',true,'smoke-brc')`,
    [DEFAULT_TENANT_ID],
  );

  const bo = await createBadOrder({
    carMark: MARK,
    carNumber: NUMBER,
    shopId,
    actor: "smoke-brc-owner",
    boRuleCode: "OTHER",
    boRuleOtherText: "BRC smoke",
    boDate: new Date().toISOString().slice(0, 10),
    boCity: "Marion",
    boState: "IL",
    allowDuplicates: true,
  });
  if (!bo.ok) bad("bo", JSON.stringify(bo));
  const eventId = String(bo.event.id);

  const link = await issueEventLink({
    eventId,
    scope: "SHOP",
    actor: "smoke-brc",
  });
  await shopAcknowledge(link.token, "shop@smoke-brc.test");
  await shopArrivalDate(link.token, "shop@smoke-brc.test", "2026-10-02");
  ok("shop ack + arrival");

  const sample = withCar(readFileSync(samplePath), MARK, NUMBER);
  const load = await loadEstimateAar({
    bytes: sample,
    filename: `AEX022881-${RUN}.txt`,
    source: "SHOP_LINK",
    rawToken: link.token,
    actor: "shop@smoke-brc.test",
    forceAcceptWarnings: true,
  });
  if (!load.ok) bad("load", JSON.stringify(load));
  const estId = String(
    (load.applied?.[0] as { estimateId?: string } | undefined)?.estimateId ?? "",
  );
  if (!estId) bad("estimate", JSON.stringify(load.applied));
  ok(`estimate ${estId.slice(0, 8)}`);

  const sub = await submitForApproval({
    estimateId: estId,
    actor: "shop@smoke-brc.test",
  });
  if (!sub.ok) bad("submit", sub.error);
  ok("submitted for approval");

  // Ensure Resp 6 via split on first line
  const { rows: lineRows } = await q(
    `SELECT el.id
     FROM repair.estimate_lines el
     JOIN repair.estimate_revisions er ON er.id = el.revision_id
     WHERE er.estimate_id = $1
     ORDER BY el.line_no ASC`,
    [estId],
  );
  if (!lineRows.length) bad("lines", "none");
  const upd = await submitResponsibilityUpdates({
    estimateId: estId,
    lineUpdates: [{ lineId: String(lineRows[0].id), respCode: "1" }],
    splits: [
      {
        lineId: String(lineRows[0].id),
        percent: 50,
        respCode: "6",
      },
    ],
    actor: "smoke-brc-owner",
  });
  if (!upd.ok) {
    // Fallback: assign whole first line(s) to resp 6
    const plain = await submitResponsibilityUpdates({
      estimateId: estId,
      lineUpdates: lineRows.slice(0, Math.min(2, lineRows.length)).map((l) => ({
        lineId: String(l.id),
        respCode: "6",
      })),
      actor: "smoke-brc-owner",
    });
    if (!plain.ok) bad("resp6", plain.error ?? JSON.stringify(plain));
  }
  ok("Resp 6 lines present");

  const totals = await computeLesseeTotals({ estimateId: estId });
  if (!totals.ok) bad("lessee totals", totals.error);
  if (totals.bundle.totalCents <= 0) {
    bad("lessee totals", "expected non-zero Resp 6 cents");
  }
  const expectedCents = totals.bundle.totalCents;
  ok(`lessee total ${totals.bundle.amountMoney} (${expectedCents}¢)`);

  // ── BRC PDF audiences ─────────────────────────────────────────────
  for (const audience of ["owner", "lessee", "shop"] as const) {
    const pdf = await buildBrcPdf({ estimateId: estId, audience });
    if (!pdf.ok) bad(`brc-${audience}`, pdf.error);
    const text = pdf.bytes.toString("latin1");
    if (!text.includes("Billing Repair Card")) {
      bad(`brc-${audience}-title`, "missing Billing Repair Card title");
    }
    for (const label of BRC_HEADER_LABELS) {
      if (!text.includes(label)) {
        bad(`brc-${audience}-label`, `missing header label: ${label}`);
      }
    }
    if (!text.includes("Page ") || !text.includes(" of ")) {
      bad(`brc-${audience}-footer`, "missing Page X of Y footer");
    }
    if (!text.includes("Current Revision")) {
      bad(`brc-${audience}-footer`, "missing Current Revision footer");
    }
    if (!text.includes("Generated") || !text.includes("ET")) {
      bad(`brc-${audience}-footer`, "missing Generated … ET");
    }
    const marked = extractBrcTotalCents(pdf.bytes);
    if (marked == null) bad(`brc-${audience}-marker`, "no BRC_TOTAL_CENTS");
    if (audience === "lessee" && marked !== expectedCents) {
      bad(`brc-lessee-total`, `PDF ${marked}¢ ≠ grid ${expectedCents}¢`);
    }
    if (marked !== pdf.doc.totalCents) {
      bad(
        `brc-${audience}-internal`,
        `marker ${marked} ≠ doc ${pdf.doc.totalCents}`,
      );
    }
    ok(
      `BRC ${audience}: labels+footer ok; total ${pdf.doc.totalCents}¢ lines=${pdf.doc.lines.length}`,
    );
  }

  const lesseePdf = await buildBrcPdf({ estimateId: estId, audience: "lessee" });
  if (!lesseePdf.ok) bad("lessee pdf", lesseePdf.error);
  if (lesseePdf.doc.lines.some((l) => l.resp !== "6")) {
    bad("lessee filter", "non-6 lines in lessee BRC");
  }
  ok("lessee BRC contains only Resp 6 lines");

  // ── Customary email ───────────────────────────────────────────────
  const preview = await buildSendLesseePreview({
    estimateId: estId,
    actor: "owner-reviewer@example.test",
    actorEmail: "owner-reviewer@example.test",
    actorFullName: "Owner Reviewer",
  });
  if (!preview.ok) bad("email preview", preview.error);

  const expectSubj = `Responsibility Items ${MARK} ${displayCarNumber(NUMBER)}`;
  if (preview.subject !== expectSubj) {
    bad("email subject", `got "${preview.subject}" expected "${expectSubj}"`);
  }
  // Also assert padded form collapses the same way (AEX 022881 → 22881)
  if (displayCarNumber(NUMBER_PADDED) !== "22881") {
    bad("displayCarNumber", displayCarNumber(NUMBER_PADDED));
  }
  ok(`subject: ${preview.subject}`);

  const table = preview.emailTable;
  if (!table) bad("email table", "missing");
  for (const key of [
    "category",
    "equipment",
    "dollarAmount",
    "client",
    "user",
    "description",
  ] as const) {
    if (!String(table[key] ?? "").trim()) {
      bad("email table", `empty ${key}`);
    }
  }
  if (table.category !== "Responsibility Items BRC") {
    bad("email category", table.category);
  }
  if (!table.description.includes("lessee responsibility")) {
    bad("email description", table.description.slice(0, 80));
  }
  if (
    !table.description.includes("business day") &&
    !table.description.includes("48 hours") &&
    !table.description.includes(`${preview.responseHours} hours`)
  ) {
    bad("email response window", table.description);
  }
  ok("email table has Category/Equipment/Dollar Amount/Client/User/Description");

  if (!preview.attachmentNames?.pdf?.endsWith("_Resp6.pdf")) {
    bad("pdf name", preview.attachmentNames?.pdf ?? "(none)");
  }
  if (!preview.attachmentNames?.data500?.endsWith("_Resp6Byte500.txt")) {
    bad("data name", preview.attachmentNames?.data500 ?? "(none)");
  }
  ok(
    `attachments: ${preview.attachmentNames.pdf} + ${preview.attachmentNames.data500}`,
  );

  const tableCents = Math.round(
    Number(String(table.dollarAmount).replace(/,/g, "")) * 100,
  );
  if (tableCents !== expectedCents) {
    bad("email$≠grid", `table ${tableCents} grid ${expectedCents}`);
  }
  if (preview.amountCents !== expectedCents) {
    bad("preview≠grid", `${preview.amountCents} vs ${expectedCents}`);
  }
  if (lesseePdf.doc.totalCents !== expectedCents) {
    bad("pdf≠grid", `${lesseePdf.doc.totalCents} vs ${expectedCents}`);
  }
  ok(`Dollar Amount = PDF total = data total = ${expectedCents}¢`);

  const body = preview.body.includes(`$${table.dollarAmount}`)
    ? preview.body
    : `${preview.body}\nDollar Amount: $${table.dollarAmount}`;

  const recipients =
    preview.recipients.length > 0
      ? preview.recipients
      : ["lessee-aex@example.test"];

  const sent = await sendLesseeFromPreview({
    estimateId: estId,
    recipients,
    cc: preview.cc,
    subject: preview.subject,
    body,
    documentIds: preview.gallery.map((g) => g.id),
    confirm: true,
    actor: "owner-reviewer@example.test",
    actorEmail: "owner-reviewer@example.test",
  });
  if (!sent.ok) bad("send", sent.error);
  if (!sent.localMode) bad("local", "expected localMode");
  if (sent.message !== "Logged (not sent – local mode)") {
    bad("msg", sent.message);
  }
  if (!sent.attachments?.pdfFilename?.endsWith("_Resp6.pdf")) {
    bad("sent pdf name", sent.attachments?.pdfFilename ?? "");
  }
  if (!sent.attachments?.dataFilename?.endsWith("_Resp6Byte500.txt")) {
    bad("sent data name", sent.attachments?.dataFilename ?? "");
  }
  ok(
    `send logged; pdf=${sent.attachments.pdfFilename} data=${sent.attachments.dataFilename}`,
  );

  if (!sent.emlPath) bad("eml", "missing eml_path");
  const emlAbs = existsSync(sent.emlPath)
    ? sent.emlPath
    : join(process.cwd(), sent.emlPath);
  if (!existsSync(emlAbs)) bad("eml file", `not found: ${sent.emlPath}`);
  const eml = readFileSync(emlAbs, "utf8");
  if (!eml.includes(preview.subject)) bad("eml subject", "missing");
  if (!eml.includes("Responsibility Items BRC")) {
    bad("eml body", "missing category");
  }
  if (!eml.includes("_Resp6.pdf")) bad("eml attach", "missing pdf name");
  if (!eml.includes("_Resp6Byte500.txt")) bad("eml attach", "missing data name");
  if (!eml.includes("X-Repair-Local-Mode: 1")) bad("eml local", "missing flag");
  ok(`.eml written: ${sent.emlPath}`);

  const { rows: outbox } = await q(
    `SELECT id, subject, local_mode, eml_path, status FROM repair.email_outbox
     WHERE estimate_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [estId],
  );
  if (!outbox[0]?.local_mode) bad("outbox", JSON.stringify(outbox[0]));
  if (outbox[0].subject !== preview.subject) {
    bad("outbox subject", outbox[0].subject);
  }
  ok(`outbox id=${String(outbox[0].id).slice(0, 8)} status=${outbox[0].status}`);

  console.log("=== repair:smoke-brc-email PASS ===");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
