/**
 * After a Financial Data Refresh, fill blank riders.monthly_rent_per_car from
 * the average of linked cars' monthly_rent_per_car.
 *
 * Fill-if-blank only — never overwrite a hand-entered rider value.
 * monthly_rate_pct has no car-level source and stays manual.
 * lessors_cost is left alone: it is a manually entered rider field with no
 * confirmed meaning as a sum of OEC/NBV.
 *
 * Write allowlist is RIDER_FINANCIAL_FILL_BLANK_FIELDS (monthly_rent_per_car only).
 * riders.account_manager and accounts.account_manager are never written.
 */
import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./fetch-all";
import { riderFinancialFillBlankPayload } from "@shared/rider-import-guard";

const DISAGREE_USD = 1;

export type RiderRentRollup = {
  filled: number;
  skippedManual: number;
  disagreed: Array<{ rider_id: number; label: string; min: number; max: number; avg: number }>;
};

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

export async function fillBlankRiderMonthlyRent(): Promise<RiderRentRollup> {
  const [riders, cars, assigns] = await Promise.all([
    fetchAllRows<{
      id: number;
      rider_name: string | null;
      schedule_number: string | null;
      monthly_rent_per_car: number | null;
    }>((from, to) =>
      supabaseAdmin
        .from("riders")
        .select("id, rider_name, schedule_number, monthly_rent_per_car")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<{ id: number; rider_external_id: string | null; monthly_rent_per_car: number | null }>(
      (from, to) =>
        supabaseAdmin
          .from("railcars")
          .select("id, rider_external_id, monthly_rent_per_car")
          .order("id", { ascending: true })
          .range(from, to),
    ),
    fetchAllRows<{ railcar_id: number; rider_id: number | null }>((from, to) =>
      supabaseAdmin
        .from("railcar_assignments")
        .select("railcar_id, rider_id")
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const assignByCar = new Map<number, number>();
  for (const a of assigns) {
    if (a.rider_id) assignByCar.set(a.railcar_id, a.rider_id);
  }

  const riderByOl = new Map<string, number>();
  for (const r of riders) {
    for (const raw of [r.schedule_number, r.rider_name]) {
      const k = String(raw ?? "").trim().toUpperCase();
      if (k) riderByOl.set(k, r.id);
    }
  }

  const rents = new Map<number, number[]>();
  for (const c of cars) {
    if (c.monthly_rent_per_car == null || !Number.isFinite(Number(c.monthly_rent_per_car))) continue;
    const rent = Number(c.monthly_rent_per_car);
    let riderId = assignByCar.get(c.id);
    if (!riderId) {
      const ol = String(c.rider_external_id ?? "").trim().toUpperCase();
      if (ol) riderId = riderByOl.get(ol);
    }
    if (!riderId) continue;
    const list = rents.get(riderId) ?? [];
    list.push(rent);
    rents.set(riderId, list);
  }

  const result: RiderRentRollup = { filled: 0, skippedManual: 0, disagreed: [] };

  const pending: { id: number; avg: number }[] = [];
  for (const r of riders) {
    const list = rents.get(r.id);
    if (!list?.length) continue;
    if (r.monthly_rent_per_car != null) {
      result.skippedManual += 1;
      continue;
    }
    const min = Math.min(...list);
    const max = Math.max(...list);
    const avg = roundMoney(list.reduce((s, n) => s + n, 0) / list.length);
    if (max - min > DISAGREE_USD) {
      result.disagreed.push({
        rider_id: r.id,
        label: String(r.schedule_number || r.rider_name || r.id),
        min: roundMoney(min),
        max: roundMoney(max),
        avg,
      });
    }
    pending.push({ id: r.id, avg });
  }

  const WAVE = 40;
  for (let i = 0; i < pending.length; i += WAVE) {
    const slice = pending.slice(i, i + WAVE);
    const results = await Promise.all(
      slice.map((p) =>
        supabaseAdmin
          .from("riders")
          .update(riderFinancialFillBlankPayload("monthly_rent_per_car", p.avg))
          .eq("id", p.id)
          .is("monthly_rent_per_car", null),
      ),
    );
    for (const r of results) {
      if (r.error) throw r.error;
    }
    result.filled += slice.length;
  }

  return result;
}
