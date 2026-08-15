"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getSupabase, isSupabaseConfigured } from "./supabase";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: SessionUser };

const AuthContext = createContext<AuthState>({ status: "loading" });

export function AuthProvider({ children }: { children: ReactNode }) {
  // Whether Supabase is configured is known at module load, so it belongs in the
  // initial value. Deciding it inside the effect would be a synchronous setState in an
  // effect body — a cascading render, and an error under react-hooks lint.
  const [state, setState] = useState<AuthState>(() =>
    isSupabaseConfigured ? { status: "loading" } : { status: "signedOut" },
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    // onAuthStateChange fires INITIAL_SESSION on subscribe, so this one subscription
    // covers the first read, the OAuth redirect landing, token refreshes and sign-out.
    // Reading the session separately would race with it.
    const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
      setState(
        session
          ? { status: "signedIn", user: toSessionUser(session) }
          : { status: "signedOut" },
      );
    });

    return () => data.subscription.unsubscribe();
  }, []);

  return <AuthContext value={state}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
}

/**
 * The session lives in localStorage, which middleware on the server cannot see, so the
 * gate is here rather than in a route matcher. Loading renders a skeleton instead of
 * nothing: a blank frame while the session resolves is the flash every auth-gated app
 * gets wrong.
 */
export function AuthGate({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  const state = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "signedOut") router.replace("/login");
  }, [state.status, router]);

  if (state.status === "signedIn") return <>{children}</>;
  return <>{fallback}</>;
}

function toSessionUser(session: {
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> };
}): SessionUser {
  const metadata = session.user.user_metadata ?? {};
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: pickString(metadata, "full_name", "name"),
    avatarUrl: pickString(metadata, "avatar_url", "picture"),
  };
}

function pickString(
  source: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}
