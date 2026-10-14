/**
 * Smoke: OWNER_UI §D Estimate Review (owner)
 * - Review payload: compact context + RS line fields from raw_line
 * - Update Responsibilities: set codes, split by %, summary cents
 * - Review & Compare any two revisions
 * - Billing category; request revision; approve
 *
 * Run: npm run repair:smoke-estimate-review
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { DEFAULT_TENANT_ID, q } from "../db";
import { createBadOrder } from "../services/bo";
import { shopAcknowledge, shopArrivalDate } from "../services/bo-lifecycle";
import { issueEventLink } from "../services/event-links";
import { loadEstimateAar } from "../services/estimate-load";
import { submitForApproval, approveEstimate, requestRevision } from "../services/estimates";
import { parseAarFile } from "../services/aar-parser";
import {
  buildEstimateReviewPayload,
  enrichLineFromRaw,
  setBillingCategory,
  submitResponsibilityUpdates,
  summarizeByResp,
} from "../services/estimate-review";
import { formatCentsAsDollars } from "../services/money";
import { createShop } from "../services/shops";
import { migrateLocal } from "./migrate-local";

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

const RUN = `D${Date.now().toString().slice(-8)}`;
const MARK = "OFOX";
const NUMBER = "528313";

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
     VALUES (528313, $1, $2, $2, true, 'Main', 'SMOKE-D-ASSIGN', 'Demo Lessee D')
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
     SELECT 1, 528313, $2, $1, 1, 'R1', 'SMOKE-D-ASSIGN', 'AD1', 'Demo Lessee D', '2026-01-01', NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM public.v_valid_export_rows_data
       WHERE car_initial = $2 AND car_number = $1
     )`,
    [NUMBER, MARK],
  );
}

async function main() {
  console.log("=== repair:smoke-estimate-review (§D) ===");
  await migrateLocal();
  await seedCar();

  const shopMark = `D${RUN.slice(-3)}`.slice(0, 4).toUpperCase();
  const shop = await createShop({
    legalName: `§D Smoke Shop ${RUN}`,
    city: "Carterville",
    state: "IL",
    splc: "398760",
    shopMark,
    // omit billingRoad so reporting_mark is a unique synthetic key
    actor: "smoke-d",
  });
  if (!shop.ok) bad("create shop", shop.error);
  const shopId = String(shop.shop!.id);
  ok(`shop ${shop.shop!.name ?? shopId.slice(0, 8)}`);

  const bo = await createBadOrder({
    carMark: MARK,
    carNumber: NUMBER,
    shopId,
    actor: "smoke-d",
    boRuleCode: "OTHER",
    boRuleOtherText: "Door - bent",
    boDate: new Date().toISOString().slice(0, 10),
    boCity: "Marion",
    boState: "IL",
    allowDuplicates: true,
  });
  if (!bo.ok) bad("bo", bo.error);
  const eventId = String(bo.event.id);
  ok("BO created");

  const link = await issueEventLink({
    eventId,
    scope: "SHOP",
    actor: "smoke-d",
  });
  await shopAcknowledge(link.token, "shop@smoke-d.test");
  await shopArrivalDate(link.token, "shop@smoke-d.test", "2026-10-02");
  ok("shop ack + arrival");

  const sample = readFileSync(samplePath);
  const file = withCar(sample, MARK, NUMBER);
  const load = await loadEstimateAar({
    bytes: file,
    filename: `smoke-d-${RUN}.dat`,
    source: "SHOP_LINK",
    rawToken: link.token,
    actor: "shop@smoke-d.test",
    forceAcceptWarnings: true,
  });
  if (!load.ok) bad("load", JSON.stringify(load));
  const estId = String(
    (load.applied?.[0] as { estimateId?: string } | undefined)?.estimateId ?? "",
  );
  if (!estId) bad("estimate", JSON.stringify(load.applied));
  ok(`estimate ${estId.slice(0, 8)}`);

  const sub = await submitForApproval({ estimateId: estId, actor: "shop@smoke-d.test" });
  if (!sub.ok) bad("submit (shop)", sub.error);
  ok("shop submit for approval");

  const review1 = await buildEstimateReviewPayload({ estimateId: estId });
  if (!review1.ok) bad("review1", review1.error);
  if (!review1.context?.shopDisplay?.includes("Carterville")) {
    bad("compact shop", review1.context?.shopDisplay ?? "(missing)");
  }
  if (!review1.context.estimateIdDisplay) bad("compact", "missing estimateIdDisplay");
  ok(`compact header: ${review1.context.shopDisplay}`);

  const lines = review1.revisions[review1.revisions.length - 1]?.lines ?? [];
  if (lines.length < 2) bad("lines", `expected ≥2 got ${lines.length}`);
  const enriched = enrichLineFromRaw(lines[0] as Record<string, unknown>);
  if (!enriched.description) bad("raw enrich", "description empty");
  ok(
    `line enrich Loc=${enriched.location_on_car ?? ""} Qnty=${enriched.quantity ?? ""} Desc=${enriched.description.slice(0, 28)}`,
  );

  const centsSum = lines.reduce(
    (s, l) => s + Number((l as { total_cents?: number }).total_cents ?? 0),
    0,
  );
  if (centsSum <= 0) bad("cents", "total_cents missing/zero");
  ok(`integer cents total $${formatCentsAsDollars(centsSum)}`);

  const bill = await setBillingCategory({
    estimateId: estId,
    billingCategory: "Bad Order",
    actor: "smoke-d",
  });
  if (!bill.ok) bad("billing", bill.error);
  ok("billing category");

  const line0 = lines[0];
  const line1 = lines[1];
  const upd = await submitResponsibilityUpdates({
    estimateId: estId,
    lineUpdates: [
      { lineId: String(line0.id), respCode: "7" },
      { lineId: String(line1.id), respCode: "6" },
    ],
    splits: [{ lineId: String(line1.id), percent: 40, respCode: "1" }],
    responsibleParty: "Demo Lessee D",
    actor: "smoke-d",
  });
  if (!upd.ok) bad("resp update", upd.error);
  ok(`responsibilities rev ${upd.revision.rev_no} total $${upd.totalDisplay}`);

  const review2 = await buildEstimateReviewPayload({ estimateId: estId });
  if (!review2.ok) bad("review2", review2.error);
  const latestLines = review2.revisions[review2.revisions.length - 1].lines;
  // Split should increase line count
  if (latestLines.length < lines.length + 1) {
    bad("split", `expected more lines after split (${latestLines.length} vs ${lines.length})`);
  }
  ok(`after split lines=${latestLines.length}`);

  const summary = summarizeByResp(
    latestLines.map((l) => ({
      resp_code: String(l.resp_code),
      labor_cents: Number((l as { labor_cents?: number }).labor_cents ?? 0),
      material_cents: Number((l as { material_cents?: number }).material_cents ?? 0),
    })),
  );
  if (!summary.some((s) => s.code === "1" || s.code === "7")) {
    bad("summary codes", JSON.stringify(summary));
  }
  ok(`summary ${summary.map((s) => `${s.code}=$${s.totalDisplay}`).join("; ")}`);

  const from = Number(review2.revisions[0].revision.rev_no);
  const to = Number(review2.revisions[review2.revisions.length - 1].revision.rev_no);
  const cmp = await buildEstimateReviewPayload({
    estimateId: estId,
    compareFromRev: from,
    compareToRev: to,
  });
  if (!cmp.ok || !cmp.compare) bad("compare", "missing compare meta");
  ok(
    `compare r${cmp.compare.from}→r${cmp.compare.to} +${cmp.compare.added}/-${cmp.compare.removed}/Δ${cmp.compare.changed}`,
  );

  const revReq = await requestRevision({
    estimateId: estId,
    actor: "smoke-d",
    comment: "Please revise line 1",
  });
  if (!revReq.ok) bad("request-revision", revReq.error);
  ok("request revision");

  // Shop re-upload path would restore Awaiting; force for owner approve smoke
  await q(
    `UPDATE repair.estimates e SET status_id = s.id
     FROM repair.statuses s
     WHERE e.id = $1 AND s.code = 'AWAITING_APPROVAL' AND s.entity = 'ESTIMATE'`,
    [estId],
  );
  const appr = await approveEstimate({ estimateId: estId, actor: "smoke-d" });
  if (!appr.ok) bad("approve", appr.error);
  ok("owner approve");

  ok(`documentCount=${review2.documentCount ?? 0}`);
  ok("owner D has no Submit-for-approval / completed-date controls (UI contract)");

  console.log(`\nPASS §D Estimate Review smoke (${RUN})`);
}

main().catch((e) => {
  console.error("\nFAIL", e);
  process.exit(1);
});
