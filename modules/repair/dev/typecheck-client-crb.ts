/**
 * Client + server typecheck gate for §I CRB staging.
 * Run: npm run repair:typecheck-crb
 */
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawnSync } from "child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function bad(label: string, detail?: string): never {
  throw new Error(detail ? `${label}: ${detail}` : label);
}
function ok(msg: string) {
  console.log(`  OK  ${msg}`);
}

export function assertCrbClientTypecheck(): void {
  console.log("=== repair:typecheck-crb ===");
  const app = readFileSync(join(ROOT, "client/src/App.tsx"), "utf8");
  const home = readFileSync(join(ROOT, "client/src/pages/repair/CrbHome.tsx"), "utf8");
  const invoice = readFileSync(join(ROOT, "client/src/pages/repair/CrbInvoice.tsx"), "utf8");
  const car = readFileSync(join(ROOT, "client/src/pages/repair/CrbCar.tsx"), "utf8");
  const grid = readFileSync(join(ROOT, "client/src/pages/repair/CrbGrid.tsx"), "utf8");
  const rules = readFileSync(join(ROOT, "client/src/pages/repair/AuditRulesPanel.tsx"), "utf8");
  const nav = readFileSync(join(ROOT, "client/src/pages/repair/RepairModuleNav.tsx"), "utf8");
  const css = readFileSync(join(ROOT, "client/src/index.css"), "utf8");
  const pkgs = readFileSync(join(ROOT, "modules/repair/server/crb/packages.ts"), "utf8");

  for (const route of ["/repair/crb/invoice/:id/car/:carId", "/repair/crb/invoice/:id", "/repair/crb"]) {
    if (!app.includes(route)) bad("route", route);
  }
  if (!nav.includes('href: "/repair/crb"') || !nav.includes("Accounts Payable") || !nav.includes("CRB Staging")) {
    bad("nav", "Accounts Payable CRB Staging");
  }
  if (nav.includes("Invoice Worklist")) bad("nav", "CRB Staging");
  if (!nav.includes('label: "Invoices"')) bad("nav", "shop Invoices");
  if (!home.includes("Mark reviewed") || home.includes("bulk approve")) bad("bulk", "mark reviewed only");
  if (!home.includes("Hard stops only") || !home.includes("Enter car numbers") || !home.includes("Nearest deadline")) {
    bad("worklist", "dense grid labels");
  }
  if (!invoice.includes("crb-field-strip")) bad("invoice", "header strip");
  for (const label of ["Billing lines", "Record format", "Job code", "Why made", "Location / position", "Labor hrs", "Responsibility", "Open BRC", "Expand all", "Collapse all", "scope: \"LINE\""]) {
    if (!grid.includes(label)) bad("drill-down", label);
  }
  if (!grid.includes("/lines/") || !grid.includes("/reject")) bad("line reject");
  if (!home.includes("Expand all") || !home.includes("Collapse all") || !home.includes("CrbCarTable")) bad("worklist expand");
  if (!invoice.includes("CrbCarTable")) bad("invoice grid");
  if (!car.includes("CrbBillingLines")) bad("car grid");
  for (const src of [home, invoice, car]) {
    if (!src.includes("CRB Staging")) bad("title", "CRB Staging");
    if (src.includes("Invoice Worklist") || src.includes('"Worklist"')) bad("title", "CRB Staging");
  }
  if (!home.includes('useCrbTitle("CRB Staging")')) bad("document title", "CRB Staging");
  if (!invoice.includes("CRB Staging › ${invoiceHeading}") || !invoice.includes("`Invoice ${invoice.billing_party}")) {
    bad("document title", "CRB Staging › Invoice");
  }
  if (!car.includes("CRB Staging › ${carHeading}") || !car.includes("`Car ${car.car_initial}")) {
    bad("document title", "CRB Staging › Car");
  }
  if (!invoice.includes("Return unpaid") || !invoice.includes("Approve with exceptions")) bad("invoice actions");
  if (!invoice.includes("Mark filed manually")) bad("filed");
  for (const key of ["J", "K", "Approve (A)", "Reject (R)", "Override (O)", "Help (?)"]) {
    if (!car.includes(key)) bad("keys", key);
  }
  if (!car.includes("next-car") || !car.includes("Raw 500-byte") || !car.includes("proposed")) bad("car tools");
  if (!rules.includes("Clone new version") || !rules.includes("Standing exceptions")) bad("rules tab");
  if (!css.includes(".repair-chip-stop") || !css.includes(":focus-visible")) bad("chips");
  for (const src of [home, invoice, car, rules, grid]) {
    if (/#[0-9a-fA-F]{3,8}\b/.test(src)) bad("hex", "CRB page has a hard-coded color");
    if (src.includes("text-slate-400") || src.includes("text-slate-500")) bad("pale");
  }
  if (pkgs.includes("fetch(") || pkgs.includes("http.request") || pkgs.includes("https.request")) {
    bad("network", "packages must stay on the local outbox");
  }
  ok("routes, keyboard, chips, and local-only packages");

  const tsc = spawnSync("npx", ["tsc", "-p", "tsconfig.json", "--noEmit", "--pretty", "false"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    timeout: 180_000,
  });
  const out = `${tsc.stdout ?? ""}${tsc.stderr ?? ""}`;
  const interesting = [
    "server/crb/",
    "CrbHome.tsx",
    "CrbInvoice.tsx",
    "CrbCar.tsx",
    "CrbUi.tsx",
    "CrbGrid.tsx",
    "CodeHover.tsx",
    "AuditRulesPanel.tsx",
    "seed-crb-demo.ts",
    "smoke-crb.ts",
    "typecheck-client-crb.ts",
    "ref-lookup.ts",
  ];
  const pageErrors = out.split(/\r?\n/).filter((line) => line.includes("error TS") && interesting.some((name) => line.includes(name)));
  if (pageErrors.length) bad("tsc", pageErrors.join("\n"));
  ok("tsc --noEmit: zero errors on CRB server, pages, seed, and smoke");
  console.log("=== repair:typecheck-crb PASS ===");
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    assertCrbClientTypecheck();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
