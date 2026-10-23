import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RENT_STOP_REASON_CHOICES, rentStopReasonFields } from "@shared/rent-stops";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiGet, apiRequest } from "@/lib/queryClient";
import { invalidateFleetQueries } from "@/lib/fleetQueryRefresh";
import { useToast } from "@/hooks/use-toast";
import { AddNoteField, appendNoteBody } from "@/components/AddNoteField";

export function RentStopsCard({ carId, canEdit }: { carId: number; canEdit: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["/api/rent-stops/car", carId],
    queryFn: () => apiGet<any>(`/api/rent-stops/car/${carId}`),
    enabled: Number.isFinite(carId) && carId > 0,
  });
  const open = data?.open;
  const hist = data?.history ?? [];
  const [stopDate, setStopDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState<string>("quality repair");
  const [resume, setResume] = useState("");
  const [addNote, setAddNote] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/rent-stops/car", carId] });
    qc.invalidateQueries({ queryKey: ["/api/kpi/car", carId] });
    qc.invalidateQueries({ queryKey: ["/api/dashboard"] });
    void invalidateFleetQueries(qc);
  };

  function stopBody() {
    return {
      stop_date: stopDate,
      expected_resume_date: resume || null,
      ...rentStopReasonFields({ reason, note: addNote }),
      ...appendNoteBody(addNote),
    };
  }

  const setAbate = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/rent-stops/car/${carId}/abatement`, stopBody())).json(),
    onSuccess: () => {
      toast({ title: "Abatement set" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const setOff = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/rent-stops/car/${carId}/off-rent`, stopBody())).json(),
    onSuccess: () => {
      toast({ title: "Off rent set" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const doResume = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/rent-stops/car/${carId}/resume`, { ...appendNoteBody(addNote) })).json(),
    onSuccess: () => {
      toast({ title: "Resumed" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const convert = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/rent-stops/car/${carId}/convert-off-rent`, {
        ...rentStopReasonFields({ reason, note: addNote }),
        ...appendNoteBody(addNote),
      })).json(),
    onSuccess: () => {
      toast({ title: "Converted to off rent (assignment unchanged)" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-2 border border-border rounded-md p-3">
      <div className="font-medium">Rent stops</div>
      {open ? (
        <div className="text-sm space-y-1">
          <div>
            Open <span className="font-medium">{open.type}</span> since {open.stop_date}
          </div>
          <div className="text-muted-foreground">
            {open.reason_other || open.reason}
            {open.note ? ` · ${open.note}` : ""}
            {open.expected_resume_date ? ` · resume ${open.expected_resume_date}` : " · resume undecided"}
            {open.lease_ref ? ` · ${open.lease_ref}` : ""}
          </div>
          {canEdit && (
            <div className="space-y-2 pt-1">
              <AddNoteField id={`rent-stop-note-${carId}`} value={addNote} onChange={setAddNote} />
              <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => doResume.mutate()} disabled={doResume.isPending}>Resume</Button>
              {open.type === "Abatement" && (
                <Button size="sm" variant="outline" onClick={() => convert.mutate()} disabled={convert.isPending}>
                  Convert to off rent
                </Button>
              )}
              <Button size="sm" variant="ghost" asChild>
                <Link href="/rent-stops/bulk?action=off_rent">Bulk off rent…</Link>
              </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">No open stop.</div>
      )}
      {canEdit && !open && (
        <div className="grid gap-2 pt-1">
          <Label>Stop date</Label>
          <Input type="date" value={stopDate} onChange={(e) => setStopDate(e.target.value)} />
          <Label>Reason</Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {RENT_STOP_REASON_CHOICES.map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label>Expected resume (optional)</Label>
          <Input type="date" value={resume} onChange={(e) => setResume(e.target.value)} />
          <AddNoteField id={`rent-stop-new-note-${carId}`} value={addNote} onChange={setAddNote} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setAbate.mutate()} disabled={setAbate.isPending} data-testid="button-set-abatement">Set abatement</Button>
            <Button size="sm" variant="outline" onClick={() => setOff.mutate()} disabled={setOff.isPending} data-testid="button-set-off-rent">Set off rent</Button>
            <Button size="sm" variant="ghost" asChild>
              <Link href="/rent-stops/bulk?action=off_rent">Bulk off rent…</Link>
            </Button>
          </div>
        </div>
      )}
      {hist.length > 0 && (
        <div className="text-xs text-muted-foreground space-y-1 pt-2">
          <div className="uppercase tracking-wide">History</div>
          {hist.slice(0, 8).map((h: any) => (
            <div key={h.id}>
              {String(h.at ?? "").slice(0, 16)} · {h.op} · {h.new_row?.type ?? h.old_row?.type ?? ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
