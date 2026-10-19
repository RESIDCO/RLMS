/* eslint-disable no-console */
/**
 * Read-only report: cars with active=false whose status is not Inactive.
 * Bruce decides later whether those rows should stay. This script never writes.
 *
 * Run: npx tsx script/report-active-false-not-inactive.ts
 */
import { createClient } from "@supabase/supabase-js";

export const ACTIVE_FALSE_NOT_INACTIVE_SQL = `
SELECT coalesce(nullif(btrim(status), ''), '(blank)') AS status, count(*) AS cars
FROM public.railcars
WHERE active = false
  AND coalesce(btrim(status), '') IS DISTINCT FROM 'Inactive'
GROUP BY 1
ORDER BY cars DESC, status
`.trim();

export const ACTIVE_FALSE_NOT_INACTIVE_LIST_SQL = `
SELECT id, reporting_marks, car_number, status, active_status, active_source
FROM public.railcars
WHERE active = false
  AND coalesce(btrim(status), '') IS DISTINCT FROM 'Inactive'
ORDER BY status, reporting_marks, car_number, id
`.trim();

export function assertReportSqlIsReadOnly(sql: string): void {
  if (/\b(insert|update|delete|alter|drop|truncate|grant|revoke)\b/i.test(sql)) {
    throw new Error("report SQL must be read-only");
  }
}

const PAGE = 1000;
const MAX_PAGES = 200;

type ReportRow = {
  id: number;
  reporting_marks: string | null;
  car_number: string | null;
  status: string | null;
  active_status: string | null;
  active_source: string | null;
};

type ReportQuery = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: boolean) => {
        order: (column: string, options: { ascending: boolean }) => {
          range: (from: number, to: number) => PromiseLike<{ data: ReportRow[] | null; error: { message: string } | null }>;
        };
      };
    };
  };
};

/** PostgREST stops at 1000 rows unless the query is ranged. Order by id so pages do not skip. */
export async function loadActiveFalseNotInactive(sb: ReportQuery): Promise<ReportRow[]> {
  const out: ReportRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE;
    const { data, error } = await sb
      .from("railcars")
      .select("id, reporting_marks, car_number, status, active_status, active_source")
      .eq("active", false)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    for (const row of batch) {
      if (String(row.status ?? "").trim() !== "Inactive") out.push(row);
    }
    if (batch.length < PAGE) return out;
  }
  throw new Error(`Report stopped after ${MAX_PAGES * PAGE} active=false rows; the query is still full.`);
}

function isMain(): boolean {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("report-active-false-not-inactive.ts");
}

async function main() {
  if (process.argv.some((arg) => arg === "--apply" || arg === "--write")) {
    throw new Error("This report does not write");
  }
  assertReportSqlIsReadOnly(ACTIVE_FALSE_NOT_INACTIVE_SQL);
  assertReportSqlIsReadOnly(ACTIVE_FALSE_NOT_INACTIVE_LIST_SQL);
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) {
    console.log("No Supabase credentials in this environment. The report was not run.");
    console.log(ACTIVE_FALSE_NOT_INACTIVE_SQL);
    return;
  }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const rows = await loadActiveFalseNotInactive(sb);
  const byStatus = new Map<string, number>();
  for (const row of rows) {
    const status = String(row.status ?? "").trim() || "(blank)";
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
  }
  const counts = Array.from(byStatus.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  console.log(`active=false and status is not Inactive: ${rows.length}`);
  for (const [status, n] of counts) console.log(`${n}\t${status}`);
  console.log("id\tmarks\tnumber\tstatus\tactive_status\tactive_source");
  for (const row of rows) {
    console.log(
      [row.id, row.reporting_marks ?? "", row.car_number ?? "", row.status ?? "", row.active_status ?? "", row.active_source ?? ""].join("\t"),
    );
  }
}

if (isMain()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
