import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const localReview = import.meta.env.VITE_REPAIR_LOCAL_REVIEW === "1";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function createLocalReviewClient(): SupabaseClient {
  const noopSub = { unsubscribe() {} };
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: noopSub } }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({
        data: { user: null, session: null },
        error: { message: "LOCAL REVIEW MODE: no Supabase login" },
      }),
      signInWithOAuth: async () => ({
        data: { provider: "azure", url: null },
        error: { message: "LOCAL REVIEW MODE: no Supabase login" },
      }),
      updateUser: async () => ({
        data: { user: null },
        error: { message: "LOCAL REVIEW MODE: no Supabase" },
      }),
      verifyOtp: async () => ({
        data: { user: null, session: null },
        error: { message: "LOCAL REVIEW MODE: no Supabase" },
      }),
    },
    from: () => {
      throw new Error("LOCAL REVIEW MODE: Supabase data client disabled");
    },
  } as unknown as SupabaseClient;
}

if (localReview) {
  // Local UI review against Postgres only — no VITE_SUPABASE_* required.
} else if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Set both in the environment — hardcoded Supabase credentials are not allowed.",
  );
}

/**
 * Persist sessions in localStorage so invite → set-password → dashboard
 * survives reloads. (Memory-only storage caused invitees to fall back to
 * the normal sign-in form with no password set.)
 *
 * In LOCAL REVIEW MODE (VITE_REPAIR_LOCAL_REVIEW=1) we export a stub so the
 * SPA boots without Supabase; shop/lessee/admin repair screens use repair APIs.
 */
export const supabase: SupabaseClient = localReview
  ? createLocalReviewClient()
  : createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "implicit",
      },
    });
