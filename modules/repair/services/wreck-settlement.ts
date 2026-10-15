/**
 * Owner-only Rule 107 settlement gauge + 5399 prompt.
 * Never expose to shop token or lessee token APIs.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { getRule107Calculator } from "../providers/rule107-calculator";

export type SettlementGauge = {
  resp3TotalCents: number;
  depreciatedValueCents: number | null;
  salvageCents: number | null;
  settlementCapCents: number | null;
  overDv: boolean;
  warn: boolean;
  message: string;
  require5399: boolean;
  note5399: string;
};

export async function computeSettlementGauge(opts: {
  wreckEventId: string;
  tenantId?: string;
}): Promise<SettlementGauge | null> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT w.*, sc.depreciated_value_cents, sc.salvage_cents, sc.settlement_cap_cents
     FROM repair.wreck_events w
     LEFT JOIN repair.wreck_settlement_calcs sc ON sc.id = w.settlement_calc_id
     WHERE w.id = $1 AND w.tenant_id = $2 AND w.deleted_at IS NULL`,
    [opts.wreckEventId, tenantId],
  );
  if (!rows[0]) return null;
  const w = rows[0];

  let resp3TotalCents = 0;
  if (w.wreck_estimate_id) {
    const { rows: rev } = await q<{ labor_cents: string; material_cents: string }>(
      `SELECT COALESCE(SUM(labor_cents),0)::text AS labor_cents,
              COALESCE(SUM(material_cents),0)::text AS material_cents
       FROM repair.estimate_lines el
       JOIN repair.estimate_revisions er ON er.id = el.revision_id
       JOIN repair.estimates e ON e.id = er.estimate_id
       WHERE e.id = $1 AND er.rev_no = e.current_revision`,
      [w.wreck_estimate_id],
    );
    if (rev[0]) {
      resp3TotalCents =
        Number(rev[0].labor_cents) + Number(rev[0].material_cents);
    }
  }

  const dv =
    w.depreciated_value_cents != null
      ? Number(w.depreciated_value_cents)
      : w.ddct_actual_dv_cents != null
        ? Number(w.ddct_actual_dv_cents)
        : w.ddct_estimated_dv_cents != null
          ? Number(w.ddct_estimated_dv_cents)
          : null;

  const overDv = dv != null && resp3TotalCents >= dv;
  return {
    resp3TotalCents,
    depreciatedValueCents: dv,
    salvageCents: w.salvage_cents != null ? Number(w.salvage_cents) : null,
    settlementCapCents:
      w.settlement_cap_cents != null ? Number(w.settlement_cap_cents) : dv,
    overDv,
    warn: overDv,
    message: overDv
      ? "Resp 3 at or over depreciated value — owner warning/flag only; owner decides settle vs repair (no auto-reject)"
      : "Resp 3 under depreciated value / settlement cap",
    require5399: overDv,
    note5399:
      "If repair continues at/above settlement cap, require JC 5399 credit (negative material, detail source DC/JI/JD, no labor — OM 102.D.7 / 107.I.3)",
  };
}

export async function saveSettlementCalc(opts: {
  wreckEventId: string;
  tenantId?: string;
  actor: string;
  originalCostCents?: number | null;
  reproductionCents?: number | null;
  depreciatedValueCents?: number | null;
  salvageCents?: number | null;
  settlementBasis?: string | null;
  settlementCapCents?: number | null;
  exhibitEdition?: string | null;
  overrideReason?: string | null;
  inputsJson?: Record<string, unknown>;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const provider = await getRule107Calculator().calculate({
    wreckEventId: opts.wreckEventId,
    inputs: { originalCostCents: opts.originalCostCents ?? null },
  });

  const gaugePreview = {
    depreciatedValueCents: opts.depreciatedValueCents ?? null,
    originalCostCents: opts.originalCostCents ?? null,
  };

  const overDv =
    opts.depreciatedValueCents != null &&
    opts.settlementCapCents != null &&
    opts.settlementCapCents >= opts.depreciatedValueCents;

  const { rows: existing } = await q(
    `SELECT settlement_calc_id FROM repair.wreck_events
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [opts.wreckEventId, tenantId],
  );
  if (!existing[0]) {
    return { ok: false as const, status: 404, error: "Wreck event not found" };
  }

  let calcId = existing[0].settlement_calc_id
    ? String(existing[0].settlement_calc_id)
    : null;

  if (calcId) {
    await q(
      `UPDATE repair.wreck_settlement_calcs
       SET exhibit_edition = COALESCE($2, exhibit_edition),
           original_cost_cents = $3,
           reproduction_cents = $4,
           depreciated_value_cents = $5,
           salvage_cents = $6,
           settlement_basis = $7,
           settlement_cap_cents = $8,
           over_dv = $9,
           inputs_json = $10::jsonb,
           outputs_json = $11::jsonb,
           override_reason = $12,
           updated_at = now(),
           updated_by = $13
       WHERE id = $1`,
      [
        calcId,
        opts.exhibitEdition ?? null,
        opts.originalCostCents ?? null,
        opts.reproductionCents ?? null,
        opts.depreciatedValueCents ?? null,
        opts.salvageCents ?? null,
        opts.settlementBasis ?? null,
        opts.settlementCapCents ?? null,
        overDv,
        JSON.stringify(opts.inputsJson ?? gaugePreview),
        JSON.stringify({ provider }),
        opts.overrideReason ?? null,
        opts.actor,
      ],
    );
  } else {
    const ins = await q(
      `INSERT INTO repair.wreck_settlement_calcs
         (tenant_id, wreck_event_id, exhibit_edition, original_cost_cents,
          reproduction_cents, depreciated_value_cents, salvage_cents,
          settlement_basis, settlement_cap_cents, over_dv,
          inputs_json, outputs_json, override_reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14)
       RETURNING id`,
      [
        tenantId,
        opts.wreckEventId,
        opts.exhibitEdition ?? null,
        opts.originalCostCents ?? null,
        opts.reproductionCents ?? null,
        opts.depreciatedValueCents ?? null,
        opts.salvageCents ?? null,
        opts.settlementBasis ?? null,
        opts.settlementCapCents ?? null,
        overDv,
        JSON.stringify(opts.inputsJson ?? gaugePreview),
        JSON.stringify({ provider }),
        opts.overrideReason ?? null,
        opts.actor,
      ],
    );
    calcId = String(ins.rows[0].id);
    await q(
      `UPDATE repair.wreck_events
       SET settlement_calc_id = $1, updated_at = now(), updated_by = $3
       WHERE id = $2`,
      [calcId, opts.wreckEventId, opts.actor],
    );
  }

  // Persist optional cost on wreck event (inconsistent-tolerant blank)
  if (opts.originalCostCents !== undefined) {
    await q(
      `UPDATE repair.wreck_events
       SET original_cost_cents = $1, updated_at = now(), updated_by = $3
       WHERE id = $2`,
      [opts.originalCostCents, opts.wreckEventId, opts.actor],
    );
  }

  await writeAudit({
    tenantId,
    entity: "wreck_settlement_calc",
    entityId: calcId!,
    action: "WRECK_SETTLEMENT_SAVED",
    after: {
      depreciatedValueCents: opts.depreciatedValueCents,
      overrideReason: opts.overrideReason ?? null,
      providerWired: provider.wired,
    },
    actor: opts.actor,
    via: "UI",
  });

  const gauge = await computeSettlementGauge({
    wreckEventId: opts.wreckEventId,
    tenantId,
  });

  return { ok: true as const, settlementCalcId: calcId!, gauge, provider };
}

/** Strip owner-only DV fields from payloads destined for shop/lessee. */
export function omitOwnerDv<T extends Record<string, unknown>>(payload: T): T {
  const clone = { ...payload };
  delete clone.ownerDv;
  delete clone.settlement;
  delete clone.settlement_calc_id;
  delete clone.original_cost_cents;
  delete clone.ddct_estimated_dv_cents;
  delete clone.ddct_actual_dv_cents;
  delete clone.ab_items_json;
  return clone;
}
