/**
 * Owner repair pages: sticky module nav + optional light theme scope (Estimates History).
 * Shop / lessee token pages do not use this shell.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import RepairModuleNav from "./RepairModuleNav";

export default function RepairOwnerShell({
  children,
  light = false,
  className,
}: {
  children: ReactNode;
  /** Force WCAG-friendly light surfaces (shot 01 / Estimates History). */
  light?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-h-full flex flex-col",
        light && "repair-owner-ui",
        className,
      )}
    >
      <RepairModuleNav />
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
