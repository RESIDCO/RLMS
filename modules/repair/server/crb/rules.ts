/**
 * CRB audit rule evaluation and the OM 112.H.3 error-% calculator.
 * Pure functions. Parameter rows are loaded from repair.audit_rules.
 */
import { isTimeBarred, monthIndex, yymmddToIso } from "./parse500";

export type Severity = "INFO" | "WARN" | "HARD_STOP";

export type SeedRule = {
  code: string;
  name: string;
  description: string;
  ruleRef: string;
  params: Record<string, unknown>;
  severity: Severity;
};

export const SEED_RULES: SeedRule[] = [
  {
    code: "R112_RECEIPT_DATE",
    name: "Receipt date",
    description: "Receipt is the later of DX availability and the biller invoice received date.",
    ruleRef: "OM 112.H.2",
    params: {},
    severity: "WARN",
  },
  {
    code: "R112_RETURN_WINDOW",
    name: "Return unpaid window",
    description: "Whole-invoice return unpaid deadline.",
    ruleRef: "OM 112.H.3.a",
    params: { days: 60 },
    severity: "WARN",
  },
  {
    code: "R112_ERROR_TIERS",
    name: "Error percent tiers",
    description: "Net exception percent limits by invoice total. Comparison is strict exceeds.",
    ruleRef: "OM 112.H.3",
    params: {
      tiers: [
        { max: 10000, pct: 10 },
        { max: 200000, pct: 7.5 },
        { max: null, pct: 5 },
      ],
      comparison: "exceeds",
    },
    severity: "WARN",
  },
  {
    code: "R112_PAID_EXC_WINDOW",
    name: "Paid exception window",
    description: "Paid-invoice exception window, with a leased-offset extension.",
    ruleRef: "OM 112.H.4.a",
    params: { months: 7, leased_offset_months: 10 },
    severity: "WARN",
  },
  {
    code: "R112_MIN_AGGREGATE",
    name: "Minimum aggregate",
    description: "No exception unless the aggregate meets the minimum or an exempt type is present.",
    ruleRef: "OM 112.H.4.d",
    params: {
      min: 100,
      exempt_types: ["CAR_NUMBER", "REPORTING_MARK", "PRICE_MASTER", "TIME_LIMIT_GUARANTEE"],
    },
    severity: "WARN",
  },
  {
    code: "R112_ALL_AT_ONCE",
    name: "All exceptions at once",
    description: "Later letters may add only exempt types.",
    ruleRef: "OM 112.H.4.e",
    params: {
      exempt: [
        "TIME_LIMIT_GUARANTEE",
        "DUPLICATE",
        "WRONG_REPAIR",
        "MATERIAL_R85",
        "OVER_SETTLEMENT_VALUE",
      ],
    },
    severity: "WARN",
  },
  {
    code: "R112_RESPONSE_DUE",
    name: "Biller response due",
    description: "Initial and subsequent biller response deadlines.",
    ruleRef: "OM 112.H.4.k-l",
    params: { initial_days: 120, subsequent_days: 90 },
    severity: "WARN",
  },
  {
    code: "R112_BILLING_TIME_LIMIT",
    name: "Billing time limit",
    description: "Detail-source age counted through the DX month. A January repair may appear on the May DX when the limit is 3.",
    ruleRef: "OM 112.E",
    params: {
      months_by_detail_source: {
        BR: 3,
        GB: 3,
        DC: 3,
        DM: 3,
        DE: 3,
        MA: 3,
        JI: 6,
        JD: 6,
        RE: 6,
        JR: 6,
        DR: 6,
        CB: 6,
        OT: 6,
        SH: 12,
      },
    },
    severity: "WARN",
  },
  {
    code: "R112_RESUBMIT_24MO",
    name: "Resubmit within 24 months",
    description: "A resubmitted invoice repair date must fall within 24 months.",
    ruleRef: "OM 112.E.2",
    params: { months: 24 },
    severity: "WARN",
  },
  {
    code: "R112_PROPERLY_RENDERED",
    name: "Properly rendered",
    description: "Detail-source subtotals and the grand total must match the DX.",
    ruleRef: "OM 112.G",
    params: {},
    severity: "HARD_STOP",
  },
  {
    code: "R111_PRICE",
    name: "Price master",
    description: "Reprice machine-priceable lines against the price master.",
    ruleRef: "OM 111",
    params: { tolerance_cents: 1 },
    severity: "WARN",
  },
  {
    code: "R111_WRONG_REPAIR",
    name: "Wrong repair",
    description: "Why made 08 or 45, or the wrong-repair indicator, puts the full line in question.",
    ruleRef: "OM 111",
    params: { why_made: ["08", "45"] },
    severity: "WARN",
  },
  {
    code: "FM1_LABOR_LIMITS",
    name: "Running repair labor limits",
    description: "Empty-for-loading and boxcar door hour limits.",
    ruleRef: "FM 1.2",
    params: { empty_for_loading_max_hours: 16, boxcar_door_max_hours: 8 },
    severity: "WARN",
  },
  {
    code: "RESP_CODE",
    name: "Responsibility code",
    description: "Responsibility 2 billed to the owner is a handling-line misbill. Responsibility 3 is the damaging road and needs a DC/JIC party.",
    ruleRef: "PM A.3 / OM 112.B-C",
    params: {},
    severity: "WARN",
  },
  {
    code: "DC_VALIDITY",
    name: "Defect card validity",
    description: "DC/JIC date must be inside 48 months and the 4-year expiry.",
    ruleRef: "OM 102.D, 112.E.4",
    params: { repair_within_months: 48, expiry_years: 4 },
    severity: "WARN",
  },
  {
    code: "NOT_OWNED",
    name: "Not owned on repair date",
    description: "Car was not on the Valid Car File for the repair date.",
    ruleRef: "OM 112.H",
    params: {},
    severity: "HARD_STOP",
  },
  {
    code: "NO_LEASE",
    name: "No active lease",
    description: "No lease and lessee in effect on the repair date.",
    ruleRef: "OM 112.H",
    params: {},
    severity: "WARN",
  },
  {
    code: "DUPLICATE_BILLING",
    name: "Duplicate billing",
    description: "Same car, job, location, and qualifier inside the window, or the same repairing-party invoice.",
    ruleRef: "OM 112.H.4.e",
    params: { window_days: 30 },
    severity: "WARN",
  },
  {
    code: "CONTROL_TOTALS",
    name: "Control totals",
    description: "Format 9 control does not match format 1 detail.",
    ruleRef: "PM App G",
    params: {},
    severity: "HARD_STOP",
  },
  {
    code: "BILLER_RECON",
    name: "Biller invoice reconciliation",
    description: "Entered biller invoice header vs the CRB invoice.",
    ruleRef: "OM 112.G.1-2",
    params: {},
    severity: "WARN",
  },
  {
    code: "INVALID_EXCEPTION_GUARD",
    name: "Invalid exception guard",
    description: "A price below the price master must not be filed as an overcharge.",
    ruleRef: "PM Y.1.1",
    params: {},
    severity: "WARN",
  },
  {
    code: "MARK_NOT_RESIDCO",
    name: "Mark not RESIDCO",
    description: "Reporting mark is not on the local RESIDCO car file.",
    ruleRef: "OM 112.H",
    params: {},
    severity: "WARN",
  },
];

export type RuleVersion = {
  id?: string;
  code: string;
  version: number;
  params: Record<string, unknown>;
  severity: Severity;
  enabled: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type FindingDraft = {
  code: string;
  scope: "LINE" | "CAR" | "INVOICE" | "FILE";
  message: string;
  amountInQuestionCents: number;
  suggestedCorrectCents: number | null;
  invalid: boolean;
  exemptType: string | null;
  bucketHint: string | null;
};

export type LineFacts = {
  detailSource: string;
  responsibility: string;
  dcParty: string;
  dcDate: string;
  repairDate: string;
  accountDate: string;
  laborCents: number;
  materialCents: number;
  machinePriceable: string;
  wrongRepair: string;
  whyMade: string;
  loadEmpty: string;
  kindOfCar: string;
  narrative: string;
  laborRateCents: number;
  resubmitted: string;
  priceTableLoaded: boolean;
  priceMasterCents: number | null;
  duplicate: boolean;
  owned: boolean | null;
  markResidco: boolean | null;
};

export type Tier = { max: number | null; pct: number };

export function tiersFrom(params: Record<string, unknown> | undefined): Tier[] {
  const raw = params?.tiers;
  if (!Array.isArray(raw) || !raw.length) {
    return [
      { max: 10000, pct: 10 },
      { max: 200000, pct: 7.5 },
      { max: null, pct: 5 },
    ];
  }
  return raw.map((row) => {
    const item = row as { max?: number | null; pct?: number };
    return {
      max: item.max == null ? null : Number(item.max),
      pct: Number(item.pct),
    };
  });
}

/** Basis points (7.5% → 750). Exact integer compare, no rounding before the test. */
export function exceedsLimit(netCents: number, totalCents: number, limitPct: number): boolean {
  if (totalCents <= 0) return false;
  const limitBp = Math.round(limitPct * 100);
  return netCents * 10000 > totalCents * limitBp;
}

export function limitPctForTotal(totalCents: number, tiers: Tier[]): number | null {
  if (totalCents <= 0) return null;
  const dollars = totalCents / 100;
  for (const tier of tiers) {
    if (tier.max == null || dollars <= tier.max + 1e-9) return tier.pct;
  }
  return tiers[tiers.length - 1]?.pct ?? null;
}

export function selectRuleVersion(
  versions: RuleVersion[],
  code: string,
  accountYymm: string,
): RuleVersion | null {
  const idx = monthIndex(accountYymm);
  const matches = versions.filter((rule) => rule.code === code && rule.enabled);
  if (idx == null) {
    return matches.sort((a, b) => b.version - a.version)[0] ?? null;
  }
  const inForce = matches.filter((rule) => {
    const from = monthIndex(rule.effectiveFrom.slice(2, 4) + rule.effectiveFrom.slice(5, 7));
    const to = rule.effectiveTo
      ? monthIndex(rule.effectiveTo.slice(2, 4) + rule.effectiveTo.slice(5, 7))
      : null;
    if (from == null) return false;
    if (idx < from) return false;
    if (to != null && idx > to) return false;
    return true;
  });
  inForce.sort((a, b) => b.version - a.version);
  return inForce[0] ?? null;
}

function lineTotal(line: LineFacts): number {
  return Math.trunc(line.laborCents) + Math.trunc(line.materialCents);
}

function numParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function monthsMap(params: Record<string, unknown>): Record<string, number> {
  const raw = params.months_by_detail_source;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number") out[key] = value;
  }
  return out;
}

export function bucketHintFor(line: LineFacts, hasLease: boolean): string {
  if (line.detailSource === "CB") return "CREDIT";
  if (line.responsibility === "3" || line.dcParty.trim()) return "DAMAGING_ROAD";
  if (line.responsibility === "2") return "HANDLING_LINE_MISBILL";
  if (
    line.whyMade === "08" ||
    line.whyMade === "45" ||
    line.wrongRepair.trim().toUpperCase() === "Y" ||
    line.duplicate
  ) {
    return "BILLER_ERROR";
  }
  if (line.responsibility === "1" && hasLease) return "LESSEE";
  if (line.responsibility === "1") return "OWNER";
  return "OWNER";
}

/**
 * Price-below-PM claimed as an overcharge is an invalid exception (PM Y.1.1).
 * Returns true when the claim must be excluded from the error %.
 */
export function invalidOverchargeClaim(billedCents: number, correctCents: number, claimedOvercharge: boolean): boolean {
  return claimedOvercharge && billedCents < correctCents;
}

export function evaluateLine(line: LineFacts, rules: RuleVersion[]): FindingDraft[] {
  const out: FindingDraft[] = [];
  const byCode = (code: string) => selectRuleVersion(rules, code, line.accountDate);

  const time = byCode("R112_BILLING_TIME_LIMIT");
  if (time) {
    const limits = monthsMap(time.params);
    const limit = limits[line.detailSource];
    if (limit != null && isTimeBarred(line.repairDate, line.accountDate, limit)) {
      out.push({
        code: "R112_BILLING_TIME_LIMIT",
        scope: "LINE",
        message: `Time-barred ${line.detailSource} (limit ${limit} months to the DX). Full line in question.`,
        amountInQuestionCents: lineTotal(line),
        suggestedCorrectCents: 0,
        invalid: false,
        exemptType: null,
        bucketHint: "BILLER_ERROR",
      });
    }
  }

  const resub = byCode("R112_RESUBMIT_24MO");
  if (resub && line.resubmitted.trim().toUpperCase() === "R") {
    const months = numParam(resub.params, "months", 24);
    const repairIdx = line.repairDate.trim().length >= 4
      ? monthIndex(line.repairDate.slice(0, 4))
      : null;
    const accountIdx = monthIndex(line.accountDate);
    if (repairIdx != null && accountIdx != null && accountIdx > repairIdx + months) {
      out.push({
        code: "R112_RESUBMIT_24MO",
        scope: "LINE",
        message: `Resubmitted repair date is outside ${months} months.`,
        amountInQuestionCents: lineTotal(line),
        suggestedCorrectCents: 0,
        invalid: false,
        exemptType: null,
        bucketHint: "BILLER_ERROR",
      });
    }
  }

  const price = byCode("R111_PRICE");
  if (price && line.machinePriceable.trim().toUpperCase() === "Y") {
    const tolerance = numParam(price.params, "tolerance_cents", 1);
    if (!line.priceTableLoaded || line.priceMasterCents == null) {
      out.push({
        code: "R111_PRICE",
        scope: "LINE",
        message: "price check unavailable",
        amountInQuestionCents: 0,
        suggestedCorrectCents: null,
        invalid: false,
        exemptType: "PRICE_MASTER",
        bucketHint: null,
      });
    } else {
      const billed = lineTotal(line);
      const correct = line.priceMasterCents;
      const delta = billed - correct;
      if (Math.abs(delta) > tolerance) {
        const claimedOvercharge = delta > 0;
        const invalid = invalidOverchargeClaim(billed, correct, claimedOvercharge) && billed < correct;
        out.push({
          code: "R111_PRICE",
          scope: "LINE",
          message: delta > 0
            ? `Price overcharge vs price master (${billed} vs ${correct}).`
            : `Price undercharge vs price master (${billed} vs ${correct}).`,
          amountInQuestionCents: delta,
          suggestedCorrectCents: correct,
          invalid,
          exemptType: "PRICE_MASTER",
          bucketHint: "BILLER_ERROR",
        });
      }
    }
  }

  const wrong = byCode("R111_WRONG_REPAIR");
  if (wrong) {
    const codes = Array.isArray(wrong.params.why_made)
      ? (wrong.params.why_made as unknown[]).map((c) => String(c))
      : ["08", "45"];
    const indicator = line.wrongRepair.trim().toUpperCase() === "Y";
    if (codes.includes(line.whyMade.trim()) || indicator) {
      out.push({
        code: "R111_WRONG_REPAIR",
        scope: "LINE",
        message: indicator
          ? "Wrong repair indicator. Full line in question."
          : `Why made ${line.whyMade} wrong repair. Full line in question.`,
        amountInQuestionCents: lineTotal(line),
        suggestedCorrectCents: 0,
        invalid: false,
        exemptType: "WRONG_REPAIR",
        bucketHint: "BILLER_ERROR",
      });
    }
  }

  const labor = byCode("FM1_LABOR_LIMITS");
  if (labor && line.laborRateCents > 0) {
    const hours = line.laborCents / line.laborRateCents;
    const emptyMax = numParam(labor.params, "empty_for_loading_max_hours", 16);
    const doorMax = numParam(labor.params, "boxcar_door_max_hours", 8);
    if (line.loadEmpty.trim().toUpperCase() === "E" && hours > emptyMax) {
      const excess = Math.round((hours - emptyMax) * line.laborRateCents);
      out.push({
        code: "FM1_LABOR_LIMITS",
        scope: "LINE",
        message: `Empty-for-loading labor ${hours.toFixed(2)} h exceeds ${emptyMax} h.`,
        amountInQuestionCents: excess,
        suggestedCorrectCents: Math.round(emptyMax * line.laborRateCents),
        invalid: false,
        exemptType: null,
        bucketHint: "BILLER_ERROR",
      });
    }
    const door =
      (line.kindOfCar.trim().toUpperCase() === "B" || line.kindOfCar.trim().toUpperCase() === "X") &&
      line.narrative.toUpperCase().includes("DOOR");
    if (door && hours > doorMax) {
      const excess = Math.round((hours - doorMax) * line.laborRateCents);
      out.push({
        code: "FM1_LABOR_LIMITS",
        scope: "LINE",
        message: `Boxcar door labor ${hours.toFixed(2)} h exceeds ${doorMax} h.`,
        amountInQuestionCents: excess,
        suggestedCorrectCents: Math.round(doorMax * line.laborRateCents),
        invalid: false,
        exemptType: null,
        bucketHint: "BILLER_ERROR",
      });
    }
  }

  const resp = byCode("RESP_CODE");
  if (resp && line.responsibility.trim() === "2") {
    out.push({
      code: "RESP_CODE",
      scope: "LINE",
      message: "HANDLING_LINE responsibility 2 billed to the owner.",
      amountInQuestionCents: lineTotal(line),
      suggestedCorrectCents: 0,
      invalid: false,
      exemptType: null,
      bucketHint: "HANDLING_LINE_MISBILL",
    });
  }
  if (resp && line.responsibility.trim() === "3" && !line.dcParty.trim()) {
    out.push({
      code: "RESP_CODE",
      scope: "LINE",
      message: "Responsibility 3 damaging road requires a DC/JIC party.",
      amountInQuestionCents: lineTotal(line),
      suggestedCorrectCents: 0,
      invalid: false,
      exemptType: null,
      bucketHint: "DAMAGING_ROAD",
    });
  }

  const dc = byCode("DC_VALIDITY");
  if (dc && line.dcDate.trim() && /^(DC|JI|DR|JR|DE)$/.test(line.detailSource)) {
    const within = numParam(dc.params, "repair_within_months", 48);
    const years = numParam(dc.params, "expiry_years", 4);
    const dcIdx = line.dcDate.trim().length >= 4 ? monthIndex(line.dcDate.slice(0, 4)) : null;
    const repairIdx = line.repairDate.trim().length >= 4 ? monthIndex(line.repairDate.slice(0, 4)) : null;
    const accountIdx = monthIndex(line.accountDate);
    const tooLateRepair =
      dcIdx != null && repairIdx != null && repairIdx > dcIdx + within;
    const expired = dcIdx != null && accountIdx != null && accountIdx > dcIdx + years * 12;
    if (tooLateRepair || expired) {
      out.push({
        code: "DC_VALIDITY",
        scope: "LINE",
        message: expired
          ? "DC/JIC date is past the 4-year expiry."
          : "Repair date is outside 48 months of the DC/JIC date.",
        amountInQuestionCents: lineTotal(line),
        suggestedCorrectCents: 0,
        invalid: false,
        exemptType: null,
        bucketHint: "DAMAGING_ROAD",
      });
    }
  }

  const dup = byCode("DUPLICATE_BILLING");
  if (dup && line.duplicate) {
    out.push({
      code: "DUPLICATE_BILLING",
      scope: "LINE",
      message: "DUPLICATE_BILLING: matches a shop invoice or another CRB line.",
      amountInQuestionCents: lineTotal(line),
      suggestedCorrectCents: 0,
      invalid: false,
      exemptType: "DUPLICATE",
      bucketHint: "BILLER_ERROR",
    });
  }

  if (byCode("NOT_OWNED") && line.owned === false) {
    out.push({
      code: "NOT_OWNED",
      scope: "LINE",
      message: "NOT_OWNED_ON_REPAIR_DATE",
      amountInQuestionCents: lineTotal(line),
      suggestedCorrectCents: 0,
      invalid: false,
      exemptType: null,
      bucketHint: null,
    });
  }
  if (byCode("MARK_NOT_RESIDCO") && line.markResidco === false) {
    out.push({
      code: "MARK_NOT_RESIDCO",
      scope: "LINE",
      message: "MARK_NOT_RESIDCO",
      amountInQuestionCents: 0,
      suggestedCorrectCents: null,
      invalid: false,
      exemptType: "REPORTING_MARK",
      bucketHint: null,
    });
  }
  const guard = byCode("INVALID_EXCEPTION_GUARD");
  if (guard) {
    for (const finding of out) {
      if (
        finding.code === "R111_PRICE" &&
        line.priceMasterCents != null &&
        invalidOverchargeClaim(lineTotal(line), line.priceMasterCents, true)
      ) {
        finding.invalid = true;
        finding.message = finding.message.startsWith("INVALID_EXCEPTION_GUARD")
          ? finding.message
          : `INVALID_EXCEPTION_GUARD: ${finding.message}`;
      }
    }
  }

  return out.filter((finding) => byCode(finding.code));
}

export type PctFinding = {
  status: string;
  amountInQuestionCents: number;
  invalid: boolean;
  exemptType: string | null;
};

export type Countdown = {
  key: string;
  label: string;
  due: string | null;
  daysLeft: number | null;
  tone: "ok" | "warn" | "stop" | "info";
  text: string;
};

export type ErrorPanel = {
  totalCents: number;
  netCents: number;
  pct: number | null;
  limitPct: number | null;
  exceeds: boolean;
  na: boolean;
  improperlyRendered: boolean;
  suggested: "NA" | "RETURN_UNPAID" | "PAY_AND_EXCEPT";
  suggestedLabel: string;
  aggregateCents: number;
  minAggregateCents: number;
  belowMinimum: boolean;
  exemptTypesPresent: string[];
  countdowns: Countdown[];
  headerOrLine: "header" | "line" | null;
};

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

function countdown(key: string, label: string, due: string | null, today: string): Countdown {
  if (!due) {
    return { key, label, due: null, daysLeft: null, tone: "info", text: `${label}: date not set` };
  }
  const daysLeft = daysBetween(today, due);
  let tone: Countdown["tone"] = "ok";
  let state = "On time";
  if (daysLeft < 0) {
    tone = "stop";
    state = "Overdue";
  } else if (daysLeft <= 14) {
    tone = "warn";
    state = "Due soon";
  }
  return {
    key,
    label,
    due,
    daysLeft,
    tone,
    text: `${label}: ${state}, ${daysLeft} days (${due})`,
  };
}

export function receiptDateOf(dxAvailable: string | null, billerReceived: string | null): string | null {
  if (dxAvailable && billerReceived) return dxAvailable > billerReceived ? dxAvailable : billerReceived;
  return dxAvailable || billerReceived || null;
}

export function buildErrorPanel(input: {
  totalCents: number;
  findings: PctFinding[];
  tiers: Tier[];
  minAggregateCents: number;
  minExempt: string[];
  improperlyRendered: boolean;
  receiptDate: string | null;
  today: string;
  returnDays: number;
  paidMonths: number;
  leasedOffsetMonths: number;
  responseInitialDays: number;
  responseSubsequentDays: number;
  cbMonths: number;
  filedAt: string | null;
  responseRound: number;
}): ErrorPanel {
  const countable = input.findings.filter(
    (finding) =>
      !finding.invalid &&
      (finding.status === "OPEN" || finding.status === "ACCEPTED_AS_EXCEPTION"),
  );
  const net = countable.reduce((sum, finding) => sum + Math.trunc(finding.amountInQuestionCents || 0), 0);
  const exemptTypesPresent = [
    ...Array.from(new Set(countable.map((finding) => finding.exemptType).filter((t): t is string => Boolean(t)))),
  ];
  const aggregate = countable
    .filter((finding) => finding.amountInQuestionCents > 0)
    .reduce((sum, finding) => sum + finding.amountInQuestionCents, 0);
  const belowMinimum =
    aggregate < input.minAggregateCents &&
    !exemptTypesPresent.some((t) => input.minExempt.includes(t));
  const na = input.totalCents <= 0;
  const limitPct = na ? null : limitPctForTotal(input.totalCents, input.tiers);
  const exceeds = !na && limitPct != null && exceedsLimit(net, input.totalCents, limitPct);
  const pct = na || input.totalCents === 0 ? null : net / input.totalCents;
  const windowOpen =
    input.receiptDate == null ||
    input.today <= addDaysIso(input.receiptDate, input.returnDays);
  let suggested: ErrorPanel["suggested"] = "PAY_AND_EXCEPT";
  let suggestedLabel = "Pay in full; take exceptions after payment";
  if (na) {
    suggested = "NA";
    suggestedLabel = "N/A (credit invoice; CBA path)";
  } else if ((input.improperlyRendered || exceeds) && windowOpen) {
    suggested = "RETURN_UNPAID";
    suggestedLabel = "Return unpaid (whole invoice)";
  }
  const paidDue = input.receiptDate
    ? addMonthsIso(input.receiptDate, input.paidMonths)
    : null;
  const paidLeaseDue = input.receiptDate
    ? addMonthsIso(input.receiptDate, input.leasedOffsetMonths)
    : null;
  const responseAnchor = input.filedAt ?? null;
  const responseDays = input.responseRound > 0 ? input.responseSubsequentDays : input.responseInitialDays;
  const responseDue = responseAnchor ? addDaysIso(responseAnchor, responseDays) : null;
  const cbDue = input.filedAt ? addMonthsIso(input.filedAt, input.cbMonths) : null;
  return {
    totalCents: input.totalCents,
    netCents: net,
    pct,
    limitPct,
    exceeds,
    na,
    improperlyRendered: input.improperlyRendered,
    suggested,
    suggestedLabel,
    aggregateCents: aggregate,
    minAggregateCents: input.minAggregateCents,
    belowMinimum,
    exemptTypesPresent,
    headerOrLine: suggested === "RETURN_UNPAID" ? "header" : null,
    countdowns: [
      countdown(
        "return_unpaid",
        "Return unpaid (60d)",
        input.receiptDate ? addDaysIso(input.receiptDate, input.returnDays) : null,
        input.today,
      ),
      countdown("paid_exceptions", `Paid exceptions (${input.paidMonths} mo)`, paidDue, input.today),
      countdown(
        "paid_exceptions_lease",
        `Paid exceptions leased offset (${input.leasedOffsetMonths} mo)`,
        paidLeaseDue,
        input.today,
      ),
      countdown(
        "biller_response",
        input.responseRound > 0 ? "Biller response (90d)" : "Biller response (120d)",
        responseDue,
        input.today,
      ),
      countdown("cb_credit", "CB credit expected (6 mo)", cbDue, input.today),
    ],
  };
}

export function datesWithin(a: string | null, b: string | null, days: number): boolean {
  if (!a || !b) return false;
  return Math.abs(daysBetween(a, b)) <= days;
}

export function repairIso(yymmdd: string): string | null {
  return yymmddToIso(yymmdd);
}
