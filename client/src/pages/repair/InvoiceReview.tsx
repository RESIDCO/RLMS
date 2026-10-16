/**
 * §H Invoice review — side-by-side approved estimate vs invoice lines.
 * Approve / Reject (line comments) / Short-pay. Tolerance $/% gating.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import RepairOwnerShell from "./RepairOwnerShell";
import { WorkspaceTitle } from "./WorkspaceTitle";
import { cn } from "@/lib/utils";

type MatchedLine = {
  lineNo: number | null;
  jobCode: string;
  kind: string;
  estimate?: {
    lineNo: number;
    jobCode: string;
    qty: number | null;
    totalCents: number;
    respCode: string | null;
  };
  invoice?: {
    lineNo: number;
    jobCode: string;
    qty: number | null;
    totalCents: number;
    respCode: string | null;
  };
};

type Bundle = {
  invoice: {
    id: string;
    invoiceNo: string;
    invoiceDate: string;
    totalCents: number;
    estimateCents: number;
    workflowStatus: string | null;
    paymentStatus: string | null;
    dueDate: string | null;
    overToleranceReason: string | null;
  };
  car: { mark: string; number: string };
  shop: { mark: string; name: string | null };
  matched: MatchedLine[];
  validation: {
    hardRejects: Array<{ code: string; message: string }>;
    flags: Array<{ code: string; message: string; lineNo?: number | null }>;
  };
  tolerance: {
    toleranceCents: number;
    tolerancePctBp: number;
    paymentTermsDays: number;
  };
  tolCheck: {
    within: boolean;
    deltaCents: number;
    allowedCents: number;
    pctDeltaBp: number;
  };
  canApprove: boolean;
  canApproveWithReason: boolean;
  respSplit: {
    ownerCents: number;
    lessee6Cents: number;
    road3Cents: number;
    otherCents: number;
  };
  displays: { invoiceTotal: string; estimateTotal: string; delta: string };
};

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default function InvoiceReview() {
  const [, params] = useRoute("/repair/invoices/:id");
  const id = params?.id ?? "";
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [overReason, setOverReason] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [lineComments, setLineComments] = useState<Record<number, string>>({});
  const [showReject, setShowReject] = useState(false);
  const [showShort, setShowShort] = useState(false);
  const [shortReason, setShortReason] = useState("");
  const [shortLines, setShortLines] = useState<
    Record<number, { cents: string; reason: string }>
  >({});
  const [paidAt, setPaidAt] = useState("");
  const [paidRef, setPaidRef] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setError("");
    const res = await fetch(`/api/repair/invoices/${id}/review`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || `HTTP ${res.status}`);
      setBundle(null);
      return;
    }
    setBundle(json);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve() {
    setMsg("");
    const res = await fetch(`/api/repair/invoices/${id}/owner-approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        overToleranceReason: overReason.trim() || undefined,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMsg(json.error || `HTTP ${res.status}`);
      return;
    }
    setMsg(`Approved → Payable (due ${json.dueDate}). BO Closed.`);
    void load();
  }

  async function reject() {
    setMsg("");
    const comments = Object.entries(lineComments)
      .filter(([, t]) => t.trim())
      .map(([lineNo, text]) => ({ lineNo: Number(lineNo), text: text.trim() }));
    const res = await fetch(`/api/repair/invoices/${id}/owner-reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: rejectNote, lineComments: comments }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMsg(json.error || `HTTP ${res.status}`);
      return;
    }
    setShowReject(false);
    setMsg("Rejected — back to shop with comments.");
    void load();
  }

  async function shortPay() {
    setMsg("");
    const lineShortPays = Object.entries(shortLines)
      .filter(([, v]) => v.cents.trim())
      .map(([lineNo, v]) => ({
        lineNo: Number(lineNo),
        amountCents: Math.round(Number(v.cents) * 100),
        reason: v.reason.trim(),
      }));
    const res = await fetch(`/api/repair/invoices/${id}/short-pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: shortReason, lineShortPays }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMsg(json.error || `HTTP ${res.status}`);
      return;
    }
    setShowShort(false);
    setMsg(
      `Short-paid → Payable ${dollars(json.approvedAmountCents)} (short ${dollars(json.shortPayCents)}).`,
    );
    void load();
  }

  async function markPaid() {
    setMsg("");
    const res = await fetch(`/api/repair/invoices/${id}/record-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paidAt, paidRef, paidMethod: "CHECK" }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMsg(json.error || `HTTP ${res.status}`);
      return;
    }
    setMsg(`Recorded paid ${paidAt} ref ${paidRef}.`);
    void load();
  }

  if (!bundle && !error) {
    return (
      <RepairOwnerShell>
        <div className="p-6 text-slate-700">Loading invoice…</div>
      </RepairOwnerShell>
    );
  }

  if (error || !bundle) {
    return (
      <RepairOwnerShell>
        <div className="p-6 text-red-700">{error || "Not found"}</div>
      </RepairOwnerShell>
    );
  }

  const reviewable =
    bundle.invoice.workflowStatus === "UNDER_OWNER_REVIEW" ||
    bundle.invoice.workflowStatus === "INVOICE_SUBMITTED";

  return (
    <RepairOwnerShell>
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <WorkspaceTitle
            title={`Invoice ${bundle.invoice.invoiceNo}`}
            subtitle={`${bundle.car.mark} ${bundle.car.number} · ${bundle.shop.mark}`}
          />
          <Link href="/repair/invoices">
            <Button variant="outline" size="sm">
              ← Invoice queue
            </Button>
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-4 text-sm">
          <div className="rounded border border-slate-300 bg-white p-3">
            <p className="text-slate-700">Invoice</p>
            <p className="font-mono text-lg font-semibold text-slate-900">
              ${bundle.displays.invoiceTotal}
            </p>
          </div>
          <div className="rounded border border-slate-300 bg-white p-3">
            <p className="text-slate-700">Approved estimate</p>
            <p className="font-mono text-lg font-semibold text-slate-900">
              ${bundle.displays.estimateTotal}
            </p>
          </div>
          <div className="rounded border border-slate-300 bg-white p-3">
            <p className="text-slate-700">Difference</p>
            <p
              className={cn(
                "font-mono text-lg font-semibold",
                bundle.tolCheck.within ? "text-slate-900" : "text-amber-800",
              )}
            >
              ${bundle.displays.delta} ({(bundle.tolCheck.pctDeltaBp / 100).toFixed(2)}%)
            </p>
            <p className="text-xs text-slate-600">
              Tolerance ${ (bundle.tolerance.toleranceCents / 100).toFixed(2) } /{" "}
              {(bundle.tolerance.tolerancePctBp / 100).toFixed(2)}% · net{" "}
              {bundle.tolerance.paymentTermsDays}
            </p>
          </div>
          <div className="rounded border border-slate-300 bg-white p-3">
            <p className="text-slate-700">Status</p>
            <p className="font-semibold text-slate-900">
              {bundle.invoice.paymentStatus || bundle.invoice.workflowStatus}
            </p>
            {bundle.invoice.dueDate && (
              <p className="text-xs text-slate-700">Due {bundle.invoice.dueDate}</p>
            )}
          </div>
        </div>

        <div className="rounded border border-slate-300 bg-white p-3 text-sm">
          <p className="font-semibold text-slate-900">Responsibility split (for rebill)</p>
          <p className="text-slate-800">
            Owner {dollars(bundle.respSplit.ownerCents)} · Lessee (6){" "}
            {dollars(bundle.respSplit.lessee6Cents)} · Road (3){" "}
            {dollars(bundle.respSplit.road3Cents)}
            {bundle.respSplit.lessee6Cents + bundle.respSplit.road3Cents > 0
              ? " → Rebill pending"
              : ""}
          </p>
        </div>

        {(bundle.validation.hardRejects.length > 0 ||
          bundle.validation.flags.length > 0) && (
          <div className="space-y-1 rounded border border-slate-300 bg-white p-3 text-sm">
            {bundle.validation.hardRejects.map((f) => (
              <p key={f.code} className="font-medium text-red-800">
                HARD: {f.message}
              </p>
            ))}
            {bundle.validation.flags.map((f, i) => (
              <p key={`${f.code}-${i}`} className="text-amber-900">
                Flag: {f.message}
              </p>
            ))}
          </div>
        )}

        <div className="overflow-x-auto rounded border border-slate-300 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-2 py-2">Line</th>
                <th className="px-2 py-2">Job</th>
                <th className="px-2 py-2">Kind</th>
                <th className="px-2 py-2 text-right">Est qty</th>
                <th className="px-2 py-2 text-right">Est $</th>
                <th className="px-2 py-2 text-right">Inv qty</th>
                <th className="px-2 py-2 text-right">Inv $</th>
                <th className="px-2 py-2">Resp</th>
              </tr>
            </thead>
            <tbody>
              {bundle.matched.map((m, i) => (
                <tr
                  key={i}
                  className={cn(
                    "border-t border-slate-200",
                    m.kind === "ADDED" && "bg-amber-50",
                    m.kind === "REMOVED" && "bg-slate-100",
                    m.kind === "QTY_PRICE_CHANGED" && "bg-yellow-50",
                  )}
                >
                  <td className="px-2 py-1.5 font-mono">{m.lineNo ?? "—"}</td>
                  <td className="px-2 py-1.5 font-mono">
                    {m.jobCode || m.estimate?.jobCode || "—"}
                  </td>
                  <td className="px-2 py-1.5 text-xs">{m.kind}</td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {m.estimate?.qty ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {m.estimate ? dollars(m.estimate.totalCents) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {m.invoice?.qty ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {m.invoice ? dollars(m.invoice.totalCents) : "—"}
                  </td>
                  <td className="px-2 py-1.5 font-mono">
                    {m.invoice?.respCode || m.estimate?.respCode || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {msg && <p className="text-sm font-medium text-slate-900">{msg}</p>}

        {reviewable && (
          <div className="space-y-3 rounded border border-slate-300 bg-white p-4">
            {!bundle.tolCheck.within && (
              <div>
                <Label>Over-tolerance approval reason (required)</Label>
                <Textarea
                  className="mt-1"
                  rows={2}
                  value={overReason}
                  onChange={(e) => setOverReason(e.target.value)}
                  placeholder="Owner/MP reason for approving over tolerance"
                />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void approve()}
                disabled={
                  bundle.validation.hardRejects.length > 0 ||
                  (!bundle.tolCheck.within && !overReason.trim())
                }
              >
                Approve
              </Button>
              <Button variant="destructive" onClick={() => setShowReject(true)}>
                Reject
              </Button>
              <Button variant="secondary" onClick={() => setShowShort(true)}>
                Short-pay
              </Button>
            </div>
          </div>
        )}

        {(bundle.invoice.paymentStatus === "PAYABLE" ||
          bundle.invoice.paymentStatus === "EXPORTED" ||
          bundle.invoice.paymentStatus === "IN_BATCH") && (
          <div className="flex flex-wrap items-end gap-2 rounded border border-slate-300 bg-white p-4">
            <div>
              <Label>Paid date</Label>
              <Input
                type="date"
                className="h-8"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            </div>
            <div>
              <Label>Check / ACH ref</Label>
              <Input
                className="h-8 w-40"
                value={paidRef}
                onChange={(e) => setPaidRef(e.target.value)}
              />
            </div>
            <Button onClick={() => void markPaid()}>Record paid</Button>
          </div>
        )}

        {showReject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded bg-white p-4 shadow">
              <h3 className="text-lg font-semibold text-slate-900">
                Reject invoice
              </h3>
              <Label className="mt-2">Reason (sent to shop)</Label>
              <Textarea
                className="mt-1"
                rows={3}
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
              />
              <p className="mt-2 text-sm font-medium text-slate-800">
                Line comments
              </p>
              {bundle.matched
                .filter((m) => m.invoice)
                .map((m) => (
                  <div key={m.lineNo!} className="mt-1">
                    <Label className="text-xs">
                      Line {m.lineNo} ({m.jobCode || "—"})
                    </Label>
                    <Input
                      className="h-8"
                      value={lineComments[m.lineNo!] ?? ""}
                      onChange={(e) =>
                        setLineComments((prev) => ({
                          ...prev,
                          [m.lineNo!]: e.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowReject(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={!rejectNote.trim()}
                  onClick={() => void reject()}
                >
                  Reject
                </Button>
              </div>
            </div>
          </div>
        )}

        {showShort && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded bg-white p-4 shadow">
              <h3 className="text-lg font-semibold text-slate-900">Short-pay</h3>
              <Label className="mt-2">Overall reason</Label>
              <Textarea
                className="mt-1"
                rows={2}
                value={shortReason}
                onChange={(e) => setShortReason(e.target.value)}
              />
              {bundle.matched
                .filter((m) => m.invoice)
                .map((m) => (
                  <div key={m.lineNo!} className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">
                        Line {m.lineNo} pay $ (was{" "}
                        {dollars(m.invoice!.totalCents)})
                      </Label>
                      <Input
                        className="h-8"
                        value={shortLines[m.lineNo!]?.cents ?? ""}
                        onChange={(e) =>
                          setShortLines((prev) => ({
                            ...prev,
                            [m.lineNo!]: {
                              cents: e.target.value,
                              reason: prev[m.lineNo!]?.reason ?? "",
                            },
                          }))
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Line reason</Label>
                      <Input
                        className="h-8"
                        value={shortLines[m.lineNo!]?.reason ?? ""}
                        onChange={(e) =>
                          setShortLines((prev) => ({
                            ...prev,
                            [m.lineNo!]: {
                              cents: prev[m.lineNo!]?.cents ?? "",
                              reason: e.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                ))}
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowShort(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={!shortReason.trim()}
                  onClick={() => void shortPay()}
                >
                  Short-pay
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </RepairOwnerShell>
  );
}
