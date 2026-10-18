import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { offerUndoToast } from "@/lib/undo";
import { CRM_ACTIVITY_KINDS, type CrmActivityKind } from "@shared/crm";

export default function ActivityDialog({
  open,
  onOpenChange,
  canWrite,
  accountId,
  opportunityId,
  riderId,
  defaultKind,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canWrite: boolean;
  accountId?: number | null;
  opportunityId?: number | null;
  riderId?: number | null;
  defaultKind?: CrmActivityKind;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [kind, setKind] = useState<CrmActivityKind>(defaultKind ?? "note");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");

  useEffect(() => {
    if (!open) return;
    setKind(defaultKind ?? "note");
    setBody("");
    setDueDate("");
  }, [open, defaultKind]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/crm-activities", {
        account_id: accountId ?? null,
        opportunity_id: opportunityId ?? null,
        rider_id: riderId ?? null,
        kind,
        body,
        due_date: kind === "task" ? dueDate || null : null,
      });
      return res.json();
    },
    onSuccess: (row) => {
      offerUndoToast(row);
      void qc.invalidateQueries({ queryKey: ["/api/accounts"] });
      void qc.invalidateQueries({ queryKey: ["/api/crm-activities"] });
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind === "task" ? "Task" : "Log activity"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Kind</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
              value={kind}
              disabled={!canWrite}
              onChange={(e) => setKind(e.target.value as CrmActivityKind)}
            >
              {CRM_ACTIVITY_KINDS.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Notes</Label>
            <textarea
              className="mt-1 w-full min-h-24 rounded-md border border-input bg-background px-2 py-1"
              value={body}
              disabled={!canWrite}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          {kind === "task" ? (
            <div>
              <Label>Due date</Label>
              <Input type="date" value={dueDate} disabled={!canWrite} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canWrite || save.isPending || !body.trim()} onClick={() => save.mutate()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
