/**
 * Deal calculator persistence.
 * User edits go through withChangeGroupResult + recordChange.
 * Undo of a deal-calc-only change group is rlms_undo_deal_calc_group, one
 * transaction in the database. The four frozen rlms_ undo functions are not
 * called or replaced.
 */

import { changeCaptureRow } from "@shared/crm";
import {
  applyPriceFieldName,
  applyPriceRefusal,
  calculatedScenario,
  inputsIgnoringClientResults,
  parseApplyPriceChoice,
  presentScenarioList,
  priceForWhich,
  type ApplyPriceField,
  type ApplyPriceWhich,
} from "@shared/dealCalcApi";
import { buildInputsFromLine, companyDefaultInputs, type DealCalcInputs, type LineSeed } from "@shared/dealCalc";
import { planPin, planSoftDelete, type ScenarioSlot } from "@shared/dealCalcUndo";
import { recordChange, withChangeGroupResult } from "./change-log";
import { CrmHttpError } from "./crm-error";
import { saveOpportunityLines } from "./crm-bid-lines";
import { supabaseAdmin } from "./supabase";

const SCENARIO_TABLE = "deal_calc_scenarios";
const SET_TABLE = "deal_calc_assumption_sets";

function httpError(status: number, message: string): CrmHttpError {
  return new CrmHttpError(status, message);
}

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

async function requireOpportunity(id: number): Promise<Record<string, unknown>> {
  if (!Number.isFinite(id) || id <= 0) throw httpError(400, "Invalid opportunity");
  const { data, error } = await supabaseAdmin.from("opportunities").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "Opportunity not found");
  return data as Record<string, unknown>;
}

async function loadScenario(opportunityId: number, scenarioId: number): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin
    .from(SCENARIO_TABLE)
    .select("*")
    .eq("id", scenarioId)
    .eq("opportunity_id", opportunityId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "Scenario not found");
  return data as Record<string, unknown>;
}

function asSlot(row: Record<string, unknown>): ScenarioSlot {
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    lineId: row.opportunity_line_id == null ? null : Number(row.opportunity_line_id),
    isPinned: row.is_pinned === true,
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
  };
}

async function slotsFor(opportunityId: number): Promise<ScenarioSlot[]> {
  const { data, error } = await supabaseAdmin
    .from(SCENARIO_TABLE)
    .select("id, opportunity_id, opportunity_line_id, is_pinned, deleted_at")
    .eq("opportunity_id", opportunityId);
  if (error) throw error;
  return (data ?? []).map((row) => asSlot(row as Record<string, unknown>));
}

async function companyInputs(): Promise<DealCalcInputs> {
  const { data, error } = await supabaseAdmin
    .from(SET_TABLE)
    .select("inputs")
    .eq("is_default", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data?.inputs) return companyDefaultInputs();
  return calculatedScenario(data.inputs).inputs;
}

function scenarioInsert(
  opportunityId: number,
  body: Record<string, unknown>,
  actor: string,
  inputs: DealCalcInputs,
  lineId: number | null,
): Record<string, unknown> {
  const calculated = calculatedScenario(inputs);
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Scenario";
  return {
    opportunity_id: opportunityId,
    opportunity_line_id: lineId,
    assumption_set_id: positiveInt(body.assumption_set_id),
    name,
    deal_type: calculated.columns.deal_type,
    method: calculated.columns.method,
    post_lease_plan: calculated.columns.post_lease_plan,
    calc_version: calculated.columns.calc_version,
    inputs: calculated.inputs,
    results: calculated.result,
    verdict: calculated.columns.verdict,
    target_irr: calculated.columns.target_irr,
    stretch_irr: calculated.columns.stretch_irr,
    max_bid_per_car: calculated.columns.max_bid_per_car,
    wayne_bid_per_car: calculated.columns.wayne_bid_per_car,
    irr: calculated.columns.irr,
    npv: calculated.columns.npv,
    is_pinned: false,
    notes: body.notes == null ? null : String(body.notes),
    created_by: actor,
  };
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asLineSeed(row: Record<string, unknown>): LineSeed {
  return {
    car_count: numOrNull(row.car_count),
    car_type: row.car_type == null ? null : String(row.car_type),
    aar_code: row.aar_code == null ? null : String(row.aar_code),
    avg_build_year: numOrNull(row.avg_build_year),
    lease_rate: numOrNull(row.lease_rate),
    lease_expiry: row.lease_expiry == null ? null : String(row.lease_expiry).slice(0, 10),
    lessee_rating: row.lessee_rating == null ? null : String(row.lessee_rating),
    prelim_price_per_car: numOrNull(row.prelim_price_per_car),
    final_price_per_car: numOrNull(row.final_price_per_car),
  };
}

async function lineSeed(lineId: number, opportunityId: number): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin
    .from("opportunity_lines")
    .select("*")
    .eq("id", lineId)
    .eq("opportunity_id", opportunityId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

export async function listScenarios(opportunityId: number, canSeeNumbers: boolean) {
  await requireOpportunity(opportunityId);
  const { data, error } = await supabaseAdmin
    .from(SCENARIO_TABLE)
    .select("*")
    .eq("opportunity_id", opportunityId)
    .is("deleted_at", null)
    .order("is_pinned", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return presentScenarioList((data ?? []) as Record<string, unknown>[], canSeeNumbers);
}

export async function getScenario(opportunityId: number, scenarioId: number) {
  const row = await loadScenario(opportunityId, scenarioId);
  if (row.deleted_at) throw httpError(404, "Scenario not found");
  return { scenario: row };
}

export async function createScenario(opportunityId: number, body: Record<string, unknown>, actor: string) {
  const opportunity = await requireOpportunity(opportunityId);
  const lineId = positiveInt(body.opportunity_line_id);
  const line = lineId ? await lineSeed(lineId, opportunityId) : null;
  if (lineId && !line) throw httpError(404, "Line not found");
  const rawInputs = inputsIgnoringClientResults(body);
  const inputs = rawInputs == null
    ? buildInputsFromLine({
      opportunity: {
        flavor: opportunity.flavor == null ? null : String(opportunity.flavor),
        type: opportunity.type == null ? null : String(opportunity.type),
        expected_close: opportunity.expected_close == null ? null : String(opportunity.expected_close),
      },
      line: line ? asLineSeed(line) : null,
      company: await companyInputs(),
    })
    : calculatedScenario(rawInputs).inputs;
  const insert = scenarioInsert(opportunityId, body, actor, inputs, lineId);
  return withChangeGroupResult(actor, async () => {
    const { data, error } = await supabaseAdmin.from(SCENARIO_TABLE).insert(insert).select("*").single();
    if (error) throw error;
    const row = data as Record<string, unknown>;
    await recordChange({
      table: SCENARIO_TABLE,
      pk: Number(row.id),
      before: {},
      after: changeCaptureRow(row),
      action: "create_deal_calc_scenario",
      entity_type: "deal_calc_scenario",
      entity_id: Number(row.id),
      actor,
      detail: { opportunity_id: opportunityId },
    });
    return { scenario: row };
  });
}

export async function updateScenario(
  opportunityId: number,
  scenarioId: number,
  body: Record<string, unknown>,
  actor: string,
) {
  const before = await loadScenario(opportunityId, scenarioId);
  if (before.deleted_at) throw httpError(404, "Scenario not found");
  const rawInputs = inputsIgnoringClientResults(body);
  const inputs = rawInputs == null ? calculatedScenario(before.inputs).inputs : calculatedScenario(rawInputs).inputs;
  const next = scenarioInsert(opportunityId, { ...before, ...body, name: body.name ?? before.name }, actor, inputs, positiveInt(body.opportunity_line_id ?? before.opportunity_line_id));
  delete next.is_pinned;
  delete next.created_by;
  if (!("notes" in body)) next.notes = before.notes;
  if (!("assumption_set_id" in body)) next.assumption_set_id = before.assumption_set_id;
  return withChangeGroupResult(actor, async () => {
    const { data, error } = await supabaseAdmin.from(SCENARIO_TABLE).update(next).eq("id", scenarioId).select("*").single();
    if (error) throw error;
    const row = data as Record<string, unknown>;
    await recordChange({
      table: SCENARIO_TABLE,
      pk: scenarioId,
      before: changeCaptureRow(before),
      after: changeCaptureRow(row),
      action: "update_deal_calc_scenario",
      entity_type: "deal_calc_scenario",
      entity_id: scenarioId,
      actor,
      detail: { opportunity_id: opportunityId },
    });
    return { scenario: row };
  });
}

async function applySlotPatch(scenarioId: number, patch: { isPinned?: boolean; deletedAt?: string | null }, actor: string, action: string) {
  const { data: before, error } = await supabaseAdmin.from(SCENARIO_TABLE).select("*").eq("id", scenarioId).single();
  if (error) throw error;
  const update: Record<string, unknown> = {};
  if (patch.isPinned !== undefined) update.is_pinned = patch.isPinned;
  if (patch.deletedAt !== undefined) update.deleted_at = patch.deletedAt;
  const { data, error: updErr } = await supabaseAdmin.from(SCENARIO_TABLE).update(update).eq("id", scenarioId).select("*").single();
  if (updErr) throw updErr;
  await recordChange({
    table: SCENARIO_TABLE,
    pk: scenarioId,
    before: changeCaptureRow(before as Record<string, unknown>),
    after: changeCaptureRow(data as Record<string, unknown>),
    action,
    entity_type: "deal_calc_scenario",
    entity_id: scenarioId,
    actor,
    detail: { opportunity_id: (before as Record<string, unknown>).opportunity_id },
  });
}

export async function deleteScenario(opportunityId: number, scenarioId: number, actor: string) {
  const row = await loadScenario(opportunityId, scenarioId);
  if (row.deleted_at) throw httpError(404, "Scenario not found");
  const deletedAt = new Date().toISOString();
  const patches = planSoftDelete(asSlot(row), deletedAt, 1);
  return withChangeGroupResult(actor, async () => {
    for (const patch of patches) {
      await applySlotPatch(scenarioId, patch.after, actor, patch.after.deletedAt ? "delete_deal_calc_scenario" : "unpin_deal_calc_scenario");
    }
    return { id: scenarioId, deleted_at: deletedAt };
  });
}

export async function pinScenario(opportunityId: number, scenarioId: number, actor: string) {
  const slots = await slotsFor(opportunityId);
  const target = slots.find((slot) => slot.id === scenarioId);
  if (!target || target.deletedAt) throw httpError(404, "Scenario not found");
  let patches;
  try {
    patches = planPin(slots, scenarioId, 1);
  } catch (err) {
    throw httpError(409, err instanceof Error ? err.message : "Cannot pin scenario");
  }
  return withChangeGroupResult(actor, async () => {
    for (const patch of patches) {
      await applySlotPatch(
        patch.rowId,
        patch.after,
        actor,
        patch.after.isPinned ? "pin_deal_calc_scenario" : "unpin_deal_calc_scenario",
      );
    }
    return getScenario(opportunityId, scenarioId);
  });
}

export async function applyScenarioPrice(
  opportunityId: number,
  scenarioId: number,
  body: { field?: unknown; which?: unknown },
  actor: string,
) {
  const choice = parseApplyPriceChoice(body);
  if (!choice) throw httpError(400, "field must be prelim or final and which must be max, stretch, or wayne");
  const scenario = await loadScenario(opportunityId, scenarioId);
  if (scenario.deleted_at) throw httpError(404, "Scenario not found");
  const calculated = calculatedScenario(scenario.inputs);
  const price = priceForWhich(calculated.result, choice.which);
  const lineId = scenario.opportunity_line_id == null ? null : Number(scenario.opportunity_line_id);
  const opportunity = await requireOpportunity(opportunityId);
  const { data: line, error } = lineId
    ? await supabaseAdmin.from("opportunity_lines").select("*").eq("id", lineId).eq("opportunity_id", opportunityId).maybeSingle()
    : { data: null, error: null };
  if (error) throw error;
  const refusal = applyPriceRefusal({
    scenarioLineId: lineId,
    line: line ? { deleted_at: line.deleted_at == null ? null : String(line.deleted_at), outcome: line.outcome == null ? null : String(line.outcome) } : null,
    opportunityStage: opportunity.stage == null ? null : String(opportunity.stage),
    opportunityOutcome: opportunity.outcome == null ? null : String(opportunity.outcome),
    price,
  });
  if (refusal) throw httpError(refusal.status, refusal.message);
  const field = applyPriceFieldName(choice.field);
  const saved = await saveOpportunityLines(opportunityId, { lines: [{ ...(line as Record<string, unknown>), [field]: price }] }, actor);
  return { ...saved, field, which: choice.which, price };
}

export async function getCompanyDefault() {
  const { data, error } = await supabaseAdmin
    .from(SET_TABLE)
    .select("*")
    .eq("is_default", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "Company default not found");
  return { assumption_set: data };
}

export async function patchAssumptionSet(id: number, body: Record<string, unknown>, actor: string) {
  if (!Number.isFinite(id) || id <= 0) throw httpError(400, "Invalid assumption set");
  const { data: before, error } = await supabaseAdmin.from(SET_TABLE).select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  if (!before) throw httpError(404, "Assumption set not found");
  const update: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
  if (body.inputs != null) update.inputs = calculatedScenario(body.inputs).inputs;
  if (body.is_default === true) update.is_default = true;
  if (body.is_default === false) update.is_default = false;
  if (!Object.keys(update).length) throw httpError(400, "Nothing to update");
  return withChangeGroupResult(actor, async () => {
    if (update.is_default === true) {
      const { data: current, error: curErr } = await supabaseAdmin
        .from(SET_TABLE)
        .select("*")
        .eq("is_default", true)
        .is("deleted_at", null);
      if (curErr) throw curErr;
      for (const row of current ?? []) {
        if (Number(row.id) === id) continue;
        const { data, error: updErr } = await supabaseAdmin.from(SET_TABLE).update({ is_default: false }).eq("id", row.id).select("*").single();
        if (updErr) throw updErr;
        await recordChange({
          table: SET_TABLE,
          pk: Number(row.id),
          before: changeCaptureRow(row as Record<string, unknown>),
          after: changeCaptureRow(data as Record<string, unknown>),
          action: "update_deal_calc_assumption_set",
          entity_type: "deal_calc_assumption_set",
          entity_id: Number(row.id),
          actor,
        });
      }
    }
    const { data, error: updErr } = await supabaseAdmin.from(SET_TABLE).update(update).eq("id", id).select("*").single();
    if (updErr) throw updErr;
    await recordChange({
      table: SET_TABLE,
      pk: id,
      before: changeCaptureRow(before as Record<string, unknown>),
      after: changeCaptureRow(data as Record<string, unknown>),
      action: "update_deal_calc_assumption_set",
      entity_type: "deal_calc_assumption_set",
      entity_id: id,
      actor,
    });
    return { assumption_set: data };
  });
}

export function isDealCalcOnlyGroup(rows: Array<{ table_name: string | null }>): boolean {
  return rows.length > 0 && rows.every((row) => row.table_name === SCENARIO_TABLE || row.table_name === SET_TABLE);
}

export type { ApplyPriceField, ApplyPriceWhich };
