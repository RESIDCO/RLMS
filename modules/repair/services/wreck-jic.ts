/**
 * JIC deadline tracker — calendar days from shop arrival (clock zero).
 * Path: shop prepares → owner → RR endorse; estimate upload gated until endorsement.
 */
export type JicClockState = "HIDDEN" | "OPEN" | "DUE_SOON" | "OVERDUE" | "DONE" | "AUTO_ENDORSED";

export type JicClockRow = {
  key: string;
  label: string;
  dueDate: string | null;
  state: JicClockState;
  daysAllowed: number | null;
  pctElapsed: number | null;
  note?: string;
};

export type JicTrackerInput = {
  shopArrivalDate: string | null | Date | undefined;
  jicType?: "STANDARD" | "ALTERNATE" | null;
  jicAmountCents?: number | null;
  jicPreparedAt?: string | null | Date;
  jicSentToOwnerAt?: string | null | Date;
  jicForwardedToRrAt?: string | null | Date;
  jicEndorsedAt?: string | null | Date;
  jicAutoEndorsed?: boolean;
  repairCompleteAt?: string | null | Date;
  /** Optional as-of date for tests (ISO). */
  asOf?: string | Date;
};

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(String(v).slice(0, 10) + "T12:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

function iso(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

/** Add calendar days (not business days). */
export function addCalendarDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((b - a) / 86400000);
}

function clockState(
  arrival: Date,
  due: Date,
  done: Date | null,
  asOf: Date,
  auto = false,
): { state: JicClockState; pctElapsed: number } {
  if (done) {
    return { state: auto ? "AUTO_ENDORSED" : "DONE", pctElapsed: 100 };
  }
  const allowed = Math.max(1, daysBetween(arrival, due));
  const elapsed = daysBetween(arrival, asOf);
  const pct = Math.min(100, Math.round((elapsed / allowed) * 100));
  if (asOf > due) return { state: "OVERDUE", pctElapsed: pct };
  if (pct >= 75) return { state: "DUE_SOON", pctElapsed: pct };
  return { state: "OPEN", pctElapsed: pct };
}

/**
 * Build JIC + billing-limit tracker rows.
 * Hidden/zeroed until shop arrival exists.
 */
export function buildJicTracker(input: JicTrackerInput): {
  ready: boolean;
  endorsed: boolean;
  estimateUploadAllowed: boolean;
  rows: JicClockRow[];
  copy: string;
} {
  const arrival = toDate(input.shopArrivalDate);
  const asOf = toDate(input.asOf) ?? new Date();
  const copy =
    "JIC path: contract shop prepares → sends to car owner → owner submits to damaging road for endorsement. Detailed owner + Resp 3 estimate files only after endorsement.";

  if (!arrival) {
    return {
      ready: false,
      endorsed: false,
      estimateUploadAllowed: false,
      rows: [
        {
          key: "arrival",
          label: "Shop arrival (JIC clock zero)",
          dueDate: null,
          state: "HIDDEN",
          daysAllowed: null,
          pctElapsed: null,
          note: "Set shop arrival to start calendar-day clocks",
        },
      ],
      copy,
    };
  }

  const alt = input.jicType === "ALTERNATE";
  const prepDays = alt ? 45 : 30;
  const sendDays = 15;
  const amount = input.jicAmountCents ?? 0;
  // Alternate auto-endorse: < $25k → 45d; ≥ $25k → 75d (OM 103.B)
  const endorseDays = alt ? (amount >= 25_000_00 ? 75 : 45) : 30;

  const prepDue = addCalendarDays(arrival, prepDays);
  const sendDue = addCalendarDays(arrival, sendDays);
  const endorseDue = addCalendarDays(arrival, endorseDays);

  const prepared = toDate(input.jicPreparedAt);
  const sentOwner = toDate(input.jicSentToOwnerAt);
  const forwarded = toDate(input.jicForwardedToRrAt);
  const endorsed = toDate(input.jicEndorsedAt);
  const repairDone = toDate(input.repairCompleteAt);

  const prep = clockState(arrival, prepDue, prepared, asOf);
  const send = clockState(arrival, sendDue, sentOwner ?? forwarded, asOf);
  const endorse = clockState(
    arrival,
    endorseDue,
    endorsed,
    asOf,
    Boolean(input.jicAutoEndorsed),
  );

  const rows: JicClockRow[] = [
    {
      key: "prep",
      label: `JIC prep (${prepDays} calendar days${alt ? " Alternate" : ""})`,
      dueDate: iso(prepDue),
      state: prep.state,
      daysAllowed: prepDays,
      pctElapsed: prep.pctElapsed,
    },
    {
      key: "send",
      label: "Send / forward (15 calendar days)",
      dueDate: iso(sendDue),
      state: send.state,
      daysAllowed: sendDays,
      pctElapsed: send.pctElapsed,
      note: "Shop → owner → RR",
    },
    {
      key: "endorse",
      label: `Endorse (${endorseDays} calendar days)`,
      dueDate: iso(endorseDue),
      state: endorse.state,
      daysAllowed: endorseDays,
      pctElapsed: endorse.pctElapsed,
    },
  ];

  // Billing-limit rows (OM 112.E) — informational from repair complete
  if (repairDone) {
    const limits: Array<{ key: string; label: string; months: number }> = [
      { key: "bill_br", label: "BR/GB/DC/DM billing (3 mo from repair)", months: 3 },
      { key: "bill_ji", label: "JI billing (6 mo from repair)", months: 6 },
      { key: "bill_abs", label: "Absolute (24 mo from repair)", months: 24 },
    ];
    for (const lim of limits) {
      const due = addCalendarDays(repairDone, lim.months * 30);
      const st = clockState(repairDone, due, null, asOf);
      rows.push({
        key: lim.key,
        label: lim.label,
        dueDate: iso(due),
        state: st.state,
        daysAllowed: lim.months * 30,
        pctElapsed: st.pctElapsed,
      });
    }
  }

  const isEndorsed = Boolean(endorsed) || Boolean(input.jicAutoEndorsed);
  return {
    ready: true,
    endorsed: isEndorsed,
    estimateUploadAllowed: isEndorsed,
    rows,
    copy,
  };
}

/** Gate shop estimate upload until JIC endorsement recorded. */
export function assertEstimateUploadAllowed(input: JicTrackerInput): {
  ok: boolean;
  error?: string;
} {
  const t = buildJicTracker(input);
  if (!t.ready) {
    return { ok: false, error: "Shop arrival date required before JIC / estimate upload path" };
  }
  if (!t.estimateUploadAllowed) {
    return {
      ok: false,
      error:
        "Estimate files gated until JIC endorsement (shop prepares → owner → RR). Record endorsement first.",
    };
  }
  return { ok: true };
}
