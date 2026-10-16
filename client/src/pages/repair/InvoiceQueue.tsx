/**
 * §H Owner invoice queue — `/#/repair/invoices`
 * Every Invoice Submitted: car, shop, invoice no/date, amount, estimate,
 * difference, flags, age. Filters + payment batch CSV export.
 * §H r7: shared repair theme tokens; light-only AA; disabled batch + checkboxes.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import RepairOwnerShell from "./RepairOwnerShell";
import { WorkspaceTitle } from "./WorkspaceTitle";
import { shopAa } from "./RepairNavChrome";
import { repairUi } from "./repairTokens";
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

function isPayable(r: QueueRow): boolean {
  return (
    r.paymentStatus === "MONTH_CLOSED" ||
    r.paymentStatus === "PAYABLE" ||
    r.workflowStatus === "MONTH_CLOSED" ||
    r.workflowStatus === "PAYABLE"
  );
}

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
      setBatchMsg("Select invoices first");
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

  const canBatch = selected.size > 0;

  return (
    <RepairOwnerShell>
      <div className={cn(shopAa.page, "mx-auto max-w-7xl px-4 py-6 space-y-4")}>
        <WorkspaceTitle title="Invoices" />
        <p className={shopAa.muted}>
          RESIDCO · Owner invoice review queue. Invoice Submitted → review →
          Approve / Reject / Short-pay → Payable →{" "}
          <Link href="/repair/payments" className={repairUi.link}>
            payment batches
          </Link>{" "}
          CSV export (no real payments).
        </p>

        <div
          className={cn(
            repairUi.panel,
            "flex flex-wrap items-end gap-3 rounded border p-3",
          )}
        >
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
          <label className={cn("flex items-center gap-2 text-sm font-medium", repairUi.text)}>
            <input
              type="checkbox"
              className={repairUi.checkbox}
              checked={overOnly}
              onChange={(e) => setOverOnly(e.target.checked)}
            />
            Amount over estimate
          </label>
          <Button
            onClick={() => void load()}
            disabled={busy}
            className={cn(repairUi.btnSecondary, "font-semibold")}
          >
            Apply
          </Button>
          <div className="flex flex-col gap-1">
            <Button
              variant="secondary"
              onClick={() => void createBatch()}
              disabled={!canBatch}
              className={cn(
                canBatch ? repairUi.btnSecondary : "",
                "font-semibold",
              )}
              title={canBatch ? "Create batch + export CSV" : "Select invoices first"}
            >
              Create batch + export CSV
            </Button>
            {!canBatch && (
              <span className={cn(repairUi.muted, "text-xs")} data-testid="batch-hint">
                Select invoices first
              </span>
            )}
          </div>
        </div>

        {batchMsg && (
          <p className={cn("text-sm font-medium", repairUi.text)}>{batchMsg}</p>
        )}
        {error && <p className="text-sm font-medium text-red-800">{error}</p>}

        <div className={cn(repairUi.panel, "overflow-x-auto rounded border")}>
          <table className={cn("min-w-full text-sm", repairUi.text)}>
            <thead className="bg-slate-100 text-left">
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
                    className={cn("px-3 py-6 text-center", repairUi.muted)}
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
                      repairUi.text,
                      r.differenceCents > 0 && repairUi.rowHighlight,
                    )}
                  >
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        className={repairUi.checkbox}
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        disabled={!isPayable(r)}
                      />
                    </td>
                    <td className="px-2 py-2 font-mono font-semibold">
                      {r.carMark} {r.carNumber}
                    </td>
                    <td className="px-2 py-2">{r.shopMark}</td>
                    <td className="px-2 py-2 font-mono">{r.invoiceNo}</td>
                    <td className="px-2 py-2">{r.invoiceDate}</td>
                    <td className="px-2 py-2 text-right font-mono font-semibold">
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
                    <td className="px-2 py-2 text-xs font-medium">
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
                          className={cn(
                            repairUi.btnSecondary,
                            "font-semibold border",
                            repairUi.rowHighlight,
                          )}
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
