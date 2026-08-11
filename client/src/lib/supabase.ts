import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Set both in the environment — hardcoded Supabase credentials are not allowed."
  );
}

// In-memory storage adapter — avoids localStorage/sessionStorage which are
// blocked in sandboxed iframes. Sessions persist for the tab lifetime.
const memoryStore: Record<string, string> = {};
const memoryStorage = {
  getItem: (key: string) => memoryStore[key] ?? null,
  setItem: (key: string, value: string) => { memoryStore[key] = value; },
  removeItem: (key: string) => { delete memoryStore[key]; },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: memoryStorage,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
