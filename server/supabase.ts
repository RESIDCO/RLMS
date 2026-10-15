import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });
dotenv.config();

/** Dev-only local UI review: repair against Postgres, no Supabase. */
export function isRepairLocalReviewMode(): boolean {
  return (
    process.env.REPAIR_LOCAL_DB === "1" &&
    process.env.REPAIR_DEV_BYPASS_AUTH === "1"
  );
}

function createLocalReviewStub(label: string): SupabaseClient {
  const err = () => {
    throw new Error(
      `LOCAL REVIEW MODE: Supabase is disabled (${label}). Repair uses local Postgres only.`,
    );
  };
  const thenable = {
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: "LOCAL REVIEW MODE: no Supabase" } }),
  };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: chain,
    insert: chain,
    update: chain,
    upsert: chain,
    delete: chain,
    eq: chain,
    neq: chain,
    ilike: chain,
    like: chain,
    is: chain,
    in: chain,
    order: chain,
    limit: chain,
    range: chain,
    maybeSingle: () => thenable,
    single: () => thenable,
    then: thenable.then,
  });

  return {
    auth: {
      getUser: async () => ({ data: { user: null }, error: { message: "LOCAL REVIEW MODE" } }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({ error: null }),
      admin: { listUsers: err, createUser: err, deleteUser: err, inviteUserByEmail: err },
    },
    from: () => builder,
    storage: { from: err },
    rpc: err,
  } as unknown as SupabaseClient;
}

let supabase: SupabaseClient;
let supabaseAdmin: SupabaseClient;

if (isRepairLocalReviewMode()) {
  // Banner is also printed from server/index.ts; keep this quiet if already noted.
  if (!process.env.REPAIR_LOCAL_REVIEW_BANNER_PRINTED) {
    console.log("============================================================");
    console.log(" LOCAL REVIEW MODE, no Supabase");
    console.log(" Repair module only — local Postgres (DATABASE_URL).");
    console.log("============================================================");
    process.env.REPAIR_LOCAL_REVIEW_BANNER_PRINTED = "1";
  }
  supabase = createLocalReviewStub("anon");
  supabaseAdmin = createLocalReviewStub("admin");
} else {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment");
  }

  // Standard client (anon key) — used for all data queries
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );

  // Admin client (service role key) — used only for user management (invite, delete auth users)
  // Falls back to anon client if service role key not configured
  supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } }
      )
    : supabase;
}

export { supabase, supabaseAdmin };
export default supabase;
