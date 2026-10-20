/* eslint-disable no-console */
/** Run: npx tsx client/src/lib/fleetQueryRefresh.test.ts */

import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  FLEET_QUERY_PREFIXES,
  FLEET_STALE_MS,
  createMemoryFleetSync,
  installFleetQueryRefresh,
  invalidateFleetQueries,
  isFleetQueryKey,
  refreshVisibleFleetQueries,
  shouldRefreshOnVisible,
} from "./fleetQueryRefresh";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

function client() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async () => ({ ok: true }),
      },
    },
  });
}

function invalidated(qc: QueryClient, queryKey: readonly unknown[]): boolean {
  return qc.getQueryCache().find({ queryKey })?.state.isInvalidated === true;
}

ok(FLEET_STALE_MS < 45_000 && FLEET_STALE_MS >= 5_000, "stale window is shorter than 45s and still dedupes");

for (const prefix of ["/api/railcars", "/api/leases", "/api/lineage", "/api/programs", "/api/kpi", "/api/search"]) {
  ok(FLEET_QUERY_PREFIXES.includes(prefix as (typeof FLEET_QUERY_PREFIXES)[number]), `prefix listed: ${prefix}`);
}

ok(isFleetQueryKey(["/api/railcars", "search-page", { q: "a" }]), "railcar search key matches");
ok(isFleetQueryKey(["/api/railcars/summary", "search-page"]), "railcar summary key matches");
ok(isFleetQueryKey(["/api/leases"]), "leases key matches");
ok(isFleetQueryKey(["/api/riders", 4, "cars", "active"]), "rider cars key matches");
ok(isFleetQueryKey(["/api/lineage", "history-page", "q"]), "lineage key matches");
ok(isFleetQueryKey(["/api/programs", 9, "cars"]), "program cars key matches");
ok(isFleetQueryKey(["/api/kpi/cars", "bucket"]), "kpi list key matches");
ok(isFleetQueryKey(["/api/kpi/car", 3]), "kpi car key matches");
ok(isFleetQueryKey(["/api/lease-mgmt/riders", 2]), "lease-mgmt key matches");
ok(isFleetQueryKey(["/api/dashboard"]), "dashboard key matches");
ok(isFleetQueryKey(["/api/views", 1]), "saved search view key matches");
ok(!isFleetQueryKey(["/api/invoices"]), "invoices are not fleet data");
ok(!isFleetQueryKey(["/api/accounts", 1]), "accounts are not fleet data");
ok(!isFleetQueryKey(["/api/crm-activities"]), "crm is not fleet data");

const qc = client();
qc.setQueryData(["/api/railcars", 1], { id: 1 });
qc.setQueryData(["/api/railcars/summary", "s"], { n: 1 });
qc.setQueryData(["/api/leases"], []);
qc.setQueryData(["/api/lineage", "history-page", ""], []);
qc.setQueryData(["/api/kpi/cars", "all"], []);
qc.setQueryData(["/api/programs", 2], {});
qc.setQueryData(["/api/dashboard"], {});
qc.setQueryData(["/api/invoices"], []);
qc.setQueryData(["/api/accounts", 8], {});

const posts: string[] = [];
const sync = createMemoryFleetSync();
const wrapped = {
  post(message: string) {
    posts.push(message);
    sync.post(message);
  },
  subscribe: sync.subscribe.bind(sync),
};
const stop = installFleetQueryRefresh(qc, { sync: wrapped, subscribeVisibility: () => () => {} });
await invalidateFleetQueries(qc);

ok(invalidated(qc, ["/api/railcars", 1]), "railcar query invalidated");
ok(invalidated(qc, ["/api/railcars/summary", "s"]), "summary query invalidated");
ok(invalidated(qc, ["/api/leases"]), "leases query invalidated");
ok(invalidated(qc, ["/api/lineage", "history-page", ""]), "lineage query invalidated");
ok(invalidated(qc, ["/api/kpi/cars", "all"]), "kpi query invalidated");
ok(invalidated(qc, ["/api/programs", 2]), "program query invalidated");
ok(invalidated(qc, ["/api/dashboard"]), "dashboard query invalidated");
ok(!invalidated(qc, ["/api/invoices"]), "invoice query left alone");
ok(!invalidated(qc, ["/api/accounts", 8]), "account query left alone");
ok(posts.length === 1 && posts[0] === "invalidate", "one cross-tab message, no echo loop");

stop();
posts.length = 0;
await invalidateFleetQueries(qc, { broadcast: false, sync: wrapped });
ok(posts.length === 0, "broadcast:false does not post");

ok(!shouldRefreshOnVisible(1_000, 5_000, FLEET_STALE_MS), "visible refresh dedupes inside the window");
ok(shouldRefreshOnVisible(0, FLEET_STALE_MS, FLEET_STALE_MS), "visible refresh runs once the window elapses");

let fleetFetches = 0;
let invoiceFetches = 0;
const focusClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 0 } },
});
const fleetObserver = new QueryObserver(focusClient, {
  queryKey: ["/api/railcars", "focus"],
  staleTime: 0,
  queryFn: async () => {
    fleetFetches += 1;
    return { fleetFetches };
  },
});
const invoiceObserver = new QueryObserver(focusClient, {
  queryKey: ["/api/invoices", "focus"],
  staleTime: 0,
  queryFn: async () => {
    invoiceFetches += 1;
    return { invoiceFetches };
  },
});
const unsubFleet = fleetObserver.subscribe(() => {});
const unsubInvoice = invoiceObserver.subscribe(() => {});
await fleetObserver.refetch();
await invoiceObserver.refetch();
const fleetAfterMount = fleetFetches;
const invoiceAfterMount = invoiceFetches;
let clock = 1_000;
let visible: () => void = () => {};
const stopFocus = installFleetQueryRefresh(focusClient, {
  sync: null,
  now: () => clock,
  staleMs: FLEET_STALE_MS,
  subscribeVisibility: (onVisible) => {
    visible = onVisible;
    return () => {
      visible = () => {};
    };
  },
});
visible();
await new Promise((resolve) => setTimeout(resolve, 30));
const fleetAfterFirst = fleetFetches;
ok(fleetAfterFirst > fleetAfterMount, "becoming visible refetches a stale fleet query");
ok(invoiceFetches === invoiceAfterMount, "becoming visible does not refetch invoices");
visible();
await new Promise((resolve) => setTimeout(resolve, 30));
ok(fleetFetches === fleetAfterFirst, "a second visibility event inside the window does not refetch");
clock = 1_000 + FLEET_STALE_MS;
visible();
await new Promise((resolve) => setTimeout(resolve, 30));
ok(fleetFetches > fleetAfterFirst, "visibility after the dedupe window refetches again");
ok(invoiceFetches === invoiceAfterMount, "later visibility refresh still skips invoices");

await refreshVisibleFleetQueries(focusClient);
ok(invoiceFetches === invoiceAfterMount, "direct fleet refresh does not refetch invoices");

unsubFleet();
unsubInvoice();
stopFocus();

if (failed) {
  console.error(`${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
