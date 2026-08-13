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
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const to = from + PAGE - 1;
    const result = await Promise.resolve(makeQuery(from, to));
    const { data, error } = result ?? {};
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    if (chunk.length === 0) break;
    out.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
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
