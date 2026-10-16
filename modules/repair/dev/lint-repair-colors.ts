/**
 * Fail on hard-coded colors in repair client / modules UI surfaces.
 * Colors belong in client/src/index.css (--repair-*) or repairTokens.ts.
 *
 * Run: npm run repair:lint-colors
 * Also invoked from repair:smoke-invoice (axe / contrast gate).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");

const HEX_RE = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const RGB_RE = /\brgba?\s*\(/;
const HSL_RAW_RE = /\bhsla?\s*\(\s*\d/;

/** Token definition homes — hex allowed here only. */
const ALLOW_FILES = new Set([
  "client/src/pages/repair/repairTokens.ts",
  "client/src/index.css",
  "modules/repair/services/shop-clarity.ts",
  "modules/repair/dev/lint-repair-colors.ts",
]);

const SCAN_DIRS = [
  "client/src/pages/repair",
  "modules/repair",
];

const SCAN_EXTS = new Set([".ts", ".tsx", ".css"]);

/** Skip server-only, email HTML bodies, smokes that assert on CSS hex, migrations. */
function shouldScan(rel: string): boolean {
  const n = rel.replace(/\\/g, "/");
  if (ALLOW_FILES.has(n)) return false;
  if (n.includes("node_modules")) return false;
  if (n.endsWith(".sql")) return false;
  if (n.includes("/migrations/")) return false;
  if (n.includes("/reference/")) return false;
  if (n.includes("/shop-samples/")) return false;
  if (n.includes("/exports/")) return false;
  if (n.includes("/dev/smoke-")) return false;
  if (n.includes("/dev/seed-")) return false;
  if (n.includes("/dev/typecheck-")) return false;
  if (n.includes("/dev/demo-")) return false;
  if (n.includes("/dev/clean-")) return false;
  if (n.includes("/dev/migrate-")) return false;
  if (n.includes("/dev/import-")) return false;
  if (n.includes("/dev/aar-")) return false;
  if (n.includes("/dev/dev-local")) return false;
  if (n.includes("lessee-email")) return false; // HTML email chrome (not owner UI)
  // Client repair pages + any remaining modules/repair TS that is UI-adjacent
  if (n.startsWith("client/src/pages/repair/")) return true;
  // modules/repair: only flag accidental UI color hardcodes outside allowlist
  if (n.startsWith("modules/repair/") && (n.endsWith(".tsx") || n.endsWith(".css"))) {
    return true;
  }
  return false;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "exports" || name === "reference") {
        continue;
      }
      walk(abs, out);
    } else {
      const ext = name.slice(name.lastIndexOf("."));
      if (SCAN_EXTS.has(ext)) out.push(abs);
    }
  }
  return out;
}

export type LintHit = { file: string; line: number; text: string };

export function findHardCodedColors(root = ROOT): LintHit[] {
  const hits: LintHit[] = [];
  for (const d of SCAN_DIRS) {
    const absDir = join(root, d);
    for (const abs of walk(absDir)) {
      const rel = relative(root, abs).replace(/\\/g, "/");
      if (!shouldScan(rel)) continue;
      const lines = readFileSync(abs, "utf8").split(/\r?\n/);
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
          // Allow hex in comments
          return;
        }
        if (HEX_RE.test(line) || RGB_RE.test(line) || HSL_RAW_RE.test(line)) {
          hits.push({ file: rel, line: idx + 1, text: trimmed.slice(0, 120) });
        }
      });
    }
  }
  return hits;
}

/** Documented self-test: lint must detect a deliberate violation string. */
export function lintDetectsDeliberateViolation(): boolean {
  const sample = 'const bad = "bg-[#000000] text-[#111111]";';
  return HEX_RE.test(sample);
}

export function assertRepairColorsClean(root = ROOT): void {
  console.log("=== repair:lint-colors ===");
  if (!lintDetectsDeliberateViolation()) {
    throw new Error("lint-self-test: HEX_RE failed to catch deliberate #000000 violation");
  }
  console.log("  OK  deliberate-violation detector (#000000)");

  const hits = findHardCodedColors(root);
  if (hits.length) {
    const detail = hits
      .slice(0, 40)
      .map((h) => `  ${h.file}:${h.line}  ${h.text}`)
      .join("\n");
    throw new Error(
      `hard-coded colors (${hits.length}) — use --repair-* / repairTokens.ts:\n${detail}`,
    );
  }
  console.log("  OK  no hard-coded colors in repair client / modules UI files");
  console.log("=== repair:lint-colors PASS ===");
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    assertRepairColorsClean();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
