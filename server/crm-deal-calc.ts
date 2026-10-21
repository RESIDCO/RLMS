/**
 * Deal calculator persistence.
 * User edits go through withChangeGroupResult + recordChange.
 * Undo of a deal-calc-only change group is rlms_undo_deal_calc_group, one
 * transaction in the database. Creating an opportunity from a calc is
 * rlms_create_opp_from_calc, one transaction for both linked groups.
 * The four frozen rlms_ undo functions are not called or replaced.
 */

import { randomUUID } from "node:crypto";
import { changeCaptureRow } from "@shared/crm";
import {
  applyPriceFieldName,
  applyPriceRefusal,
  calculatedScenario,
  inputsIgnoringClientResults,
  parseApplyPriceChoice,
  presentCreateFromCalc,
  presentScenarioList,
  presentStandaloneScenarioList,
  priceForWhich,
  scenarioWriteRefusal,
  stripScenarioPrices,
  type ApplyPriceField,
  type ApplyPriceWhich,
} from "@shared/dealCalcApi";
import {
  applyAssumptionSetCosts,
  buildInputsFromLine,
  companyDefaultInputs,
  DEAL_TYPES,
  type DealCalcInputs,
  type DealType,
  type LineSeed,
} from "@shared/dealCalc";
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
    opportunityId: row.opportunity_id == null ? null : Number(row.opportunity_id),
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
  opportunityId: number | null,
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
  const line = await loadLineAny(lineId, opportunityId);
  if (!line || line.deleted_at != null) return null;
  return line;
}

async function loadLineAny(lineId: number, opportunityId: number): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin
    .from("opportunity_lines")
    .select("*")
    .eq("id", lineId)
    .eq("opportunity_id", opportunityId)
    .maybeSingle();
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

function assertWritable(opportunity: Record<string, unknown>, line: Record<string, unknown> | null): void {
  const refusal = scenarioWriteRefusal({
    opportunityStage: opportunity.stage == null ? null : String(opportunity.stage),
    opportunityOutcome: opportunity.outcome == null ? null : String(opportunity.outcome),
    lineOutcome: line?.outcome == null ? null : String(line.outcome),
    lineDeleted: line?.deleted_at != null,
  });
  if (refusal) throw httpError(refusal.status, refusal.message);
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
  const lineRow = lineId ? await loadLineAny(lineId, opportunityId) : null;
  if (lineId && !lineRow) throw httpError(404, "Line not found");
  assertWritable(opportunity, lineRow);
  const line = lineRow && lineRow.deleted_at == null ? lineRow : null;
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
  const opportunity = await requireOpportunity(opportunityId);
  const lineIdForGuard = positiveInt(body.opportunity_line_id ?? before.opportunity_line_id);
  const lineRow = lineIdForGuard ? await loadLineAny(lineIdForGuard, opportunityId) : null;
  if (lineIdForGuard && !lineRow) throw httpError(404, "Line not found");
  assertWritable(opportunity, lineRow);
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
  if (target.opportunityId == null) throw httpError(400, "An unlinked scenario cannot be pinned");
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
  if (!choice) throw httpError(400, "field must be prelim or final and which must be max, stretch, or legacy bid model");
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

const SOURCES = ["manual", "auto_expiry", "trinity", "handoff", "umler"] as const;

function scenarioName(body: Record<string, unknown>, required: boolean): string {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (required && !name) throw httpError(400, "Name is required");
  return name || "Scenario";
}

async function loadScenarioById(scenarioId: number): Promise<Record<string, unknown>> {
  if (!Number.isFinite(scenarioId) || scenarioId <= 0) throw httpError(400, "Invalid scenario");
  const { data, error } = await supabaseAdmin.from(SCENARIO_TABLE).select("*").eq("id", scenarioId).maybeSingle();
  if (error) throw error;
  if (!data || data.deleted_at) throw httpError(404, "Scenario not found");
  return data as Record<string, unknown>;
}

function carCountOf(row: Record<string, unknown>): number | null {
  const inputs = row.inputs;
  if (!inputs || typeof inputs !== "object") return null;
  const carCount = (inputs as { carCount?: { value?: unknown } }).carCount;
  const value = Number(carCount?.value);
  return Number.isFinite(value) ? value : null;
}

export async function listStandaloneScenarios(
  query: { q?: string; link?: string },
  canSeeNumbers: boolean,
) {
  let request = supabaseAdmin
    .from(SCENARIO_TABLE)
    .select("*")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  const link = query.link === "unlinked" || query.link === "linked" ? query.link : "all";
  if (link === "unlinked") request = request.is("opportunity_id", null);
  if (link === "linked") request = request.not("opportunity_id", "is", null);
  const q = (query.q ?? "").trim().replace(/[%_,]/g, "");
  if (q) request = request.or(`name.ilike.%${q}%,notes.ilike.%${q}%`);
  const { data, error } = await request;
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const oppIds = Array.from(new Set(rows.map((row) => Number(row.opportunity_id)).filter((id) => id > 0)));
  const labels = new Map<number, string>();
  if (oppIds.length) {
    const { data: opps, error: oppErr } = await supabaseAdmin
      .from("opportunities")
      .select("id, offering_name")
      .in("id", oppIds);
    if (oppErr) throw oppErr;
    for (const opp of opps ?? []) {
      labels.set(Number(opp.id), opp.offering_name ? String(opp.offering_name) : `Opportunity ${opp.id}`);
    }
  }
  const decorated = rows.map((row) => ({
    ...row,
    car_count: carCountOf(row),
    author: row.created_by ?? null,
    opportunity_label: row.opportunity_id == null ? null : labels.get(Number(row.opportunity_id)) ?? `Opportunity ${row.opportunity_id}`,
  }));
  return presentStandaloneScenarioList(decorated, canSeeNumbers);
}

export async function getStandaloneScenario(scenarioId: number, canSeeNumbers: boolean) {
  const row = await loadScenarioById(scenarioId);
  const scenario = canSeeNumbers ? row : stripScenarioPrices(row);
  return { scenario };
}

async function inputsForSave(body: Record<string, unknown>, existing: Record<string, unknown> | null): Promise<DealCalcInputs> {
  const raw = inputsIgnoringClientResults(body);
  if (raw != null) return calculatedScenario(raw).inputs;
  if (existing) return calculatedScenario(existing.inputs).inputs;
  const company = await companyInputs();
  return applyAssumptionSetCosts(company, company.newCarCostByClass ?? {});
}

export async function createStandaloneScenario(body: Record<string, unknown>, actor: string) {
  const name = scenarioName(body, true);
  const inputs = await inputsForSave(body, null);
  const insert = scenarioInsert(null, { ...body, name }, actor, inputs, null);
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
      detail: { opportunity_id: null },
    });
    return { scenario: row };
  });
}

export async function updateStandaloneScenario(scenarioId: number, body: Record<string, unknown>, actor: string) {
  const before = await loadScenarioById(scenarioId);
  if ("opportunity_id" in body) {
    const nextOpp = body.opportunity_id == null || body.opportunity_id === "" ? null : positiveInt(body.opportunity_id);
    if (nextOpp == null) return unlinkScenario(scenarioId, actor);
    return linkScenario(scenarioId, {
      opportunity_id: nextOpp,
      opportunity_line_id: body.opportunity_line_id,
      name: body.name,
      notes: body.notes,
      inputs: body.inputs,
    }, actor);
  }
  if (before.opportunity_id == null) scenarioName(body.name == null ? { name: before.name } : body, true);
  const inputs = await inputsForSave(body, before);
  const opportunityId = before.opportunity_id == null ? null : Number(before.opportunity_id);
  const next = scenarioInsert(
    opportunityId,
    { ...before, ...body, name: body.name ?? before.name },
    actor,
    inputs,
    positiveInt(body.opportunity_line_id ?? before.opportunity_line_id),
  );
  delete next.is_pinned;
  delete next.created_by;
  next.opportunity_id = before.opportunity_id;
  next.opportunity_line_id = before.opportunity_line_id;
  if (!("notes" in body)) next.notes = before.notes;
  if (!("assumption_set_id" in body)) next.assumption_set_id = before.assumption_set_id;
  if (opportunityId != null) {
    const opportunity = await requireOpportunity(opportunityId);
    const lineId = positiveInt(before.opportunity_line_id);
    const line = lineId ? await loadLineAny(lineId, opportunityId) : null;
    assertWritable(opportunity, line);
  }
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

export async function deleteStandaloneScenario(scenarioId: number, actor: string) {
  const row = await loadScenarioById(scenarioId);
  const deletedAt = new Date().toISOString();
  const patches = planSoftDelete(asSlot(row), deletedAt, 1);
  return withChangeGroupResult(actor, async () => {
    for (const patch of patches) {
      await applySlotPatch(scenarioId, patch.after, actor, patch.after.deletedAt ? "delete_deal_calc_scenario" : "unpin_deal_calc_scenario");
    }
    return { id: scenarioId, deleted_at: deletedAt };
  });
}

export async function linkScenario(scenarioId: number, body: Record<string, unknown>, actor: string) {
  const before = await loadScenarioById(scenarioId);
  const opportunityId = positiveInt(body.opportunity_id);
  if (!opportunityId) throw httpError(400, "Opportunity is required");
  const opportunity = await requireOpportunity(opportunityId);
  const lineId = positiveInt(body.opportunity_line_id);
  const line = lineId ? await loadLineAny(lineId, opportunityId) : null;
  if (lineId && !line) throw httpError(404, "Line not found");
  assertWritable(opportunity, line);
  const inputs = body.inputs == null && body.name == null
    ? null
    : await inputsForSave(body, before);
  return withChangeGroupResult(actor, async () => {
    if (before.is_pinned === true) {
      await applySlotPatch(scenarioId, { isPinned: false }, actor, "unpin_deal_calc_scenario");
    }
    const update: Record<string, unknown> = {
      opportunity_id: opportunityId,
      opportunity_line_id: lineId,
      is_pinned: false,
    };
    if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
    if ("notes" in body) update.notes = body.notes == null ? null : String(body.notes);
    if (inputs) {
      const calculated = calculatedScenario(inputs);
      update.inputs = calculated.inputs;
      update.results = calculated.result;
      update.deal_type = calculated.columns.deal_type;
      update.method = calculated.columns.method;
      update.post_lease_plan = calculated.columns.post_lease_plan;
      update.calc_version = calculated.columns.calc_version;
      update.verdict = calculated.columns.verdict;
      update.target_irr = calculated.columns.target_irr;
      update.stretch_irr = calculated.columns.stretch_irr;
      update.max_bid_per_car = calculated.columns.max_bid_per_car;
      update.wayne_bid_per_car = calculated.columns.wayne_bid_per_car;
      update.irr = calculated.columns.irr;
      update.npv = calculated.columns.npv;
    }
    const { data, error } = await supabaseAdmin.from(SCENARIO_TABLE).update(update).eq("id", scenarioId).select("*").single();
    if (error) throw error;
    const row = data as Record<string, unknown>;
    await recordChange({
      table: SCENARIO_TABLE,
      pk: scenarioId,
      before: changeCaptureRow(before.is_pinned === true ? { ...before, is_pinned: false } : before),
      after: changeCaptureRow(row),
      action: "link_deal_calc_scenario",
      entity_type: "deal_calc_scenario",
      entity_id: scenarioId,
      actor,
      detail: { opportunity_id: opportunityId },
    });
    return { scenario: row };
  });
}

export async function unlinkScenario(scenarioId: number, actor: string) {
  const before = await loadScenarioById(scenarioId);
  if (before.opportunity_id == null) return { scenario: before };
  return withChangeGroupResult(actor, async () => {
    if (before.is_pinned === true) {
      await applySlotPatch(scenarioId, { isPinned: false }, actor, "unpin_deal_calc_scenario");
    }
    const { data, error } = await supabaseAdmin
      .from(SCENARIO_TABLE)
      .update({ opportunity_id: null, opportunity_line_id: null, is_pinned: false })
      .eq("id", scenarioId)
      .select("*")
      .single();
    if (error) throw error;
    const row = data as Record<string, unknown>;
    await recordChange({
      table: SCENARIO_TABLE,
      pk: scenarioId,
      before: changeCaptureRow(before.is_pinned === true ? { ...before, is_pinned: false } : before),
      after: changeCaptureRow(row),
      action: "unlink_deal_calc_scenario",
      entity_type: "deal_calc_scenario",
      entity_id: scenarioId,
      actor,
      detail: { opportunity_id: null },
    });
    return { scenario: row };
  });
}

function dealTypeValue(value: unknown): DealType {
  const text = typeof value === "string" ? value : "";
  if ((DEAL_TYPES as readonly string[]).includes(text)) return text as DealType;
  return "fleet_purchase";
}

function opportunityShape(dealType: DealType): { type: string; flavor: string | null } {
  if (dealType === "portfolio_bid") return { type: "purchase", flavor: "portfolio_bid" };
  if (dealType === "sale_leaseback") return { type: "sale_leaseback", flavor: null };
  return { type: "purchase", flavor: null };
}

async function resolveAccount(body: Record<string, unknown>): Promise<{ accountId: number; companyId: number | null }> {
  const accountId = positiveInt(body.account_id);
  if (accountId) {
    const { data, error } = await supabaseAdmin.from("accounts").select("id").eq("id", accountId).maybeSingle();
    if (error) throw error;
    if (!data) throw httpError(400, "Account not found");
    return { accountId, companyId: positiveInt(body.company_id) };
  }
  const name = typeof body.company_name === "string" ? body.company_name.trim() : "";
  if (!name) {
    throw httpError(400, "Pick an account, or type a company that already exists. A new company cannot be created in this pair.");
  }
  const { data, error } = await supabaseAdmin.from("companies").select("id, account_id, name").ilike("name", name).limit(8);
  if (error) throw error;
  const exact = (data ?? []).filter((row) => String(row.name ?? "").toLowerCase() === name.toLowerCase());
  const matches = exact.length ? exact : (data ?? []);
  if (matches.length !== 1 || matches[0].account_id == null) {
    throw httpError(400, "A new company cannot be created with the opportunity. Pick an existing account or a company name that matches one account.");
  }
  return { accountId: Number(matches[0].account_id), companyId: Number(matches[0].id) };
}

export async function createOpportunityFromCalc(body: Record<string, unknown>, actor: string, canSeeNumbers: boolean) {
  const account = await resolveAccount(body);
  const existingId = positiveInt(body.scenario_id);
  const existing = existingId ? await loadScenarioById(existingId) : null;
  if (existing && existing.opportunity_id != null) throw httpError(409, "Scenario is already linked");
  const inputs = existing
    ? await inputsForSave(body.inputs == null ? {} : body, existing)
    : await inputsForSave(body, null);
  const name = scenarioName({ name: body.name ?? existing?.name }, true);
  const dealType = dealTypeValue(body.deal_type ?? inputs.dealType.value);
  const shape = opportunityShape(dealType);
  const source = (SOURCES as readonly string[]).includes(String(body.source)) ? String(body.source) : "manual";
  const owner = typeof body.owner === "string" && body.owner.trim() ? body.owner.trim() : null;
  const includeLine = body.include_line !== false;
  const coreGroup = randomUUID();
  const calcGroup = randomUUID();
  const opportunity = {
    account_id: account.accountId,
    company_id: account.companyId,
    type: shape.type,
    flavor: shape.flavor,
    stage: "identified",
    source,
    owner,
    offering_name: name,
    car_count: inputs.carCount.value,
    car_type: inputs.carType.value,
    expected_close: inputs.closeDate.value,
    notes: typeof body.notes === "string" ? body.notes : existing?.notes ?? null,
    created_by: actor,
  };
  const line = includeLine
    ? {
        seller_deal_ref: "1",
        car_type: inputs.carType.value,
        aar_code: inputs.aarCode.value,
        car_count: inputs.carCount.value ?? 0,
        avg_build_year: inputs.avgBuildYear.value,
        lease_rate: inputs.monthlyRent.value,
        lease_expiry: inputs.leaseExpiry.value,
        lessee_rating: inputs.lesseeRating.value,
        notes: "Created from the deal calculator",
      }
    : null;
  const scenarioPayload = existing
    ? { name }
    : scenarioInsert(null, { ...body, name }, actor, inputs, null);
  const { data, error } = await supabaseAdmin.rpc("rlms_create_opp_from_calc", {
    p_actor: actor,
    p_core_group: coreGroup,
    p_calc_group: calcGroup,
    p_opportunity: opportunity,
    p_line: line,
    p_scenario_id: existing?.id ?? null,
    p_scenario: scenarioPayload,
  });
  if (error) throw error;
  const saved = (data ?? {}) as {
    opportunity?: Record<string, unknown>;
    opportunity_id?: number;
    line_id?: number | null;
    scenario?: Record<string, unknown>;
    change_group?: string;
    core_group?: string;
    calc_group?: string;
  };
  if (!saved.scenario || saved.opportunity_id == null) throw httpError(500, "Create opportunity did not finish");
  return presentCreateFromCalc(
    {
      opportunity: saved.opportunity ?? null,
      opportunity_id: Number(saved.opportunity_id),
      line_id: saved.line_id == null ? null : Number(saved.line_id),
      scenario: saved.scenario,
      change_group: saved.change_group ?? calcGroup,
      core_group: saved.core_group ?? coreGroup,
      calc_group: saved.calc_group ?? calcGroup,
    },
    canSeeNumbers,
  );
}

export function isDealCalcOnlyGroup(rows: Array<{ table_name: string | null }>): boolean {
  return rows.length > 0 && rows.every((row) => row.table_name === SCENARIO_TABLE || row.table_name === SET_TABLE);
}

export type { ApplyPriceField, ApplyPriceWhich };
