/**
 * §H Owner invoice queue — `/#/repair/invoices`
 * Every Invoice Submitted: car, shop, invoice no/date, amount, estimate,
 * difference, flags, age. Filters + payment batch CSV export.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import RepairOwnerShell from "./RepairOwnerShell";
import { WorkspaceTitle } from "./WorkspaceTitle";
import { cn } from "@/lib/utils";

type QueueRow = {
  id: string;
  eventId: string;
  carMark: string;
  carNumber: string;
  shopMark: string;
  shopName: string | null;
  invoiceNo: string;
  invoiceDate: string;
  invoiceCents: number;
  estimateCents: number;
  differenceCents: number;
  differencePct: number;
  workflowStatus: string | null;
  paymentStatus: string | null;
  flags: string;
  ageDays: number;
  dueDate: string | null;
  paidAt: string | null;
  paidRef: string | null;
  shortPayCents: number | null;
};

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

const STATUS_OPTS = [
  "",
  "UNDER_OWNER_REVIEW",
  "PAYABLE",
  "IN_BATCH",
  "EXPORTED",
  "PAID",
  "REJECTED",
];

export default function InvoiceQueue() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shop, setShop] = useState("");
  const [status, setStatus] = useState("UNDER_OWNER_REVIEW");
  const [minAge, setMinAge] = useState("");
  const [overOnly, setOverOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchMsg, setBatchMsg] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    const qs = new URLSearchParams();
    if (shop.trim()) qs.set("shopMark", shop.trim().toUpperCase());
    if (status) qs.set("status", status);
    if (minAge.trim()) qs.set("minAgeDays", minAge.trim());
    if (overOnly) qs.set("overEstimateOnly", "1");
    try {
      const res = await fetch(`/api/repair/invoices/queue?${qs}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
        setRows([]);
        return;
      }
      setRows(json.invoices ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }, [shop, status, minAge, overOnly]);

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createBatch() {
    setBatchMsg("");
    const ids = Array.from(selected);
    if (!ids.length) {
      setBatchMsg("Select payable invoices first");
      return;
    }
    const res = await fetch("/api/repair/payment-batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceIds: ids }),
    });
    const json = await res.json();
    if (!res.ok) {
      setBatchMsg(json.error || `HTTP ${res.status}`);
      return;
    }
    const batchId = json.batch?.id;
    if (batchId) {
      const exp = await fetch(`/api/repair/payment-batches/${batchId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const expJson = await exp.json();
      if (exp.ok && expJson.csv) {
        const blob = new Blob([expJson.csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${expJson.batchNo || "payment-batch"}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setBatchMsg(
          `Batch ${expJson.batchNo} exported (${expJson.rowCount} rows). Generic CSV — no accounting API.`,
        );
      } else {
        setBatchMsg(expJson.error || "Export failed");
      }
    } else {
      setBatchMsg(`Batch created (${json.invoiceCount})`);
    }
    setSelected(new Set());
    void load();
  }

  return (
    <RepairOwnerShell>
      <div className="mx-auto max-w-7xl px-4 py-6 space-y-4">
        <WorkspaceTitle title="Invoices" subtitle="Owner invoice review queue" />
        <p className="text-sm text-slate-700">
          RESIDCO · Invoice Submitted → review → Approve / Reject / Short-pay →
          Payable → payment batch CSV export (no real payments).
        </p>

        <div className="flex flex-wrap items-end gap-3 rounded border border-slate-300 bg-white p-3">
          <div>
            <Label className="text-slate-800">Shop mark</Label>
            <Input
              className="h-8 w-24 font-mono uppercase"
              value={shop}
              onChange={(e) => setShop(e.target.value.toUpperCase())}
              placeholder="DS01"
            />
          </div>
          <div>
            <Label className="text-slate-800">Status</Label>
            <select
              className="mt-0 block h-8 rounded border border-slate-300 bg-white px-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTS.map((s) => (
                <option key={s || "all"} value={s}>
                  {s || "All"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-slate-800">Min age (days)</Label>
            <Input
              className="h-8 w-20"
              value={minAge}
              onChange={(e) => setMinAge(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-900">
            <input
              type="checkbox"
              checked={overOnly}
              onChange={(e) => setOverOnly(e.target.checked)}
            />
            Amount over estimate
          </label>
          <Button onClick={() => void load()} disabled={busy}>
            Apply
          </Button>
          <Button variant="secondary" onClick={() => void createBatch()}>
            Create batch + export CSV
          </Button>
        </div>

        {batchMsg && (
          <p className="text-sm font-medium text-slate-900">{batchMsg}</p>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}

        <div className="overflow-x-auto rounded border border-slate-300 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-slate-900">
              <tr>
                <th className="px-2 py-2">☑</th>
                <th className="px-2 py-2">Car</th>
                <th className="px-2 py-2">Shop</th>
                <th className="px-2 py-2">Invoice #</th>
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2 text-right">Amount</th>
                <th className="px-2 py-2 text-right">Estimate</th>
                <th className="px-2 py-2 text-right">Δ $</th>
                <th className="px-2 py-2 text-right">Δ %</th>
                <th className="px-2 py-2">Flags</th>
                <th className="px-2 py-2">Age</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={13}
                    className="px-3 py-6 text-center text-slate-600"
                  >
                    {busy ? "Loading…" : "No invoices match filters."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "border-t border-slate-200",
                      r.differenceCents > 0 && "bg-amber-50",
                    )}
                  >
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        disabled={
                          r.paymentStatus !== "PAYABLE" &&
                          r.workflowStatus !== "PAYABLE"
                        }
                      />
                    </td>
                    <td className="px-2 py-2 font-mono font-semibold">
                      {r.carMark} {r.carNumber}
                    </td>
                    <td className="px-2 py-2">{r.shopMark}</td>
                    <td className="px-2 py-2 font-mono">{r.invoiceNo}</td>
                    <td className="px-2 py-2">{r.invoiceDate}</td>
                    <td className="px-2 py-2 text-right font-mono">
                      {dollars(r.invoiceCents)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {dollars(r.estimateCents)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {dollars(r.differenceCents)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {r.differencePct.toFixed(2)}%
                    </td>
                    <td className="px-2 py-2 text-xs">{r.flags || "—"}</td>
                    <td className="px-2 py-2 font-mono">{r.ageDays}</td>
                    <td className="px-2 py-2 text-xs">
                      {r.paymentStatus || r.workflowStatus || "—"}
                      {r.shortPayCents != null && r.shortPayCents > 0
                        ? " · short-paid"
                        : ""}
                    </td>
                    <td className="px-2 py-2">
                      <Link href={`/repair/invoices/${r.id}`}>
                        <Button size="sm" variant="outline">
                          Review
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </RepairOwnerShell>
  );
}
