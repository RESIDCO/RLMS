/**
 * Bad-order rule lookup (code + description + active).
 * Admins can add; seeded RULE_1 / RULE_107 / OTHER.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";

export type BoRule = {
  id: string;
  code: string;
  description: string;
  event_rule: "RULE_1" | "RULE_107";
  requires_other_text: boolean;
  /** Rule-based reasons may accept optional keyed detail. */
  allows_additional_detail: boolean;
  active: boolean;
  sort_order: number;
};

function mapBoRule(row: Record<string, unknown>): BoRule {
  return {
    id: String(row.id),
    code: String(row.code),
    description: String(row.description),
    event_rule: row.event_rule === "RULE_107" ? "RULE_107" : "RULE_1",
    requires_other_text: Boolean(row.requires_other_text),
    allows_additional_detail:
      row.allows_additional_detail == null
        ? true
        : Boolean(row.allows_additional_detail),
    active: Boolean(row.active),
    sort_order: Number(row.sort_order ?? 0),
  };
}

export async function listBoRules(opts?: {
  tenantId?: string;
  activeOnly?: boolean;
}): Promise<BoRule[]> {
  const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
  const activeOnly = opts?.activeOnly !== false;
  const { rows } = await q(
    `SELECT id, code, description, event_rule, requires_other_text,
            COALESCE(allows_additional_detail, true) AS allows_additional_detail,
            active, sort_order
     FROM repair.bo_rules
     WHERE tenant_id = $1 AND deleted_at IS NULL
       AND ($2::boolean IS FALSE OR active)
     ORDER BY sort_order, code`,
    [tenantId, activeOnly],
  );
  return rows.map((r) => mapBoRule(r as Record<string, unknown>));
}

export async function getBoRuleByCode(
  code: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<BoRule | null> {
  const { rows } = await q(
    `SELECT id, code, description, event_rule, requires_other_text,
            COALESCE(allows_additional_detail, true) AS allows_additional_detail,
            active, sort_order
     FROM repair.bo_rules
     WHERE tenant_id = $1 AND code = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [tenantId, code.trim().toUpperCase()],
  );
  return rows[0] ? mapBoRule(rows[0] as Record<string, unknown>) : null;
}

export async function createBoRule(opts: {
  code: string;
  description: string;
  eventRule?: "RULE_1" | "RULE_107";
  requiresOtherText?: boolean;
  allowsAdditionalDetail?: boolean;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const code = opts.code.trim().toUpperCase();
  if (!code) return { ok: false as const, status: 400, error: "code required" };
  if (!opts.description.trim()) {
    return { ok: false as const, status: 400, error: "description required" };
  }
  try {
    const { rows } = await q(
      `INSERT INTO repair.bo_rules
         (tenant_id, code, description, event_rule, requires_other_text,
          allows_additional_detail, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        tenantId,
        code,
        opts.description.trim(),
        opts.eventRule === "RULE_107" ? "RULE_107" : "RULE_1",
        Boolean(opts.requiresOtherText),
        opts.allowsAdditionalDetail !== false,
        opts.actor,
      ],
    );
    await writeAudit({
      tenantId,
      entity: "bo_rule",
      entityId: rows[0].id,
      action: "BO_RULE_CREATED",
      after: rows[0],
      actor: opts.actor,
      via: "UI",
    });
    return { ok: true as const, rule: mapBoRule(rows[0] as Record<string, unknown>) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return { ok: false as const, status: 409, error: `Reason code ${code} already exists` };
    }
    throw err;
  }
}

/** Soft-deactivate (never hard-delete) a Bad Order Reason — hides from dropdowns. */
export async function deactivateBoRule(opts: {
  id: string;
  actor: string;
  reason?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.bo_rules
     SET active = false
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [opts.id, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Reason not found" };
  await writeAudit({
    tenantId,
    entity: "bo_rule",
    entityId: opts.id,
    action: "BO_RULE_DEACTIVATED",
    after: { ...rows[0], reason: opts.reason ?? "deactivated" },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, rule: mapBoRule(rows[0] as Record<string, unknown>) };
}

export async function updateBoRule(opts: {
  id: string;
  description?: string;
  active?: boolean;
  requiresOtherText?: boolean;
  allowsAdditionalDetail?: boolean;
  sortOrder?: number;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.bo_rules
     SET description = COALESCE($1, description),
         active = COALESCE($2, active),
         requires_other_text = COALESCE($3, requires_other_text),
         allows_additional_detail = COALESCE($4, allows_additional_detail),
         sort_order = COALESCE($5, sort_order)
     WHERE id = $6 AND tenant_id = $7 AND deleted_at IS NULL
     RETURNING *`,
    [
      opts.description?.trim() || null,
      opts.active ?? null,
      opts.requiresOtherText ?? null,
      opts.allowsAdditionalDetail ?? null,
      opts.sortOrder ?? null,
      opts.id,
      tenantId,
    ],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Reason not found" };
  await writeAudit({
    tenantId,
    entity: "bo_rule",
    entityId: opts.id,
    action: "BO_RULE_UPDATED",
    after: rows[0],
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, rule: mapBoRule(rows[0] as Record<string, unknown>) };
}

export async function resolveBoRuleSelection(opts: {
  boRuleCode?: string;
  otherText?: string;
  /** Legacy fallback when only RULE_1 / RULE_107 passed */
  legacyRule?: string;
  tenantId?: string;
}): Promise<
  | {
      ok: true;
      code: string;
      eventRule: "RULE_1" | "RULE_107";
      otherText: string | null;
      description: string;
    }
  | { ok: false; status: number; error: string }
> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  let code = (opts.boRuleCode ?? opts.legacyRule ?? "RULE_1").trim().toUpperCase();
  if (code === "RULE1") code = "RULE_1";
  if (code === "RULE107") code = "RULE_107";

  const rule = await getBoRuleByCode(code, tenantId);
  if (!rule || !rule.active) {
    return { ok: false, status: 400, error: `Unknown or inactive BO rule: ${code}` };
  }
  const otherText = (opts.otherText ?? "").trim();
  if (rule.requires_other_text && !otherText) {
    return { ok: false, status: 400, error: "Other rule requires manual text" };
  }
  return {
    ok: true,
    code: rule.code,
    eventRule: rule.event_rule,
    otherText: otherText || null,
    description: rule.description,
  };
}
