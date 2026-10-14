/**
 * Bad Order Reasons (owner-managed).
 * Name + optional short name + active + sort order.
 * Optional rule-based flag with Rule 1 / Rule 107 / Other.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";

export type EventRuleCode = "RULE_1" | "RULE_107" | "OTHER";

export type BoRule = {
  id: string;
  code: string;
  short_name: string | null;
  description: string;
  event_rule: EventRuleCode;
  is_rule_based: boolean;
  requires_other_text: boolean;
  /** Rule-based reasons may accept optional keyed detail. */
  allows_additional_detail: boolean;
  active: boolean;
  sort_order: number;
};

function mapEventRule(v: unknown): EventRuleCode {
  if (v === "RULE_107") return "RULE_107";
  if (v === "OTHER") return "OTHER";
  return "RULE_1";
}

function mapBoRule(row: Record<string, unknown>): BoRule {
  return {
    id: String(row.id),
    code: String(row.code),
    short_name: row.short_name != null ? String(row.short_name) : null,
    description: String(row.description),
    event_rule: mapEventRule(row.event_rule),
    is_rule_based: Boolean(row.is_rule_based),
    requires_other_text: Boolean(row.requires_other_text),
    allows_additional_detail:
      row.allows_additional_detail == null
        ? true
        : Boolean(row.allows_additional_detail),
    active: Boolean(row.active),
    sort_order: Number(row.sort_order ?? 0),
  };
}

function slugCode(raw: string): string {
  const s = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return s || `REASON_${Date.now().toString(36).toUpperCase()}`;
}

export async function listBoRules(opts?: {
  tenantId?: string;
  activeOnly?: boolean;
}): Promise<BoRule[]> {
  const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
  const activeOnly = opts?.activeOnly !== false;
  const { rows } = await q(
    `SELECT id, code, short_name, description, event_rule,
            COALESCE(is_rule_based, false) AS is_rule_based,
            requires_other_text,
            COALESCE(allows_additional_detail, true) AS allows_additional_detail,
            active, sort_order
     FROM repair.bo_rules
     WHERE tenant_id = $1 AND deleted_at IS NULL
       AND ($2::boolean IS FALSE OR active)
     ORDER BY sort_order, description, code`,
    [tenantId, activeOnly],
  );
  return rows.map((r) => mapBoRule(r as Record<string, unknown>));
}

export async function getBoRuleByCode(
  code: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<BoRule | null> {
  const { rows } = await q(
    `SELECT id, code, short_name, description, event_rule,
            COALESCE(is_rule_based, false) AS is_rule_based,
            requires_other_text,
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
  /** Internal code; optional — derived from shortName or description when omitted. */
  code?: string;
  shortName?: string | null;
  description: string;
  eventRule?: EventRuleCode;
  isRuleBased?: boolean;
  requiresOtherText?: boolean;
  allowsAdditionalDetail?: boolean;
  sortOrder?: number;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (!opts.description.trim()) {
    return { ok: false as const, status: 400, error: "name required" };
  }
  const shortName = (opts.shortName ?? "").trim() || null;
  const code = slugCode(opts.code || shortName || opts.description);
  const isRuleBased = Boolean(opts.isRuleBased);
  const eventRule: EventRuleCode = isRuleBased
    ? mapEventRule(opts.eventRule)
    : "RULE_1";
  const requiresOther =
    opts.requiresOtherText != null
      ? Boolean(opts.requiresOtherText)
      : eventRule === "OTHER" || code === "OTHER";
  try {
    const { rows } = await q(
      `INSERT INTO repair.bo_rules
         (tenant_id, code, short_name, description, event_rule, is_rule_based,
          requires_other_text, allows_additional_detail, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        tenantId,
        code,
        shortName,
        opts.description.trim(),
        eventRule,
        isRuleBased,
        requiresOther,
        opts.allowsAdditionalDetail !== false,
        opts.sortOrder ?? 100,
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
      return { ok: false as const, status: 409, error: `Reason ${code} already exists` };
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
  shortName?: string | null;
  active?: boolean;
  requiresOtherText?: boolean;
  allowsAdditionalDetail?: boolean;
  isRuleBased?: boolean;
  eventRule?: EventRuleCode;
  sortOrder?: number;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `UPDATE repair.bo_rules
     SET description = COALESCE($1, description),
         short_name = CASE WHEN $2::boolean THEN $3 ELSE short_name END,
         active = COALESCE($4, active),
         requires_other_text = COALESCE($5, requires_other_text),
         allows_additional_detail = COALESCE($6, allows_additional_detail),
         sort_order = COALESCE($7, sort_order),
         is_rule_based = COALESCE($8, is_rule_based),
         event_rule = COALESCE($9, event_rule)
     WHERE id = $10 AND tenant_id = $11 AND deleted_at IS NULL
     RETURNING *`,
    [
      opts.description?.trim() || null,
      opts.shortName !== undefined,
      opts.shortName === undefined
        ? null
        : opts.shortName?.trim() || null,
      opts.active ?? null,
      opts.requiresOtherText ?? null,
      opts.allowsAdditionalDetail ?? null,
      opts.sortOrder ?? null,
      opts.isRuleBased ?? null,
      opts.eventRule != null ? mapEventRule(opts.eventRule) : null,
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
    return { ok: false, status: 400, error: `Unknown or inactive Bad Order Reason: ${code}` };
  }
  const otherText = (opts.otherText ?? "").trim();
  if (rule.requires_other_text && !otherText) {
    return { ok: false, status: 400, error: "This Bad Order Reason requires keyed detail" };
  }
  // Track behavior: only RULE_107 opens two tracks; OTHER / non-rule-based → RULE_1
  const eventRule: "RULE_1" | "RULE_107" =
    rule.is_rule_based && rule.event_rule === "RULE_107" ? "RULE_107" : "RULE_1";
  return {
    ok: true,
    code: rule.code,
    eventRule,
    otherText: otherText || null,
    description: rule.description,
  };
}
