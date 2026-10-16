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
        fetch("/api/repair/invoices/queue?status=PAYABLE"),
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
      <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        <WorkspaceTitle
          title="Payments"
          subtitle="Shop payment batches — CSV export only (no real ACH)"
        />
        <p className="text-sm text-slate-700">
          RESIDCO · Payable → Create batch → Download CSV / Mark exported →
          Record paid (date + check/ACH ref). Dates in CSV are ISO YYYY-MM-DD;
          amounts are 2 decimals with no $.
        </p>
        <p className="text-sm">
          <Link href="/repair/invoices" className="text-blue-700 underline">
            ← Invoice queue
          </Link>
        </p>

        <div className="flex flex-wrap items-end gap-3 rounded border border-slate-300 bg-white p-3">
          <Button onClick={() => void load()} disabled={busy}>
            Refresh
          </Button>
          <Button onClick={() => void createBatch()}>Create batch</Button>
        </div>

        {msg && <p className="text-sm font-medium text-slate-900">{msg}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">Payables</h2>
          <div className="overflow-x-auto rounded border border-slate-300 bg-white">
            <table className="min-w-full text-sm">
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
                      className="px-3 py-6 text-center text-slate-600"
                    >
                      {busy ? "Loading…" : "No payable invoices."}
                    </td>
                  </tr>
                ) : (
                  payables.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-slate-200"
                    >
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggle(r.id)}
                        />
                      </td>
                      <td className="px-2 py-2 font-mono font-semibold">
                        {r.carMark} {r.carNumber}
                      </td>
                      <td className="px-2 py-2">{r.shopMark}</td>
                      <td className="px-2 py-2 font-mono">{r.invoiceNo}</td>
                      <td className="px-2 py-2 text-right font-mono">
                        {dollars(r.invoiceCents)}
                        {r.shortPayCents != null && r.shortPayCents > 0
                          ? " · short"
                          : ""}
                      </td>
                      <td className="px-2 py-2 font-mono">{r.dueDate || "—"}</td>
                      <td className="px-2 py-2 text-xs">
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
          <div className="overflow-x-auto rounded border border-slate-300 bg-white">
            <table className="min-w-full text-sm">
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
                      className="px-3 py-6 text-center text-slate-600"
                    >
                      No batches yet.
                    </td>
                  </tr>
                ) : (
                  batches.map((b) => (
                    <tr
                      key={b.id}
                      className={cn(
                        "border-t border-slate-200",
                        activeBatchId === b.id && "bg-sky-50",
                      )}
                    >
                      <td className="px-2 py-2 font-mono">{b.batch_no}</td>
                      <td className="px-2 py-2 text-xs">{b.status}</td>
                      <td className="px-2 py-2 font-mono">
                        {b.invoice_count ?? "—"}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">
                        {String(b.created_at).slice(0, 19)}
                      </td>
                      <td className="px-2 py-2 space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void openBatch(b.id)}
                        >
                          Drill in
                        </Button>
                        {b.status !== "EXPORTED" && b.status !== "CLOSED" ? (
                          <Button
                            size="sm"
                            onClick={() => void downloadAndExport(b.id)}
                          >
                            Download CSV / Mark exported
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
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
          <section className="space-y-3 rounded border border-slate-300 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">
              Batch detail
            </h2>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-slate-800">Paid date (ISO)</Label>
                <Input
                  className="h-8 w-36 font-mono"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                  placeholder="YYYY-MM-DD"
                />
              </div>
              <div>
                <Label className="text-slate-800">Check / ACH ref</Label>
                <Input
                  className="h-8 w-40 font-mono"
                  value={paidRef}
                  onChange={(e) => setPaidRef(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-slate-800">Method</Label>
                <select
                  className="mt-0 block h-8 rounded border border-slate-300 bg-white px-2 text-sm"
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
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left">
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
                    <tr key={inv.id} className="border-t border-slate-200">
                      <td className="px-2 py-2 font-mono">{inv.invoiceNo}</td>
                      <td className="px-2 py-2 font-mono">
                        {inv.carMark} {inv.carNumber}
                      </td>
                      <td className="px-2 py-2 text-right font-mono">
                        {dollars(inv.amountCents)}
                      </td>
                      <td className="px-2 py-2 font-mono">
                        {inv.dueDate || "—"}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {inv.paymentStatus || "—"}
                      </td>
                      <td className="px-2 py-2 text-xs font-mono">
                        {inv.paidAt
                          ? `${inv.paidAt} ${inv.paidRef || ""}`
                          : "—"}
                      </td>
                      <td className="px-2 py-2">
                        {inv.paymentStatus !== "PAID" && (
                          <Button
                            size="sm"
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
