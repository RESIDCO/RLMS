import { q } from "../db";
import type { StatusEntity, StatusRow, StatusTransitionRow } from "../types";

export async function listStatuses(
  tenantId: string,
  entity: StatusEntity,
): Promise<StatusRow[]> {
  const { rows } = await q<StatusRow>(
    `SELECT id, tenant_id, entity, code, display_name, sort_order, is_terminal, is_locking, active
     FROM repair.statuses
     WHERE tenant_id = $1 AND entity = $2 AND deleted_at IS NULL AND active = true
     ORDER BY sort_order`,
    [tenantId, entity],
  );
  return rows;
}

export async function getStatusByCode(
  tenantId: string,
  entity: StatusEntity,
  code: string,
): Promise<StatusRow | null> {
  const { rows } = await q<StatusRow>(
    `SELECT id, tenant_id, entity, code, display_name, sort_order, is_terminal, is_locking, active
     FROM repair.statuses
     WHERE tenant_id = $1 AND entity = $2 AND code = $3 AND deleted_at IS NULL
     LIMIT 1`,
    [tenantId, entity, code],
  );
  return rows[0] ?? null;
}

export async function listTransitions(
  tenantId: string,
  entity: StatusEntity,
): Promise<StatusTransitionRow[]> {
  const { rows } = await q(
    `SELECT id, tenant_id, entity, from_status_id, to_status_id, action_name,
            allowed_actors, requires, active
     FROM repair.status_transitions
     WHERE tenant_id = $1 AND entity = $2 AND deleted_at IS NULL AND active = true`,
    [tenantId, entity],
  );
  return rows.map((t) => ({
    ...(t as StatusTransitionRow),
    allowed_actors: Array.isArray(t.allowed_actors)
      ? (t.allowed_actors as string[])
      : [],
    requires: Array.isArray(t.requires) ? (t.requires as string[]) : [],
  }));
}

export type TransitionCheck =
  | { ok: true; transition: StatusTransitionRow }
  | { ok: false; reason: string };

export async function assertTransitionAllowed(opts: {
  tenantId: string;
  entity: StatusEntity;
  fromStatusId: string;
  toStatusId: string;
  actor: string;
}): Promise<TransitionCheck> {
  const { rows } = await q(
    `SELECT id, tenant_id, entity, from_status_id, to_status_id, action_name,
            allowed_actors, requires, active
     FROM repair.status_transitions
     WHERE tenant_id = $1 AND entity = $2
       AND from_status_id = $3 AND to_status_id = $4
       AND active = true AND deleted_at IS NULL
     LIMIT 1`,
    [opts.tenantId, opts.entity, opts.fromStatusId, opts.toStatusId],
  );
  if (!rows[0]) {
    return { ok: false, reason: "Transition is not defined for this tenant." };
  }
  const transition = rows[0] as StatusTransitionRow;
  const actors = Array.isArray(transition.allowed_actors)
    ? transition.allowed_actors
    : [];
  if (actors.length > 0 && !actors.includes(opts.actor)) {
    return {
      ok: false,
      reason: `Actor "${opts.actor}" is not allowed for action "${transition.action_name}".`,
    };
  }
  return {
    ok: true,
    transition: { ...transition, allowed_actors: actors },
  };
}
