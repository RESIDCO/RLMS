/**
 * Plain email distribution list for BO notifications.
 * Anyone can be added — not Resp-6 / lessee-specific.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";

export async function listDistributionEntries(tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT id, email, name, active, created_at
     FROM repair.distribution_list_entries
     WHERE tenant_id = $1 AND deleted_at IS NULL
     ORDER BY lower(email)`,
    [tenantId],
  );
  return rows;
}

export async function addDistributionEntry(opts: {
  email: string;
  name?: string;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const email = opts.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false as const, status: 400, error: "Valid email required" };
  }
  try {
    const { rows } = await q(
      `INSERT INTO repair.distribution_list_entries
         (tenant_id, email, name, created_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, email) DO UPDATE
         SET name = COALESCE(EXCLUDED.name, repair.distribution_list_entries.name),
             active = true,
             deleted_at = NULL,
             deleted_by = NULL,
             delete_reason = NULL
       RETURNING *`,
      [tenantId, email, opts.name?.trim() || null, opts.actor],
    );
    await writeAudit({
      tenantId,
      entity: "distribution_list",
      entityId: rows[0].id,
      action: "DISTRIBUTION_ENTRY_ADDED",
      after: rows[0],
      actor: opts.actor,
      via: "UI",
    });
    return { ok: true as const, entry: rows[0] };
  } catch (err) {
    return {
      ok: false as const,
      status: 500,
      error: err instanceof Error ? err.message : "Save failed",
    };
  }
}

export async function removeDistributionEntry(opts: {
  id: string;
  actor: string;
  reason?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.distribution_list_entries
     SET deleted_at = now(), deleted_by = $1, delete_reason = $2, active = false
     WHERE id = $3 AND tenant_id = $4 AND deleted_at IS NULL
     RETURNING *`,
    [opts.actor, opts.reason ?? "removed", opts.id, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Not found" };
  await writeAudit({
    tenantId,
    entity: "distribution_list",
    entityId: opts.id,
    action: "DISTRIBUTION_ENTRY_REMOVED",
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, entry: rows[0] };
}

/** Active emails for BO_CREATED notify (plain list). */
export async function activeDistributionEmails(
  tenantId = DEFAULT_TENANT_ID,
): Promise<string[]> {
  const { rows } = await q(
    `SELECT email FROM repair.distribution_list_entries
     WHERE tenant_id = $1 AND deleted_at IS NULL AND active
     ORDER BY lower(email)`,
    [tenantId],
  );
  return rows.map((r) => String(r.email));
}
