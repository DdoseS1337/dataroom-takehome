import { getSupabase } from "./supabase";

/**
 * The API's machine-readable error codes, plus `NETWORK` for the case the API never
 * answered. The UI branches on these and never on message text — see docs/ui.md.
 */
export type ErrorCode =
  | "NAME_CONFLICT"
  | "NODE_GONE"
  | "CYCLE_DETECTED"
  | "FORBIDDEN"
  | "SHARE_EXPIRED"
  | "WRONG_ACCOUNT"
  | "NOT_FOUND"
  | "UNAUTHENTICATED"
  | "VALIDATION_FAILED"
  | "INTERNAL"
  | "NETWORK";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL;

interface Options {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiFetch<T>(
  path: string,
  { method = "GET", body, signal }: Options = {},
): Promise<T> {
  if (!API_URL) {
    throw new ApiError("INTERNAL", "NEXT_PUBLIC_API_URL is not set.", 0);
  }

  // getSession refreshes an expired token before handing it over, so a long-idle tab
  // does not send a stale one and get a 401 it would have to recover from.
  const {
    data: { session },
  } = await getSupabase().auth.getSession();

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      signal,
      headers: {
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    // An aborted request is the caller changing its mind, not a failure to report.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(
      "NETWORK",
      "Could not reach the server. Check your connection and try again.",
      0,
    );
  }

  if (response.status === 204) return undefined as T;

  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = raw.length > 0 ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ApiError(
      codeOf(payload),
      messageOf(payload),
      response.status,
      detailsOf(payload),
    );
  }

  // Every successful route in this API answers with JSON. A 2xx that is not JSON means
  // something in front of the API answered instead — a proxy or a login interstitial.
  // Returning null here would surface much later as a blank screen on a property read.
  if (payload === null) {
    throw new ApiError(
      "INTERNAL",
      "The server returned an unexpected response.",
      response.status,
    );
  }

  return payload as T;
}

function codeOf(payload: unknown): ErrorCode {
  const code = (payload as { code?: unknown } | null)?.code;
  return typeof code === "string" ? (code as ErrorCode) : "INTERNAL";
}

function messageOf(payload: unknown): string {
  const message = (payload as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.length > 0
    ? message
    : "Something went wrong. Please try again.";
}

function detailsOf(payload: unknown): Record<string, unknown> | undefined {
  const details = (payload as { details?: unknown } | null)?.details;
  return typeof details === "object" && details !== null
    ? (details as Record<string, unknown>)
    : undefined;
}
