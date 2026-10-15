/**
 * Client typecheck gate for §E r2 BRC PDF + Lessee email.
 * Run: npm run repair:typecheck-client-brc-email
 */
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawnSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "../../..");
const SEND_PAGE = "client/src/pages/repair/SendLessee.tsx";
const REVIEW_PAGE = "client/src/pages/repair/EstimateReview.tsx";

function bad(label: string, detail: string): never {
  throw new Error(`${label}: ${detail}`);
}

function ok(msg: string) {
  console.log(`  OK  ${msg}`);
}

export function assertBrcEmailClientTypecheck(): void {
  console.log("=== repair:typecheck-client-brc-email ===");
  const send = readFileSync(join(ROOT, SEND_PAGE), "utf8");
  const review = readFileSync(join(ROOT, REVIEW_PAGE), "utf8");

  if (!send.includes("Customary responsibility email")) {
    bad("send-ui", "SendLessee must title Customary responsibility email");
  }
  if (!send.includes("Responsibility Items") && !send.includes("emailTable")) {
    bad("send-table", "SendLessee must preview emailTable rows");
  }
  if (!send.includes("Resp6.pdf") && !send.includes("attachmentNames")) {
    bad("send-attach", "SendLessee must show Resp6 attachment names");
  }
  if (!send.includes("ccText") && !send.includes("CC — owner")) {
    bad("send-cc", "SendLessee must expose CC (owner + shop)");
  }
  ok("SendLessee has customary email preview + CC + Resp6 names");

  if (!review.includes('exportBrc("pdf"')) {
    bad("review-brc", "EstimateReview must offer BRC PDF download");
  }
  if (!review.includes("BRC PDF (lessee)") || !review.includes("BRC PDF (shop)")) {
    bad("review-audience", "EstimateReview must offer owner/lessee/shop BRC PDF");
  }
  ok("EstimateReview has owner/lessee/shop BRC PDF actions");

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
        (line.includes("SendLessee.tsx") || line.includes("EstimateReview.tsx")) &&
        line.includes("error TS"),
    );

  if (pageErrors.length > 0) {
    bad("client-tsc", pageErrors.join("\n"));
  }
  ok("tsc --noEmit: zero errors on SendLessee.tsx + EstimateReview.tsx");
  console.log("=== repair:typecheck-client-brc-email PASS ===");
}

const isMain =
  !!process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    assertBrcEmailClientTypecheck();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
