import { hashSearchParams } from "@/lib/hash-location";

const SEARCH_PASTE_KEY = "rlms-search-paste";
const SEARCH_SESSION_KEY = "rlms-search-session";
const HASH_Q_MAX = 1600;

export function searchPagePath(q: string): string {
  const encoded = encodeURIComponent(q);
  if (encoded.length > HASH_Q_MAX || /[\n\r]/.test(q)) {
    try {
      sessionStorage.setItem(SEARCH_PASTE_KEY, q);
    } catch {
      /* private mode */
    }
    return "/search?paste=1";
  }
  try {
    sessionStorage.removeItem(SEARCH_PASTE_KEY);
  } catch {
    /* ignore */
  }
  return `/search?q=${encoded}`;
}

export function readInitialSearchQuery(): string {
  const params = hashSearchParams();
  const q = params.get("q");
  if (q) return q;
  if (params.get("paste") || params.get("restore")) {
    try {
      return sessionStorage.getItem(SEARCH_PASTE_KEY) ?? "";
    } catch {
      return "";
    }
  }
  return "";
}

export function persistSearchQuery(q: string) {
  const path = searchPagePath(q);
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}#${path}`,
  );
}

/** Cached Search page state so car click-through can return without re-running the API. */
export type SearchSessionFilters = {
  active: "active" | "inactive" | "all";
  rental: string;
  lessee: string;
  ol: string;
};

export type SearchSession = {
  query: string;
  results: unknown;
  filters: SearchSessionFilters;
  savedAt: number;
};

/** Drop embed noise so large paste results fit in sessionStorage. */
function slimSearchResults(results: any) {
  if (!results || typeof results !== "object") return results;
  const slimCar = (c: any) => {
    if (!c || typeof c !== "object") return c;
    const rider = c.assignment?.rider;
    const lease = rider?.master_lease;
    return {
      id: c.id,
      car_number: c.car_number,
      reporting_marks: c.reporting_marks,
      car_type: c.car_type,
      status: c.status,
      fleet_status: c.fleet_status,
      entity: c.entity,
      active: c.active,
      mechanical_designation: c.mechanical_designation,
      lessee_name: c.lessee_name,
      rider_external_id: c.rider_external_id,
      lease_type: c.lease_type,
      ops_flag: c.ops_flag,
      assignment: c.assignment
        ? {
            id: c.assignment.id,
            fleet_name: c.assignment.fleet_name,
            sub_lease_number: c.assignment.sub_lease_number,
            sublease_expiration_date: c.assignment.sublease_expiration_date,
            assigned_at: c.assignment.assigned_at,
            rider: rider
              ? {
                  id: rider.id,
                  rider_name: rider.rider_name,
                  schedule_number: rider.schedule_number,
                  expiration_date: rider.expiration_date,
                  master_lease: lease
                    ? {
                        id: lease.id,
                        lease_number: lease.lease_number,
                        lessor: lease.lessor,
                        lessee: lease.lessee,
                        lease_type: lease.lease_type,
                      }
                    : null,
                }
              : null,
          }
        : null,
    };
  };
  return {
    query: results.query,
    terms: results.terms,
    railcars: Array.isArray(results.railcars) ? results.railcars.map(slimCar) : [],
    riders: Array.isArray(results.riders)
      ? results.riders.map((r: any) => ({
          id: r.id,
          rider_name: r.rider_name,
          schedule_number: r.schedule_number,
          expiration_date: r.expiration_date,
          car_count: r.car_count,
          master_lease: r.master_lease
            ? {
                id: r.master_lease.id,
                lease_number: r.master_lease.lease_number,
                lessee: r.master_lease.lessee,
                lease_type: r.master_lease.lease_type,
              }
            : null,
        }))
      : [],
    leases: Array.isArray(results.leases)
      ? results.leases.map((l: any) => ({
          id: l.id,
          lease_number: l.lease_number,
          agreement_number: l.agreement_number,
          lessor: l.lessor,
          lessee: l.lessee,
          lease_type: l.lease_type,
          effective_date: l.effective_date,
        }))
      : [],
    not_found: results.not_found ?? [],
    counts: results.counts,
  };
}

export function saveSearchSession(session: Omit<SearchSession, "savedAt">) {
  try {
    const payload: SearchSession = {
      query: session.query,
      results: slimSearchResults(session.results),
      filters: session.filters,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(SEARCH_SESSION_KEY, JSON.stringify(payload));
    if (session.query) {
      try {
        sessionStorage.setItem(SEARCH_PASTE_KEY, session.query);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* quota / private mode */
  }
}

export function readSearchSession(): SearchSession | null {
  try {
    const raw = sessionStorage.getItem(SEARCH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SearchSession;
    if (!parsed || typeof parsed.query !== "string" || !parsed.results) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSearchSession() {
  try {
    sessionStorage.removeItem(SEARCH_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function hasSearchSession(): boolean {
  const s = readSearchSession();
  return Boolean(s?.query && s.results);
}

/** Always restore from session — do not put the paste back in the URL. */
export function searchReturnPath(): string | null {
  if (!hasSearchSession()) return null;
  return "/search?restore=1";
}

export function shouldRestoreSearchSession(): boolean {
  const params = hashSearchParams();
  return params.get("restore") === "1" || params.get("paste") === "1";
}
