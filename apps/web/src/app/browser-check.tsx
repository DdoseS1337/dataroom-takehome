"use client";

import { useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; db: "up" | "down" }
  | { kind: "error"; message: string };

/**
 * The server-rendered check above proves the API is reachable from the hosting
 * platform. This one runs in the browser, from the real page origin, which is the
 * only way to prove CORS is configured correctly — a mistake that otherwise stays
 * hidden until the first real request in Block 2.
 */
export function BrowserCheck({ apiUrl }: { apiUrl: string | undefined }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function run() {
    if (!apiUrl) {
      setState({
        kind: "error",
        message: "NEXT_PUBLIC_API_URL is not set in this environment.",
      });
      return;
    }

    setState({ kind: "loading" });
    try {
      const response = await fetch(`${apiUrl}/health`, { cache: "no-store" });
      if (!response.ok) {
        setState({
          kind: "error",
          message: `API responded ${response.status} ${response.statusText}.`,
        });
        return;
      }
      const health = (await response.json()) as { db: "up" | "down" };
      setState({ kind: "ok", db: health.db });
    } catch {
      // A CORS rejection and an unreachable host look identical from here, so the
      // message names both rather than guessing.
      setState({
        kind: "error",
        message: `Could not reach ${apiUrl} — the API is down, or this origin is not in FRONTEND_ORIGIN.`,
      });
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void run()}
        disabled={state.kind === "loading"}
        className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
      >
        {state.kind === "loading" ? "Checking…" : "Check from this browser"}
      </button>

      {state.kind === "ok" && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          Reached the API from this origin. Database is {state.db}.
        </p>
      )}

      {state.kind === "error" && (
        <p className="text-sm text-red-700 dark:text-red-400">{state.message}</p>
      )}
    </div>
  );
}
