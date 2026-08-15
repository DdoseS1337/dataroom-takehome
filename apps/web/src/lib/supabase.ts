import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * The browser holds the anon key and uses it for one thing: signing in. Every read and
 * every authorisation decision comes from the API, which verifies the JWT itself — see
 * docs/architecture.md. Nothing here should ever query a table.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.",
    );
  }
  // Created on first use rather than at module scope: this module is imported by
  // components that Next also renders on the server, where there is no localStorage
  // for the session to live in.
  client ??= createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The OAuth redirect comes back with the session in the URL. Letting the client
      // pick it up is what removes the need for a /auth/callback route.
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });
  return client;
}
