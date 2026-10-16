/**
 * §H r3/r4 — Shop multi-car invoice create (any number of cars ≥ 2; no cap).
 * Select several Completed estimates (same shop + entity); one invoice # + PDF + 500-byte.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { shopAa } from "./RepairNavChrome";
import { cn } from "@/lib/utils";

type Candidate = {
  eventId: string;
  estimateId: string;
  carMark: string;
  carNumber: string;
  estimateCents: number;
  entityCode: string | null;
  hasResp3: boolean;
  onActiveInvoice: boolean;
  status: string;
};

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export default function ShopMultiCarInvoice() {
  const [, setLoc] = useLocation();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [invoiceNo, setInvoiceNo] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [aar, setAar] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    const res = await fetch("/api/repair/shop/multi-car-candidates");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || `HTTP ${res.status}`);
      return;
    }
    setCandidates(json.candidates ?? []);
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

  const picked = candidates.filter((c) => selected.has(c.eventId));
  const sumEst = picked.reduce((s, c) => s + c.estimateCents, 0);

  async function submit() {
    setBusy(true);
    setMsg("");
    setError("");
    if (!pdf || !aar) {
      setError("PDF and 500-byte file required");
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/repair/shop/multi-car-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventIds: Array.from(selected),
          invoiceNo,
          total: sumEst / 100,
          pdfBase64: await fileToBase64(pdf),
          aarBase64: await fileToBase64(aar),
          pdfFilename: pdf.name,
          aarFilename: aar.name,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(
          [json.error, ...(json.hardRejects ?? [])].filter(Boolean).join(" — "),
        );
        setBusy(false);
        return;
      }
      setMsg(
        `Created multi-car invoice ${json.invoiceNo} (${json.carCount} cars, ${money(json.totalCents)}).`,
      );
      setSelected(new Set());
      void load();
      setLoc(`/repair/invoices/${json.invoiceId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn(shopAa.page, "mx-auto max-w-4xl px-4 py-6 space-y-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-slate-900">
            Create multi-car invoice
          </h1>
          <p className={shopAa.muted}>
            Multi-car invoice — same shop &amp; billing entity; two or more
            completed estimates. One invoice number. No cap on cars.
          </p>
        </div>
        <Link href="/repair/shop">
          <Button variant="outline" size="sm">
            ← Shop portal
          </Button>
        </Link>
      </div>

      {error && <p className="text-sm font-medium text-red-800">{error}</p>}
      {msg && <p className="text-sm font-medium text-slate-900">{msg}</p>}

      <div className="overflow-x-auto rounded border border-slate-400 bg-white">
        <table className="min-w-full text-sm text-slate-900">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-2 py-2">☑</th>
              <th className="px-2 py-2">Car</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Entity</th>
              <th className="px-2 py-2 text-right">Estimate</th>
              <th className="px-2 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => {
              const blocked = c.onActiveInvoice;
              return (
                <tr key={c.eventId} className="border-t border-slate-200">
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      disabled={blocked}
                      checked={selected.has(c.eventId)}
                      onChange={() => toggle(c.eventId)}
                    />
                  </td>
                  <td className="px-2 py-2 font-mono font-semibold">
                    {c.carMark} {c.carNumber}
                  </td>
                  <td className="px-2 py-2">{c.status}</td>
                  <td className="px-2 py-2">{c.entityCode || "—"}</td>
                  <td className="px-2 py-2 text-right font-mono">
                    {money(c.estimateCents)}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-700">
                    {blocked
                      ? "Already on active invoice"
                      : c.hasResp3
                        ? "Resp 3 wreck"
                        : "—"}
                  </td>
                </tr>
              );
            })}
            {candidates.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-700">
                  No completed estimates available for multi-car invoice.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded border border-slate-400 bg-white p-4 space-y-3">
        <p className="text-sm font-semibold text-slate-900">
          Selected {picked.length} car(s) · header total {money(sumEst)}
        </p>
        <div>
          <Label className={shopAa.label}>Invoice #</Label>
          <Input
            className={cn("mt-1 max-w-xs", shopAa.input)}
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
          />
        </div>
        <div>
          <Label className={shopAa.label}>Invoice PDF</Label>
          <Input
            type="file"
            accept="application/pdf"
            className={cn("mt-1", shopAa.input)}
            onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
          />
        </div>
        <div>
          <Label className={shopAa.label}>500-byte AAR / multi-car file</Label>
          <Input
            type="file"
            className={cn("mt-1", shopAa.input)}
            onChange={(e) => setAar(e.target.files?.[0] ?? null)}
          />
        </div>
        <Button
          disabled={
            busy || picked.length < 2 || !invoiceNo.trim() || !pdf || !aar
          }
          onClick={() => void submit()}
        >
          Create multi-car invoice
        </Button>
      </div>
    </div>
  );
}
