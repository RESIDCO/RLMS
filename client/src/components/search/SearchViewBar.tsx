import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Copy, GripVertical, List, MoreHorizontal, Pin, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FOCUS_PRESET_LABEL, formatEtTime, viewNamesCollide, type ViewKind } from "@shared/saved-views";

export type ViewSummary = {
  id: number;
  name: string;
  kind: ViewKind;
  description?: string | null;
  shared: boolean;
  pinned: boolean;
  pin_order: number | null;
  owner?: string | null;
  owner_name?: string;
  updated_by_name?: string;
  updated_at?: string;
  updated_at_et?: string;
  member_count?: number | null;
};

export type ViewCount = { count: number; active: number; inactive: number; ms: number } | null;

const SIDEBAR_KEY = "rlms-views-sidebar";

export function readViewsSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeViewsSidebarOpen(open: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0");
  } catch {
    /* private mode */
  }
}

function countLabel(count: ViewCount | undefined): string {
  if (!count) return "—";
  return count.count.toLocaleString();
}

function countTitle(count: ViewCount | undefined): string {
  if (!count) return "Count unavailable";
  const inactive = count.inactive > 0 ? ` · ${count.inactive.toLocaleString()} inactive` : "";
  return `${count.active.toLocaleString()} active${inactive}`;
}

export function PinnedViewStrip({
  views,
  counts,
  activeId,
  canPin,
  onOpen,
  onReorder,
  onCreate,
}: {
  views: ViewSummary[];
  counts: Record<string, ViewCount | undefined>;
  activeId: number | null;
  canPin: boolean;
  onOpen: (id: number) => void;
  onReorder: (ids: number[]) => void;
  onCreate: () => void;
}) {
  const pins = useMemo(
    () => views.filter((view) => view.pinned).sort((a, b) => (a.pin_order ?? 999) - (b.pin_order ?? 999) || a.name.localeCompare(b.name)),
    [views],
  );
  const [dragId, setDragId] = useState<number | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="search-pinned-views">
      {pins.map((view) => {
        const count = counts[String(view.id)];
        return (
          <button
            key={view.id}
            type="button"
            draggable={canPin}
            onDragStart={() => setDragId(view.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (!canPin || dragId == null || dragId === view.id) return;
              const ids = pins.map((pin) => pin.id);
              const from = ids.indexOf(dragId);
              const to = ids.indexOf(view.id);
              if (from < 0 || to < 0) return;
              const next = [...ids];
              const [moved] = next.splice(from, 1);
              next.splice(to, 0, moved);
              onReorder(next);
              setDragId(null);
            }}
            title={countTitle(count)}
            onClick={() => onOpen(view.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
              activeId === view.id ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-foreground hover:border-primary/40",
            )}
            data-testid={`pinned-view-${view.id}`}
          >
            {canPin ? <GripVertical className="h-3 w-3 text-muted-foreground" /> : null}
            <span className="max-w-[12rem] truncate">{view.name}</span>
            <span className="font-mono-num text-muted-foreground">{countLabel(count)}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground"
        aria-label="Save view"
        data-testid="button-pin-new-view"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ViewRow({
  view,
  count,
  active,
  canEdit,
  isAdmin,
  userId,
  onOpen,
  onPin,
  onRename,
  onDuplicate,
  onDelete,
  onCopy,
}: {
  view: ViewSummary;
  count: ViewCount | undefined;
  active: boolean;
  canEdit: boolean;
  isAdmin: boolean;
  userId: string;
  onOpen: (id: number) => void;
  onPin: (view: ViewSummary) => void;
  onRename: (view: ViewSummary) => void;
  onDuplicate: (view: ViewSummary) => void;
  onDelete: (view: ViewSummary) => void;
  onCopy: (view: ViewSummary) => void;
}) {
  const canDelete = isAdmin || view.owner === userId;
  return (
    <div className={cn("group flex items-center gap-1 rounded px-1.5 py-1 text-sm", active && "bg-primary/10")}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => onOpen(view.id)} title={countTitle(count)}>
        {view.kind === "query" ? <RefreshCw className="h-3 w-3 shrink-0 text-muted-foreground" /> : <List className="h-3 w-3 shrink-0 text-muted-foreground" />}
        <span className="truncate">{view.name}</span>
        <span className="ml-auto font-mono-num text-xs text-muted-foreground">{countLabel(count)}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label={`${view.name} actions`}>
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onOpen(view.id)}>Open</DropdownMenuItem>
          <DropdownMenuItem disabled={!canEdit} onClick={() => onPin(view)}>{view.pinned ? "Unpin" : "Pin"}</DropdownMenuItem>
          <DropdownMenuItem disabled={!canEdit} onClick={() => onRename(view)}>Rename</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDuplicate(view)}>Duplicate</DropdownMenuItem>
          <DropdownMenuItem disabled={!canDelete} onClick={() => onDelete(view)}>Delete</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onCopy(view)}>Copy link</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function ViewsMenu({
  views,
  counts,
  activeId,
  canEdit,
  isAdmin,
  userId,
  schemaMessage,
  onOpen,
  onPin,
  onRename,
  onDuplicate,
  onDelete,
  onCopy,
}: {
  views: ViewSummary[];
  counts: Record<string, ViewCount | undefined>;
  activeId: number | null;
  canEdit: boolean;
  isAdmin: boolean;
  userId: string;
  schemaMessage: string | null;
  onOpen: (id: number) => void;
  onPin: (view: ViewSummary) => void;
  onRename: (view: ViewSummary) => void;
  onDuplicate: (view: ViewSummary) => void;
  onDelete: (view: ViewSummary) => void;
  onCopy: (view: ViewSummary) => void;
}) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const match = (view: ViewSummary) => !needle || view.name.toLowerCase().includes(needle);
  const pinned = views.filter((view) => view.pinned && match(view));
  const shared = views.filter((view) => view.shared && match(view));
  const mine = views.filter((view) => !view.shared && view.owner === userId && match(view));
  const section = (title: string, rows: ViewSummary[]) => (
    <div className="mt-2">
      <div className="px-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">{title}</div>
      {rows.length === 0 ? <div className="px-1.5 py-1 text-xs text-muted-foreground">None</div> : rows.map((view) => (
        <ViewRow
          key={`${title}-${view.id}`}
          view={view}
          count={counts[String(view.id)]}
          active={activeId === view.id}
          canEdit={canEdit}
          isAdmin={isAdmin}
          userId={userId}
          onOpen={onOpen}
          onPin={onPin}
          onRename={onRename}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onCopy={onCopy}
        />
      ))}
    </div>
  );
  return (
    <div className="min-w-0">
      {schemaMessage ? <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">{schemaMessage}</div> : null}
      <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter views" className="h-8 text-xs" data-testid="views-filter" />
      {section("Pinned", pinned)}
      {section("Shared", shared)}
      {section("Mine", mine)}
    </div>
  );
}

export function SaveViewDialog({
  open,
  onOpenChange,
  views,
  defaultName,
  defaultKind,
  carCount,
  canShare,
  busy,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  views: ViewSummary[];
  defaultName: string;
  defaultKind: ViewKind;
  carCount: number;
  canShare: boolean;
  busy: boolean;
  onSave: (body: { name: string; kind: ViewKind; shared: boolean; pinned: boolean; description: string; preset: "current" | "focus" }) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [kind, setKind] = useState<ViewKind>(defaultKind);
  const [shared, setShared] = useState(canShare);
  const [pinned, setPinned] = useState(true);
  const [description, setDescription] = useState("");
  const [preset, setPreset] = useState<"current" | "focus">("current");
  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setKind(defaultKind);
    setShared(canShare);
    setPinned(true);
    setDescription("");
    setPreset("current");
  }, [open, defaultName, defaultKind, canShare]);
  const taken = views.some((view) => viewNamesCollide(view.name, name));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save view</DialogTitle>
        </DialogHeader>
        <label className="block text-xs text-muted-foreground">
          Name
          <Input value={name} onChange={(event) => setName(event.target.value)} className="mt-1" data-testid="save-view-name" />
        </label>
        {taken ? <div className="text-xs text-amber-400">A view with that name already exists.</div> : null}
        <div className="space-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={kind === "query"} onChange={() => setKind("query")} />
            Saved search (updates automatically)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={kind === "fixed"} onChange={() => setKind("fixed")} />
            Fixed list of these {carCount.toLocaleString()} cars
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={shared} disabled={!canShare} onCheckedChange={(value) => setShared(value === true)} />
          Shared with all RESIDCO users
        </label>
        {!canShare ? <div className="text-xs text-muted-foreground">Viewers can save a private copy.</div> : null}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={pinned} disabled={!canShare} onCheckedChange={(value) => setPinned(value === true)} />
          Pin to top
        </label>
        <label className="block text-xs text-muted-foreground">
          Description
          <Input value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1" />
        </label>
        <label className="block text-xs text-muted-foreground">
          Start from preset
          <select className="mt-1 h-8 w-full rounded border border-border bg-card px-2 text-sm" value={preset} onChange={(event) => setPreset(event.target.value === "focus" ? "focus" : "current")}>
            <option value="current">Current columns</option>
            <option value="focus">{FOCUS_PRESET_LABEL}</option>
          </select>
        </label>
        <Button type="button" disabled={!name.trim() || taken || busy} onClick={() => onSave({ name: name.trim(), kind, shared: canShare ? shared : false, pinned: canShare ? pinned : false, description, preset })}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function ViewMeta({ view }: { view: ViewSummary | null }) {
  if (!view?.updated_at) return null;
  const when = view.updated_at_et || formatEtTime(view.updated_at);
  const editor = view.updated_by_name ? `edited by ${view.updated_by_name}` : "";
  const creator = view.owner_name ? `Created by ${view.owner_name}` : "";
  return <span className="text-[11px] text-muted-foreground">{[creator, editor, when].filter(Boolean).join(" · ")}</span>;
}

export function FilterPopover({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" data-testid="button-search-filters">
          Filters{count > 0 ? ` (${count})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2">
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function SelectionBar({
  selected,
  inactive,
  canEdit,
  fixedView,
  onRailcars,
  onAdd,
  onRemove,
  onPhotos,
  onExport,
}: {
  selected: number;
  inactive: number;
  canEdit: boolean;
  fixedView: boolean;
  onRailcars: () => void;
  onAdd: () => void;
  onRemove: () => void;
  onPhotos: () => void;
  onExport: (kind: "xlsx" | "csv") => void;
}) {
  if (selected <= 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 text-xs" data-testid="search-selection-bar">
      <span className="font-medium">{selected.toLocaleString()} selected</span>
      {inactive > 0 ? <span className="text-muted-foreground">{inactive.toLocaleString()} inactive will be skipped</span> : null}
      <Button type="button" size="sm" className="h-7 text-xs" onClick={onRailcars}>Open in Railcars</Button>
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={!canEdit} onClick={onAdd}>Add to view…</Button>
      {fixedView ? <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={!canEdit} onClick={onRemove}>Remove from view</Button> : null}
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={onPhotos}>Find Photos</Button>
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => onExport("xlsx")}>Export selected</Button>
      <button type="button" className="text-primary hover:underline" onClick={() => onExport("csv")}>CSV</button>
    </div>
  );
}

export function KindIcon({ kind }: { kind: ViewKind }) {
  return kind === "query" ? <RefreshCw className="h-3 w-3" /> : <List className="h-3 w-3" />;
}

export function PinIcon() {
  return <Pin className="h-3.5 w-3.5" />;
}

export function CopiedIcon() {
  return <Check className="h-3.5 w-3.5" />;
}

export function CopyIcon() {
  return <Copy className="h-3.5 w-3.5" />;
}
