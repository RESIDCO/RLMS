/**
 * Client typecheck gate for wreck UI — prevents blank Chrome from bad imports.
 *
 * 1) WreckEvent.tsx must use named `{ WorkspaceTitle }` (no default import).
 * 2) `tsc --noEmit` must report zero errors on WreckEvent.tsx.
 *
 * Run: npm run repair:typecheck-client-wreck
 * Also invoked at the start of npm run repair:smoke-wreck.
 */
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawnSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "../../..");
const WRECK_PAGE = "client/src/pages/repair/WreckEvent.tsx";

function bad(label: string, detail: string): never {
  throw new Error(`${label}: ${detail}`);
}

function ok(msg: string) {
  console.log(`  OK  ${msg}`);
}

export function assertWreckClientTypecheck(): void {
  console.log("=== repair:typecheck-client-wreck ===");
  const src = readFileSync(join(ROOT, WRECK_PAGE), "utf8");

  if (/import\s+WorkspaceTitle\s+from\s+["']\.\/WorkspaceTitle["']/.test(src)) {
    bad(
      "wreck-import",
      "WreckEvent.tsx default-imports WorkspaceTitle — use named import { WorkspaceTitle } (blank Chrome)",
    );
  }
  if (
    !/import\s*\{\s*WorkspaceTitle\s*\}\s*from\s*["']\.\/WorkspaceTitle["']/.test(
      src,
    )
  ) {
    bad(
      "wreck-import",
      "WreckEvent.tsx must named-import { WorkspaceTitle } from ./WorkspaceTitle",
    );
  }
  ok("WreckEvent uses named WorkspaceTitle import");

  const tsc = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsc", "--noEmit", "--pretty", "false"],
    { cwd: ROOT, encoding: "utf8", env: process.env },
  );
  const out = `${tsc.stdout ?? ""}${tsc.stderr ?? ""}`;
  const wreckErrors = out
    .split(/\r?\n/)
    .filter((line) => line.includes("WreckEvent.tsx") && line.includes("error TS"));

  if (wreckErrors.length > 0) {
    bad("client-tsc", wreckErrors.join("\n"));
  }
  ok("tsc --noEmit: zero errors on WreckEvent.tsx");
  console.log("=== repair:typecheck-client-wreck PASS ===");
}

const isMain =
  !!process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    assertWreckClientTypecheck();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
