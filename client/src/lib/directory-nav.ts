import { hashSearchParams } from "./hash-location";

export type DirectoryNavState = {
  q: string;
  companyId: number | null;
  contactId: number | null;
  people: boolean;
  leaseTied: boolean;
  addContact?: boolean;
};

function positiveInt(raw: string | null): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function readDirectoryNavState(params: URLSearchParams = hashSearchParams()): DirectoryNavState {
  return {
    q: (params.get("q") ?? "").trim(),
    companyId: positiveInt(params.get("company")),
    contactId: positiveInt(params.get("contact")),
    people: params.get("view") === "people",
    leaseTied: params.get("lease") === "1",
    addContact: params.get("add") === "1",
  };
}

export function contactsDirectoryPath(state: DirectoryNavState): string {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.companyId) p.set("company", String(state.companyId));
  if (state.contactId) p.set("contact", String(state.contactId));
  if (state.people) p.set("view", "people");
  if (state.leaseTied) p.set("lease", "1");
  if (state.addContact) p.set("add", "1");
  const qs = p.toString();
  return qs ? `/contacts?${qs}` : "/contacts";
}

/** Keep `/contacts?q=` in the hash without firing hashchange (avoids wiping in-progress typing). */
export function replaceDirectoryHash(state: DirectoryNavState) {
  if (typeof window === "undefined") return;
  const path = contactsDirectoryPath(state);
  const newURL = `${window.location.pathname}${window.location.search}#${path}`;
  if (window.location.href === newURL) return;
  window.history.replaceState(null, "", newURL);
}
