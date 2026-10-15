/**
 * Client typecheck gate for §F Lessee screen.
 * Run: npm run repair:typecheck-client-lessee
 */
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawnSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "../../..");
const LESSEE_PAGE = "client/src/pages/repair/LesseeApproval.tsx";
const LESSEE_DOCS = "client/src/pages/repair/LesseeDocuments.tsx";
const REVIEW_PAGE = "client/src/pages/repair/EstimateReview.tsx";

function bad(label: string, detail: string): never {
  throw new Error(`${label}: ${detail}`);
}

function ok(msg: string) {
  console.log(`  OK  ${msg}`);
}

export function assertLesseeClientTypecheck(): void {
  console.log("=== repair:typecheck-client-lessee ===");
  const lessee = readFileSync(join(ROOT, LESSEE_PAGE), "utf8");
  const docs = readFileSync(join(ROOT, LESSEE_DOCS), "utf8");
  const review = readFileSync(join(ROOT, REVIEW_PAGE), "utf8");

  if (!lessee.includes("RESIDCO") && !lessee.includes("workspace")) {
    bad("brand", "LesseeApproval must show RESIDCO / workspace brand");
  }
  if (!lessee.includes("Accept") || !lessee.includes("Reject")) {
    bad("actions", "LesseeApproval must offer Accept and Reject");
  }
  if (!lessee.includes("AlertDialog") && !lessee.includes("Confirm")) {
    bad("confirm", "LesseeApproval must confirm before submit");
  }
  if (!lessee.includes("name") || !lessee.includes("email")) {
    bad("identity", "LesseeApproval must collect name + email");
  }
  if (!lessee.includes("Resp6") && !lessee.includes("downloads")) {
    bad("downloads", "LesseeApproval must offer Resp6 downloads");
  }
  if (!lessee.includes("Accepted on") || !lessee.includes("Thank you")) {
    bad("success-banner", "LesseeApproval must show Accepted on <ET> by <name>. Thank you.");
  }
  if (!lessee.includes("fixed bottom-0") && !lessee.includes("sticky")) {
    // sticky footer via fixed bottom bar
    bad("sticky-footer", "LesseeApproval must sticky-footer total + Accept/Reject");
  }
  if (!lessee.includes("brcLessee") && !lessee.includes("BRC")) {
    bad("brc-header", "LesseeApproval must use BRC header presentation");
  }
  if (!lessee.includes("preventDefault") && !lessee.includes("Submitting")) {
    bad("confirm-lock", "Confirm must prevent silent dismiss / show submitting");
  }
  ok("LesseeApproval has brand, Accept/Reject, confirm, banner, sticky footer, BRC");

  if (!docs.includes("granted") && !docs.includes("documents-viewer")) {
    bad("docs", "LesseeDocuments must use lessee documents-viewer");
  }
  ok("LesseeDocuments is §E lessee-mode viewer");

  if (!review.includes("lessee-status") && !review.includes("Lessee response overdue")) {
    bad("owner", "EstimateReview must show lessee status / overdue");
  }
  if (!review.includes("Record phone/email") && !review.includes("lessee-manual")) {
    bad("manual", "EstimateReview must allow manual phone/email record");
  }
  if (!review.includes("30_000") && !review.includes("30000")) {
    bad("polling", "EstimateReview must poll lessee-status within 30s");
  }
  if (!review.includes("decidedAtEt") && !review.includes("respondentName")) {
    bad("decider", "EstimateReview must show decider name/email/ET");
  }
  ok("EstimateReview has lessee status + manual record + 30s poll");

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
        (line.includes("LesseeApproval.tsx") ||
          line.includes("LesseeDocuments.tsx") ||
          line.includes("EstimateReview.tsx")) &&
        line.includes("error TS"),
    );

  if (pageErrors.length > 0) {
    bad("client-tsc", pageErrors.join("\n"));
  }
  ok(
    "tsc --noEmit: zero errors on LesseeApproval + LesseeDocuments + EstimateReview",
  );
  console.log("=== repair:typecheck-client-lessee PASS ===");
}

const isMain =
  !!process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    assertLesseeClientTypecheck();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
