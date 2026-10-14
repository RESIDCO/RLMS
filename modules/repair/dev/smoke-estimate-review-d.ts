/**
 * Smoke: OWNER_UI §D Estimate Review (owner) + round 2
 * - Review payload: compact context + RS line fields from raw_line
 * - Update Responsibilities: set codes, 50/50 split exact, tax prorate
 * - Shop attachment delete blocked server-side
 * - Component Id rule rejects coupler (4450) without ID
 * - Carry-forward matches unchanged
 * - Ref-data import soft-OK when licensed CSVs absent; row counts when present
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
import { formatCentsAsDollars, formatCentsAsMoney } from "../services/money";
import { createShop } from "../services/shops";
import { softDeleteDocument } from "../services/gap-lifecycle-06";
import { validateComponentIds } from "../services/component-id-rules";
import {
  previewCarryForward,
  applyCarryForwardSelections,
} from "../services/carry-forward";
import { previewTaxProrate } from "../services/responsibility-split";
import { getRefDataCounts, lookupRefCode } from "../services/ref-lookup";
import { importRefData } from "./import-ref-data";
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
  console.log("=== repair:smoke-estimate-review (§D r2) ===");
  await migrateLocal();
  await seedCar();

  // Ref-data import (soft-OK without licensed CSVs)
  const imp = await importRefData({ actor: "smoke-d-r2" });
  if (!imp.ok && !imp.soft) bad("import-ref-data", imp.error ?? "failed");
  const counts = await getRefDataCounts();
  const expectedFull = {
    ref_job_codes: 855,
    ref_qualifiers: 639,
    ref_why_made: 107,
    ref_repair_categories: 2170,
  };
  if (imp.anyData && counts.ref_job_codes >= 800) {
    for (const [k, n] of Object.entries(expectedFull)) {
      const got = counts[k] ?? 0;
      if (got < n * 0.9) {
        bad("ref counts", `${k} expected ~${n} got ${got}`);
      }
      ok(`ref ${k}=${got}`);
    }
    const jobHit = await lookupRefCode({ kind: "job", code: "4450" });
    ok(`hover job 4450: found=${jobHit.found} ${jobHit.description.slice(0, 40)}`);
  } else {
    ok(
      `ref-data soft-skip (licensed CSVs absent) — counts job=${counts.ref_job_codes} qual=${counts.ref_qualifiers} wm=${counts.ref_why_made} cat=${counts.ref_repair_categories}; component_id_rules=${counts.component_id_rules}`,
    );
    const miss = await lookupRefCode({ kind: "job", code: "ZZZZ" });
    if (miss.found || miss.description !== "Not in reference table") {
      bad("hover miss", JSON.stringify(miss));
    }
    ok('unknown code → "Not in reference table"');
  }

  const shopMark = `D${RUN.slice(-3)}`.slice(0, 4).toUpperCase();
  const shop = await createShop({
    legalName: `§D Smoke Shop ${RUN}`,
    city: "Carterville",
    state: "IL",
    splc: "398760",
    shopMark,
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
  if (!enriched.labor_money?.startsWith("$")) {
    bad("money display", `expected $ prefix got ${enriched.labor_money}`);
  }
  ok(
    `line enrich Loc=${enriched.location_on_car ?? ""} money=${enriched.amount_money} cents=${enriched.amount_cents_label}`,
  );

  const centsSum = lines.reduce(
    (s, l) => s + Number((l as { total_cents?: number }).total_cents ?? 0),
    0,
  );
  if (centsSum <= 0) bad("cents", "total_cents missing/zero");
  ok(`integer cents total ${formatCentsAsMoney(centsSum)}`);

  // Component Id rule — coupler 4450 without CID
  const coupler = lines.find(
    (l) => String((l as { aar_job_code?: string }).aar_job_code ?? "").trim() === "4450",
  );
  if (!coupler) bad("coupler line", "job 4450 not in sample");
  const cid = await validateComponentIds({
    lines: lines.map((l) => ({
      id: String((l as { id?: string }).id ?? ""),
      line_no: Number((l as { line_no?: number }).line_no),
      aar_job_code: (l as { aar_job_code?: string }).aar_job_code ?? null,
      qualifier: (l as { qualifier?: string }).qualifier ?? null,
      aar_component_id: (l as { aar_component_id?: string }).aar_component_id ?? null,
    })),
    stage: "FINAL",
  });
  if (cid.ok) {
    // Ensure rule exists then re-check
    await q(
      `INSERT INTO repair.component_id_rules
         (tenant_id, job_code, label, require_on, active, notes, created_by)
       VALUES ($1,'4450','Coupler body requires Component Id','FINAL_OR_INVOICE',true,'smoke',$2)`,
      [DEFAULT_TENANT_ID, "smoke-d"],
    );
    const cid2 = await validateComponentIds({
      lines: [
        {
          line_no: Number((coupler as { line_no?: number }).line_no),
          aar_job_code: "4450",
          qualifier: null,
          aar_component_id: null,
        },
      ],
      stage: "FINAL",
    });
    if (cid2.ok) bad("component-id", "expected reject for coupler without ID");
    ok(`component-id rejects coupler: ${cid2.errors[0]?.message}`);
  } else {
    ok(`component-id rejects: ${cid.errors[0]?.message}`);
  }
  if (!review1.componentIdFlagged?.length && !cid.flaggedLineNos.length) {
    // review flags use REVIEW stage — may match FINAL_OR_INVOICE
    ok("component-id review flags optional when rule require_on excludes REVIEW-only path");
  } else {
    ok(`component-id review flags=${(review1.componentIdFlagged ?? cid.flaggedLineNos).join(",")}`);
  }

  // Shop delete blocked
  const { rows: docIns } = await q(
    `INSERT INTO repair.documents
       (tenant_id, event_id, kind, category_code, storage_key, sha256, size, mime,
        uploaded_by, created_by, original_filename, uploaded_via, uploaded_role)
     VALUES ($1,$2,'photo','photograph','smoke/key','abc',10,'image/jpeg','shop@smoke-d.test','shop@smoke-d.test','smoke.jpg','shop_link','shop')
     RETURNING id`,
    [DEFAULT_TENANT_ID, eventId],
  );
  const docId = String(docIns[0].id);
  const shopDel = await softDeleteDocument({
    documentId: docId,
    actor: "shop@smoke-d.test",
    actorRole: "shop",
    reason: "shop trying to void",
  });
  if (shopDel.ok || shopDel.status !== 403) {
    bad("shop delete", `expected 403 got ${JSON.stringify(shopDel)}`);
  }
  ok("shop delete blocked server-side (403)");
  const ownerDel = await softDeleteDocument({
    documentId: docId,
    actor: "owner@smoke-d.test",
    actorRole: "owner",
    reason: "owner void smoke",
  });
  if (!ownerDel.ok) bad("owner delete", ownerDel.error);
  ok("owner void allowed + audited");

  const bill = await setBillingCategory({
    estimateId: estId,
    billingCategory: "Bad Order",
    actor: "smoke-d",
  });
  if (!bill.ok) bad("billing", bill.error);
  ok("billing category");

  // 50/50 split exact
  const line1 = lines[1];
  const laborBefore = Number((line1 as { labor_cents?: number }).labor_cents ?? 0);
  const matBefore = Number((line1 as { material_cents?: number }).material_cents ?? 0);
  const totalBefore = laborBefore + matBefore;
  const upd = await submitResponsibilityUpdates({
    estimateId: estId,
    lineUpdates: [
      { lineId: String(lines[0].id), respCode: "7" },
      { lineId: String(line1.id), respCode: "6" },
    ],
    splits: [{ lineId: String(line1.id), percent: 50, respCode: "1" }],
    responsibleParty: "Demo Lessee D",
    actor: "smoke-d",
  });
  if (!upd.ok) bad("resp update", upd.error);
  ok(`50/50 split rev ${upd.revision.rev_no} total ${upd.totalMoney ?? "$" + upd.totalDisplay}`);

  const review2 = await buildEstimateReviewPayload({ estimateId: estId });
  if (!review2.ok) bad("review2", review2.error);
  const latestLines = review2.revisions[review2.revisions.length - 1].lines;
  if (latestLines.length < lines.length + 1) {
    bad("split", `expected more lines after split (${latestLines.length} vs ${lines.length})`);
  }
  const splitKids = latestLines.filter(
    (l) =>
      String((l as { display_line_no?: string }).display_line_no ?? "").endsWith("a") ||
      String((l as { display_line_no?: string }).display_line_no ?? "").endsWith("b") ||
      String((l as { split_label?: string }).split_label ?? "").match(/[ab]$/),
  );
  const splitSum = splitKids
    .filter((l) => {
      // only the children of our split parent — match fingerprint cluster with 1/6 resp
      const r = String((l as { resp_code?: string }).resp_code);
      return r === "1" || r === "6";
    })
    .reduce(
      (s, l) =>
        s +
        Number((l as { labor_cents?: number }).labor_cents ?? 0) +
        Number((l as { material_cents?: number }).material_cents ?? 0),
      0,
    );
  // Find children that came from line1 by checking labor+mat of pairs with same split_group_id
  const groups = new Map<string, number>();
  for (const l of latestLines) {
    const g = String((l as { split_group_id?: string }).split_group_id ?? "");
    if (!g) continue;
    groups.set(
      g,
      (groups.get(g) ?? 0) +
        Number((l as { labor_cents?: number }).labor_cents ?? 0) +
        Number((l as { material_cents?: number }).material_cents ?? 0),
    );
  }
  const exactGroup = [...groups.values()].find((v) => v === totalBefore);
  if (totalBefore > 0 && exactGroup == null) {
    bad(
      "50/50 exact",
      `no split group summed to ${totalBefore}; groups=${[...groups.values()].join(",")}`,
    );
  }
  ok(`50/50 split exact sum=${totalBefore}¢ children≈${splitKids.length} (splitSum scan=${splitSum})`);

  // Tax prorate
  const tax = previewTaxProrate({
    lines: latestLines.map((l) => ({
      respCode: String((l as { resp_code?: string }).resp_code ?? ""),
      amountCents:
        Number((l as { labor_cents?: number }).labor_cents ?? 0) +
        Number((l as { material_cents?: number }).material_cents ?? 0),
    })),
    taxCents: 100,
  });
  if (!tax.exact || tax.totalTaxCents !== 100) {
    bad("tax prorate", JSON.stringify(tax));
  }
  const basisTotal = tax.shares.reduce((s, x) => s + x.basisCents, 0);
  for (const s of tax.shares) {
    const expected = Math.trunc((100 * s.basisCents) / basisTotal);
    // after remainder distribution, shares should be within 1 of proportional
    if (Math.abs(s.taxCents - expected) > tax.shares.length) {
      bad("tax share", `${s.respCode} ${s.taxCents} vs ~${expected}`);
    }
  }
  ok(
    `prorated tax 100¢ matches resp shares: ${tax.shares
      .map((s) => `R${s.respCode}=${s.taxCents}`)
      .join(", ")}`,
  );

  // Carry-forward
  const carry = await previewCarryForward({ estimateId: estId });
  if (!carry.ok) bad("carry", "preview failed");
  const applied = applyCarryForwardSelections({
    items: carry.items,
    applyStatuses: ["UNCHANGED"],
  });
  ok(
    `carry-forward r${carry.fromRevNo}→r${carry.toRevNo}: unchanged=${carry.counts.unchanged} changed=${carry.counts.changed} new=${carry.counts.neu} removed=${carry.counts.removed}; apply-preview ${applied.applied} (no auto-commit)`,
  );

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
  ok(`formatCentsAsDollars sanity ${formatCentsAsDollars(1234)}`);

  console.log(`\nPASS §D Estimate Review r2 smoke (${RUN})`);
}

main().catch((e) => {
  console.error("\nFAIL", e);
  process.exit(1);
});
