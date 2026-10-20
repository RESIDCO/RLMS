/* eslint-disable no-console */
/** Run: npx tsx server/crm-bid.test.ts */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PURCHASE_TYPE } from "@shared/crm-bid";
import { opportunityAttachmentForbidden } from "./attachment-access";
import { applyBidRules, readBidWrite } from "./crm-bid";
import { CrmHttpError } from "./crm-error";
import { presentLine, type OpportunityLine } from "./crm-bid-lines";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const root = resolve(import.meta.dirname, "..");
function src(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function messageOf(fn: () => void): string {
  try {
    fn();
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

ok(PURCHASE_TYPE === "purchase", "stored purchase type is lowercase");

const passedBid: Record<string, unknown> = {
  flavor: "portfolio_bid",
  type: "purchase",
  stage: "lost",
  outcome: "passed",
  loss_reason: null,
};
ok(messageOf(() => applyBidRules(passedBid, { ...passedBid })).includes("loss reason"), "passed requires a loss reason");

const passedOk: Record<string, unknown> = { ...passedBid, loss_reason: "timing" };
applyBidRules(passedOk, { ...passedOk });
ok(passedOk.outcome === "passed" && passedOk.stage === "lost", "passed stays lost with a reason");

const wrongType: Record<string, unknown> = { flavor: "portfolio_bid", type: "renewal", stage: "identified" };
ok(messageOf(() => applyBidRules(wrongType, { ...wrongType })).includes("purchase"), "portfolio bid requires type purchase");

const ordinary: Record<string, unknown> = { type: "renewal", stage: "identified" };
applyBidRules(ordinary, { ...ordinary });
ok(!("flavor" in ordinary) && !("outcome" in ordinary), "a normal opportunity write does not send bid columns");

let rejected = false;
try {
  readBidWrite({ flavor: "Portfolio" }, true);
} catch (err) {
  rejected = err instanceof CrmHttpError && err.status === 400;
}
ok(rejected, "unknown flavor is rejected");

const priced: OpportunityLine = {
  id: 1,
  opportunity_id: 1,
  seller_deal_ref: "1",
  lessee_desc: null,
  lessee_rating: null,
  lessee_country: null,
  aar_code: null,
  car_type: null,
  equipment_desc: null,
  car_count: 98,
  avg_build_year: 2018,
  commodity: null,
  lease_rate: 100,
  lease_expiry: null,
  purchase_option: null,
  include_in_bid: true,
  exclude_reason: null,
  prelim_price_per_car: 64000,
  final_price_per_car: 65000,
  outcome: null,
  market_price_per_car: 70000,
  winner_company_id: 9,
  loss_reason: null,
  notes: null,
  sort_order: 0,
  total: 6_272_000,
};
const hidden = presentLine(priced, false);
ok(hidden.prelim_price_per_car == null && hidden.final_price_per_car == null, "viewer line drops prelim and final prices");
ok(hidden.market_price_per_car == null && hidden.winner_company_id == null && hidden.total == null, "viewer line drops market price, winner, and total");
ok(hidden.lease_rate === 100 && hidden.car_count === 98, "viewer line keeps non-price fields");
ok(presentLine(priced, true).prelim_price_per_car === 64000, "editor line keeps prices");

ok(opportunityAttachmentForbidden("viewer", "opportunity"), "viewer cannot open opportunity files");
ok(!opportunityAttachmentForbidden("editor", "opportunity"), "editor can open opportunity files");
ok(!opportunityAttachmentForbidden("admin", "opportunity"), "admin can open opportunity files");
ok(!opportunityAttachmentForbidden("viewer", "rider"), "viewer access to other files is unchanged");

const bidFiles = ["server/crm-bid.ts", "server/crm-bid-lines.ts", "server/crm-bid-routes.ts", "server/attachment-access.ts"];
const leaseWords = ["master_leases", "from(\"riders\")", "railcar_assignments", "rent_events", "v_lease_", "/api/lease-mgmt"];
for (const file of bidFiles) {
  const text = src(file);
  for (const word of leaseWords) {
    ok(!text.includes(word), `${file} does not query ${word}`);
  }
}

const routes = src("server/routes.ts");
const accessCalls = routes.split("assertAttachmentAccess").length - 1;
ok(accessCalls >= 6, "attachment routes call assertAttachmentAccess");
ok(routes.includes('"opportunity"'), "upload accepts an opportunity");

const bidRoutes = src("server/crm-bid-routes.ts");
ok(!bidRoutes.includes("app.delete"), "bid routes do not hard-delete");
ok(bidRoutes.includes("/lines/:lineId/delete"), "line removal is a soft-delete post");
ok(!/app\.delete\(\s*[`'"]\/api\/opportunities\/:id[`'"]/.test(src("server/crm.ts")), "opportunities have no delete route");
ok(src("server/crm.ts").includes("/api/opportunities/:id/contacts/:contactId"), "unlinking a contact stays");

const account360 = src("server/account-360.ts");
ok(account360.includes('flavor !== "portfolio_bid"') || account360.includes("flavor === \"portfolio_bid\""), "Account 360 skips portfolio bids");

const migration = src("migrations/20261118_crm_bid_p1.sql");
ok(!/revoke\s+(all|execute)\s+on\s+function\s+public\.rlms_/i.test(migration), "migration does not revoke the undo functions");
ok(!/grant\s+execute\s+on\s+function\s+public\.rlms_/i.test(migration), "migration does not re-grant the undo functions");
ok(migration.includes("8cff44e553c452db18290122462d50a6"), "apply md5 guard");
ok(migration.includes("5acf178673e9592cb1d1eb3c02f54f0e"), "undo md5 guard");
ok(migration.includes("91fff3b98ab02d49810a18093d9844cd"), "referenced md5 guard");
ok(migration.includes("3586a575597e068254416993913a364a"), "fk md5 guard");
ok(migration.includes("not like '%''Purchase''%'"), "type check rejects title-case Purchase");
ok(migration.includes("'lease_contracts'"), "source module list keeps lease_contracts");
ok(/enable row level security/i.test(migration), "opportunity_lines enables RLS");
ok(/revoke all on opportunity_lines from public, anon, authenticated/i.test(migration), "no anon or authenticated table grant");
ok(!/alter\s+table\s+(public\.)?(riders|master_leases)\b/i.test(migration), "riders and master leases are not altered");
ok(migration.includes("'opportunity_lines'"), "undo allowlist includes opportunity_lines");
ok(migration.includes("opportunity_contacts', 'opportunity_id'"), "undo guard checks opportunity contacts");

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
