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
