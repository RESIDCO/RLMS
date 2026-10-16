/**
 * §H Owner invoice queue — `/#/repair/invoices`
 * Every Invoice Submitted: car, shop, invoice no/date, amount, estimate,
 * difference, flags, age. Filters + payment batch CSV export.
 * §H r6: AA contrast (white panels, near-black text) even under dark owner theme.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import RepairOwnerShell from "./RepairOwnerShell";
import { WorkspaceTitle } from "./WorkspaceTitle";
import { shopAa } from "./RepairNavChrome";
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
  statusPlain?: string | null;
  flags: string;
  ageDays: number;
  dueDate: string | null;
  paidAt: string | null;
  paidRef: string | null;
  shortPayCents: number | null;
  netPayableCents?: number | null;
  isMultiCar?: boolean;
  monthLabel?: string | null;
};

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/** Filter values stay API enums; labels are plain words for the UI. */
const STATUS_OPTS: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "UNDER_OWNER_REVIEW", label: "Under owner review" },
  { value: "APPROVED_IN_OPEN_MONTH", label: "Approved – In Open Month" },
  { value: "MONTH_CLOSED", label: "Month Closed" },
  { value: "SENT_TO_AP", label: "Sent to AP" },
  { value: "PAID", label: "Paid" },
  { value: "REJECTED", label: "Rejected" },
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
      <div className={cn(shopAa.page, "mx-auto max-w-7xl px-4 py-6 space-y-4")}>
        <WorkspaceTitle title="Invoices" />
        <p className={shopAa.muted}>
          RESIDCO · Owner invoice review queue. Invoice Submitted → review →
          Approve / Reject / Short-pay → Payable →{" "}
          <Link href="/repair/payments" className="font-semibold text-blue-800 underline">
            payment batches
          </Link>{" "}
          CSV export (no real payments).
        </p>

        <div className="repair-aa-panel flex flex-wrap items-end gap-3 rounded border border-slate-400 bg-white p-3 text-slate-900">
          <div>
            <Label className={shopAa.label}>Shop mark</Label>
            <Input
              className={cn(shopAa.input, "mt-1 h-8 w-24 font-mono uppercase")}
              value={shop}
              onChange={(e) => setShop(e.target.value.toUpperCase())}
              placeholder="DS01"
            />
          </div>
          <div>
            <Label className={shopAa.label}>Status</Label>
            <select
              className={cn(shopAa.select, "mt-1 h-8 w-auto min-w-[12rem]")}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTS.map((s) => (
                <option key={s.value || "all"} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className={shopAa.label}>Min age (days)</Label>
            <Input
              className={cn(shopAa.input, "mt-1 h-8 w-20")}
              value={minAge}
              onChange={(e) => setMinAge(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <input
              type="checkbox"
              checked={overOnly}
              onChange={(e) => setOverOnly(e.target.checked)}
            />
            Amount over estimate
          </label>
          <Button
            onClick={() => void load()}
            disabled={busy}
            className="font-semibold text-slate-900"
          >
            Apply
          </Button>
          <Button
            variant="secondary"
            onClick={() => void createBatch()}
            className="font-semibold text-slate-900"
          >
            Create batch + export CSV
          </Button>
        </div>

        {batchMsg && (
          <p className="text-sm font-medium text-slate-900">{batchMsg}</p>
        )}
        {error && <p className="text-sm font-medium text-red-800">{error}</p>}

        <div className="repair-aa-panel overflow-x-auto rounded border border-slate-400 bg-white text-slate-900">
          <table className="min-w-full text-sm text-slate-900">
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
                    className="px-3 py-6 text-center text-slate-700"
                  >
                    {busy ? "Loading…" : "No invoices match filters."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "border-t border-slate-200 text-slate-900",
                      r.differenceCents > 0 && "bg-amber-50 text-slate-900",
                    )}
                  >
                    <td className="px-2 py-2 text-slate-900">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        disabled={
                          r.paymentStatus !== "MONTH_CLOSED" &&
                          r.paymentStatus !== "PAYABLE" &&
                          r.workflowStatus !== "MONTH_CLOSED" &&
                          r.workflowStatus !== "PAYABLE"
                        }
                      />
                    </td>
                    <td className="px-2 py-2 font-mono font-semibold text-slate-900">
                      {r.carMark} {r.carNumber}
                    </td>
                    <td className="px-2 py-2 text-slate-900">{r.shopMark}</td>
                    <td className="px-2 py-2 font-mono text-slate-900">
                      {r.invoiceNo}
                    </td>
                    <td className="px-2 py-2 text-slate-900">{r.invoiceDate}</td>
                    <td className="px-2 py-2 text-right font-mono font-semibold text-slate-900">
                      {dollars(r.invoiceCents)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-slate-900">
                      {dollars(r.estimateCents)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-slate-900">
                      {dollars(r.differenceCents)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-slate-900">
                      {r.differencePct.toFixed(2)}%
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-900">
                      {r.flags || "—"}
                    </td>
                    <td className="px-2 py-2 font-mono text-slate-900">
                      {r.ageDays}
                    </td>
                    <td className="px-2 py-2 text-xs font-medium text-slate-900">
                      {r.statusPlain ||
                        r.paymentStatus ||
                        r.workflowStatus ||
                        "—"}
                      {r.isMultiCar ? " · multi-car" : ""}
                      {r.shortPayCents != null && r.shortPayCents > 0
                        ? ` · short-pay ${dollars(r.shortPayCents)} / net ${dollars(r.netPayableCents ?? r.invoiceCents - r.shortPayCents)}`
                        : ""}
                    </td>
                    <td className="px-2 py-2">
                      <Link href={`/repair/invoices/${r.id}`}>
                        <Button
                          size="sm"
                          className="font-semibold text-slate-900 bg-amber-100 border border-amber-800 hover:bg-amber-200"
                        >
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
