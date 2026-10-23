import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CopyCarsButton } from "@/components/CopyCarsButton";
import { describeProgramCarUpdates } from "@shared/program-car-section";

export function ProgramPreviewDialog({
  open,
  title,
  preview,
  pending,
  onClose,
  onApply,
}: {
  open: boolean;
  title: string;
  preview: any;
  pending?: boolean;
  onClose: () => void;
  onApply: () => void;
}) {
  if (!preview) return null;
  const groups: [string, any[]][] = [
    ["Matched / writable", preview.matched ?? preview.writable ?? preview.rows ?? preview.remaining_active ?? []],
    ["Inactive (skipped)", preview.inactive ?? preview.skipped_inactive ?? preview.readonly_inactive ?? []],
    ["Not found", preview.not_found ?? []],
    ["Already in this program", preview.already_in_program ?? []],
    ["In another open program", preview.in_another_open_program ?? []],
    ["On rent (no Commitment)", preview.on_rent ?? []],
  ];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Preview only until you apply. Inactive cars are never written.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          {preview.needs_commitment != null && (
            <p>
              Needs Commitment: <strong>{preview.needs_commitment}</strong>
              {preview.in_multiple_programs != null && (
                <> · In 2+ programs: <strong>{preview.in_multiple_programs}</strong></>
              )}
            </p>
          )}
          {groups.map(([label, rows]) =>
            rows?.length ? (
              <div key={label}>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  <span>{label} ({rows.length})</span>
                  <CopyCarsButton
                    rows={rows}
                    lineOf={(row) => row.label ?? row.token ?? row.car ?? {
                      reporting_marks: row.reporting_marks,
                      car_number: row.car_number,
                    }}
                    className="normal-case tracking-normal"
                    testId={`button-copy-cars-program-preview-${label}`}
                  />
                </div>
                <ul className="text-xs max-h-28 overflow-auto border border-border rounded p-2 space-y-0.5">
                  {rows.slice(0, 40).map((r: any, i: number) => (
                    <li key={i}>
                      {r.label ?? r.token ?? r.car ?? [r.reporting_marks, r.car_number].filter(Boolean).join(" ") ?? r.railcar_id}
                      {r.in_multiple_warning || r.in_multiple_programs ? " · In 2 programs" : ""}
                    </li>
                  ))}
                  {rows.length > 40 && <li>… {rows.length - 40} more</li>}
                </ul>
              </div>
            ) : null,
          )}
          {Array.isArray(preview.items) && preview.items.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Field changes</div>
              <ul className="text-xs max-h-28 overflow-auto border border-border rounded p-2 space-y-1">
                {preview.items.slice(0, 40).map((item: { link_id?: number; label?: string; updates?: Record<string, unknown> }, i: number) => {
                  const lines = describeProgramCarUpdates(item?.updates);
                  return (
                    <li key={item?.link_id ?? i}>
                      <span className="font-medium">{item?.label ?? item?.link_id}</span>
                      {lines.length ? ` — ${lines.join("; ")}` : ""}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {Array.isArray(preview.kpi_delta) && preview.kpi_delta.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">KPI change</div>
              <ul className="text-xs max-h-28 overflow-auto border border-border rounded p-2">
                {preview.kpi_delta.slice(0, 20).map((d: any) => (
                  <li key={d.railcar_id}>
                    {d.car}: {d.before_title} → {d.after_title}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Back</Button>
            <Button onClick={onApply} disabled={pending || !preview.preview_token}>
              {pending ? "Applying…" : "Apply"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
