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

/**
 * Branches on `error.code`, never on message text. `NODE_GONE` is the case the brief
 * calls out — a folder deleted while someone is looking at it — and it gets a real
 * screen with a route back rather than a retry button that will never succeed.
 */
export function ErrorState({
  error,
  onRetry,
  backHref = "/",
}: {
  error: unknown;
  onRetry: () => void;
  backHref?: string;
}) {
  const code = error instanceof ApiError ? error.code : "INTERNAL";

  if (code === "NODE_GONE") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <h2 className="text-sm font-medium">
          This item was deleted by the owner
        </h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          It is no longer available. Anything else you have access to is
          unaffected.
        </p>
        <Button variant="outline" render={<Link href={backHref} />}>
          Back to data rooms
        </Button>
      </div>
    );
  }

  if (code === "NOT_FOUND") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <h2 className="text-sm font-medium">Not found</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          This item does not exist, or you do not have access to it.
        </p>
        <Button variant="outline" render={<Link href={backHref} />}>
          Back to data rooms
        </Button>
      </div>
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
