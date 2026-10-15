/**
 * Component Id required rules — admin-editable.
 * Rejects finals/invoices missing required Component Id (per-line).
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";

export type ComponentIdRule = {
  id: string;
  job_code: string | null;
  qualifier: string | null;
  job_code_prefix: string | null;
  label: string | null;
  require_on: string;
  active: boolean;
  notes: string | null;
};

export type ComponentIdLineError = {
  lineNo: number;
  lineId?: string;
  jobCode: string | null;
  qualifier: string | null;
  componentId: string | null;
  ruleLabel: string | null;
  message: string;
};

function ruleMatches(
  rule: ComponentIdRule,
  job: string,
  qual: string,
): boolean {
  if (rule.job_code && rule.job_code.trim() === job) {
    if (rule.qualifier && rule.qualifier.trim() && rule.qualifier.trim() !== qual) {
      return false;
    }
    return true;
  }
  if (rule.job_code_prefix) {
    const p = rule.job_code_prefix.trim();
    if (p && job.startsWith(p)) return true;
  }
  return false;
}

function appliesToStage(requireOn: string, stage: "FINAL" | "INVOICE" | "REVIEW"): boolean {
  const r = (requireOn || "FINAL_OR_INVOICE").toUpperCase();
  if (r === "ALWAYS") return true;
  if (stage === "REVIEW") return r === "ALWAYS" || r === "FINAL_OR_INVOICE" || r === "FINAL";
  if (stage === "FINAL") return r === "FINAL" || r === "FINAL_OR_INVOICE" || r === "ALWAYS";
  if (stage === "INVOICE") return r === "INVOICE" || r === "FINAL_OR_INVOICE" || r === "ALWAYS";
  return false;
}

export async function listComponentIdRules(tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q<ComponentIdRule>(
    `SELECT id, job_code, qualifier, job_code_prefix, label, require_on, active, notes
     FROM repair.component_id_rules
     WHERE tenant_id = $1 AND deleted_at IS NULL
     ORDER BY COALESCE(job_code, job_code_prefix, label)`,
    [tenantId],
  );
  return rows;
}

export async function upsertComponentIdRule(opts: {
  id?: string;
  jobCode?: string | null;
  qualifier?: string | null;
  jobCodePrefix?: string | null;
  label?: string | null;
  requireOn?: string;
  active?: boolean;
  notes?: string | null;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (opts.id) {
    const { rows } = await q(
      `UPDATE repair.component_id_rules SET
         job_code = $2, qualifier = $3, job_code_prefix = $4, label = $5,
         require_on = COALESCE($6, require_on), active = COALESCE($7, active),
         notes = $8, updated_at = now(), updated_by = $9
       WHERE id = $1 AND tenant_id = $10 AND deleted_at IS NULL
       RETURNING *`,
      [
        opts.id,
        opts.jobCode ?? null,
        opts.qualifier ?? null,
        opts.jobCodePrefix ?? null,
        opts.label ?? null,
        opts.requireOn ?? null,
        opts.active ?? null,
        opts.notes ?? null,
        opts.actor,
        tenantId,
      ],
    );
    if (!rows[0]) return { ok: false as const, status: 404, error: "Rule not found" };
    await writeAudit({
      tenantId,
      entity: "component_id_rule",
      entityId: String(rows[0].id),
      action: "COMPONENT_ID_RULE_UPDATED",
      after: rows[0],
      actor: opts.actor,
      via: "UI",
    });
    return { ok: true as const, rule: rows[0] };
  }
  const { rows } = await q(
    `INSERT INTO repair.component_id_rules
       (tenant_id, job_code, qualifier, job_code_prefix, label, require_on, active, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'FINAL_OR_INVOICE'),COALESCE($7,true),$8,$9)
     RETURNING *`,
    [
      tenantId,
      opts.jobCode ?? null,
      opts.qualifier ?? null,
      opts.jobCodePrefix ?? null,
      opts.label ?? null,
      opts.requireOn ?? "FINAL_OR_INVOICE",
      opts.active ?? true,
      opts.notes ?? null,
      opts.actor,
    ],
  );
  await writeAudit({
    tenantId,
    entity: "component_id_rule",
    entityId: String(rows[0].id),
    action: "COMPONENT_ID_RULE_CREATED",
    after: rows[0],
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, rule: rows[0] };
}

export async function softDeleteComponentIdRule(opts: {
  id: string;
  actor: string;
  reason: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const reason = opts.reason.trim();
  if (!reason) return { ok: false as const, status: 400, error: "Reason required" };
  const { rows } = await q(
    `UPDATE repair.component_id_rules
     SET deleted_at = now(), deleted_by = $1, delete_reason = $2, active = false
     WHERE id = $3 AND tenant_id = $4 AND deleted_at IS NULL
     RETURNING *`,
    [opts.actor, reason, opts.id, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Rule not found" };
  await writeAudit({
    tenantId,
    entity: "component_id_rule",
    entityId: opts.id,
    action: "COMPONENT_ID_RULE_DELETED",
    after: { reason },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, rule: rows[0] };
}

/** Validate lines against active rules for a stage. */
export async function validateComponentIds(opts: {
  lines: Array<{
    id?: string;
    line_no?: number;
    aar_job_code?: string | null;
    qualifier?: string | null;
    aar_component_id?: string | null;
  }>;
  stage: "FINAL" | "INVOICE" | "REVIEW";
  tenantId?: string;
}): Promise<{ ok: boolean; errors: ComponentIdLineError[]; flaggedLineNos: number[] }> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const rules = (await listComponentIdRules(tenantId)).filter((r) => r.active);
  const errors: ComponentIdLineError[] = [];
  const flagged = new Set<number>();

  for (const line of opts.lines) {
    const job = String(line.aar_job_code ?? "").trim();
    const qual = String(line.qualifier ?? "").trim();
    const cid = String(line.aar_component_id ?? "").trim();
    const lineNo = Number(line.line_no ?? 0);
    for (const rule of rules) {
      if (!appliesToStage(rule.require_on, opts.stage)) continue;
      if (!ruleMatches(rule, job, qual)) continue;
      if (!cid) {
        errors.push({
          lineNo,
          lineId: line.id,
          jobCode: job || null,
          qualifier: qual || null,
          componentId: null,
          ruleLabel: rule.label,
          message: `Line ${lineNo}: Component Id required for job ${job}${
            rule.label ? ` (${rule.label})` : ""
          }`,
        });
        if (lineNo) flagged.add(lineNo);
      }
      break;
    }
  }

  return { ok: errors.length === 0, errors, flaggedLineNos: [...flagged] };
}
