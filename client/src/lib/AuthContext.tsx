import { createContext, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type Role = "admin" | "editor" | "viewer" | null;

const NEEDS_PW_KEY = "rlms_needs_password";

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
  clearNeedsPasswordChange: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  role: null,
  loading: true,
  needsPasswordChange: false,
  clearNeedsPasswordChange: () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);
  const [needsPasswordChange, setNeedsPasswordChange] = useState(
    () => typeof sessionStorage !== "undefined" && !!sessionStorage.getItem(NEEDS_PW_KEY)
  );

  async function fetchRole(token: string): Promise<Role> {
    try {
      const RENDER_API = (import.meta.env.VITE_API_BASE as string) || "";
      const res = await fetch(`${RENDER_API}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.role ?? null;
    } catch {
      return null;
    }
  }

  function markNeedsPassword(reason: string) {
    sessionStorage.setItem(NEEDS_PW_KEY, reason);
    setNeedsPasswordChange(true);
  }

  useEffect(() => {
    // Re-check hash in case it arrived after module load
    captureAuthHashType();
    if (sessionStorage.getItem(NEEDS_PW_KEY)) {
      setNeedsPasswordChange(true);
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session?.access_token) {
        const r = await fetchRole(session.access_token);
        setRole(r);
      }
      // After session is established from invite URL, normalize hash for wouter
      if (session && /access_token=/.test(window.location.hash)) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/`);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        if (session?.access_token) {
          const r = await fetchRole(session.access_token);
          setRole(r);
        } else {
          setRole(null);
        }

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

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        role,
        loading,
        needsPasswordChange,
        clearNeedsPasswordChange,
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

/** Returns true if the current user can make data changes (admin or editor) */
export function useCanEdit() {
  const { role } = useAuth();
  return role === "admin" || role === "editor";
}

/** Returns true if the current user can manage users / delete master leases */
export function useIsAdmin() {
  const { role } = useAuth();
  return role === "admin";
}
