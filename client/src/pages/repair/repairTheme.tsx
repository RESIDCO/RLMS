/**
 * Owner repair UI theme — light-only for AA contrast.
 * Dark mode was a recurring washout source (black disabled buttons / checkboxes
 * on dark gutters). Toggle is kept for discoverability but always applies light.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Only "light" is applied; "dark" is accepted historically then coerced to light. */
export type RepairThemeMode = "light" | "dark";

const USER_KEY = "repair.localUserId";
const THEME_PREFIX = "repair.ownerUi.theme";
/** Feature flag: repair owner UI is light-only (prevents half-dark washout). */
export const REPAIR_LIGHT_ONLY = true;

export function repairUserKey(): string {
  try {
    return localStorage.getItem(USER_KEY) || "local";
  } catch {
    return "local";
  }
}

export function repairUserStorageKey(base: string): string {
  return `${base}.${repairUserKey()}`;
}

function readTheme(): RepairThemeMode {
  if (REPAIR_LIGHT_ONLY) return "light";
  try {
    const v = localStorage.getItem(repairUserStorageKey(THEME_PREFIX));
    if (v === "dark" || v === "light") return v;
  } catch {
    /* ignore */
  }
  return "light";
}

function writeTheme(mode: RepairThemeMode) {
  try {
    const stored: RepairThemeMode = REPAIR_LIGHT_ONLY ? "light" : mode;
    localStorage.setItem(repairUserStorageKey(THEME_PREFIX), stored);
  } catch {
    /* ignore */
  }
}

type Ctx = {
  theme: RepairThemeMode;
  setTheme: (mode: RepairThemeMode) => void;
  toggleTheme: () => void;
  lightOnly: boolean;
};

const RepairThemeContext = createContext<Ctx | null>(null);

export function RepairThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<RepairThemeMode>(() =>
    typeof window !== "undefined" ? readTheme() : "light",
  );

  useEffect(() => {
    setThemeState(readTheme());
  }, []);

  const setTheme = useCallback((mode: RepairThemeMode) => {
    const next: RepairThemeMode = REPAIR_LIGHT_ONLY ? "light" : mode;
    setThemeState(next);
    writeTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    if (REPAIR_LIGHT_ONLY) {
      // Stay light — sun icon still works as acknowledgment, no washout.
      setThemeState("light");
      writeTheme("light");
      return;
    }
    setThemeState((prev) => {
      const next: RepairThemeMode = prev === "light" ? "dark" : "light";
      writeTheme(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme, lightOnly: REPAIR_LIGHT_ONLY }),
    [theme, setTheme, toggleTheme],
  );

  return (
    <RepairThemeContext.Provider value={value}>
      {children}
    </RepairThemeContext.Provider>
  );
}

export function useRepairTheme(): Ctx {
  const ctx = useContext(RepairThemeContext);
  if (!ctx) {
    return {
      theme: "light",
      setTheme: () => undefined,
      toggleTheme: () => undefined,
      lightOnly: REPAIR_LIGHT_ONLY,
    };
  }
  return ctx;
}
