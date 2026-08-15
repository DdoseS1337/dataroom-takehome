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
import { DocumentSkeleton, ProgressLine } from "@/components/states";
import { ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import {
  useDownloadFile,
  useDownloadUrl,
  useNode,
  type ApiBase,
  type NodeSummary,
} from "@/lib/queries";

// pdf.js is the largest thing this app loads and only the preview needs it, so it comes
// down on the first open. `ssr: false` because the worker and the canvas are browser-only.
//
// The placeholder is imported from `states` rather than from the module below it: taking
// it from `pdf-document` would pull pdf.js into the main bundle and undo the split.
const PdfDocument = dynamic(
  () => import("@/components/pdf-document").then((module) => module.PdfDocument),
  {
    ssr: false,
    // The same placeholder the document itself waits behind, so the chunk arriving
    // changes nothing on screen.
    loading: () => <DocumentSkeleton progress={0} />,
  },
);

/**
 * A modal over the list rather than a page of its own — `docs/ui.md` keeps the folder
 * behind it so the reader does not lose their place. The URL still carries the file, so
 * the view is linkable and Back closes it; the routing is done with `history.pushState`
 * so neither opening nor closing re-runs the folder's data fetching.
 *
 * A link shared on a single file has no folder behind it and renders `PreviewBody`
 * directly instead — same document, same states, its own chrome.
 */
export function FilePreviewDialog({
  fileId,
  base = "",
  known,
  onClose,
}: {
  fileId: string | null;
  base?: ApiBase;
  /** The row this was opened from, when there is one. */
  known: NodeSummary | null;
  onClose: () => void;
}) {
  const open = fileId !== null;
  const preview = usePdfPreview(fileId, base, open, known);
  const download = useDownloadFile(base);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[92vh] w-[min(64rem,calc(100%-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate">
              {preview.name || "Loading…"}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">
              {preview.sizeBytes === null
                ? "PDF document"
                : formatBytes(preview.sizeBytes)}
            </DialogDescription>
          </div>

          {/* Absent rather than disabled once the file is gone: there is nothing left
              to download, and the body already says so. */}
          {!preview.gone && (
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
          <PreviewBody
            preview={preview}
            downloading={download.isPending}
            onDownload={() => fileId && download.mutate(fileId)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface PdfPreview {
  name: string;
  sizeBytes: number | null;
  url: string | null;
  /** Nothing will render: the document was refused, or the API was. */
  unavailable: boolean;
  /** Deleted by its owner — a different event from a document that would not draw. */
  gone: boolean;
  /** The API's own words, when it had any. */
  reason: string | null;
  onFailed: () => void;
  retry: () => void;
}

/**
 * Everything the preview needs to know, whether it is drawn in a dialog over a listing
 * or on a page of its own. Kept as a hook rather than a component so the two can have
 * different chrome without a second copy of the failure logic — which is where the
 * difference between "deleted" and "could not be displayed" lives.
 */
export function usePdfPreview(
  fileId: string | null,
  base: ApiBase,
  enabled: boolean,
  known: NodeSummary | null = null,
): PdfPreview {
  // Only for a file the listing has not paged in — a shared link, or a bookmark deep
  // into a long folder. It also carries the answer when the file is gone.
  const detail = useNode(enabled && !known ? (fileId ?? undefined) : undefined, base);
  const url = useDownloadUrl(fileId ?? undefined, enabled, base);

  /** react-pdf rejecting the document — a corrupt file, or a URL that lapsed before it
   * was read. Held by URL, so a retry with a fresh one starts clean. */
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const failure = url.error ?? detail.error;
  const gone = failure instanceof ApiError && failure.code === "NODE_GONE";

  return {
    name: known?.name ?? detail.data?.node.name ?? "",
    sizeBytes: known?.sizeBytes ?? null,
    url: url.data?.url ?? null,
    unavailable:
      failure !== null ||
      (url.data !== undefined && failedUrl === url.data.url),
    gone,
    reason: failure instanceof ApiError ? failure.message : null,
    onFailed: () => setFailedUrl(url.data?.url ?? null),
    retry: () => {
      setFailedUrl(null);
      void url.refetch();
      void detail.refetch();
    },
  };
}

/** The document itself, or the reason there is none. No dialog parts, so this renders
 * as happily on a page as it does inside a modal. */
export function PreviewBody({
  preview,
  downloading,
  onDownload,
}: {
  preview: PdfPreview;
  downloading: boolean;
  onDownload: () => void;
}) {
  if (preview.unavailable) {
    return (
      <Unavailable
        // A file deleted while someone is reading it is a different event from a
        // document the browser could not draw, and saying "Preview unavailable"
        // for it would send the reader looking for a fault on their side.
        gone={preview.gone}
        reason={preview.reason}
        onDownload={onDownload}
        onRetry={preview.retry}
        downloading={downloading}
      />
    );
  }

  // Keyed so that going from "no URL yet" to a URL — or retrying with a fresh one —
  // starts the line at zero rather than inheriting the last one's finished state.
  return (
    <PreviewContent
      key={preview.url ?? "pending"}
      url={preview.url}
      onFailed={preview.onFailed}
    />
  );
}

/**
 * Everything between opening the preview and seeing a page, as one uninterrupted state:
 * a sheet of paper where the page will be, and a line along the top edge.
 *
 * There are four waits in a row here — the signed URL, the pdf.js chunk, the document
 * itself, and rasterising the first page — and they used to look like four different
 * things, with gaps between them where one placeholder had gone and the next had not
 * arrived. Nothing appears or disappears now until the page does; only the numbers move.
 *
 * The line lives at this level rather than inside `PdfDocument` for the same reason: it
 * has to be on screen before that component exists, and it has to stay at the top of the
 * view while a document of a hundred pages scrolls underneath it.
 */
function PreviewContent({
  url,
  onFailed,
}: {
  url: string | null;
  onFailed: () => void;
}) {
  /** `null` once the first page is on screen. Until then it is the whole of what this
   * preview is waiting on, and it drives all three things below at once. */
  const [progress, setProgress] = useState<number | null>(0);
  const waiting = progress !== null;

  return (
    <>
      {waiting && <ProgressLine progress={progress} />}
      <div className="relative p-4">
        {waiting && <DocumentSkeleton progress={progress} />}

        {url && (
          // `invisible`, not `hidden`: the document has to keep a layout box while it
          // waits, because the width it renders its pages at is measured from this
          // element. With `display: none` that measurement is zero, no page ever
          // renders, and the wait never ends. Taken out of the flow so the placeholder
          // above is what gives the frame its height.
          <div
            className={
              waiting ? "invisible absolute inset-x-4 top-4" : undefined
            }
          >
            <PdfDocument
              url={url}
              onFailed={onFailed}
              onProgress={setProgress}
            />
          </div>
        )}
      </div>
    </>
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
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center">
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

