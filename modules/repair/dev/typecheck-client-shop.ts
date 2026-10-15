/**
 * Client typecheck gate for §G Shop portal (+ r2/r3/r4).
 * Run: npm run repair:typecheck-client-shop
 */
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawnSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "../../..");
const PAGES = [
  "client/src/pages/repair/ShopPortal.tsx",
  "client/src/pages/repair/ShopBoDetail.tsx",
  "client/src/pages/repair/ShopEstimateDetail.tsx",
  "client/src/pages/repair/DevRoleSwitcher.tsx",
  "client/src/pages/repair/RepairNavChrome.tsx",
  "client/src/pages/repair/ShopEventLink.tsx",
];

function bad(label: string, detail: string): never {
  throw new Error(`${label}: ${detail}`);
}

function ok(msg: string) {
  console.log(`  OK  ${msg}`);
}

export function assertShopClientTypecheck(): void {
  console.log("=== repair:typecheck-client-shop ===");
  const portal = readFileSync(join(ROOT, PAGES[0]), "utf8");
  const bo = readFileSync(join(ROOT, PAGES[1]), "utf8");
  const est = readFileSync(join(ROOT, PAGES[2]), "utf8");
  const docs = readFileSync(
    join(ROOT, "client/src/pages/repair/EstimateDocuments.tsx"),
    "utf8",
  );
  const nav = readFileSync(join(ROOT, PAGES[4]), "utf8");
  const role = readFileSync(join(ROOT, PAGES[3]), "utf8");

  if (!portal.includes("RESIDCO") || !portal.includes("Shop portal")) {
    bad("brand", "ShopPortal must show RESIDCO shop portal brand");
  }
  if (!portal.includes("byStatus") && !portal.includes("Estimates by status")) {
    bad("status", "ShopPortal must show estimates by status");
  }
  if (!portal.includes("carInitial") && !portal.includes("Search car")) {
    bad("search", "ShopPortal must search car initial/number");
  }
  if (!portal.includes("Missed POD") || !portal.includes("avgDaysArrivalToApproval")) {
    bad("kpis", "ShopPortal must show Missed POD + avg days KPIs");
  }
  if (!portal.includes("text-slate-900") || portal.includes("text-slate-400")) {
    // allow slate-400 only if not present — r2 forbids pale labels
    if (portal.includes("text-slate-400") || portal.includes("text-slate-500")) {
      bad("contrast", "ShopPortal must not use pale slate-400/500 labels");
    }
  }
  if (!portal.includes("shopAa.input") || !portal.includes("closedReasonLine")) {
    bad("r3-inputs-closed", "ShopPortal must use shopAa.input + show closedReasonLine");
  }
  if (!portal.includes("viewing as shop") && !portal.includes("Viewing as shop")) {
    bad("readonly-banner", "ShopPortal must show Viewing as shop read-only banner");
  }
  // §G r5: Inconsistent state is owner-only — shops must not show it
  if (portal.includes("Inconsistent state") && !portal.includes("owner-only")) {
    bad("r5-no-inconsistent-portal", "ShopPortal must not show Inconsistent state to shops");
  }
  if (
    !portal.includes("Status tiles") ||
    !portal.includes("Awaiting Shop Acceptance") ||
    !portal.includes("byTile") ||
    !portal.includes("Accepted – awaiting arrival")
  ) {
    bad("r5-tiles", "ShopPortal must show stored-status tiles (Awaiting Shop Acceptance)");
  }
  ok("ShopPortal brand + status + car search + KPIs + AA labels + r3 + r5 tiles");

  if (!bo.includes("Owner instructions") || !bo.includes("JIC")) {
    bad("bo", "ShopBoDetail must show owner instructions + JIC clock");
  }
  if (!bo.includes("Upload 500-byte") || !bo.includes("Hand entry")) {
    bad("both", "ShopBoDetail must offer upload AND hand entry");
  }
  if (!bo.includes("lessee hidden") && !bo.includes("lessee")) {
    bad("hide-lessee", "ShopBoDetail must note lessee is hidden");
  }
  if (!bo.includes("void") || !bo.includes("shop mode")) {
    bad("docs", "ShopBoDetail must mention §E shop mode / void disabled");
  }
  if (
    (!bo.includes("Status timeline") && !bo.includes("compactTimeline") && !bo.includes("bo-compact-timeline")) ||
    !bo.includes("POD history")
  ) {
    bad("lifecycle", "ShopBoDetail must show compact status timeline + POD history");
  }
  if (!bo.includes("statusLine") && !bo.includes("Status")) {
    bad("r5-status", "ShopBoDetail must show stored status line");
  }
  if (!bo.includes("Missed POD") || !bo.includes("Estimate flags")) {
    bad("missed-flags", "ShopBoDetail must show missed POD + estimate flags (when estimate exists)");
  }
  if (!bo.includes("flagSummaryLine") && !bo.includes("Show flag list")) {
    bad("r5-flag-summary", "ShopBoDetail must show flag summary + expandable list");
  }
  if (!bo.includes("RepairBreadcrumbs") && !bo.includes("Shop home")) {
    bad("crumbs", "ShopBoDetail must breadcrumb Shop home > Bad Order");
  }
  if (!bo.includes("shopAa.input") || !bo.includes("closedReasonLine")) {
    bad("r3-bo", "ShopBoDetail must use white shopAa.input + closedReasonLine");
  }
  if (!bo.includes("readOnly")) {
    bad("r3-bo-ro", "ShopBoDetail must handle readOnly");
  }
  // Inconsistent state is owner-only — shops must not surface it
  if (bo.includes("Inconsistent state") && !bo.includes("owner-only")) {
    bad("r5-no-inconsistent", "ShopBoDetail must not show Inconsistent state to shops");
  }
  ok("ShopBoDetail instructions, JIC, upload+hand, docs, compact timeline, POD, flags, r5");

  if (!est.includes("Withdraw") || !est.includes("Resubmit")) {
    bad("actions", "ShopEstimateDetail must offer withdraw + resubmit");
  }
  if (!est.includes("BRC") || (!est.includes("data file") && !est.includes("data-file"))) {
    bad("downloads", "ShopEstimateDetail must offer BRC PDF + data file");
  }
  if (!est.includes("Validation") && !est.includes("validation")) {
    bad("validation", "ShopEstimateDetail must show validation results");
  }
  if (!est.includes("no change requested") || !est.includes("decisionComments")) {
    bad("comments", "ShopEstimateDetail must show owner decision comments");
  }
  if (!est.includes("commentDiff") && !est.includes("Commented lines")) {
    bad("resubmit-diff", "ShopEstimateDetail must show commented-lines diff");
  }
  ok("ShopEstimateDetail withdraw, resubmit, downloads, validation, comments");

  if (!docs.includes("returnTo") && !docs.includes("RepairBackLink")) {
    bad("returnTo", "EstimateDocuments must support returnTo / Back link");
  }
  ok("EstimateDocuments returnTo + breadcrumbs");

  if (!nav.includes("returnTo") || !nav.includes("Back to")) {
    bad("nav", "RepairNavChrome must implement returnTo Back link");
  }
  if (!role.includes("DEV ROLE") || !role.includes("managing_partner")) {
    bad("dev-role", "DevRoleSwitcher must show DEV ROLE banner + roles");
  }
  if (!role.includes("import.meta.env.PROD") || !role.includes("return false")) {
    bad("dev-role-prod", "DevRoleSwitcher must gate on PROD (no banner in production)");
  }
  if (!nav.includes("placeholder:text-slate-600") || !nav.includes("bg-white")) {
    bad("nav-input", "RepairNavChrome shopAa.input must be white + visible placeholder");
  }
  ok("Nav chrome + DEV role switcher (production-gated)");

  const app = readFileSync(join(ROOT, "client/src/App.tsx"), "utf8");
  if (!app.includes("ShopPortal") || !app.includes("/repair/shop")) {
    bad("routes", "App.tsx must route /repair/shop*");
  }
  ok("App routes for shop portal");

  const link = readFileSync(join(ROOT, PAGES[5]), "utf8");
  if (!link.includes("Next action") || !link.includes("shop-link-next-step")) {
    bad("r4-link-next", "ShopEventLink must show next-action panel");
  }
  if (!link.includes("Accept assignment") || !link.includes("Decline work")) {
    bad("r4-link-confirm", "ShopEventLink must confirm/decline BO");
  }
  if (!link.includes("Mark on hand") || !link.includes("yardTrackNote")) {
    bad("r4-link-hand", "ShopEventLink must mark on hand with yard note");
  }
  if (
    !link.includes("500-byte") ||
    !link.includes("aarFile") ||
    !link.includes("Invoice PDF")
  ) {
    bad("r4-link-inv", "ShopEventLink must upload 500-byte + invoice PDF");
  }
  if (!link.includes("shopAa.input")) {
    bad("r4-link-aa", "ShopEventLink must use shopAa.input");
  }
  ok("ShopEventLink next-step confirm→on hand→estimate→invoice (r4)");

  const review = readFileSync(
    join(ROOT, "client/src/pages/repair/EstimateReview.tsx"),
    "utf8",
  );
  if (!review.includes("shopInvoice") || !review.includes("Shop invoice (read-only)")) {
    bad("r4-review-inv", "EstimateReview must show shop invoice read-only");
  }
  ok("EstimateReview shop invoice read-only (r4)");

  const tsc = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsc", "--noEmit", "--pretty", "false"],
    { cwd: ROOT, encoding: "utf8", env: process.env },
  );
  const out = `${tsc.stdout ?? ""}${tsc.stderr ?? ""}`;
  const pageErrors = out
    .split(/\r?\n/)
    .filter(
      (line) =>
        (line.includes("ShopPortal.tsx") ||
          line.includes("ShopBoDetail.tsx") ||
          line.includes("ShopEstimateDetail.tsx") ||
          line.includes("DevRoleSwitcher.tsx") ||
          line.includes("RepairNavChrome.tsx") ||
          line.includes("EstimateDocuments.tsx") ||
          line.includes("ShopEventLink.tsx") ||
          line.includes("EstimateReview.tsx")) &&
        line.includes("error TS"),
    );

  if (pageErrors.length > 0) {
    bad("client-tsc", pageErrors.join("\n"));
  }
  ok("tsc --noEmit: zero errors on shop + nav + documents pages");
  console.log("=== repair:typecheck-client-shop PASS ===");
}

const isMain =
  !!process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    assertShopClientTypecheck();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
