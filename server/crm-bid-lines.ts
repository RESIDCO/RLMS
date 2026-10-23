import { opportunityFileLineLabel } from "@shared/attachment-category";
import {
  BID_PRICE_FIELDS,
  bidWinRate,
  isBidLineOutcome,
  lineBidTotal,
  rollupBidLines,
  type BidLineOutcome,
} from "@shared/crm-bid";
import { changeCaptureRow } from "@shared/crm";
import { annotateActorLabels } from "./actor-label";
import { recordChange, withChangeGroupResult } from "./change-log";
import { CrmHttpError } from "./crm-error";
import { mapOpportunityRow } from "./crm-opportunities";
import { supabaseAdmin } from "./supabase";
import type { OpportunityRow } from "@shared/crm";

const PRICE_KEYS = new Set<string>([...BID_PRICE_FIELDS, "total", "dollars"]);

export type OpportunityLine = {
  id: number;
  opportunity_id: number;
  seller_deal_ref: string;
  lessee_desc: string | null;
  lessee_rating: string | null;
  lessee_country: string | null;
  aar_code: string | null;
  car_type: string | null;
  equipment_desc: string | null;
  car_count: number;
  avg_build_year: number | null;
  commodity: string | null;
  lease_rate: number | null;
  lease_expiry: string | null;
  purchase_option: boolean | null;
  include_in_bid: boolean;
  exclude_reason: string | null;
  prelim_price_per_car: number | null;
  final_price_per_car: number | null;
  outcome: BidLineOutcome | null;
  market_price_per_car: number | null;
  winner_company_id: number | null;
  loss_reason: string | null;
  notes: string | null;
  sort_order: number;
  total: number | null;
};

export type LineWrite = {
  id?: number;
  seller_deal_ref: string;
  lessee_desc: string | null;
  lessee_rating: string | null;
  lessee_country: string | null;
  aar_code: string | null;
  car_type: string | null;
  equipment_desc: string | null;
  car_count: number;
  avg_build_year: number | null;
  commodity: string | null;
  lease_rate: number | null;
  lease_expiry: string | null;
  purchase_option: boolean | null;
  include_in_bid: boolean;
  exclude_reason: string | null;
  prelim_price_per_car: number | null;
  final_price_per_car: number | null;
  outcome: BidLineOutcome | null;
  market_price_per_car: number | null;
  winner_company_id: number | null;
  loss_reason: string | null;
  notes: string | null;
  sort_order: number;
};

function httpError(status: number, message: string): CrmHttpError {
  return new CrmHttpError(status, message);
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function dateOnly(value: unknown): string | null {
  if (value == null || value === "") return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function intOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function moneyOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  if (value === true || value === "true" || value === "yes") return true;
  if (value === false || value === "false" || value === "no") return false;
  return fallback;
}

export function presentLine(row: OpportunityLine, canSeePrices: boolean): OpportunityLine {
  if (canSeePrices) return row;
  return {
    ...row,
    prelim_price_per_car: null,
    final_price_per_car: null,
    market_price_per_car: null,
    winner_company_id: null,
    total: null,
  };
}

export function stripPriceKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPriceKeys);
  if (value == null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (PRICE_KEYS.has(key)) continue;
    out[key] = stripPriceKeys(item);
  }
  return out;
}

function mapLine(row: Record<string, unknown>): OpportunityLine {
  const line: OpportunityLine = {
    id: Number(row.id),
    opportunity_id: Number(row.opportunity_id),
    seller_deal_ref: String(row.seller_deal_ref ?? ""),
    lessee_desc: textOrNull(row.lessee_desc),
    lessee_rating: textOrNull(row.lessee_rating),
    lessee_country: textOrNull(row.lessee_country),
    aar_code: textOrNull(row.aar_code),
    car_type: textOrNull(row.car_type),
    equipment_desc: textOrNull(row.equipment_desc),
    car_count: intOrNull(row.car_count) ?? 0,
    avg_build_year: intOrNull(row.avg_build_year),
    commodity: textOrNull(row.commodity),
    lease_rate: moneyOrNull(row.lease_rate),
    lease_expiry: dateOnly(row.lease_expiry),
    purchase_option: row.purchase_option == null ? null : row.purchase_option === true,
    include_in_bid: row.include_in_bid !== false,
    exclude_reason: textOrNull(row.exclude_reason),
    prelim_price_per_car: moneyOrNull(row.prelim_price_per_car),
    final_price_per_car: moneyOrNull(row.final_price_per_car),
    outcome: isBidLineOutcome(row.outcome) ? row.outcome : null,
    market_price_per_car: moneyOrNull(row.market_price_per_car),
    winner_company_id: intOrNull(row.winner_company_id),
    loss_reason: textOrNull(row.loss_reason),
    notes: row.notes == null ? null : String(row.notes),
    sort_order: intOrNull(row.sort_order) ?? 0,
    total: null,
  };
  line.total = lineBidTotal(line);
  return line;
}

export function parseLineWrite(body: Record<string, unknown>, fallbackSort: number): LineWrite {
  const seller = textOrNull(body.seller_deal_ref);
  if (!seller) throw httpError(400, "Deal number is required");
  const cars = intOrNull(body.car_count) ?? 0;
  if (cars < 0) throw httpError(400, "Car count cannot be negative");
  const include = boolOr(body.include_in_bid, true);
  const exclude = textOrNull(body.exclude_reason);
  if (!include && !exclude) throw httpError(400, "An excluded deal needs a reason");
  const outcomeRaw = textOrNull(body.outcome);
  if (outcomeRaw != null && !isBidLineOutcome(outcomeRaw)) throw httpError(400, "Invalid line outcome");
  const loss = textOrNull(body.loss_reason);
  if (outcomeRaw === "lost" && !loss) throw httpError(400, "A lost deal needs a reason");
  const id = intOrNull(body.id);
  return {
    id: id != null && id > 0 ? id : undefined,
    seller_deal_ref: seller,
    lessee_desc: textOrNull(body.lessee_desc),
    lessee_rating: textOrNull(body.lessee_rating),
    lessee_country: textOrNull(body.lessee_country),
    aar_code: textOrNull(body.aar_code),
    car_type: textOrNull(body.car_type),
    equipment_desc: textOrNull(body.equipment_desc),
    car_count: cars,
    avg_build_year: intOrNull(body.avg_build_year),
    commodity: textOrNull(body.commodity),
    lease_rate: moneyOrNull(body.lease_rate),
    lease_expiry: dateOnly(body.lease_expiry),
    purchase_option: body.purchase_option == null || body.purchase_option === "" ? null : boolOr(body.purchase_option, false),
    include_in_bid: include,
    exclude_reason: include ? exclude : exclude,
    prelim_price_per_car: moneyOrNull(body.prelim_price_per_car),
    final_price_per_car: moneyOrNull(body.final_price_per_car),
    outcome: outcomeRaw,
    market_price_per_car: moneyOrNull(body.market_price_per_car),
    winner_company_id: intOrNull(body.winner_company_id),
    loss_reason: loss,
    notes: body.notes == null ? null : String(body.notes),
    sort_order: intOrNull(body.sort_order) ?? fallbackSort,
  };
}

function toDb(line: LineWrite, opportunityId: number): Record<string, unknown> {
  return {
    opportunity_id: opportunityId,
    seller_deal_ref: line.seller_deal_ref,
    lessee_desc: line.lessee_desc,
    lessee_rating: line.lessee_rating,
    lessee_country: line.lessee_country,
    aar_code: line.aar_code,
    car_type: line.car_type,
    equipment_desc: line.equipment_desc,
    car_count: line.car_count,
    avg_build_year: line.avg_build_year,
    commodity: line.commodity,
    lease_rate: line.lease_rate,
    lease_expiry: line.lease_expiry,
    purchase_option: line.purchase_option,
    include_in_bid: line.include_in_bid,
    exclude_reason: line.exclude_reason,
    prelim_price_per_car: line.prelim_price_per_car,
    final_price_per_car: line.final_price_per_car,
    outcome: line.outcome,
    market_price_per_car: line.market_price_per_car,
    winner_company_id: line.winner_company_id,
    loss_reason: line.loss_reason,
    notes: line.notes,
    sort_order: line.sort_order,
  };
}

function mapDbError(error: { code?: string; message?: string }): never {
  if (error.code === "23505") throw httpError(400, "That deal number is already on this offering");
  if (error.code === "23514") throw httpError(400, "That line does not pass the bid checks");
  throw error;
}

async function requireOpportunity(id: number): Promise<Record<string, unknown>> {
  if (!Number.isFinite(id) || id <= 0) throw httpError(400, "Invalid opportunity");
  const { data, error } = await supabaseAdmin.from("opportunities").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "Opportunity not found");
  return data as Record<string, unknown>;
}

export async function listOpportunityLines(opportunityId: number, canSeePrices: boolean): Promise<OpportunityLine[]> {
  await requireOpportunity(opportunityId);
  const { data, error } = await supabaseAdmin
    .from("opportunity_lines")
    .select("*")
    .eq("opportunity_id", opportunityId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => presentLine(mapLine(row as Record<string, unknown>), canSeePrices));
}

export type OpportunityFileLine = {
  id: number;
  label: string;
  deleted: boolean;
};

/** Live and soft-deleted lines, so a removed deal still shows its files. */
export async function listOpportunityFileLines(opportunityId: number): Promise<OpportunityFileLine[]> {
  const { data, error } = await supabaseAdmin
    .from("opportunity_lines")
    .select("id, seller_deal_ref, lessee_desc, deleted_at, sort_order")
    .eq("opportunity_id", opportunityId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    label: opportunityFileLineLabel(String(row.seller_deal_ref ?? ""), row.lessee_desc == null ? null : String(row.lessee_desc)),
    deleted: row.deleted_at != null,
  }));
}

export async function saveOpportunityLines(
  opportunityId: number,
  body: { lines?: unknown; delete_ids?: unknown },
  actor: string,
): Promise<{ lines: OpportunityLine[]; change_group: string }> {
  await requireOpportunity(opportunityId);
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const writes = rawLines.map((row, index) => {
    if (row == null || typeof row !== "object") throw httpError(400, "Each line must be an object");
    return parseLineWrite(row as Record<string, unknown>, index);
  });
  const deleteIds = Array.isArray(body.delete_ids)
    ? body.delete_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    : [];
  const seen = new Set<string>();
  for (const line of writes) {
    const key = line.seller_deal_ref.toLowerCase();
    if (seen.has(key)) throw httpError(400, `Deal ${line.seller_deal_ref} is listed twice`);
    seen.add(key);
  }

  const result = await withChangeGroupResult(actor, async () => {
    for (const id of deleteIds) {
      const { data: before, error } = await supabaseAdmin
        .from("opportunity_lines")
        .select("*")
        .eq("id", id)
        .eq("opportunity_id", opportunityId)
        .maybeSingle();
      if (error) throw error;
      if (!before || before.deleted_at) continue;
      const deletedAt = new Date().toISOString();
      const { data, error: updErr } = await supabaseAdmin
        .from("opportunity_lines")
        .update({ deleted_at: deletedAt })
        .eq("id", id)
        .select("*")
        .single();
      if (updErr) throw updErr;
      await recordChange({
        table: "opportunity_lines",
        pk: id,
        before: changeCaptureRow(before as Record<string, unknown>),
        after: changeCaptureRow(data as Record<string, unknown>),
        action: "delete_opportunity_line",
        entity_type: "opportunity_line",
        entity_id: id,
        actor,
        detail: { opportunity_id: opportunityId, seller_deal_ref: before.seller_deal_ref },
      });
    }

    for (const line of writes) {
      if (line.id) {
        const { data: before, error } = await supabaseAdmin
          .from("opportunity_lines")
          .select("*")
          .eq("id", line.id)
          .eq("opportunity_id", opportunityId)
          .is("deleted_at", null)
          .maybeSingle();
        if (error) throw error;
        if (!before) throw httpError(404, `Line ${line.id} was not found`);
        const { data, error: updErr } = await supabaseAdmin
          .from("opportunity_lines")
          .update(toDb(line, opportunityId))
          .eq("id", line.id)
          .select("*")
          .single();
        if (updErr) mapDbError(updErr);
        await recordChange({
          table: "opportunity_lines",
          pk: line.id,
          before: changeCaptureRow(before as Record<string, unknown>),
          after: changeCaptureRow(data as Record<string, unknown>),
          action: "update_opportunity_line",
          entity_type: "opportunity_line",
          entity_id: line.id,
          actor,
          detail: { opportunity_id: opportunityId, seller_deal_ref: line.seller_deal_ref },
        });
      } else {
        const { data, error } = await supabaseAdmin
          .from("opportunity_lines")
          .insert(toDb(line, opportunityId))
          .select("*")
          .single();
        if (error) mapDbError(error);
        await recordChange({
          table: "opportunity_lines",
          pk: Number(data.id),
          before: {},
          after: changeCaptureRow(data as Record<string, unknown>),
          action: "create_opportunity_line",
          entity_type: "opportunity_line",
          entity_id: Number(data.id),
          actor,
          detail: { opportunity_id: opportunityId, seller_deal_ref: line.seller_deal_ref },
        });
      }
    }
    return { lines: await listOpportunityLines(opportunityId, true) };
  });
  return result;
}

export type BidCard = OpportunityRow & {
  cars_bid: number;
  cars_total: number;
  dollars: number | null;
  won_lines: number;
  line_count: number;
  seller_name: string | null;
  broker_name: string | null;
};

async function companyNames(ids: number[]): Promise<Map<number, string>> {
  const unique = Array.from(new Set(ids.filter((id) => id > 0)));
  const names = new Map<number, string>();
  if (!unique.length) return names;
  const { data, error } = await supabaseAdmin.from("companies").select("id, name").in("id", unique);
  if (error) throw error;
  for (const row of data ?? []) names.set(Number(row.id), String(row.name ?? ""));
  return names;
}

export async function listBidBoard(canSeePrices: boolean): Promise<BidCard[]> {
  const { data, error } = await supabaseAdmin
    .from("opportunities")
    .select("*")
    .eq("flavor", "portfolio_bid")
    .order("received_date", { ascending: false })
    .limit(500);
  if (error) throw error;
  const opps = (data ?? []).map((row) => mapOpportunityRow(row as Record<string, unknown>));
  const ids = opps.map((row) => row.id);
  let lines: OpportunityLine[] = [];
  if (ids.length) {
    const { data: lineRows, error: lineErr } = await supabaseAdmin
      .from("opportunity_lines")
      .select("*")
      .in("opportunity_id", ids)
      .is("deleted_at", null);
    if (lineErr) throw lineErr;
    lines = (lineRows ?? []).map((row) => mapLine(row as Record<string, unknown>));
  }
  const names = await companyNames(opps.flatMap((row) => [row.seller_company_id ?? 0, row.broker_company_id ?? 0]));
  return opps.map((opp) => {
    const mine = lines.filter((line) => line.opportunity_id === opp.id);
    const roll = rollupBidLines(mine);
    return {
      ...opp,
      seller_name: opp.seller_company_id ? names.get(opp.seller_company_id) ?? null : null,
      broker_name: opp.broker_company_id ? names.get(opp.broker_company_id) ?? null : null,
      cars_bid: roll.cars_bid,
      cars_total: roll.cars_total,
      dollars: canSeePrices ? roll.dollars : null,
      won_lines: roll.won_lines,
      line_count: roll.line_count,
    };
  });
}

export async function getBidOffering(id: number, canSeePrices: boolean): Promise<{
  opportunity: OpportunityRow & { seller_name: string | null; broker_name: string | null };
  lines: OpportunityLine[];
  file_lines: OpportunityFileLine[];
}> {
  const row = await requireOpportunity(id);
  const opportunity = mapOpportunityRow(row);
  const names = await companyNames([opportunity.seller_company_id ?? 0, opportunity.broker_company_id ?? 0]);
  const lines = await listOpportunityLines(id, canSeePrices);
  const file_lines = await listOpportunityFileLines(id);
  return {
    opportunity: {
      ...opportunity,
      seller_name: opportunity.seller_company_id ? names.get(opportunity.seller_company_id) ?? null : null,
      broker_name: opportunity.broker_company_id ? names.get(opportunity.broker_company_id) ?? null : null,
    },
    lines,
    file_lines,
  };
}

export type BidSummary = {
  offerings_bid: number;
  offerings_passed: number;
  lines_won: number;
  lines_lost: number;
  lines_passed: number;
  win_rate: number | null;
  dollars_bid: number | null;
  dollars_won: number | null;
};

export async function bidSummary(filters: { seller?: number; aar?: string; year?: number }): Promise<BidSummary> {
  const { data, error } = await supabaseAdmin
    .from("opportunities")
    .select("id, outcome, seller_company_id, received_date, created_at, flavor")
    .eq("flavor", "portfolio_bid")
    .limit(2000);
  if (error) throw error;
  let opps = data ?? [];
  if (filters.seller) opps = opps.filter((row) => Number(row.seller_company_id) === filters.seller);
  if (filters.year) {
    const year = String(filters.year);
    opps = opps.filter((row) => String(row.received_date ?? row.created_at ?? "").slice(0, 4) === year);
  }
  const ids = opps.map((row) => Number(row.id));
  let lines: OpportunityLine[] = [];
  if (ids.length) {
    const { data: lineRows, error: lineErr } = await supabaseAdmin
      .from("opportunity_lines")
      .select("*")
      .in("opportunity_id", ids)
      .is("deleted_at", null);
    if (lineErr) throw lineErr;
    lines = (lineRows ?? []).map((row) => mapLine(row as Record<string, unknown>));
  }
  const prefix = (filters.aar ?? "").trim().toUpperCase();
  if (prefix) {
    lines = lines.filter((line) => (line.aar_code ?? "").toUpperCase().startsWith(prefix));
    const keep = new Set(lines.map((line) => line.opportunity_id));
    opps = opps.filter((row) => keep.has(Number(row.id)));
  }
  const passedOfferings = opps.filter((row) => row.outcome === "passed").length;
  const bidOfferings = opps.length - passedOfferings;
  let won = 0;
  let lost = 0;
  let passed = 0;
  let dollarsBid = 0;
  let dollarsWon = 0;
  let anyBid = false;
  let anyWon = false;
  for (const line of lines) {
    if (line.outcome === "won") won += 1;
    else if (line.outcome === "lost") lost += 1;
    else if (line.outcome === "passed") passed += 1;
    if (line.include_in_bid && line.total != null) {
      dollarsBid += line.total;
      anyBid = true;
    }
    if (line.outcome === "won" && line.total != null) {
      dollarsWon += line.total;
      anyWon = true;
    }
  }
  return {
    offerings_bid: bidOfferings,
    offerings_passed: passedOfferings,
    lines_won: won,
    lines_lost: lost,
    lines_passed: passed,
    win_rate: bidWinRate(won, lost),
    dollars_bid: anyBid ? Math.round(dollarsBid * 100) / 100 : null,
    dollars_won: anyWon ? Math.round(dollarsWon * 100) / 100 : null,
  };
}

export async function listBidTimeline(opportunityId: number, canSeePrices: boolean): Promise<Array<{
  id: string;
  occurred_at: string;
  kind: string;
  body: string;
  actor: string | null;
  actor_label: string | null;
}>> {
  await requireOpportunity(opportunityId);
  const [{ data: activities, error: actErr }, { data: logs, error: logErr }, { data: lineRows, error: lineErr }] = await Promise.all([
    supabaseAdmin.from("crm_activities").select("id, kind, body, actor, occurred_at").eq("opportunity_id", opportunityId).order("occurred_at", { ascending: false }).limit(100),
    supabaseAdmin.from("activity_log").select("id, action, actor, occurred_at, detail, before, after, entity_type, table_name").eq("entity_type", "opportunity").eq("entity_id", opportunityId).order("occurred_at", { ascending: false }).limit(100),
    supabaseAdmin.from("opportunity_lines").select("id").eq("opportunity_id", opportunityId),
  ]);
  if (actErr) throw actErr;
  if (logErr) throw logErr;
  if (lineErr) throw lineErr;
  const lineIds = (lineRows ?? []).map((row) => Number(row.id));
  let lineLogs: Array<Record<string, unknown>> = [];
  if (lineIds.length) {
    const { data, error } = await supabaseAdmin
      .from("activity_log")
      .select("id, action, actor, occurred_at, detail, before, after, entity_type, table_name")
      .eq("table_name", "opportunity_lines")
      .in("row_pk", lineIds)
      .order("occurred_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    lineLogs = (data ?? []) as Array<Record<string, unknown>>;
  }
  const items = [
    ...(activities ?? []).map((row) => ({
      id: `crm-${row.id}`,
      occurred_at: String(row.occurred_at ?? ""),
      kind: String(row.kind ?? "note"),
      body: String(row.body ?? ""),
      actor: row.actor == null ? null : String(row.actor),
    })),
    ...(logs ?? []).map((row) => timelineFromLog(row as Record<string, unknown>, canSeePrices)),
    ...lineLogs.map((row) => timelineFromLog(row, canSeePrices)),
  ];
  return annotateActorLabels(
    items.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 80),
    (item) => item.actor,
  );
}

function timelineFromLog(row: Record<string, unknown>, canSeePrices: boolean): {
  id: string;
  occurred_at: string;
  kind: string;
  body: string;
  actor: string | null;
} {
  const detail = (canSeePrices ? row.detail : stripPriceKeys(row.detail)) as Record<string, unknown> | null;
  const stage = detail && typeof detail === "object" ? textOrNull(detail.stage) : null;
  const ref = detail && typeof detail === "object" ? textOrNull(detail.seller_deal_ref) : null;
  const action = String(row.action ?? "change");
  const bits = [action.replaceAll("_", " ")];
  if (stage) bits.push(stage);
  if (ref) bits.push(`deal ${ref}`);
  return {
    id: `log-${row.id}`,
    occurred_at: String(row.occurred_at ?? ""),
    kind: "stage",
    body: bits.join(" · "),
    actor: row.actor == null ? null : String(row.actor),
  };
}
