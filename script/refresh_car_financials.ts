/**
 * Re-run the per-car Asset Report write against already-loaded
 * rider_financial_summary (no file upload). Does not touch lease dates,
 * account_manager, status_tag, or comments.
 *
 *   npx tsx script/refresh_car_financials.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import { refreshCarFinancialsFromSummary } from "../server/refresh-car-financials.ts";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const result = await refreshCarFinancialsFromSummary(sb);
console.log(JSON.stringify(result, null, 2));

const { data, error } = await sb
  .from("railcars")
  .select("reporting_marks, car_number, rider_external_id, entity, nbv, oec, monthly_rent_per_car, monthly_depr_per_car, financial_snapshot_month")
  .eq("reporting_marks", "OFAX")
  .eq("car_number", "085055")
  .maybeSingle();
if (error) {
  console.warn("spot-check failed:", error.message);
} else {
  console.log("spot-check OFAX 085055:", data);
}

const { data: summaryRiders, error: sErr } = await sb
  .from("rider_financial_summary")
  .select("rider_id")
  .eq("snapshot_month", "2026-08-01");
if (sErr) {
  console.warn("summary rider fetch failed:", sErr.message);
} else {
  const ols = new Set((summaryRiders ?? []).map((r) => r.rider_id));
  const { data: blanks, error: bErr } = await sb
    .from("railcars")
    .select("id, rider_external_id")
    .eq("active", true)
    .is("financial_snapshot_month", null)
    .limit(20000);
  if (bErr) {
    console.warn("blank-car fetch failed:", bErr.message);
  } else {
    const still = (blanks ?? []).filter((c) => c.rider_external_id && ols.has(c.rider_external_id));
    const stillOls = new Set(still.map((c) => c.rider_external_id));
    console.log("active cars missing Aug 2026 financials despite a summary row:", still.length, "OLs:", stillOls.size);
  }
}

