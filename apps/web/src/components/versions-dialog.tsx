"use client";

import { DownloadIcon, HistoryIcon } from "lucide-react";
import { ErrorState, RowsSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes, formatDateTime } from "@/lib/format";
import {
  useDownloadVersion,
  useFileVersions,
  type FileVersion,
} from "@/lib/queries";

/**
 * The history "Replace" has been building since the upload block.
 *
 * Replacing a file never overwrites bytes: it writes a new `file_versions` row and
 * repoints the node at it, so every earlier document is still stored and still readable.
 * Until this panel there was nothing that said so, which made a correct and deliberate
 * design invisible — and made "Replace" look like the destructive act it is not.
 *
 * Owner only, in the menu and in the API both. See `useCanPerform('history')`.
 */
export function VersionsDialog({
  open,
  onOpenChange,
  fileId,
  name,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileId: string;
  name: string;
}) {
  const versions = useFileVersions(fileId, open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">Versions of “{name}”</DialogTitle>
          <DialogDescription>
            Uploading a file over this one keeps the old document rather than
            replacing it. Every version stays downloadable.
          </DialogDescription>
        </DialogHeader>

        {versions.isPending && (
          <RowsSkeleton rows={2} className="rounded-lg border" />
        )}

        {/* Branching on the code rather than on the message, like everywhere else: a file
            deleted from another tab while this was open gets its own wording, not a
            retry button that will never succeed. `back` is null — this is a dialog, and
            the way out of it is to close it. */}
        {versions.isError && (
          <div className="rounded-lg border">
            <ErrorState
              error={versions.error}
              onRetry={() => void versions.refetch()}
              back={null}
            />
          </div>
        )}

        {versions.data && (
          <ul className="divide-y rounded-lg border">
            {versions.data.map((version) => (
              <VersionRow key={version.id} fileId={fileId} version={version} />
            ))}
          </ul>
        )}

        {/* One version is the ordinary case, not an empty state — the file exists, so
            there is always at least one. Saying where a second would come from is more
            use than an icon and an apology. */}
        {versions.data?.length === 1 && (
          <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            <HistoryIcon className="mt-0.5 size-4 shrink-0" />
            This file has one version. Drop a file with the same name into this
            folder and choose Replace to add another.
          </p>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

function VersionRow({
  fileId,
  version,
}: {
  fileId: string;
  version: FileVersion;
}) {
  const download = useDownloadVersion();

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          Version {version.versionNo}
          {version.isCurrent && (
            <span className="rounded-full bg-accent px-1.5 text-xs font-normal text-accent-foreground">
              Current
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground tabular-nums">
          {formatBytes(version.sizeBytes)} ·{" "}
          {formatDateTime(version.createdAt)}
        </span>
      </span>

      <Button
        variant="ghost"
        size="sm"
        disabled={download.isPending}
        onClick={() => download.mutate({ fileId, versionId: version.id })}
      >
        <DownloadIcon />
        {download.isPending ? "Preparing…" : "Download"}
      </Button>
    </li>
  );
}
