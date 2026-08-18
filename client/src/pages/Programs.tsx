import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useCanEdit } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { confirmDelete } from "@/components/ConfirmActionDialog";
import ClearableSearchInput from "@/components/ClearableSearchInput";
import PageHeader from "@/components/PageHeader";
import { FolderOpen, Plus, Download, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { openAppTab, programPath } from "@/lib/browse-nav";
import {
  CATEGORY_BADGE,
  PROGRAM_ENTITIES,
  STATUS_BADGE,
  STATUS_LABEL,
  type ProgramStatus,
} from "@shared/programs";

type Category = { id: number; name: string };
type ProgramRow = {
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
  updated_at: string;
  category: { id: number; name: string } | null;
  car_count: number;
  active_car_count: number;
  doc_count: number;
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

export default function ProgramsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useCanEdit();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [managerFilter, setManagerFilter] = useState("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);

  const { data: programs = [], isLoading } = useQuery<ProgramRow[]>({
    queryKey: ["/api/programs"],
  });
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/programs/categories"],
    queryFn: () => apiRequest("GET", "/api/programs/categories").then((r) => r.json()),
  });

  const managers = useMemo(() => {
    const s = new Set<string>();
    for (const p of programs) {
      const m = String(p.account_manager ?? "").trim();
      if (m) s.add(m);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [programs]);

  const filtered = programs.filter((p) => {
    const q = search.trim().toLowerCase();
    const blob = `${p.name} ${p.status_narrative ?? ""} ${p.description ?? ""}`.toLowerCase();
    if (q && !blob.includes(q)) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (categoryFilter !== "all" && String(p.category_id) !== categoryFilter) return false;
    if (entityFilter !== "all" && p.entity !== entityFilter) return false;
    if (managerFilter !== "all" && (p.account_manager ?? "") !== managerFilter) return false;
    return true;
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/programs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/programs"] });
      toast({ title: "Program deleted" });
    },
  });

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportSelected() {
    const ids = [...selected];
    if (!ids.length) {
      toast({ title: "Select at least one program", variant: "destructive" });
      return;
    }
    try {
      await downloadReport(`/api/programs/export?ids=${ids.join(",")}`);
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    }
  }

  async function exportOpen() {
    const ids = programs.filter((p) => p.status === "open").map((p) => p.id);
    if (!ids.length) {
      toast({ title: "No open programs to export", variant: "destructive" });
      return;
    }
    try {
      await downloadReport(`/api/programs/export?ids=${ids.join(",")}`);
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    }
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title="Programs"
        subtitle="Open work across the fleet — returns, remarks, acquisitions, qualifications, inspections"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={exportOpen} data-testid="button-export-open-programs">
              <Download className="h-4 w-4" /> Export open
            </Button>
            <Button size="sm" variant="outline" onClick={exportSelected} disabled={!selected.size} data-testid="button-export-selected-programs">
              <Download className="h-4 w-4" /> Export selected
            </Button>
            {canEdit && (
              <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-program">
                <Plus className="h-4 w-4" /> New Program
              </Button>
            )}
          </div>
        }
      />

      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-4">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <ClearableSearchInput
            className="relative flex-1 min-w-[200px] max-w-sm"
            inputClassName="h-9"
            placeholder="Search name or status narrative…"
            value={search}
            onChange={setSearch}
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-36 text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="on_hold">On Hold</SelectItem>
              <SelectItem value="complete">Complete</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-9 w-48 text-sm"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="h-9 w-44 text-sm"><SelectValue placeholder="Entity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              {PROGRAM_ENTITIES.map((e) => (
                <SelectItem key={e} value={e}>{e}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {managers.length > 0 && (
            <Select value={managerFilter} onValueChange={setManagerFilter}>
              <SelectTrigger className="h-9 w-44 text-sm"><SelectValue placeholder="Manager" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All managers</SelectItem>
                {managers.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground p-4">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-10 text-center">
            <FolderOpen className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground italic">
              {programs.length === 0 ? "No programs yet — create one to get started." : "No programs match your filter."}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-card-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                <tr>
                  <th className="w-10 px-3 py-2" />
                  <th className="text-left px-3 py-2 font-medium">Program</th>
                  <th className="text-left px-3 py-2 font-medium">Category</th>
                  <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Entity</th>
                  <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">Account manager</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-right px-3 py-2 font-medium">% Complete</th>
                  <th className="text-right px-3 py-2 font-medium">Cars</th>
                  <th className="text-left px-3 py-2 font-medium hidden xl:table-cell">Updated</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const cat = p.category?.name ?? "";
                  const cars =
                    p.active_car_count !== p.car_count && p.car_count
                      ? `${p.active_car_count} of ${p.car_count}`
                      : String(p.active_car_count ?? p.car_count ?? 0);
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-border/50 hover:bg-muted/30 cursor-pointer"
                      onClick={() => openAppTab(programPath(p.id))}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} aria-label={`Select ${p.name}`} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{p.name}</div>
                        {p.status_narrative && (
                          <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{p.status_narrative}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {cat && (
                          <span className={cn("text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border", CATEGORY_BADGE[cat] ?? "bg-muted border-border")}>
                            {cat}
                          </span>
                        )}
                        {(p.tags ?? []).length > 0 && (
                          <div className="text-[10px] text-muted-foreground mt-1">{(p.tags ?? []).join(", ")}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">{p.entity ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">{p.account_manager ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className={cn("text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border", STATUS_BADGE[p.status])}>
                          {STATUS_LABEL[p.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono-num">{p.percent_complete != null ? `${p.percent_complete}%` : "—"}</td>
                      <td className="px-3 py-2 text-right font-mono-num">{cars}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs hidden xl:table-cell">
                        {new Date(p.updated_at).toLocaleDateString()}
                      </td>
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        {canEdit && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label={`Delete ${p.name}`}
                            onClick={async () => {
                              const ok = await confirmDelete({
                                title: `Delete program ${p.name}?`,
                                description: "This removes the program, its car links, and documents. This cannot be undone.",
                              });
                              if (ok) deleteMut.mutate(p.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateProgramDialog
        open={createOpen}
        categories={categories}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          qc.invalidateQueries({ queryKey: ["/api/programs"] });
          openAppTab(programPath(id));
        }}
      />
    </div>
  );
}

function CreateProgramDialog({
  open,
  categories,
  onClose,
  onCreated,
}: {
  open: boolean;
  categories: Category[];
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [entity, setEntity] = useState("");
  const [manager, setManager] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState("");
  const [tags, setTags] = useState("");
  const [pending, setPending] = useState(false);

  async function save() {
    if (!name.trim() || !categoryId) {
      toast({ title: "Name and category are required", variant: "destructive" });
      return;
    }
    setPending(true);
    try {
      const res = await apiRequest("POST", "/api/programs", {
        name: name.trim(),
        category_id: Number(categoryId),
        entity: entity || null,
        account_manager: manager.trim() || null,
        description: description.trim() || null,
        target_completion_date: target || null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      const row = await res.json();
      onCreated(row.id);
      setName("");
      setCategoryId("");
      setEntity("");
      setManager("");
      setDescription("");
      setTarget("");
      setTags("");
    } catch (e: any) {
      toast({ title: "Could not create program", description: e.message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New program</DialogTitle>
          <DialogDescription>Category chooses which car-level fields this program uses.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. OL2526 — Solvay Return" />
          </div>
          <div>
            <Label className="text-xs">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Entity</Label>
              <Select value={entity || "none"} onValueChange={(v) => setEntity(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Entity" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {PROGRAM_ENTITIES.map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Account manager</Label>
              <Input value={manager} onChange={(e) => setManager(e.target.value)} placeholder="Bahnline" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Target completion</Label>
            <Input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Tags (comma-separated, for hybrids like NLD, Sale)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="NLD, Sale" />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={pending}>{pending ? "Creating…" : "Create"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
