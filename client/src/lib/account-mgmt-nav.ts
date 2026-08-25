import { hashSearchParams, navigateHash } from "@/lib/hash-location";

export type AccountKpiFilter =
  | { kind: "year"; year: number }
  | { kind: "tag"; tag: "good" | "watch" | "risk" }
  | null;

export type AccountMgmtListState = {
  manager: string | null;
  kpi: AccountKpiFilter;
  showInactive: boolean;
  search: string;
};

export const UNASSIGNED_AM = "unassigned";

export function readAccountMgmtListState(): AccountMgmtListState {
  const p = hashSearchParams();
  const am = p.get("am");
  const kpiRaw = p.get("kpi") ?? "";
  let kpi: AccountKpiFilter = null;
  const year = kpiRaw.match(/^y:(\d{4})$/);
  const tag = kpiRaw.match(/^t:(good|watch|risk)$/);
  if (year) kpi = { kind: "year", year: Number(year[1]) };
  else if (tag) kpi = { kind: "tag", tag: tag[1] as "good" | "watch" | "risk" };
  return {
    manager: am && am.trim() ? am.trim() : null,
    kpi,
    showInactive: p.get("inactive") === "1",
    search: p.get("q") ?? "",
  };
}

export function accountMgmtQueryString(state: AccountMgmtListState): string {
  const p = new URLSearchParams();
  if (state.manager) p.set("am", state.manager);
  if (state.kpi?.kind === "year") p.set("kpi", `y:${state.kpi.year}`);
  if (state.kpi?.kind === "tag") p.set("kpi", `t:${state.kpi.tag}`);
  if (state.showInactive) p.set("inactive", "1");
  if (state.search.trim()) p.set("q", state.search.trim());
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function accountListPath(state: AccountMgmtListState): string {
  return `/accounts${accountMgmtQueryString(state)}`;
}

export function accountDetailPath(id: number, state: AccountMgmtListState): string {
  return `/accounts/${id}${accountMgmtQueryString(state)}`;
}

export function replaceAccountMgmtListState(state: AccountMgmtListState) {
  navigateHash(accountListPath(state), { replace: true });
}
