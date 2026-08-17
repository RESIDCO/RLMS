import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type Role = "admin" | "editor" | "viewer" | null;

const NEEDS_PW_KEY = "rlms_needs_password";
const ACCESS_DENIED_KEY = "rlms_access_denied";

/** Capture invite/recovery type from the hash before Supabase clears it. */
function captureAuthHashType(): void {
  try {
    const raw = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    // Supports both "#access_token=...&type=invite" and query-style leftovers
    const params = new URLSearchParams(raw.includes("?") ? raw.split("?")[1] : raw);
    const type = params.get("type");
    if (type === "invite" || type === "recovery") {
      sessionStorage.setItem(NEEDS_PW_KEY, type);
    }
  } catch {
    // ignore
  }
}

captureAuthHashType();

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  role: Role;
  loading: boolean;
  needsPasswordChange: boolean;
  accessDenied: boolean;
  clearNeedsPasswordChange: () => void;
  clearAccessDenied: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  role: null,
  loading: true,
  needsPasswordChange: false,
  accessDenied: false,
  clearNeedsPasswordChange: () => {},
  clearAccessDenied: () => {},
  signOut: async () => {},
});

type RoleFetch = { ok: true; role: Role } | { ok: false };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);
  const [needsPasswordChange, setNeedsPasswordChange] = useState(
    () => typeof sessionStorage !== "undefined" && !!sessionStorage.getItem(NEEDS_PW_KEY)
  );
  const [accessDenied, setAccessDenied] = useState(
    () => typeof sessionStorage !== "undefined" && sessionStorage.getItem(ACCESS_DENIED_KEY) === "1"
  );
  const denyingRef = useRef(false);

  async function fetchRole(token: string): Promise<RoleFetch> {
    try {
      const RENDER_API = (import.meta.env.VITE_API_BASE as string) || "";
      const res = await fetch(`${RENDER_API}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) return { ok: true, role: null };
      if (!res.ok) return { ok: false };
      const data = await res.json();
      const r = data.role;
      if (r === "admin" || r === "editor" || r === "viewer") return { ok: true, role: r };
      return { ok: true, role: null };
    } catch {
      return { ok: false };
    }
  }

  function markNeedsPassword(reason: string) {
    sessionStorage.setItem(NEEDS_PW_KEY, reason);
    setNeedsPasswordChange(true);
  }

  function markAccessDenied() {
    sessionStorage.setItem(ACCESS_DENIED_KEY, "1");
    setAccessDenied(true);
  }

  async function enforceAccess(next: Session | null) {
    if (!next?.access_token) {
      setRole(null);
      return;
    }
    const result = await fetchRole(next.access_token);
    if (!result.ok) return;
    setRole(result.role);
    if (result.role) {
      sessionStorage.removeItem(ACCESS_DENIED_KEY);
      setAccessDenied(false);
      return;
    }
    // Session is valid but email is not in user_roles — identity ≠ access.
    if (denyingRef.current) return;
    denyingRef.current = true;
    markAccessDenied();
    await supabase.auth.signOut();
    setSession(null);
    setRole(null);
    denyingRef.current = false;
  }

  useEffect(() => {
    // Re-check hash in case it arrived after module load
    captureAuthHashType();
    if (sessionStorage.getItem(NEEDS_PW_KEY)) {
      setNeedsPasswordChange(true);
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      await enforceAccess(session);
      // After session is established from invite URL, normalize hash for wouter
      if (session && /access_token=/.test(window.location.hash)) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/`);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);

        // Password recovery email link
        if (event === "PASSWORD_RECOVERY") {
          markNeedsPassword("recovery");
        }

        // Invite link establishes a session via SIGNED_IN; type was captured from hash
        if (
          (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
          sessionStorage.getItem(NEEDS_PW_KEY)
        ) {
          setNeedsPasswordChange(true);
        }

        if (event === "SIGNED_OUT") {
          sessionStorage.removeItem(NEEDS_PW_KEY);
          setNeedsPasswordChange(false);
          setRole(null);
        } else {
          await enforceAccess(session);
        }

        if (session && /access_token=/.test(window.location.hash)) {
          window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/`);
        }

        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    sessionStorage.removeItem(NEEDS_PW_KEY);
    setSession(null);
    setRole(null);
    setNeedsPasswordChange(false);
  };

  const clearNeedsPasswordChange = () => {
    sessionStorage.removeItem(NEEDS_PW_KEY);
    setNeedsPasswordChange(false);
  };

  const clearAccessDenied = () => {
    sessionStorage.removeItem(ACCESS_DENIED_KEY);
    setAccessDenied(false);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        role,
        loading,
        needsPasswordChange,
        accessDenied,
        clearNeedsPasswordChange,
        clearAccessDenied,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Returns true if the current user can make fleet/lease/AP/programs data changes (admin or editor) */
export function useCanEdit() {
  return usePermissions().canEditFleet;
}

/** Returns true if the current user can manage users / delete master leases */
export function useIsAdmin() {
  return usePermissions().isAdmin;
}

/** Single source of truth for role capability flags across the UI. */
export function usePermissions() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const isEditor = role === "editor";
  const isViewer = role === "viewer";
  const canEditFleet = isAdmin || isEditor;
  return {
    role,
    isAdmin,
    isEditor,
    isViewer,
    canManageUsers: isAdmin,
    canEditFleet,
    canDeleteFleet: canEditFleet,
    canEditContacts: !!role,
    canDeleteContacts: canEditFleet,
    canUseDv: !!role,
    canUsePhotoSearch: !!role,
  };
}
