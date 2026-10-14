import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "./fetch-all";
import { aggregateKeys, type FinKeyRow, type RiderToday } from "@shared/financial-load-review";
import { olsWithMultipleDatedTerms, type RiderLeaseTermRow } from "@shared/financial-import";

export async function listLoadedSnapshotMonths(db: SupabaseClient): Promise<string[]> {
  const rows = await fetchAllRows<{ snapshot_month: string }>((from, to) =>
    db.from("rider_financial_summary").select("snapshot_month").order("snapshot_month", { ascending: true }).range(from, to)
  );
  return Array.from(new Set(rows.map((r) => String(r.snapshot_month).slice(0, 10)))).sort();
}

export async function loadBaseMonthRows(db: SupabaseClient, baseMonth: string | null): Promise<FinKeyRow[]> {
  if (!baseMonth) return [];
  return fetchAllRows<FinKeyRow>((from, to) =>
    db
      .from("rider_financial_summary")
      .select(
        "rider_id, car_type, entity, count_cars, total_book_value, monthly_rent_total, monthly_rent_per_car, total_monthly_depreciation, monthly_depreciation_per_asset, net_equipment_cost_per_car, net_equipment_cost_total, lease_exp_date"
      )
      .eq("snapshot_month", baseMonth)
      .range(from, to)
  );
}

export async function loadRidersToday(
  db: SupabaseClient,
  activeCars: Array<{ rider_external_id?: string | null }>
): Promise<RiderToday[]> {
  const activeByCode = new Map<string, number>();
  for (const c of activeCars) {
    const code = String(c.rider_external_id ?? "").trim().toUpperCase();
    if (!code) continue;
    activeByCode.set(code, (activeByCode.get(code) ?? 0) + 1);
  }
  const riders = await fetchAllRows<any>((from, to) =>
    db.from("riders").select("rider_name, schedule_number, expiration_date, lease_status").range(from, to)
  );
  const byCode = new Map<string, RiderToday>();
  for (const r of riders) {
    for (const raw of [r.schedule_number, r.rider_name]) {
      const code = String(raw ?? "").trim().toUpperCase();
      if (!code) continue;
      const prev = byCode.get(code);
      if (!prev) {
        byCode.set(code, {
          code,
          expiration_date: r.expiration_date ? String(r.expiration_date).slice(0, 10) : null,
          lease_status: r.lease_status ?? null,
          active_cars: activeByCode.get(code) ?? 0,
        });
      }
    }
  }
  for (const [code, n] of Array.from(activeByCode.entries())) {
    if (!byCode.has(code)) {
      byCode.set(code, { code, expiration_date: null, lease_status: null, active_cars: n });
    }
  }
  return Array.from(byCode.values());
}

export type IntegrityCheck = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
  warning?: boolean;
};

export type ScopeChecksum = {
  cars: number;
  carHash: string;
  assignments: number;
  priorFinancialRows: number;
  priorFinancialHash: string;
  inactiveCars: number;
  inactiveLeaseHash: string;
  carRecordsCars: number;
  carRecordsHash: string;
};

function sha(parts: string[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  h.update("\n");
  return h.digest("hex").slice(0, 20);
}

function money(n: unknown): number {
  if (n == null || n === "") return 0;
  const v = Number(n);
  return Number.isNaN(v) ? 0 : Math.round(v * 100) / 100;
}

export async function snapshotScopeChecksums(
  db: SupabaseClient,
  snapshotMonth: string
): Promise<ScopeChecksum> {
  const cars = await fetchAllRows<any>((from, to) =>
    db
      .from("railcars")
      .select(
        "id, car_number, reporting_marks, active, entity, rider_external_id, railinc_oec, active_source, lease_end_date, lease_expiry, estimated_lease_expiry, lease_date_source"
      )
      .order("id", { ascending: true })
      .range(from, to)
  );

  const carLines: string[] = [];
  const inactiveLines: string[] = [];
  const carRecordsLines: string[] = [];
  let inactiveCars = 0;
  let carRecordsCars = 0;
  for (const c of cars) {
    carLines.push(
      [
        c.id,
        c.car_number,
        c.reporting_marks,
        c.active ? "1" : "0",
        c.entity ?? "",
        c.rider_external_id ?? "",
        c.railinc_oec ?? "",
        c.active_source ?? "",
      ].join("|")
    );
    if (c.active === false) {
      inactiveCars += 1;
      inactiveLines.push(
        [c.id, c.lease_end_date ?? "", c.lease_expiry ?? "", c.estimated_lease_expiry ?? ""].join("|")
      );
    }
    if (String(c.lease_date_source ?? "") === "car_records") {
      carRecordsCars += 1;
      carRecordsLines.push(
        [c.id, c.lease_end_date ?? "", c.lease_expiry ?? "", c.estimated_lease_expiry ?? ""].join("|")
      );
    }
  }

  const { count: assignments, error: aErr } = await db
    .from("railcar_assignments")
    .select("id", { count: "exact", head: true });
  if (aErr) throw aErr;

  const prior = await fetchAllRows<any>((from, to) =>
    db
      .from("rider_financial_summary")
      .select("id, snapshot_month, rider_id, car_type, entity, count_cars, total_book_value")
      .neq("snapshot_month", snapshotMonth)
      .order("id", { ascending: true })
      .range(from, to)
  );
  const priorLines = prior.map((r) =>
    [r.id, r.snapshot_month, r.rider_id, r.car_type, r.entity, r.count_cars, r.total_book_value].join("|")
  );

  return {
    cars: cars.length,
    carHash: sha(carLines.sort()),
    assignments: assignments ?? 0,
    priorFinancialRows: prior.length,
    priorFinancialHash: sha(priorLines.sort()),
    inactiveCars,
    inactiveLeaseHash: sha(inactiveLines.sort()),
    carRecordsCars,
    carRecordsHash: sha(carRecordsLines.sort()),
  };
}

export function compareScopeChecksums(before: ScopeChecksum, after: ScopeChecksum): IntegrityCheck {
  const diffs: string[] = [];
  if (before.cars !== after.cars || before.carHash !== after.carHash) {
    diffs.push(`car identity changed (${before.cars} → ${after.cars})`);
  }
  if (before.assignments !== after.assignments) {
    diffs.push(`assignments ${before.assignments} → ${after.assignments}`);
  }
  if (before.priorFinancialRows !== after.priorFinancialRows || before.priorFinancialHash !== after.priorFinancialHash) {
    diffs.push(`other-month financial rows ${before.priorFinancialRows} → ${after.priorFinancialRows}`);
  }
  if (before.inactiveLeaseHash !== after.inactiveLeaseHash) {
    diffs.push("inactive-car lease fields changed");
  }
  if (before.carRecordsHash !== after.carRecordsHash) {
    diffs.push("car_records-sourced lease fields changed");
  }
  const pass = diffs.length === 0;
  const detail = pass
    ? `${after.cars.toLocaleString()} cars, ${after.assignments.toLocaleString()} assignments, ${after.priorFinancialRows.toLocaleString()} prior-month rows, ${after.inactiveCars} inactive cars untouched, ${after.carRecordsCars} car_records cars untouched.`
    : diffs.join("; ");
  return { id: "scope", label: "Nothing outside scope changed", pass, detail };
}

export async function runFinancialIntegrityChecks(args: {
  db: SupabaseClient;
  snapshotMonth: string;
  fileRows: FinKeyRow[];
  termRows: RiderLeaseTermRow[];
  scopeBefore: ScopeChecksum;
  scopeAfter: ScopeChecksum;
}): Promise<IntegrityCheck[]> {
  const { db, snapshotMonth, fileRows, termRows } = args;
  const fileAgg = aggregateKeys(fileRows);
  const written = await fetchAllRows<any>((from, to) =>
    db
      .from("rider_financial_summary")
      .select("rider_id, car_type, entity, count_cars, total_book_value, lease_exp_date")
      .eq("snapshot_month", snapshotMonth)
      .range(from, to)
  );
  const dbAgg = aggregateKeys(written);
  let keyOk = 0;
  const keyFail: string[] = [];
  let fileCars = 0;
  let fileBv = 0;
  for (const [k, f] of Array.from(fileAgg.entries())) {
    fileCars += f.count_cars;
    fileBv += money(f.total_book_value);
    const d = dbAgg.get(k);
    if (!d) {
      keyFail.push(`${k} missing in DB`);
      continue;
    }
    if (d.count_cars !== f.count_cars || Math.abs(money(d.total_book_value) - money(f.total_book_value)) > 0.5) {
      keyFail.push(
        `${f.rider_id} ${f.car_type} (${f.entity}): file ${f.count_cars} cars / $${money(f.total_book_value).toLocaleString()} vs DB ${d.count_cars} / $${money(d.total_book_value).toLocaleString()}`
      );
      continue;
    }
    keyOk += 1;
  }
  for (const [k, d] of Array.from(dbAgg.entries())) {
    if (!fileAgg.has(k)) keyFail.push(`${k} extra in DB`);
  }

  const datedFile = new Map<string, string>();
  for (const r of fileRows) {
    const id = String(r.rider_id ?? "").trim().toUpperCase();
    if (!id || !r.lease_exp_date) continue;
    const prev = datedFile.get(id);
    if (!prev || r.lease_exp_date < prev) datedFile.set(id, r.lease_exp_date.slice(0, 10));
  }
  const riders = await fetchAllRows<any>((from, to) =>
    db.from("riders").select("id, rider_name, schedule_number, expiration_date, lease_status").range(from, to)
  );
  const riderByCode = new Map<string, any>();
  for (const r of riders) {
    for (const code of [r.schedule_number, r.rider_name]) {
      const c = String(code ?? "").trim().toUpperCase();
      if (c) riderByCode.set(c, r);
    }
  }
  let dateOk = 0;
  const dateFail: string[] = [];
  for (const [id, date] of Array.from(datedFile.entries())) {
    const rider = riderByCode.get(id);
    const got = rider?.expiration_date ? String(rider.expiration_date).slice(0, 10) : null;
    if (got !== date) {
      dateFail.push(`${id}: file ${date} vs rider ${got ?? "(blank)"}`);
      continue;
    }
    dateOk += 1;
  }
  const finDateFail: string[] = [];
  for (const r of written) {
    if (!r.lease_exp_date) continue;
    const id = String(r.rider_id ?? "").trim().toUpperCase();
    const expected = datedFile.get(id);
    if (expected && String(r.lease_exp_date).slice(0, 10) !== expected) {
      finDateFail.push(`${id} financial row lease_exp_date ${String(r.lease_exp_date).slice(0, 10)} vs file ${expected}`);
    }
  }

  const multi = olsWithMultipleDatedTerms(termRows, snapshotMonth);
  const statusRiders = new Set<string>();
  for (const r of fileRows) {
    if (r.lease_status && !r.lease_exp_date) statusRiders.add(String(r.rider_id).trim().toUpperCase());
  }
  const cars = await fetchAllRows<any>((from, to) =>
    db
      .from("railcars")
      .select("id, rider_external_id, lease_end_date, lease_expiry, estimated_lease_expiry, lease_date_source, financial_snapshot_month")
      .eq("active", true)
      .eq("financial_snapshot_month", snapshotMonth)
      .range(from, to)
  );
  let carOk = 0;
  const carFail: string[] = [];
  for (const c of cars) {
    const ol = String(c.rider_external_id ?? "").trim().toUpperCase();
    if (!ol) continue;
    if (multi.has(ol) || String(c.lease_date_source ?? "") === "asset_report_multi_term") continue;
    if (statusRiders.has(ol)) continue;
    const rider = riderByCode.get(ol);
    const want = rider?.expiration_date ? String(rider.expiration_date).slice(0, 10) : null;
    if (!want) continue;
    const end = c.lease_end_date ? String(c.lease_end_date).slice(0, 10) : null;
    const exp = c.lease_expiry ? String(c.lease_expiry).slice(0, 10) : null;
    const est = c.estimated_lease_expiry ? String(c.estimated_lease_expiry).slice(0, 10) : null;
    if (end !== want || exp !== want || est !== want) {
      carFail.push(`${ol} car ${c.id}: rider ${want} vs car ${end}/${exp}/${est}`);
      continue;
    }
    carOk += 1;
  }

  const termsDb = await fetchAllRows<any>((from, to) =>
    db
      .from("rider_lease_terms")
      .select("rider_id, term_end, status_text, car_count")
      .eq("snapshot_month", snapshotMonth)
      .range(from, to)
  );
  const fileCarsByRider = new Map<string, number>();
  for (const r of fileRows) {
    const id = String(r.rider_id ?? "").trim().toUpperCase();
    fileCarsByRider.set(id, (fileCarsByRider.get(id) ?? 0) + Math.max(r.count_cars || 0, 0));
  }
  const termFail: string[] = [];
  let termOk = 0;
  for (const ol of Array.from(multi)) {
    const dated = termRows.filter((t) => t.rider_id.toUpperCase() === ol && t.term_end);
    const dbDated = termsDb.filter((t) => String(t.rider_id).toUpperCase() === ol && t.term_end);
    const missing = dated.filter(
      (t) => !dbDated.some((d) => String(d.term_end).slice(0, 10) === String(t.term_end).slice(0, 10))
    );
    const sum = dated.reduce((s, t) => s + t.car_count, 0);
    const fileCount = fileCarsByRider.get(ol) ?? 0;
    const statusCount = termRows
      .filter((t) => t.rider_id.toUpperCase() === ol && t.status_text && !t.term_end)
      .reduce((s, t) => s + t.car_count, 0);
    if (missing.length || sum + statusCount !== fileCount) {
      termFail.push(
        `${ol}: terms ${dated.length} dated (sum ${sum} + status ${statusCount}) vs file ${fileCount}${missing.length ? `; missing ${missing.map((m) => m.term_end).join(",")}` : ""}`
      );
    } else {
      termOk += 1;
    }
  }

  const checks: IntegrityCheck[] = [
    {
      id: "financial_totals",
      label: "Financial totals match the file",
      pass: keyFail.length === 0,
      detail:
        keyFail.length === 0
          ? `${keyOk} of ${fileAgg.size} keys, ${fileCars.toLocaleString()} cars, $${roundMoney(fileBv)}.`
          : keyFail.slice(0, 8).join("; "),
    },
    {
      id: "rider_dates",
      label: "Rider dates match the file",
      pass: dateFail.length === 0 && finDateFail.length === 0,
      detail:
        dateFail.length === 0 && finDateFail.length === 0
          ? `${dateOk} of ${datedFile.size} dated riders; financial lease_exp_date matches.`
          : [...dateFail, ...finDateFail].slice(0, 8).join("; "),
    },
    {
      id: "car_dates",
      label: "Cars match their rider",
      pass: carFail.length === 0,
      detail:
        carFail.length === 0
          ? `${carOk} active cars on this snapshot match the rider date (multi-term and text-status excluded).`
          : carFail.slice(0, 8).join("; "),
    },
    {
      id: "multi_term",
      label: "Multi-term terms are complete",
      pass: termFail.length === 0,
      detail:
        termFail.length === 0
          ? `${termOk} multi-term riders hold every dated term; sums match the file.`
          : termFail.slice(0, 8).join("; "),
    },
    compareScopeChecksums(args.scopeBefore, args.scopeAfter),
  ];
  return checks;
}

function roundMoney(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
