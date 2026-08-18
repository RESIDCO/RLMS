import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useCanEdit } from "@/lib/AuthContext";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { confirmDelete, confirmSave } from "@/components/ConfirmActionDialog";
import ProgramDocsPanel from "@/components/ProgramDocsPanel";
import ProgramCarPicker, { type PickedCar } from "@/components/ProgramCarPicker";
import ShopCombobox, { type ShopOption } from "@/components/ShopCombobox";
import { cn } from "@/lib/utils";
import { Download, History, Plus, Paperclip, UserMinus } from "lucide-react";
import {
  CATEGORY_BADGE,
  FLAG_TAG_HINTS,
  PROGRAM_CAR_DOC_CATEGORIES,
  PROGRAM_DOC_CATEGORIES,
  PROGRAM_ENTITIES,
  STATUS_BADGE,
  STATUS_LABEL,
  formatCustomField,
  type ProgramFieldDef,
  type ProgramStatus,
} from "@shared/programs";

type Category = { id: number; name: string };
type StatusOption = { id: number; value: string; sort_order: number };

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
  updated_at?: string;
  category: { id: number; name: string } | null;
  field_defs: ProgramFieldDef[];
};

type ProgramCar = {
  id: number;
  railcar_id: number;
  status: string | null;
  notes: string | null;
  flag_tag: string | null;
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

type HeaderDraft = {
  entity: string;
  account_manager: string;
  description: string;
  status_narrative: string;
  percent_complete: string;
  opened_date: string;
  target_completion_date: string;
  closed_date: string;
  tags: string;
  category_id: string;
};

function headerFrom(p: Program): HeaderDraft {
  return {
    entity: p.entity ?? "",
    account_manager: p.account_manager ?? "",
    description: p.description ?? "",
    status_narrative: p.status_narrative ?? "",
    percent_complete: p.percent_complete != null ? String(p.percent_complete) : "",
    opened_date: p.opened_date?.slice(0, 10) ?? "",
    target_completion_date: p.target_completion_date?.slice(0, 10) ?? "",
    closed_date: p.closed_date?.slice(0, 10) ?? "",
    tags: (p.tags ?? []).join(", "),
    category_id: p.category_id != null ? String(p.category_id) : "",
  };
}

function carLabelOf(c: ProgramCar): string {
  return [c.railcar?.reporting_marks, c.railcar?.car_number].filter(Boolean).join(" ") || `#${c.railcar_id}`;
}

function formatActivity(a: any): string {
  const car = a.railcar ? [a.railcar.reporting_marks, a.railcar.car_number].filter(Boolean).join(" ") : "";
  const action = String(a.action ?? "").replace(/_/g, " ");
  const from = a.detail?.from;
  const to = a.detail?.to;
  const change = from != null || to != null ? ` · ${from || "—"} → ${to || "—"}` : "";
  return `${action}${car ? ` · ${car}` : ""}${change}`;
}

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
  const [historyFor, setHistoryFor] = useState<ProgramCar | null>(null);
  const [tab, setTab] = useState("cars");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [header, setHeader] = useState<HeaderDraft | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

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
    enabled: Number.isFinite(id) && id > 0 && (tab === "activity" || !!historyFor),
  });
  const { data: shops = [] } = useQuery<ShopOption[]>({
    queryKey: ["/api/programs/shops"],
    queryFn: () => apiRequest("GET", "/api/programs/shops").then((r) => r.json()),
  });
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/programs/categories"],
    queryFn: () => apiRequest("GET", "/api/programs/categories").then((r) => r.json()),
  });
  const { data: statusOptions = [] } = useQuery<StatusOption[]>({
    queryKey: ["/api/programs/status-options", program?.category_id],
    queryFn: () =>
      apiRequest("GET", `/api/programs/status-options?category_id=${program!.category_id}`).then((r) => r.json()),
    enabled: !!program?.category_id,
  });
  const { data: carActivity = [] } = useQuery<any[]>({
    queryKey: ["/api/programs", id, "activity", historyFor?.id],
    queryFn: () =>
      apiRequest("GET", `/api/programs/${id}/activity?program_car_id=${historyFor!.id}`).then((r) => r.json()),
    enabled: !!historyFor,
  });

  useEffect(() => {
    if (program) setHeader(headerFrom(program));
  }, [program?.id, program?.updated_at]);

  const dirty = useMemo(() => {
    if (!program || !header) return false;
    return JSON.stringify(header) !== JSON.stringify(headerFrom(program));
  }, [program, header]);

  const patchProgram = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("PATCH", `/api/programs/${id}`, body).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/programs", id] });
      qc.invalidateQueries({ queryKey: ["/api/programs"] });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const patchCar = useMutation({
    mutationFn: ({ linkId, body }: { linkId: number; body: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/programs/${id}/cars/${linkId}`, body).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: carsKey });
      qc.invalidateQueries({ queryKey: ["/api/programs", id, "activity"] });
    },
  });

  const defs = program?.field_defs ?? [];
  const catName = program?.category?.name ?? "";

  async function saveHeader() {
    if (!header || !canEdit) return;
    await patchProgram.mutateAsync({
      entity: header.entity || null,
      account_manager: header.account_manager.trim() || null,
      description: header.description.trim() || null,
      status_narrative: header.status_narrative,
      percent_complete: header.percent_complete,
      opened_date: header.opened_date || null,
      target_completion_date: header.target_completion_date || null,
      closed_date: header.closed_date || null,
      tags: header.tags.split(",").map((t) => t.trim()).filter(Boolean),
      category_id: header.category_id ? Number(header.category_id) : null,
    });
    setSavedFlash(true);
    toast({ title: "Saved" });
    window.setTimeout(() => setSavedFlash(false), 2500);
  }

  function toggle(linkId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(linkId)) next.delete(linkId);
      else next.add(linkId);
      return next;
    });
  }

  function toggleAll() {
    const openIds = cars.filter((c) => !c.exited_date).map((c) => c.id);
    setSelected((prev) => {
      if (openIds.length && openIds.every((id) => prev.has(id))) return new Set();
      return new Set(openIds);
    });
  }

  if (isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading program…</div>;
  }
  if (error || !program || !header) {
    return <div className="p-8 text-sm text-destructive">Program not found.</div>;
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title={program.name}
        subtitle={catName}
        actions={
          <div className="flex items-center gap-2">
            {canEdit && dirty && (
              <Button size="sm" onClick={saveHeader} disabled={patchProgram.isPending}>
                {patchProgram.isPending ? "Saving…" : "Save"}
              </Button>
            )}
            {savedFlash && !dirty && (
              <span className="text-xs text-emerald-400">Saved</span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadReport(`/api/programs/${id}/export?include_exited=${includeExited ? "1" : "0"}`)}
            >
              <Download className="h-4 w-4" /> Export Report
            </Button>
          </div>
        }
      />
      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border", CATEGORY_BADGE[catName] ?? "bg-muted border-border")}>
            {catName || "Uncategorized"}
          </span>
          {canEdit ? (
            <Select value={program.status} onValueChange={(v) => patchProgram.mutate({ status: v }, { onSuccess: () => toast({ title: "Saved" }) })}>
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
          value={header.status_narrative}
          readOnly={!canEdit}
          placeholder="Status narrative — the rolled-up note from the SUMMARY tab"
          onChange={(e) => setHeader({ ...header, status_narrative: e.target.value })}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
          <HeaderField label="Category">
            <Select value={header.category_id || "none"} onValueChange={(v) => setHeader({ ...header, category_id: v === "none" ? "" : v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </HeaderField>
          <HeaderField label="Entity">
            <Select value={header.entity || "none"} onValueChange={(v) => setHeader({ ...header, entity: v === "none" ? "" : v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {PROGRAM_ENTITIES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </HeaderField>
          <HeaderField label="Account manager">
            <Input className="h-8 text-xs" value={header.account_manager} readOnly={!canEdit} onChange={(e) => setHeader({ ...header, account_manager: e.target.value })} />
          </HeaderField>
          <HeaderField label="% Complete">
            <Input className="h-8 text-xs" type="number" value={header.percent_complete} readOnly={!canEdit} onChange={(e) => setHeader({ ...header, percent_complete: e.target.value })} />
          </HeaderField>
          <HeaderField label="Opened">
            <Input className="h-8 text-xs" type="date" value={header.opened_date} readOnly={!canEdit} onChange={(e) => setHeader({ ...header, opened_date: e.target.value })} />
          </HeaderField>
          <HeaderField label="Target">
            <Input className="h-8 text-xs" type="date" value={header.target_completion_date} readOnly={!canEdit} onChange={(e) => setHeader({ ...header, target_completion_date: e.target.value })} />
          </HeaderField>
          <HeaderField label="Closed">
            <Input className="h-8 text-xs" type="date" value={header.closed_date} readOnly={!canEdit} onChange={(e) => setHeader({ ...header, closed_date: e.target.value })} />
          </HeaderField>
          <HeaderField label="Tags">
            <Input className="h-8 text-xs" value={header.tags} readOnly={!canEdit} onChange={(e) => setHeader({ ...header, tags: e.target.value })} placeholder="NLD, Sale" />
          </HeaderField>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Description</div>
          <Textarea
            className="text-xs"
            rows={2}
            value={header.description}
            readOnly={!canEdit}
            onChange={(e) => setHeader({ ...header, description: e.target.value })}
          />
        </div>
        {canEdit && dirty && (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={saveHeader} disabled={patchProgram.isPending}>
              {patchProgram.isPending ? "Saving…" : "Save header"}
            </Button>
            <span className="text-xs text-muted-foreground">Unsaved header changes</span>
          </div>
        )}

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
            {canEdit && selected.size > 0 && (
              <BulkEditBar
                count={selected.size}
                shops={shops}
                statusOptions={statusOptions}
                defs={defs}
                onApply={async (label, updates) => {
                  const ok = await confirmSave({
                    title: `Set ${label} for ${selected.size} selected car${selected.size === 1 ? "" : "s"}?`,
                    confirmLabel: "Apply",
                  });
                  if (!ok) return;
                  await apiRequest("POST", `/api/programs/${id}/cars/bulk`, {
                    link_ids: Array.from(selected),
                    updates,
                  });
                  setSelected(new Set());
                  qc.invalidateQueries({ queryKey: carsKey });
                  qc.invalidateQueries({ queryKey: ["/api/programs", id, "activity"] });
                  toast({ title: `Updated ${selected.size} car${selected.size === 1 ? "" : "s"}` });
                }}
              />
            )}
            <div className="rounded-xl border border-card-border bg-card overflow-auto">
              <table className="w-full text-xs min-w-[1100px]">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/40 sticky top-0">
                  <tr>
                    {canEdit && (
                      <th className="w-8 px-2 py-2">
                        <Checkbox
                          checked={cars.filter((c) => !c.exited_date).length > 0 && cars.filter((c) => !c.exited_date).every((c) => selected.has(c.id))}
                          onCheckedChange={toggleAll}
                          aria-label="Select all cars"
                        />
                      </th>
                    )}
                    <th className="text-left px-2 py-2">Car</th>
                    <th className="text-left px-2 py-2">Status</th>
                    <th className="text-left px-2 py-2">Flag</th>
                    <th className="text-left px-2 py-2">Comment</th>
                    <th className="text-left px-2 py-2">OL at entry</th>
                    <th className="text-left px-2 py-2">OL now</th>
                    <th className="text-left px-2 py-2">Shop</th>
                    <th className="text-right px-2 py-2">Repair $</th>
                    {defs.map((d) => (
                      <th key={d.field_key} className="text-left px-2 py-2 whitespace-nowrap">{d.label}</th>
                    ))}
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {cars.map((c) => {
                    const label = carLabelOf(c);
                    const exited = Boolean(c.exited_date);
                    return (
                      <tr key={c.id} className={cn("border-t border-border/50", exited && "opacity-60")}>
                        {canEdit && (
                          <td className="px-2 py-1">
                            {!exited && (
                              <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} aria-label={`Select ${label}`} />
                            )}
                          </td>
                        )}
                        <td className="px-2 py-1.5 font-mono whitespace-nowrap">
                          {label}
                          {exited && <div className="text-[10px] text-muted-foreground">Exited {String(c.exited_date).slice(0, 10)}</div>}
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-1">
                            <StatusCell
                              value={c.status ?? ""}
                              options={statusOptions}
                              readOnly={!canEdit || exited}
                              onSave={(v) => patchCar.mutate({ linkId: c.id, body: { status: v } })}
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 shrink-0"
                              aria-label={`Status history for ${label}`}
                              onClick={() => setHistoryFor(c)}
                            >
                              <History className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          <FlagCell
                            value={c.flag_tag ?? ""}
                            readOnly={!canEdit || exited}
                            onSave={(v) => patchCar.mutate({ linkId: c.id, body: { flag_tag: v } })}
                          />
                        </td>
                        <td className="px-2 py-1 min-w-[140px]">
                          <CellInput
                            readOnly={!canEdit || exited}
                            value={c.notes ?? ""}
                            onSave={(v) => patchCar.mutate({ linkId: c.id, body: { notes: v } })}
                          />
                        </td>
                        <td className="px-2 py-1.5 font-mono">{c.rider_external_id_snapshot ?? "—"}</td>
                        <td className="px-2 py-1.5 font-mono">{c.railcar?.rider_external_id ?? "—"}</td>
                        <td className="px-2 py-1">
                          {canEdit && !exited ? (
                            <ShopCombobox
                              compact
                              shops={shops}
                              value={c.shop_id}
                              onChange={(shopId) => patchCar.mutate({ linkId: c.id, body: { shop_id: shopId } })}
                            />
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
                    <tr><td colSpan={10 + defs.length} className="px-3 py-10 text-center text-muted-foreground italic">No cars in this program yet.</td></tr>
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
            <ActivityList rows={activity} />
          </TabsContent>
        </Tabs>
      </div>

      <datalist id="program-flag-hints">
        {FLAG_TAG_HINTS.map((h) => <option key={h} value={h} />)}
      </datalist>
      <AddCarsDialog
        open={addOpen}
        programId={id}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          setAddOpen(false);
          qc.invalidateQueries({ queryKey: carsKey });
          qc.invalidateQueries({ queryKey: ["/api/programs"] });
          qc.invalidateQueries({ queryKey: ["/api/programs", id, "activity"] });
        }}
      />

      <Sheet open={!!docsFor} onOpenChange={(o) => !o && setDocsFor(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {docsFor ? carLabelOf(docsFor) : ""} attachments
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

      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{historyFor ? carLabelOf(historyFor) : ""} status history</DialogTitle>
            <DialogDescription>Newest first. Current status is the latest value on the car row.</DialogDescription>
          </DialogHeader>
          <ActivityList
            rows={(carActivity as any[]).filter((a) => a.action === "status_change")}
            empty="No status changes recorded for this car yet."
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ActivityList({ rows, empty }: { rows: any[]; empty?: string }) {
  return (
    <ul className="space-y-2">
      {rows.map((a) => (
        <li key={a.id} className="text-xs border-l-2 border-primary/40 pl-3 py-1">
          <div className="text-muted-foreground font-mono-num">{new Date(a.created_at).toLocaleString()}</div>
          <div>{formatActivity(a)}</div>
        </li>
      ))}
      {rows.length === 0 && <p className="text-xs text-muted-foreground italic">{empty ?? "No activity yet."}</p>}
    </ul>
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
  useEffect(() => { setV(value); }, [value]);
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

function FlagCell({ value, onSave, readOnly }: { value: string; onSave: (v: string) => void; readOnly?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <input
        className="h-7 w-full bg-transparent border border-transparent hover:border-border rounded px-1"
        list="program-flag-hints"
        value={v}
        readOnly={readOnly}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onSave(v)}
      />
  );
}

function StatusCell({
  value,
  options,
  onSave,
  readOnly,
}: {
  value: string;
  options: StatusOption[];
  onSave: (v: string) => void;
  readOnly?: boolean;
}) {
  const [custom, setCustom] = useState(false);
  const inList = !value || options.some((o) => o.value === value);
  const selectValue = custom ? "__custom__" : (inList ? (value || "__none__") : "__current__");
  if (readOnly) return <span>{value || "—"}</span>;
  if (custom) {
    return (
      <input
        autoFocus
        className="h-7 w-full min-w-[120px] bg-transparent border border-border rounded px-1"
        defaultValue={inList ? "" : value}
        placeholder="Custom status"
        onBlur={(e) => {
          const v = e.target.value.trim();
          setCustom(false);
          if (v && v !== value) onSave(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setCustom(false);
        }}
      />
    );
  }
  return (
    <select
      className="h-7 bg-transparent border border-border rounded px-1 max-w-[200px]"
      value={selectValue}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__custom__") {
          setCustom(true);
          return;
        }
        if (v === "__none__") onSave("");
        else if (v !== "__current__") onSave(v);
      }}
    >
      <option value="__none__">—</option>
      {!inList && value && <option value="__current__">{value}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.value}>{o.value}</option>
      ))}
      <option value="__custom__">Custom…</option>
    </select>
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

function BulkEditBar({
  count,
  shops,
  statusOptions,
  defs,
  onApply,
}: {
  count: number;
  shops: ShopOption[];
  statusOptions: StatusOption[];
  defs: ProgramFieldDef[];
  onApply: (label: string, updates: Record<string, unknown>) => Promise<void>;
}) {
  const [field, setField] = useState("shop_id");
  const [text, setText] = useState("");
  const [shopId, setShopId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const shopName = shops.find((s) => s.id === shopId)?.name ?? "";

  const fieldOptions = [
    { value: "shop_id", label: "Shop" },
    { value: "status", label: "Status" },
    { value: "flag_tag", label: "Flag" },
    { value: "notes", label: "Comment" },
    { value: "repair_cost_total", label: "Repair $" },
    ...defs.map((d) => ({ value: `custom:${d.field_key}`, label: d.label })),
  ];

  async function apply() {
    let updates: Record<string, unknown> = {};
    let label = fieldOptions.find((f) => f.value === field)?.label ?? field;
    if (field === "shop_id") {
      updates = { shop_id: shopId };
      label = `Shop to '${shopName || "—"}'`;
    } else if (field === "status") {
      updates = { status: text };
      label = `Status to '${text || "—"}'`;
    } else if (field === "flag_tag") {
      updates = { flag_tag: text };
      label = `Flag to '${text || "—"}'`;
    } else if (field === "notes") {
      updates = { notes: text };
      label = "Comment";
    } else if (field === "repair_cost_total") {
      updates = { repair_cost_total: text };
      label = `Repair $ to '${text || "—"}'`;
    } else if (field.startsWith("custom:")) {
      const key = field.slice(7);
      const def = defs.find((d) => d.field_key === key);
      let v: unknown = text;
      if (def?.field_type === "boolean") v = text === "true";
      else if (def?.field_type === "number" || def?.field_type === "currency") v = text === "" ? null : Number(text);
      updates = { custom_fields: { [key]: v } };
      label = `${def?.label ?? key} to '${text}'`;
    }
    setPending(true);
    try {
      await onApply(label, updates);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2.5 rounded-lg border border-primary/30 bg-primary/5">
      <span className="text-sm font-medium">{count} selected</span>
      <Select value={field} onValueChange={(v) => { setField(v); setText(""); }}>
        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {fieldOptions.map((f) => (
            <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {field === "shop_id" ? (
        <ShopCombobox shops={shops} value={shopId} onChange={setShopId} compact />
      ) : field === "status" ? (
        <select
          className="h-8 bg-background border border-border rounded px-2 text-xs max-w-[220px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
        >
          <option value="">—</option>
          {statusOptions.map((o) => (
            <option key={o.id} value={o.value}>{o.value}</option>
          ))}
        </select>
      ) : field === "flag_tag" ? (
        <input
          className="h-8 border border-border rounded px-2 text-xs bg-background"
          list="program-flag-hints"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Watch, Priority…"
        />
      ) : (
        <Input className="h-8 w-44 text-xs" value={text} onChange={(e) => setText(e.target.value)} />
      )}
      <Button size="sm" onClick={apply} disabled={pending}>
        Apply to {count} selected car{count === 1 ? "" : "s"}
      </Button>
    </div>
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
  const [picked, setPicked] = useState<PickedCar[]>([]);
  const [pending, setPending] = useState(false);

  async function add() {
    if (!picked.length) return;
    setPending(true);
    try {
      const res = await apiRequest("POST", `/api/programs/${programId}/cars`, {
        railcar_ids: picked.map((c) => c.id),
      });
      const out = await res.json();
      const added = (out.added ?? []).length;
      const skipped = (out.skipped ?? []).length;
      toast({
        title: `${added} car${added === 1 ? "" : "s"} added`,
        description: skipped ? `${skipped} already in this program` : undefined,
      });
      setPicked([]);
      onAdded();
    } catch (e: any) {
      toast({ title: "Could not add cars", description: e.message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add cars</DialogTitle>
          <DialogDescription>Search and pick several, or paste a list and review matches before adding.</DialogDescription>
        </DialogHeader>
        <ProgramCarPicker programId={programId} value={picked} onChange={setPicked} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={add} disabled={!picked.length || pending}>
            {pending ? "Adding…" : `Add ${picked.length || ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
