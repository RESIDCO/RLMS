import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type ConfirmActionOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** destructive = red Delete-style; default = neutral Save-style */
  variant?: "destructive" | "default";
};

export type ConfirmReasonOptions = ConfirmActionOptions & {
  reasonLabel?: string;
  reasonPlaceholder?: string;
};

type Pending =
  | (ConfirmActionOptions & { mode: "confirm"; resolve: (ok: boolean) => void })
  | (ConfirmReasonOptions & { mode: "reason"; resolve: (reason: string | null) => void });

let openConfirm: ((opts: ConfirmActionOptions) => Promise<boolean>) | null = null;
let openReason: ((opts: ConfirmReasonOptions) => Promise<string | null>) | null = null;

/** Imperative confirm — only resolves true after the user clicks the confirm button. */
export function confirmAction(opts: ConfirmActionOptions): Promise<boolean> {
  if (!openConfirm) {
    console.error("ConfirmActionHost is not mounted");
    return Promise.resolve(false);
  }
  return openConfirm(opts);
}

export function confirmDelete(opts: Omit<ConfirmActionOptions, "variant">): Promise<boolean> {
  return confirmAction({
    confirmLabel: "Delete",
    variant: "destructive",
    ...opts,
  });
}

export function confirmSave(opts: Omit<ConfirmActionOptions, "variant">): Promise<boolean> {
  return confirmAction({
    confirmLabel: "Save",
    variant: "default",
    ...opts,
  });
}

/**
 * Confirm with a mandatory free-text reason.
 * Resolves to the trimmed reason on confirm, or null on cancel.
 * Confirm stays disabled until the reason field is non-empty.
 */
export function confirmWithReason(opts: ConfirmReasonOptions): Promise<string | null> {
  if (!openReason) {
    console.error("ConfirmActionHost is not mounted");
    return Promise.resolve(null);
  }
  return openReason(opts);
}

/** Mount once near the app root so confirmAction() / confirmWithReason() work anywhere. */
export function ConfirmActionHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const closeConfirm = useCallback((ok: boolean) => {
    const p = pendingRef.current;
    setPending(null);
    setReason("");
    if (p?.mode === "confirm") p.resolve(ok);
    else if (p?.mode === "reason") p.resolve(null);
  }, []);

  const closeReason = useCallback((value: string | null) => {
    const p = pendingRef.current;
    setPending(null);
    setReason("");
    if (p?.mode === "reason") p.resolve(value);
    else if (p?.mode === "confirm") p.resolve(false);
  }, []);

  useEffect(() => {
    openConfirm = (opts) =>
      new Promise<boolean>((resolve) => {
        setReason("");
        setPending({ ...opts, mode: "confirm", resolve });
      });
    openReason = (opts) =>
      new Promise<string | null>((resolve) => {
        setReason("");
        setPending({ ...opts, mode: "reason", resolve });
      });
    return () => {
      openConfirm = null;
      openReason = null;
    };
  }, []);

  const variant = pending?.variant ?? "default";
  const confirmLabel =
    pending?.confirmLabel ?? (variant === "destructive" ? "Delete" : "Confirm");
  const reasonOk = reason.trim().length > 0;
  const canConfirm = pending?.mode !== "reason" || reasonOk;

  return (
    <AlertDialog
      open={!!pending}
      onOpenChange={(o) => {
        if (!o) {
          if (pending?.mode === "reason") closeReason(null);
          else closeConfirm(false);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title ?? ""}</AlertDialogTitle>
          {pending?.description ? (
            <AlertDialogDescription>{pending.description}</AlertDialogDescription>
          ) : (
            <AlertDialogDescription className="sr-only">Confirm this action</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        {pending?.mode === "reason" && (
          <div className="space-y-2 py-1">
            <Label htmlFor="confirm-action-reason">
              {(pending as ConfirmReasonOptions).reasonLabel ?? "Reason (required)"}
            </Label>
            <Textarea
              id="confirm-action-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                (pending as ConfirmReasonOptions).reasonPlaceholder ??
                "Explain why this change is being made…"
              }
              rows={3}
              data-testid="input-confirm-reason"
              autoFocus
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() =>
              pending?.mode === "reason" ? closeReason(null) : closeConfirm(false)
            }
          >
            {pending?.cancelLabel ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm}
            className={cn(
              variant === "destructive" &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              !canConfirm && "opacity-50 pointer-events-none",
            )}
            onClick={(e) => {
              e.preventDefault();
              if (!canConfirm) return;
              if (pending?.mode === "reason") closeReason(reason.trim());
              else closeConfirm(true);
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
