/**
 * §G Shop estimate detail — validation results, withdraw, resubmit+diff,
 * BRC PDF + data file downloads (own data only).
 */
import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
};

function headers(): HeadersInit {
  return {
    "x-repair-role": "shop",
    "x-repair-shop-mark": localStorage.getItem("repairShopMark") || "",
    "x-repair-actor": "shop-portal",
  };
}

export default function ShopEstimateDetail() {
  const [, params] = useRoute("/repair/shop/estimates/:id");
  const id = params?.id ?? "";
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [diff, setDiff] = useState<unknown>(null);
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
    return <div className="p-6 text-sm">Loading…</div>;
  }

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <header className="border-b bg-white px-4 py-4 sm:px-8">
        <div className="mx-auto max-w-5xl">
          {data && (
            <Link
              href={`/repair/shop/events/${data.estimate.eventId}`}
              className="text-sm text-slate-500 hover:underline"
            >
              ← Back to BO
            </Link>
          )}
          <h1 className="mt-1 font-serif text-3xl font-semibold">
            {data ? (
              <span className="font-mono">
                {data.estimate.carMark} {data.estimate.carNumber}
              </span>
            ) : (
              "Estimate"
            )}
          </h1>
          {data && (
            <p className="text-sm text-slate-600">
              {data.estimate.statusLabel} · revision {data.estimate.currentRevision}
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-8">
        {error && (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}
        {info && (
          <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm">
            {info}
          </div>
        )}

        {data && (
          <>
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
            </section>

            <section className="rounded border bg-white p-4 space-y-3">
              <h2 className="font-semibold">Resubmit revision</h2>
              <Input
                type="file"
                accept=".txt,.dat,.500"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button disabled={busy} onClick={() => void resubmit()}>
                Resubmit → new revision + diff
              </Button>
              {diff != null && (
                <pre className="max-h-48 overflow-auto rounded bg-slate-50 p-2 text-xs">
                  {JSON.stringify(diff, null, 2)}
                </pre>
              )}
            </section>

            <section className="rounded border bg-white p-4">
              <h2 className="font-semibold">Validation results</h2>
              {(data.validationRuns || []).length === 0 ? (
                <p className="text-sm text-slate-500">No validation runs yet.</p>
              ) : (
                data.validationRuns.map((run) => (
                  <div key={run.id} className="mt-3 border-t pt-3 text-sm">
                    <p className="font-medium">
                      {run.outcome} · hard {run.hard_reject_count} · flags{" "}
                      {run.flag_count}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {(run.findings || []).map((f, i) => (
                        <li
                          key={i}
                          className={
                            f.severity === "HARD_REJECT"
                              ? "text-red-700"
                              : "text-amber-800"
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

            <section className="rounded border bg-white p-4">
              <h2 className="font-semibold">Revision history</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {data.revisions.map((r) => (
                  <li key={r.id}>
                    rev {r.rev_no}: {r.action} ({r.old_status} → {r.new_status})
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
