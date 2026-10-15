/**
 * Write-only preview CSVs for the KPI / Commitment migration.
 * Does not UPDATE railcars or insert car_commitments.
 *
 * Run after the 20261016 SQL is applied (views exist):
 *   npx tsx script/kpi_migration_previews.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "empty\n";
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n") + "\n";
}

async function allRows(sb: any, table: string) {
  const out: any[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb.from(table).select("*").range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < page) break;
  }
  return out;
}

async function main() {
  const sb = createClient(env("SUPABASE_URL") || env("VITE_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const dir = join("script", "kpi_migration_previews");
  mkdirSync(dir, { recursive: true });

  const retag = await allRows(sb, "v_kpi_preview_retag");
  const idleOl = await allRows(sb, "v_kpi_preview_idle_on_ol");
  const seed = await allRows(sb, "v_kpi_preview_seed_off_rent");
  const idle = seed.filter((r) => r.seed_bucket === "program" || r.seed_bucket === "deal");
  const unassigned = seed.filter((r) => r.seed_bucket === "unassigned");
  const rentDefault = await allRows(sb, "v_kpi_preview_rent_start_default");
  const rentIdle = await allRows(sb, "v_kpi_preview_rent_start_idle_on_ol");

  writeFileSync(join(dir, "preview_retag.csv"), csv(retag));
  writeFileSync(join(dir, "review_idle_on_ol.csv"), csv(idleOl));
  writeFileSync(join(dir, "preview_seed_idle.csv"), csv(idle));
  writeFileSync(join(dir, "preview_seed_unassigned.csv"), csv(unassigned));
  writeFileSync(join(dir, "preview_rent_start_default.csv"), csv(rentDefault));
  writeFileSync(join(dir, "review_rent_start_idle_on_ol.csv"), csv(rentIdle));

  console.log(JSON.stringify({
    retag: retag.length,
    idle_on_ol: idleOl.length,
    seed_idle: idle.length,
    seed_unassigned: unassigned.length,
    rent_start_default: rentDefault.length,
    rent_start_idle_review: rentIdle.length,
    note: "No writes. Bruce must sign off before apply. Import the edited review CSV via Bulk Rent Start.",
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
