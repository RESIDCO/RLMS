/**
 * One-shot: Asset Report governs rider + car lease/OL dates; V_Valid fills gaps.
 *
 *   npx tsx script/govern_lease_dates.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import { governLeaseDates } from "../server/govern-lease-dates.ts";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const result = await governLeaseDates(sb);
console.log(JSON.stringify(result, null, 2));

const { data, error } = await sb
  .from("riders")
  .select("rider_name, expiration_date, expiration_source")
  .in("rider_name", ["OL2420", "OL1706"]);
if (error) {
  console.warn("spot-check failed:", error.message);
} else {
  console.log("spot-check OL2420 / OL1706:", data);
}
