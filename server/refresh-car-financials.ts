/**
 * Per-car Asset Report figures onto railcars. Shared by financial commit
 * and the one-shot re-apply against already-loaded rider_financial_summary.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "./fetch-all";
import {
  RAILCAR_FINANCIAL_REFRESH_FIELDS,
  buildCarFinancialUpdates,
  carFinancialFingerprint,
  type ActiveCarForJoin,
  type SummaryRowForRefresh,
} from "@shared/financial-import";
import { assertRailcarImporterPatch } from "@shared/rider-import-guard";

const CAR_SELECT =
  "id, rider_external_id, car_type, mechanical_designation, general_description, entity, nbv, oec, monthly_rent_per_car, monthly_depr_per_car, financial_snapshot_month";

const SUMMARY_SELECT =
  "snapshot_month, rider_id, car_type, entity, count_cars, book_value_per_asset, monthly_rent_per_car, monthly_depreciation_per_asset, net_equipment_cost_per_car";

type CarRow = ActiveCarForJoin & {
  nbv: number | null;
  oec: number | null;
  monthly_rent_per_car: number | null;
  monthly_depr_per_car: number | null;
  financial_snapshot_month: string | null;
};

export type ApplyCarFinancialResult = {
  matched: number;
  carsUpdated: number;
  carsUnchanged: number;
  carsLeftBlank: number;
  coalSkipped: number;
};

export async function loadActiveCarsForFinancialRefresh(sb: SupabaseClient): Promise<CarRow[]> {
  return fetchAllRows<CarRow>((from, to) =>
    sb.from("railcars").select(CAR_SELECT).eq("active", true).order("id", { ascending: true }).range(from, to)
  );
}

export async function loadFinancialSummaryRows(sb: SupabaseClient): Promise<SummaryRowForRefresh[]> {
  return fetchAllRows<SummaryRowForRefresh>((from, to) =>
    sb.from("rider_financial_summary").select(SUMMARY_SELECT).order("id", { ascending: true }).range(from, to)
  );
}

export async function applyCarFinancialsFromSummary(
  sb: SupabaseClient,
  activeCars: CarRow[],
  summaryRows: SummaryRowForRefresh[]
): Promise<ApplyCarFinancialResult> {
  const { updates, leftBlank, coalSkipped } = buildCarFinancialUpdates(activeCars, summaryRows);
  const byId = new Map(activeCars.map((c) => [c.id, c]));
  let carsUpdated = 0;
  let carsUnchanged = 0;
  const WAVE = 40;
  const pending = updates.filter((u) => {
    const car = byId.get(u.id);
    if (car && carFinancialFingerprint(car) === carFinancialFingerprint(u)) {
      carsUnchanged += 1;
      return false;
    }
    return true;
  });
  for (let i = 0; i < pending.length; i += WAVE) {
    const slice = pending.slice(i, i + WAVE);
    const results = await Promise.all(
      slice.map((u) => {
        const payload: Record<string, unknown> = {};
        for (const f of RAILCAR_FINANCIAL_REFRESH_FIELDS) payload[f] = u[f];
        assertRailcarImporterPatch(payload);
        return sb.from("railcars").update(payload).eq("id", u.id);
      })
    );
    for (const r of results) {
      if (r.error) throw r.error;
    }
    carsUpdated += slice.length;
  }
  return {
    matched: updates.length,
    carsUpdated,
    carsUnchanged,
    carsLeftBlank: leftBlank,
    coalSkipped,
  };
}

/** Re-run the per-car write against whatever is already in rider_financial_summary. */
export async function refreshCarFinancialsFromSummary(sb: SupabaseClient): Promise<ApplyCarFinancialResult> {
  const [activeCars, summaryRows] = await Promise.all([
    loadActiveCarsForFinancialRefresh(sb),
    loadFinancialSummaryRows(sb),
  ]);
  return applyCarFinancialsFromSummary(sb, activeCars, summaryRows);
}
