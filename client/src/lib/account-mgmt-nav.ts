import { hashSearchParams, navigateHash } from "@/lib/hash-location";

export type AccountKpiFilter =
  | { kind: "year"; year: number }
  | { kind: "tag"; tag: "good" | "watch" | "risk" }
  | null;

/** Previous list shape. Dashboard still links here; year tiles are not filters anymore. */
export type AccountMgmtListState = {
  manager: string | null;
  kpi: AccountKpiFilter;
  showInactive: boolean;
  search: string;
};

export type BookSegment = "mybook" | "client" | "former" | "prospect";
export type BookChip = "renewals" | "overdue" | "never" | "handoffs" | "unowned" | "untiered";

export type AccountBookListState = {
  segment: BookSegment;
  owner: string;
  tier: string;
  q: string;
  chip: BookChip | null;
};

export const UNASSIGNED_AM = "unassigned";
export const ME_STORAGE_KEY = "rlms.am.me";

const SEGMENTS = new Set<string>(["mybook", "client", "former", "prospect"]);
const CHIPS = new Set<string>(["renewals", "overdue", "never", "handoffs", "unowned", "untiered"]);

export function readMeInitials(): string {
  try {
    return window.localStorage.getItem(ME_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function writeMeInitials(initials: string) {
  const value = initials.trim();
  try {
    if (value) window.localStorage.setItem(ME_STORAGE_KEY, value);
    else window.localStorage.removeItem(ME_STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

export function readAccountBookState(): AccountBookListState {
  const p = hashSearchParams();
  const segment = p.get("segment") ?? "mybook";
  const chip = p.get("chip") ?? "";
  return {
    segment: SEGMENTS.has(segment) ? (segment as BookSegment) : "mybook",
    owner: p.get("owner")?.trim() || "any",
    tier: p.get("tier")?.trim() || "any",
    q: p.get("q") ?? "",
    chip: CHIPS.has(chip) ? (chip as BookChip) : null,
  };
}

/** @deprecated Use readAccountBookState. Kept so older callers still compile. */
export function readAccountMgmtListState(): AccountBookListState {
  return readAccountBookState();
}

export function accountBookQueryString(state: AccountBookListState): string {
  const p = new URLSearchParams();
  if (state.segment && state.segment !== "mybook") p.set("segment", state.segment);
  if (state.owner && state.owner !== "any") p.set("owner", state.owner);
  if (state.tier && state.tier !== "any") p.set("tier", state.tier);
  if (state.q.trim()) p.set("q", state.q.trim());
  if (state.chip) p.set("chip", state.chip);
  const s = p.toString();
  return s ? `?${s}` : "";
}

function isLegacyState(state: AccountBookListState | AccountMgmtListState): state is AccountMgmtListState {
  return "manager" in state && !("segment" in state);
}

export function accountListPath(state: AccountBookListState | AccountMgmtListState): string {
  if (isLegacyState(state)) {
    const owner = !state.manager ? "any" : state.manager === UNASSIGNED_AM ? "unowned" : state.manager;
    return accountListPath({
      segment: "client",
      owner,
      tier: "any",
      q: state.search ?? "",
      chip: null,
    });
  }
  return `/accounts${accountBookQueryString(state)}`;
}

export function accountDetailPath(id: number, state: AccountBookListState): string {
  return `/accounts/${id}${accountBookQueryString(state)}`;
}

export function replaceAccountBookState(state: AccountBookListState) {
  navigateHash(accountListPath(state), { replace: true });
}
