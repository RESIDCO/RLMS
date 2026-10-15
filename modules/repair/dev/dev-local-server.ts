/**
 * Windows-friendly local UI review server (no Supabase).
 *
 * Requires:
 *   REPAIR_LOCAL_DB=1
 *   REPAIR_DEV_BYPASS_AUTH=1
 *   DATABASE_URL=postgresql://...
 *
 * Prefer: npm run repair:dev:local
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.REPAIR_LOCAL_DB = process.env.REPAIR_LOCAL_DB || "1";
process.env.REPAIR_DEV_BYPASS_AUTH = process.env.REPAIR_DEV_BYPASS_AUTH || "1";
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.VITE_REPAIR_LOCAL_REVIEW = "1";

if (process.env.REPAIR_LOCAL_DB !== "1" || process.env.REPAIR_DEV_BYPASS_AUTH !== "1") {
  console.error(
    "[repair:dev:local] Refusing to start: set REPAIR_LOCAL_DB=1 and REPAIR_DEV_BYPASS_AUTH=1",
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL && !process.env.REPAIR_DATABASE_URL) {
  console.error(
    "[repair:dev:local] DATABASE_URL (or REPAIR_DATABASE_URL) is required for local Postgres",
  );
  process.exit(1);
}

console.log("============================================================");
console.log(" LOCAL REVIEW MODE, no Supabase");
console.log(" Repair module only — local Postgres (DATABASE_URL).");
console.log("============================================================");
process.env.REPAIR_LOCAL_REVIEW_BANNER_PRINTED = "1";

// Re-use host entry (local-review path stubs Supabase + registers repair only).
await import("../../../server/index.ts");
