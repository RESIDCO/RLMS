import { useState } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiRequest, asRailcarList, railcarsQs } from "@/lib/queryClient";
import { useCanEdit } from "@/lib/AuthContext";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { confirmDelete } from "@/components/ConfirmActionDialog";
import ClearableSearchInput from "@/components/ClearableSearchInput";
import ProgramDocsPanel from "@/components/ProgramDocsPanel";
import { cn } from "@/lib/utils";
import { Download, Plus, Paperclip, UserMinus } from "lucide-react";
import {
  CATEGORY_BADGE,
  PROGRAM_CAR_DOC_CATEGORIES,
  PROGRAM_DOC_CATEGORIES,
  PROGRAM_ENTITIES,
  STATUS_BADGE,
  STATUS_LABEL,
  formatCustomField,
  type ProgramFieldDef,
  type ProgramStatus,
} from "@shared/programs";

type Program = {
  id: number;
  name: string;
  description: string | null;
  status: ProgramStatus;
  category_id: number | null;
  tags: string[] | null;
  entity: string | null;
  account_manager: string | null;
  status_narrative: string | null;
  percent_complete: number | null;
  target_completion_date: string | null;
  opened_date: string | null;
  closed_date: string | null;
  category: { id: number; name: string } | null;
  field_defs: ProgramFieldDef[];
};

type ProgramCar = {
  id: number;
  railcar_id: number;
  status: string | null;
  notes: string | null;
  joined_date: string | null;
  exited_date: string | null;
  rider_external_id_snapshot: string | null;
  shop_id: number | null;
  scrap_yard_id: number | null;
  repair_cost_total: number | null;
  custom_fields: Record<string, unknown>;
  doc_count: number;
  railcar: {
    id: number;
    car_number: string;
    reporting_marks: string | null;
    rider_external_id: string | null;
  } | null;
  shop: { id: number; name: string } | null;
};

async function downloadReport(url: string) {
  const res = await apiRequest("GET", url);
  const blob = await res.blob();
  const disp = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disp);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = match?.[1] ?? "RLMS_Program_Status_Report.xlsx";
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function ProgramDetailPage() {
  const [, params] = useRoute("/programs/:id");
  const id = Number(params?.id);
  const canEdit = useCanEdit();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [includeExited, setIncludeExited] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [docsFor, setDocsFor] = useState<ProgramCar | null>(null);
  const [tab, setTab] = useState("cars");

  const { data: program, isLoading, error } = useQuery<Program>({
    queryKey: ["/api/programs", id],
    queryFn: () => apiRequest("GET", `/api/programs/${id}`).then((r) => r.json()),
    enabled: Number.isFinite(id) && id > 0,
  });
  const carsKey = ["/api/programs", id, "cars", includeExited] as const;
  const { data: cars = [] } = useQuery<ProgramCar[]>({
    queryKey: carsKey,
    queryFn: () =>
      apiRequest("GET", `/api/programs/${id}/cars?include_exited=${includeExited ? "1" : "0"}`).then((r) => r.json()),
    enabled: Number.isFinite(id) && id > 0,
  });
  const { data: activity = [] } = useQuery<any[]>({
    queryKey: ["/api/programs", id, "activity"],
    queryFn: () => apiRequest("GET", `/api/programs/${id}/activity`).then((r) => r.json()),
    enabled: Number.isFinite(id) && id > 0 && tab === "activity",
  });
  const { data: shops = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/programs/shops"],
    queryFn: () => apiRequest("GET", "/api/programs/shops").then((r) => r.json()),
  });

  const patchProgram = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("PATCH", `/api/programs/${id}`, body).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/programs", id] }),
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const patchCar = useMutation({
    mutationFn: ({ linkId, body }: { linkId: number; body: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/programs/${id}/cars/${linkId}`, body).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: carsKey }),
  });

  const defs = program?.field_defs ?? [];
  const catName = program?.category?.name ?? "";

  if (isLoading) {
    return (
      <div className="p-8 text-sm text-muted-foreground">Loading program…</div>
    );
  }
  if (error || !program) {
    return (
      <div className="p-8 text-sm text-destructive">Program not found.</div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title={program.name}
        subtitle={catName}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadReport(`/api/programs/${id}/export?include_exited=${includeExited ? "1" : "0"}`)}
          >
            <Download className="h-4 w-4" /> Export Report
          </Button>
        }
      />
      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border", CATEGORY_BADGE[catName] ?? "bg-muted border-border")}>
            {catName || "Uncategorized"}
          </span>
          {(program.tags ?? []).map((t) => (
            <span key={t} className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">{t}</span>
          ))}
          {canEdit ? (
            <Select value={program.status} onValueChange={(v) => patchProgram.mutate({ status: v })}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["open", "on_hold", "complete"] as const).map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className={cn("text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border", STATUS_BADGE[program.status])}>
              {STATUS_LABEL[program.status]}
            </span>
          )}
        </div>

        <Textarea
          className="text-sm"
          rows={3}
          defaultValue={program.status_narrative ?? ""}
          readOnly={!canEdit}
          placeholder="Status narrative — the rolled-up note from the SUMMARY tab"
          onBlur={(e) => {
            if (!canEdit) return;
            const v = e.target.value;
            if (v !== (program.status_narrative ?? "")) patchProgram.mutate({ status_narrative: v });
          }}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
          <HeaderField label="Entity">
            <Select value={program.entity || "none"} onValueChange={(v) => canEdit && patchProgram.mutate({ entity: v === "none" ? null : v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {PROGRAM_ENTITIES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </HeaderField>
          <HeaderField label="Account manager">
            <Input
              className="h-8 text-xs"
              defaultValue={program.account_manager ?? ""}
              readOnly={!canEdit}
              onBlur={(e) => canEdit && patchProgram.mutate({ account_manager: e.target.value || null })}
            />
          </HeaderField>
          <HeaderField label="% Complete">
            <Input
              className="h-8 text-xs"
              type="number"
              defaultValue={program.percent_complete ?? ""}
              readOnly={!canEdit}
              onBlur={(e) => canEdit && patchProgram.mutate({ percent_complete: e.target.value })}
            />
          </HeaderField>
          <HeaderField label="Opened">
            <Input
              className="h-8 text-xs"
              type="date"
              defaultValue={program.opened_date?.slice(0, 10) ?? ""}
              readOnly={!canEdit}
              onBlur={(e) => canEdit && patchProgram.mutate({ opened_date: e.target.value || null })}
            />
          </HeaderField>
          <HeaderField label="Target">
            <Input
              className="h-8 text-xs"
              type="date"
              defaultValue={program.target_completion_date?.slice(0, 10) ?? ""}
              readOnly={!canEdit}
              onBlur={(e) => canEdit && patchProgram.mutate({ target_completion_date: e.target.value || null })}
            />
          </HeaderField>
          <HeaderField label="Closed">
            <Input
              className="h-8 text-xs"
              type="date"
              defaultValue={program.closed_date?.slice(0, 10) ?? ""}
              readOnly={!canEdit}
              onBlur={(e) => canEdit && patchProgram.mutate({ closed_date: e.target.value || null })}
            />
          </HeaderField>
        </div>
        {program.description && <p className="text-xs text-muted-foreground">{program.description}</p>}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="cars">Cars in Program</TabsTrigger>
            <TabsTrigger value="docs">Documents</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="cars" className="mt-4">
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              {canEdit && (
                <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add cars</Button>
              )}
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={includeExited} onCheckedChange={(v) => setIncludeExited(v === true)} />
                Show exited cars
              </label>
              <span className="text-xs text-muted-foreground ml-auto">{cars.length} rows</span>
            </div>
            <div className="rounded-xl border border-card-border bg-card overflow-auto">
              <table className="w-full text-xs min-w-[900px]">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/40 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-2">Car</th>
                    <th className="text-left px-2 py-2">Status</th>
                    <th className="text-left px-2 py-2">OL at entry</th>
                    <th className="text-left px-2 py-2">OL now</th>
                    <th className="text-left px-2 py-2">Shop</th>
                    <th className="text-right px-2 py-2">Repair $</th>
                    {defs.map((d) => (
                      <th key={d.field_key} className="text-left px-2 py-2 whitespace-nowrap">{d.label}</th>
                    ))}
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody>
                  {cars.map((c) => {
                    const label = [c.railcar?.reporting_marks, c.railcar?.car_number].filter(Boolean).join(" ");
                    const exited = Boolean(c.exited_date);
                    return (
                      <tr key={c.id} className={cn("border-t border-border/50", exited && "opacity-60")}>
                        <td className="px-2 py-1.5 font-mono whitespace-nowrap">
                          {label || `#${c.railcar_id}`}
                          {exited && <div className="text-[10px] text-muted-foreground">Exited {String(c.exited_date).slice(0, 10)}</div>}
                        </td>
                        <td className="px-2 py-1">
                          <CellInput
                            readOnly={!canEdit || exited}
                            value={c.status ?? ""}
                            onSave={(v) => patchCar.mutate({ linkId: c.id, body: { status: v } })}
                          />
                        </td>
                        <td className="px-2 py-1.5 font-mono">{c.rider_external_id_snapshot ?? "—"}</td>
                        <td className="px-2 py-1.5 font-mono">{c.railcar?.rider_external_id ?? "—"}</td>
                        <td className="px-2 py-1">
                          {canEdit && !exited ? (
                            <select
                              className="h-7 bg-transparent border border-border rounded px-1 max-w-[140px]"
                              value={c.shop_id ?? ""}
                              onChange={(e) => patchCar.mutate({ linkId: c.id, body: { shop_id: e.target.value || null } })}
                            >
                              <option value="">—</option>
                              {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          ) : (
                            c.shop?.name ?? "—"
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <CellInput
                            readOnly={!canEdit || exited}
                            className="text-right"
                            value={c.repair_cost_total != null ? String(c.repair_cost_total) : ""}
                            onSave={(v) => patchCar.mutate({ linkId: c.id, body: { repair_cost_total: v } })}
                          />
                        </td>
                        {defs.map((d) => (
                          <td key={d.field_key} className="px-2 py-1">
                            <CustomCell
                              def={d}
                              value={c.custom_fields?.[d.field_key]}
                              readOnly={!canEdit || exited}
                              onSave={(v) => patchCar.mutate({ linkId: c.id, body: { custom_fields: { [d.field_key]: v } } })}
                            />
                          </td>
                        ))}
                        <td className="px-1 py-1 whitespace-nowrap">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            aria-label={`Attachments for ${label}`}
                            onClick={() => setDocsFor(c)}
                          >
                            <Paperclip className="h-3.5 w-3.5" />
                            {c.doc_count > 0 && <span className="text-[9px] ml-0.5">{c.doc_count}</span>}
                          </Button>
                          {canEdit && !exited && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              aria-label={`Remove ${label} from program`}
                              onClick={async () => {
                                const ok = await confirmDelete({
                                  title: `Remove ${label} from ${program.name}?`,
                                  description: "The car stays in program history with an exit date. It is not deleted.",
                                  confirmLabel: "Remove from program",
                                });
                                if (!ok) return;
                                await apiRequest("DELETE", `/api/programs/${id}/cars/${c.id}`);
                                qc.invalidateQueries({ queryKey: carsKey });
                                qc.invalidateQueries({ queryKey: ["/api/programs", id, "activity"] });
                              }}
                            >
                              <UserMinus className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {cars.length === 0 && (
                    <tr><td colSpan={8 + defs.length} className="px-3 py-10 text-center text-muted-foreground italic">No cars in this program yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
          <TabsContent value="docs" className="mt-4">
            <ProgramDocsPanel
              listUrl={`/api/programs/${id}/documents`}
              uploadUrl={`/api/programs/${id}/documents`}
              deleteUrl={(docId) => `/api/programs/${id}/documents/${docId}`}
              categories={[...PROGRAM_DOC_CATEGORIES]}
            />
          </TabsContent>
          <TabsContent value="activity" className="mt-4">
            <ul className="space-y-2">
              {activity.map((a) => (
                <li key={a.id} className="text-xs border-l-2 border-primary/40 pl-3 py-1">
                  <div className="text-muted-foreground font-mono-num">{new Date(a.created_at).toLocaleString()}</div>
                  <div>
                    {a.action.replace(/_/g, " ")}
                    {a.railcar ? ` · ${[a.railcar.reporting_marks, a.railcar.car_number].filter(Boolean).join(" ")}` : ""}
                  </div>
                </li>
              ))}
              {activity.length === 0 && <p className="text-xs text-muted-foreground italic">No activity yet.</p>}
            </ul>
          </TabsContent>
        </Tabs>
      </div>

      <AddCarsDialog
        open={addOpen}
        programId={id}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          setAddOpen(false);
          qc.invalidateQueries({ queryKey: carsKey });
          qc.invalidateQueries({ queryKey: ["/api/programs"] });
        }}
      />

      <Sheet open={!!docsFor} onOpenChange={(o) => !o && setDocsFor(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {[docsFor?.railcar?.reporting_marks, docsFor?.railcar?.car_number].filter(Boolean).join(" ")} attachments
            </SheetTitle>
          </SheetHeader>
          {docsFor && (
            <div className="mt-4">
              <ProgramDocsPanel
                compact
                listUrl={`/api/programs/${id}/cars/${docsFor.id}/documents`}
                uploadUrl={`/api/programs/${id}/cars/${docsFor.id}/documents`}
                deleteUrl={(docId) => `/api/programs/${id}/cars/${docsFor.id}/documents/${docId}`}
                categories={[...PROGRAM_CAR_DOC_CATEGORIES]}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function HeaderField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}

function CellInput({
  value,
  onSave,
  readOnly,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  readOnly?: boolean;
  className?: string;
}) {
  const [v, setV] = useState(value);
  return (
    <input
      className={cn("h-7 w-full bg-transparent border border-transparent hover:border-border rounded px-1", className)}
      value={v}
      readOnly={readOnly}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
    />
  );
}

function CustomCell({
  def,
  value,
  onSave,
  readOnly,
}: {
  def: ProgramFieldDef;
  value: unknown;
  onSave: (v: unknown) => void;
  readOnly?: boolean;
}) {
  if (def.field_type === "boolean") {
    const on = value === true || value === "true";
    return (
      <Checkbox
        checked={on}
        disabled={readOnly}
        onCheckedChange={(c) => onSave(c === true)}
      />
    );
  }
  if (def.field_type === "select") {
    return (
      <select
        className="h-7 bg-transparent border border-border rounded px-1"
        value={value == null ? "" : String(value)}
        disabled={readOnly}
        onChange={(e) => onSave(e.target.value || null)}
      >
        <option value="">—</option>
        {(def.select_options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (readOnly) return <span>{formatCustomField(value, def.field_type) || "—"}</span>;
  const str = value == null || value === "" ? "" : String(value);
  return (
    <CellInput
      value={str}
      onSave={(v) => onSave(def.field_type === "number" || def.field_type === "currency" ? (v === "" ? null : Number(v)) : v || null)}
    />
  );
}

function AddCarsDialog({
  open,
  programId,
  onClose,
  onAdded,
}: {
  open: boolean;
  programId: number;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const { data } = useQuery({
    queryKey: ["/api/railcars", "program-add", q],
    queryFn: () => apiGet(railcarsQs({ search: q || undefined, all: 1, active: "all", pageSize: 80 })),
    enabled: open,
  });
  const rows = asRailcarList<any>(data as any);

  async function add() {
    const ids = [...picked];
    if (!ids.length) return;
    try {
      const res = await apiRequest("POST", `/api/programs/${programId}/cars`, { railcar_ids: ids });
      const out = await res.json();
      toast({ title: `${(out.added ?? []).length} car(s) added` });
      setPicked(new Set());
      onAdded();
    } catch (e: any) {
      toast({ title: "Could not add cars", description: e.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Add cars</DialogTitle></DialogHeader>
        <ClearableSearchInput placeholder="Search car number…" value={q} onChange={setQ} inputClassName="h-9" />
        <div className="max-h-72 overflow-auto border rounded-md">
          <table className="w-full text-xs">
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-t border-border/40">
                  <td className="px-2 py-1.5 w-8">
                    <Checkbox
                      checked={picked.has(r.id)}
                      onCheckedChange={() => {
                        setPicked((prev) => {
                          const n = new Set(prev);
                          if (n.has(r.id)) n.delete(r.id);
                          else n.add(r.id);
                          return n;
                        });
                      }}
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono">{[r.reporting_marks, r.car_number].filter(Boolean).join(" ")}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{r.lessee_name ?? r.rider_external_id ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={add} disabled={!picked.size}>Add {picked.size || ""}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
