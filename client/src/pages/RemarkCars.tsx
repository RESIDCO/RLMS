import { useMemo, useState } from "react";
import { useCanEdit } from "@/lib/AuthContext";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest, apiUpload, queryClient } from "@/lib/queryClient";
import { invalidateFleetQueries } from "@/lib/fleetQueryRefresh";
import { useToast } from "@/hooks/use-toast";
import { REMARK_CONFIRM, remarkPreviewToCsv, type RemarkPreviewRow, type RemarkStatus } from "@shared/remark-in-place";
import { Download } from "lucide-react";
import { CopyCarsButton } from "@/components/CopyCarsButton";
import { AddNoteField, appendNoteBody } from "@/components/AddNoteField";

type PreviewResponse = {
  ok: boolean;
  dry_run: boolean;
  rows: RemarkPreviewRow[];
  counts: Record<RemarkStatus, number> & { total: number; blockers: number };
  input_rows: Array<{ input: string }>;
};

const STATUS_LABEL: Record<RemarkStatus, string> = {
  ready: "Ready",
  inactive: "Inactive",
  not_found: "Not found",
  clash: "Clash",
  already: "Already new mark",
  moved: "Already remarked",
  duplicate: "Duplicate",
  ambiguous: "Ambiguous",
  invalid: "Invalid",
};

function statusClass(status: RemarkStatus): string {
  switch (status) {
    case "ready":
      return "bg-emerald-500/15 text-emerald-800";
    case "already":
    case "moved":
      return "bg-muted text-muted-foreground";
    case "inactive":
    case "not_found":
    case "clash":
    case "duplicate":
    case "ambiguous":
    case "invalid":
      return "bg-amber-500/15 text-amber-900";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export default function RemarkCars() {
  const canEdit = useCanEdit();
  const { toast } = useToast();
  const [text, setText] = useState("KCS 310100 > OFOX 310100");
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [addNote, setAddNote] = useState("");
  const [goodOnly, setGoodOnly] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);

  const counts = preview?.counts;
  const canApply = Boolean(
    canEdit &&
      preview &&
      confirm === REMARK_CONFIRM &&
      (goodOnly ? (counts?.ready ?? 0) > 0 : (counts?.blockers ?? 1) === 0 && (counts?.ready ?? 0) > 0),
  );

  const summary = useMemo(() => {
    if (!counts) return [];
    return (Object.keys(STATUS_LABEL) as RemarkStatus[])
      .filter((key) => counts[key] > 0)
      .map((key) => ({ key, label: STATUS_LABEL[key], n: counts[key] }));
  }, [counts]);

  async function runPreview() {
    setBusy("preview");
    setConfirm("");
    try {
      const res = file
        ? await apiUpload("/api/railcars/remark/preview", (() => {
            const body = new FormData();
            body.append("file", file);
            return body;
          })())
        : await apiRequest("POST", "/api/railcars/remark/preview", { text });
      const data = (await res.json()) as PreviewResponse;
      setPreview(data);
    } catch (err) {
      toast({ title: "Preview failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function runApply() {
    if (!preview || !canApply) return;
    setBusy("apply");
    try {
      const source = preview.input_rows.map((row) => row.input).join("\n");
      const res = await apiRequest("POST", "/api/railcars/remark/apply", {
        text: source,
        mode: goodOnly ? "good" : "all",
        confirm,
        reason,
        ...appendNoteBody(addNote),
      });
      const data = await res.json();
      void invalidateFleetQueries(queryClient);
      toast({
        title: `Remarked ${data.applied} car${data.applied === 1 ? "" : "s"}`,
        description: "Undo reverses the whole batch, including the mark history rows.",
      });
      setPreview(null);
      setConfirm("");
    } catch (err) {
      toast({ title: "Remark failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  function downloadCsv() {
    if (!preview) return;
    const blob = new Blob([remarkPreviewToCsv(preview.rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "remark-preview.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title="Remark cars"
        subtitle="Rename in place. The railcar id, programs, and commitments stay on the same record."
        note="Active cars only. One Undo reverses the batch. The monthly VCF import treats an old mark plus number as this same car, so it will not create a duplicate."
      />
      <div className="px-4 sm:px-8 py-6 max-w-6xl space-y-6">
        {!canEdit && (
          <p className="text-sm text-muted-foreground">Editors and admins can preview and apply a remark.</p>
        )}
        <section className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div>
            <Label htmlFor="remark-paste">Paste a list</Label>
            <Textarea
              id="remark-paste"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setFile(null);
                setPreview(null);
              }}
              rows={8}
              spellCheck={false}
              placeholder={"KCS 310100 > OFOX 310100\nKCS,310101,OFOX"}
              className="font-mono text-sm mt-1.5"
              data-testid="input-remark-paste"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              One car per line: old mark, number, new mark, and an optional new number. <span className="font-mono">KCS 310100 &gt; OFOX</span> keeps the number. A CSV header of Prefix, Number, Remark works too.
            </p>
          </div>
          <div>
            <Label htmlFor="remark-file">Or upload CSV / xlsx</Label>
            <Input
              id="remark-file"
              type="file"
              accept=".csv,.txt,.xlsx"
              className="mt-1.5"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
              }}
              data-testid="input-remark-file"
            />
          </div>
          <div>
            <Label htmlFor="remark-reason">Reason</Label>
            <Input
              id="remark-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Remark KCS to OFOX"
              className="mt-1.5"
              data-testid="input-remark-reason"
            />
            <div className="mt-3">
              <AddNoteField id="remark-cars-note" value={addNote} onChange={setAddNote} />
            </div>
          </div>
          <Button type="button" onClick={runPreview} disabled={!canEdit || busy != null} data-testid="button-remark-preview">
            {busy === "preview" ? "Checking…" : "Preview"}
          </Button>
        </section>

        {preview && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">{counts?.total ?? 0} rows</span>
              {summary.map((item) => (
                <span key={item.key} className={`text-xs rounded px-2 py-0.5 ${statusClass(item.key)}`}>
                  {item.label} {item.n}
                </span>
              ))}
              <CopyCarsButton
                rows={preview.rows}
                lineOf={(row) => ({
                  reporting_marks: row.old_mark,
                  car_number: row.old_number,
                  car: row.input,
                })}
                testId="button-copy-cars-remark"
              />
              <Button type="button" variant="outline" size="sm" onClick={downloadCsv} data-testid="button-remark-csv">
                <Download className="h-4 w-4" />
                Download preview CSV
              </Button>
            </div>
            <div className="overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Input</th>
                    <th className="px-3 py-2">Car</th>
                    <th className="px-3 py-2">Active</th>
                    <th className="px-3 py-2">Program</th>
                    <th className="px-3 py-2">Lease / lessee</th>
                    <th className="px-3 py-2">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={`${row.line}-${row.input}`} className="border-t border-border align-top">
                      <td className="px-3 py-2 font-mono text-xs">{row.input}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.railcar_id ?? "—"}</td>
                      <td className="px-3 py-2">{row.active == null ? "—" : row.active ? "Yes" : "No"}</td>
                      <td className="px-3 py-2">{row.program ?? "—"}</td>
                      <td className="px-3 py-2">
                        <div>{row.lease ?? "—"}</div>
                        <div className="text-muted-foreground">{row.lessee ?? ""}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className={`inline-block text-xs rounded px-1.5 py-0.5 ${statusClass(row.status)}`}>
                          {STATUS_LABEL[row.status]}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{row.message}</div>
                        {row.clash && (
                          <div className="text-xs mt-1">
                            Clash with {row.clash.reporting_marks} {row.clash.car_number} (#{row.clash.id}, {row.clash.active ? "active" : "inactive"})
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={goodOnly} onCheckedChange={(v) => setGoodOnly(v === true)} data-testid="check-remark-good-only" />
              Apply only the ready rows. Leave this off to require every row to be ready.
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="remark-confirm">Type {REMARK_CONFIRM} to apply</Label>
                <Input
                  id="remark-confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="mt-1.5 w-40 font-mono"
                  data-testid="input-remark-confirm"
                />
              </div>
              <Button type="button" disabled={!canApply || busy != null} onClick={runApply} data-testid="button-remark-apply">
                {busy === "apply" ? "Applying…" : `Remark ${goodOnly ? counts?.ready ?? 0 : counts?.ready ?? 0} cars`}
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
