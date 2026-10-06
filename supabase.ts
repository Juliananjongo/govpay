import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const sandboxMode =
  import.meta.env.DEV && import.meta.env.VITE_SANDBOX_MODE !== "false";

export const supabase =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true,
        },
      })
    : null;

export const supabaseConfigurationError =
  !url || !anonKey
    ? "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to connect the production backend."
    : null;
