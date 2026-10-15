/**
 * §G Shop portal home — own shop mark only.
 * BOs assigned to shop; estimates by status; car search.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type HomePayload = {
  shop: { id: string; shopMark: string; name: string };
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
};

const STATUS_ORDER = [
  "Draft",
  "Submitted",
  "Rejected",
  "Adjustment for Approval",
  "Approved",
  "Completed",
];

function shopHeaders(): HeadersInit {
  const mark =
    (typeof window !== "undefined" &&
      (window as unknown as { __REPAIR_SHOP_MARK?: string }).__REPAIR_SHOP_MARK) ||
    localStorage.getItem("repairShopMark") ||
    "";
  return {
    "x-repair-role": "shop",
    "x-repair-shop-mark": mark,
    "x-repair-actor": "shop-portal",
  };
}

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
          ...shopHeaders(),
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

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-slate-500">
              RESIDCO · Shop portal
            </p>
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-slate-900">
              {data?.shop?.name || "Shop work queue"}
            </h1>
            <p className="text-sm text-slate-600">
              Own shop mark only · no lessee · no DV/settlement
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="shopMark" className="text-xs">
                Shop mark
              </Label>
              <Input
                id="shopMark"
                className="w-28 font-mono uppercase"
                value={shopMark}
                onChange={(e) => setShopMark(e.target.value.toUpperCase())}
                maxLength={4}
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
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Search car</h2>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Initial"
              className="w-24 font-mono uppercase"
              value={carInitial}
              onChange={(e) => setCarInitial(e.target.value.toUpperCase())}
            />
            <Input
              placeholder="Number"
              className="w-32 font-mono"
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
              <h2 className="mb-3 text-lg font-semibold">Estimates by status</h2>
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
                        : "border-slate-200 bg-white hover:border-slate-400",
                    )}
                  >
                    <div className="font-medium">{s}</div>
                    <div className="font-mono text-lg">{data.byStatus[s] ?? 0}</div>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold">
                Bad orders assigned to {data.shop.shopMark}
              </h2>
              {data.badOrders.length === 0 ? (
                <p className="text-sm text-slate-500">No bad orders for this shop.</p>
              ) : (
                <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
                  {data.badOrders.map((bo) => (
                    <li key={bo.event_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
                      <div>
                        <span className="font-mono font-semibold">
                          {bo.car_mark} {bo.car_number}
                        </span>
                        <span className="ml-2 text-sm text-slate-500">
                          {bo.lifecycle_status || "—"}
                          {bo.is_wreck ? " · Wreck" : ""}
                        </span>
                        {bo.shopping_reason && (
                          <p className="text-sm text-slate-600">{bo.shopping_reason}</p>
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
              <h2 className="mb-3 text-lg font-semibold">Estimates</h2>
              {data.estimates.length === 0 ? (
                <p className="text-sm text-slate-500">No estimates yet.</p>
              ) : (
                <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
                  {data.estimates.map((est) => (
                    <li
                      key={est.estimate_id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-3"
                    >
                      <div>
                        <span className="font-mono font-semibold">
                          {est.car_mark} {est.car_number}
                        </span>
                        <span className="ml-2 text-sm">
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
