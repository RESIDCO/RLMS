/**
 * Operating railroads reference (delivering lines).
 * Seeded from public-domain USDOT/BTS NARN marks — not billing_roads.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { DEFAULT_TENANT_ID, q } from "../db";

export type RailroadRow = {
  id: string;
  mark: string;
  name: string | null;
  railroad_class: string;
  source: string;
  active: boolean;
};

export type RailroadSeedRow = {
  mark: string;
  name: string | null;
  class?: string;
  railroad_class?: string;
  source?: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_JSON = join(__dirname, "../data/narn-railroads.json");

export function formatRailroadLabel(r: {
  mark: string;
  name?: string | null;
}): string {
  const mark = r.mark.trim().toUpperCase();
  const name = (r.name ?? "").trim();
  return name ? `${mark} – ${name}` : mark;
}

export async function listRailroads(
  tenantId = DEFAULT_TENANT_ID,
  opts?: { q?: string; activeOnly?: boolean; limit?: number },
): Promise<RailroadRow[]> {
  const lim = Math.min(Math.max(opts?.limit ?? 40, 1), 2000);
  const qTrim = opts?.q?.trim() ?? "";
  const params: unknown[] = [tenantId];
  let sql = `SELECT id, mark, name, railroad_class, source, active
             FROM repair.railroads
             WHERE tenant_id = $1 AND deleted_at IS NULL`;
  if (opts?.activeOnly !== false) {
    sql += ` AND active = true`;
  }
  if (qTrim) {
    params.push(`${qTrim}%`, `%${qTrim}%`);
    const pPrefix = `$${params.length - 1}`;
    const pAny = `$${params.length}`;
    // Prefer mark prefix ("BP" → BPRR) then name / mark contains
    sql += ` AND (mark ILIKE ${pPrefix} OR mark ILIKE ${pAny} OR name ILIKE ${pAny})`;
    sql += ` ORDER BY
      CASE WHEN mark ILIKE ${pPrefix} THEN 0
           WHEN mark ILIKE ${pAny} THEN 1
           ELSE 2 END,
      mark`;
  } else {
    sql += ` ORDER BY mark`;
  }
  params.push(lim);
  sql += ` LIMIT $${params.length}`;
  const { rows } = await q(sql, params);
  return rows.map((r) => ({
    id: String(r.id),
    mark: String(r.mark),
    name: r.name != null ? String(r.name) : null,
    railroad_class: String(r.railroad_class),
    source: String(r.source),
    active: Boolean(r.active),
  }));
}

export async function getRailroadByMark(
  mark: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<RailroadRow | null> {
  const m = mark.trim().toUpperCase();
  if (!m) return null;
  const { rows } = await q(
    `SELECT id, mark, name, railroad_class, source, active
     FROM repair.railroads
     WHERE tenant_id = $1 AND upper(mark) = $2
       AND deleted_at IS NULL AND active = true
     LIMIT 1`,
    [tenantId, m],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: String(r.id),
    mark: String(r.mark),
    name: r.name != null ? String(r.name) : null,
    railroad_class: String(r.railroad_class),
    source: String(r.source),
    active: Boolean(r.active),
  };
}

/** Idempotent NARN + curated supplement seed into repair.railroads. */
export async function seedRailroadsFromNarn(
  tenantId = DEFAULT_TENANT_ID,
  actor = "seed:narn-railroads",
): Promise<{ inserted: number; updated: number; total: number }> {
  const raw = JSON.parse(readFileSync(SEED_JSON, "utf8")) as RailroadSeedRow[];
  let inserted = 0;
  let updated = 0;
  for (const row of raw) {
    const mark = String(row.mark ?? "")
      .trim()
      .toUpperCase();
    if (!mark) continue;
    const name = row.name != null ? String(row.name).trim() || null : null;
    const cls = String(row.railroad_class ?? row.class ?? "short_line");
    const source = String(row.source ?? "narn_bts");
    const existing = await q(
      `SELECT id FROM repair.railroads
       WHERE tenant_id = $1 AND upper(mark) = $2 LIMIT 1`,
      [tenantId, mark],
    );
    if (existing.rows[0]) {
      await q(
        `UPDATE repair.railroads
         SET name = COALESCE($3, name),
             railroad_class = $4,
             source = $5,
             active = true,
             deleted_at = NULL,
             deleted_by = NULL,
             delete_reason = NULL
         WHERE id = $1 AND tenant_id = $2`,
        [existing.rows[0].id, tenantId, name, cls, source],
      );
      updated += 1;
    } else {
      await q(
        `INSERT INTO repair.railroads
           (tenant_id, mark, name, railroad_class, source, active, created_by)
         VALUES ($1,$2,$3,$4,$5,true,$6)`,
        [tenantId, mark, name, cls, source, actor],
      );
      inserted += 1;
    }
  }
  return { inserted, updated, total: raw.length };
}
