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
  active: boolean;
  sort_order: number;
};

export async function listBoRules(opts?: {
  tenantId?: string;
  activeOnly?: boolean;
}): Promise<BoRule[]> {
  const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
  const activeOnly = opts?.activeOnly !== false;
  const { rows } = await q(
    `SELECT id, code, description, event_rule, requires_other_text, active, sort_order
     FROM repair.bo_rules
     WHERE tenant_id = $1 AND deleted_at IS NULL
       AND ($2::boolean IS FALSE OR active)
     ORDER BY sort_order, code`,
    [tenantId, activeOnly],
  );
  return rows as BoRule[];
}

export async function getBoRuleByCode(
  code: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<BoRule | null> {
  const { rows } = await q(
    `SELECT id, code, description, event_rule, requires_other_text, active, sort_order
     FROM repair.bo_rules
     WHERE tenant_id = $1 AND code = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [tenantId, code.trim().toUpperCase()],
  );
  return (rows[0] as BoRule) ?? null;
}

export async function createBoRule(opts: {
  code: string;
  description: string;
  eventRule?: "RULE_1" | "RULE_107";
  requiresOtherText?: boolean;
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
         (tenant_id, code, description, event_rule, requires_other_text, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        tenantId,
        code,
        opts.description.trim(),
        opts.eventRule === "RULE_107" ? "RULE_107" : "RULE_1",
        Boolean(opts.requiresOtherText),
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
    return { ok: true as const, rule: rows[0] as BoRule };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return { ok: false as const, status: 409, error: `Rule code ${code} already exists` };
    }
    throw err;
  }
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
