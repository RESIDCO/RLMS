import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, GripVertical, List, Loader2, Lock, MoreHorizontal, Pin, Plus, RefreshCw, Users } from "lucide-react";
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
import { EMPTY_VIEWS_HINT, FOCUS_PRESET_LABEL, comparePinnedOrder, formatEtTime, partitionSavedViews, reorderPinnedIds, movePinnedOrder, viewCountLabel, viewNamesCollide, type ViewKind, type ViewLayout, type ViewQuery } from "@shared/saved-views";

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
  query?: ViewQuery;
  layout?: ViewLayout;
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
  return viewCountLabel(count);
}

function countTitle(count: ViewCount | undefined): string {
  if (!count) return "Count unavailable";
  const inactive = count.inactive > 0 ? ` · ${count.inactive.toLocaleString()} inactive` : "";
  return `${count.active.toLocaleString()} active${inactive}`;
}

export function ViewVisibilityIcon({ shared }: { shared: boolean }) {
  const Icon = shared ? Users : Lock;
  return (
    <Icon
      className="h-3 w-3 shrink-0 text-muted-foreground"
      aria-label={shared ? "Shared with all users" : "Private"}
    />
  );
}

export function PinnedViewStrip({
  views,
  counts,
  countsLoading,
  activeId,
  canPin,
  onOpen,
  onReorder,
  onCreate,
}: {
  views: ViewSummary[];
  counts: Record<string, ViewCount | undefined>;
  countsLoading?: boolean;
  activeId: number | null;
  canPin: boolean;
  onOpen: (id: number) => void;
  onReorder: (ids: number[]) => void;
  onCreate: () => void;
}) {
  const pins = useMemo(
    () => views.filter((view) => view.pinned).sort(comparePinnedOrder),
    [views],
  );
  const [dragId, setDragId] = useState<number | null>(null);
  const ids = pins.map((pin) => pin.id);
  function move(id: number, direction: -1 | 1) {
    const next = movePinnedOrder(ids, id, direction);
    if (next) onReorder(next);
  }
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-0.5" data-testid="search-pinned-views">
      {pins.length === 0 ? (
        <div className="flex h-[4.25rem] min-w-[12rem] items-center rounded-lg border border-dashed border-border px-3 text-xs text-muted-foreground">
          Pin a view to keep it here
        </div>
      ) : null}
      {pins.map((view, index) => {
        const count = counts[String(view.id)];
        const label = count == null && countsLoading ? "…" : countLabel(count);
        return (
          <div
            key={view.id}
            className={cn(
              "flex min-w-[11rem] max-w-[16rem] items-stretch rounded-lg border bg-card",
              activeId === view.id ? "border-primary bg-primary/10" : "border-border",
            )}
            data-testid={`pinned-view-${view.id}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (!canPin || dragId == null) return;
              const next = reorderPinnedIds(ids, dragId, view.id);
              if (next) onReorder(next);
              setDragId(null);
            }}
          >
            {canPin ? (
              <button
                type="button"
                className="flex items-center px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label={`Move ${view.name} earlier`}
                disabled={index === 0}
                onClick={() => move(view.id, -1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              draggable={canPin}
              title={countTitle(count)}
              onDragStart={() => setDragId(view.id)}
              onClick={() => onOpen(view.id)}
              onKeyDown={(event) => {
                if (!canPin || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
                event.preventDefault();
                move(view.id, event.key === "ArrowLeft" ? -1 : 1);
              }}
              className="flex min-w-0 flex-1 items-center gap-2 px-1 py-2 text-left"
            >
              {canPin ? <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" /> : null}
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-1">
                  <ViewVisibilityIcon shared={view.shared} />
                  <span className="block truncate text-xs font-medium text-foreground">{view.name}</span>
                </span>
                <span className="block font-mono-num text-lg leading-tight text-foreground">{label}</span>
              </span>
            </button>
            {canPin ? (
              <button
                type="button"
                className="flex items-center px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label={`Move ${view.name} later`}
                disabled={index === pins.length - 1}
                onClick={() => move(view.id, 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex h-[4.25rem] w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground hover:text-foreground"
        aria-label="Save view"
        data-testid="button-pin-new-view"
      >
        <Plus className="h-4 w-4" />
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
  onShare,
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
  /** Same canEditFleet gate as the search-page ⋯ menu. */
  onShare: (view: ViewSummary) => void;
}) {
  const canDelete = isAdmin || view.owner === userId;
  return (
    <div className={cn("group flex items-center gap-1 rounded px-1.5 py-1 text-sm", active && "bg-primary/10")}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => onOpen(view.id)} title={countTitle(count)}>
        {view.kind === "query" ? <RefreshCw className="h-3 w-3 shrink-0 text-muted-foreground" /> : <List className="h-3 w-3 shrink-0 text-muted-foreground" />}
        <ViewVisibilityIcon shared={view.shared} />
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
          <DropdownMenuItem disabled={!canEdit} data-testid={`view-share-${view.id}`} onClick={() => onShare(view)}>
            {view.shared ? "Make private" : "Share with all users"}
          </DropdownMenuItem>
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
  onShare,
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
  onShare: (view: ViewSummary) => void;
}) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const match = (view: ViewSummary) => !needle || view.name.toLowerCase().includes(needle);
  const grouped = partitionSavedViews(views.filter(match), userId);
  const pinned = grouped.pinned;
  const shared = grouped.shared;
  const mine = grouped.mine;
  if (views.length === 0) {
    return (
      <div className="min-w-0">
        {schemaMessage ? <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">{schemaMessage}</div> : null}
        <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter views" className="h-8 text-xs" data-testid="views-filter" />
        <div className="mt-2 px-1.5 py-1 text-xs text-muted-foreground" data-testid="views-empty">{EMPTY_VIEWS_HINT}</div>
      </div>
    );
  }
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
          onShare={onShare}
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
  const [preset, setPreset] = useState<"current" | "focus">(defaultKind === "fixed" ? "focus" : "current");
  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setKind(defaultKind);
    setShared(canShare);
    setPinned(true);
    setDescription("");
    setPreset(defaultKind === "fixed" ? "focus" : "current");
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
        <Button type="button" disabled={!name.trim() || taken || busy} aria-busy={busy} onClick={() => { if (busy) return; onSave({ name: name.trim(), kind, shared: canShare ? shared : false, pinned: canShare ? pinned : false, description, preset }); }}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
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
