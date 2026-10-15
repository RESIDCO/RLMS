/**
 * §G Shop BO detail — car, owner instructions, arrival, JIC clock (wrecks),
 * §E viewer shop mode (view+add, never void).
 * §G r2: lifecycle dates, POD history, timeline, flags, breadcrumbs, AA.
 * §G r3: white inputs, closed reason + inconsistent block, owner/MP read-only.
 */
import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import DevRoleSwitcher, { repairDevHeaders } from "./DevRoleSwitcher";
import {
  RepairBackLink,
  RepairBreadcrumbs,
  buildReturnToParam,
  shopAa,
} from "./RepairNavChrome";

type Lifecycle = {
  dates: {
    arrival: string | null;
    inspected: string | null;
    estimateSubmitted: string | null;
    ownerApproval: string | null;
    repairStart: string | null;
    pod: string | null;
    completed: string | null;
    released: string | null;
    missedPodReasonCode: string | null;
    missedPodReasonNote: string | null;
    missedPodRequired: boolean;
  };
  status?: string;
  statusLabel?: string;
  statusLine?: string;
  compactTimeline?: Array<{
    code: string;
    label: string;
    kind: "done" | "current" | "next";
    at: string | null;
    who: string | null;
    meaning: string;
  }>;
  timeline: Array<{
    code: string;
    label: string;
    active: boolean;
    current: boolean;
    meaning: string;
    whoActsNext: string;
  }>;
  flags: Array<{
    what: string;
    lineNo: number | null;
    blocksCompletion: boolean;
    whoClears: string;
    code: string;
  }>;
  showFlags?: boolean;
  flagSummaryLine?: string;
  flagSummary?: {
    total: number;
    byCode: Array<{ code: string; count: number; label: string }>;
  };
  approvedWithFlags: boolean;
  openFlagCount: number;
  podHistory: Array<{
    id: string;
    dateValue: string | null;
    priorDate: string | null;
    reasonCode: string | null;
    reasonNote: string | null;
    who: string;
    when: string | null;
  }>;
  missedPodReasons: Array<{ code: string; label: string }>;
  isClosed?: boolean;
  closedReasonLine?: string | null;
  inconsistentClosed?: boolean;
  inconsistentClosedReasons?: string[];
};

type Detail = {
  event: {
    id: string;
    carMark: string;
    carNumber: string;
    isWreck: boolean;
    yardArrivedAt?: string | null;
    statusCode: string;
  };
  badOrder: {
    ownerInstructions?: string | null;
    arrivalDate?: string | null;
    shoppingReason?: string | null;
    location?: string;
    lifecycleStatus?: string;
  } | null;
  jicClock: Record<string, unknown> | null;
  estimates: Array<{
    id: string;
    revision: number;
    statusCode: string;
    statusLabel: string;
  }>;
  documents: { permissions: { canAdd: boolean; canVoid: boolean }; count: number };
  lifecycle?: Lifecycle;
  readOnly?: boolean;
  viewingAsShopMark?: string;
};

type Finding = {
  code: string;
  message: string;
  severity: string;
  lineNo?: number;
  refLink?: string;
};

function headers(): HeadersInit {
  return repairDevHeaders();
}

export default function ShopBoDetail() {
  const [, params] = useRoute("/repair/shop/events/:eventId");
  const eventId = params?.eventId ?? "";
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [handJson, setHandJson] = useState("");
  const [mode, setMode] = useState<"upload" | "hand">("upload");
  const [preview, setPreview] = useState<{
    validation?: { findings: Finding[]; outcome: string; ok: boolean };
    preview?: { header: Record<string, unknown>; lines: unknown[]; totalCents: number };
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [arrival, setArrival] = useState("");
  const [pod, setPod] = useState("");
  const [podReason, setPodReason] = useState("");
  const [podNote, setPodNote] = useState("");
  const [missedCode, setMissedCode] = useState("");
  const [missedNote, setMissedNote] = useState("");
  const [completed, setCompleted] = useState("");
  const [released, setReleased] = useState("");

  async function load() {
    setError("");
    const res = await fetch(`/api/repair/shop/events/${eventId}`, {
      headers: headers(),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || `HTTP ${res.status}`);
      setData(null);
      return;
    }
    setData(json);
    const d = json.lifecycle?.dates;
    if (d) {
      setArrival(d.arrival || "");
      setPod(d.pod || "");
      setMissedCode(d.missedPodReasonCode || "");
      setMissedNote(d.missedPodReasonNote || "");
      setCompleted(d.completed || "");
      setReleased(d.released || "");
    }
  }

  useEffect(() => {
    if (eventId) void load();
  }, [eventId]);

  async function saveLifecycle(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/repair/shop/events/${eventId}/lifecycle`, {
        method: "PATCH",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Save failed");
        return;
      }
      setInfo("Lifecycle dates saved");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function runValidate() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const fd = new FormData();
      if (mode === "upload") {
        if (!file) {
          setError("Choose a 500-byte file");
          return;
        }
        fd.append("file", file);
      } else {
        fd.append("linesJson", handJson || "[]");
      }
      const res = await fetch("/api/repair/shop/validate", {
        method: "POST",
        headers: headers(),
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Validate failed");
        setPreview(json);
        return;
      }
      setPreview(json);
      setInfo(`Validation: ${json.validation?.outcome}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitEstimate() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const fd = new FormData();
      if (mode === "upload") {
        if (!file) {
          setError("Choose a 500-byte file");
          return;
        }
        fd.append("file", file);
      } else {
        fd.append("linesJson", handJson || "[]");
      }
      const res = await fetch(`/api/repair/shop/events/${eventId}/submit-estimate`, {
        method: "POST",
        headers: headers(),
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Submit failed");
        setPreview(json);
        return;
      }
      setInfo(
        `Submitted estimate ${json.estimateId} · ${json.validation?.outcome}` +
          (json.submitted ? " · Submitted for approval" : ` · ${json.submitError || ""}`),
      );
      setPreview(json);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) {
    return <div className="p-6 text-sm text-slate-700">Loading…</div>;
  }

  const car = data
    ? `${data.event.carMark} ${data.event.carNumber}`
    : "Bad Order";
  const life = data?.lifecycle;

  const docsHref = data
    ? `/repair/events/${data.event.id}/documents?${buildReturnToParam(
        `/repair/shop/events/${eventId}`,
        `Bad Order ${car}`,
      )}&role=shop`
    : "#";

  const readOnly = Boolean(data?.readOnly);

  return (
    <div className={shopAa.page}>
      <DevRoleSwitcher />
      {readOnly && (
        <div
          className="border-b border-slate-400 bg-slate-100 px-4 py-2 text-sm text-slate-900"
          data-testid="shop-readonly-banner"
        >
          Viewing as shop {data?.viewingAsShopMark || "????"} · read-only
          (owner / managing partner)
        </div>
      )}
      <header className="border-b border-slate-300 bg-white px-4 py-4 sm:px-8">
        <div className="mx-auto max-w-5xl space-y-2">
          <RepairBreadcrumbs
            items={[
              { label: "Shop home", href: "/repair/shop" },
              { label: `Bad Order ${car}` },
            ]}
          />
          <RepairBackLink fallbackHref="/repair/shop" fallbackLabel="Shop home" />
          <h1 className="font-serif text-3xl font-semibold text-slate-900">
            {data ? (
              <span className="font-mono">
                {data.event.carMark} {data.event.carNumber}
              </span>
            ) : (
              "Bad order"
            )}
          </h1>
          <p className={shopAa.muted}>
            RESIDCO shop view · lessee hidden · DV/settlement never shown
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-8">
        {error && (
          <div className="rounded border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-900">
            {error}
          </div>
        )}
        {info && (
          <div className="rounded border border-emerald-700 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            {info}
          </div>
        )}

        {data && (
          <>
            {life && (
              <>
                <section className="rounded border border-slate-300 bg-white p-4">
                  <h2 className="font-semibold text-slate-900">Status</h2>
                  <p className="mt-2 text-base font-semibold text-slate-900">
                    {life.statusLine ||
                      life.statusLabel ||
                      life.status ||
                      "—"}
                  </p>
                  {life.closedReasonLine && (
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {life.closedReasonLine}
                    </p>
                  )}
                  {/* Inconsistent state is owner-only; never show to shops */}
                  {life.approvedWithFlags && life.showFlags && (
                    <p className="mt-2 rounded border border-amber-700 bg-amber-50 px-2 py-1 text-sm text-slate-900">
                      Approved – {life.flagSummaryLine ||
                        `${life.openFlagCount} flags block completion/invoicing`}
                    </p>
                  )}
                  <ol className="mt-3 space-y-2" data-testid="bo-compact-timeline">
                    {(life.compactTimeline?.length
                      ? life.compactTimeline
                      : life.timeline
                          .filter((s) => s.active || s.current)
                          .map((s) => ({
                            code: s.code,
                            label: s.label,
                            kind: s.current
                              ? ("current" as const)
                              : ("done" as const),
                            at: null as string | null,
                            who: null as string | null,
                            meaning: s.meaning,
                          }))
                    ).map((s) => (
                      <li
                        key={`${s.code}-${s.kind}`}
                        className={
                          s.kind === "current"
                            ? "rounded border border-slate-900 bg-slate-100 px-3 py-2"
                            : s.kind === "next"
                              ? "rounded border border-dashed border-slate-400 px-3 py-2"
                              : "rounded border border-slate-300 px-3 py-2"
                        }
                      >
                        <p className="font-semibold text-slate-900">
                          {s.label}
                          {s.kind === "current"
                            ? " · current"
                            : s.kind === "next"
                              ? " · next"
                              : ""}
                        </p>
                        <p className={shopAa.muted}>{s.meaning}</p>
                        {(s.at || s.who) && (
                          <p className="text-sm text-slate-700">
                            {s.at ? String(s.at).slice(0, 10) : ""}
                            {s.who ? ` · ${s.who}` : ""}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                </section>

                <section className="rounded border border-slate-300 bg-white p-4 space-y-3">
                  <h2 className="font-semibold text-slate-900">Lifecycle dates</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(
                      [
                        ["Arrival", life.dates.arrival],
                        ["Inspected", life.dates.inspected],
                        ["Estimate submitted", life.dates.estimateSubmitted],
                        ["Owner approval", life.dates.ownerApproval],
                        ["Repair start", life.dates.repairStart],
                        ["POD", life.dates.pod],
                        ["Completed", life.dates.completed],
                        ["Released / Outbound", life.dates.released],
                      ] as const
                    ).map(([label, val]) => (
                      <div key={label}>
                        <p className={shopAa.label}>{label}</p>
                        <p className={shopAa.value}>{val || "—"}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-3 border-t border-slate-300 pt-3 sm:grid-cols-2">
                    <div>
                      <Label className={shopAa.label}>Arrival (shop edit)</Label>
                      <Input
                        type="date"
                        className={shopAa.input}
                        value={arrival}
                        onChange={(e) => setArrival(e.target.value)}
                        disabled={readOnly}
                        placeholder="mm/dd/yyyy"
                      />
                    </div>
                    <div>
                      <Label className={shopAa.label}>POD</Label>
                      <Input
                        type="date"
                        className={shopAa.input}
                        value={pod}
                        onChange={(e) => setPod(e.target.value)}
                        disabled={readOnly}
                        placeholder="mm/dd/yyyy"
                      />
                    </div>
                    <div>
                      <Label className={shopAa.label}>POD change reason</Label>
                      <select
                        className={shopAa.select}
                        value={podReason}
                        onChange={(e) => setPodReason(e.target.value)}
                        disabled={readOnly}
                      >
                        <option value="">—</option>
                        {(life.missedPodReasons || []).map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <Input
                        className={cn("mt-1", shopAa.input)}
                        placeholder="POD reason note"
                        value={podNote}
                        onChange={(e) => setPodNote(e.target.value)}
                        disabled={readOnly}
                      />
                    </div>
                    <div>
                      <Label className={shopAa.label}>
                        Missed POD reason
                        {life.dates.missedPodRequired ? " (required)" : ""}
                      </Label>
                      <select
                        className={shopAa.select}
                        value={missedCode}
                        onChange={(e) => setMissedCode(e.target.value)}
                        disabled={readOnly}
                      >
                        <option value="">—</option>
                        {(life.missedPodReasons || []).map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <Input
                        className={cn("mt-1", shopAa.input)}
                        placeholder="Missed POD note"
                        value={missedNote}
                        onChange={(e) => setMissedNote(e.target.value)}
                        disabled={readOnly}
                      />
                    </div>
                    <div>
                      <Label className={shopAa.label}>Completed</Label>
                      <Input
                        type="date"
                        className={shopAa.input}
                        value={completed}
                        onChange={(e) => setCompleted(e.target.value)}
                        disabled={readOnly}
                        placeholder="mm/dd/yyyy"
                      />
                    </div>
                    <div>
                      <Label className={shopAa.label}>Released / Outbound</Label>
                      <Input
                        type="date"
                        className={shopAa.input}
                        value={released}
                        onChange={(e) => setReleased(e.target.value)}
                        disabled={readOnly}
                        placeholder="mm/dd/yyyy"
                      />
                    </div>
                  </div>
                  {!readOnly && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void saveLifecycle({
                          arrival: arrival || null,
                          pod: pod || null,
                          podReasonCode: podReason || null,
                          podReasonNote: podNote || null,
                          missedPodReasonCode: missedCode || null,
                          missedPodReasonNote: missedNote || null,
                          completed: completed || null,
                          released: released || null,
                        })
                      }
                    >
                      Save shop dates
                    </Button>
                  )}
                </section>

                <section className="rounded border border-slate-300 bg-white p-4">
                  <h2 className="font-semibold text-slate-900">POD history</h2>
                  {life.podHistory.length === 0 ? (
                    <p className={shopAa.muted}>No POD entries yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-2 text-sm">
                      {life.podHistory.map((h) => (
                        <li
                          key={h.id}
                          className="rounded border border-slate-300 px-2 py-1 text-slate-900"
                        >
                          <span className="font-semibold">
                            {h.priorDate ? `${h.priorDate} → ` : ""}
                            {h.dateValue}
                          </span>
                          {h.reasonCode && (
                            <span className="ml-2 text-slate-700">
                              {h.reasonCode}
                              {h.reasonNote ? ` — ${h.reasonNote}` : ""}
                            </span>
                          )}
                          <span className="ml-2 text-slate-700">
                            · {h.who} · {h.when?.slice(0, 19) || "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {life.showFlags && (
                  <section className="rounded border border-slate-300 bg-white p-4">
                    <h2 className="font-semibold text-slate-900">
                      Estimate flags
                    </h2>
                    {life.flags.length === 0 ? (
                      <p className={shopAa.muted}>No open flags.</p>
                    ) : (
                      <>
                        <p className="mt-2 text-sm font-semibold text-slate-900">
                          {life.flagSummaryLine ||
                            `${life.flags.length} flags`}
                        </p>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-sm text-slate-800">
                            Show flag list
                          </summary>
                          <ul className="mt-2 space-y-2 text-sm">
                            {life.flags.map((f, i) => (
                              <li
                                key={`${f.code}-${i}`}
                                className="rounded border border-amber-700 bg-amber-50 px-2 py-1 text-slate-900"
                              >
                                <span className="font-semibold">{f.code}</span>:{" "}
                                {f.what}
                                {f.lineNo != null ? ` · line ${f.lineNo}` : ""}
                                {f.blocksCompletion
                                  ? " · blocks completion/invoicing"
                                  : ""}
                                <span className="block text-slate-700">
                                  Cleared by: {f.whoClears}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </>
                    )}
                  </section>
                )}
              </>
            )}

            <section className="grid gap-4 sm:grid-cols-2">
              <div className="rounded border border-slate-300 bg-white p-4">
                <h2 className="font-semibold text-slate-900">Owner instructions</h2>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">
                  {data.badOrder?.ownerInstructions || "—"}
                </p>
                <p className={`mt-2 ${shopAa.muted}`}>
                  Reason: {data.badOrder?.shoppingReason || "—"}
                </p>
              </div>
              {data.event.isWreck && (
                <div className="rounded border border-slate-300 bg-white p-4">
                  <h2 className="font-semibold text-slate-900">JIC clock</h2>
                  {data.jicClock ? (
                    <ul className="mt-2 space-y-1 text-sm text-slate-900">
                      <li>Prepared: {String(data.jicClock.preparedAt ?? "—")}</li>
                      <li>Sent to owner: {String(data.jicClock.sentToOwnerAt ?? "—")}</li>
                      <li>Forwarded to RR: {String(data.jicClock.forwardedToRrAt ?? "—")}</li>
                      <li>Endorsed: {String(data.jicClock.endorsedAt ?? "—")}</li>
                    </ul>
                  ) : (
                    <p className={shopAa.muted}>No wreck JIC yet.</p>
                  )}
                </div>
              )}
            </section>

            <section className="rounded border border-slate-300 bg-white p-4">
              <h2 className="font-semibold text-slate-900">Documents (§E shop mode)</h2>
              <p className={shopAa.muted}>
                {data.documents.count} file(s) · view + add
                {data.documents.permissions.canVoid ? "" : " · void disabled"}
              </p>
              <Link
                href={docsHref}
                className="mt-2 inline-block text-sm font-medium text-slate-900 underline"
              >
                Open File Attachments
              </Link>
            </section>

            <section className="space-y-4 rounded border border-slate-300 bg-white p-4">
              <h2 className="font-semibold text-slate-900">Submit estimate</h2>
              {readOnly ? (
                <p className={shopAa.muted}>
                  Read-only — submit / validate disabled while viewing as shop.
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={mode === "upload" ? "default" : "outline"}
                  onClick={() => setMode("upload")}
                  disabled={readOnly}
                >
                  Upload 500-byte
                </Button>
                <Button
                  size="sm"
                  variant={mode === "hand" ? "default" : "outline"}
                  onClick={() => setMode("hand")}
                  disabled={readOnly}
                >
                  Hand entry
                </Button>
              </div>
              {mode === "upload" ? (
                <div>
                  <Label htmlFor="file" className={shopAa.label}>
                    500-byte file
                  </Label>
                  <Input
                    id="file"
                    type="file"
                    accept=".txt,.dat,.500"
                    className={shopAa.input}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    disabled={readOnly}
                  />
                </div>
              ) : (
                <div>
                  <Label htmlFor="hand" className={shopAa.label}>
                    Lines JSON (aarJobCode, laborCents, …)
                  </Label>
                  <Textarea
                    id="hand"
                    rows={6}
                    className={cn("font-mono text-xs", shopAa.textarea)}
                    value={handJson}
                    onChange={(e) => setHandJson(e.target.value)}
                    placeholder='[{"aarJobCode":"1001","laborCents":15000,"respCode":"1","aarComponentId":"CID123"}]'
                    disabled={readOnly}
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={busy || readOnly}
                  onClick={() => void runValidate()}
                >
                  Parse / validate preview
                </Button>
                <Button
                  disabled={busy || readOnly}
                  onClick={() => void submitEstimate()}
                >
                  Submit estimate
                </Button>
              </div>
              {preview?.validation && (
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-slate-900">
                    Outcome: {preview.validation.outcome}
                    {preview.preview
                      ? ` · total $${(preview.preview.totalCents / 100).toFixed(2)}`
                      : ""}
                  </p>
                  <ul className="max-h-48 space-y-1 overflow-auto rounded border border-slate-300 bg-slate-50 p-2">
                    {(preview.validation.findings || []).map((f, i) => (
                      <li
                        key={`${f.code}-${i}`}
                        className={
                          f.severity === "HARD_REJECT"
                            ? "text-red-900"
                            : "text-amber-950"
                        }
                      >
                        [{f.severity}] {f.code}: {f.message}
                        {f.lineNo != null ? ` (line ${f.lineNo})` : ""}
                      </li>
                    ))}
                    {(preview.validation.findings || []).length === 0 && (
                      <li className="text-slate-700">No findings</li>
                    )}
                  </ul>
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-2 font-semibold text-slate-900">Estimates on this BO</h2>
              <ul className="divide-y divide-slate-300 rounded border border-slate-300 bg-white">
                {data.estimates.map((e) => (
                  <li
                    key={e.id}
                    className="flex justify-between px-3 py-2 text-sm text-slate-900"
                  >
                    <span>
                      {e.statusLabel} · rev {e.revision}
                    </span>
                    <Link
                      href={`/repair/shop/estimates/${e.id}`}
                      className="font-medium underline"
                    >
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
