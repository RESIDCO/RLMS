import { ToastAction } from "@/components/ui/toast";
import { confirmAction } from "@/components/ConfirmActionDialog";
import { toast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { createElement } from "react";

type Preview = {
  change_group: string;
  count: number;
  lines: string[];
  conflicts?: { reason: string; table_name?: string | null; row_pk?: number | null }[];
  ok?: boolean;
};

export async function previewAndUndo(changeGroup: string): Promise<boolean> {
  const prev = (await apiRequest("POST", "/api/undo/preview", { change_group: changeGroup }).then((r) => r.json())) as Preview;
  if (prev.conflicts?.length) {
    toast({
      title: "Cannot undo",
      description: prev.conflicts.map((c) => `${c.table_name ?? "row"} #${c.row_pk ?? ""} ${c.reason}`).join("; "),
      variant: "destructive",
    });
    return false;
  }
  const ok = await confirmAction({
    title: prev.count > 1 ? `Undo ${prev.count} changes?` : "Undo this change?",
    description: (prev.lines ?? []).slice(0, 12).join("\n") || "Restore the previous values for this save.",
    confirmLabel: "Undo",
    variant: "destructive",
  });
  if (!ok) return false;
  try {
    await apiRequest("POST", "/api/undo", { change_group: changeGroup });
    await queryClient.invalidateQueries();
    toast({ title: "Undone" });
    return true;
  } catch (e: any) {
    toast({ title: "Undo failed", description: e.message, variant: "destructive" });
    return false;
  }
}

export function offerUndoToast(payload: unknown) {
  if (!payload || typeof payload !== "object") return;
  const row = payload as Record<string, unknown>;
  if (row.undoable === false) {
    const reason = String((row as any).no_undo ?? (row as any).detail?.no_undo ?? "").trim();
    toast({
      title: "Saved",
      description: reason || "No undo (remark or import).",
    });
    return;
  }
  const group = String(row.change_group ?? "").trim();
  if (!group) return;
  toast({
    title: "Saved · Undo",
    duration: 30_000,
    action: createElement(
      ToastAction,
      {
        altText: "Undo",
        onClick: () => {
          void previewAndUndo(group);
        },
      },
      "Undo",
    ),
  });
}
