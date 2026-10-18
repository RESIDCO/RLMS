/**
 * Preview-only lease P1 cleanup. Writes CSVs. Does not change data.
 * Compare against script/_lease_mgmt_bundle/lease_previews/ snapshots.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLeaseP1Previews } from "../server/lease-mgmt";

const dir = join(dirname(fileURLToPath(import.meta.url)), "lease_p1_preview_out");

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n") + "\n";
}

const previews = await buildLeaseP1Previews();
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "preview_ea_placeholder_merge.csv"), toCsv(previews.preview_ea_placeholder_merge as Record<string, unknown>[]));
writeFileSync(join(dir, "preview_unlinked_cars.csv"), toCsv(previews.preview_unlinked_cars as Record<string, unknown>[]));
writeFileSync(join(dir, "list_duplicate_lessee_candidates.csv"), toCsv(previews.list_duplicate_lessee_candidates as Record<string, unknown>[]));
writeFileSync(join(dir, "list_ea_on_rent_cars.csv"), toCsv(previews.list_ea_on_rent_cars as Record<string, unknown>[]));
writeFileSync(join(dir, "COUNTS.json"), JSON.stringify(previews.counts, null, 2));
console.log(JSON.stringify({ out: dir, counts: previews.counts }, null, 2));
