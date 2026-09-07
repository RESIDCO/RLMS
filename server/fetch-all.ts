import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE = 1000;
const MAX_PAGES = 200;

/**
 * Paginate a PostgREST query. The default max is 1000 rows per request —
 * a single .select() will silently stop there and every KPI will be wrong.
 */
async function page<T>(makeQuery: (from: number, to: number) => any, from: number): Promise<{ from: number; data: T[] }> {
  const result: any = await Promise.resolve(makeQuery(from, from + PAGE - 1));
  if (result?.error) throw result.error;
  return { from, data: (result?.data ?? []) as T[] };
}

export async function fetchAllRows<T = any>(
  makeQuery: (from: number, to: number) => any
): Promise<T[]> {
  const first = await page<T>(makeQuery, 0);
  if (first.data.length < PAGE) return first.data;
  const out: T[] = [...first.data];
  const CONCURRENCY = 3;
  let from = PAGE;
  for (let wave = 0; wave < MAX_PAGES; wave += CONCURRENCY) {
    const jobs = Array.from({ length: CONCURRENCY }, (_, i) => page<T>(makeQuery, from + i * PAGE));
    const results = await Promise.all(jobs);
    results.sort((a, b) => a.from - b.from);
    let done = false;
    for (const r of results) {
      if (r.data.length === 0) {
        done = true;
        break;
      }
      out.push(...r.data);
      if (r.data.length < PAGE) {
        done = true;
        break;
      }
    }
    if (done) break;
    from += CONCURRENCY * PAGE;
  }
  return out;
}

/** Fetch every row and throw if the page loop did not match PostgREST's exact count. */
export async function fetchAllRowsOrThrow<T = any>(
  client: SupabaseClient,
  table: string,
  makeQuery: (from: number, to: number) => any
): Promise<T[]> {
  const { count, error: countErr } = await client
    .from(table)
    .select("*", { count: "exact", head: true });
  if (countErr) throw countErr;
  const rows = await fetchAllRows<T>(makeQuery);
  if (count != null && rows.length !== count) {
    throw new Error(
      `${table}: paginated fetch returned ${rows.length} rows but exact count is ${count}. ` +
        `Dashboard KPIs would be wrong — refusing to serve a truncated fleet.`
    );
  }
  return rows;
}
