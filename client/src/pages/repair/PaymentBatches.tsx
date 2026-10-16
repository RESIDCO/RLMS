/**
 * §H r2 — Shop payment batches `/#/repair/payments`
 * Payables with checkboxes → Create batch → Download CSV → Mark exported
 * → Record paid. Batch history with drill-in. CSV also written to outbox.
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

type PayableRow = {
  id: string;
  carMark: string;
  carNumber: string;
  shopMark: string;
  invoiceNo: string;
  invoiceCents: number;
  estimateCents: number;
  dueDate: string | null;
  paymentStatus: string | null;
  workflowStatus: string | null;
  shortPayCents: number | null;
};

type BatchRow = {
  id: string;
  batch_no: string;
  status: string;
  created_at: string;
  exported_at?: string | null;
  outbox_path?: string | null;
  invoice_count?: number;
  note?: string | null;
};

type BatchInvoice = {
  id: string;
  invoiceNo: string;
  paymentStatus: string | null;
  amountCents: number;
  dueDate: string | null;
  paidAt: string | null;
  paidRef: string | null;
  carMark: string;
  carNumber: string;
  shopMark: string;
};

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default function PaymentBatches() {
  const [payables, setPayables] = useState<PayableRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [batchInvoices, setBatchInvoices] = useState<BatchInvoice[]>([]);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [paidRef, setPaidRef] = useState("");
  const [paidMethod, setPaidMethod] = useState("CHECK");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [qRes, bRes] = await Promise.all([
        fetch("/api/repair/invoices/queue?status=MONTH_CLOSED"),
        fetch("/api/repair/payment-batches"),
      ]);
      const qJson = await qRes.json();
      const bJson = await bRes.json();
      if (!qRes.ok) {
        setError(qJson.error || `HTTP ${qRes.status}`);
        setPayables([]);
      } else {
        setPayables(qJson.invoices ?? []);
      }
      if (!bRes.ok) {
        setError((prev) => prev || bJson.error || `HTTP ${bRes.status}`);
      } else {
        setBatches(bJson.batches ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createBatch() {
    setMsg("");
    const ids = Array.from(selected);
    if (!ids.length) {
      setMsg("Select payable invoices first");
      return;
    }
    const res = await fetch("/api/repair/payment-batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceIds: ids }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMsg(json.error || `HTTP ${res.status}`);
      return;
    }
    setMsg(`Batch ${json.batch?.batch_no ?? ""} created (${json.invoiceCount} invoices)`);
    setSelected(new Set());
    if (json.batch?.id) setActiveBatchId(String(json.batch.id));
    void load();
  }

  async function downloadAndExport(batchId: string) {
    setMsg("");
    const res = await fetch(`/api/repair/payment-batches/${batchId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const json = await res.json();
    if (!res.ok) {
      setMsg(json.error || `HTTP ${res.status}`);
      return;
    }
    if (json.csv) {
      const blob = new Blob([json.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${json.batchNo || "payment-batch"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setMsg(
      `Batch ${json.batchNo} marked Exported (${json.rowCount} rows).` +
        (json.outboxPath ? ` Outbox: ${json.outboxPath}` : ""),
    );
    void load();
    void openBatch(batchId);
  }

  async function openBatch(batchId: string) {
    setActiveBatchId(batchId);
    const res = await fetch(`/api/repair/payment-batches/${batchId}`);
    const json = await res.json();
    if (!res.ok) {
      setMsg(json.error || `HTTP ${res.status}`);
      setBatchInvoices([]);
      return;
    }
    setBatchInvoices(json.invoices ?? []);
  }

  async function recordPaid(invoiceId: string) {
    setMsg("");
    if (!paidAt.trim() || !paidRef.trim()) {
      setMsg("Paid date (YYYY-MM-DD) and check/ACH ref required");
      return;
    }
    const res = await fetch(`/api/repair/invoices/${invoiceId}/record-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paidAt: paidAt.trim().slice(0, 10),
        paidRef: paidRef.trim(),
        paidMethod: paidMethod.trim() || "CHECK",
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMsg(json.error || `HTTP ${res.status}`);
      return;
    }
    setMsg(`Recorded paid ${paidRef.trim()} on ${paidAt.trim().slice(0, 10)}`);
    if (activeBatchId) void openBatch(activeBatchId);
    void load();
  }

  return (
    <RepairOwnerShell>
      <div className={cn(shopAa.page, "mx-auto max-w-7xl px-4 py-6 space-y-6")}>
        <WorkspaceTitle title="Payments" />
        <p className={shopAa.muted}>
          RESIDCO · Shop payment batches — CSV export only (no real ACH). Payable
          → Create batch → Download CSV / Mark exported → Record paid (date +
          check/ACH ref). Dates in CSV are ISO YYYY-MM-DD; amounts are 2
          decimals with no $.
        </p>
        <p className="text-sm">
          <Link
            href="/repair/invoices"
            className="font-semibold text-blue-800 underline"
          >
            ← Invoice queue
          </Link>
        </p>

        <div className="repair-aa-panel flex flex-wrap items-end gap-3 rounded border border-slate-400 bg-white p-3 text-slate-900">
          <Button
            onClick={() => void load()}
            disabled={busy}
            className="font-semibold text-slate-900"
          >
            Refresh
          </Button>
          <Button
            onClick={() => void createBatch()}
            className="font-semibold text-slate-900"
          >
            Create batch
          </Button>
        </div>

        {msg && <p className="text-sm font-medium text-slate-900">{msg}</p>}
        {error && <p className="text-sm font-medium text-red-800">{error}</p>}

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">Payables</h2>
          <div className="repair-aa-panel overflow-x-auto rounded border border-slate-400 bg-white text-slate-900">
            <table className="min-w-full text-sm text-slate-900">
              <thead className="bg-slate-100 text-left text-slate-900">
                <tr>
                  <th className="px-2 py-2">☑</th>
                  <th className="px-2 py-2">Car</th>
                  <th className="px-2 py-2">Shop</th>
                  <th className="px-2 py-2">Invoice #</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2">Due</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {payables.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-6 text-center text-slate-700"
                    >
                      {busy ? "Loading…" : "No payable invoices."}
                    </td>
                  </tr>
                ) : (
                  payables.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-slate-200 text-slate-900"
                    >
                      <td className="px-2 py-2 text-slate-900">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggle(r.id)}
                        />
                      </td>
                      <td className="px-2 py-2 font-mono font-semibold text-slate-900">
                        {r.carMark} {r.carNumber}
                      </td>
                      <td className="px-2 py-2 text-slate-900">{r.shopMark}</td>
                      <td className="px-2 py-2 font-mono text-slate-900">
                        {r.invoiceNo}
                      </td>
                      <td className="px-2 py-2 text-right font-mono font-semibold text-slate-900">
                        {dollars(r.invoiceCents)}
                        {r.shortPayCents != null && r.shortPayCents > 0
                          ? " · short"
                          : ""}
                      </td>
                      <td className="px-2 py-2 font-mono text-slate-900">
                        {r.dueDate || "—"}
                      </td>
                      <td className="px-2 py-2 text-xs font-medium text-slate-900">
                        {r.paymentStatus || r.workflowStatus || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">
            Batch history
          </h2>
          <div className="repair-aa-panel overflow-x-auto rounded border border-slate-400 bg-white text-slate-900">
            <table className="min-w-full text-sm text-slate-900">
              <thead className="bg-slate-100 text-left text-slate-900">
                <tr>
                  <th className="px-2 py-2">Batch #</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Invoices</th>
                  <th className="px-2 py-2">Created</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {batches.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-slate-700"
                    >
                      No batches yet.
                    </td>
                  </tr>
                ) : (
                  batches.map((b) => (
                    <tr
                      key={b.id}
                      className={cn(
                        "border-t border-slate-200 text-slate-900",
                        activeBatchId === b.id && "bg-sky-50 text-slate-900",
                      )}
                    >
                      <td className="px-2 py-2 font-mono text-slate-900">
                        {b.batch_no}
                      </td>
                      <td className="px-2 py-2 text-xs font-medium text-slate-900">
                        {b.status}
                      </td>
                      <td className="px-2 py-2 font-mono text-slate-900">
                        {b.invoice_count ?? "—"}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-slate-900">
                        {String(b.created_at).slice(0, 19)}
                      </td>
                      <td className="px-2 py-2 space-x-2">
                        <Button
                          size="sm"
                          className="font-semibold text-slate-900 bg-white border border-slate-700"
                          onClick={() => void openBatch(b.id)}
                        >
                          Drill in
                        </Button>
                        {b.status !== "EXPORTED" && b.status !== "CLOSED" ? (
                          <Button
                            size="sm"
                            className="font-semibold text-slate-900"
                            onClick={() => void downloadAndExport(b.id)}
                          >
                            Download CSV / Mark exported
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="font-semibold text-slate-900"
                            onClick={() => void downloadAndExport(b.id)}
                          >
                            Re-download CSV
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {activeBatchId && (
          <section className="repair-aa-panel space-y-3 rounded border border-slate-400 bg-white p-4 text-slate-900">
            <h2 className="text-base font-semibold text-slate-900">
              Batch detail
            </h2>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className={shopAa.label}>Paid date (ISO)</Label>
                <Input
                  className={cn(shopAa.input, "mt-1 h-8 w-36 font-mono")}
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                  placeholder="YYYY-MM-DD"
                />
              </div>
              <div>
                <Label className={shopAa.label}>Check / ACH ref</Label>
                <Input
                  className={cn(shopAa.input, "mt-1 h-8 w-40 font-mono")}
                  value={paidRef}
                  onChange={(e) => setPaidRef(e.target.value)}
                />
              </div>
              <div>
                <Label className={shopAa.label}>Method</Label>
                <select
                  className={cn(shopAa.select, "mt-1 h-8 w-auto")}
                  value={paidMethod}
                  onChange={(e) => setPaidMethod(e.target.value)}
                >
                  <option value="CHECK">CHECK</option>
                  <option value="ACH">ACH</option>
                  <option value="WIRE">WIRE</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-slate-900">
                <thead className="bg-slate-100 text-left text-slate-900">
                  <tr>
                    <th className="px-2 py-2">Invoice #</th>
                    <th className="px-2 py-2">Car</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                    <th className="px-2 py-2">Due</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Paid</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {batchInvoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="border-t border-slate-200 text-slate-900"
                    >
                      <td className="px-2 py-2 font-mono text-slate-900">
                        {inv.invoiceNo}
                      </td>
                      <td className="px-2 py-2 font-mono text-slate-900">
                        {inv.carMark} {inv.carNumber}
                      </td>
                      <td className="px-2 py-2 text-right font-mono font-semibold text-slate-900">
                        {dollars(inv.amountCents)}
                      </td>
                      <td className="px-2 py-2 font-mono text-slate-900">
                        {inv.dueDate || "—"}
                      </td>
                      <td className="px-2 py-2 text-xs font-medium text-slate-900">
                        {inv.paymentStatus || "—"}
                      </td>
                      <td className="px-2 py-2 text-xs font-mono text-slate-900">
                        {inv.paidAt
                          ? `${inv.paidAt} ${inv.paidRef || ""}`
                          : "—"}
                      </td>
                      <td className="px-2 py-2">
                        {inv.paymentStatus !== "PAID" && (
                          <Button
                            size="sm"
                            className="font-semibold text-slate-900"
                            onClick={() => void recordPaid(inv.id)}
                          >
                            Record paid
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </RepairOwnerShell>
  );
}
