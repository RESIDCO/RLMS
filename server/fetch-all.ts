import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE = 1000;
const MAX_PAGES = 200;

/**
 * Paginate a PostgREST query. The default max is 1000 rows per request —
 * a single .select() will silently stop there and every KPI will be wrong.
 */
export async function fetchAllRows<T = any>(
  makeQuery: (from: number, to: number) => any
): Promise<T[]> {
  const out: T[] = [];
  const CONCURRENCY = 3;
  let from = 0;
  for (let wave = 0; wave < MAX_PAGES; wave += CONCURRENCY) {
    const jobs = Array.from({ length: CONCURRENCY }, (_, i) => {
      const f = from + i * PAGE;
      return Promise.resolve(makeQuery(f, f + PAGE - 1)).then((result: any) => ({
        f,
        data: result?.data,
        error: result?.error,
      }));
    });
    const results = await Promise.all(jobs);
    results.sort((a, b) => a.f - b.f);
    let done = false;
    for (const r of results) {
      if (r.error) throw r.error;
      const chunk = (r.data ?? []) as T[];
      if (chunk.length === 0) {
        done = true;
        break;
      }
      out.push(...chunk);
      if (chunk.length < PAGE) {
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
