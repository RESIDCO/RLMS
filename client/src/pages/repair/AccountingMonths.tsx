/**
 * §H r3 — Accounting months `/#/repair/months`
 * One open month at a time. Approved invoices land here; owner/MP closes when ready
 * (replaces fixed pay-cycle cutoff). Close freezes month; later approvals → next month.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import RepairOwnerShell from "./RepairOwnerShell";
import { WorkspaceTitle } from "./WorkspaceTitle";
import { shopAa } from "./RepairNavChrome";
import { cn } from "@/lib/utils";

type Month = {
  id: string;
  monthLabel: string;
  status: "OPEN" | "CLOSED";
  openedAt: string | null;
  closedAt: string | null;
  invoiceCount: number;
  closeTotals?: Totals | null;
};

type Totals = {
  byShop: Array<{ shopMark: string; cents: number; count: number }>;
  byResp: {
    ownerCents: number;
    lessee6Cents: number;
    road3Cents: number;
    otherCents: number;
  };
  lesseeRebillPendingCents: number;
  roadRebillPendingCents: number;
  crbReceivedPlaceholder: string;
  lesseeRebillOutputPlaceholder: string;
  totalCents: number;
  invoiceCount: number;
};

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default function AccountingMonths() {
  const [months, setMonths] = useState<Month[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    const res = await fetch("/api/repair/accounting-months");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || `HTTP ${res.status}`);
      return;
    }
    const list = (json.months ?? []) as Month[];
    setMonths(list);
    const open = list.find((m) => m.status === "OPEN") ?? list[0] ?? null;
    if (open) setActiveId(open.id);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/repair/accounting-months/${id}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || `HTTP ${res.status}`);
      return;
    }
    setTotals(json.totals ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (activeId) void loadDetail(activeId);
  }, [activeId, loadDetail]);

  async function closeMonth() {
    if (!activeId) return;
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/repair/accounting-months/${activeId}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMsg(json.error || `HTTP ${res.status}`);
      return;
    }
    setMsg(
      `Closed ${json.month.monthLabel} — ${json.invoicesClosed} invoices → Month Closed. Next open: ${json.nextOpen.monthLabel}.`,
    );
    void load();
  }

  async function reopenMonth() {
    if (!activeId || !reopenReason.trim()) return;
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/repair/accounting-months/${activeId}/reopen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reopenReason.trim() }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMsg(json.error || `HTTP ${res.status}`);
      return;
    }
    setMsg(`Reopened ${json.month.monthLabel}.`);
    setReopenReason("");
    void load();
  }

  const active = months.find((m) => m.id === activeId) ?? null;

  return (
    <RepairOwnerShell>
      <div className={cn(shopAa.page, "mx-auto max-w-5xl px-4 py-6 space-y-4")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <WorkspaceTitle
            title="Accounting months"
            subtitle="RESIDCO / RLMS — one open month; close when ready (no fixed pay-cycle cutoff)"
          />
          <div className="flex gap-2">
            <Link href="/repair/invoices">
              <Button variant="outline" size="sm">
                Invoices
              </Button>
            </Link>
            <Link href="/repair/payments">
              <Button variant="outline" size="sm">
                Payments
              </Button>
            </Link>
          </div>
        </div>

        {error && <p className="text-sm font-medium text-red-800">{error}</p>}
        {msg && <p className="text-sm font-medium text-slate-900">{msg}</p>}

        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <div className="rounded border border-slate-400 bg-white p-3">
            <p className={shopAa.label}>Months</p>
            <ul className="mt-2 space-y-1">
              {months.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className={cn(
                      "w-full rounded px-2 py-1.5 text-left text-sm font-semibold",
                      m.id === activeId
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-900 hover:bg-slate-100",
                    )}
                    onClick={() => setActiveId(m.id)}
                  >
                    {m.monthLabel}{" "}
                    <span className="font-normal opacity-80">
                      · {m.status === "OPEN" ? "Open" : "Closed"} · {m.invoiceCount}
                    </span>
                  </button>
                </li>
              ))}
              {months.length === 0 && (
                <li className={shopAa.muted}>No months yet.</li>
              )}
            </ul>
          </div>

          <div className="space-y-3">
            {active && (
              <div className="rounded border border-slate-400 bg-white p-4 space-y-3">
                <h2 className="text-lg font-semibold text-slate-900">
                  {active.monthLabel} —{" "}
                  {active.status === "OPEN" ? "Open" : "Closed (read-only)"}
                </h2>
                <p className={shopAa.muted}>
                  Approved invoices land in the open month with frozen car/lease
                  snapshot. Closing freezes the month for audit; later approvals go
                  to the next month.
                </p>

                {totals && (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded border border-slate-300 bg-white p-3">
                        <p className={shopAa.label}>Total</p>
                        <p className="font-mono text-xl font-semibold text-slate-900">
                          {money(totals.totalCents)}
                        </p>
                        <p className={shopAa.muted}>
                          {totals.invoiceCount} invoice(s)
                        </p>
                      </div>
                      <div className="rounded border border-slate-300 bg-white p-3">
                        <p className={shopAa.label}>By responsibility</p>
                        <p className="text-sm text-slate-900">
                          Owner {money(totals.byResp.ownerCents)} · Lessee (6){" "}
                          {money(totals.byResp.lessee6Cents)} · Road (3){" "}
                          {money(totals.byResp.road3Cents)}
                        </p>
                      </div>
                    </div>

                    <div className="rounded border border-slate-300 bg-white p-3">
                      <p className={shopAa.label}>By shop</p>
                      <table className="mt-1 w-full text-sm text-slate-900">
                        <thead>
                          <tr className="text-left">
                            <th className="py-1">Shop</th>
                            <th className="py-1 text-right">Count</th>
                            <th className="py-1 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {totals.byShop.map((s) => (
                            <tr key={s.shopMark} className="border-t border-slate-200">
                              <td className="py-1 font-mono">{s.shopMark}</td>
                              <td className="py-1 text-right font-mono">{s.count}</td>
                              <td className="py-1 text-right font-mono">
                                {money(s.cents)}
                              </td>
                            </tr>
                          ))}
                          {totals.byShop.length === 0 && (
                            <tr>
                              <td colSpan={3} className="py-2 text-slate-700">
                                No approved invoices in this month yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded border border-dashed border-slate-400 bg-white p-3">
                        <p className={shopAa.label}>CRB received</p>
                        <p className="text-sm text-slate-700">
                          {totals.crbReceivedPlaceholder}
                        </p>
                      </div>
                      <div className="rounded border border-dashed border-slate-400 bg-white p-3">
                        <p className={shopAa.label}>Lessee rebill output</p>
                        <p className="text-sm text-slate-700">
                          {totals.lesseeRebillOutputPlaceholder}
                        </p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">
                          Lessee rebill pending{" "}
                          {money(totals.lesseeRebillPendingCents)}
                        </p>
                        <p className="text-sm font-semibold text-slate-900">
                          Road rebill pending{" "}
                          {money(totals.roadRebillPendingCents)}
                        </p>
                      </div>
                    </div>
                  </>
                )}

                {active.status === "OPEN" && (
                  <Button disabled={busy} onClick={() => void closeMonth()}>
                    Review totals &amp; close month
                  </Button>
                )}

                {active.status === "CLOSED" && (
                  <div className="space-y-2 border-t border-slate-300 pt-3">
                    <Label className={shopAa.label}>
                      Reopen (owner only) — reason required
                    </Label>
                    <Textarea
                      className={shopAa.textarea}
                      rows={2}
                      value={reopenReason}
                      onChange={(e) => setReopenReason(e.target.value)}
                      placeholder="Why reopen this closed month?"
                    />
                    <Button
                      variant="secondary"
                      disabled={busy || !reopenReason.trim()}
                      onClick={() => void reopenMonth()}
                    >
                      Reopen month
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </RepairOwnerShell>
  );
}
