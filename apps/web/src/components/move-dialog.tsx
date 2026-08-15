"use client";

import { ChevronRightIcon, FolderIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { RowsSkeleton } from "@/components/states";
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
import { ApiError } from "@/lib/api";
import {
  useChildren,
  useNode,
  type ConflictChoice,
  type NodeSummary,
} from "@/lib/queries";

/**
 * A destination picker that walks down one level at a time, rather than a tree.
 *
 * `docs/ui.md` rejected a folder tree in the sidebar because it duplicates state that
 * already lives in the listing and keeping the two in step is the largest source of bugs
 * in this kind of UI. The same reasoning applies here — and a drill-down reuses
 * `GET /nodes/:id/children` with the keyset paging it already has, so it behaves the
 * same in a folder of ten and a folder of ten thousand.
 *
 * It opens on the item's current folder, so "move up one level" and "move into a
 * sibling" — the two common moves — are one click each.
 */
export function MoveDialog({
  open,
  onOpenChange,
  item,
  currentParentId,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: NodeSummary;
  currentParentId: string;
  onMove: (targetId: string, onConflict?: ConflictChoice) => Promise<unknown>;
}) {
  const [targetId, setTargetId] = useState(currentParentId);
  const [pending, setPending] = useState(false);
  /** The clash the destination answered with, and the question now on screen. */
  const [clash, setClash] = useState<ApiError | null>(null);

  const target = useNode(open ? targetId : undefined);
  const children = useChildren(open ? targetId : undefined);

  const rows = children.data?.pages.flatMap((page) => page.items) ?? [];
  const folders = rows.filter((row) => row.type === "folder");
  // Folders sort before files, so once a file appears every folder has been seen and
  // paging further would only fetch rows this list throws away.
  const moreFolders =
    children.hasNextPage && rows[rows.length - 1]?.type === "folder";

  const alreadyThere = targetId === currentParentId;

  async function move(onConflict?: ConflictChoice) {
    setPending(true);
    setClash(null);
    try {
      await onMove(targetId, onConflict);
      onOpenChange(false);
    } catch (error) {
      setPending(false);
      // A clash is a question, not a failure: the dialog asks it here rather than
      // closing and leaving a toast to explain what did not happen.
      if (error instanceof ApiError && error.code === "NAME_CONFLICT") {
        setClash(error);
      }
      // Anything else was reported by the mutation's toast, and the destination the
      // user picked stays on screen for them to change.
    }
  }

  function close(next: boolean) {
    if (!next) {
      setTargetId(currentParentId);
      setPending(false);
      setClash(null);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move “{item.name}”</DialogTitle>
          <DialogDescription>
            {clash
              ? "That name is already taken where you are moving this."
              : "Choose a destination folder, then move the item into it."}
          </DialogDescription>
        </DialogHeader>

        {clash ? (
          <Clash
            message={clash.message}
            replaceable={
              item.type === "file" && clash.details?.existingType === "file"
            }
            pending={pending}
            onChoose={(choice) => void move(choice)}
            onBack={() => setClash(null)}
          />
        ) : (
          <>
        <div className="space-y-2">
          <nav
            aria-label="Destination"
            className="flex flex-wrap items-center gap-0.5 text-sm"
          >
            {(target.data?.breadcrumbs ?? []).map((crumb, index) => (
              <span key={crumb.id} className="flex items-center gap-0.5">
                {index > 0 && (
                  <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                )}
                <button
                  type="button"
                  disabled={crumb.id === targetId}
                  onClick={() => setTargetId(crumb.id)}
                  className="max-w-40 truncate rounded-sm px-1 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:font-medium disabled:text-foreground"
                >
                  {crumb.name}
                </button>
              </span>
            ))}
            {target.isPending && (
              <span className="text-muted-foreground">Loading…</span>
            )}
          </nav>

          <div className="h-56 overflow-y-auto rounded-lg border">
            {children.isPending && <RowsSkeleton rows={4} />}

            {children.isError && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Could not load this folder.{" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => void children.refetch()}
                >
                  Try again
                </button>
              </p>
            )}

            {children.data &&
              (folders.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No folders here. Move the item into this one, or go back up.
                </p>
              ) : (
                <ul className="divide-y">
                  {folders.map((folder) => (
                    <li key={folder.id}>
                      <button
                        type="button"
                        // Descending into the item being moved would end at a
                        // destination inside itself, which the API refuses. Closing that
                        // door here means the refusal never has to be explained.
                        disabled={folder.id === item.id}
                        onClick={() => setTargetId(folder.id)}
                        className="flex h-11 w-full items-center gap-2.5 px-3 text-left text-sm hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
                      >
                        <FolderIcon className="size-4 shrink-0 fill-primary/15 text-primary" />
                        <span className="truncate font-medium">
                          {folder.name}
                        </span>
                        {folder.id === item.id ? (
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            moving
                          </span>
                        ) : (
                          <ChevronRightIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                    </li>
                  ))}
                  {moreFolders && (
                    <li className="p-2 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={children.isFetchingNextPage}
                        onClick={() => void children.fetchNextPage()}
                      >
                        {children.isFetchingNextPage ? "Loading…" : "Load more"}
                      </Button>
                    </li>
                  )}
                </ul>
              ))}
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>
            Cancel
          </DialogClose>
          <Button
            disabled={pending || alreadyThere || target.isError}
            onClick={() => void move()}
          >
            {/* "Here" rather than the folder's name: the trail above already says
                where here is, and a 200-character name would break the footer. */}
            {pending ? "Moving…" : alreadyThere ? "Already here" : "Move here"}
          </Button>
        </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Keep both / Replace / Skip, the answer `docs/data-model.md` specifies for a move —
 * asked in place rather than in a second dialog stacked on this one, so the destination
 * the user picked is one click away instead of behind a dismissal.
 *
 * There is no separate "Skip": a move is one item, so skipping it and cancelling the
 * dialog are the same act, and two buttons doing one thing is a control that lies.
 */
function Clash({
  message,
  replaceable,
  pending,
  onChoose,
  onBack,
}: {
  message: string;
  /** Replacing a folder would delete its whole subtree, so the API refuses it and this
   * does not offer it. */
  replaceable: boolean;
  pending: boolean;
  onChoose: (choice: ConflictChoice) => void;
  onBack: () => void;
}) {
  return (
    <>
      <div className="flex gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p>{message}</p>
      </div>

      <DialogFooter className="sm:justify-between">
        <Button variant="ghost" type="button" disabled={pending} onClick={onBack}>
          Choose another folder
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <DialogClose render={<Button variant="outline" type="button" />}>
            Cancel
          </DialogClose>
          {replaceable && (
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => onChoose("replace")}
            >
              Replace
            </Button>
          )}
          <Button disabled={pending} onClick={() => onChoose("keepBoth")}>
            {pending ? "Moving…" : "Keep both"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
