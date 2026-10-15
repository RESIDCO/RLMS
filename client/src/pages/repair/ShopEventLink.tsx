/**
 * §G r4 — Signed shop BO link: one reusable token until close.
 * Shows next action for confirm → on hand → estimate → POD/complete → invoice.
 */
import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { shopAa } from "./RepairNavChrome";

type Payload = {
  event: {
    id: string;
    car_mark: string;
    car_number: string;
    status_code: string;
    status_name: string;
    rule: string;
  };
  nextStep?: {
    code: string;
    title: string;
    instruction: string;
    actions: string[];
  };
  nextActions: string[];
  estimates: Array<{
    id: string;
    status_code: string;
    current_revision: number;
    locked?: boolean;
    completed_at?: string | null;
  }>;
  revisions: Array<{
    rev_no: number;
    action: string;
    action_at: string;
    actor_name: string;
    labor: string;
    material: string;
    total: string;
    new_status: string;
    old_status: string;
    comment: string | null;
  }>;
  pod?: { POD?: { date_value: string }; ERD?: { date_value: string } };
  invoices?: Array<{
    id: string;
    invoice_no: string;
    total: string;
    estimate_total: string;
    match_status: string;
    mismatch_flagged: boolean;
    workflow_status?: string;
  }>;
  dispo?: Array<{ direction: string; instructions: string; at: string; by_actor: string }>;
  otpRequired?: { invoice_submit?: boolean; completed_date?: boolean };
};

export default function ShopEventLink() {
  const [, params] = useRoute("/repair/e/:token");
  const token = params?.token ?? "";
  const [data, setData] = useState<Payload | null>(null);
  const [email, setEmail] = useState("shop.tech@example.invalid");
  const [comment, setComment] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [podDate, setPodDate] = useState("");
  const [erdDate, setErdDate] = useState("");
  const [arrivalDate, setArrivalDate] = useState(() =>
    new Date().toISOString().slice(0, 16),
  );
  const [yardNote, setYardNote] = useState("");
  const [completedAt, setCompletedAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [aarFile, setAarFile] = useState<File | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [dispoText, setDispoText] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [info, setInfo] = useState("");

  async function load() {
    setError("");
    const res = await fetch(`/api/repair/e/${token}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Link invalid");
      setData(null);
      return;
    }
    setData(json);
  }

  useEffect(() => {
    if (token) void load();
  }, [token]);

  async function post(
    path: string,
    body?: BodyInit | Record<string, unknown>,
    isForm = false,
  ) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await fetch(`/api/repair/e/${token}/${path}`, {
        method: "POST",
        headers: isForm ? undefined : { "Content-Type": "application/json" },
        body: isForm
          ? (body as BodyInit)
          : JSON.stringify(
              (body as Record<string, unknown>) ?? { email, comment },
            ),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Action failed");
        return json;
      }
      if (json.note) setInfo(json.note);
      if (json.matchStatus === "MISMATCH") {
        setInfo(
          "Invoice flagged for review — total does not match approved estimate.",
        );
      } else if (json.matchStatus === "MATCHED") {
        setInfo("Invoice total matches approved final estimate.");
      }
      if (json.workflowStatus) {
        setInfo((prev) =>
          prev
            ? `${prev} · Workflow: ${json.workflowStatus}`
            : `Workflow: ${json.workflowStatus}`,
        );
      }
      await load();
      return json;
    } finally {
      setBusy(false);
    }
  }

  async function uploadEstimate() {
    const fd = new FormData();
    fd.set("email", email);
    fd.set("actorName", email);
    if (comment) fd.set("comment", comment);
    if (file) fd.set("file", file);
    fd.set(
      "lines",
      JSON.stringify([
        {
          lineNo: 1,
          aarJobCode: "DUMMY",
          labor: 100,
          material: 50,
          total: 150,
          respCode: "1",
        },
      ]),
    );
    await post("estimates", fd, true);
  }

  async function uploadInvoice() {
    if (!invoiceFile) {
      setError("Invoice PDF required");
      return;
    }
    if (!aarFile) {
      setError("500-byte invoice file required");
      return;
    }
    if (!invoiceNo.trim()) {
      setError("Invoice number required");
      return;
    }
    const fd = new FormData();
    fd.set("email", email);
    fd.set("invoiceNo", invoiceNo);
    fd.set("total", invoiceTotal);
    if (otpCode) fd.set("otpCode", otpCode);
    fd.set("file", invoiceFile);
    fd.set("aarFile", aarFile);
    await post("invoice", fd, true);
  }

  async function uploadDoc() {
    if (!docFile) {
      setError("File required");
      return;
    }
    const fd = new FormData();
    fd.set("email", email);
    fd.set("kind", "photo");
    fd.set("file", docFile);
    await post("documents", fd, true);
  }

  if (error && !data) {
    return (
      <div className={cn(shopAa.page, "flex items-center justify-center p-6")}>
        <p className="text-sm text-red-900">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div
        className={cn(
          shopAa.page,
          "flex items-center justify-center p-6 text-sm text-slate-700",
        )}
      >
        Loading shop link…
      </div>
    );
  }

  const actions = new Set(data.nextActions);
  const locked = Boolean(data.estimates[0]?.locked);
  const step = data.nextStep;

  return (
    <div className={shopAa.page}>
      <div className="mx-auto max-w-xl space-y-6 px-4 py-6 sm:px-6">
        <header className="space-y-1 border-b border-slate-300 pb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
            RESIDCO · Shop signed link
          </p>
          <h1 className="font-serif text-2xl font-semibold text-slate-900">
            {data.event.car_mark} {data.event.car_number}
          </h1>
          <p className={shopAa.muted}>
            {data.event.status_name} · {data.event.rule}
            {locked ? " · Estimate locked (docs still OK)" : ""}
          </p>
        </header>

        {step && (
          <section
            className="rounded border border-slate-900 bg-white p-4"
            data-testid="shop-link-next-step"
          >
            <p className={shopAa.label}>Next action</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">
              {step.title}
            </h2>
            <p className="mt-1 text-sm text-slate-800">{step.instruction}</p>
          </section>
        )}

        <div className="grid gap-2">
          <Label htmlFor="email" className={shopAa.label}>
            Your email (audit)
          </Label>
          <Input
            id="email"
            className={shopAa.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Label htmlFor="comment" className={shopAa.label}>
            Comment
          </Label>
          <Textarea
            id="comment"
            className={shopAa.textarea}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        {(actions.has("accept") || actions.has("reject")) && (
          <div className="space-y-3 border-t border-slate-300 pt-4">
            <h2 className="font-semibold text-slate-900">
              Awaiting shop acceptance
            </h2>
            <div className="flex flex-wrap gap-2">
              {actions.has("accept") && (
                <Button disabled={busy} onClick={() => post("accept", { email })}>
                  Accept assignment
                </Button>
              )}
            </div>
            {actions.has("reject") && (
              <div className="space-y-2">
                <Label className={shopAa.label}>Decline reason (required)</Label>
                <Textarea
                  className={shopAa.textarea}
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Why this shop cannot take the work"
                />
                <Button
                  variant="outline"
                  disabled={busy || !declineReason.trim()}
                  onClick={() =>
                    post("decline", { email, reason: declineReason })
                  }
                >
                  Decline work
                </Button>
              </div>
            )}
          </div>
        )}

        {actions.has("on-hand") && (
          <div className="space-y-2 border-t border-slate-300 pt-4">
            <h2 className="font-semibold text-slate-900">Mark on hand</h2>
            <p className={shopAa.muted}>
              Arrival date/time required. Optional yard/track note. Starts
              JIC/POD clocks.
            </p>
            <Label className={shopAa.label}>Arrival date/time</Label>
            <Input
              type="datetime-local"
              className={shopAa.input}
              value={arrivalDate}
              onChange={(e) => setArrivalDate(e.target.value)}
            />
            <Label className={shopAa.label}>Yard / track note (optional)</Label>
            <Input
              className={shopAa.input}
              value={yardNote}
              onChange={(e) => setYardNote(e.target.value)}
              placeholder="Track 3 / west yard"
            />
            <Button
              disabled={busy || !arrivalDate}
              onClick={() =>
                post("on-hand", {
                  email,
                  arrivalDate: new Date(arrivalDate).toISOString(),
                  yardTrackNote: yardNote || undefined,
                })
              }
            >
              Mark on hand
            </Button>
          </div>
        )}

        {actions.has("pod") && (
          <div className="space-y-2 border-t border-slate-300 pt-4">
            <h2 className="font-semibold text-slate-900">POD / ERD</h2>
            <p className={shopAa.muted}>
              Current POD: {data.pod?.POD?.date_value ?? "—"} · ERD:{" "}
              {data.pod?.ERD?.date_value ?? "—"}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className={shopAa.label}>POD date</Label>
                <Input
                  type="date"
                  className={shopAa.input}
                  value={podDate}
                  onChange={(e) => setPodDate(e.target.value)}
                />
                <Button
                  className="mt-2"
                  disabled={busy || !podDate}
                  onClick={() =>
                    post("pod", {
                      email,
                      kind: "POD",
                      dateValue: podDate,
                      reason: comment,
                    })
                  }
                >
                  Save POD
                </Button>
              </div>
              <div>
                <Label className={shopAa.label}>ERD date</Label>
                <Input
                  type="date"
                  className={shopAa.input}
                  value={erdDate}
                  onChange={(e) => setErdDate(e.target.value)}
                />
                <Button
                  className="mt-2"
                  variant="outline"
                  disabled={busy || !erdDate}
                  onClick={() =>
                    post("pod", {
                      email,
                      kind: "ERD",
                      dateValue: erdDate,
                      reason: comment,
                    })
                  }
                >
                  Save ERD
                </Button>
              </div>
            </div>
          </div>
        )}

        {actions.has("complete") && (
          <div className="space-y-2 border-t border-slate-300 pt-4">
            <h2 className="font-semibold text-slate-900">Completed date</h2>
            <p className={shopAa.muted}>
              Locks the estimate. Photos and documents can still be added
              afterward.
            </p>
            <Input
              type="date"
              className={shopAa.input}
              value={completedAt}
              onChange={(e) => setCompletedAt(e.target.value)}
            />
            {data.otpRequired?.completed_date && (
              <div className="space-y-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => post("otp", { email, step: "completed_date" })}
                >
                  Email one-time code
                </Button>
                <Label className={shopAa.label}>One-time code</Label>
                <Input
                  className={shopAa.input}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                />
              </div>
            )}
            <Button
              disabled={busy}
              onClick={() =>
                post("complete", {
                  email,
                  completedAt: completedAt || new Date().toISOString(),
                  comment,
                  otpCode: otpCode || undefined,
                })
              }
            >
              Mark complete
            </Button>
          </div>
        )}

        {actions.has("invoice") && (
          <div className="space-y-2 border-t border-slate-300 pt-4">
            <h2 className="font-semibold text-slate-900">Shop invoice</h2>
            <p className={shopAa.muted}>
              Upload final invoice 500-byte + PDF. Invoice number required.
              Totals must match approved estimate (tolerance placeholder). Status:
              Invoice Submitted → Under Owner Review → Accepted / Rejected.
            </p>
            <Label className={shopAa.label}>Invoice #</Label>
            <Input
              className={shopAa.input}
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
            />
            <Label className={shopAa.label}>Total</Label>
            <Input
              type="number"
              step="0.01"
              className={shopAa.input}
              value={invoiceTotal}
              onChange={(e) => setInvoiceTotal(e.target.value)}
            />
            <Label className={shopAa.label}>Invoice PDF</Label>
            <Input
              type="file"
              accept="application/pdf,image/*"
              className={shopAa.input}
              onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
            />
            <Label className={shopAa.label}>500-byte invoice file</Label>
            <Input
              type="file"
              className={shopAa.input}
              onChange={(e) => setAarFile(e.target.files?.[0] ?? null)}
            />
            {data.otpRequired?.invoice_submit && (
              <div className="space-y-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => post("otp", { email, step: "invoice_submit" })}
                >
                  Email one-time code
                </Button>
                <Label className={shopAa.label}>One-time code</Label>
                <Input
                  className={shopAa.input}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                />
              </div>
            )}
            <Button disabled={busy} onClick={uploadInvoice}>
              Submit invoice
            </Button>
            {(data.invoices?.length ?? 0) > 0 && (
              <ul className="space-y-1 text-xs text-slate-800">
                {data.invoices!.map((inv) => (
                  <li key={inv.id}>
                    #{inv.invoice_no} · {inv.total} vs est {inv.estimate_total} ·{" "}
                    {inv.workflow_status || inv.match_status}
                    {inv.mismatch_flagged ? " (flagged)" : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {actions.has("dispo") && (
          <div className="space-y-2 border-t border-slate-300 pt-4">
            <h2 className="font-semibold text-slate-900">Dispo (info only)</h2>
            <Textarea
              className={shopAa.textarea}
              placeholder="Disposition instructions / request"
              value={dispoText}
              onChange={(e) => setDispoText(e.target.value)}
            />
            <Button
              disabled={busy || !dispoText.trim()}
              onClick={() =>
                post("dispo", {
                  email,
                  direction: "from_shop",
                  instructions: dispoText,
                })
              }
            >
              Relay dispo
            </Button>
          </div>
        )}

        {(actions.has("upload-document") || locked) && (
          <div className="space-y-2 border-t border-slate-300 pt-4">
            <h2 className="font-semibold text-slate-900">Photos / documents</h2>
            <Input
              type="file"
              className={shopAa.input}
              onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
            />
            <Button disabled={busy} onClick={uploadDoc}>
              Upload file
            </Button>
          </div>
        )}

        {(actions.has("upload-estimate") ||
          (!locked && actions.size === 0)) && (
          <div className="space-y-2 border-t border-slate-300 pt-4">
            <h2 className="font-semibold text-slate-900">Upload estimate</h2>
            <p className={shopAa.muted}>
              500-byte + photos/docs. Draft = loaded not submitted.
            </p>
            <Input
              type="file"
              className={shopAa.input}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button disabled={busy || locked} onClick={uploadEstimate}>
              Upload estimate
            </Button>
          </div>
        )}

        {error && <p className="text-sm font-medium text-red-900">{error}</p>}
        {info && <p className="text-sm text-slate-800">{info}</p>}

        <section className="space-y-2 border-t border-slate-300 pt-4">
          <h2 className="font-semibold text-slate-900">Revision history</h2>
          {data.revisions.length === 0 ? (
            <p className={shopAa.muted}>No revisions yet.</p>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-xs text-slate-900">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-1 pr-2">Rev</th>
                    <th className="py-1 pr-2">Action</th>
                    <th className="py-1 pr-2">Date</th>
                    <th className="py-1 pr-2">Name</th>
                    <th className="py-1 pr-2">Total</th>
                    <th className="py-1 pr-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.revisions.map((r) => (
                    <tr key={r.rev_no} className="border-b border-slate-200">
                      <td className="py-1 pr-2">{r.rev_no}</td>
                      <td className="py-1 pr-2">{r.action}</td>
                      <td className="py-1 pr-2">
                        {new Date(r.action_at).toLocaleString()}
                      </td>
                      <td className="py-1 pr-2">{r.actor_name}</td>
                      <td className="py-1 pr-2">{r.total}</td>
                      <td className="py-1 pr-2">
                        {r.old_status ?? "—"} → {r.new_status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
