/**
 * §G Shop portal home — own shop mark only.
 * §G r2: AA contrast, KPIs, DEV role switcher.
 * §G r3: white inputs, closed-BO reason, owner/MP read-only view.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import DevRoleSwitcher, {
  repairDevHeaders,
  readDevRole,
} from "./DevRoleSwitcher";
import { RepairBreadcrumbs, shopAa } from "./RepairNavChrome";

type HomePayload = {
  shop: { id: string; shopMark: string; name: string };
  readOnly?: boolean;
  viewingAsShopMark?: string;
  byStatus: Record<string, number>;
  badOrders: Array<{
    event_id: string;
    car_mark: string;
    car_number: string;
    lifecycle_status?: string;
    shopping_reason?: string;
    owner_instructions?: string;
    yard_arrived_at?: string;
    is_wreck?: boolean;
    closedReasonLine?: string | null;
    inconsistentClosed?: boolean;
    inconsistentClosedReasons?: string[];
  }>;
  estimates: Array<{
    estimate_id: string;
    event_id: string;
    car_mark: string;
    car_number: string;
    status_code: string;
    statusLabel: string;
    current_revision: number;
    total?: string | number;
  }>;
  kpis?: {
    missedPodCount: number;
    avgDaysArrivalToApproval: number | null;
  };
};

const STATUS_ORDER = [
  "Draft",
  "Submitted",
  "Rejected",
  "Adjustment for Approval",
  "Approved",
  "Completed",
];

export default function ShopPortal() {
  const [shopMark, setShopMark] = useState(
    () => localStorage.getItem("repairShopMark") || "",
  );
  const [carInitial, setCarInitial] = useState("");
  const [carNumber, setCarNumber] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [data, setData] = useState<HomePayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [devRole, setDevRole] = useState(() => readDevRole());

  useEffect(() => {
    const onRole = () => setDevRole(readDevRole());
    window.addEventListener("repair-dev-role", onRole);
    return () => window.removeEventListener("repair-dev-role", onRole);
  }, []);

  const load = useCallback(async () => {
    if (!shopMark.trim()) {
      setError("Enter your shop mark");
      setData(null);
      return;
    }
    setBusy(true);
    setError("");
    localStorage.setItem("repairShopMark", shopMark.trim().toUpperCase());
    const qs = new URLSearchParams();
    if (carInitial.trim()) qs.set("carInitial", carInitial.trim());
    if (carNumber.trim()) qs.set("carNumber", carNumber.trim());
    if (statusFilter) qs.set("status", statusFilter);
    try {
      const res = await fetch(`/api/repair/shop/home?${qs}`, {
        headers: {
          ...repairDevHeaders(),
          "x-repair-shop-mark": shopMark.trim().toUpperCase(),
        },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
        setData(null);
        return;
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }, [shopMark, carInitial, carNumber, statusFilter]);

  useEffect(() => {
    if (shopMark.trim()) void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — initial only

  useEffect(() => {
    if (devRole !== "shop" && shopMark.trim()) void load();
  }, [devRole]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={shopAa.page}>
      <DevRoleSwitcher shopMark={shopMark || undefined} />
      {data?.readOnly && (
        <div
          className="border-b border-slate-400 bg-slate-100 px-4 py-2 text-sm text-slate-900"
          data-testid="shop-readonly-banner"
        >
          Viewing as shop {data.viewingAsShopMark || shopMark || "????"} ·
          read-only (owner / managing partner)
        </div>
      )}
      <header className="border-b border-slate-300 bg-white px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <RepairBreadcrumbs items={[{ label: "Shop home" }]} />
            <p className="mt-1 text-xs font-semibold tracking-wide text-slate-700">
              RESIDCO · Shop portal
            </p>
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-slate-900">
              {data?.shop?.name || "Shop work queue"}
            </h1>
            <p className={shopAa.muted}>
              Own shop mark only · no lessee · no DV/settlement
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="shopMark" className={shopAa.label}>
                Shop mark
              </Label>
              <Input
                id="shopMark"
                className={cn("w-28 font-mono uppercase", shopAa.input)}
                value={shopMark}
                onChange={(e) => setShopMark(e.target.value.toUpperCase())}
                maxLength={4}
                placeholder="DS01"
              />
            </div>
            <Button onClick={() => void load()} disabled={busy}>
              {busy ? "Loading…" : "Load"}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-8">
        {error && (
          <div className="rounded border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-900">
            {error}
          </div>
        )}

        {data?.kpis && (
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded border border-slate-300 bg-white p-4">
              <p className={shopAa.label}>Missed POD count</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-slate-900">
                {data.kpis.missedPodCount}
              </p>
            </div>
            <div className="rounded border border-slate-300 bg-white p-4">
              <p className={shopAa.label}>Avg days arrival → approval</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-slate-900">
                {data.kpis.avgDaysArrivalToApproval != null
                  ? data.kpis.avgDaysArrivalToApproval
                  : "—"}
              </p>
            </div>
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Search car</h2>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Initial"
              className={cn("w-24 font-mono uppercase", shopAa.input)}
              value={carInitial}
              onChange={(e) => setCarInitial(e.target.value.toUpperCase())}
            />
            <Input
              placeholder="Number"
              className={cn("w-32 font-mono", shopAa.input)}
              value={carNumber}
              onChange={(e) => setCarNumber(e.target.value)}
            />
            <Button variant="secondary" onClick={() => void load()}>
              Search
            </Button>
          </div>
        </section>

        {data && (
          <>
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                Estimates by status
              </h2>
              <div className="flex flex-wrap gap-2">
                {STATUS_ORDER.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setStatusFilter(statusFilter === s ? "" : s);
                      setTimeout(() => void load(), 0);
                    }}
                    className={cn(
                      "rounded border px-3 py-2 text-left text-sm transition",
                      statusFilter === s
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-900 hover:border-slate-600",
                    )}
                  >
                    <div className="font-medium">{s}</div>
                    <div className="font-mono text-lg text-slate-900">
                      {data.byStatus[s] ?? 0}
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                Bad orders assigned to {data.shop.shopMark}
              </h2>
              {data.badOrders.length === 0 ? (
                <p className={shopAa.muted}>No bad orders for this shop.</p>
              ) : (
                <ul className="divide-y divide-slate-300 rounded border border-slate-300 bg-white">
                  {data.badOrders.map((bo) => (
                    <li
                      key={bo.event_id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-3"
                    >
                      <div>
                        <span className="font-mono font-semibold text-slate-900">
                          {bo.car_mark} {bo.car_number}
                        </span>
                        <span className="ml-2 text-sm text-slate-700">
                          {bo.lifecycle_status || "—"}
                          {bo.is_wreck ? " · Wreck" : ""}
                        </span>
                        {bo.closedReasonLine && (
                          <p className="mt-1 text-sm font-medium text-slate-900">
                            {bo.closedReasonLine}
                          </p>
                        )}
                        {bo.inconsistentClosed && (
                          <p className="mt-1 rounded border border-red-700 bg-red-50 px-2 py-1 text-sm font-semibold text-red-900">
                            Inconsistent state
                            {bo.inconsistentClosedReasons?.length
                              ? `: ${bo.inconsistentClosedReasons.join("; ")}`
                              : ""}
                          </p>
                        )}
                        {bo.shopping_reason && (
                          <p className="text-sm text-slate-700">
                            {bo.shopping_reason}
                          </p>
                        )}
                      </div>
                      <Link href={`/repair/shop/events/${bo.event_id}`}>
                        <Button size="sm" variant="outline">
                          Open
                        </Button>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                Estimates
              </h2>
              {data.estimates.length === 0 ? (
                <p className={shopAa.muted}>No estimates yet.</p>
              ) : (
                <ul className="divide-y divide-slate-300 rounded border border-slate-300 bg-white">
                  {data.estimates.map((est) => (
                    <li
                      key={est.estimate_id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-3"
                    >
                      <div>
                        <span className="font-mono font-semibold text-slate-900">
                          {est.car_mark} {est.car_number}
                        </span>
                        <span className="ml-2 text-sm text-slate-900">
                          {est.statusLabel} · rev {est.current_revision}
                        </span>
                      </div>
                      <Link href={`/repair/shop/estimates/${est.estimate_id}`}>
                        <Button size="sm" variant="outline">
                          Estimate
                        </Button>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
