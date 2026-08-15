"use client";

import { VaultIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeReturnPath, useAuth } from "@/lib/auth";
import {
  demoAccount,
  getSupabase,
  isSupabaseConfigured,
} from "@/lib/supabase";

/** Which action is in flight. One value rather than three booleans, so every control
 *  disables together and only the one that was pressed changes its label. */
type Pending = "demo" | "google" | "password" | null;

type Mode = "signIn" | "signUp";

export default function LoginPage() {
  const state = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  // Landing here with a live session — a bookmark, or the OAuth redirect resolving —
  // should go straight through rather than showing a sign-in button that does nothing.
  useEffect(() => {
    if (state.status === "signedIn") router.replace(returnPath());
  }, [state.status, router]);

  const busy = pending !== null || state.status === "loading";

  function start(action: Exclude<Pending, null>) {
    setPending(action);
    setError(null);
    setNotice(null);
  }

  async function signInWithGoogle() {
    start("google");
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
    if (authError) fail(authError);
    // On success the browser navigates away, so `pending` stays true on purpose.
  }

  async function signInWithDemo() {
    if (!demoAccount) return;
    start("demo");
    const { error: authError } = await getSupabase().auth.signInWithPassword(
      demoAccount,
    );
    if (authError) fail(authError);
    // On success the auth listener flips the state and the effect above redirects, so
    // `pending` stays set here too — releasing it would allow a second submission into
    // the render that is already navigating.
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    start("password");
    const auth = getSupabase().auth;

    if (mode === "signIn") {
      const { error: authError } = await auth.signInWithPassword({
        email,
        password,
      });
      if (authError) fail(authError);
      return;
    }

    const { data, error: authError } = await auth.signUp({ email, password });
    if (authError) {
      fail(authError);
      return;
    }
    // A project with "Confirm email" left on returns no session and sends a mail
    // instead. README.md says to turn it off, but a deployment that did not is a
    // configuration this screen can describe rather than hang on.
    if (!data.session) {
      setPending(null);
      setNotice(
        "Check your inbox and confirm this address, then come back and sign in.",
      );
    }
  }

  function fail(authError: { message: string; code?: string }) {
    setPending(null);
    setError(readable(authError));
  }

  function switchMode() {
    setMode(mode === "signIn" ? "signUp" : "signIn");
    setError(null);
    setNotice(null);
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <VaultIcon className="size-4.5" />
          </div>
          <h1 className="text-xl font-medium tracking-tight">Data Room</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to open your data rooms and the documents shared with you.
          </p>
        </div>

        {!isSupabaseConfigured ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Sign-in is unavailable: this deployment is missing its Supabase
            environment variables.
          </p>
        ) : (
          <div className="space-y-5">
            {/* Both the button and the rule below it are conditional: a deployment
                without demo credentials would otherwise open on an "or" separating
                nothing from the sign-in options. */}
            {demoAccount && (
              <>
                <div className="space-y-2">
                  <Button
                    size="lg"
                    className="w-full"
                    disabled={busy}
                    onClick={() => void signInWithDemo()}
                  >
                    {pending === "demo" ? "Signing in…" : "Try demo account"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Opens a data room that is already filled in. The account is
                    shared and everything in it can be edited, so treat what you
                    find there as somebody else&rsquo;s last visit.
                  </p>
                </div>
                <Divider />
              </>
            )}

            <Button
              variant="outline"
              size="lg"
              className="w-full"
              disabled={busy}
              onClick={() => void signInWithGoogle()}
            >
              <GoogleMark />
              {pending === "google" ? "Opening Google…" : "Continue with Google"}
            </Button>

            <form className="space-y-3" onSubmit={(event) => void submit(event)}>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="h-9"
                  value={email}
                  disabled={busy}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={
                    mode === "signIn" ? "current-password" : "new-password"
                  }
                  className="h-9"
                  value={password}
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <Button
                type="submit"
                variant="secondary"
                size="lg"
                className="w-full"
                disabled={busy}
              >
                {submitLabel(mode, pending)}
              </Button>
            </form>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="text-sm text-muted-foreground" role="status">
                {notice}
              </p>
            )}

            <p className="text-sm text-muted-foreground">
              {mode === "signIn"
                ? "No account yet? "
                : "Already have an account? "}
              <button
                type="button"
                className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={switchMode}
              >
                {mode === "signIn" ? "Create one" : "Sign in"}
              </button>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function submitLabel(mode: Mode, pending: Pending): string {
  if (pending === "password") {
    return mode === "signIn" ? "Signing in…" : "Creating account…";
  }
  return mode === "signIn" ? "Sign in" : "Create account";
}

/**
 * Supabase error codes, turned into something a person can act on. Branching on `code`
 * rather than on message text, for the reason `docs/ui.md` gives about API errors: the
 * text is not a contract. Anything unrecognised falls through to what the service said,
 * which is better than a generic apology that hides a real configuration problem.
 */
function readable(authError: { message: string; code?: string }): string {
  switch (authError.code) {
    case "invalid_credentials":
      return "That email and password do not match an account.";
    case "email_not_confirmed":
      return "This address has not been confirmed yet. Check your inbox.";
    case "user_already_exists":
    case "email_exists":
      return "An account already exists for this address. Sign in instead.";
    case "weak_password":
      return "Choose a password of at least six characters.";
    case "signup_disabled":
      return "New accounts are turned off on this deployment.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many attempts. Wait a minute and try again.";
    default:
      return authError.message;
  }
}

function Divider() {
  return (
    <div className="flex items-center gap-3" aria-hidden>
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground">or</span>
      <span className="h-px flex-1 bg-border" />
    </div>
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
