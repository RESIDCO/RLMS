/**
 * Deal calculator P1 (calc version dc-1.0.0).
 * Pure and deterministic. The browser and the server both call dealCalc
 * so a saved scenario matches the live what-if.
 *
 * Wayne's leveraged bid follows the BFLX workbook: debt is the PV of net
 * rent in advance, equity is the PV of residual, and the unlevered IRR is
 * monthly IRR × 12 on acquisition cost (not the bid) at the first rent date.
 */

export const CALC_VERSION = "dc-1.0.0";

export const DEAL_TYPES = [
  "portfolio_bid",
  "fleet_purchase",
  "off_lease_purchase",
  "sale_leaseback",
  "lease_in",
  "new_build",
] as const;
export type DealType = (typeof DEAL_TYPES)[number];

export const CALC_METHODS = ["wayne_leveraged", "cash_flow", "both"] as const;
export type CalcMethod = (typeof CALC_METHODS)[number];

export const POST_LEASE_PLANS = ["sell", "relet"] as const;
export type PostLeasePlan = (typeof POST_LEASE_PLANS)[number];

export const RENT_TIMINGS = ["advance"] as const;
export type RentTiming = (typeof RENT_TIMINGS)[number];

export const INPUT_SOURCES = ["default", "line", "company", "user"] as const;
export type InputSource = (typeof INPUT_SOURCES)[number];

export type Sourced<T> = { value: T; source: InputSource };

export type RegEvent = { month: number; perCar: number };

export type DealCalcInputs = {
  dealType: Sourced<DealType>;
  method: Sourced<CalcMethod>;
  closeDate: Sourced<string | null>;
  firstRentDate: Sourced<string | null>;
  rentTiming: Sourced<RentTiming>;
  carCount: Sourced<number>;
  carType: Sourced<string | null>;
  aarCode: Sourced<string | null>;
  avgBuildYear: Sourced<number | null>;
  monthlyRent: Sourced<number>;
  leaseExpiry: Sourced<string | null>;
  lesseeRating: Sourced<string | null>;
  usefulLifeYears: Sourced<number>;
  makeReadyPerCar: Sourced<number>;
  creditLossPct: Sourced<number>;
  rentEscalatorPct: Sourced<number>;
  utilizationPct: Sourced<number>;
  postLeasePlan: Sourced<PostLeasePlan>;
  sell: {
    endValuePerCar: Sourced<number | null>;
    scrapPerCar: Sourced<number>;
  };
  relet: {
    idleMonths: Sourced<number>;
    rentPct: Sourced<number>;
    termMonths: Sourced<number>;
    remarketingPerCar: Sourced<number>;
    storagePerCarMonth: Sourced<number>;
    endValuePerCar: Sourced<number | null>;
  };
  maintPcpm: Sourced<number>;
  maintGrowthPct: Sourced<number>;
  mgmtFeePct: Sourced<number>;
  overheadPcpm: Sourced<number>;
  insurancePcpm: Sourced<number>;
  propTaxPcpm: Sourced<number>;
  regEvents: Sourced<RegEvent[]>;
  targetIrr: Sourced<number>;
  stretchIrr: Sourced<number>;
  discountRate: Sourced<number>;
  wayne: {
    debtBase: Sourced<number>;
    spreadBps: Sourced<number>;
    equityReturn: Sourced<number>;
    debtClosePct: Sourced<number>;
    txnCostPct: Sourced<number>;
    leverageTarget: Sourced<number>;
  };
  testPricePerCar: Sourced<number | null>;
};

export type Verdict = "pass" | "bid" | "stretch";

export type ShockRow = {
  label: string;
  maxBidPerCar: number | null;
  irr: number | null;
  npv: number | null;
};

export type Sensitivity = {
  rent: ShockRow[];
  endValue: ShockRow[];
  maint: ShockRow[];
  idle: ShockRow[];
  discount: ShockRow[];
  target: ShockRow[];
  grid: Array<{ rentPct: number; endValuePct: number; maxBidPerCar: number | null }>;
  breakEvenEndValuePerCar: number | null;
};

export type CashMetrics = {
  maxBidPerCar: number | null;
  stretchBidPerCar: number | null;
  irr: number | null;
  effectiveAnnualIrr: number | null;
  npv: number | null;
  paybackMonths: number | null;
  cashOnCash: number | null;
  lrf: number | null;
  margin: number | null;
  residualShare: number | null;
};

export type WayneMetrics = {
  netRent: number;
  debtRate: number;
  n: number;
  balloon: number;
  debt: number;
  equity: number;
  debtClose: number;
  txnCost: number;
  bidPerCar: number;
  acqPerCar: number;
  leverage: number | null;
  irr: number | null;
  effectiveAnnualIrr: number | null;
  lrf: number | null;
  unleveredCashFlows: number[];
};

export type DealCalcResult = {
  calcVersion: typeof CALC_VERSION;
  inputs: DealCalcInputs;
  nMonths: number;
  closeDate: string;
  firstRentDate: string;
  leaseEndDate: string | null;
  carCount: number;
  cash: CashMetrics;
  wayne: WayneMetrics | null;
  verdict: Verdict;
  reasons: string[];
  flags: string[];
  priceUsed: number | null;
  priceBasis: "test" | "wayne_bid" | "max_bid" | "none";
  monthlyCashFlows: number[];
  cashFlowStart: string;
  sensitivity: Sensitivity;
};

export type Ymd = { y: number; m: number; d: number };

const EMPTY_SENSITIVITY: Sensitivity = {
  rent: [],
  endValue: [],
  maint: [],
  idle: [],
  discount: [],
  target: [],
  grid: [],
  breakEvenEndValuePerCar: null,
};

function sourced<T>(value: T, source: InputSource = "default"): Sourced<T> {
  return { value, source };
}

export function companyDefaultInputs(): DealCalcInputs {
  return {
    dealType: sourced("portfolio_bid"),
    method: sourced("both"),
    closeDate: sourced<string | null>(null),
    firstRentDate: sourced<string | null>(null),
    rentTiming: sourced<RentTiming>("advance"),
    carCount: sourced(1),
    carType: sourced<string | null>(null),
    aarCode: sourced<string | null>(null),
    avgBuildYear: sourced<number | null>(null),
    monthlyRent: sourced(0),
    leaseExpiry: sourced<string | null>(null),
    lesseeRating: sourced<string | null>(null),
    usefulLifeYears: sourced(50),
    makeReadyPerCar: sourced(0),
    creditLossPct: sourced(0),
    rentEscalatorPct: sourced(0),
    utilizationPct: sourced(1),
    postLeasePlan: sourced<PostLeasePlan>("sell"),
    sell: {
      endValuePerCar: sourced<number | null>(null),
      scrapPerCar: sourced(7000),
    },
    relet: {
      idleMonths: sourced(6),
      rentPct: sourced(0.9),
      termMonths: sourced(36),
      remarketingPerCar: sourced(2500),
      storagePerCarMonth: sourced(0),
      endValuePerCar: sourced<number | null>(null),
    },
    maintPcpm: sourced(0),
    maintGrowthPct: sourced(0.03),
    mgmtFeePct: sourced(0),
    overheadPcpm: sourced(0),
    insurancePcpm: sourced(0),
    propTaxPcpm: sourced(0),
    regEvents: sourced<RegEvent[]>([]),
    targetIrr: sourced(0.105),
    stretchIrr: sourced(0.09),
    discountRate: sourced(0.09),
    wayne: {
      debtBase: sourced(0.05),
      spreadBps: sourced(262),
      equityReturn: sourced(0.15),
      debtClosePct: sourced(0.005),
      txnCostPct: sourced(0.005),
      leverageTarget: sourced(0.8),
    },
    testPricePerCar: sourced<number | null>(null),
  };
}

/** Company default stored by the P1 migration. Not undoable reference data. */
export const COMPANY_DEFAULT_NAME = "Residco default 2026";

export function isoToday(now = new Date()): string {
  return formatYmd({ y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: now.getUTCDate() });
}

export function parseYmd(value: string | null | undefined): Ymd | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

export function formatYmd(date: Ymd): string {
  return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
}

export function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(date: Ymd, days: number): Ymd {
  const utc = Date.UTC(date.y, date.m - 1, date.d) + days * 86400000;
  const next = new Date(utc);
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
}

export function addMonths(date: Ymd, months: number): Ymd {
  const index = date.y * 12 + (date.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  const d = Math.min(date.d, lastDayOfMonth(y, m));
  return { y, m, d };
}

/** Excel EOMONTH. */
export function eomonth(date: Ymd, months: number): Ymd {
  const shifted = addMonths({ y: date.y, m: date.m, d: 1 }, months);
  return { y: shifted.y, m: shifted.m, d: lastDayOfMonth(shifted.y, shifted.m) };
}

function isLastDay(date: Ymd): boolean {
  return date.d === lastDayOfMonth(date.y, date.m);
}

/**
 * Excel DAYS360, US/NASD (method FALSE).
 * A starting date on the last day of its month becomes the 30th.
 * An ending date on the last day becomes the 1st of the next month when the
 * start day is before the 30th, otherwise the 30th.
 */
export function days360Us(start: Ymd, end: Ymd): number {
  let y1 = start.y;
  let m1 = start.m;
  let d1 = start.d;
  let y2 = end.y;
  let m2 = end.m;
  let d2 = end.d;
  if (isLastDay({ y: y1, m: m1, d: d1 })) d1 = 30;
  if (isLastDay({ y: y2, m: m2, d: d2 })) {
    if (d1 < 30) {
      m2 += 1;
      if (m2 > 12) {
        m2 = 1;
        y2 += 1;
      }
      d2 = 1;
    } else {
      d2 = 30;
    }
  }
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
}

export function compareYmd(a: Ymd, b: Ymd): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

/** First of the month after close. Excel EOMONTH(close, 0)+1. */
export function firstOfMonthAfter(date: Ymd): Ymd {
  return addDays(eomonth(date, 0), 1);
}

/**
 * Wayne's payment-count date.
 * DAY(expiry) < 10 → first of the expiry month, else first of the next month.
 */
export function wayneLeaseEnd(expiry: Ymd): Ymd {
  if (expiry.d < 10) return addDays(eomonth(expiry, -1), 1);
  return addDays(eomonth(expiry, 0), 1);
}

/** Excel PV. pmt and fv use Excel's sign (money you pay is negative). */
export function excelPv(rate: number, nper: number, pmt: number, fv = 0, type = 0): number {
  if (!Number.isFinite(rate) || !Number.isFinite(nper) || nper < 0) return Number.NaN;
  if (Math.abs(rate) < 1e-14) return -(pmt * nper + fv);
  const pow = Math.pow(1 + rate, nper);
  if (!Number.isFinite(pow) || pow === 0) return Number.NaN;
  return -(pmt * (1 + rate * type) * ((pow - 1) / (rate * pow)) + fv / pow);
}

export function npvAt(monthlyRate: number, cashFlows: number[]): number {
  let total = 0;
  const denom = 1 + monthlyRate;
  for (let t = 0; t < cashFlows.length; t += 1) {
    total += cashFlows[t] / Math.pow(denom, t);
  }
  return total;
}

/** Monthly IRR. Null when the series does not change sign. */
export function irrMonthly(cashFlows: number[]): number | null {
  if (cashFlows.length < 2) return null;
  let positive = false;
  let negative = false;
  for (const flow of cashFlows) {
    if (flow > 1e-8) positive = true;
    else if (flow < -1e-8) negative = true;
  }
  if (!positive || !negative) return null;

  const valueAt = (rate: number) => npvAt(rate, cashFlows);
  let rate = 0.008;
  for (let i = 0; i < 60; i += 1) {
    const value = valueAt(rate);
    let slope = 0;
    for (let t = 1; t < cashFlows.length; t += 1) {
      slope -= (t * cashFlows[t]) / Math.pow(1 + rate, t + 1);
    }
    if (!Number.isFinite(value) || !Number.isFinite(slope) || Math.abs(slope) < 1e-18) break;
    const next = rate - value / slope;
    if (!Number.isFinite(next) || next <= -0.999) break;
    if (Math.abs(next - rate) < 1e-14) return next;
    rate = next;
  }

  let lo = -0.9;
  let hi = 2;
  let loValue = valueAt(lo);
  let hiValue = valueAt(hi);
  if (!Number.isFinite(loValue) || !Number.isFinite(hiValue) || loValue * hiValue > 0) {
    hi = 10;
    hiValue = valueAt(hi);
    if (!Number.isFinite(loValue) || !Number.isFinite(hiValue) || loValue * hiValue > 0) return null;
  }
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    const midValue = valueAt(mid);
    if (!Number.isFinite(midValue)) return null;
    if (Math.abs(midValue) < 1e-8 || hi - lo < 1e-14) return mid;
    if (loValue * midValue <= 0) {
      hi = mid;
      hiValue = midValue;
    } else {
      lo = mid;
      loValue = midValue;
    }
  }
  return (lo + hi) / 2;
}

export function wayneAnnualIrr(cashFlows: number[]): number | null {
  const monthly = irrMonthly(cashFlows);
  return monthly == null ? null : monthly * 12;
}

export function effectiveAnnual(monthlyIrr: number | null): number | null {
  if (monthlyIrr == null) return null;
  return Math.pow(1 + monthlyIrr / 12, 12) - 1;
}

function isDealType(value: unknown): value is DealType {
  return typeof value === "string" && (DEAL_TYPES as readonly string[]).includes(value);
}

function isMethod(value: unknown): value is CalcMethod {
  return typeof value === "string" && (CALC_METHODS as readonly string[]).includes(value);
}

function isPlan(value: unknown): value is PostLeasePlan {
  return value === "sell" || value === "relet";
}

function isSource(value: unknown): value is InputSource {
  return value === "default" || value === "line" || value === "company" || value === "user";
}

function readSourced<T>(raw: unknown, parse: (value: unknown) => T, fallback: Sourced<T>): Sourced<T> {
  if (raw == null) return fallback;
  if (typeof raw === "object" && raw !== null && "value" in raw) {
    const record = raw as { value: unknown; source?: unknown };
    const source = isSource(record.source) ? record.source : "user";
    return { value: parse(record.value), source };
  }
  return { value: parse(raw), source: "user" };
}

function num(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function numOrNull(value: unknown, fallback: number | null): number | null {
  if (value == null || value === "") return fallback;
  const parsed = num(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function textOrNull(value: unknown, fallback: string | null): string | null {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text ? text : null;
}

function events(value: unknown): RegEvent[] {
  if (!Array.isArray(value)) return [];
  const out: RegEvent[] = [];
  for (const item of value) {
    if (item == null || typeof item !== "object") continue;
    const record = item as { month?: unknown; perCar?: unknown };
    const month = num(record.month, Number.NaN);
    const perCar = num(record.perCar, Number.NaN);
    if (!Number.isFinite(month) || !Number.isFinite(perCar)) continue;
    out.push({ month, perCar });
  }
  return out;
}

export function normalizeInputs(raw: unknown): DealCalcInputs {
  const base = companyDefaultInputs();
  const body = raw != null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sell = body.sell != null && typeof body.sell === "object" ? (body.sell as Record<string, unknown>) : {};
  const relet = body.relet != null && typeof body.relet === "object" ? (body.relet as Record<string, unknown>) : {};
  const wayne = body.wayne != null && typeof body.wayne === "object" ? (body.wayne as Record<string, unknown>) : {};
  return {
    dealType: readSourced(body.dealType, (value) => (isDealType(value) ? value : base.dealType.value), base.dealType),
    method: readSourced(body.method, (value) => (isMethod(value) ? value : base.method.value), base.method),
    closeDate: readSourced(body.closeDate, (value) => textOrNull(value, null), base.closeDate),
    firstRentDate: readSourced(body.firstRentDate, (value) => textOrNull(value, null), base.firstRentDate),
    rentTiming: readSourced(body.rentTiming, () => "advance" as const, base.rentTiming),
    carCount: readSourced(body.carCount, (value) => Math.max(0, num(value, base.carCount.value)), base.carCount),
    carType: readSourced(body.carType, (value) => textOrNull(value, null), base.carType),
    aarCode: readSourced(body.aarCode, (value) => textOrNull(value, null), base.aarCode),
    avgBuildYear: readSourced(body.avgBuildYear, (value) => {
      const parsed = numOrNull(value, null);
      return parsed == null ? null : Math.trunc(parsed);
    }, base.avgBuildYear),
    monthlyRent: readSourced(body.monthlyRent, (value) => num(value, base.monthlyRent.value), base.monthlyRent),
    leaseExpiry: readSourced(body.leaseExpiry, (value) => textOrNull(value, null), base.leaseExpiry),
    lesseeRating: readSourced(body.lesseeRating, (value) => textOrNull(value, null), base.lesseeRating),
    usefulLifeYears: readSourced(body.usefulLifeYears, (value) => num(value, base.usefulLifeYears.value), base.usefulLifeYears),
    makeReadyPerCar: readSourced(body.makeReadyPerCar, (value) => num(value, 0), base.makeReadyPerCar),
    creditLossPct: readSourced(body.creditLossPct, (value) => num(value, 0), base.creditLossPct),
    rentEscalatorPct: readSourced(body.rentEscalatorPct, (value) => num(value, 0), base.rentEscalatorPct),
    utilizationPct: readSourced(body.utilizationPct, (value) => num(value, 1), base.utilizationPct),
    postLeasePlan: readSourced(body.postLeasePlan, (value) => (isPlan(value) ? value : "sell"), base.postLeasePlan),
    sell: {
      endValuePerCar: readSourced(sell.endValuePerCar, (value) => numOrNull(value, null), base.sell.endValuePerCar),
      scrapPerCar: readSourced(sell.scrapPerCar, (value) => num(value, 7000), base.sell.scrapPerCar),
    },
    relet: {
      idleMonths: readSourced(relet.idleMonths, (value) => Math.max(0, num(value, 6)), base.relet.idleMonths),
      rentPct: readSourced(relet.rentPct, (value) => num(value, 0.9), base.relet.rentPct),
      termMonths: readSourced(relet.termMonths, (value) => Math.max(0, num(value, 36)), base.relet.termMonths),
      remarketingPerCar: readSourced(relet.remarketingPerCar, (value) => num(value, 2500), base.relet.remarketingPerCar),
      storagePerCarMonth: readSourced(relet.storagePerCarMonth, (value) => num(value, 0), base.relet.storagePerCarMonth),
      endValuePerCar: readSourced(relet.endValuePerCar, (value) => numOrNull(value, null), base.relet.endValuePerCar),
    },
    maintPcpm: readSourced(body.maintPcpm, (value) => num(value, 0), base.maintPcpm),
    maintGrowthPct: readSourced(body.maintGrowthPct, (value) => num(value, 0.03), base.maintGrowthPct),
    mgmtFeePct: readSourced(body.mgmtFeePct, (value) => num(value, 0), base.mgmtFeePct),
    overheadPcpm: readSourced(body.overheadPcpm, (value) => num(value, 0), base.overheadPcpm),
    insurancePcpm: readSourced(body.insurancePcpm, (value) => num(value, 0), base.insurancePcpm),
    propTaxPcpm: readSourced(body.propTaxPcpm, (value) => num(value, 0), base.propTaxPcpm),
    regEvents: readSourced(body.regEvents, events, base.regEvents),
    targetIrr: readSourced(body.targetIrr, (value) => num(value, 0.105), base.targetIrr),
    stretchIrr: readSourced(body.stretchIrr, (value) => num(value, 0.09), base.stretchIrr),
    discountRate: readSourced(body.discountRate, (value) => num(value, 0.09), base.discountRate),
    wayne: {
      debtBase: readSourced(wayne.debtBase, (value) => num(value, 0.05), base.wayne.debtBase),
      spreadBps: readSourced(wayne.spreadBps, (value) => num(value, 262), base.wayne.spreadBps),
      equityReturn: readSourced(wayne.equityReturn, (value) => num(value, 0.15), base.wayne.equityReturn),
      debtClosePct: readSourced(wayne.debtClosePct, (value) => num(value, 0.005), base.wayne.debtClosePct),
      txnCostPct: readSourced(wayne.txnCostPct, (value) => num(value, 0.005), base.wayne.txnCostPct),
      leverageTarget: readSourced(wayne.leverageTarget, (value) => num(value, 0.8), base.wayne.leverageTarget),
    },
    testPricePerCar: readSourced(body.testPricePerCar, (value) => numOrNull(value, null), base.testPricePerCar),
  };
}

type Flat = {
  dealType: DealType;
  method: CalcMethod;
  close: Ymd;
  firstRent: Ymd;
  expiry: Ymd | null;
  leaseEnd: Ymd | null;
  n: number;
  carCount: number;
  buildYear: number | null;
  monthlyRent: number;
  usefulLifeYears: number;
  makeReadyPerCar: number;
  creditLossPct: number;
  rentEscalatorPct: number;
  utilizationPct: number;
  postLeasePlan: PostLeasePlan;
  sellEnd: number | null;
  scrap: number;
  idleMonths: number;
  reletRentPct: number;
  reletTerm: number;
  remarketing: number;
  storage: number;
  reletEnd: number | null;
  maint: number;
  maintGrowth: number;
  mgmtFee: number;
  overhead: number;
  insurance: number;
  propTax: number;
  regEvents: RegEvent[];
  targetIrr: number;
  stretchIrr: number;
  discountRate: number;
  debtBase: number;
  spreadBps: number;
  equityReturn: number;
  debtClosePct: number;
  txnCostPct: number;
  leverageTarget: number;
  testPrice: number | null;
};

function flatten(inputs: DealCalcInputs, todayIso?: string): Flat {
  const today = parseYmd(todayIso ?? isoToday()) ?? { y: 2026, m: 10, d: 20 };
  const close = parseYmd(inputs.closeDate.value) ?? addDays(today, 60);
  const firstRent = parseYmd(inputs.firstRentDate.value) ?? firstOfMonthAfter(close);
  const expiry = parseYmd(inputs.leaseExpiry.value);
  const leaseEnd = expiry ? wayneLeaseEnd(expiry) : null;
  const n = leaseEnd ? days360Us(firstRent, leaseEnd) / 30 : 0;
  const sellEnd = inputs.sell.endValuePerCar.value;
  const reletEnd = inputs.relet.endValuePerCar.value ?? sellEnd;
  return {
    dealType: inputs.dealType.value,
    method: inputs.method.value,
    close,
    firstRent,
    expiry,
    leaseEnd,
    n,
    carCount: inputs.carCount.value,
    buildYear: inputs.avgBuildYear.value,
    monthlyRent: inputs.monthlyRent.value,
    usefulLifeYears: inputs.usefulLifeYears.value,
    makeReadyPerCar: inputs.makeReadyPerCar.value,
    creditLossPct: inputs.creditLossPct.value,
    rentEscalatorPct: inputs.rentEscalatorPct.value,
    utilizationPct: inputs.utilizationPct.value,
    postLeasePlan: inputs.postLeasePlan.value,
    sellEnd,
    scrap: inputs.sell.scrapPerCar.value,
    idleMonths: inputs.relet.idleMonths.value,
    reletRentPct: inputs.relet.rentPct.value,
    reletTerm: inputs.relet.termMonths.value,
    remarketing: inputs.relet.remarketingPerCar.value,
    storage: inputs.relet.storagePerCarMonth.value,
    reletEnd,
    maint: inputs.maintPcpm.value,
    maintGrowth: inputs.maintGrowthPct.value,
    mgmtFee: inputs.mgmtFeePct.value,
    overhead: inputs.overheadPcpm.value,
    insurance: inputs.insurancePcpm.value,
    propTax: inputs.propTaxPcpm.value,
    regEvents: inputs.regEvents.value,
    targetIrr: inputs.targetIrr.value,
    stretchIrr: inputs.stretchIrr.value,
    discountRate: inputs.discountRate.value,
    debtBase: inputs.wayne.debtBase.value,
    spreadBps: inputs.wayne.spreadBps.value,
    equityReturn: inputs.wayne.equityReturn.value,
    debtClosePct: inputs.wayne.debtClosePct.value,
    txnCostPct: inputs.wayne.txnCostPct.value,
    leverageTarget: inputs.wayne.leverageTarget.value,
    testPrice: inputs.testPricePerCar.value,
  };
}

function rentPayments(flat: Flat): number {
  if (!flat.leaseEnd) return 0;
  let count = 0;
  let cursor = flat.firstRent;
  while (compareYmd(cursor, flat.leaseEnd) < 0) {
    count += 1;
    cursor = addMonths(cursor, 1);
    if (count > 1200) break;
  }
  return count;
}

function exitValue(flat: Flat, on: Ymd, typed: number | null): number {
  const age = flat.buildYear == null ? null : on.y - flat.buildYear;
  if (age != null && age >= flat.usefulLifeYears) return flat.scrap;
  return typed ?? 0;
}

type Operating = {
  flows: number[];
  exitIndex: number;
  exitAmount: number;
  lifeReached: boolean;
};

/** Per-car operating flows. Index 0 is the first rent date. Price is not included. */
function operatingFlows(flat: Flat, plan: PostLeasePlan): Operating {
  const rents = rentPayments(flat);
  const flows: number[] = [];
  const push = (index: number, amount: number) => {
    while (flows.length <= index) flows.push(0);
    flows[index] += amount;
  };
  for (let t = 1; t <= rents; t += 1) {
    const year = Math.floor((t - 1) / 12);
    const rent = flat.monthlyRent * Math.pow(1 + flat.rentEscalatorPct, year) * flat.utilizationPct * (1 - flat.creditLossPct);
    const maint = flat.maint * Math.pow(1 + flat.maintGrowth, year);
    const cost = maint + rent * flat.mgmtFee + flat.overhead + flat.insurance + flat.propTax;
    push(t - 1, rent - cost);
  }
  for (const event of flat.regEvents) {
    const month = Math.trunc(event.month);
    if (month >= 1) push(month - 1, -event.perCar);
  }
  let exitIndex = rents;
  let typed = flat.sellEnd;
  if (plan === "relet") {
    const idle = Math.max(0, Math.round(flat.idleMonths));
    for (let i = 0; i < idle; i += 1) push(rents + i, -flat.storage);
    const start = rents + idle;
    push(start, -flat.remarketing);
    const term = Math.max(0, Math.round(flat.reletTerm));
    for (let t = 1; t <= term; t += 1) {
      const year = Math.floor((t - 1) / 12);
      const rent = flat.monthlyRent * flat.reletRentPct * Math.pow(1 + flat.rentEscalatorPct, year) * flat.utilizationPct * (1 - flat.creditLossPct);
      const maint = flat.maint * Math.pow(1 + flat.maintGrowth, year);
      const cost = maint + rent * flat.mgmtFee + flat.overhead + flat.insurance + flat.propTax;
      push(start + t - 1, rent - cost);
    }
    exitIndex = start + term;
    typed = flat.reletEnd ?? flat.sellEnd;
  }
  const exitDate = addMonths(flat.firstRent, exitIndex);
  const amount = flat.leaseEnd || plan === "relet" ? exitValue(flat, exitDate, typed) : 0;
  if (amount !== 0) push(exitIndex, amount);
  const age = flat.buildYear == null ? null : exitDate.y - flat.buildYear;
  return {
    flows,
    exitIndex,
    exitAmount: amount,
    lifeReached: age != null && age >= flat.usefulLifeYears,
  };
}

function priceOutflow(price: number, flat: Flat): number {
  return price + flat.makeReadyPerCar + flat.txnCostPct * price;
}

/**
 * Price that sets NPV to zero at annual rate r.
 * CF_0 = -(price × (1 + txn) + make-ready) + operating_0.
 * With make-ready 0 this is PV(operating) / (1 + txn).
 */
export function maxBidAtRate(operating: number[], annualRate: number, makeReady: number, txnCostPct: number): number | null {
  if (!Number.isFinite(annualRate)) return null;
  const monthly = annualRate / 12;
  const present = npvAt(monthly, operating);
  const denom = 1 + txnCostPct;
  if (!Number.isFinite(present) || Math.abs(denom) < 1e-12) return null;
  return (present - makeReady) / denom;
}

function cashFlowsAtPrice(operating: number[], price: number, flat: Flat): number[] {
  const flows = operating.slice();
  if (flows.length === 0) flows.push(0);
  flows[0] -= priceOutflow(price, flat);
  return flows;
}

function paybackMonth(flows: number[]): number | null {
  let running = 0;
  for (let t = 0; t < flows.length; t += 1) {
    running += flows[t];
    if (running >= -1e-6) return t;
  }
  return null;
}

function residualShare(exitAmount: number, exitIndex: number, discountRate: number, price: number): number | null {
  if (!(price > 0)) return null;
  const pv = exitAmount / Math.pow(1 + discountRate / 12, exitIndex);
  return pv / price;
}

function emptyCash(): CashMetrics {
  return {
    maxBidPerCar: null,
    stretchBidPerCar: null,
    irr: null,
    effectiveAnnualIrr: null,
    npv: null,
    paybackMonths: null,
    cashOnCash: null,
    lrf: null,
    margin: null,
    residualShare: null,
  };
}

function cashMetrics(flat: Flat, operating: Operating, price: number | null): CashMetrics {
  const maxBid = maxBidAtRate(operating.flows, flat.targetIrr, flat.makeReadyPerCar, flat.txnCostPct);
  const stretch = maxBidAtRate(operating.flows, flat.stretchIrr, flat.makeReadyPerCar, flat.txnCostPct);
  const metrics = emptyCash();
  metrics.maxBidPerCar = maxBid;
  metrics.stretchBidPerCar = stretch;
  metrics.margin = flat.monthlyRent - flat.maint;
  if (price == null) return metrics;
  const flows = cashFlowsAtPrice(operating.flows, price, flat);
  const monthly = irrMonthly(flows);
  metrics.irr = monthly == null ? null : monthly * 12;
  metrics.effectiveAnnualIrr = effectiveAnnual(metrics.irr);
  metrics.npv = npvAt(flat.discountRate / 12, flows);
  metrics.paybackMonths = paybackMonth(flows);
  if (price !== 0) {
    const year = operating.flows.slice(0, 12).reduce((sum, item) => sum + item, 0);
    metrics.cashOnCash = year / price;
    metrics.lrf = flat.monthlyRent / price;
  }
  metrics.residualShare = residualShare(operating.exitAmount, operating.exitIndex, flat.discountRate, price);
  return metrics;
}

/**
 * BFLX rent block row 326 onward points at a date five rows earlier than the
 * cash-flow month. From cash-flow month 46 the rent test uses that earlier
 * date, so five extra net-rent payments land after a long lease end, and the
 * residual month includes rent. Cached IRRs include this. Short deals end
 * before month 46 and are unchanged.
 */
const WAYNE_RENT_LAG_START = 46;
const WAYNE_RENT_LAG_MONTHS = 5;

function wayneUnleveredFlows(flat: Flat, acq: number, netRent: number, rv: number): number[] {
  if (!flat.leaseEnd) return [-acq];
  const endIndex = (flat.leaseEnd.y - flat.firstRent.y) * 12 + (flat.leaseEnd.m - flat.firstRent.m);
  const lastRentIndex = endIndex >= WAYNE_RENT_LAG_START ? endIndex + WAYNE_RENT_LAG_MONTHS - 1 : endIndex - 1;
  const lastIndex = Math.max(endIndex, lastRentIndex);
  const flows = new Array<number>(Math.max(1, lastIndex + 1)).fill(0);
  for (let t = 0; t <= lastIndex; t += 1) {
    const rentIndex = t >= WAYNE_RENT_LAG_START ? t - WAYNE_RENT_LAG_MONTHS : t;
    if (rentIndex < endIndex) flows[t] += netRent;
  }
  if (endIndex >= 0 && endIndex < flows.length) flows[endIndex] += rv;
  flows[0] -= acq;
  return flows;
}

function wayneMetrics(flat: Flat): WayneMetrics | null {
  const payments = flat.n;
  if (!(payments > 0) || !flat.leaseEnd) return null;
  const netRent = flat.monthlyRent - flat.maint;
  const debtRate = flat.debtBase + flat.spreadBps / 10000;
  const equityRate = flat.equityReturn;
  const monthlyDebt = debtRate / 12;
  const monthlyEquity = equityRate / 12;
  const rv = flat.sellEnd ?? 0;
  const leverage = flat.leverageTarget;
  let balloon = 0;
  if (leverage > 0 && leverage < 1) {
    const k = (1 - leverage) / leverage;
    const pvRv = excelPv(monthlyEquity, payments, 0, -rv, 0);
    const pvDebtSvc = excelPv(monthlyDebt, payments, -netRent, 0, 1);
    const rv1Eq = excelPv(monthlyEquity, payments, 0, -1, 0);
    const rv1Debt = excelPv(monthlyDebt, payments, 0, -1, 0);
    const denom = rv1Eq + k * rv1Debt;
    if (Number.isFinite(denom) && Math.abs(denom) > 1e-12) {
      balloon = Math.max((pvRv - k * pvDebtSvc) / denom, 0);
    }
  }
  const debtService = excelPv(monthlyDebt, payments, -netRent, 0, 1);
  const debtBalloon = excelPv(monthlyDebt, payments, 0, -balloon, 0);
  const debt = debtService + debtBalloon;
  const equity = excelPv(monthlyEquity, payments, 0, -(rv - balloon), 0);
  const debtClose = flat.debtClosePct * debt;
  const txnCost = flat.txnCostPct * (debt + equity);
  const bid = debt + equity - debtClose - txnCost;
  const acq = debt + equity;
  const flows = wayneUnleveredFlows(flat, acq, netRent, rv);
  const monthly = irrMonthly(flows);
  const irr = monthly == null ? null : monthly * 12;
  return {
    netRent,
    debtRate,
    n: payments,
    balloon,
    debt,
    equity,
    debtClose,
    txnCost,
    bidPerCar: bid,
    acqPerCar: acq,
    leverage: acq !== 0 ? debt / acq : null,
    irr,
    effectiveAnnualIrr: effectiveAnnual(irr),
    lrf: bid !== 0 ? netRent / bid : null,
    unleveredCashFlows: flows,
  };
}

function wantsWayne(method: CalcMethod): boolean {
  switch (method) {
    case "wayne_leveraged":
    case "both":
      return true;
    case "cash_flow":
      return false;
    default: {
      const neverMethod: never = method;
      return neverMethod;
    }
  }
}

function pickDisplay(metrics: CashMetrics): Pick<CashMetrics, "irr" | "effectiveAnnualIrr" | "npv" | "paybackMonths" | "cashOnCash" | "lrf" | "residualShare"> {
  return {
    irr: metrics.irr,
    effectiveAnnualIrr: metrics.effectiveAnnualIrr,
    npv: metrics.npv,
    paybackMonths: metrics.paybackMonths,
    cashOnCash: metrics.cashOnCash,
    lrf: metrics.lrf,
    residualShare: metrics.residualShare,
  };
}

type Core = Omit<DealCalcResult, "inputs" | "sensitivity"> & { operating: Operating };

function evaluate(flat: Flat): Core {
  const plan = flat.postLeasePlan;
  const operating = operatingFlows(flat, plan);
  const priced = cashMetrics(flat, operating, flat.testPrice);
  const cash = flat.testPrice == null && priced.maxBidPerCar != null
    ? { ...priced, ...pickDisplay(cashMetrics(flat, operating, priced.maxBidPerCar)) }
    : priced;
  const wayne = wantsWayne(flat.method) ? wayneMetrics(flat) : null;

  let priceUsed: number | null = flat.testPrice;
  let priceBasis: Core["priceBasis"] = flat.testPrice != null ? "test" : "none";
  if (priceUsed == null && flat.method === "wayne_leveraged" && wayne) {
    priceUsed = wayne.bidPerCar;
    priceBasis = "wayne_bid";
  } else if (priceUsed == null && flat.method === "cash_flow" && cash.maxBidPerCar != null) {
    priceUsed = cash.maxBidPerCar;
    priceBasis = "max_bid";
  } else if (priceUsed == null && flat.method === "both" && wayne) {
    priceUsed = wayne.bidPerCar;
    priceBasis = "wayne_bid";
  }

  let flows = operating.flows.slice();
  let headlineIrr: number | null = null;
  let headlineNpv: number | null = null;
  if (priceBasis === "wayne_bid" && wayne) {
    flows = wayne.unleveredCashFlows.slice();
    headlineIrr = wayne.irr;
    headlineNpv = npvAt(flat.discountRate / 12, flows);
  } else if (priceUsed != null) {
    const metrics = cashMetrics(flat, operating, priceUsed);
    cash.irr = metrics.irr;
    cash.effectiveAnnualIrr = metrics.effectiveAnnualIrr;
    cash.npv = metrics.npv;
    cash.paybackMonths = metrics.paybackMonths;
    cash.cashOnCash = metrics.cashOnCash;
    cash.lrf = metrics.lrf;
    cash.residualShare = metrics.residualShare;
    flows = cashFlowsAtPrice(operating.flows, priceUsed, flat);
    headlineIrr = metrics.irr;
    headlineNpv = metrics.npv;
  }

  const flags: string[] = [];
  if (flat.monthlyRent > 0 && flat.maint > 0.25 * flat.monthlyRent) {
    flags.push("Maintenance is more than 25% of rent.");
  }
  if (operating.lifeReached) flags.push("Cars reach useful life before the hold ends.");
  if (flat.n > 0 && flat.n < 12) flags.push("Remaining term is under 12 months.");
  const share = cash.residualShare;
  if (share != null && share > 0.5 && flat.n > 0 && flat.n < 36) {
    flags.push("More than half the value is residual and the term is under 3 years.");
  }
  if (flat.sellEnd == null && flat.postLeasePlan === "sell") flags.push("End value is blank, so the sale proceeds are treated as zero.");
  if (!flat.leaseEnd) flags.push("Lease expiry is missing, so there is no rent term.");

  const reasons: string[] = [];
  let verdict: Verdict = "pass";
  if (headlineIrr == null) {
    reasons.push("No IRR at this price.");
    verdict = "pass";
  } else if (headlineIrr >= flat.targetIrr) {
    reasons.push(`IRR ${(headlineIrr * 100).toFixed(2)}% is at or above the ${(flat.targetIrr * 100).toFixed(2)}% target.`);
    verdict = "bid";
  } else if (headlineIrr >= flat.stretchIrr) {
    reasons.push(`IRR ${(headlineIrr * 100).toFixed(2)}% is between the ${(flat.stretchIrr * 100).toFixed(2)}% stretch and the ${(flat.targetIrr * 100).toFixed(2)}% target.`);
    verdict = "stretch";
  } else {
    reasons.push(`IRR ${(headlineIrr * 100).toFixed(2)}% is below the ${(flat.stretchIrr * 100).toFixed(2)}% stretch.`);
    verdict = "pass";
  }
  if (headlineNpv != null && headlineNpv < 0) {
    reasons.push("NPV at the discount rate is negative.");
    verdict = "pass";
  } else if (headlineNpv != null) {
    reasons.push("NPV at the discount rate is zero or positive.");
  }

  return {
    calcVersion: CALC_VERSION,
    nMonths: flat.n,
    closeDate: formatYmd(flat.close),
    firstRentDate: formatYmd(flat.firstRent),
    leaseEndDate: flat.leaseEnd ? formatYmd(flat.leaseEnd) : null,
    carCount: flat.carCount,
    cash,
    wayne,
    verdict,
    reasons,
    flags,
    priceUsed,
    priceBasis,
    monthlyCashFlows: flows,
    cashFlowStart: formatYmd(flat.firstRent),
    operating,
  };
}

function shock(flat: Flat, patch: Partial<Flat>): { maxBid: number | null; irr: number | null; npv: number | null } {
  const next = { ...flat, ...patch };
  const operating = operatingFlows(next, next.postLeasePlan);
  const maxBid = maxBidAtRate(operating.flows, next.targetIrr, next.makeReadyPerCar, next.txnCostPct);
  const price = next.testPrice ?? maxBid;
  if (price == null) return { maxBid, irr: null, npv: null };
  const flows = cashFlowsAtPrice(operating.flows, price, next);
  const monthly = irrMonthly(flows);
  return {
    maxBid,
    irr: monthly == null ? null : monthly * 12,
    npv: npvAt(next.discountRate / 12, flows),
  };
}

function row(label: string, value: { maxBid: number | null; irr: number | null; npv: number | null }): ShockRow {
  return { label, maxBidPerCar: value.maxBid, irr: value.irr, npv: value.npv };
}

function sensitivity(flat: Flat): Sensitivity {
  const rentShocks = [-0.2, -0.1, 0, 0.1, 0.2];
  const endShocks = [-0.4, -0.2, 0, 0.2, 0.4];
  const rent = rentShocks.map((pct) => row(
    pct === 0 ? "Rent" : `Rent ${pct > 0 ? "+" : ""}${Math.round(pct * 100)}%`,
    shock(flat, { monthlyRent: flat.monthlyRent * (1 + pct) }),
  ));
  const endBase = flat.postLeasePlan === "relet" ? (flat.reletEnd ?? 0) : (flat.sellEnd ?? 0);
  const endValue = endShocks.map((pct) => {
    const next = endBase * (1 + pct);
    const patch = flat.postLeasePlan === "relet" ? { reletEnd: next } : { sellEnd: next };
    return row(pct === 0 ? "End value" : `End value ${pct > 0 ? "+" : ""}${Math.round(pct * 100)}%`, shock(flat, patch));
  });
  const maintFactors = [0.5, 1, 1.5, 2];
  const maint = maintFactors.map((factor) => row(
    factor === 1 ? "Maintenance" : `Maintenance ×${factor}`,
    shock(flat, { maint: flat.maint * factor }),
  ));
  if (flat.maint === 0) maint.push(row("Maintenance +$50", shock(flat, { maint: 50 })));
  const idle = [0, 6, 12, 24].map((months) => row(
    `Re-let idle ${months} mo`,
    shock(flat, { postLeasePlan: "relet", idleMonths: months }),
  ));
  const discount = [-0.02, 0, 0.02].map((delta) => row(
    delta === 0 ? "Discount rate" : `Discount ${delta > 0 ? "+" : ""}${Math.round(delta * 100)} pt`,
    shock(flat, { discountRate: flat.discountRate + delta }),
  ));
  const target = [-0.02, 0, 0.02].map((delta) => row(
    delta === 0 ? "Target IRR" : `Target ${delta > 0 ? "+" : ""}${Math.round(delta * 100)} pt`,
    shock(flat, { targetIrr: flat.targetIrr + delta }),
  ));
  const grid: Sensitivity["grid"] = [];
  for (const rentPct of rentShocks) {
    for (const endPct of endShocks) {
      const nextEnd = endBase * (1 + endPct);
      const patch: Partial<Flat> = { monthlyRent: flat.monthlyRent * (1 + rentPct) };
      if (flat.postLeasePlan === "relet") patch.reletEnd = nextEnd;
      else patch.sellEnd = nextEnd;
      grid.push({ rentPct, endValuePct: endPct, maxBidPerCar: shock(flat, patch).maxBid });
    }
  }
  return {
    rent,
    endValue,
    maint,
    idle,
    discount,
    target,
    grid,
    breakEvenEndValuePerCar: breakEvenEndValue(flat),
  };
}

function breakEvenEndValue(flat: Flat): number | null {
  const anchor = flat.testPrice ?? (wantsWayne(flat.method) ? wayneMetrics(flat)?.bidPerCar ?? null : null);
  if (anchor == null) return null;
  const bidAt = (end: number) => {
    const patch: Partial<Flat> = flat.postLeasePlan === "relet" ? { reletEnd: end } : { sellEnd: end };
    return shock(flat, patch).maxBid;
  };
  let lo = 0;
  let hi = Math.max(1000, Math.abs(anchor) * 4, Math.abs(flat.sellEnd ?? 0) * 2);
  let hiBid = bidAt(hi);
  let guard = 0;
  while (hiBid != null && hiBid < anchor && guard < 12) {
    hi *= 2;
    hiBid = bidAt(hi);
    guard += 1;
  }
  if (hiBid == null) return null;
  for (let i = 0; i < 50; i += 1) {
    const mid = (lo + hi) / 2;
    const bid = bidAt(mid);
    if (bid == null) return null;
    if (bid < anchor) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function dealCalc(raw: unknown, options?: { today?: string }): DealCalcResult {
  const inputs = normalizeInputs(raw);
  const flat = flatten(inputs, options?.today);
  const core = evaluate(flat);
  const { operating: _operating, ...rest } = core;
  return { ...rest, inputs, sensitivity: sensitivity(flat) };
}

export type PortfolioRollup = {
  cars: number;
  wayneBid: number | null;
  cashMaxBid: number | null;
  irr: number | null;
  avgNetRent: number | null;
  avgEndValue: number | null;
  leverage: number | null;
  weakest: Array<{ label: string; irr: number | null }>;
};

export function portfolioRollup(items: Array<{
  label: string;
  cars: number;
  wayneBidPerCar: number | null;
  cashMaxBidPerCar: number | null;
  netRent: number | null;
  endValue: number | null;
  debtPerCar: number | null;
  acqPerCar: number | null;
  irr: number | null;
  cashFlowStart: string;
  monthlyCashFlows: number[];
}>): PortfolioRollup {
  let cars = 0;
  let wayneBid = 0;
  let wayneKnown = false;
  let cashBid = 0;
  let cashKnown = false;
  let rentSum = 0;
  let rentKnown = false;
  let endSum = 0;
  let endKnown = false;
  let debt = 0;
  let acq = 0;
  const buckets = new Map<string, number>();
  for (const item of items) {
    const count = item.cars;
    if (!(count > 0)) continue;
    cars += count;
    if (item.wayneBidPerCar != null) {
      wayneBid += item.wayneBidPerCar * count;
      wayneKnown = true;
    }
    if (item.cashMaxBidPerCar != null) {
      cashBid += item.cashMaxBidPerCar * count;
      cashKnown = true;
    }
    if (item.netRent != null) {
      rentSum += item.netRent * count;
      rentKnown = true;
    }
    if (item.endValue != null) {
      endSum += item.endValue * count;
      endKnown = true;
    }
    if (item.debtPerCar != null) debt += item.debtPerCar * count;
    if (item.acqPerCar != null) acq += item.acqPerCar * count;
    const start = parseYmd(item.cashFlowStart);
    if (!start) continue;
    item.monthlyCashFlows.forEach((flow, index) => {
      const date = addMonths(start, index);
      const key = `${date.y}-${String(date.m).padStart(2, "0")}`;
      buckets.set(key, (buckets.get(key) ?? 0) + flow * count);
    });
  }
  const keys = [...buckets.keys()].sort();
  const flows: number[] = [];
  if (keys.length) {
    let cursor = parseYmd(`${keys[0]}-01`);
    const last = parseYmd(`${keys[keys.length - 1]}-01`);
    if (cursor && last) {
      while (compareYmd(cursor, last) <= 0) {
        const key = `${cursor.y}-${String(cursor.m).padStart(2, "0")}`;
        flows.push(buckets.get(key) ?? 0);
        cursor = addMonths(cursor, 1);
      }
    }
  }
  const weakest = items
    .filter((item) => item.irr != null)
    .slice()
    .sort((a, b) => (a.irr ?? 0) - (b.irr ?? 0))
    .slice(0, 3)
    .map((item) => ({ label: item.label, irr: item.irr }));
  return {
    cars,
    wayneBid: wayneKnown ? wayneBid : null,
    cashMaxBid: cashKnown ? cashBid : null,
    irr: flows.length ? wayneAnnualIrr(flows) : null,
    avgNetRent: rentKnown && cars > 0 ? rentSum / cars : null,
    avgEndValue: endKnown && cars > 0 ? endSum / cars : null,
    leverage: acq !== 0 ? debt / acq : null,
    weakest,
  };
}

export type LineSeed = {
  car_count?: number | null;
  car_type?: string | null;
  aar_code?: string | null;
  avg_build_year?: number | null;
  lease_rate?: number | null;
  lease_expiry?: string | null;
  lessee_rating?: string | null;
  prelim_price_per_car?: number | null;
  final_price_per_car?: number | null;
};

export type OpportunitySeed = {
  flavor?: string | null;
  type?: string | null;
  expected_close?: string | null;
};

export function dealTypeFromOpportunity(opportunity: OpportunitySeed): DealType {
  if (opportunity.flavor === "portfolio_bid") return "portfolio_bid";
  if (opportunity.type === "sale_leaseback") return "sale_leaseback";
  if (opportunity.type === "purchase") return "fleet_purchase";
  return "fleet_purchase";
}

export function defaultMethodFor(dealType: DealType): CalcMethod {
  switch (dealType) {
    case "portfolio_bid":
      return "both";
    case "fleet_purchase":
    case "off_lease_purchase":
    case "sale_leaseback":
    case "lease_in":
    case "new_build":
      return "cash_flow";
    default: {
      const neverType: never = dealType;
      return neverType;
    }
  }
}

export function buildInputsFromLine(args: {
  opportunity: OpportunitySeed;
  line?: LineSeed | null;
  company?: DealCalcInputs | null;
  today?: string;
}): DealCalcInputs {
  const inputs = normalizeInputs(args.company ?? companyDefaultInputs());
  const dealType = dealTypeFromOpportunity(args.opportunity);
  inputs.dealType = sourced(dealType, "line");
  inputs.method = sourced(defaultMethodFor(dealType), "default");
  if (args.opportunity.expected_close) {
    inputs.closeDate = sourced(args.opportunity.expected_close.slice(0, 10), "line");
    inputs.firstRentDate = sourced(null, "default");
  }
  const line = args.line;
  if (!line) return inputs;
  if (line.car_count != null) inputs.carCount = sourced(line.car_count, "line");
  if (line.car_type) inputs.carType = sourced(line.car_type, "line");
  if (line.aar_code) inputs.aarCode = sourced(line.aar_code, "line");
  if (line.avg_build_year != null) inputs.avgBuildYear = sourced(line.avg_build_year, "line");
  if (line.lease_rate != null) inputs.monthlyRent = sourced(line.lease_rate, "line");
  if (line.lease_expiry) inputs.leaseExpiry = sourced(line.lease_expiry.slice(0, 10), "line");
  if (line.lessee_rating) inputs.lesseeRating = sourced(line.lessee_rating, "line");
  const price = line.final_price_per_car ?? line.prelim_price_per_car;
  if (price != null) inputs.testPricePerCar = sourced(price, "line");
  return inputs;
}

export function resetInput<K extends keyof DealCalcInputs>(current: DealCalcInputs, baseline: DealCalcInputs, key: K): DealCalcInputs {
  return { ...current, [key]: baseline[key] };
}
