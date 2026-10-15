/**
 * §G Shop estimate detail — validation, withdraw, resubmit+diff,
 * BRC PDF + data file. §G r2: owner decision comments, breadcrumbs, AA.
 */
import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DevRoleSwitcher, { repairDevHeaders } from "./DevRoleSwitcher";
import {
  RepairBackLink,
  RepairBreadcrumbs,
  buildReturnToParam,
  shopAa,
} from "./RepairNavChrome";

type DecisionComment = {
  id: string;
  body: string;
  lineNo: number | null;
  jobCode: string | null;
  kind: string;
  resolvedAt?: string | null;
};

type Payload = {
  estimate: {
    id: string;
    statusCode: string;
    statusLabel: string;
    currentRevision: number;
    carMark: string;
    carNumber: string;
    eventId: string;
  };
  revisions: Array<{
    id: string;
    rev_no: number;
    action: string;
    new_status: string;
    old_status: string;
    comment?: string;
  }>;
  validationRuns: Array<{
    id: string;
    outcome: string;
    hard_reject_count: number;
    flag_count: number;
    findings?: Array<{
      code: string;
      severity: string;
      message: string;
      lineNo?: number;
    }>;
  }>;
  canWithdraw: boolean;
  showDecisionComments?: boolean;
  decisionComments?: {
    estimateLevel: DecisionComment[];
    lineLevel: DecisionComment[];
  };
};

function headers(): HeadersInit {
  return repairDevHeaders();
}

export default function ShopEstimateDetail() {
  const [, params] = useRoute("/repair/shop/estimates/:id");
  const id = params?.id ?? "";
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [diff, setDiff] = useState<unknown>(null);
  const [commentDiff, setCommentDiff] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch(`/api/repair/shop/estimates/${id}`, {
      headers: headers(),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || `HTTP ${res.status}`);
      return;
    }
    setData(json);
  }

  useEffect(() => {
    if (id) void load();
  }, [id]);

  async function withdraw() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/repair/shop/estimates/${id}/withdraw`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Shop withdrew before owner review" }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Withdraw failed");
        return;
      }
      setInfo("Withdrawn to Draft");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function resubmit() {
    if (!file) {
      setError("Choose a file to resubmit");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/repair/shop/estimates/${id}/resubmit`, {
        method: "POST",
        headers: headers(),
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Resubmit failed");
        return;
      }
      setDiff(json.diff);
      setCommentDiff(json.commentDiff);
      setInfo(`Resubmitted as rev ${json.newRevision || json.revisionId}`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function download(kind: "brc-pdf" | "data-file") {
    const res = await fetch(`/api/repair/shop/estimates/${id}/${kind}`, {
      headers: headers(),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error || `Download failed (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      kind === "brc-pdf"
        ? `BRC_shop_${id.slice(0, 8)}.pdf`
        : `data_${id.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!data && !error) {
    return <div className="p-6 text-sm text-slate-700">Loading…</div>;
  }

  const car = data
    ? `${data.estimate.carMark} ${data.estimate.carNumber}`
    : "Estimate";
  const boHref = data
    ? `/repair/shop/events/${data.estimate.eventId}`
    : "/repair/shop";
  const docsHref = data
    ? `/repair/estimates/${data.estimate.id}/documents?${buildReturnToParam(
        `/repair/shop/estimates/${id}`,
        `Estimate rev ${data.estimate.currentRevision}`,
      )}&role=shop`
    : "#";

  const dc = data?.decisionComments;
  const hasComments =
    (dc?.estimateLevel?.length ?? 0) > 0 || (dc?.lineLevel?.length ?? 0) > 0;

  return (
    <div className={shopAa.page}>
      <DevRoleSwitcher />
      <header className="border-b border-slate-300 bg-white px-4 py-4 sm:px-8">
        <div className="mx-auto max-w-5xl space-y-2">
          {data && (
            <RepairBreadcrumbs
              items={[
                { label: "Shop home", href: "/repair/shop" },
                {
                  label: `Bad Order ${car}`,
                  href: boHref,
                },
                { label: `Estimate rev ${data.estimate.currentRevision}` },
              ]}
            />
          )}
          <RepairBackLink
            fallbackHref={boHref}
            fallbackLabel={`Bad Order ${car}`}
          />
          <h1 className="font-serif text-3xl font-semibold text-slate-900">
            {data ? (
              <span className="font-mono">
                {data.estimate.carMark} {data.estimate.carNumber}
              </span>
            ) : (
              "Estimate"
            )}
          </h1>
          {data && (
            <p className={shopAa.muted}>
              {data.estimate.statusLabel} · revision {data.estimate.currentRevision}
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-8">
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
            {data.showDecisionComments && (
              <section className="space-y-3 rounded border border-amber-700 bg-amber-50 p-4">
                <h2 className="font-semibold text-slate-900">
                  Owner reject / adjustment comments
                </h2>
                {!hasComments ? (
                  <p className="text-sm text-slate-900">no change requested</p>
                ) : (
                  <>
                    {(dc?.estimateLevel || []).map((c) => (
                      <div
                        key={c.id}
                        className="rounded border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        <span className="font-semibold">Estimate:</span> {c.body}
                        {c.resolvedAt && (
                          <span className="ml-2 text-slate-700">(resolved)</span>
                        )}
                      </div>
                    ))}
                    {(dc?.lineLevel || []).map((c) => (
                      <div
                        key={c.id}
                        className="rounded border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900"
                        data-line-no={c.lineNo ?? undefined}
                      >
                        <span className="font-semibold">
                          Line {c.lineNo ?? "?"}
                          {c.jobCode ? ` · ${c.jobCode}` : ""}:
                        </span>{" "}
                        {c.body}
                        {c.resolvedAt && (
                          <span className="ml-2 text-slate-700">(resolved)</span>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </section>
            )}

            <section className="flex flex-wrap gap-2">
              {data.canWithdraw && (
                <Button variant="secondary" disabled={busy} onClick={() => void withdraw()}>
                  Withdraw (until review starts)
                </Button>
              )}
              <Button variant="outline" onClick={() => void download("brc-pdf")}>
                Download shop BRC PDF
              </Button>
              <Button variant="outline" onClick={() => void download("data-file")}>
                Download data file
              </Button>
              <Link href={docsHref}>
                <Button variant="outline">Documents</Button>
              </Link>
            </section>

            <section className="space-y-3 rounded border border-slate-300 bg-white p-4">
              <h2 className="font-semibold text-slate-900">Resubmit revision</h2>
              <Input
                type="file"
                accept=".txt,.dat,.500"
                className="border-slate-400"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button disabled={busy} onClick={() => void resubmit()}>
                Resubmit → new revision + diff
              </Button>
              {diff != null && (
                <pre className="max-h-48 overflow-auto rounded border border-slate-300 bg-slate-50 p-2 text-xs text-slate-900">
                  {JSON.stringify(diff, null, 2)}
                </pre>
              )}
              {commentDiff != null && (
                <div className="rounded border border-slate-300 bg-slate-50 p-2 text-sm text-slate-900">
                  <p className="font-semibold">Commented lines changed</p>
                  <pre className="mt-1 max-h-40 overflow-auto text-xs">
                    {JSON.stringify(commentDiff, null, 2)}
                  </pre>
                </div>
              )}
            </section>

            <section className="rounded border border-slate-300 bg-white p-4">
              <h2 className="font-semibold text-slate-900">Validation results</h2>
              {(data.validationRuns || []).length === 0 ? (
                <p className={shopAa.muted}>No validation runs yet.</p>
              ) : (
                data.validationRuns.map((run) => (
                  <div key={run.id} className="mt-3 border-t border-slate-300 pt-3 text-sm">
                    <p className="font-medium text-slate-900">
                      {run.outcome} · hard {run.hard_reject_count} · flags{" "}
                      {run.flag_count}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {(run.findings || []).map((f, i) => (
                        <li
                          key={i}
                          className={
                            f.severity === "HARD_REJECT"
                              ? "text-red-900"
                              : "text-amber-950"
                          }
                        >
                          [{f.severity}] {f.code}: {f.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </section>

            <section className="rounded border border-slate-300 bg-white p-4">
              <h2 className="font-semibold text-slate-900">Revision history</h2>
              <ul className="mt-2 space-y-1 text-sm text-slate-900">
                {data.revisions.map((r) => (
                  <li key={r.id}>
                    Rev {r.rev_no}: {r.action} ({r.old_status} → {r.new_status})
                    {r.comment ? ` — ${r.comment}` : ""}
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
