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
import { cn } from "@/lib/utils";

export type ConfirmActionOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** destructive = red Delete-style; default = neutral Save-style */
  variant?: "destructive" | "default";
};

type Pending = ConfirmActionOptions & {
  resolve: (ok: boolean) => void;
};

let openConfirm: ((opts: ConfirmActionOptions) => Promise<boolean>) | null = null;

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

/** Mount once near the app root so confirmAction() works anywhere. */
export function ConfirmActionHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const close = useCallback((ok: boolean) => {
    const p = pendingRef.current;
    setPending(null);
    p?.resolve(ok);
  }, []);

  useEffect(() => {
    openConfirm = (opts) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...opts, resolve });
      });
    return () => {
      openConfirm = null;
    };
  }, []);

  const variant = pending?.variant ?? "default";
  const confirmLabel =
    pending?.confirmLabel ?? (variant === "destructive" ? "Delete" : "Save");

  return (
    <AlertDialog
      open={!!pending}
      onOpenChange={(o) => {
        if (!o) close(false);
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
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>
            {pending?.cancelLabel ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              variant === "destructive" &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
            onClick={(e) => {
              e.preventDefault();
              close(true);
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
