/**
 * Single owner workspace title bar — always "RESIDCO" (not per-entity).
 */
import { useEffect, useState, type ReactNode } from "react";
import { apiRequest } from "@/lib/queryClient";

const DEFAULT_TITLE = "RESIDCO";

export function useWorkspaceTitle(): string {
  const [title, setTitle] = useState(DEFAULT_TITLE);
  useEffect(() => {
    apiRequest("GET", "/api/repair/workspace")
      .then((r) => r.json())
      .then((d) => {
        const t = String(d?.title ?? DEFAULT_TITLE).trim();
        if (t) setTitle(t);
      })
      .catch(() => undefined);
  }, []);
  return title;
}

/** Page heading used inside owner shells (not the red banner). Named export only. */
export function WorkspaceTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="space-y-1">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? (
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  );
}

export function WorkspaceBanner({
  pageTitle,
  right,
}: {
  pageTitle: string;
  right?: ReactNode;
}) {
  const workspace = useWorkspaceTitle();
  return (
    <div className="bg-[#8B1E1E] text-white px-4 py-2 flex items-center justify-between">
      <div className="font-semibold tracking-wide">
        {workspace} :: {pageTitle}
      </div>
      {right ?? null}
    </div>
  );
}
