/**
 * Update Responsibilities (§D / shots 04–05) — owner reassigns resp codes,
 * restore from revision, split by %, summary by code + Recalculate.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import RepairOwnerShell from "./RepairOwnerShell";
import { WorkspaceBanner } from "./WorkspaceTitle";
import { cn } from "@/lib/utils";
import type { EstimateLine } from "./EstimateDataFile";

type RespCode = { code: string; display_name: string };

type DraftLine = EstimateLine & {
  resp_new: string;
  checked: boolean;
  splitPercent?: number;
};

export default function UpdateResponsibilities() {
  const [, params] = useRoute("/repair/estimates/:id/responsibilities");
  const estimateId = params?.id ?? "";
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [baseline, setBaseline] = useState<DraftLine[]>([]);
  const [codes, setCodes] = useState<RespCode[]>([]);
  const [selectedCode, setSelectedCode] = useState("6");
  const [restoreRev, setRestoreRev] = useState<number | "this">("this");
  const [revisions, setRevisions] = useState<
    Array<{ rev_no: number; id: string; lines: EstimateLine[] }>
  >([]);
  const [percent, setPercent] = useState("50");
  const [party, setParty] = useState("");
  const [assignment, setAssignment] = useState("");
  const [ctxLabel, setCtxLabel] = useState("");
  const [summary, setSummary] = useState<
    Array<{ code: string; totalDisplay: string }>
  >([]);
  const [pendingSplits, setPendingSplits] = useState<
    Array<{ lineId: string; percent: number; respCode: string }>
  >([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [meta, setMeta] = useState<Record<string, string | null>>({});

  async function load() {
    setError("");
    const res = await apiRequest("GET", `/api/repair/estimates/${estimateId}/review`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "load failed");
    const blocks = data.revisions ?? [];
    setRevisions(
      blocks.map((b: { revision: { rev_no: number; id: string }; lines: EstimateLine[] }) => ({
        rev_no: Number(b.revision.rev_no),
        id: String(b.revision.id),
        lines: b.lines,
      })),
    );
    const latest = blocks[blocks.length - 1];
    const draft: DraftLine[] = (latest?.lines ?? []).map((l: EstimateLine) => ({
      ...l,
      resp_new: "",
      checked: false,
    }));
    setLines(draft);
    setBaseline(draft.map((l) => ({ ...l })));
    setCodes(data.ownerRespCodes?.length ? data.ownerRespCodes : data.respCodes ?? []);
    if (data.ownerRespCodes?.[0]?.code) setSelectedCode(String(data.ownerRespCodes[0].code));
    const c = data.context;
    if (c) {
      setAssignment(c.assignment || "");
      setParty(c.assignment || "");
      setCtxLabel(
        `${c.shopDisplay || ""} : Entity ${c.entityCode || ""}`.trim(),
      );
      setMeta({
        estimateId: c.estimateIdDisplay,
        status: c.statusName,
        car: `${c.carInitial} ${c.carNumber}`,
        splc: c.splc,
        created: c.createdAt,
        account: c.accountDate,
        approval: c.approvalRequiredAt,
        repair: c.repairDate,
        arrival: c.yardArrival,
      });
    }
    await recalculate(draft);
  }

  useEffect(() => {
    if (!estimateId) return;
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : "load failed"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateId]);

  async function recalculate(src: DraftLine[] = lines) {
    const payload = src.map((l) => ({
      resp_code: l.resp_code,
      resp_new: l.resp_new || null,
      labor: l.labor,
      material: l.material,
      labor_cents: (l as { labor_cents?: number }).labor_cents,
      material_cents: (l as { material_cents?: number }).material_cents,
    }));
    const res = await apiRequest(
      "POST",
      `/api/repair/estimates/${estimateId}/responsibility-summary`,
      { lines: payload },
    );
    const data = await res.json();
    setSummary(data.summary ?? []);
  }

  function setCheckedCode() {
    setLines((prev) => {
      const next = prev.map((l) =>
        l.checked ? { ...l, resp_new: selectedCode } : l,
      );
      void recalculate(next);
      return next;
    });
  }

  function restoreUnset() {
    if (restoreRev === "this") {
      setLines((prev) => {
        const next = prev.map((l) =>
          l.resp_new ? l : { ...l, resp_new: String(l.resp_code ?? "") },
        );
        void recalculate(next);
        return next;
      });
      return;
    }
    const rev = revisions.find((r) => r.rev_no === restoreRev);
    if (!rev) return;
    const byNo = new Map(rev.lines.map((l) => [l.line_no, l]));
    setLines((prev) => {
      const next = prev.map((l) => {
        if (l.resp_new) return l;
        const src = byNo.get(l.line_no);
        return src ? { ...l, resp_new: String(src.resp_code ?? "") } : l;
      });
      void recalculate(next);
      return next;
    });
  }

  function splitSelected() {
    const pct = Number(percent);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
      setError("Percentage must be between 1 and 99");
      return;
    }
    const checked = lines.filter((l) => l.checked);
    if (!checked.length) {
      setError("Select at least one line to split");
      return;
    }
    const splits = checked.map((l) => ({
      lineId: String(l.id),
      percent: pct,
      respCode: l.resp_new || selectedCode,
    }));
    setPendingSplits(splits);
    setMsg(
      `Split queued for ${splits.length} line(s) at ${pct}% (applied on Submit).`,
    );
  }

  function resetValues() {
    setLines(baseline.map((l) => ({ ...l, checked: false, resp_new: "" })));
    setPendingSplits([]);
    setMsg("Reset to current revision values");
    void recalculate(baseline);
  }

  async function submitValues() {
    setError("");
    setMsg("");
    const lineUpdates = lines
      .filter((l) => l.resp_new && l.resp_new !== String(l.resp_code ?? ""))
      .map((l) => ({ lineId: String(l.id), respCode: l.resp_new }));
    // Also include split lines' target codes even if same as current for the A portion
    for (const s of pendingSplits) {
      if (!lineUpdates.some((u) => u.lineId === s.lineId)) {
        lineUpdates.push({ lineId: s.lineId, respCode: s.respCode });
      }
    }
    if (!lineUpdates.length && !pendingSplits.length) {
      setError("No responsibility changes to submit");
      return;
    }
    try {
      const res = await apiRequest(
        "POST",
        `/api/repair/estimates/${estimateId}/update-responsibility`,
        {
          useOwnerUiD: true,
          lineUpdates,
          splits: pendingSplits,
          responsibleParty: party || undefined,
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "submit failed");
      setMsg(
        `Submitted — rev ${data.revision?.rev_no ?? "?"} · total $${data.totalDisplay ?? data.total}`,
      );
      setPendingSplits([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "submit failed");
    }
  }

  const allChecked = useMemo(
    () => lines.length > 0 && lines.every((l) => l.checked),
    [lines],
  );

  return (
    <RepairOwnerShell>
      <WorkspaceBanner
        pageTitle="Update Responsibilities"
        right={
          <Link
            href={`/repair/estimates/${estimateId}`}
            className="underline text-white/90 text-xs"
          >
            Back to Estimate Review
          </Link>
        }
      />

      <div className="p-3 space-y-3 max-w-[1400px]">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {msg && <p className="text-sm text-foreground">{msg}</p>}

        <div className="grid gap-3 lg:grid-cols-3 border border-border rounded-md bg-muted/20 p-3 text-sm">
          <div className="space-y-2">
            <div className="font-medium text-xs uppercase text-muted-foreground">
              Set Responsibility Code
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <Label className="text-xs">Selected Code</Label>
                <select
                  className="mt-1 h-9 rounded border border-border bg-background px-2 text-sm block min-w-[12rem]"
                  value={selectedCode}
                  onChange={(e) => setSelectedCode(e.target.value)}
                >
                  {codes.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} ({c.display_name})
                    </option>
                  ))}
                </select>
              </div>
              <Button onClick={setCheckedCode}>Set Checked Lines</Button>
            </div>
          </div>
          <div className="space-y-2">
            <div className="font-medium text-xs uppercase text-muted-foreground">
              Restore from Previous
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <Label className="text-xs">Select Revision</Label>
                <select
                  className="mt-1 h-9 rounded border border-border bg-background px-2 text-sm block"
                  value={restoreRev}
                  onChange={(e) =>
                    setRestoreRev(
                      e.target.value === "this" ? "this" : Number(e.target.value),
                    )
                  }
                >
                  <option value="this">This Revision</option>
                  {revisions
                    .slice()
                    .reverse()
                    .slice(1)
                    .map((r) => (
                      <option key={r.id} value={r.rev_no}>
                        Rev {r.rev_no}
                      </option>
                    ))}
                </select>
              </div>
              <Button variant="secondary" onClick={restoreUnset}>
                Restore Unset Lines
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <div className="font-medium text-xs uppercase text-muted-foreground">
              Split Line Items
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <Label className="text-xs">Percentage</Label>
                <Input
                  className="mt-1 h-9 w-24"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                />
              </div>
              <Button variant="secondary" onClick={splitSelected}>
                Split Selected
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            className="bg-orange-500 hover:bg-orange-600 text-white"
            onClick={resetValues}
          >
            Reset values
          </Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => void submitValues()}
          >
            Submit values
          </Button>
          <div className="text-sm">
            <Label className="text-xs">Responsible Party</Label>
            <Input
              className="mt-1 h-9 min-w-[18rem]"
              value={party}
              onChange={(e) => setParty(e.target.value)}
              placeholder={assignment || "Responsible party"}
            />
          </div>
          <div className="text-xs text-muted-foreground ml-auto">{ctxLabel}</div>
        </div>

        <div className="grid md:grid-cols-3 gap-2 text-xs border border-border rounded-md p-3">
          <div>
            Estimate ID: <strong>{meta.estimateId}</strong>
            <br />
            Status: <strong>{meta.status}</strong>
          </div>
          <div>
            Car: <strong>{meta.car}</strong>
            <br />
            SPLC: <strong>{meta.splc}</strong>
          </div>
          <div>
            Created: {meta.created} · Account: {meta.account}
            <br />
            Approval: {meta.approval} · Repair: {meta.repair} · Arrival: {meta.arrival}
          </div>
        </div>

        <div className="overflow-auto border border-border rounded-md">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-muted text-left">
                <th className="p-1.5">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l) => ({ ...l, checked: e.target.checked })),
                      )
                    }
                  />
                </th>
                <th className="p-1.5">Line</th>
                <th className="p-1.5">Loc</th>
                <th className="p-1.5">Qnty</th>
                <th className="p-1.5">C</th>
                <th className="p-1.5">AJOB</th>
                <th className="p-1.5">QA</th>
                <th className="p-1.5">Description</th>
                <th className="p-1.5">WM</th>
                <th className="p-1.5">RJOB</th>
                <th className="p-1.5">QR</th>
                <th className="p-1.5">R (Cur)</th>
                <th className="p-1.5">R (New)</th>
                <th className="p-1.5 text-right">Labor</th>
                <th className="p-1.5 text-right">Material</th>
                <th className="p-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr
                  key={l.id ?? l.line_no}
                  className={cn(
                    "border-t border-border",
                    idx % 2 === 1 ? "bg-sky-50/60 dark:bg-slate-800/40" : "",
                  )}
                >
                  <td className="p-1.5">
                    <input
                      type="checkbox"
                      checked={l.checked}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((x) =>
                            x.id === l.id ? { ...x, checked: e.target.checked } : x,
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="p-1.5 tabular-nums">
                    {String(l.line_no).padStart(5, "0")}
                  </td>
                  <td className="p-1.5">{l.location_on_car ?? ""}</td>
                  <td className="p-1.5">{l.quantity ?? ""}</td>
                  <td className="p-1.5">{l.condition_code ?? ""}</td>
                  <td className="p-1.5 font-mono">{l.aar_job_code ?? ""}</td>
                  <td className="p-1.5">{l.qualifier ?? ""}</td>
                  <td className="p-1.5 uppercase max-w-[12rem] truncate">
                    {l.description ?? ""}
                  </td>
                  <td className="p-1.5">{l.why_made ?? ""}</td>
                  <td className="p-1.5 font-mono">{l.removed_job_code ?? ""}</td>
                  <td className="p-1.5">{l.removed_qualifier ?? ""}</td>
                  <td className="p-1.5 font-semibold">{l.resp_code ?? ""}</td>
                  <td className="p-1.5">
                    <select
                      className="h-7 rounded border border-border bg-background px-1"
                      value={l.resp_new}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLines((prev) => {
                          const next = prev.map((x) =>
                            x.id === l.id ? { ...x, resp_new: v } : x,
                          );
                          void recalculate(next);
                          return next;
                        });
                      }}
                    >
                      <option value="">--</option>
                      {codes.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-1.5 text-right tabular-nums">
                    ${l.labor_display ?? Number(l.labor).toFixed(2)}
                  </td>
                  <td className="p-1.5 text-right tabular-nums">
                    ${l.material_display ?? Number(l.material).toFixed(2)}
                  </td>
                  <td className="p-1.5 text-right tabular-nums font-medium">
                    ${l.amount_display ?? Number(l.total).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-3 border border-border rounded-md px-3 py-2 text-sm">
          <div className="font-medium">Responsibility Summary:</div>
          <div>
            {summary.length === 0
              ? "—"
              : summary.map((s) => `${s.code} = $${s.totalDisplay}`).join("; ")}
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            onClick={() => void recalculate()}
          >
            Recalculate
          </Button>
        </div>
      </div>
    </RepairOwnerShell>
  );
}
