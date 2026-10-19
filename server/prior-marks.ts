import { supabaseAdmin } from "./supabase";
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
  const ids = [...new Set(rows.map((row) => Number(row.id)).filter((id) => id > 0))].slice(0, 200);
  const numbers = [...new Set(wanted.map((item) => item.number))];
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
