/**
 * §G Shop BO detail — car, owner instructions, arrival, JIC clock (wrecks),
 * §E viewer shop mode (view+add, never void). Submit estimate: upload or hand entry.
 */
import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
};

type Finding = {
  code: string;
  message: string;
  severity: string;
  lineNo?: number;
  refLink?: string;
};

function shopMark(): string {
  return localStorage.getItem("repairShopMark") || "";
}

function headers(): HeadersInit {
  return {
    "x-repair-role": "shop",
    "x-repair-shop-mark": shopMark(),
    "x-repair-actor": "shop-portal",
  };
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
  }

  useEffect(() => {
    if (eventId) void load();
  }, [eventId]);

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
    return <div className="p-6 text-sm text-slate-600">Loading…</div>;
  }

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <Link href="/repair/shop" className="text-sm text-slate-500 hover:underline">
            ← Shop portal
          </Link>
          <h1 className="mt-1 font-serif text-3xl font-semibold">
            {data ? (
              <span className="font-mono">
                {data.event.carMark} {data.event.carNumber}
              </span>
            ) : (
              "Bad order"
            )}
          </h1>
          <p className="text-sm text-slate-600">
            RESIDCO shop view · lessee hidden · DV/settlement never shown
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-8">
        {error && (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}
        {info && (
          <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {info}
          </div>
        )}

        {data && (
          <>
            <section className="grid gap-4 sm:grid-cols-2">
              <div className="rounded border border-slate-200 bg-white p-4">
                <h2 className="font-semibold">Owner instructions</h2>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                  {data.badOrder?.ownerInstructions || "—"}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Arrival:{" "}
                  {data.event.yardArrivedAt ||
                    data.badOrder?.arrivalDate ||
                    "not set"}
                </p>
                <p className="text-xs text-slate-500">
                  Reason: {data.badOrder?.shoppingReason || "—"}
                </p>
              </div>
              {data.event.isWreck && (
                <div className="rounded border border-slate-200 bg-white p-4">
                  <h2 className="font-semibold">JIC clock</h2>
                  {data.jicClock ? (
                    <ul className="mt-2 space-y-1 text-sm">
                      <li>Prepared: {String(data.jicClock.preparedAt ?? "—")}</li>
                      <li>Sent to owner: {String(data.jicClock.sentToOwnerAt ?? "—")}</li>
                      <li>Forwarded to RR: {String(data.jicClock.forwardedToRrAt ?? "—")}</li>
                      <li>Endorsed: {String(data.jicClock.endorsedAt ?? "—")}</li>
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500">No wreck JIC yet.</p>
                  )}
                </div>
              )}
            </section>

            <section className="rounded border border-slate-200 bg-white p-4">
              <h2 className="font-semibold">Documents (§E shop mode)</h2>
              <p className="text-sm text-slate-600">
                {data.documents.count} file(s) · view + add
                {data.documents.permissions.canVoid
                  ? ""
                  : " · void disabled"}
              </p>
              <Link
                href={`/repair/events/${data.event.id}/documents`}
                className="mt-2 inline-block text-sm text-slate-800 underline"
              >
                Open File Attachments
              </Link>
            </section>

            <section className="rounded border border-slate-200 bg-white p-4 space-y-4">
              <h2 className="font-semibold">Submit estimate</h2>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={mode === "upload" ? "default" : "outline"}
                  onClick={() => setMode("upload")}
                >
                  Upload 500-byte
                </Button>
                <Button
                  size="sm"
                  variant={mode === "hand" ? "default" : "outline"}
                  onClick={() => setMode("hand")}
                >
                  Hand entry
                </Button>
              </div>
              {mode === "upload" ? (
                <div>
                  <Label htmlFor="file">500-byte file</Label>
                  <Input
                    id="file"
                    type="file"
                    accept=".txt,.dat,.500"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              ) : (
                <div>
                  <Label htmlFor="hand">Lines JSON (aarJobCode, laborCents, …)</Label>
                  <Textarea
                    id="hand"
                    rows={6}
                    className="font-mono text-xs"
                    value={handJson}
                    onChange={(e) => setHandJson(e.target.value)}
                    placeholder='[{"aarJobCode":"1001","laborCents":15000,"respCode":"1","aarComponentId":"CID123"}]'
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => void runValidate()}>
                  Parse / validate preview
                </Button>
                <Button disabled={busy} onClick={() => void submitEstimate()}>
                  Submit estimate
                </Button>
              </div>
              {preview?.validation && (
                <div className="space-y-2 text-sm">
                  <p className="font-medium">
                    Outcome: {preview.validation.outcome}
                    {preview.preview
                      ? ` · total $${(preview.preview.totalCents / 100).toFixed(2)}`
                      : ""}
                  </p>
                  <ul className="max-h-48 space-y-1 overflow-auto rounded border border-slate-100 bg-slate-50 p-2">
                    {(preview.validation.findings || []).map((f, i) => (
                      <li
                        key={`${f.code}-${i}`}
                        className={
                          f.severity === "HARD_REJECT" ? "text-red-700" : "text-amber-800"
                        }
                      >
                        [{f.severity}] {f.code}: {f.message}
                        {f.lineNo != null ? ` (line ${f.lineNo})` : ""}
                      </li>
                    ))}
                    {(preview.validation.findings || []).length === 0 && (
                      <li className="text-slate-500">No findings</li>
                    )}
                  </ul>
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-2 font-semibold">Estimates on this BO</h2>
              <ul className="divide-y rounded border bg-white">
                {data.estimates.map((e) => (
                  <li key={e.id} className="flex justify-between px-3 py-2 text-sm">
                    <span>
                      {e.statusLabel} · rev {e.revision}
                    </span>
                    <Link href={`/repair/shop/estimates/${e.id}`} className="underline">
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
