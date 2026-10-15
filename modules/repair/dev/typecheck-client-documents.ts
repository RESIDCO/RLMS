/**
 * Client typecheck gate for §E Document Viewer.
 * Run: npm run repair:typecheck-client-documents
 * Also invoked by repair:smoke-documents.
 */
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawnSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "../../..");
const DOC_PAGE = "client/src/pages/repair/EstimateDocuments.tsx";

function bad(label: string, detail: string): never {
  throw new Error(`${label}: ${detail}`);
}

function ok(msg: string) {
  console.log(`  OK  ${msg}`);
}

export function assertDocumentsClientTypecheck(): void {
  console.log("=== repair:typecheck-client-documents ===");
  const src = readFileSync(join(ROOT, DOC_PAGE), "utf8");

  if (!src.includes("File Attachments")) {
    bad("docs-ui", "EstimateDocuments.tsx must title File Attachments (shot 03)");
  }
  if (!src.includes("/api/repair/documents/viewer")) {
    bad("docs-api", "EstimateDocuments must load /api/repair/documents/viewer");
  }
  if (!src.includes("aar-preview") || !src.includes("Download zip")) {
    bad("docs-preview", "Must support aar-preview + zip download");
  }
  if (!src.includes("Attach to Send Lessee")) {
    bad("docs-lessee", "Must expose Attach to Send Lessee for owner");
  }
  ok("EstimateDocuments has shot-03 title + viewer/zip/send-lessee hooks");

  const tsc = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsc", "--noEmit", "--pretty", "false"],
    { cwd: ROOT, encoding: "utf8", env: process.env },
  );
  const out = `${tsc.stdout ?? ""}${tsc.stderr ?? ""}`;
  // Gate on §E page only (same pattern as typecheck-client-wreck).
  // Pre-existing BadOrders.tsx errors are out of scope for this tip.
  const docErrors = out
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.includes("EstimateDocuments.tsx") && line.includes("error TS"),
    );

  if (docErrors.length > 0) {
    bad("client-tsc", docErrors.join("\n"));
  }
  ok("tsc --noEmit: zero errors on EstimateDocuments.tsx");
  console.log("=== repair:typecheck-client-documents PASS ===");
}

const isMain =
  !!process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    assertDocumentsClientTypecheck();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
