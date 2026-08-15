"use client";

import { VaultIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { safeReturnPath, useAuth } from "@/lib/auth";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

export default function LoginPage() {
  const state = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Landing here with a live session — a bookmark, or the OAuth redirect resolving —
  // should go straight through rather than showing a sign-in button that does nothing.
  useEffect(() => {
    if (state.status === "signedIn") router.replace(returnPath());
  }, [state.status, router]);

  async function signInWithGoogle() {
    setPending(true);
    setError(null);
    const { error: authError } = await getSupabase().auth.signInWithOAuth({
      provider: "google",
      options: {
        // Absolute, and read at click time: the same build serves localhost, previews
        // and production, so a value baked in at build time would send two of them
        // elsewhere. The path carries the folder the visitor was actually trying to open.
        redirectTo: `${window.location.origin}${returnPath()}`,
        // Arriving from "wrong account" on a shared link. Without it Google signs the
        // visitor straight back in as the account that was just refused, and the switch
        // button appears to do nothing.
        ...(isSwitching() ? { queryParams: { prompt: "select_account" } } : {}),
      },
    });
    if (authError) {
      setPending(false);
      setError(authError.message);
    }
    // On success the browser navigates away, so `pending` stays true on purpose.
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <VaultIcon className="size-4.5" />
          </div>
          <h1 className="text-xl font-medium tracking-tight">Data Room</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to open your data rooms and the documents shared with you.
          </p>
        </div>

        {isSupabaseConfigured ? (
          <div className="space-y-3">
            <Button
              size="lg"
              className="w-full"
              disabled={pending || state.status === "loading"}
              onClick={() => void signInWithGoogle()}
            >
              <GoogleMark />
              {pending ? "Opening Google…" : "Continue with Google"}
            </Button>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Sign-in is unavailable: this deployment is missing its Supabase
            environment variables.
          </p>
        )}
      </div>
    </main>
  );
}

/** Read from `window` rather than `useSearchParams`, which would opt this statically
 *  prerendered page out of its HTML. Both call sites are click- or effect-time. */
function returnPath(): string {
  return safeReturnPath(new URLSearchParams(window.location.search).get("next"));
}

function isSwitching(): boolean {
  return new URLSearchParams(window.location.search).get("switch") === "1";
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden className="size-4">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
