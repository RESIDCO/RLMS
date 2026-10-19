import { supabaseAdmin } from "./supabase";
import { paddedCarNumber } from "@shared/remark-in-place";
import { identitiesInSearch, formerlyFromHistory, type PriorHistoryRow } from "@shared/prior-mark";

type CarLike = {
  id: number;
  reporting_marks?: string | null;
  car_initial?: string | null;
  car_number?: string | null;
};

/** Attach "formerly KCS 310100" when the search hit an old mark on these rows. */
export async function attachFormerly<T extends CarLike>(rows: T[], search: string | undefined): Promise<Array<T & { formerly: string | null }>> {
  const wanted = identitiesInSearch(search ?? "");
  if (!wanted.length || !rows.length) return rows.map((row) => ({ ...row, formerly: null }));
  const ids = Array.from(new Set(rows.map((row) => Number(row.id)).filter((id) => id > 0))).slice(0, 200);
  const numbers = Array.from(new Set(wanted.map((item) => item.number)));
  const history: PriorHistoryRow[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const { data, error } = await supabaseAdmin
      .from("car_number_history")
      .select("railcar_id, old_car_initial, old_car_number")
      .in("railcar_id", ids.slice(i, i + 80))
      .in("old_car_number", numbers);
    if (error) {
      console.log(`[search] prior-mark badge skipped: ${error.message}`);
      return rows.map((row) => ({ ...row, formerly: null }));
    }
    history.push(...((data ?? []) as PriorHistoryRow[]));
  }
  const labels = formerlyFromHistory(rows, wanted, history);
  return rows.map((row) => ({ ...row, formerly: labels.get(Number(row.id)) ?? null }));
}

type PriorMarkCar = { mark: string; number: string; formerly: string | null };

type HistoryHit = {
  railcar_id: number;
  old_car_initial: string | null;
  old_car_number: string | null;
  railcars:
    | { reporting_marks?: string | null; car_initial?: string | null; car_number?: string | null }
    | Array<{ reporting_marks?: string | null; car_initial?: string | null; car_number?: string | null }>
    | null;
};

function embeddedCar(value: HistoryHit["railcars"]) {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Turn old marks into the current mark. One history query (railcar embedded)
 * for the whole list, not one query per car.
 */
export async function resolvePriorMarkCars(
  incoming: Array<{ mark?: unknown; number?: unknown }>,
): Promise<PriorMarkCar[]> {
  const slots: Array<{ mark: string; number: string; query: boolean }> = [];
  for (const raw of incoming) {
    const mark = String(raw?.mark ?? "").trim().toUpperCase();
    const number = paddedCarNumber(raw?.number);
    if (!mark || !number) continue;
    slots.push({ mark, number, query: /^[A-Z0-9]+$/.test(mark) });
  }
  const wanted = slots.filter((item) => item.query);
  if (!wanted.length) return slots.map((item) => ({ mark: item.mark, number: item.number, formerly: null }));

  const filter = wanted
    .map((item) => `and(old_car_initial.eq.${item.mark},old_car_number.eq.${item.number})`)
    .join(",");
  const { data, error } = await supabaseAdmin
    .from("car_number_history")
    .select("railcar_id, old_car_initial, old_car_number, railcars!car_number_history_railcar_id_fkey(reporting_marks, car_initial, car_number)")
    .or(filter)
    .limit(Math.max(wanted.length * 5, 1));
  if (error) throw error;

  const idsByKey = new Map<string, Set<number>>();
  const currentById = new Map<number, { mark: string; number: string }>();
  for (const row of (data ?? []) as HistoryHit[]) {
    const mark = String(row.old_car_initial ?? "").trim().toUpperCase();
    const number = paddedCarNumber(row.old_car_number);
    const id = Number(row.railcar_id);
    if (!mark || !number || !(id > 0)) continue;
    const key = `${mark}|${number}`;
    const ids = idsByKey.get(key) ?? new Set<number>();
    ids.add(id);
    idsByKey.set(key, ids);
    const car = embeddedCar(row.railcars);
    const currentMark = String(car?.car_initial || car?.reporting_marks || "").trim().toUpperCase();
    const currentNumber = paddedCarNumber(car?.car_number);
    if (currentMark && currentNumber) currentById.set(id, { mark: currentMark, number: currentNumber });
  }

  return slots.map((item) => {
    if (!item.query) return { mark: item.mark, number: item.number, formerly: null };
    const ids = idsByKey.get(`${item.mark}|${item.number}`);
    const only = ids && ids.size === 1 ? Array.from(ids)[0] : null;
    const current = only == null ? null : currentById.get(only);
    if (!current || (current.mark === item.mark && current.number === item.number)) {
      return { mark: item.mark, number: item.number, formerly: null };
    }
    return { mark: current.mark, number: current.number, formerly: `formerly ${item.mark} ${item.number}` };
  });
}
