import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });
dotenv.config();

if (!process.env.SUPABASE_URL) {
  throw new Error("Missing SUPABASE_URL in environment");
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is required (verify it on Render). Refusing to start with the anon key as admin.",
  );
}

// Service-role client for every server database call. The browser keeps its
// own anon client for auth only. auth.getUser(token) validates the caller's
// JWT on this client, so login does not need a server-side anon client.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export const supabase = supabaseAdmin;

export default supabase;
