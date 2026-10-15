/**
 * Client typecheck gate for §G Shop portal (+ r2 clarity).
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
  ok("ShopPortal brand + status + car search + KPIs + AA labels");

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
  if (!bo.includes("Status timeline") || !bo.includes("POD history")) {
    bad("lifecycle", "ShopBoDetail must show status timeline + POD history");
  }
  if (!bo.includes("Missed POD") || !bo.includes("Flags")) {
    bad("missed-flags", "ShopBoDetail must show missed POD + flags panel");
  }
  if (!bo.includes("RepairBreadcrumbs") && !bo.includes("Shop home")) {
    bad("crumbs", "ShopBoDetail must breadcrumb Shop home > Bad Order");
  }
  ok("ShopBoDetail instructions, JIC, upload+hand, docs, timeline, POD, flags");

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
  ok("Nav chrome + DEV role switcher");

  const app = readFileSync(join(ROOT, "client/src/App.tsx"), "utf8");
  if (!app.includes("ShopPortal") || !app.includes("/repair/shop")) {
    bad("routes", "App.tsx must route /repair/shop*");
  }
  ok("App routes for shop portal");

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
          line.includes("EstimateDocuments.tsx")) &&
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
