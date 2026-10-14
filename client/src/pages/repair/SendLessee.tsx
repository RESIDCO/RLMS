/**
 * Send Lessee Responsibility — full preview before send.
 * Local mode: outbox only — "Logged (not sent – local mode)".
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import RepairOwnerShell from "./RepairOwnerShell";
import { WorkspaceBanner } from "./WorkspaceTitle";

type GalleryDoc = {
  id: string;
  kind: string;
  filename: string;
  mime?: string | null;
  size: number;
  isPdf?: boolean;
  isDataFile?: boolean;
};

type Preview = {
  localMode: boolean;
  carLabel: string;
  shopDisplay: string;
  amountMoney: string;
  amountCents: number;
  recipients: string[];
  subject: string;
  body: string;
  lesseeLines: Array<{
    line_no: number;
    aar_job_code?: string | null;
    resp_code?: string | null;
    labor_money?: string;
    material_money?: string;
    amount_money?: string;
  }>;
  gallery: GalleryDoc[];
  history: Array<{
    id: string;
    recipients: unknown;
    subject: string;
    attachment_bytes: number;
    status: string;
    local_mode: boolean;
    created_at: string;
    created_by?: string;
  }>;
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default function SendLessee() {
  const [, params] = useRoute("/repair/estimates/:id/send-lessee");
  const estimateId = params?.id ?? "";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [recipientsText, setRecipientsText] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includePdf, setIncludePdf] = useState(true);
  const [includeData, setIncludeData] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewPane, setPreviewPane] = useState<{
    title: string;
    text?: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    try {
      const res = await apiRequest(
        "GET",
        `/api/repair/estimates/${estimateId}/send-lessee`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load preview");
      setPreview(data);
      setRecipientsText((data.recipients ?? []).join(", "));
      setSubject(data.subject ?? "");
      setBody(data.body ?? "");
      setSelected(new Set((data.gallery ?? []).map((g: GalleryDoc) => g.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    if (estimateId) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateId]);

  const totalSize = useMemo(() => {
    if (!preview) return 0;
    let n = 0;
    for (const g of preview.gallery) {
      if (selected.has(g.id)) n += g.size;
    }
    // Generated PDF / data file sizes unknown until build — show gallery sum + note
    return n;
  }, [preview, selected]);

  function toggleAll(on: boolean) {
    if (!preview) return;
    setSelected(on ? new Set(preview.gallery.map((g) => g.id)) : new Set());
  }

  async function openBuiltPreview(kind: "pdf" | "data") {
    setError("");
    try {
      const res = await apiRequest(
        "GET",
        `/api/repair/estimates/${estimateId}/send-lessee/attachment-preview?kind=${kind}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Preview failed");
      setPreviewPane({
        title: `${data.filename} (${formatBytes(data.size ?? 0)})`,
        text:
          data.textPreview ||
          (data.base64
            ? `[binary ${data.mime} — ${formatBytes(data.size ?? 0)}; base64 preview truncated]`
            : "(empty)"),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    }
  }

  async function doSend() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const recipients = recipientsText
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await apiRequest(
        "POST",
        `/api/repair/estimates/${estimateId}/send-lessee`,
        {
          recipients,
          subject,
          body,
          documentIds: [...selected],
          includePdf,
          includeDataFile: includeData,
          confirm: true,
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      setMsg(data.message || (data.localMode ? "Logged (not sent – local mode)" : "Sent"));
      setConfirmOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RepairOwnerShell>
      <div className="min-h-full">
        <WorkspaceBanner
          pageTitle={`Send Lessee · ${preview?.carLabel ?? estimateId.slice(0, 8)}`}
          right={
            <Link
              href={`/repair/estimates/${estimateId}`}
              className="underline text-white/90 hover:text-white text-xs inline-flex items-center gap-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Estimate Review
            </Link>
          }
        />

        <div className="px-4 py-4 max-w-[1100px] space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {msg && (
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              {msg}
            </p>
          )}
          {preview?.localMode && (
            <p className="text-xs rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              Local review mode — Send writes the outbox only. No real email is
              delivered.
            </p>
          )}

          {!preview && !error && (
            <p className="text-sm text-muted-foreground">Loading preview…</p>
          )}

          {preview && (
            <>
              <section className="border border-border rounded-md p-4 space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Recipients & message
                </h2>
                <p className="text-xs text-muted-foreground">
                  Shop is never copied. Amount presented:{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {preview.amountMoney}
                  </span>{" "}
                  ({preview.amountCents}¢)
                </p>
                <div>
                  <Label htmlFor="to">To (comma-separated)</Label>
                  <Input
                    id="to"
                    className="mt-1"
                    value={recipientsText}
                    onChange={(e) => setRecipientsText(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="subj">Subject</Label>
                  <Input
                    id="subj"
                    className="mt-1"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="body">Body</Label>
                  <Textarea
                    id="body"
                    className="mt-1 font-mono text-xs"
                    rows={8}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </div>
              </section>

              <section className="border border-border rounded-md p-4 space-y-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Lessee view (Resp 6 lines)
                </h2>
                <div className="overflow-auto border border-border rounded max-h-56">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="p-2">Line</th>
                        <th className="p-2">Job</th>
                        <th className="p-2">Resp</th>
                        <th className="p-2 text-right">Labor</th>
                        <th className="p-2 text-right">Mat</th>
                        <th className="p-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.lesseeLines.length === 0 && (
                        <tr>
                          <td colSpan={6} className="p-3 text-muted-foreground">
                            No Resp 6 lines on current revision.
                          </td>
                        </tr>
                      )}
                      {preview.lesseeLines.map((l) => (
                        <tr key={l.line_no} className="border-t border-border">
                          <td className="p-2">{l.line_no}</td>
                          <td className="p-2 font-mono">{l.aar_job_code}</td>
                          <td className="p-2">{l.resp_code}</td>
                          <td className="p-2 text-right tabular-nums">
                            {l.labor_money}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {l.material_money}
                          </td>
                          <td className="p-2 text-right tabular-nums font-medium">
                            {l.amount_money}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="border border-border rounded-md p-4 space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Attachments
                </h2>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={includePdf}
                      onChange={(e) => setIncludePdf(e.target.checked)}
                    />
                    Estimate PDF (generated if shop sent none)
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => void openBuiltPreview("pdf")}
                    >
                      Preview
                    </Button>
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={includeData}
                      onChange={(e) => setIncludeData(e.target.checked)}
                    />
                    Data file (500-byte / CRB)
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => void openBuiltPreview("data")}
                    >
                      Preview
                    </Button>
                  </label>
                </div>

                <div className="flex gap-2 items-center text-xs">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7"
                    onClick={() => toggleAll(true)}
                  >
                    <CheckSquare className="h-3.5 w-3.5 mr-1" />
                    Select all
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7"
                    onClick={() => toggleAll(false)}
                  >
                    <Square className="h-3.5 w-3.5 mr-1" />
                    Select none
                  </Button>
                  <span className="text-muted-foreground ml-auto tabular-nums">
                    Gallery selected size: {formatBytes(totalSize)}
                    {includePdf || includeData
                      ? " (+ PDF/data built on send)"
                      : ""}
                  </span>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {preview.gallery.map((g) => {
                    const on = selected.has(g.id);
                    return (
                      <label
                        key={g.id}
                        className="flex gap-2 items-start border border-border rounded p-2 text-xs cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={on}
                          onChange={() => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(g.id)) next.delete(g.id);
                              else next.add(g.id);
                              return next;
                            });
                          }}
                        />
                        <span className="min-w-0">
                          <span className="block font-medium truncate">
                            {g.filename}
                          </span>
                          <span className="text-muted-foreground">
                            {g.kind} · {formatBytes(g.size)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  {preview.gallery.length === 0 && (
                    <p className="text-xs text-muted-foreground col-span-full">
                      No gallery photos/docs yet — PDF + 500-byte will still be
                      built on send.
                    </p>
                  )}
                </div>
              </section>

              {preview.history.length > 0 && (
                <section className="border border-border rounded-md p-4 space-y-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Send history
                  </h2>
                  <div className="overflow-auto max-h-40 border border-border rounded">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="p-2">When</th>
                          <th className="p-2">To</th>
                          <th className="p-2">Subject</th>
                          <th className="p-2">Status</th>
                          <th className="p-2">Size</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.history.map((h) => (
                          <tr key={h.id} className="border-t border-border">
                            <td className="p-2 whitespace-nowrap">
                              {new Date(h.created_at).toLocaleString()}
                            </td>
                            <td className="p-2">
                              {Array.isArray(h.recipients)
                                ? h.recipients.join(", ")
                                : String(h.recipients ?? "")}
                            </td>
                            <td className="p-2 truncate max-w-[12rem]">
                              {h.subject}
                            </td>
                            <td className="p-2">
                              {h.local_mode
                                ? "Logged (not sent – local mode)"
                                : h.status}
                            </td>
                            <td className="p-2 tabular-nums">
                              {formatBytes(Number(h.attachment_bytes ?? 0))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <div className="flex flex-wrap gap-2 justify-end border-t border-border pt-3">
                <Button variant="ghost" asChild>
                  <Link href={`/repair/estimates/${estimateId}`}>Back</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/repair/estimates/${estimateId}`}>Cancel</Link>
                </Button>
                <Button
                  onClick={() => setConfirmOpen(true)}
                  disabled={!recipientsText.trim() || !subject.trim() || !body.trim()}
                >
                  Send…
                </Button>
              </div>
            </>
          )}
        </div>

        {confirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-background border border-border rounded-md shadow-lg max-w-md w-full p-4 space-y-3">
              <h3 className="font-semibold">Confirm send to lessee</h3>
              <p className="text-sm text-muted-foreground">
                {preview?.localMode
                  ? "Local mode: this will log to the outbox only — no real email."
                  : "This will email the lessee with the selected attachments. Shop is never copied."}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => void doSend()} disabled={busy}>
                  {busy ? "Sending…" : preview?.localMode ? "Log to outbox" : "Send"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {previewPane && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-background border border-border rounded-md shadow-lg max-w-2xl w-full p-4 space-y-3 max-h-[80vh] flex flex-col">
              <h3 className="font-semibold shrink-0">{previewPane.title}</h3>
              <pre className="text-[11px] overflow-auto flex-1 border border-border rounded p-2 whitespace-pre-wrap">
                {previewPane.text}
              </pre>
              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => setPreviewPane(null)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </RepairOwnerShell>
  );
}
