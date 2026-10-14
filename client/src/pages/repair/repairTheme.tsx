/**
 * Owner repair UI theme (light/dark) — persisted per local user key.
 * Used by module nav + Estimates History / coming-soon shells.
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

export type RepairThemeMode = "light" | "dark";

const USER_KEY = "repair.localUserId";
const THEME_PREFIX = "repair.ownerUi.theme";

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
    localStorage.setItem(repairUserStorageKey(THEME_PREFIX), mode);
  } catch {
    /* ignore */
  }
}

type Ctx = {
  theme: RepairThemeMode;
  setTheme: (mode: RepairThemeMode) => void;
  toggleTheme: () => void;
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
    setThemeState(mode);
    writeTheme(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: RepairThemeMode = prev === "light" ? "dark" : "light";
      writeTheme(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
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
    // Safe fallback when used outside provider (should not happen under shell)
    return {
      theme: "light",
      setTheme: () => undefined,
      toggleTheme: () => undefined,
    };
  }
  return ctx;
}
