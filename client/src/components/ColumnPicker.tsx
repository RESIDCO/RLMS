import { useState } from "react";
import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { useColumnPrefs } from "@/hooks/use-column-prefs";
import { moveCol } from "@/lib/grid-columns";
import { ColumnHelp } from "@/components/ColumnHelp";
import { columnLabel } from "@shared/column-dictionary";

export type PickerColumn = { key: string; label: string; pinned?: boolean };

type Prefs = ReturnType<typeof useColumnPrefs>;

export function ColumnPicker({
  columns,
  prefs,
  visible,
  onToggle,
  onApplyPreset,
  onSaveToView,
  onReorder,
}: {
  columns: PickerColumn[];
  prefs: Prefs;
  /** When a saved view is open, the grid's columns rather than personal prefs. */
  visible?: Set<string>;
  onToggle?: (key: string) => void;
  onApplyPreset?: () => void;
  onSaveToView?: () => void;
  onReorder?: (order: string[]) => void;
}) {
  const { toast } = useToast();
  const [saveOpen, setSaveOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState("");
  const shown = visible ?? prefs.visibleCols;
  const toggleable = columns.filter((c) => !c.pinned);
  const movableKeys = toggleable.map((c) => c.key);
  function nudge(key: string, delta: number) {
    const base = onReorder ? Array.from(shown).filter((item) => item !== "_actions") : (prefs.colOrder.length ? prefs.colOrder : movableKeys);
    const index = base.indexOf(key);
    const target = base[Math.max(0, Math.min(base.length - 1, (index < 0 ? 0 : index) + delta))] ?? key;
    const next = moveCol(base, key, target);
    if (onReorder) onReorder(next);
    else prefs.setColOrder(next);
  }

  async function run(label: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e: any) {
      toast({ title: label, description: e.message ?? "Failed", variant: "destructive" });
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs">
            <Columns3 className="h-3.5 w-3.5" />
            Columns
            {!prefs.prefsLoaded ? (
              <span className="h-3.5 w-3.5 rounded-full bg-muted animate-pulse" />
            ) : shown.size > 0 ? (
              <span className="ml-0.5 bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none">
                {shown.size}
              </span>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 max-h-[min(28rem,70vh)] overflow-y-auto">
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
            View · {prefs.viewName}
          </DropdownMenuLabel>
          {prefs.views.map((v) => (
            <DropdownMenuItem
              key={`${v.is_shared ? "s" : "u"}:${v.view_name}`}
              className="text-xs"
              onClick={() => prefs.selectView(v.view_name)}
            >
              {v.view_name}
              {v.is_default ? " · default" : ""}
              {v.is_shared ? " · shared" : ""}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Show / hide
          </DropdownMenuLabel>
          {toggleable.map(({ key, label }) => (
            <DropdownMenuCheckboxItem
              key={key}
              checked={shown.has(key)}
              onCheckedChange={() => (onToggle ? onToggle(key) : prefs.toggleCol(key))}
              onSelect={(e) => e.preventDefault()}
            >
              <span className="flex-1 inline-flex items-center gap-1">
                {columnLabel(prefs.listKey, key, label)}
                <ColumnHelp listKey={prefs.listKey} colKey={key} />
              </span>
              {movableKeys.length > 1 && shown.has(key) ? (
                <span className="ml-2 inline-flex gap-1 text-[10px] text-muted-foreground">
                  <button
                    type="button"
                    className="hover:text-foreground"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      nudge(key, -1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="hover:text-foreground"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      nudge(key, 1);
                    }}
                  >
                    ↓
                  </button>
                </span>
              ) : null}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          {onApplyPreset ? (
            <DropdownMenuItem className="text-xs" onClick={onApplyPreset}>
              Apply preset · Focus: rent stops & scrap
            </DropdownMenuItem>
          ) : null}
          {onSaveToView ? (
            <DropdownMenuItem className="text-xs" onClick={onSaveToView}>
              Save to this view
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem className="text-xs" onClick={() => { setName(""); setSaveOpen(true); }}>
            Save as…
          </DropdownMenuItem>
          <DropdownMenuItem className="text-xs" onClick={() => { setName(prefs.viewName); setRenameOpen(true); }}>
            Rename view
          </DropdownMenuItem>
          <DropdownMenuItem className="text-xs" onClick={() => void run("Delete view", prefs.deleteView)}>
            Delete view
          </DropdownMenuItem>
          <DropdownMenuItem className="text-xs" onClick={() => void run("Set default", prefs.setDefault)}>
            Set as my default
          </DropdownMenuItem>
          {prefs.isAdmin ? (
            <DropdownMenuItem className="text-xs" onClick={() => void run("Publish default", prefs.publish)}>
              Publish as org default
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem className="text-xs text-muted-foreground" onClick={() => prefs.resetCols()}>
            Reset to default
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save column view</DialogTitle>
          </DialogHeader>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="View name" />
          <Button
            size="sm"
            disabled={!name.trim()}
            onClick={() =>
              void run("Save view", async () => {
                await prefs.saveAs(name.trim());
                setSaveOpen(false);
              })
            }
          >
            Save
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename view</DialogTitle>
          </DialogHeader>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="View name" />
          <Button
            size="sm"
            disabled={!name.trim()}
            onClick={() =>
              void run("Rename view", async () => {
                await prefs.renameView(name.trim());
                setRenameOpen(false);
              })
            }
          >
            Rename
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
