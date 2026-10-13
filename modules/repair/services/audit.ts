import { q } from "../db";

export async function writeAudit(opts: {
  tenantId: string;
  entity: string;
  entityId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  actor?: string | null;
  via?: string | null;
  ip?: string | null;
}): Promise<void> {
  await q(
    `INSERT INTO repair.audit_events
       (tenant_id, entity, entity_id, action, before_json, after_json, actor, via, ip, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$7)`,
    [
      opts.tenantId,
      opts.entity,
      opts.entityId ?? null,
      opts.action,
      opts.before ? JSON.stringify(opts.before) : null,
      opts.after ? JSON.stringify(opts.after) : null,
      opts.actor ?? null,
      opts.via ?? null,
      opts.ip ?? null,
    ],
  );
}
