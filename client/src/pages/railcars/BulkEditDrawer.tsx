import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { navigateHash } from "@/lib/hash-location";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { RENT_STOP_REASON_CHOICES, rentStopReasonFields } from "@shared/rent-stops";
import { ADD_NOTE_PLACEHOLDER } from "@/components/AddNoteField";
import { invalidateFleetQueries } from "@/lib/fleetQueryRefresh";
import { offerUndoToast } from "@/lib/undo";
import { markSearchRefresh } from "@/lib/searchState";
import { useToast } from "@/hooks/use-toast";
import { CopyCarsButton } from "@/components/CopyCarsButton";

type PreviewRow = {
  car: string;
  field: string;
  before: unknown;
  after: unknown;
  status: "ok" | "warn" | "reject";
  reason: string;
};

export function BulkEditDrawer({
  railcarIds,
  onClose,
}: {
  railcarIds: number[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [tag, setTag] = useState("");
  const [stopDate, setStopDate] = useState("");
  const [stopType, setStopType] = useState<"Off rent" | "Abatement">("Off rent");
  const [stopReason, setStopReason] = useState<string>("other");
  const [stopDetail, setStopDetail] = useState("");
  const [scrapped, setScrapped] = useState("");
  const [umler, setUmler] = useState("");
  const [buyer, setBuyer] = useState("");
  const [saleDate, setSaleDate] = useState("");
  const [preview, setPreview] = useState<{ preview_token: string; preview_hash: string; rows: PreviewRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [importField, setImportField] = useState<"off_rent_date" | "cut_up_date" | "note" | "tag" | "umler_status">("cut_up_date");

  function ops() {
    const out: Record<string, unknown>[] = [];
    if (note.trim()) out.push({ op: "add_note", note: note.trim() });
    if (tag.trim()) out.push({ op: "add_tag", value: tag.trim() });
    if (stopDate) {
      const fields = rentStopReasonFields({ reason: stopReason, reason_other: stopDetail, note: stopDetail });
      out.push({
        op: "rent_stop",
        type: stopType,
        stop_date: stopDate,
        reason: fields.reason,
        reason_other: fields.reason_other,
        note: fields.note,
      });
    }
    if (scrapped) out.push({ op: "set_scrapped_at", value: scrapped });
    if (umler) out.push({ op: "set_umler_status", value: umler });
    if (buyer) out.push({ op: "mark_sold", buyer, effective_date: saleDate || undefined });
    return out;
  }

  async function runPreview() {
    setBusy(true);
    try {
      const body = await apiRequest("POST", "/api/railcars/bulk/preview", {
        railcar_ids: railcarIds,
        ops: ops(),
      }).then((r) => r.json());
      setPreview(body);
    } catch (e: any) {
      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview) return;
    setBusy(true);
    try {
      const body = await apiRequest("POST", "/api/railcars/bulk/apply", {
        preview_token: preview.preview_token,
        preview_hash: preview.preview_hash,
      }).then((r) => r.json());
      offerUndoToast(body);
      markSearchRefresh();
      await queryClient.invalidateQueries();
      void invalidateFleetQueries(queryClient);
      onClose();
    } catch (e: any) {
      toast({ title: "Apply failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const okCount = preview?.rows.filter((r) => r.status !== "reject").length ?? 0;

  return (
    <div className="fixed right-0 top-0 h-full w-[420px] border-l bg-background z-50 overflow-auto p-4 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">Bulk edit {railcarIds.length} cars</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      <label className="text-xs text-muted-foreground">Note</label>
      <Textarea className="mb-2" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={ADD_NOTE_PLACEHOLDER} />
      <label className="text-xs text-muted-foreground">Tag</label>
      <Input className="mb-2" value={tag} onChange={(e) => setTag(e.target.value)} />
      <div className="flex gap-2 mb-2">
        <select className="h-8 border rounded px-2 text-xs" value={stopType} onChange={(e) => setStopType(e.target.value as "Off rent" | "Abatement")}>
          <option>Off rent</option>
          <option>Abatement</option>
        </select>
        <Input type="date" value={stopDate} onChange={(e) => setStopDate(e.target.value)} />
      </div>
      <label className="text-xs text-muted-foreground">Rent stop reason</label>
      <select className="h-8 border rounded px-2 text-xs w-full mb-2" value={stopReason} onChange={(e) => setStopReason(e.target.value)}>
        {RENT_STOP_REASON_CHOICES.map((item) => (
          <option key={item} value={item}>{item}</option>
        ))}
      </select>
      <label className="text-xs text-muted-foreground">Rent stop reason detail</label>
      <Textarea
        className="mb-2"
        rows={2}
        value={stopDetail}
        onChange={(e) => setStopDetail(e.target.value)}
        placeholder="Shown on the stop. Scrap uses this as the note."
      />
      <Button
        size="sm"
        variant="outline"
        className="mb-3"
        onClick={() => navigateHash("/rent-stops/bulk?action=off_rent")}
      >
        Different dates per car…
      </Button>
      <label className="text-xs text-muted-foreground">Cut-up / scrapped_at</label>
      <Input className="mb-2" type="date" value={scrapped} onChange={(e) => setScrapped(e.target.value)} />
      <label className="text-xs text-muted-foreground">UMLER</label>
      <select className="h-8 border rounded px-2 text-xs w-full mb-2" value={umler} onChange={(e) => setUmler(e.target.value)}>
        <option value="">—</option>
        <option value="delete_requested">delete_requested</option>
        <option value="deleted">deleted</option>
      </select>
      <label className="text-xs text-muted-foreground">Import CSV (car,value)</label>
      <div className="flex gap-2 mb-2">
        <select className="h-8 border rounded px-2 text-xs" value={importField} onChange={(e) => setImportField(e.target.value as any)}>
          <option value="cut_up_date">cut-up date</option>
          <option value="off_rent_date">off-rent date</option>
          <option value="note">note</option>
          <option value="tag">tag</option>
          <option value="umler_status">UMLER</option>
        </select>
        <Input
          type="file"
          accept=".csv,.xlsx,.xls"
          className="text-xs"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const text = await file.text();
            const lines = text.split(/\r?\n/).filter((l) => l.trim());
            const mapped: { car: string; field: string; value: string }[] = [];
            for (const line of lines.slice(1)) {
              const [car, value] = line.split(",");
              if (car && value) mapped.push({ car: car.trim(), field: importField, value: value.trim() });
            }
            if (importField === "note") setNote(mapped.map((m) => m.value).filter(Boolean)[0] ?? note);
            if (importField === "tag") setTag(mapped.map((m) => m.value).filter(Boolean)[0] ?? tag);
            if (importField === "cut_up_date") setScrapped(mapped[0]?.value ?? scrapped);
            if (importField === "umler_status") setUmler(mapped[0]?.value ?? umler);
            toast({ title: `Mapped ${mapped.length} import rows`, description: "Preview still required before apply." });
          }}
        />
      </div>
      <label className="text-xs text-muted-foreground">Mark Sold buyer + date</label>
      <div className="flex gap-2 mb-3">
        <Input placeholder="Buyer" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
        <Input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
      </div>
      <Button size="sm" onClick={() => void runPreview()} disabled={busy || !ops().length}>Preview</Button>
      {preview ? (
        <div className="mt-3">
          <div className="mb-2 flex justify-end">
            <CopyCarsButton
              rows={preview.rows}
              lineOf={(row) => row.car}
              testId="button-copy-cars-bulk-edit"
            />
          </div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th>Car</th><th>Field</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r, i) => (
                <tr key={i} className={r.status === "reject" ? "text-destructive" : r.status === "warn" ? "text-amber-700" : ""}>
                  <td className="font-mono">{r.car}</td>
                  <td>{r.field}</td>
                  <td title={r.reason}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button className="mt-3" size="sm" disabled={busy || okCount === 0} onClick={() => void apply()}>
            Apply {okCount} changes
          </Button>
        </div>
      ) : null}
    </div>
  );
}
