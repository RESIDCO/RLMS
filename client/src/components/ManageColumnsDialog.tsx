import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { confirmSave } from "@/components/ConfirmActionDialog";
import {
  MANAGE_COLUMN_TYPES,
  activeFieldDefs,
  columnTypeFromField,
  fieldScope,
  isRetiredField,
  type ManageColumnScope,
  type ManageColumnType,
} from "@shared/manage-columns";
import type { ProgramFieldDef } from "@shared/programs";

const TYPE_LABEL: Record<ManageColumnType, string> = {
  text: "Text",
  number: "Number",
  currency: "Currency",
  date: "Date",
  checkbox: "Checkbox",
  select: "Select",
};

function scopeLabel(def: ProgramFieldDef): string {
  const scope = fieldScope(def);
  if (scope === "program") return "This program";
  if (scope === "global") return "Global optional";
  return "Category";
}

export function ManageColumnsDialog({
  open,
  programId,
  defs,
  onClose,
  onAdded,
  onChanged,
}: {
  open: boolean;
  programId: number;
  defs: ProgramFieldDef[];
  onClose: () => void;
  onAdded: (fieldKey: string) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [showRetired, setShowRetired] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ManageColumnType>("text");
  const [scope, setScope] = useState<ManageColumnScope>("program");
  const [options, setOptions] = useState("");
  const [pending, setPending] = useState(false);
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const rows = (showRetired ? defs : activeFieldDefs(defs)).slice().sort((a, b) => a.label.localeCompare(b.label));

  async function addColumn() {
    const label = name.trim();
    if (!label) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setPending(true);
    try {
      const created = await apiRequest("POST", `/api/programs/${programId}/columns`, {
        label,
        type,
        scope,
        options,
      }).then((r) => r.json());
      const fieldKey = String(created.field_def?.field_key ?? "");
      setName("");
      setOptions("");
      if (fieldKey) onAdded(fieldKey);
      else onChanged();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not add the column";
      toast({ title: "Could not add the column", description: message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  async function rename(def: ProgramFieldDef) {
    const label = renameValue.trim();
    if (!label || label === def.label) {
      setRenameId(null);
      return;
    }
    const shared = fieldScope(def) !== "program";
    if (shared) {
      const ok = await confirmSave({
        title: `Rename “${def.label}” on every program?`,
        description: "The name changes everywhere this column is used. Existing values stay linked to the same field.",
        confirmLabel: "Rename",
      });
      if (!ok) return;
    }
    setPending(true);
    try {
      await apiRequest("PATCH", `/api/programs/${programId}/columns/${def.id}`, { label });
      setRenameId(null);
      onChanged();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not rename the column";
      toast({ title: "Could not rename the column", description: message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  async function retire(def: ProgramFieldDef, restore: boolean) {
    const shared = fieldScope(def) !== "program";
    const ok = await confirmSave({
      title: restore ? `Restore “${def.label}”?` : `Retire “${def.label}”?`,
      description: restore
        ? "The column comes back in the column picker. Stored values were kept."
        : shared
          ? "This hides the column on every program, including the column picker and export. The values stay and can be restored."
          : "This hides the column from this program’s grid, column picker, and export. The values stay and can be restored.",
      confirmLabel: restore ? "Restore" : "Retire",
    });
    if (!ok) return;
    setPending(true);
    try {
      const action = restore ? "restore" : "retire";
      await apiRequest("POST", `/api/programs/${programId}/columns/${def.id}/${action}`, {});
      onChanged();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not update the column";
      toast({ title: "Could not update the column", description: message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage columns</DialogTitle>
          <DialogDescription>
            Add a column for this program, or a global optional column that stays hidden until someone adds it.
            Rename changes the label only. Retire hides the column and keeps the values.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Add a column</div>
          <Input className="h-8 text-xs" value={name} placeholder="Column name" onChange={(e) => setName(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <select
              className="h-8 bg-background border border-border rounded px-2 text-xs [color-scheme:dark]"
              value={type}
              onChange={(e) => setType(e.target.value as ManageColumnType)}
            >
              {MANAGE_COLUMN_TYPES.map((item) => (
                <option key={item} value={item}>{TYPE_LABEL[item]}</option>
              ))}
            </select>
            <select
              className="h-8 bg-background border border-border rounded px-2 text-xs [color-scheme:dark]"
              value={scope}
              onChange={(e) => setScope(e.target.value as ManageColumnScope)}
            >
              <option value="program">This program</option>
              <option value="global">Global optional field</option>
            </select>
            <Button size="sm" disabled={pending} onClick={() => void addColumn()}>Add</Button>
          </div>
          {type === "select" ? (
            <Textarea
              className="text-xs min-h-[64px]"
              value={options}
              placeholder="One option per line"
              onChange={(e) => setOptions(e.target.value)}
            />
          ) : null}
          {scope === "global" ? (
            <p className="text-[11px] text-muted-foreground">
              A global column is available on every program and stays off the grid until it is added from Columns.
            </p>
          ) : null}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
          Show retired
        </label>
        <ul className="space-y-2">
          {rows.map((def) => {
            const retired = isRetiredField(def);
            return (
              <li key={def.id} className="flex items-center gap-2 text-xs border border-border rounded px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  {renameId === def.id ? (
                    <Input
                      autoFocus
                      className="h-7 text-xs"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => void rename(def)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void rename(def);
                        if (e.key === "Escape") setRenameId(null);
                      }}
                    />
                  ) : (
                    <div className="font-medium truncate">{def.label}</div>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    {TYPE_LABEL[columnTypeFromField(def.field_type)]} · {scopeLabel(def)}
                    {retired ? " · Retired" : ""}
                  </div>
                </div>
                {!retired ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      disabled={pending}
                      onClick={() => {
                        setRenameId(def.id);
                        setRenameValue(def.label);
                      }}
                    >
                      Rename
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2" disabled={pending} onClick={() => void retire(def, false)}>
                      Retire
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" className="h-7 px-2" disabled={pending} onClick={() => void retire(def, true)}>
                    Restore
                  </Button>
                )}
              </li>
            );
          })}
          {rows.length === 0 ? <li className="text-xs text-muted-foreground italic">No columns to show.</li> : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
