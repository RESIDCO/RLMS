/**
 * Client typecheck gate for §G Shop portal.
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

  if (!portal.includes("RESIDCO") || !portal.includes("Shop portal")) {
    bad("brand", "ShopPortal must show RESIDCO shop portal brand");
  }
  if (!portal.includes("byStatus") && !portal.includes("Estimates by status")) {
    bad("status", "ShopPortal must show estimates by status");
  }
  if (!portal.includes("carInitial") && !portal.includes("Search car")) {
    bad("search", "ShopPortal must search car initial/number");
  }
  ok("ShopPortal brand + status buckets + car search");

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
  ok("ShopBoDetail instructions, JIC, upload+hand, docs shop mode");

  if (!est.includes("Withdraw") || !est.includes("Resubmit")) {
    bad("actions", "ShopEstimateDetail must offer withdraw + resubmit");
  }
  if (!est.includes("BRC") || !est.includes("data file") && !est.includes("data-file")) {
    bad("downloads", "ShopEstimateDetail must offer BRC PDF + data file");
  }
  if (!est.includes("Validation") && !est.includes("validation")) {
    bad("validation", "ShopEstimateDetail must show validation results");
  }
  ok("ShopEstimateDetail withdraw, resubmit, downloads, validation");

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
          line.includes("ShopEstimateDetail.tsx")) &&
        line.includes("error TS"),
    );

  if (pageErrors.length > 0) {
    bad("client-tsc", pageErrors.join("\n"));
  }
  ok("tsc --noEmit: zero errors on ShopPortal + ShopBoDetail + ShopEstimateDetail");
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
