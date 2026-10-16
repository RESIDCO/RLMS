/**
 * Client typecheck gate for §H Owner invoice review + payment.
 * Run: npm run repair:typecheck-client-invoice
 */
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawnSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "../../..");

function bad(label: string, detail: string): never {
  throw new Error(`${label}: ${detail}`);
}

function ok(msg: string) {
  console.log(`  OK  ${msg}`);
}

export function assertInvoiceClientTypecheck(): void {
  console.log("=== repair:typecheck-client-invoice ===");
  const queue = readFileSync(
    join(ROOT, "client/src/pages/repair/InvoiceQueue.tsx"),
    "utf8",
  );
  const review = readFileSync(
    join(ROOT, "client/src/pages/repair/InvoiceReview.tsx"),
    "utf8",
  );
  const portal = readFileSync(
    join(ROOT, "client/src/pages/repair/ShopPortal.tsx"),
    "utf8",
  );
  const app = readFileSync(join(ROOT, "client/src/App.tsx"), "utf8");

  if (!queue.includes("/api/repair/invoices/queue")) {
    bad("queue", "InvoiceQueue must call invoices/queue");
  }
  if (!queue.includes("Create batch") || !queue.includes("export CSV")) {
    bad("batch", "InvoiceQueue must support payment batch CSV export");
  }
  if (!queue.includes("Δ")) {
    bad("delta", "InvoiceQueue must show difference $/%");
  }
  if (!queue.includes("RESIDCO")) {
    bad("brand", "InvoiceQueue must mention RESIDCO");
  }
  ok("InvoiceQueue filters + batch export");

  if (
    !review.includes("Approve") ||
    !review.includes("Reject") ||
    !review.includes("Short-pay")
  ) {
    bad("actions", "InvoiceReview must have Approve / Reject / Short-pay");
  }
  if (!review.includes("owner-approve") || !review.includes("short-pay")) {
    bad("apis", "InvoiceReview must call owner-approve / short-pay APIs");
  }
  if (!review.includes("Over-tolerance")) {
    bad("tol", "InvoiceReview must gate over-tolerance with reason");
  }
  if (!review.includes("Rebill pending") && !review.includes("Rebill")) {
    bad("rebill", "InvoiceReview must show resp split / rebill");
  }
  ok("InvoiceReview side-by-side + actions + tolerance");

  if (!portal.includes("Missed POD")) {
    bad("missed-pod", "ShopPortal must restore Missed POD tile");
  }
  if (!portal.includes("statusLabel")) {
    bad("closed-label", "ShopPortal must prefer statusLabel (Closed never blank)");
  }
  ok("§G carryovers: Missed POD + Closed label");

  if (!app.includes("InvoiceQueue") || !app.includes("InvoiceReview")) {
    bad("routes", "App must route invoice pages");
  }
  if (app.includes('path="/repair/invoices" component={RepairComingSoon}')) {
    bad("placeholder", "Invoices must not be Coming Soon");
  }
  ok("App routes wired");

  const tsc = spawnSync(
    "npx",
    ["tsc", "-p", "tsconfig.json", "--noEmit", "--pretty", "false"],
    { cwd: ROOT, encoding: "utf8", env: process.env, timeout: 180_000 },
  );
  const out = `${tsc.stdout ?? ""}${tsc.stderr ?? ""}`;
  const pageErrors = out
    .split(/\r?\n/)
    .filter(
      (line) =>
        (line.includes("InvoiceQueue.tsx") ||
          line.includes("InvoiceReview.tsx") ||
          line.includes("ShopPortal.tsx")) &&
        line.includes("error TS"),
    );
  if (pageErrors.length > 0) {
    bad("client-tsc", pageErrors.join("\n"));
  }
  ok("tsc --noEmit: zero errors on invoice + shop portal pages");
  console.log("=== repair:typecheck-client-invoice PASS ===");
}

const isMain =
  !!process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    assertInvoiceClientTypecheck();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
