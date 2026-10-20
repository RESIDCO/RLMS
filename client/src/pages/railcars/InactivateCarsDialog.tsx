import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateFleetQueries } from "@/lib/fleetQueryRefresh";
import {
  INACTIVATE_CONFIRM,
  inactivatePreviewToCsv,
  type InactivatePreviewRow,
  type InactivateStatus,
} from "@shared/inactivate-cars";
import { Download } from "lucide-react";

type PreviewResponse = {
  rows: InactivatePreviewRow[];
  counts: Record<InactivateStatus, number> & { total: number; blockers: number };
};

const STATUS_LABEL: Record<InactivateStatus, string> = {
  ready: "Ready",
  blocked: "Blocked",
  already_inactive: "Already inactive",
};

function statusClass(status: InactivateStatus): string {
  switch (status) {
    case "ready":
      return "bg-emerald-500/15 text-emerald-800";
    case "blocked":
      return "bg-amber-500/15 text-amber-900";
    case "already_inactive":
      return "bg-muted text-muted-foreground";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function InactivateCarsDialog({
  open,
  ids,
  onClose,
  onApplied,
}: {
  open: boolean;
  ids: number[];
  onClose: () => void;
  onApplied?: () => void;
}) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [goodOnly, setGoodOnly] = useState(false);
  const [closeAssignment, setCloseAssignment] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setReason("");
      setConfirm("");
      setGoodOnly(false);
      setCloseAssignment(false);
      setEndDate("");
      return;
    }
    let cancelled = false;
    setBusy("preview");
    setConfirm("");
    void (async () => {
      try {
        const res = await apiRequest("POST", "/api/railcars/inactivate/preview", {
          ids,
          close_assignment: closeAssignment,
        });
        const data = (await res.json()) as PreviewResponse;
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled) {
          setPreview(null);
          toast({
            title: "Preview failed",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, ids.join(","), closeAssignment, toast]);

  const counts = preview?.counts;
  const canApply = Boolean(
    preview &&
      reason.trim() &&
      confirm === INACTIVATE_CONFIRM &&
      (!closeAssignment || /^\d{4}-\d{2}-\d{2}$/.test(endDate)) &&
      (goodOnly ? (counts?.ready ?? 0) > 0 : (counts?.blockers ?? 1) === 0 && (counts?.ready ?? 0) > 0) &&
      busy == null,
  );

  const summary = useMemo(() => {
    if (!counts) return [];
    return (Object.keys(STATUS_LABEL) as InactivateStatus[])
      .filter((key) => counts[key] > 0)
      .map((key) => ({ key, label: STATUS_LABEL[key], n: counts[key] }));
  }, [counts]);

  async function runApply() {
    if (!canApply) return;
    setBusy("apply");
    try {
      const res = await apiRequest("POST", "/api/railcars/inactivate/apply", {
        ids,
        mode: goodOnly ? "good" : "all",
        confirm,
        reason: reason.trim(),
        close_assignment: closeAssignment,
        end_date: closeAssignment ? endDate : null,
      });
      const data = await res.json();
      toast({
        title: `Inactivated ${data.applied} car${data.applied === 1 ? "" : "s"}`,
        description: "Undo reverses the whole batch.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      void invalidateFleetQueries(queryClient);
      onApplied?.();
      onClose();
    } catch (err) {
      toast({
        title: "Inactivate failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  function downloadCsv() {
    if (!preview) return;
    const blob = new Blob([inactivatePreviewToCsv(preview.rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inactivate-preview.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Inactivate {ids.length} car{ids.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>
            Inactive kills the asset and freezes its data. Open assignment, rent stop, program, and commitment stay in place unless you close the assignment here. Rent events are not changed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={closeAssignment}
              onCheckedChange={(v) => setCloseAssignment(v === true)}
              data-testid="inactivate-close-assignment"
            />
            Close the open assignment on an end date
          </label>
          {closeAssignment && (
            <div>
              <Label htmlFor="inactivate-end-date">Assignment end date</Label>
              <Input
                id="inactivate-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1.5 max-w-xs"
                data-testid="inactivate-end-date"
              />
            </div>
          )}
          {busy === "preview" && <p className="text-sm text-muted-foreground">Checking each car…</p>}
          {preview && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{counts?.total ?? 0} cars</span>
                {summary.map((item) => (
                  <span key={item.key} className={`text-xs rounded px-2 py-0.5 ${statusClass(item.key)}`}>
                    {item.label} {item.n}
                  </span>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={downloadCsv}>
                  <Download className="h-4 w-4" />
                  Download preview CSV
                </Button>
              </div>
              <div className="overflow-auto rounded-lg border border-border max-h-72">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Car</th>
                      <th className="px-3 py-2">Check</th>
                      <th className="px-3 py-2">Assignment</th>
                      <th className="px-3 py-2">Rent stop</th>
                      <th className="px-3 py-2">Program</th>
                      <th className="px-3 py-2">Commitment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.id} className="border-t border-border align-top">
                        <td className="px-3 py-2 font-mono text-xs">{row.car}</td>
                        <td className="px-3 py-2">
                          <div className={`inline-block text-xs rounded px-1.5 py-0.5 ${statusClass(row.status)}`}>
                            {STATUS_LABEL[row.status]}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">{row.message}</div>
                        </td>
                        <td className="px-3 py-2 text-xs">{row.assignment?.ol ?? "—"}</td>
                        <td className="px-3 py-2 text-xs">{row.rent_stop ?? "—"}</td>
                        <td className="px-3 py-2 text-xs">{row.programs.length ? row.programs.join(", ") : "—"}</td>
                        <td className="px-3 py-2 text-xs">{row.commitment ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={goodOnly}
              onCheckedChange={(v) => setGoodOnly(v === true)}
              data-testid="inactivate-ready-only"
            />
            Apply ready cars only
          </label>
          <div>
            <Label htmlFor="inactivate-reason">Reason</Label>
            <Input
              id="inactivate-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Destroyed, sold and done, uneconomical to repair…"
              className="mt-1.5"
              data-testid="inactivate-reason"
            />
          </div>
          <div>
            <Label htmlFor="inactivate-confirm">Type {INACTIVATE_CONFIRM} to apply</Label>
            <Input
              id="inactivate-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1.5 font-mono max-w-xs"
              data-testid="inactivate-confirm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => void runApply()}
            disabled={!canApply}
            data-testid="inactivate-apply"
          >
            {busy === "apply" ? "Inactivating…" : "Inactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
