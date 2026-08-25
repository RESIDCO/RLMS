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

export function transitionPct(complete: number, flagged: number): number | null {
  if (!flagged) return null;
  return Math.round((complete / flagged) * 100);
}
