import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { apiRequest } from "@/lib/queryClient";
import { offerUndoToast } from "@/lib/undo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type PreviewGroup = {
  program: string;
  "fill blank": number;
  change: number;
  clear: number;
  review: number;
};

type TrackerPreview = {
  preview_token: string;
  expires_at: string;
  groups: PreviewGroup[];
  shops: { name: string }[];
  programs_to_create: { name: string; sheet: string }[];
  inactive_skipped: number;
  writes: number;
  reviews: { program: string; car: string; field?: string; note: string }[];
};

export function ProgramTrackerSyncDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TrackerPreview | null>(null);
  const [signedOffBy, setSignedOffBy] = useState("");
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);

  async function runPreview() {
    if (!file) return;
    setBusy("preview");
    try {
      const form = new FormData();
      form.append("file", file);
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch("/api/programs/tracker-sync/preview", { method: "POST", headers, body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Preview failed");
      setPreview(body as TrackerPreview);
    } catch (e: any) {
      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function runApply() {
    if (!preview || !signedOffBy.trim()) return;
    setBusy("apply");
    try {
      const applied = await apiRequest("POST", "/api/programs/tracker-sync/apply", {
        token: preview.preview_token,
        signed_off_by: signedOffBy.trim(),
      }).then((r) => r.json());
      offerUndoToast(applied);
      await qc.invalidateQueries({ queryKey: ["/api/programs"] });
      toast({ title: "Tracker sync applied" });
      onClose();
    } catch (e: any) {
      toast({ title: "Apply failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sync programs from tracker</DialogTitle>
          <DialogDescription>
            Preview writes on active cars only. N/A becomes blank. Inactive cars and rent events are left alone. Undo restores the whole apply.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <Label htmlFor="tracker-file">Tracker workbook</Label>
            <Input
              id="tracker-file"
              type="file"
              accept=".xlsx"
              className="mt-1"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
              }}
            />
          </div>
          <Button type="button" size="sm" disabled={!file || busy != null} onClick={() => void runPreview()}>
            {busy === "preview" ? "Previewing…" : "Preview"}
          </Button>
          {preview && (
            <>
              <div className="text-xs text-muted-foreground">
                {preview.writes} writes · {preview.reviews.length} to review · {preview.inactive_skipped} inactive cars skipped · expires {new Date(preview.expires_at).toLocaleString()}
              </div>
              {preview.shops.length > 0 && (
                <div className="text-xs">New shops: {preview.shops.map((s) => s.name).join(", ")}</div>
              )}
              {preview.programs_to_create.length > 0 && (
                <div className="text-xs">Programs to create: {preview.programs_to_create.map((p) => p.name).join(", ")}</div>
              )}
              <div className="border rounded-md overflow-auto max-h-64">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-2 py-1">Program</th>
                      <th className="text-right px-2 py-1">Fill blank</th>
                      <th className="text-right px-2 py-1">Change</th>
                      <th className="text-right px-2 py-1">Clear</th>
                      <th className="text-right px-2 py-1">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.groups.map((group) => (
                      <tr key={group.program} className="border-t">
                        <td className="px-2 py-1">{group.program}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{group["fill blank"]}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{group.change}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{group.clear}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{group.review}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.reviews.length > 0 && (
                <ul className="text-xs text-destructive space-y-1 max-h-32 overflow-auto">
                  {preview.reviews.slice(0, 30).map((row, i) => (
                    <li key={`${row.program}-${row.car}-${i}`}>{row.program} {row.car} {row.field ?? ""} — {row.note}</li>
                  ))}
                </ul>
              )}
              <div>
                <Label htmlFor="signed-off-by">Signed off by</Label>
                <Input id="signed-off-by" className="mt-1" value={signedOffBy} onChange={(e) => setSignedOffBy(e.target.value)} />
              </div>
              <Button type="button" size="sm" disabled={!signedOffBy.trim() || busy != null} onClick={() => void runApply()}>
                {busy === "apply" ? "Applying…" : "Apply signed-off changes"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
