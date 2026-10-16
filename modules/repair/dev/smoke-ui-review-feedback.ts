/**
 * Smoke: Bruce Phase 1 UI review feedback (2026-10-14).
 * - bo_rules lookup + OTHER
 * - shop city/state display + billing_road auto-fill / override reason
 * - BO attachments → VOIDED soft-delete
 * - audited header field edit
 * - money ≤ 2 decimals
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { q } from "../db";
import { listBoRules, createBoRule } from "../services/bo-rules";
import { createBadOrder, listDemoShop, formatShopLabel } from "../services/bo";
import { addDistributionEntry, listDistributionEntries } from "../services/distribution-list";
import { softDeleteDocument } from "../services/gap-lifecycle-06";
import { uploadEventDocument } from "../services/estimates";
import { editHeaderField, listHeaderEdits } from "../services/header-edits";
import { loadEstimateAar } from "../services/estimate-load";
import { issueEventLink } from "../services/event-links";
import { shopAcknowledge, shopArrivalDate } from "../services/bo-lifecycle";
import { assertAtMostTwoDecimals } from "../services/money";

function ok(label: string) {
  console.log(`  ✓ ${label}`);
}
function bad(label: string, detail: string): never {
  throw new Error(`[smoke-ui-review] ${label}: ${detail}`);
}

async function seedCar(mark: string, number: string, id: number) {
  await q(
    `INSERT INTO public.railcars (id, car_number, car_initial, reporting_marks, active)
     VALUES ($1,$2,$3,$3,true)
     ON CONFLICT (id) DO UPDATE SET car_initial=$3, car_number=$2, active=true`,
    [id, number, mark],
  );
  await q(
    `INSERT INTO public.v_valid_export_rows_data
       (export_src, export_id, car_initial, car_number, active, rider, assignment, assignment_id, lessee, start_date, end_date)
     SELECT 1,$1,$2,$3,1,'R','A','A1','L','2026-01-01',NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM public.v_valid_export_rows_data WHERE car_initial=$2 AND car_number=$3
     )`,
    [id, mark, number],
  );
}

async function main() {
  console.log("smoke-ui-review-feedback");
  await seedCar("OFOX", "528313", 528313);

  const rules = await listBoRules({ activeOnly: true });
  if (!rules.some((r) => r.code === "RULE_1") || !rules.some((r) => r.code === "RULE_107")) {
    bad("bo_rules seed", "RULE_1 and RULE_107 required");
  }
  if (!rules.some((r) => r.code === "OTHER" && r.requires_other_text)) {
    bad("bo_rules seed", "OTHER with requires_other_text required");
  }
  ok(`bo_rules seeded (${rules.length} active)`);

  const added = await createBoRule({
    code: `SMOKE_${Date.now().toString(36).toUpperCase()}`,
    description: "Smoke admin-added rule",
    actor: "smoke@local",
  });
  if (!added.ok) bad("admin add rule", added.error);
  ok("admin can add bo_rule");

  const { ensureDemoShop } = await import("../services/shops");
  await ensureDemoShop({
    mark: "APA",
    legalName: "Apache Railway Shop",
    city: "Snowflake",
    state: "AZ",
    splc: "859370",
    actor: "smoke@local",
  });
  const shops = await listDemoShop();
  const apa = shops.find(
    (s) => s.reporting_mark === "APA" || s.billing_road === "APA",
  );
  if (!apa) bad("shops", "APA missing after ensureDemoShop");
  if (!apa.city || !apa.state) bad("shop city/state", `APA city/state missing: ${apa.city}/${apa.state}`);
  const label = formatShopLabel(apa);
  if (!label.includes("–") || !label.includes(String(apa.city))) {
    bad("shop label", `expected Name – City, ST got ${label}`);
  }
  ok(`shop display: ${label}`);
  if (!apa.billing_road) bad("billing_road", "APA billing_road missing");
  ok(`shop billing_road=${apa.billing_road}`);

  const otherFail = await createBadOrder({
    carMark: "OFOX",
    carNumber: "528313",
    shopId: String(apa.id),
    boRuleCode: "OTHER",
    actor: "smoke@local",
  });
  if (otherFail.ok) bad("OTHER without text", "should require manual text");
  ok("OTHER requires manual text");

  const overrideFail = await createBadOrder({
    carMark: "OFOX",
    carNumber: "528313",
    shopId: String(apa.id),
    boRuleCode: "RULE_1",
    billingRoad: "XXXX",
    actor: "smoke@local",
  });
  if (overrideFail.ok) bad("billing override", "should require reason");
  ok("billing road override requires reason");

  const dist = await addDistributionEntry({
    email: "dist-smoke@demo.local",
    name: "Smoke Dist",
    actor: "smoke@local",
  });
  if (!dist.ok) bad("distribution", dist.error);
  const listed = await listDistributionEntries();
  if (!listed.some((e) => e.email === "dist-smoke@demo.local")) {
    bad("distribution list", "entry not listed");
  }
  ok("distribution list add");

  const bo = await createBadOrder({
    carMark: "OFOX",
    carNumber: "528313",
    shopId: String(apa.id),
    boRuleCode: "RULE_1",
    billingRoad: String(apa.billing_road),
    actor: "smoke@local",
    boCity: "Houston",
    boState: "TX",
  });
  if (!bo.ok) bad("create BO", bo.error);
  if (String(bo.event.billing_road).toUpperCase() !== String(apa.billing_road).toUpperCase()) {
    bad("billing auto-fill", `got ${bo.event.billing_road}`);
  }
  if (String(bo.event.bo_rule_code) !== "RULE_1") {
    bad("bo_rule_code", String(bo.event.bo_rule_code));
  }
  ok("BO created with rule + billing road auto-fill");

  const eventId = String(bo.event.id);
  const up = await uploadEventDocument({
    eventId,
    kind: "bo_attachment",
    actorEmail: "smoke@local",
    file: {
      filename: "bo-photo.jpg",
      mime: "image/jpeg",
      bytes: Buffer.from("fake-jpeg-bytes"),
    },
  });
  if (!up.ok) bad("BO attachment", up.error);
  const voided = await softDeleteDocument({
    documentId: String(up.document.id),
    actor: "smoke@local",
    reason: "smoke void",
  });
  if (!voided.ok) bad("void attachment", voided.error);
  if (String(voided.document.lifecycle_status) !== "VOIDED") {
    bad("void status", String(voided.document.lifecycle_status));
  }
  const still = await q(`SELECT id FROM repair.documents WHERE id = $1`, [up.document.id]);
  if (!still.rows[0]) bad("retention", "document purged — must retain");
  ok("BO attachment upload + VOIDED (retained)");

  const shopLink = await issueEventLink({
    eventId,
    scope: "SHOP",
    actor: "smoke@local",
  });
  // shopAcknowledge sets bo.status=ACCEPTED (§G r5); shopAccept alone leaves ASSIGNED
  const acc = await shopAcknowledge(shopLink.token, "shop@smoke.local");
  if (!acc.ok) bad("shop accept", acc.error);
  const arr = await shopArrivalDate(shopLink.token, "shop@smoke.local", "2026-10-01");
  if (!arr.ok) bad("arrival", arr.error);

  const samplePath = resolve(
    process.cwd(),
    "modules/repair/dev/reference/Sample_Shop_500byte_OFOX2609.txt",
  );
  const bytes = readFileSync(samplePath);
  const loaded = await loadEstimateAar({
    bytes,
    filename: "OFOX2609.txt",
    source: "SHOP_LINK",
    rawToken: shopLink.token,
    actor: "shop@smoke.local",
    forceAcceptWarnings: true,
  });
  if (!loaded.ok) bad("estimate load", JSON.stringify(loaded));

  const { rows: estRows } = await q(
    `SELECT id, current_header FROM repair.estimates
     WHERE event_id = $1 AND deleted_at IS NULL
     ORDER BY created_at ASC LIMIT 1`,
    [eventId],
  );
  if (!estRows[0]) bad("estimate row", "missing after load");
  const estId = String(estRows[0].id);
  const hdr = (estRows[0].current_header ?? {}) as Record<string, unknown>;
  if (!hdr.billingParty && !hdr.carInitial) {
    bad("data file header", `empty header after load: ${JSON.stringify(hdr)}`);
  }
  ok(`Data File header present (${Object.keys(hdr).length} keys)`);

  // billingParty is LOCK (void+resubmit); pencil an EDIT_AUDIT field instead
  const edit = await editHeaderField({
    estimateId: estId,
    fieldKey: "kindOfCar",
    newValue: "T",
    reason: "smoke pencil edit",
    actor: "reviewer@smoke.local",
    actorRole: "reviewer",
  });
  if (!edit.ok) bad("header edit", edit.error);
  const edits = await listHeaderEdits({ estimateId: estId });
  if (!edits.some((e) => e.field_key === "kindOfCar" && e.new_value === "T")) {
    bad("header audit", "edit not in audit log");
  }
  ok("audited header pencil edit (old→new, user, time)");

  const { rows: moneyRows } = await q(
    `SELECT labor, material, total FROM repair.estimate_revisions WHERE estimate_id = $1`,
    [estId],
  );
  for (const r of moneyRows) {
    assertAtMostTwoDecimals("labor", r.labor);
    assertAtMostTwoDecimals("material", r.material);
    assertAtMostTwoDecimals("total", r.total);
  }
  ok("no total > 2 decimals");

  console.log("smoke-ui-review-feedback: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
