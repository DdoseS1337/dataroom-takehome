import { BrowserCheck } from "./browser-check";

/**
 * Block 1 only. This route becomes the data room list in Block 2 — it exists now to
 * prove the deployed frontend reaches the deployed API, which is the one thing a
 * scaffold can get wrong in a way that stays hidden until much later.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL;

// The whole point is the live state of another service, so this must never be
// prerendered at build time.
export const dynamic = "force-dynamic";

type Result =
  | { ok: true; db: "up" | "down"; time: string }
  | { ok: false; message: string };

async function checkApi(): Promise<Result> {
  if (!API_URL) {
    return { ok: false, message: "NEXT_PUBLIC_API_URL is not set." };
  }

  try {
    const response = await fetch(`${API_URL}/health`, { cache: "no-store" });
    if (!response.ok) {
      return {
        ok: false,
        message: `API responded ${response.status} ${response.statusText}.`,
      };
    }
    const health = (await response.json()) as { db: "up" | "down"; time: string };
    return { ok: true, db: health.db, time: health.time };
  } catch {
    return { ok: false, message: `Could not reach ${API_URL}.` };
  }
}

export default async function HealthPage() {
  const result = await checkApi();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Data Room</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Scaffold check — the frontend reaching the API.
        </p>
      </header>

      {result.ok ? (
        <dl className="divide-y divide-black/5 rounded-lg border border-black/10 text-sm dark:divide-white/10 dark:border-white/15">
          <Row label="API" value="reachable" ok />
          <Row
            label="Database"
            value={result.db === "up" ? "connected" : "unreachable"}
            ok={result.db === "up"}
          />
          <Row label="Checked" value={result.time} />
        </dl>
      ) : (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          {result.message}
        </div>
      )}

      <BrowserCheck apiUrl={API_URL} />
    </main>
  );
}

function Row({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-black/60 dark:text-white/60">{label}</dt>
      <dd className="flex items-center gap-2 font-medium">
        {ok !== undefined && (
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"}`}
          />
        )}
        {value}
      </dd>
    </div>
  );
}
