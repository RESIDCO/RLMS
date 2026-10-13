import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Payload = {
  event: {
    id: string;
    car_mark: string;
    car_number: string;
    status_code: string;
    status_name: string;
    rule: string;
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
  }>;
  dispo?: Array<{ direction: string; instructions: string; at: string; by_actor: string }>;
  otpRequired?: { invoice_submit?: boolean };
};

export default function ShopEventLink() {
  const [, params] = useRoute("/repair/e/:token");
  const token = params?.token ?? "";
  const [data, setData] = useState<Payload | null>(null);
  const [email, setEmail] = useState("shop.tech@example.invalid");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [podDate, setPodDate] = useState("");
  const [erdDate, setErdDate] = useState("");
  const [completedAt, setCompletedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
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

  async function post(path: string, body?: BodyInit | Record<string, unknown>, isForm = false) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await fetch(`/api/repair/e/${token}/${path}`, {
        method: "POST",
        headers: isForm ? undefined : { "Content-Type": "application/json" },
        body: isForm
          ? (body as BodyInit)
          : JSON.stringify((body as Record<string, unknown>) ?? { email, comment }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Action failed");
        return json;
      }
      if (json.note) setInfo(json.note);
      if (json.matchStatus === "MISMATCH") {
        setInfo("Invoice flagged for review — total does not match approved estimate.");
      } else if (json.matchStatus === "MATCHED") {
        setInfo("Invoice total matches approved final estimate.");
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
      setError("Invoice file required");
      return;
    }
    const fd = new FormData();
    fd.set("email", email);
    fd.set("invoiceNo", invoiceNo);
    fd.set("total", invoiceTotal);
    if (otpCode) fd.set("otpCode", otpCode);
    fd.set("file", invoiceFile);
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
      <div className="min-h-screen flex items-center justify-center p-6">
        <p className="text-destructive text-sm">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-sm text-muted-foreground">
        Loading event link…
      </div>
    );
  }

  const actions = new Set(data.nextActions);
  const locked = Boolean(data.estimates[0]?.locked);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Shop event link</p>
          <h1 className="text-2xl font-semibold">
            {data.event.car_mark} {data.event.car_number}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.event.status_name} · {data.event.rule}
            {locked ? " · Estimate locked (docs still OK)" : ""}
          </p>
        </header>

        <div className="grid gap-2">
          <Label htmlFor="email">Your email (audit)</Label>
          <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Label htmlFor="comment">Comment</Label>
          <Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>

        <div className="flex flex-wrap gap-2">
          {actions.has("accept") && (
            <Button disabled={busy} onClick={() => post("accept", { email })}>
              Accept
            </Button>
          )}
          {actions.has("reject") && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => post("reject", { email, comment })}
            >
              Reject
            </Button>
          )}
          {actions.has("on-hand") && (
            <Button disabled={busy} onClick={() => post("on-hand", { email })}>
              On hand
            </Button>
          )}
        </div>

        {actions.has("pod") && (
          <div className="space-y-2 border-t pt-4">
            <h2 className="font-medium">POD / ERD</h2>
            <p className="text-xs text-muted-foreground">
              Current POD: {data.pod?.POD?.date_value ?? "—"} · ERD:{" "}
              {data.pod?.ERD?.date_value ?? "—"}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>POD date</Label>
                <Input type="date" value={podDate} onChange={(e) => setPodDate(e.target.value)} />
                <Button
                  className="mt-2"
                  disabled={busy || !podDate}
                  onClick={() =>
                    post("pod", { email, kind: "POD", dateValue: podDate, reason: comment })
                  }
                >
                  Save POD
                </Button>
              </div>
              <div>
                <Label>ERD date</Label>
                <Input type="date" value={erdDate} onChange={(e) => setErdDate(e.target.value)} />
                <Button
                  className="mt-2"
                  variant="outline"
                  disabled={busy || !erdDate}
                  onClick={() =>
                    post("pod", { email, kind: "ERD", dateValue: erdDate, reason: comment })
                  }
                >
                  Save ERD
                </Button>
              </div>
            </div>
          </div>
        )}

        {actions.has("complete") && (
          <div className="space-y-2 border-t pt-4">
            <h2 className="font-medium">Completed date</h2>
            <p className="text-xs text-muted-foreground">
              Locks the estimate. Photos and documents can still be added afterward.
            </p>
            <Input
              type="date"
              value={completedAt}
              onChange={(e) => setCompletedAt(e.target.value)}
            />
            <Button
              disabled={busy}
              onClick={() =>
                post("complete", {
                  email,
                  completedAt: completedAt || new Date().toISOString(),
                  comment,
                })
              }
            >
              Mark complete
            </Button>
          </div>
        )}

        {actions.has("invoice") && (
          <div className="space-y-2 border-t pt-4">
            <h2 className="font-medium">Shop invoice</h2>
            <p className="text-xs text-muted-foreground">
              Invoice total must match the approved final estimate total. Mismatches are flagged for
              review.
            </p>
            <Label>Invoice #</Label>
            <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
            <Label>Total</Label>
            <Input
              type="number"
              step="0.01"
              value={invoiceTotal}
              onChange={(e) => setInvoiceTotal(e.target.value)}
            />
            <Input
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
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
                <Label>One-time code</Label>
                <Input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} />
              </div>
            )}
            <Button disabled={busy} onClick={uploadInvoice}>
              Submit invoice
            </Button>
            {(data.invoices?.length ?? 0) > 0 && (
              <ul className="text-xs space-y-1">
                {data.invoices!.map((inv) => (
                  <li key={inv.id}>
                    #{inv.invoice_no} · {inv.total} vs est {inv.estimate_total} ·{" "}
                    {inv.match_status}
                    {inv.mismatch_flagged ? " (flagged)" : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {actions.has("dispo") && (
          <div className="space-y-2 border-t pt-4">
            <h2 className="font-medium">Dispo (info only)</h2>
            <Textarea
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
            {(data.dispo?.length ?? 0) > 0 && (
              <ul className="text-xs space-y-1 text-muted-foreground">
                {data.dispo!.map((d, i) => (
                  <li key={i}>
                    {d.direction}: {d.instructions}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {(actions.has("upload-document") || locked) && (
          <div className="space-y-2 border-t pt-4">
            <h2 className="font-medium">Photos / documents</h2>
            <p className="text-xs text-muted-foreground">
              Allowed even after completed date locks the estimate.
            </p>
            <Input type="file" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
            <Button disabled={busy} onClick={uploadDoc}>
              Upload file
            </Button>
          </div>
        )}

        {(actions.has("upload-estimate") || (!locked && actions.size === 0)) && (
          <div className="space-y-2 border-t pt-4">
            <h2 className="font-medium">Upload estimate</h2>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button disabled={busy || locked} onClick={uploadEstimate}>
              Upload estimate
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {info && <p className="text-sm text-muted-foreground">{info}</p>}

        <section className="space-y-2 border-t pt-4">
          <h2 className="font-medium">Revision history</h2>
          {data.revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No revisions yet.</p>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b">
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
                    <tr key={r.rev_no} className="border-b border-border/50">
                      <td className="py-1 pr-2">{r.rev_no}</td>
                      <td className="py-1 pr-2">{r.action}</td>
                      <td className="py-1 pr-2">{new Date(r.action_at).toLocaleString()}</td>
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
