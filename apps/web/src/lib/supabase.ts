import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * The browser holds the anon key and uses it for one thing: signing in. Every read and
 * every authorisation decision comes from the API, which verifies the JWT itself — see
 * docs/architecture.md. Nothing here should ever query a table.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * The demo account, when this deployment has one.
 *
 * Both values reach the browser deliberately: the same pair is printed at the top of
 * README.md, and a demo account whose password is a secret is a demo account nobody can
 * sign into. It holds no more access than the README already grants.
 *
 * Null when either is unset, which hides the button rather than shipping a control that
 * cannot work — see `docs/ui.md`, "nothing half-built".
 */
export const demoAccount =
  process.env.NEXT_PUBLIC_DEMO_EMAIL && process.env.NEXT_PUBLIC_DEMO_PASSWORD
    ? {
        email: process.env.NEXT_PUBLIC_DEMO_EMAIL,
        password: process.env.NEXT_PUBLIC_DEMO_PASSWORD,
      }
    : null;

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
