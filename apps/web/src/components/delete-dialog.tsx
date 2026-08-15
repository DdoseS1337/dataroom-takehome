"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/format";
import { useNodeStats, type NodeStats } from "@/lib/queries";

/**
 * The numbers come from `GET /nodes/:id/stats`, computed server-side over the whole
 * subtree — never from the pages the client happens to hold, which are wrong the moment
 * the folder is larger than one page. See docs/ui.md.
 *
 * While they are loading the confirm button waits with them. Deleting is irreversible
 * here (there is no trash), so "delete an unknown quantity" is not an offer worth making.
 */
export function DeleteDialog({
  open,
  onOpenChange,
  nodeId,
  name,
  type,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string;
  name: string;
  type: "folder" | "file";
  onConfirm: () => Promise<unknown>;
}) {
  const stats = useNodeStats(type === "folder" ? nodeId : undefined, open);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // The mutation reports its own failure with a toast and puts the row back, so
      // there is nothing to say twice here — only a button to make usable again.
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{name}”?</DialogTitle>
          <DialogDescription>
            {type === "file"
              ? "This file will no longer be available to anyone it was shared with."
              : "Everything inside it goes too, and this cannot be undone."}
          </DialogDescription>
        </DialogHeader>

        {type === "folder" && (
          <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
            {stats.isPending && <Skeleton className="h-4 w-56" />}

            {stats.isError && (
              <span className="text-muted-foreground">
                Could not count what is inside this folder.{" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => void stats.refetch()}
                >
                  Try again
                </button>
              </span>
            )}

            {stats.data && <Contents stats={stats.data} />}
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>
            Cancel
          </DialogClose>
          <Button
            variant="destructive"
            disabled={pending || (type === "folder" && !stats.data)}
            onClick={() => void confirm()}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "This will delete 3 folders and 47 files (128 MB)." — the wording docs/ui.md asks
 * for: name what disappears, in the units the person is thinking in. */
function Contents({ stats }: { stats: NodeStats }) {
  if (stats.fileCount === 0 && stats.folderCount === 0) {
    return <span className="text-muted-foreground">This folder is empty.</span>;
  }

  const parts = [
    plural(stats.folderCount, "folder"),
    plural(stats.fileCount, "file"),
  ].filter((part) => part !== null);

  return (
    <span>
      This will delete {parts.join(" and ")}
      {stats.totalBytes > 0 && ` (${formatBytes(stats.totalBytes)})`}.
    </span>
  );
}

function plural(count: number, noun: string): string | null {
  if (count === 0) return null;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
