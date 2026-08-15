"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Skeleton rows, never a centred spinner: a spinner in an empty frame is the fastest
 * way for an app to look unfinished, and it is the first thing a reviewer sees.
 * Widths vary per row so the placeholder reads as a list of names, not a loading bar.
 */
export function RowsSkeleton({
  rows = 6,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  const widths = ["w-48", "w-64", "w-40", "w-56", "w-44", "w-60"];

  return (
    <div className={cn("divide-y divide-border", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-11 items-center gap-3 px-3">
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <Skeleton className={cn("h-3.5", widths[index % widths.length])} />
          <Skeleton className="ml-auto h-3.5 w-24" />
        </div>
      ))}
    </div>
  );
}

/** How the lines of a page of text fall — a title, then paragraphs that break unevenly.
 * Uniform bars read as a loading bar; these read as a document. */
const TEXT_LINES = [
  "w-full",
  "w-[92%]",
  "w-[97%]",
  "w-[64%]",
  "",
  "w-[88%]",
  "w-full",
  "w-[71%]",
];

/**
 * A sheet of paper, before there is one to show. It sits where the rendered page will
 * sit, in the same size and with the same edge, so the document arriving is a change of
 * content rather than a change of layout.
 *
 * `progress` turns it from a placeholder into a report: a large PDF is fetched in one
 * response — range requests never turn on, see README — and several silent seconds of a
 * grey rectangle read as a page that failed rather than one still coming.
 */
export function DocumentSkeleton({ progress }: { progress?: number }) {
  const percent = progress === undefined ? null : Math.round(progress * 100);

  return (
    <div
      className="relative mx-auto flex aspect-[1/1.414] w-full max-w-225 flex-col overflow-hidden rounded-lg bg-background p-[7%] shadow-sm ring-1 ring-foreground/10"
      // Only the one that reports progress is announced. The bare placeholder is
      // decoration, and a page of them would otherwise say "loading" once per page.
      role={percent === null ? undefined : "status"}
      aria-hidden={percent === null || undefined}
    >
      {/* One pulse for the whole block rather than one per line, so it breathes like a
          page instead of flickering like a list. */}
      <div className="animate-pulse space-y-3 motion-reduce:animate-none">
        <div className="h-3.5 w-2/5 rounded-full bg-muted-foreground/20" />
        <div className="space-y-2.5 pt-3">
          {TEXT_LINES.map((width, index) =>
            width === "" ? (
              <div key={index} className="h-2.5" />
            ) : (
              <div
                key={index}
                className={cn("h-2.5 rounded-full bg-muted", width)}
              />
            ),
          )}
        </div>
      </div>

      {percent !== null && (
        <div className="absolute inset-0 flex items-center justify-center">
          {/* Fixed geometry, and that is the whole point of it: the label and the number
              keep their places from 0% to 100%. A centred label that grows a digit at a
              time twitches left and right the entire way down, which is what a wait
              should not do. The moving part is the line above the page, so there is one
              bar rather than two saying the same thing. */}
          <div className="flex w-44 max-w-[78%] items-baseline gap-2 text-sm">
            <span className="flex-1 text-muted-foreground">Loading document</span>
            {/* A slot wide enough for "100%", so 7% and 45% do not shift the label. */}
            <span className="w-9 text-right font-medium tabular-nums">
              {percent > 0 ? `${percent}%` : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The document's own loading line, along the top edge of whatever is scrolling it.
 *
 * `sticky` rather than `absolute`, because it lives inside the scroll container and has
 * to stay at the top of the view rather than at the top of the content; and its own
 * height is cancelled with a negative margin, so it occupies no space and nothing below
 * it shifts by two pixels when it goes.
 *
 * Past 100% the transfer is done and the first page is being drawn — there is no
 * fraction left to report, so the line stops measuring and simply keeps moving.
 */
export function ProgressLine({ progress }: { progress: number }) {
  const percent = Math.round(progress * 100);

  return (
    <div className="sticky top-0 z-10 -mb-0.5 h-0.5 w-full overflow-hidden bg-primary/15">
      {percent > 0 && percent < 100 ? (
        <div
          className="h-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      ) : (
        // Deliberately still animated under `prefers-reduced-motion`: with no fraction
        // to show, this is the only thing saying the document is still coming. It is
        // two pixels tall and slow.
        <div className="h-full w-1/4 bg-primary animate-[indeterminate_1.6s_ease-in-out_infinite]" />
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground [&_svg]:size-5">
        {icon}
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

/** Where "back" goes from an error screen. A recipient inside a shared folder has no
 * data rooms to return to, and a revoked link has nowhere to go at all — hence `null`. */
export interface BackRoute {
  href: string;
  label: string;
}

const TO_ROOMS: BackRoute = { href: "/", label: "Back to data rooms" };

/**
 * Branches on `error.code`, never on message text. `NODE_GONE` is the case the brief
 * calls out — a folder deleted while someone is looking at it — and it gets a real
 * screen with a route back rather than a retry button that will never succeed.
 */
export function ErrorState({
  error,
  onRetry,
  back = TO_ROOMS,
}: {
  error: unknown;
  onRetry: () => void;
  back?: BackRoute | null;
}) {
  const code = error instanceof ApiError ? error.code : "INTERNAL";

  if (code === "NODE_GONE") {
    return (
      <Explanation
        title="This item was deleted by the owner"
        body="It is no longer available. Anything else you have access to is unaffected."
        back={back}
      />
    );
  }

  // Revoked or past its expiry. There is deliberately no retry and no route back: the
  // link itself is the only thing that ever led here, and it is finished.
  if (code === "SHARE_EXPIRED") {
    return (
      <Explanation
        title="This link no longer works"
        body={
          error instanceof ApiError
            ? error.message
            : "It was turned off by its owner."
        }
        back={null}
      />
    );
  }

  // A malformed id in the URL is a broken link, not a server fault. Retrying it will
  // never work, and the API's own wording ("Validation failed (uuid is expected)") is
  // written for a developer reading a response, not for whoever followed the link.
  if (code === "NOT_FOUND" || code === "VALIDATION_FAILED") {
    return (
      <Explanation
        title={code === "NOT_FOUND" ? "Not found" : "This link is not valid"}
        body={
          code === "NOT_FOUND"
            ? "This item does not exist, or you do not have access to it."
            : "The address is incomplete or mistyped."
        }
        back={back}
      />
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h2 className="text-sm font-medium">Could not load this</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {error instanceof ApiError
          ? error.message
          : "Something went wrong. Please try again."}
      </p>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** A dead end that is nobody's fault: said plainly, with a way out when there is one. */
export function Explanation({
  title,
  body,
  back,
  action,
}: {
  title: string;
  body: string;
  back?: BackRoute | null;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      {(action ?? back) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {action}
          {back && (
            <Button variant="outline" render={<Link href={back.href} />}>
              {back.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
