/**
 * Owner repair pages: sticky module nav + shared AA theme scope.
 * Light-only — dark preference is coerced so pages never enter a half-dark state.
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
  const { theme, lightOnly } = useRepairTheme();
  const mode = lightOnly || theme !== "dark" ? "light" : "dark";
  return (
    <div
      className={cn(
        "min-h-full flex flex-col repair-owner-ui",
        mode === "dark" ? "repair-owner-ui--dark" : "repair-owner-ui--light",
        className,
      )}
      data-repair-theme={mode}
      data-repair-light-only={lightOnly ? "1" : "0"}
    >
      <RepairModuleNav />
      <div className="flex-1 min-h-0 repair-page">{children}</div>
    </div>
  );
}

export default function RepairOwnerShell({
  children,
  className,
}: {
  children: ReactNode;
  /** @deprecated Theme is light-only for AA; prop ignored. */
  light?: boolean;
  className?: string;
}) {
  return (
    <RepairThemeProvider>
      <ShellInner className={className}>{children}</ShellInner>
    </RepairThemeProvider>
  );
}
