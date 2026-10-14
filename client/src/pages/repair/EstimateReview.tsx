import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PageHeader from "@/components/PageHeader";
import { apiRequest } from "@/lib/queryClient";
import {
  EstimateDataFile,
  type EstimateLine,
  type HeaderEdit,
  type HeaderFieldDef,
  type DocRow,
} from "./EstimateDataFile";
import RepairOwnerShell from "./RepairOwnerShell";

type RevBlock = {
  revision: {
    id: string;
    rev_no: number;
    action: string;
    new_status: string | null;
    comment: string | null;
    labor: number;
    material: number;
    total: number;
    header?: Record<string, unknown>;
  };
  lines: EstimateLine[];
  byResp: Record<string, EstimateLine[]>;
};

export default function EstimateReview() {
  const [, params] = useRoute("/repair/estimates/:id");
  const estimateId = params?.id ?? "";
  const [blocks, setBlocks] = useState<RevBlock[]>([]);
  const [compare, setCompare] = useState<{
    from: number;
    to: number;
    added: number;
    removed: number;
    changed: number;
  } | null>(null);
  const [header, setHeader] = useState<Record<string, unknown>>({});
  const [headerFields, setHeaderFields] = useState<HeaderFieldDef[]>([]);
  const [headerEdits, setHeaderEdits] = useState<HeaderEdit[]>([]);
  const [documents, setDocuments] = useState<DocRow[]>([]);
  const [canPencil, setCanPencil] = useState(false);
  const [needsAdjustment, setNeedsAdjustment] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [lesseeEmail, setLesseeEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [corrReason, setCorrReason] = useState("");
  const [editLines, setEditLines] = useState<
    Array<{
      lineNo: number;
      aarJobCode: string;
      qualifier: string;
      whyMade: string;
      respCode: string;
      labor: string;
      material: string;
    }>
  >([]);
  const [canCorrect, setCanCorrect] = useState(false);

  async function load() {
    setError("");
    try {
      const res = await apiRequest("GET", `/api/repair/estimates/${estimateId}/review`);
      const data = await res.json();
      setBlocks(data.revisions ?? []);
      setCompare(data.compare ?? null);
      setHeader(data.header ?? {});
      setHeaderFields(data.headerFields ?? []);
      setHeaderEdits(data.headerEdits ?? []);
      setDocuments(data.documents ?? []);
      setCanPencil(Boolean(data.canPencilEdit));
      setNeedsAdjustment(Boolean(data.needsAdjustment));

      const ed = await apiRequest(
        "GET",
        `/api/repair/estimates/${estimateId}/correction-editor`,
      );
      if (ed.ok) {
        const payload = await ed.json();
        setCanCorrect(Boolean(payload.canCorrect));
        setNeedsAdjustment(Boolean(payload.needsAdjustment));
        const lines = (payload.lines ?? []) as EstimateLine[];
        setEditLines(
          lines.map((l) => ({
            lineNo: l.line_no,
            aarJobCode: l.aar_job_code ?? "",
            qualifier: l.qualifier ?? "",
            whyMade: l.why_made ?? "",
            respCode: l.resp_code ?? "",
            labor: String(l.labor ?? 0),
            material: String(l.material ?? 0),
          })),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load review");
    }
  }

  async function saveCorrection() {
    setMsg("");
    setError("");
    try {
      const res = await apiRequest(
        "POST",
        `/api/repair/estimates/${estimateId}/internal-correction`,
        {
          reason: corrReason,
          actorRole: "reviewer",
          asAdjustment: needsAdjustment || undefined,
          header,
          lines: editLines.map((l) => ({
            lineNo: l.lineNo,
            aarJobCode: l.aarJobCode || undefined,
            qualifier: l.qualifier || undefined,
            whyMade: l.whyMade || undefined,
            respCode: l.respCode || undefined,
            labor: Number(l.labor || 0),
            material: Number(l.material || 0),
            total: Number(l.labor || 0) + Number(l.material || 0),
          })),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "correction failed");
      setMsg(
        `Internal correction saved as rev ${data.revision?.rev_no} (shop notified). Totals recalculated.`,
      );
      setCorrReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "correction failed");
    }
  }

  useEffect(() => {
    if (estimateId) void load();
  }, [estimateId]);

  const latest = blocks[blocks.length - 1];

  async function act(path: string) {
    setMsg("");
    setError("");
    try {
      const res = await apiRequest("POST", `/api/repair/estimates/${estimateId}/${path}`, {
        comment: note || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || path);
      setMsg(`${path}: ok`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : path);
    }
  }

  async function sendLessee() {
    setMsg("");
    setError("");
    try {
      const res = await apiRequest(
        "POST",
        `/api/repair/estimates/${estimateId}/lessee-approval`,
        { lesseeEmail, note: note || undefined },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "lessee-approval failed");
      setMsg(
        `Lessee email logged (dev). Link path: ${data.lesseeUrlPath} — shop was not copied.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "lessee send failed");
    }
  }

  return (
    <RepairOwnerShell>
    <div className="p-6 max-w-6xl space-y-6">
      <PageHeader
        title="Estimate review"
        subtitle="repairSMART-style Data File header, lines by responsibility, pencil audits, approve / request revision."
      />
      <p className="text-sm text-muted-foreground">
        <Link href="/repair" className="underline">
          ← Repair home
        </Link>
        {" · "}
        Estimate {estimateId.slice(0, 8)}…
        {latest && (
          <>
            {" · "}
            Rev {latest.revision.rev_no} · {latest.revision.new_status} · total $
            {Number(latest.revision.total).toFixed(2)}
          </>
        )}
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {msg && <p className="text-sm text-foreground">{msg}</p>}

      {compare && (
        <div className="text-sm border-b border-border pb-3">
          Revision compare r{compare.from} → r{compare.to}:{" "}
          <span className="font-medium">{compare.added}</span> added,{" "}
          <span className="font-medium">{compare.removed}</span> removed,{" "}
          <span className="font-medium">{compare.changed}</span> changed
        </div>
      )}

      {latest && (
        <>
          <EstimateDataFile
            estimateId={estimateId}
            header={header}
            headerFields={headerFields}
            headerEdits={headerEdits}
            lines={latest.lines}
            documents={documents}
            canPencilEdit={canPencil}
            readOnly={false}
            onHeaderChanged={load}
          />

          <div className="grid gap-3 max-w-xl">
            <div className="grid gap-1">
              <Label htmlFor="note">Comment (audited)</Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => act("submit")}>
                Submit for approval
              </Button>
              <Button variant="outline" onClick={() => act("request-revision")}>
                Request revision
              </Button>
              <Button onClick={() => act("approve")}>Approve</Button>
              <Button variant="secondary" onClick={() => act("complete")}>
                Set completed date (locks estimate)
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  setMsg("");
                  setError("");
                  try {
                    const res = await apiRequest(
                      "POST",
                      `/api/repair/estimates/${estimateId}/rollback-complete`,
                      { comment: note || undefined, actorRole: "reviewer" },
                    );
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "rollback failed");
                    setMsg("Completed date rolled back — all parties notified (dev log).");
                    await load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "rollback failed");
                  }
                }}
              >
                Rollback completed date
              </Button>
            </div>
            <div className="grid gap-1 pt-2 border-t border-border">
              <Label htmlFor="lessee">Resp 6 — lessee email (shop never copied)</Label>
              <Input
                id="lessee"
                type="email"
                placeholder="lessee@example.com"
                value={lesseeEmail}
                onChange={(e) => setLesseeEmail(e.target.value)}
              />
              <Button variant="secondary" onClick={sendLessee} disabled={!lesseeEmail}>
                Send lessee approval email (dev log)
              </Button>
            </div>

            <div className="grid gap-3 pt-4 border-t border-border max-w-3xl">
              <h2 className="text-sm font-medium">
                Internal correction editor (admin/reviewer only)
              </h2>
              <p className="text-xs text-muted-foreground">
                Line bulk edit. Header pencil edits above also create a revision and require a
                reason. After Approved, corrections go through Adjustment.
              </p>
              {needsAdjustment && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Status is post-Approved — save will create an Adjustment for Approval.
                </p>
              )}
              <div className="grid gap-1">
                <Label htmlFor="corr-reason">Correction reason (required)</Label>
                <Textarea
                  id="corr-reason"
                  value={corrReason}
                  onChange={(e) => setCorrReason(e.target.value)}
                  rows={2}
                />
              </div>
              {editLines.length > 0 && (
                <div className="overflow-auto border border-border rounded-md">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="p-2">Line</th>
                        <th className="p-2">Job</th>
                        <th className="p-2">Resp</th>
                        <th className="p-2">Labor</th>
                        <th className="p-2">Material</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editLines.map((l, idx) => (
                        <tr key={l.lineNo} className="border-t border-border">
                          <td className="p-2">{l.lineNo}</td>
                          <td className="p-2">
                            <Input
                              className="h-8 text-xs"
                              value={l.aarJobCode}
                              onChange={(e) => {
                                const next = [...editLines];
                                next[idx] = { ...l, aarJobCode: e.target.value };
                                setEditLines(next);
                              }}
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              className="h-8 text-xs w-16"
                              value={l.respCode}
                              onChange={(e) => {
                                const next = [...editLines];
                                next[idx] = { ...l, respCode: e.target.value };
                                setEditLines(next);
                              }}
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              className="h-8 text-xs w-20"
                              value={l.labor}
                              onChange={(e) => {
                                const next = [...editLines];
                                next[idx] = { ...l, labor: e.target.value };
                                setEditLines(next);
                              }}
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              className="h-8 text-xs w-20"
                              value={l.material}
                              onChange={(e) => {
                                const next = [...editLines];
                                next[idx] = { ...l, material: e.target.value };
                                setEditLines(next);
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Button
                onClick={saveCorrection}
                disabled={!corrReason.trim() || (!canCorrect && !needsAdjustment)}
              >
                Save correction (new revision)
              </Button>
            </div>
          </div>
        </>
      )}

      {!latest && !error && (
        <p className="text-sm text-muted-foreground">No revisions yet for this estimate.</p>
      )}
    </div>
    </RepairOwnerShell>
  );
}
