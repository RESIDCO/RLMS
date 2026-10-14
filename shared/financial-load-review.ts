/**
 * Informational Asset Report review: compare this file to the last loaded
 * month before the detected month. Does not change what commit writes.
 */

export type FinKeyRow = {
  rider_id: string;
  car_type: string;
  entity: string;
  count_cars: number;
  total_book_value: number | null;
  monthly_rent_total: number | null;
  monthly_rent_per_car: number | null;
  total_monthly_depreciation: number | null;
  monthly_depreciation_per_asset: number | null;
  net_equipment_cost_per_car: number | null;
  net_equipment_cost_total: number | null;
  lease_exp_date: string | null;
  lease_status?: string | null;
  former_deal?: string | null;
  months_until_lease_exp?: number | null;
};

export type RiderToday = {
  code: string;
  expiration_date: string | null;
  lease_status: string | null;
  active_cars: number;
};

export type GapWarning = {
  lastLoadedMonth: string;
  lastLoadedLabel: string;
  skippedMonths: string[];
  skippedLabels: string[];
  monthsElapsed: number;
  message: string;
} | null;

export type MonthTotals = {
  cars: number;
  totalBookValue: number;
  monthlyRent: number;
  monthlyDepreciation: number;
};

export type TotalsDelta = {
  file: MonthTotals;
  base: MonthTotals | null;
  baseMonth: string | null;
  baseLabel: string | null;
  delta: MonthTotals;
};

export type KeyChange = {
  rider_id: string;
  car_type: string;
  entity: string;
  old_count?: number;
  new_count?: number;
  old_rent_per_car?: number | null;
  new_rent_per_car?: number | null;
  old_cost_per_car?: number | null;
  new_cost_per_car?: number | null;
  old_bv?: number | null;
  new_bv?: number | null;
  expected_bv_drop?: number | null;
  actual_bv_drop?: number | null;
  kind?: string;
};

export type LeaseDateChange = {
  rider_id: string;
  old_date: string | null;
  new_date: string | null;
  cars: number;
  months_delta: number | null;
  possible_renewal: boolean;
  active_to_expired: boolean;
};

export type StatusChange = {
  rider_id: string;
  old_cell: string;
  new_cell: string;
  cars: number;
};

export type RiderMismatch = {
  rider_id: string;
  file_cars: number;
  rlms_active_cars: number;
  difference: number;
};

export type SuggestedMatch = {
  file_rider: string;
  former_deal: string;
  suggested_rider: string;
  note: string;
};

export type MergeStat = {
  collapsedRows: number;
  riders: string[];
};

export type LoadChangeReport = {
  snapshotMonth: string;
  baseMonth: string | null;
  gap: GapWarning;
  totals: TotalsDelta;
  newKeys: KeyChange[];
  droppedKeys: KeyChange[];
  carCountChanges: KeyChange[];
  leaseDateChanges: LeaseDateChange[];
  possibleRenewals: LeaseDateChange[];
  activeToExpired: LeaseDateChange[];
  rentCostChanges: KeyChange[];
  statusChanges: StatusChange[];
  bvWithinTolerance: number;
  bvSameCountKeys: number;
  bvOutliers: KeyChange[];
  bvIncreases: KeyChange[];
  financedLeasePaydowns: KeyChange[];
  riderMismatches: RiderMismatch[];
  suggestedMatches: SuggestedMatch[];
  expiredRiders: Array<{ rider_id: string; date: string; cars: number }>;
  merge: MergeStat;
};

function isoMonth(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(0, 7)}-01`;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  return null;
}

export function formatMonthLong(iso: string | null | undefined): string {
  const m = isoMonth(iso);
  if (!m) return String(iso ?? "");
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  if (!y || !mo) return m;
  return new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function monthsBetween(fromIso: string, toIso: string): number {
  const a = isoMonth(fromIso);
  const b = isoMonth(toIso);
  if (!a || !b) return 0;
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
}

export function addMonths(iso: string, n: number): string {
  const m = isoMonth(iso);
  if (!m) return String(iso);
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, mo, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function pickBaseMonth(loadedMonths: string[], detected: string): string | null {
  const det = isoMonth(detected);
  if (!det) return null;
  const before = loadedMonths
    .map((x) => isoMonth(x))
    .filter((x): x is string => !!x && x < det)
    .sort();
  return before.length ? before[before.length - 1] : null;
}

export function skippedMonthsBetween(base: string | null, detected: string): string[] {
  if (!base) return [];
  const elapsed = monthsBetween(base, detected);
  const out: string[] = [];
  for (let i = 1; i < elapsed; i++) out.push(addMonths(base, i));
  return out;
}

export function compareKey(r: { rider_id?: string | null; car_type?: string | null; entity?: string | null }): string {
  return `${String(r.rider_id ?? "").trim().toUpperCase()}|${String(r.car_type ?? "").trim()}|${String(r.entity ?? "").trim()}`;
}

function money(n: number | null | undefined): number {
  if (n == null || Number.isNaN(Number(n))) return 0;
  return Math.round(Number(n) * 100) / 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function aggregateKeys(rows: FinKeyRow[]): Map<string, FinKeyRow> {
  const map = new Map<string, FinKeyRow>();
  for (const r of rows) {
    const rider = String(r.rider_id ?? "").trim();
    if (!rider) continue;
    const k = compareKey(r);
    const prev = map.get(k);
    const count = Math.max(r.count_cars || 0, 0);
    if (!prev) {
      map.set(k, {
        rider_id: rider,
        car_type: String(r.car_type ?? "").trim(),
        entity: String(r.entity ?? "").trim(),
        count_cars: count,
        total_book_value: r.total_book_value,
        monthly_rent_total: r.monthly_rent_total,
        monthly_rent_per_car: r.monthly_rent_per_car,
        total_monthly_depreciation: r.total_monthly_depreciation,
        monthly_depreciation_per_asset: r.monthly_depreciation_per_asset,
        net_equipment_cost_per_car: r.net_equipment_cost_per_car,
        net_equipment_cost_total: r.net_equipment_cost_total,
        lease_exp_date: r.lease_exp_date ?? null,
        lease_status: r.lease_status ?? null,
        former_deal: r.former_deal ?? null,
        months_until_lease_exp: r.months_until_lease_exp ?? null,
      });
      continue;
    }
    prev.count_cars += count;
    prev.total_book_value = money(money(prev.total_book_value) + money(r.total_book_value));
    prev.monthly_rent_total = money(money(prev.monthly_rent_total) + money(r.monthly_rent_total));
    prev.total_monthly_depreciation = money(
      money(prev.total_monthly_depreciation) + money(r.total_monthly_depreciation)
    );
    prev.net_equipment_cost_total = money(money(prev.net_equipment_cost_total) + money(r.net_equipment_cost_total));
    if (prev.net_equipment_cost_per_car != r.net_equipment_cost_per_car) prev.net_equipment_cost_per_car = null;
    if (prev.monthly_rent_per_car != r.monthly_rent_per_car) {
      prev.monthly_rent_per_car =
        prev.count_cars > 0 ? round2(money(prev.monthly_rent_total) / prev.count_cars) : null;
    }
    if (!prev.lease_exp_date && r.lease_exp_date) prev.lease_exp_date = r.lease_exp_date;
    else if (prev.lease_exp_date && r.lease_exp_date && r.lease_exp_date < prev.lease_exp_date) {
      prev.lease_exp_date = r.lease_exp_date;
    }
    if (!prev.lease_status && r.lease_status) prev.lease_status = r.lease_status;
    if (!prev.former_deal && r.former_deal) prev.former_deal = r.former_deal;
  }
  return map;
}

function totalsOf(map: Map<string, FinKeyRow>): MonthTotals {
  let cars = 0,
    totalBookValue = 0,
    monthlyRent = 0,
    monthlyDepreciation = 0;
  for (const r of map.values()) {
    cars += r.count_cars;
    totalBookValue += money(r.total_book_value);
    monthlyRent += money(r.monthly_rent_total);
    monthlyDepreciation += money(r.total_monthly_depreciation);
  }
  return {
    cars,
    totalBookValue: round2(totalBookValue),
    monthlyRent: round2(monthlyRent),
    monthlyDepreciation: round2(monthlyDepreciation),
  };
}

function riderDate(rows: FinKeyRow[]): Map<string, { date: string | null; status: string | null; cars: number; months: number | null }> {
  const m = new Map<string, { date: string | null; status: string | null; cars: number; months: number | null }>();
  for (const r of rows) {
    const id = String(r.rider_id ?? "").trim().toUpperCase();
    if (!id) continue;
    const prev = m.get(id);
    const date = r.lease_exp_date ?? null;
    const status = r.lease_status ?? null;
    const months = r.months_until_lease_exp ?? null;
    if (!prev) {
      m.set(id, { date, status, cars: Math.max(r.count_cars || 0, 0), months });
      continue;
    }
    prev.cars += Math.max(r.count_cars || 0, 0);
    if (date && (!prev.date || date < prev.date)) prev.date = date;
    if (!prev.status && status) prev.status = status;
    if (months != null && (prev.months == null || months < prev.months)) prev.months = months;
  }
  return m;
}

export function stripFormerDeal(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const stripped = s.replace(/^x/i, "").trim().toUpperCase();
  return stripped || null;
}

function cellLabel(date: string | null | undefined, status: string | null | undefined): string {
  if (status) return String(status).toUpperCase();
  if (date) return String(date).slice(0, 10);
  return "(blank)";
}

function monthsBetweenDates(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = new Date(`${from.slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${to.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.4375));
}

export function buildGapWarning(baseMonth: string | null, snapshotMonth: string): GapWarning {
  const skipped = skippedMonthsBetween(baseMonth, snapshotMonth);
  if (!baseMonth || skipped.length === 0) return null;
  const elapsed = monthsBetween(baseMonth, snapshotMonth);
  const skippedLabels = skipped.map(formatMonthLong);
  const lastLoadedLabel = formatMonthLong(baseMonth);
  const message =
    skipped.length === 1
      ? `Last loaded: ${lastLoadedLabel}. ${skippedLabels[0]} was never loaded. This load covers two months of change.`
      : `Last loaded: ${lastLoadedLabel}. ${skippedLabels.join(", ")} ${skipped.length === 1 ? "was" : "were"} never loaded. This load covers ${elapsed} months of change.`;
  return {
    lastLoadedMonth: baseMonth,
    lastLoadedLabel,
    skippedMonths: skipped,
    skippedLabels,
    monthsElapsed: elapsed,
    message,
  };
}

export function sameCostMergeStats(
  sourceCount: number,
  mergedCount: number,
  ridersWithCollapse: string[]
): MergeStat {
  return {
    collapsedRows: Math.max(0, sourceCount - mergedCount),
    riders: Array.from(new Set(ridersWithCollapse)).sort(),
  };
}

export function ridersCollapsedByMerge(
  source: Array<{ rider_id?: string | null; car_type?: string | null; entity?: string | null; net_equipment_cost_per_car?: number | null; snapshot_month?: string | null }>
): string[] {
  const counts = new Map<string, number>();
  for (const r of source) {
    const oec =
      r.net_equipment_cost_per_car == null ? "" : (Math.round(Number(r.net_equipment_cost_per_car) * 100) / 100).toFixed(2);
    const k = `${r.snapshot_month}|${r.rider_id}|${r.car_type}|${r.entity}|${oec}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const riders = new Set<string>();
  for (const [k, n] of counts) {
    if (n > 1) riders.add(k.split("|")[1] ?? "");
  }
  return Array.from(riders).filter(Boolean).sort();
}

export function buildLoadChangeReport(args: {
  snapshotMonth: string;
  loadedMonths: string[];
  fileRows: FinKeyRow[];
  baseRows: FinKeyRow[];
  ridersToday: RiderToday[];
  unmatchedRiders: string[];
  merge: MergeStat;
}): LoadChangeReport {
  const snapshotMonth = isoMonth(args.snapshotMonth) ?? args.snapshotMonth;
  const baseMonth = pickBaseMonth(args.loadedMonths, snapshotMonth);
  const file = aggregateKeys(args.fileRows);
  const base = aggregateKeys(args.baseRows);
  const fileT = totalsOf(file);
  const baseT = base.size ? totalsOf(base) : null;
  const gap = buildGapWarning(baseMonth, snapshotMonth);
  const monthsElapsed = baseMonth ? Math.max(1, monthsBetween(baseMonth, snapshotMonth)) : 1;

  const newKeys: KeyChange[] = [];
  const droppedKeys: KeyChange[] = [];
  const carCountChanges: KeyChange[] = [];
  const rentCostChanges: KeyChange[] = [];
  const bvOutliers: KeyChange[] = [];
  const bvIncreases: KeyChange[] = [];
  const financedLeasePaydowns: KeyChange[] = [];
  let bvSameCountKeys = 0;
  let bvWithinTolerance = 0;

  for (const [k, f] of file) {
    if (!base.has(k)) {
      newKeys.push({
        rider_id: f.rider_id,
        car_type: f.car_type,
        entity: f.entity,
        new_count: f.count_cars,
        new_bv: f.total_book_value,
      });
    }
  }
  for (const [k, b] of base) {
    if (!file.has(k)) {
      droppedKeys.push({
        rider_id: b.rider_id,
        car_type: b.car_type,
        entity: b.entity,
        old_count: b.count_cars,
        old_bv: b.total_book_value,
      });
    }
  }
  newKeys.sort((a, b) => a.rider_id.localeCompare(b.rider_id));
  droppedKeys.sort((a, b) => a.rider_id.localeCompare(b.rider_id));

  for (const [k, f] of file) {
    const b = base.get(k);
    if (!b) continue;
    if (f.count_cars !== b.count_cars) {
      carCountChanges.push({
        rider_id: f.rider_id,
        car_type: f.car_type,
        entity: f.entity,
        old_count: b.count_cars,
        new_count: f.count_cars,
      });
      continue;
    }
    bvSameCountKeys += 1;
    const oldRent = b.monthly_rent_per_car;
    const newRent = f.monthly_rent_per_car;
    const oldCost = b.net_equipment_cost_per_car;
    const newCost = f.net_equipment_cost_per_car;
    const rentChanged = oldRent != null && newRent != null && Math.abs(money(oldRent) - money(newRent)) >= 0.005;
    const costChanged = oldCost != null && newCost != null && Math.abs(money(oldCost) - money(newCost)) >= 0.005;
    if (rentChanged || costChanged) {
      rentCostChanges.push({
        rider_id: f.rider_id,
        car_type: f.car_type,
        entity: f.entity,
        old_count: f.count_cars,
        new_count: f.count_cars,
        old_rent_per_car: oldRent,
        new_rent_per_car: newRent,
        old_cost_per_car: oldCost,
        new_cost_per_car: newCost,
      });
    }
    const oldBv = money(b.total_book_value);
    const newBv = money(f.total_book_value);
    const actualDrop = round2(oldBv - newBv);
    const depr = money(b.total_monthly_depreciation);
    const expectedDrop = round2(depr * monthsElapsed);
    const row: KeyChange = {
      rider_id: f.rider_id,
      car_type: f.car_type,
      entity: f.entity,
      old_count: f.count_cars,
      new_count: f.count_cars,
      old_bv: oldBv,
      new_bv: newBv,
      expected_bv_drop: expectedDrop,
      actual_bv_drop: actualDrop,
    };
    if (newBv > oldBv + 0.5) {
      bvIncreases.push({ ...row, kind: "bv_increase" });
      continue;
    }
    if (depr === 0 && actualDrop > 0.5) {
      financedLeasePaydowns.push({ ...row, kind: "financed_lease_paydown" });
      continue;
    }
    const denom = Math.max(Math.abs(expectedDrop), 1);
    if (Math.abs(actualDrop - expectedDrop) / denom > 0.15) {
      bvOutliers.push({ ...row, kind: "outside_tolerance" });
    } else {
      bvWithinTolerance += 1;
    }
  }
  carCountChanges.sort((a, b) => Math.abs((b.old_count ?? 0) - (b.new_count ?? 0)) - Math.abs((a.old_count ?? 0) - (a.new_count ?? 0)));
  rentCostChanges.sort((a, b) => a.rider_id.localeCompare(b.rider_id));
  bvOutliers.sort((a, b) => a.rider_id.localeCompare(b.rider_id));
  financedLeasePaydowns.sort((a, b) => a.rider_id.localeCompare(b.rider_id));

  const fileByRider = riderDate(args.fileRows);
  const todayByCode = new Map(args.ridersToday.map((r) => [r.code.trim().toUpperCase(), r]));
  const leaseDateChanges: LeaseDateChange[] = [];
  const baseByRider = riderDate(args.baseRows);
  for (const [id, f] of fileByRider) {
    const today = todayByCode.get(id);
    const baseDate = baseByRider.get(id)?.date ? String(baseByRider.get(id)!.date).slice(0, 10) : null;
    const todayDate = today?.expiration_date ? String(today.expiration_date).slice(0, 10) : null;
    const oldDate = baseDate ?? todayDate;
    const newDate = f.date ? String(f.date).slice(0, 10) : null;
    if (!newDate) continue;
    if (oldDate === newDate) continue;
    const monthsDelta = monthsBetweenDates(oldDate, newDate);
    const possible_renewal = monthsDelta != null && monthsDelta > 12;
    const snapStart = snapshotMonth;
    const active_to_expired = !!oldDate && oldDate >= snapStart && newDate < snapStart;
    if (!oldDate && !newDate) continue;
    leaseDateChanges.push({
      rider_id: id,
      old_date: oldDate,
      new_date: newDate,
      cars: f.cars,
      months_delta: monthsDelta,
      possible_renewal,
      active_to_expired,
    });
  }
  leaseDateChanges.sort((a, b) => a.rider_id.localeCompare(b.rider_id));

  const statusChanges: StatusChange[] = [];
  const allRiders = new Set([...fileByRider.keys(), ...baseByRider.keys()]);
  for (const id of allRiders) {
    const f = fileByRider.get(id);
    const b = baseByRider.get(id);
    const fileHasStatus = !!f?.status;
    const fileHasDate = !!f?.date;
    const baseHasDate = !!b?.date;
    const baseHasStatus = !!b?.status;
    const flipped =
      (fileHasStatus && !fileHasDate && baseHasDate) ||
      (fileHasDate && !fileHasStatus && (baseHasStatus || (b && !b.date && !!b.status)));
    const fileCell = cellLabel(f?.date, f?.status);
    const baseCell = cellLabel(b?.date, b?.status);
    if (flipped && fileCell !== baseCell) {
      statusChanges.push({
        rider_id: id,
        old_cell: baseCell,
        new_cell: fileCell,
        cars: f?.cars ?? b?.cars ?? 0,
      });
    }
  }
  statusChanges.sort((a, b) => a.rider_id.localeCompare(b.rider_id));

  const fileCarsByRider = new Map<string, number>();
  for (const r of args.fileRows) {
    const id = String(r.rider_id ?? "").trim().toUpperCase();
    if (!id) continue;
    fileCarsByRider.set(id, (fileCarsByRider.get(id) ?? 0) + Math.max(r.count_cars || 0, 0));
  }
  const riderMismatches: RiderMismatch[] = [];
  for (const [id, fileCars] of fileCarsByRider) {
    const rlms = todayByCode.get(id)?.active_cars ?? 0;
    if (fileCars !== rlms) {
      riderMismatches.push({
        rider_id: id,
        file_cars: fileCars,
        rlms_active_cars: rlms,
        difference: fileCars - rlms,
      });
    }
  }
  riderMismatches.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  const suggestedMatches: SuggestedMatch[] = [];
  const unmatched = new Set(args.unmatchedRiders.map((x) => String(x).trim().toUpperCase()));
  const formerByRider = new Map<string, string>();
  for (const r of args.fileRows) {
    const id = String(r.rider_id ?? "").trim().toUpperCase();
    const fd = stripFormerDeal(r.former_deal);
    if (id && fd && !formerByRider.has(id)) formerByRider.set(id, fd);
  }
  for (const id of unmatched) {
    const fd = formerByRider.get(id);
    if (!fd || fd === id) continue;
    if (todayByCode.has(fd)) {
      suggestedMatches.push({
        file_rider: id,
        former_deal: fd,
        suggested_rider: fd,
        note: `File Former Deal points at ${fd}, which RLMS already holds. Suggestion only — not applied.`,
      });
    }
  }

  const expiredRiders: Array<{ rider_id: string; date: string; cars: number }> = [];
  for (const [id, f] of fileByRider) {
    if (f.date && f.date < snapshotMonth) {
      expiredRiders.push({ rider_id: id, date: f.date, cars: f.cars });
    }
  }
  expiredRiders.sort((a, b) => a.rider_id.localeCompare(b.rider_id));

  return {
    snapshotMonth,
    baseMonth,
    gap,
    totals: {
      file: fileT,
      base: baseT,
      baseMonth,
      baseLabel: baseMonth ? formatMonthLong(baseMonth) : null,
      delta: {
        cars: fileT.cars - (baseT?.cars ?? 0),
        totalBookValue: round2(fileT.totalBookValue - (baseT?.totalBookValue ?? 0)),
        monthlyRent: round2(fileT.monthlyRent - (baseT?.monthlyRent ?? 0)),
        monthlyDepreciation: round2(fileT.monthlyDepreciation - (baseT?.monthlyDepreciation ?? 0)),
      },
    },
    newKeys,
    droppedKeys,
    carCountChanges,
    leaseDateChanges,
    possibleRenewals: leaseDateChanges.filter((x) => x.possible_renewal),
    activeToExpired: leaseDateChanges.filter((x) => x.active_to_expired),
    rentCostChanges,
    statusChanges,
    bvWithinTolerance,
    bvSameCountKeys,
    bvOutliers,
    bvIncreases,
    financedLeasePaydowns,
    riderMismatches,
    suggestedMatches,
    expiredRiders,
    merge: args.merge,
  };
}

export function unmatchedSet(ids: string[] | undefined | null): Set<string> {
  return new Set((ids ?? []).map((x) => String(x).trim().toUpperCase()).filter(Boolean));
}

export function evaluateRiderDateIntegrity(args: {
  unmatchedRiders: string[];
  riderExpirationByCode: Map<string, string | null>;
  fileEarliestDateByRider: Map<string, string>;
  financialRows: Array<{ rider_id?: string | null; lease_exp_date?: string | null }>;
  terms: Array<{ rider_id?: string | null; term_end?: string | null }>;
  multiTermRiders: Iterable<string>;
}): { checked: number; total: number; fail: string[] } {
  const unmatched = unmatchedSet(args.unmatchedRiders);
  const multi = new Set(Array.from(args.multiTermRiders, (x) => String(x).trim().toUpperCase()));
  const termsByRider = new Map<string, Set<string>>();
  for (const t of args.terms) {
    const id = String(t.rider_id ?? "").trim().toUpperCase();
    const end = t.term_end ? String(t.term_end).slice(0, 10) : "";
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(end)) continue;
    const set = termsByRider.get(id) ?? new Set<string>();
    set.add(end);
    termsByRider.set(id, set);
  }
  const fail: string[] = [];
  let checked = 0;
  let total = 0;
  for (const [id, earliest] of Array.from(args.fileEarliestDateByRider.entries())) {
    const ol = id.trim().toUpperCase();
    if (unmatched.has(ol)) continue;
    const rider = args.riderExpirationByCode.get(ol);
    if (rider === undefined) continue;
    total += 1;
    const got = rider ? String(rider).slice(0, 10) : null;
    if (got !== earliest) {
      fail.push(`${ol}: file earliest ${earliest} vs rider ${got ?? "(blank)"}`);
      continue;
    }
    checked += 1;
  }
  for (const r of args.financialRows) {
    const ol = String(r.rider_id ?? "").trim().toUpperCase();
    const got = r.lease_exp_date ? String(r.lease_exp_date).slice(0, 10) : "";
    if (!ol || !got) continue;
    if (unmatched.has(ol)) continue;
    if (args.riderExpirationByCode.get(ol) === undefined) continue;
    if (multi.has(ol)) {
      const terms = termsByRider.get(ol);
      if (!terms || !terms.has(got)) {
        fail.push(`${ol} financial row lease_exp_date ${got} is not a term in rider_lease_terms`);
      }
      continue;
    }
    const expected = args.fileEarliestDateByRider.get(ol);
    if (expected && got !== expected) {
      fail.push(`${ol} financial row lease_exp_date ${got} vs file ${expected}`);
    }
  }
  return { checked, total, fail };
}

export function moneyAbbrev(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
