"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useUploadActions,
  useUploadItems,
  type UploadItem,
} from "@/lib/uploads";

/**
 * A name collision is answered, never resolved silently. In due diligence a file that
 * quietly becomes `MSA (1).pdf` means someone opens the wrong document and nobody finds
 * out — see docs/data-model.md.
 *
 * One dialog for the whole queue: conflicts are answered one at a time, and "apply to
 * all" carries the answer to the rest of the batch.
 */
export function UploadConflictDialog() {
  const items = useUploadItems();
  const waiting = items.filter((item) => item.status === "conflict");
  const first = waiting[0];
  if (!first) return null;

  // Everything still ahead of this answer: the other conflicts plus anything queued or
  // uploading that could still collide.
  const remaining =
    items.filter(
      (item) =>
        item.id !== first.id &&
        (item.status === "conflict" ||
          item.status === "pending" ||
          item.status === "uploading"),
    ).length > 0;

  // Keyed so the checkbox resets for each file rather than carrying an answer forward.
  return <Prompt key={first.id} item={first} offerApplyToAll={remaining} />;
}

function Prompt({
  item,
  offerApplyToAll,
}: {
  item: UploadItem;
  offerApplyToAll: boolean;
}) {
  const { resolveConflict } = useUploadActions();
  const [applyToAll, setApplyToAll] = useState(false);

  // A folder holds the name, so there is no version history to add to and Replace is
  // not offered at all rather than offered and refused.
  const replaceable = item.existingType !== "folder";

  return (
    <Dialog
      open
      // Escape and the backdrop mean "do nothing with this file", not the default
      // action — creating a second copy is not something to do without being asked.
      onOpenChange={(open) => {
        if (!open) resolveConflict(item.id, "skip", applyToAll);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>This name is already taken</DialogTitle>
          <DialogDescription>
            {replaceable ? (
              <>
                A file named <Name>{item.name}</Name> already exists in this
                folder. Keeping both uploads this one under a new name; replacing
                adds a new version and keeps the current file in its history.
              </>
            ) : (
              <>
                A folder named <Name>{item.name}</Name> already exists here.
                Files and folders share one namespace, so this file has to take a
                different name.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {offerApplyToAll && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={applyToAll}
              onChange={(event) => setApplyToAll(event.target.checked)}
            />
            Apply to the rest of this upload
          </label>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => resolveConflict(item.id, "skip", applyToAll)}
          >
            Skip
          </Button>
          {replaceable && (
            <Button
              variant="outline"
              onClick={() => resolveConflict(item.id, "replace", applyToAll)}
            >
              Replace
            </Button>
          )}
          <Button
            autoFocus
            onClick={() => resolveConflict(item.id, "keepBoth", applyToAll)}
          >
            Keep both
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Name({ children }: { children: string }) {
  return <span className="font-medium text-foreground">“{children}”</span>;
}
