/**
 * Wreck event dual-track home — owner only.
 * JIC tracker, owner/Resp3 estimate slots, shared docs, owner-only DV/settlement.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import RepairOwnerShell from "./RepairOwnerShell";
import { WorkspaceTitle } from "./WorkspaceTitle";

type JicRow = {
  key: string;
  label: string;
  dueDate: string | null;
  state: string;
  daysAllowed: number | null;
  pctElapsed: number | null;
  note?: string;
};

type WreckPayload = {
  wreck: Record<string, unknown> & {
    id: string;
    car_mark: string;
    car_number: string;
    ddct_incident_id: string;
    shop_arrival_date?: string | null;
    jic_endorsed_at?: string | null;
    twoFilesRequiredCopy?: string;
    rebillNotes?: string;
    jic?: { ready: boolean; endorsed: boolean; estimateUploadAllowed: boolean; rows: JicRow[]; copy: string };
    tracks?: Array<Record<string, unknown>>;
    openFlags?: Array<Record<string, unknown>>;
    ownerDv?: Record<string, unknown>;
    documents?: Array<Record<string, unknown>>;
    aarLaborRate?: { quarter: string; laborRateCents: number } | null;
  };
  gauge?: {
    resp3TotalCents: number;
    depreciatedValueCents: number | null;
    overDv: boolean;
    message: string;
    require5399: boolean;
    note5399: string;
  } | null;
};

function money(cents: number | null | undefined) {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function stateColor(state: string) {
  if (state === "OVERDUE") return "text-red-700";
  if (state === "DUE_SOON") return "text-amber-700";
  if (state === "DONE" || state === "AUTO_ENDORSED") return "text-emerald-700";
  if (state === "HIDDEN") return "text-muted-foreground";
  return "text-foreground";
}

export default function WreckEvent() {
  const [, params] = useRoute("/repair/wreck/:eventId");
  const wreckId = params?.eventId ?? "";
  const [data, setData] = useState<WreckPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [arrival, setArrival] = useState("");
  const [endorse, setEndorse] = useState("");
  const [dvCents, setDvCents] = useState("");
  const [costCents, setCostCents] = useState("");
  const [clearReason, setClearReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!wreckId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/repair/wreck-events/${wreckId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const j = (await res.json()) as WreckPayload;
      setData(j);
      setArrival(String(j.wreck.shop_arrival_date ?? "").slice(0, 10));
      setEndorse(String(j.wreck.jic_endorsed_at ?? "").slice(0, 10));
      const odv = j.wreck.ownerDv as { originalCostCents?: number | null } | undefined;
      if (odv?.originalCostCents != null) setCostCents(String(odv.originalCostCents));
      if (j.gauge?.depreciatedValueCents != null) {
        setDvCents(String(j.gauge.depreciatedValueCents));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [wreckId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/repair/wreck-events/${wreckId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettlement() {
    setBusy(true);
    try {
      const res = await fetch(`/api/repair/wreck-events/${wreckId}/settlement`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalCostCents: costCents === "" ? null : Number(costCents),
          depreciatedValueCents: dvCents === "" ? null : Number(dvCents),
          settlementCapCents: dvCents === "" ? null : Number(dvCents),
          exhibitEdition: "OM-2026",
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clearFlags() {
    if (!clearReason.trim()) {
      setError("Clear reason required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/repair/wreck-events/${wreckId}/clear-flags`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: clearReason, actorRole: "owner" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setClearReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const w = data?.wreck;
  const jic = w?.jic;

  return (
    <RepairOwnerShell>
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
        <WorkspaceTitle
          title="Wreck event"
          subtitle={
            w
              ? `${w.car_mark} ${w.car_number} · DDCT ${w.ddct_incident_id}`
              : "Dual-track Rule 107 / Resp 3"
          }
        />

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && (
          <p className="text-sm text-red-700 border border-red-200 bg-red-50 px-3 py-2 rounded">
            {error}
          </p>
        )}

        {w && (
          <>
            <section className="space-y-2">
              <h2 className="text-base font-semibold">Tracks</h2>
              <p className="text-sm text-muted-foreground">{w.twoFilesRequiredCopy}</p>
              <div className="grid md:grid-cols-2 gap-4">
                {(w.tracks ?? []).map((t) => {
                  const estId = (t.est_id ?? t.estimate_id) as string | undefined;
                  return (
                    <div key={String(t.track_type)} className="border rounded p-3 space-y-1">
                      <div className="font-medium text-sm">
                        {t.track_type === "R107_RESP3" ? "Resp 3 (wreck)" : "Owner / contract"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Status: {String(t.estimate_status ?? "empty")}
                        {t.priced_quarter ? ` · priced ${String(t.priced_quarter)}` : ""}
                        {t.wreck_flags_block ? " · FLAGS BLOCK" : ""}
                      </div>
                      {estId ? (
                        <Link href={`/repair/estimates/${estId}`} className="text-sm underline">
                          Open estimate review
                        </Link>
                      ) : (
                        <span className="text-sm text-muted-foreground">No file loaded yet</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold">JIC deadline tracker</h2>
              <p className="text-sm text-muted-foreground">{jic?.copy}</p>
              <div className="flex flex-wrap gap-3 items-end">
                <label className="text-sm space-y-1">
                  <span className="block text-muted-foreground">Shop arrival (clock zero)</span>
                  <input
                    type="date"
                    className="border rounded px-2 py-1 text-sm"
                    value={arrival}
                    onChange={(e) => setArrival(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !arrival}
                  className="text-sm border rounded px-3 py-1"
                  onClick={() => void patch({ shop_arrival_date: arrival })}
                >
                  Set arrival
                </button>
                <label className="text-sm space-y-1">
                  <span className="block text-muted-foreground">JIC endorsed</span>
                  <input
                    type="date"
                    className="border rounded px-2 py-1 text-sm"
                    value={endorse}
                    onChange={(e) => setEndorse(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !endorse}
                  className="text-sm border rounded px-3 py-1"
                  onClick={() => void patch({ jic_endorsed_at: endorse })}
                >
                  Record endorsement
                </button>
              </div>
              <ul className="text-sm space-y-1">
                {(jic?.rows ?? []).map((r) => (
                  <li key={r.key} className={stateColor(r.state)}>
                    <span className="font-medium">{r.label}</span>
                    {r.dueDate ? ` · due ${r.dueDate}` : ""} · {r.state}
                    {r.pctElapsed != null ? ` (${r.pctElapsed}%)` : ""}
                    {r.note ? ` — ${r.note}` : ""}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Estimate upload allowed: {jic?.estimateUploadAllowed ? "yes" : "no (gated until endorsement)"}
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold">Open flags</h2>
              {(w.openFlags ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">None</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {(w.openFlags ?? []).map((f) => (
                    <li key={String(f.id)}>
                      [{String(f.code)}] {String(f.message)}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2 items-end flex-wrap">
                <input
                  className="border rounded px-2 py-1 text-sm min-w-[16rem]"
                  placeholder="Clear reason (owner / managing partner)"
                  value={clearReason}
                  onChange={(e) => setClearReason(e.target.value)}
                />
                <button
                  type="button"
                  disabled={busy}
                  className="text-sm border rounded px-3 py-1"
                  onClick={() => void clearFlags()}
                >
                  Clear flags
                </button>
              </div>
            </section>

            <section className="space-y-2 border-t pt-4">
              <h2 className="text-base font-semibold">Owner-only DV / settlement</h2>
              <p className="text-sm text-muted-foreground">
                Original cost &amp; A&amp;B are Umler fields — manual entry for now (inconsistent-tolerant).
                Shops and lessees never see these controls.
              </p>
              {w.aarLaborRate && (
                <p className="text-xs text-muted-foreground">
                  AAR quarterly labor rate ({w.aarLaborRate.quarter}):{" "}
                  {money(w.aarLaborRate.laborRateCents)}/hr
                </p>
              )}
              <div className="flex flex-wrap gap-3 items-end">
                <label className="text-sm space-y-1">
                  <span className="block text-muted-foreground">Original cost (cents, optional)</span>
                  <input
                    className="border rounded px-2 py-1 text-sm"
                    value={costCents}
                    onChange={(e) => setCostCents(e.target.value)}
                    inputMode="numeric"
                  />
                </label>
                <label className="text-sm space-y-1">
                  <span className="block text-muted-foreground">Depreciated value (cents)</span>
                  <input
                    className="border rounded px-2 py-1 text-sm"
                    value={dvCents}
                    onChange={(e) => setDvCents(e.target.value)}
                    inputMode="numeric"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  className="text-sm border rounded px-3 py-1"
                  onClick={() => void saveSettlement()}
                >
                  Save worksheet
                </button>
              </div>
              {data?.gauge && (
                <div
                  className={
                    data.gauge.overDv
                      ? "text-sm border border-amber-300 bg-amber-50 rounded p-3 space-y-1"
                      : "text-sm border rounded p-3 space-y-1"
                  }
                >
                  <div>
                    Resp 3 total {money(data.gauge.resp3TotalCents)} vs DV{" "}
                    {money(data.gauge.depreciatedValueCents)}
                  </div>
                  <div>{data.gauge.message}</div>
                  {data.gauge.require5399 && (
                    <div className="text-amber-900">{data.gauge.note5399}</div>
                  )}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold">Shared documents</h2>
              <p className="text-xs text-muted-foreground">
                JIC photo set: 4–10 photos per unit (OM 103.A). Gallery is event-scoped.
              </p>
              <ul className="text-sm space-y-1">
                {(w.documents ?? []).length === 0 && (
                  <li className="text-muted-foreground">No documents yet</li>
                )}
                {(w.documents ?? []).map((d) => (
                  <li key={String(d.id)}>
                    {String(d.kind)} · {String(d.original_filename ?? d.id)}
                    {d.jic_photo ? " · JIC photo" : ""}
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-1 text-sm text-muted-foreground border-t pt-4">
              <h2 className="text-base font-semibold text-foreground">Rebill</h2>
              <p>{w.rebillNotes}</p>
              <p>Send Lessee is excluded for wreck estimates.</p>
            </section>
          </>
        )}
      </div>
    </RepairOwnerShell>
  );
}
