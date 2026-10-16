/**
 * Client typecheck gate for §H / §H r2 / §H r3 invoice + months + multi-car.
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
  const payments = readFileSync(
    join(ROOT, "client/src/pages/repair/PaymentBatches.tsx"),
    "utf8",
  );
  const portal = readFileSync(
    join(ROOT, "client/src/pages/repair/ShopPortal.tsx"),
    "utf8",
  );
  const app = readFileSync(join(ROOT, "client/src/App.tsx"), "utf8");
  const nav = readFileSync(
    join(ROOT, "client/src/pages/repair/RepairModuleNav.tsx"),
    "utf8",
  );

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
  if (!queue.includes("/repair/payments")) {
    bad("queue-link", "InvoiceQueue must link to /repair/payments");
  }
  ok("InvoiceQueue filters + batch export + payments link");

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

  if (!payments.includes("Create batch")) {
    bad("pay-create", "PaymentBatches must Create batch");
  }
  if (!payments.includes("Download CSV") && !payments.includes("Mark exported")) {
    bad("pay-export", "PaymentBatches must Download CSV / Mark exported");
  }
  if (!payments.includes("Record paid")) {
    bad("pay-paid", "PaymentBatches must Record paid");
  }
  if (!payments.includes("Batch history") && !payments.includes("Drill in")) {
    bad("pay-history", "PaymentBatches must show batch history drill-in");
  }
  if (!payments.includes("YYYY-MM-DD") && !payments.includes("ISO")) {
    bad("pay-iso", "PaymentBatches must document ISO dates");
  }
  if (!payments.includes("/api/repair/payment-batches")) {
    bad("pay-api", "PaymentBatches must call payment-batches API");
  }
  ok("PaymentBatches payables + export + paid + history");

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
  if (!app.includes("PaymentBatches") || !app.includes("/repair/payments")) {
    bad("payments-route", "App must route /repair/payments");
  }
  if (app.includes('path="/repair/invoices" component={RepairComingSoon}')) {
    bad("placeholder", "Invoices must not be Coming Soon");
  }
  if (!nav.includes("/repair/payments")) {
    bad("nav", "RepairModuleNav must include Payments");
  }
  ok("App + nav routes wired");

  const months = readFileSync(
    join(ROOT, "client/src/pages/repair/AccountingMonths.tsx"),
    "utf8",
  );
  const multi = readFileSync(
    join(ROOT, "client/src/pages/repair/ShopMultiCarInvoice.tsx"),
    "utf8",
  );
  if (!months.includes("accounting-months") || !months.includes("close month")) {
    bad("months", "AccountingMonths must close accounting months");
  }
  if (!months.includes("Lessee rebill pending") || !months.includes("Road rebill pending")) {
    bad("rebill-pending", "Months UI must show rebill pending totals");
  }
  if (!app.includes("AccountingMonths") || !app.includes("/repair/months")) {
    bad("months-route", "App must route /repair/months");
  }
  if (!nav.includes("/repair/months")) {
    bad("months-nav", "Nav must include Months");
  }
  if (!multi.includes("multi-car") || !multi.includes("Create multi-car invoice")) {
    bad("multi", "ShopMultiCarInvoice required");
  }
  if (/unit[\s-]?train/i.test(multi)) {
    bad("multi-naming", "ShopMultiCarInvoice must not say unit train — call it multi-car invoice");
  }
  if (!multi.includes("No cap on cars") && !multi.includes("two or more")) {
    bad("multi-cap", "UI must say multi-car (≥2, no cap)");
  }
  if (!app.includes("ShopMultiCarInvoice")) {
    bad("multi-route", "App must route multi-car create");
  }
  ok("Accounting months + multi-car UI wired");

  if (!review.includes("Est amount") || !review.includes("Inv amount")) {
    bad("headers", "InvoiceReview headers must include Est/Inv amount");
  }
  if (!review.includes("Net payable") && !review.includes("net payable")) {
    bad("short-net", "InvoiceReview must show short-pay and net payable");
  }
  if (!review.includes("Under owner review") && !review.includes("statusPlain")) {
    bad("plain-status", "InvoiceReview must use plain status words");
  }
  if (!queue.includes("bg-white") || !review.includes("bg-white")) {
    bad("contrast", "Invoice pages need white panels");
  }
  ok("Contrast + short-pay header + plain statuses");

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
          line.includes("PaymentBatches.tsx") ||
          line.includes("AccountingMonths.tsx") ||
          line.includes("ShopMultiCarInvoice.tsx") ||
          line.includes("ShopPortal.tsx")) &&
        line.includes("error TS"),
    );
  if (pageErrors.length > 0) {
    bad("client-tsc", pageErrors.join("\n"));
  }
  ok("tsc --noEmit: zero errors on invoice + payments + shop portal pages");
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
