/* eslint-disable no-console */
/** Run: npx tsx client/src/pages/Search.smoke.test.ts */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const outfile = path.join(root, "tmp", "search-smoke.mjs");
mkdirSync(path.dirname(outfile), { recursive: true });

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "client/src/pages/Search.smoke.render.test.ts",
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--packages=external",
      "--jsx=automatic",
      `--outfile=${outfile}`,
      `--define:import.meta.env={"VITE_SUPABASE_URL":"http://127.0.0.1","VITE_SUPABASE_ANON_KEY":"dummy","VITE_API_BASE":"","DEV":false,"PROD":true}`,
    ],
    { cwd: root, stdio: "inherit" },
  );
  execFileSync("node", [outfile], { cwd: root, stdio: "inherit" });
} catch (err) {
  console.error("FAIL search smoke", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  rmSync(outfile, { force: true });
  rmSync(path.dirname(outfile), { recursive: true, force: true });
}
