export const TRANSITION_STATUSES = ["open", "complete"] as const;
export type TransitionStatus = (typeof TRANSITION_STATUSES)[number];

export const COMMUNICATION_METHODS = [
  "in_person",
  "call",
  "email",
  "phone",
  "meeting",
  "teams",
  "other",
] as const;
export type CommunicationMethod = (typeof COMMUNICATION_METHODS)[number];

export const COMMUNICATION_METHOD_LABEL: Record<CommunicationMethod, string> = {
  in_person: "In person",
  call: "Call",
  email: "Email",
  phone: "Phone",
  meeting: "Meeting",
  teams: "Teams",
  other: "Other",
};

export function isTransitionStatus(v: string): v is TransitionStatus {
  return (TRANSITION_STATUSES as readonly string[]).includes(v);
}

export function isCommunicationMethod(v: string): v is CommunicationMethod {
  return (COMMUNICATION_METHODS as readonly string[]).includes(v);
}

export function isFlaggedTransition(toAccountManager: string | null | undefined): boolean {
  return Boolean(String(toAccountManager ?? "").trim());
}

export type HandoffScoreInput = {
  to_account_manager?: string | null;
  meeting_scheduled?: boolean | null;
  communication_completed?: boolean | null;
};

/** One-third each: Incoming AM, Meeting Scheduled, Communication Completed. */
export function handoffScoreParts(r: HandoffScoreInput) {
  const incoming = isFlaggedTransition(r.to_account_manager);
  const meeting = Boolean(r.meeting_scheduled);
  const communication = Boolean(r.communication_completed);
  const hits = (incoming ? 1 : 0) + (meeting ? 1 : 0) + (communication ? 1 : 0);
  return {
    incoming,
    meeting,
    communication,
    hits,
    pct: Math.round((100 * hits) / 3),
  };
}

export function accountHandoffPct(r: HandoffScoreInput): number {
  return handoffScoreParts(r).pct;
}

/** Average of the Section 4 expression over flagged accounts only. Null when none are flagged. */
export function flaggedHandoffAvgPct(rows: HandoffScoreInput[]): number | null {
  const flagged = rows.filter((r) => isFlaggedTransition(r.to_account_manager));
  if (!flagged.length) return null;
  const avg = flagged.reduce((sum, r) => sum + (100 * handoffScoreParts(r).hits) / 3, 0) / flagged.length;
  return Math.round(avg);
}

export const METHOD_LIST_TAG: Record<string, { label: string; rowClass: string; rowStyle: { backgroundColor: string } }> = {
  in_person: { label: "Face to Face", rowClass: "bg-emerald-500/10", rowStyle: { backgroundColor: "rgba(16,185,129,.1)" } },
  call: { label: "Virtual", rowClass: "bg-amber-400/15", rowStyle: { backgroundColor: "rgba(251,191,36,.15)" } },
  email: { label: "Email", rowClass: "bg-red-500/10", rowStyle: { backgroundColor: "rgba(239,68,68,.1)" } },
};

export function methodListTag(method: string | null | undefined) {
  const m = String(method ?? "").trim();
  if (!m) return null;
  return (
    METHOD_LIST_TAG[m] ?? {
      label: COMMUNICATION_METHOD_LABEL[m as CommunicationMethod] ?? m,
      rowClass: "",
      rowStyle: { backgroundColor: "transparent" },
    }
  );
}

export function displayTransitionAm(v: string | null | undefined): string {
  const s = String(v ?? "").trim();
  return s || "Not assigned";
}
