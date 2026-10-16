/**
 * §H r5 Invoice review — quieter BRC-format line grid + Exceptions toggle.
 * Summary cards → resp split → (multi-car picker) → BRC lines.
 * Highlights only exceptions on the row; no long flag list.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { AlertTriangle, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import RepairOwnerShell from "./RepairOwnerShell";
import { WorkspaceTitle } from "./WorkspaceTitle";
import { CodeHover, dash } from "./CodeHover";
import { cn } from "@/lib/utils";
import { shopAa } from "./RepairNavChrome";

type BrcLine = {
  lineNo: number;
  jobCode: string;
  location?: string | null;
  qualifier?: string | null;
  conditionCode?: string | null;
  whyMade?: string | null;
  removedJobCode?: string | null;
  removedQualifier?: string | null;
  description?: string | null;
  qty: number | null;
  laborCents: number;
  materialCents: number;
  totalCents: number;
  respCode: string | null;
  invoiceCarId?: string | null;
  carMark?: string | null;
  carNumber?: string | null;
  shortPayCents?: number | null;
  shortPayReason?: string | null;
};

type MatchedLine = {
  lineNo: number | null;
  jobCode: string;
  kind: string;
  exceptionReason?: string | null;
  clearedBadges?: Array<{
    label: string;
    by?: string | null;
    at?: string | null;
  }>;
  estimate?: BrcLine;
  invoice?: BrcLine;
};

type InvoiceCar = {
  id: string;
  eventId: string;
  carMark: string;
  carNumber: string;
  estimateCents: number;
  invoicedCents: number;
  differenceCents: number;
  flags: string;
  exceptionsCount?: number;
  lineStatus: string;
  statusPlain?: string;
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
    statusPlain?: string | null;
    dueDate: string | null;
    overToleranceReason: string | null;
    shortPayCents?: number | null;
    netPayableCents?: number | null;
    isMultiCar?: boolean;
    monthLabel?: string | null;
  };
  car: { mark: string; number: string };
  cars?: InvoiceCar[];
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
  displays: {
    invoiceTotal: string;
    estimateTotal: string;
    delta: string;
    shortPay?: string | null;
    netPayable?: string | null;
  };
};

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function isException(m: MatchedLine): boolean {
  return m.kind !== "MATCH";
}

function moneyOrDash(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return dollars(cents);
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
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [selectedCarId, setSelectedCarId] = useState<string | null>(null);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);

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
    if (json.cars?.length && !selectedCarId) {
      setSelectedCarId(String(json.cars[0].id));
    }
  }, [id, selectedCarId]);

  useEffect(() => {
    void load();
  }, [load]);

  const carFiltered = useMemo(() => {
    if (!bundle) return [];
    if (!bundle.cars?.length || !selectedCarId) return bundle.matched;
    return bundle.matched.filter((m) => {
      const cid =
        m.invoice?.invoiceCarId || m.estimate?.invoiceCarId || null;
      return cid === selectedCarId;
    });
  }, [bundle, selectedCarId]);

  const exceptionCount = useMemo(
    () => carFiltered.filter(isException).length,
    [carFiltered],
  );

  const visibleLines = useMemo(() => {
    if (!exceptionsOnly) return carFiltered;
    return carFiltered.filter(isException);
  }, [carFiltered, exceptionsOnly]);

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
    setMsg(
      `Approved – In Open Month${json.monthLabel ? ` (${json.monthLabel})` : ""} (due ${json.dueDate}). BO Closed.`,
    );
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

  const hardRejectCount = bundle.validation.hardRejects.length;

  return (
    <RepairOwnerShell>
      <div className={cn(shopAa.page, "mx-auto max-w-[90rem] px-4 py-6 space-y-4")}>
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
              {bundle.displays.invoiceTotal.startsWith("$")
                ? bundle.displays.invoiceTotal
                : `$${bundle.displays.invoiceTotal}`}
            </p>
          </div>
          <div className="rounded border border-slate-300 bg-white p-3">
            <p className="text-slate-700">Approved estimate</p>
            <p className="font-mono text-lg font-semibold text-slate-900">
              {bundle.displays.estimateTotal.startsWith("$")
                ? bundle.displays.estimateTotal
                : `$${bundle.displays.estimateTotal}`}
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
              {bundle.displays.delta.startsWith("$")
                ? bundle.displays.delta
                : `$${bundle.displays.delta}`}{" "}
              ({(bundle.tolCheck.pctDeltaBp / 100).toFixed(2)}%)
            </p>
            <p className="text-xs text-slate-600">
              Tolerance ${(bundle.tolerance.toleranceCents / 100).toFixed(2)} /{" "}
              {(bundle.tolerance.tolerancePctBp / 100).toFixed(2)}% · net{" "}
              {bundle.tolerance.paymentTermsDays}
            </p>
          </div>
          <div className="rounded border border-slate-400 bg-white p-3">
            <p className={shopAa.label}>Status</p>
            <p className="font-semibold text-slate-900">
              {bundle.invoice.statusPlain ||
                bundle.invoice.paymentStatus ||
                bundle.invoice.workflowStatus}
            </p>
            {bundle.invoice.monthLabel && (
              <p className="text-xs text-slate-700">
                Month {bundle.invoice.monthLabel}
              </p>
            )}
            {bundle.invoice.dueDate && (
              <p className="text-xs text-slate-700">Due {bundle.invoice.dueDate}</p>
            )}
            {(bundle.invoice.shortPayCents != null ||
              bundle.displays.shortPay) && (
              <p className="mt-1 text-xs font-semibold text-slate-900">
                Short-pay{" "}
                {bundle.displays.shortPay ??
                  dollars(bundle.invoice.shortPayCents ?? 0)}
                {" · "}
                Net payable{" "}
                {bundle.displays.netPayable ??
                  dollars(
                    bundle.invoice.netPayableCents ??
                      bundle.invoice.totalCents -
                        (bundle.invoice.shortPayCents ?? 0),
                  )}
              </p>
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

        {hardRejectCount > 0 && (
          <div className="space-y-1 rounded border border-red-300 bg-white p-3 text-sm">
            {bundle.validation.hardRejects.map((f) => (
              <p key={f.code} className="font-medium text-red-800">
                HARD: {f.message}
              </p>
            ))}
          </div>
        )}

        {bundle.cars && bundle.cars.length > 0 && (
          <div className="overflow-x-auto rounded border border-slate-400 bg-white">
            <p className="border-b border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900">
              Per-car summary (shared invoice {bundle.invoice.invoiceNo}) — click a
              car to view its BRC lines
            </p>
            <table className="min-w-full text-sm text-slate-900">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-2 py-2">Car</th>
                  <th className="px-2 py-2 text-right">Estimate</th>
                  <th className="px-2 py-2 text-right">Invoiced</th>
                  <th className="px-2 py-2 text-right">Difference</th>
                  <th className="px-2 py-2 text-right">Exceptions</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {bundle.cars.map((c) => {
                  const selected = c.id === selectedCarId;
                  const status =
                    c.statusPlain ||
                    (c.differenceCents === 0
                      ? "Matches"
                      : c.differenceCents > 0
                        ? `Over $${(c.differenceCents / 100).toFixed(2)}`
                        : `Under $${(Math.abs(c.differenceCents) / 100).toFixed(2)}`);
                  return (
                    <tr
                      key={c.id}
                      className={cn(
                        "border-t border-slate-200 cursor-pointer",
                        selected ? "bg-slate-100" : "hover:bg-slate-50",
                      )}
                      onClick={() => setSelectedCarId(c.id)}
                    >
                      <td className="px-2 py-1.5 font-mono font-semibold">
                        {c.carMark} {c.carNumber}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {dollars(c.estimateCents)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {dollars(c.invoicedCents)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {dollars(c.differenceCents)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {c.exceptionsCount ??
                          (c.flags ? c.flags.split(/[,;]/).filter(Boolean).length : 0)}
                      </td>
                      <td className="px-2 py-1.5 text-xs font-medium">{status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {selectedCarId && (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2 text-sm">
                <span className="text-slate-700">Car picker</span>
                <select
                  className="h-8 rounded border border-slate-400 bg-white px-2 text-slate-900"
                  value={selectedCarId}
                  onChange={(e) => setSelectedCarId(e.target.value)}
                  aria-label="Select car for BRC line grid"
                >
                  {bundle.cars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.carMark} {c.carNumber}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className={cn(
              "rounded border px-3 py-1.5 text-sm font-medium",
              exceptionsOnly
                ? "border-amber-700 bg-amber-50 text-amber-950"
                : "border-slate-400 bg-white text-slate-900",
            )}
            onClick={() => setExceptionsOnly((v) => !v)}
            aria-pressed={exceptionsOnly}
          >
            Exceptions ({exceptionCount})
            {exceptionsOnly ? " — showing exceptions only" : " — show all lines"}
          </button>
          <p className="text-xs text-slate-700">
            Billing Repair Card columns · invoice amount next to approved amount
          </p>
        </div>

        <div className="overflow-x-auto rounded border border-slate-400 bg-white">
          <table className="min-w-full text-xs text-slate-900">
            <thead className="bg-slate-100 text-left text-slate-900">
              <tr>
                <th className="px-1.5 py-2 w-6" title="Exception" />
                <th className="px-1.5 py-2 font-semibold">Line</th>
                <th className="px-1.5 py-2 font-semibold">Loc</th>
                <th className="px-1.5 py-2 font-semibold">Qty</th>
                <th className="px-1.5 py-2 font-semibold">C</th>
                <th className="px-1.5 py-2 font-semibold">AJOB</th>
                <th className="px-1.5 py-2 font-semibold">QA</th>
                <th className="px-1.5 py-2 font-semibold min-w-[10rem]">Description</th>
                <th className="px-1.5 py-2 font-semibold">WM</th>
                <th className="px-1.5 py-2 font-semibold">RJOB</th>
                <th className="px-1.5 py-2 font-semibold">QR</th>
                <th className="px-1.5 py-2 font-semibold">Resp</th>
                <th className="px-1.5 py-2 text-right font-semibold">Labor</th>
                <th className="px-1.5 py-2 text-right font-semibold">Material</th>
                <th className="px-1.5 py-2 text-right font-semibold">Amount</th>
                <th className="px-1.5 py-2 text-right font-semibold">Est amount</th>
                <th className="px-1.5 py-2 text-right font-semibold">Inv amount</th>
              </tr>
            </thead>
            <tbody>
              {visibleLines.map((m, i) => {
                const src = m.invoice ?? m.estimate;
                const hard =
                  m.kind === "NOT_ON_APPROVED_ESTIMATE" ||
                  (m.kind === "ADDED" && hardRejectCount > 0);
                const amber =
                  m.kind === "ADDED" || m.kind === "QTY_PRICE_CHANGED";
                const removed = m.kind === "REMOVED";
                const reason =
                  m.exceptionReason ||
                  (m.kind === "ADDED"
                    ? "Added on invoice — not on the approved estimate"
                    : m.kind === "REMOVED"
                      ? "Removed vs the approved estimate"
                      : m.kind === "QTY_PRICE_CHANGED"
                        ? "Quantity or price changed vs the approved estimate"
                        : null);
                const lineKey = m.lineNo ?? i;
                const open = expandedLine === lineKey;
                return (
                  <Fragment key={`${i}-${m.lineNo}-${m.kind}`}>
                    <tr
                      title={reason ?? undefined}
                      className={cn(
                        "border-t border-slate-200 cursor-default",
                        amber && "bg-amber-50",
                        hard && "bg-red-50",
                        removed && "bg-slate-100 line-through text-slate-600",
                      )}
                      onClick={() =>
                        setExpandedLine(open ? null : (lineKey as number))
                      }
                    >
                      <td className="px-1.5 py-1 text-center">
                        {amber && (
                          <AlertTriangle
                            className="inline h-3.5 w-3.5 text-amber-700"
                            aria-label="Exception"
                          />
                        )}
                        {hard && (
                          <Ban
                            className="inline h-3.5 w-3.5 text-red-700"
                            aria-label="Hard issue"
                          />
                        )}
                      </td>
                      <td className="px-1.5 py-1 tabular-nums">
                        {dash(src?.lineNo ?? m.lineNo)}
                      </td>
                      <td className="px-1.5 py-1">
                        <CodeHover kind="location" code={src?.location}>
                          {dash(src?.location)}
                        </CodeHover>
                      </td>
                      <td className="px-1.5 py-1 tabular-nums">
                        {dash(src?.qty)}
                      </td>
                      <td className="px-1.5 py-1">
                        <CodeHover kind="condition" code={src?.conditionCode}>
                          {dash(src?.conditionCode)}
                        </CodeHover>
                      </td>
                      <td className="px-1.5 py-1 font-mono">
                        <CodeHover
                          kind="job"
                          code={src?.jobCode || m.jobCode}
                          qualifier={src?.qualifier}
                        >
                          {dash(src?.jobCode || m.jobCode)}
                        </CodeHover>
                      </td>
                      <td className="px-1.5 py-1">
                        <CodeHover
                          kind="qualifier"
                          code={src?.jobCode || m.jobCode}
                          qualifier={src?.qualifier ?? ""}
                        >
                          {dash(src?.qualifier)}
                        </CodeHover>
                      </td>
                      <td
                        className="px-1.5 py-1 max-w-[18rem] whitespace-normal break-words uppercase"
                        title={src?.description || undefined}
                      >
                        {dash(src?.description)}
                      </td>
                      <td className="px-1.5 py-1">
                        <CodeHover kind="why_made" code={src?.whyMade}>
                          {dash(src?.whyMade)}
                        </CodeHover>
                      </td>
                      <td className="px-1.5 py-1 font-mono">
                        <CodeHover kind="job" code={src?.removedJobCode}>
                          {dash(src?.removedJobCode)}
                        </CodeHover>
                      </td>
                      <td className="px-1.5 py-1">
                        <CodeHover
                          kind="removed_qualifier"
                          code={src?.removedJobCode}
                          qualifier={src?.removedQualifier ?? ""}
                        >
                          {dash(src?.removedQualifier)}
                        </CodeHover>
                      </td>
                      <td className="px-1.5 py-1 font-semibold">
                        <CodeHover kind="responsibility" code={src?.respCode}>
                          {dash(src?.respCode)}
                        </CodeHover>
                      </td>
                      <td className="px-1.5 py-1 text-right font-mono">
                        {moneyOrDash(src?.laborCents)}
                      </td>
                      <td className="px-1.5 py-1 text-right font-mono">
                        {moneyOrDash(src?.materialCents)}
                      </td>
                      <td className="px-1.5 py-1 text-right font-mono font-semibold">
                        {moneyOrDash(src?.totalCents)}
                      </td>
                      <td className="px-1.5 py-1 text-right font-mono">
                        {m.estimate ? dollars(m.estimate.totalCents) : "—"}
                      </td>
                      <td className="px-1.5 py-1 text-right font-mono">
                        {m.invoice ? dollars(m.invoice.totalCents) : "—"}
                      </td>
                    </tr>
                    {(open || (m.clearedBadges && m.clearedBadges.length > 0)) && (
                      <tr className="border-t border-slate-100 bg-white">
                        <td colSpan={17} className="px-3 py-1.5 text-xs text-slate-800">
                          {reason && (
                            <span className="mr-3 font-medium">{reason}</span>
                          )}
                          {m.clearedBadges?.map((b, bi) => (
                            <span
                              key={bi}
                              className="mr-2 inline-flex items-center rounded border border-slate-400 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-800"
                            >
                              {b.label}
                              {b.by ? ` · ${b.by}` : ""}
                              {b.at ? ` · ${b.at}` : ""}
                            </span>
                          ))}
                          {m.invoice?.shortPayReason && (
                            <span className="mr-2 inline-flex items-center rounded border border-slate-400 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-800">
                              Override: {m.invoice.shortPayReason}
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {visibleLines.length === 0 && (
                <tr>
                  <td
                    colSpan={17}
                    className="px-3 py-6 text-center text-sm text-slate-700"
                  >
                    {exceptionsOnly
                      ? "No exceptions on this car."
                      : "No lines to show."}
                  </td>
                </tr>
              )}
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

        {(bundle.invoice.paymentStatus === "MONTH_CLOSED" ||
          bundle.invoice.paymentStatus === "PAYABLE" ||
          bundle.invoice.paymentStatus === "SENT_TO_AP" ||
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
