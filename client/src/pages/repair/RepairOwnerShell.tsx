/**
 * Owner repair pages: sticky module nav + theme scope (light/dark, per user).
 * Shop / lessee token pages do not use this shell.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import RepairModuleNav from "./RepairModuleNav";
import { RepairThemeProvider, useRepairTheme } from "./repairTheme";

function ShellInner({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { theme } = useRepairTheme();
  return (
    <div
      className={cn(
        "min-h-full flex flex-col repair-owner-ui",
        theme === "dark" ? "repair-owner-ui--dark" : "repair-owner-ui--light",
        className,
      )}
      data-repair-theme={theme}
    >
      <RepairModuleNav />
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

export default function RepairOwnerShell({
  children,
  className,
}: {
  children: ReactNode;
  /** @deprecated Theme is user-controlled via nav toggle; prop ignored. */
  light?: boolean;
  className?: string;
}) {
  return (
    <RepairThemeProvider>
      <ShellInner className={className}>{children}</ShellInner>
    </RepairThemeProvider>
  );
}
