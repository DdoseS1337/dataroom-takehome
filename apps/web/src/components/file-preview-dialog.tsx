"use client";

import { DownloadIcon, FileWarningIcon, Trash2Icon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import {
  useDownloadFile,
  useDownloadUrl,
  useNode,
  type NodeSummary,
} from "@/lib/queries";

// pdf.js is the largest thing this app loads and only the preview needs it, so it comes
// down on the first open. `ssr: false` because the worker and the canvas are browser-only.
const PdfDocument = dynamic(
  () => import("@/components/pdf-document").then((module) => module.PdfDocument),
  {
    ssr: false,
    loading: () => <PageSkeleton />,
  },
);

/**
 * A modal over the list rather than a page of its own — `docs/ui.md` keeps the folder
 * behind it so the reader does not lose their place. The URL still carries the file, so
 * the view is linkable and Back closes it; the routing is done with `history.pushState`
 * so neither opening nor closing re-runs the folder's data fetching.
 */
export function FilePreviewDialog({
  fileId,
  known,
  onClose,
}: {
  fileId: string | null;
  /** The row this was opened from, when there is one. */
  known: NodeSummary | null;
  onClose: () => void;
}) {
  const open = fileId !== null;
  // Only for a file the listing has not paged in — a shared link, or a bookmark deep
  // into a long folder. It also carries the answer when the file is gone.
  const detail = useNode(open && !known ? fileId : undefined);
  const url = useDownloadUrl(fileId ?? undefined, open);
  const download = useDownloadFile();

  /** react-pdf rejecting the document — a corrupt file, or a URL that lapsed before it
   * was read. Held by URL, so a retry with a fresh one starts clean. */
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const name = known?.name ?? detail.data?.node.name ?? "";
  const sizeBytes = known?.sizeBytes ?? null;
  const failure = url.error ?? detail.error;
  const deleted = failure instanceof ApiError && failure.code === "NODE_GONE";
  const unavailable =
    failure !== null || (url.data !== undefined && failedUrl === url.data.url);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[92vh] w-[min(64rem,calc(100%-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate">
              {name || "Loading…"}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">
              {sizeBytes === null ? "PDF document" : formatBytes(sizeBytes)}
            </DialogDescription>
          </div>

          {/* Absent rather than disabled once the file is gone: there is nothing left
              to download, and the body already says so. */}
          {!deleted && (
            <Button
              variant="outline"
              size="sm"
              disabled={!fileId || download.isPending}
              onClick={() => fileId && download.mutate(fileId)}
            >
              <DownloadIcon />
              {download.isPending ? "Preparing…" : "Download"}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/40">
          {unavailable ? (
            <Unavailable
              // A file deleted while someone is reading it is a different event from a
              // document the browser could not draw, and saying "Preview unavailable"
              // for it would send the reader looking for a fault on their side.
              gone={deleted}
              reason={failure instanceof ApiError ? failure.message : null}
              onDownload={() => fileId && download.mutate(fileId)}
              onRetry={() => {
                setFailedUrl(null);
                void url.refetch();
                void detail.refetch();
              }}
              downloading={download.isPending}
            />
          ) : url.data ? (
            <PdfDocument
              key={url.data.url}
              url={url.data.url}
              onFailed={() => setFailedUrl(url.data.url)}
            />
          ) : (
            <PageSkeleton />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The document could not be rendered, for a reason the reader cannot fix. The file
 * itself is still theirs to take, so the download is the primary action here rather
 * than a consolation link.
 */
function Unavailable({
  gone,
  reason,
  onDownload,
  onRetry,
  downloading,
}: {
  /** The file was deleted by its owner — nothing here will start working. */
  gone: boolean;
  /** The API's own words, when it had any. A document pdf.js simply refused has none. */
  reason: string | null;
  onDownload: () => void;
  onRetry: () => void;
  downloading: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
        {gone ? (
          <Trash2Icon className="size-5" />
        ) : (
          <FileWarningIcon className="size-5" />
        )}
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-medium">
          {gone ? "This file was deleted by the owner" : "Preview unavailable"}
        </h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {gone
            ? "It is no longer available. Anything else you have access to is unaffected."
            : (reason ??
              "This document could not be displayed in the browser. You can still download it and open it locally.")}
        </p>
      </div>
      {/* Neither control can succeed against a file that no longer exists, and a button
          that cannot work is worse than no button. Closing is the only move left. */}
      {!gone && (
        <div className="flex items-center gap-2">
          <Button disabled={downloading} onClick={onDownload}>
            <DownloadIcon />
            {downloading ? "Preparing…" : "Download"}
          </Button>
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col items-center gap-4 p-4">
      <Skeleton className="aspect-[1/1.414] w-full max-w-225 rounded-lg" />
    </div>
  );
}
