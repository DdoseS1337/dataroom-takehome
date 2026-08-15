"use client";

import { FolderOpenIcon, FolderPlusIcon, UploadIcon } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DropZone, UploadButton } from "@/components/drop-zone";
import { FilePreviewDialog } from "@/components/file-preview-dialog";
import { NamePromptDialog } from "@/components/name-prompt-dialog";
import {
  closeRowAction,
  NodeActionDialogs,
  openRowAction,
  type RowActionTarget,
} from "@/components/node-actions";
import { NodeTable } from "@/components/node-table";
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthGate } from "@/lib/auth";
import { PermissionProvider, useCanPerform } from "@/lib/permissions";
import {
  useChildren,
  useCreateFolder,
  useNode,
  useRooms,
  type NodeSummary,
} from "@/lib/queries";

export default function DataRoomPage() {
  return (
    <AuthGate fallback={<AppShell><ViewSkeleton /></AppShell>}>
      <AppShell>
        <Resolver />
      </AppShell>
    </AuthGate>
  );
}

/**
 * `/d/:roomId` with no node is a hand-typed or bookmarked URL — the app always links
 * to the root node explicitly. Resolving it from the already-cached room list and
 * redirecting keeps one canonical URL per folder, so breadcrumbs and browser history
 * do not end up with two addresses for the same view.
 */
function Resolver() {
  const params = useParams<{ roomId: string; nodeId?: string[] }>();
  const router = useRouter();
  const roomId = params.roomId;
  const nodeIdFromUrl = params.nodeId?.[0];

  const rooms = useRooms();
  const rootNodeId = rooms.data?.find((room) => room.id === roomId)?.rootNodeId;

  useEffect(() => {
    if (!nodeIdFromUrl && rootNodeId) {
      router.replace(`/d/${roomId}/${rootNodeId}`);
    }
  }, [nodeIdFromUrl, rootNodeId, roomId, router]);

  if (nodeIdFromUrl) {
    return <FolderView roomId={roomId} nodeId={nodeIdFromUrl} />;
  }

  if (rooms.isError) {
    return <ErrorState error={rooms.error} onRetry={() => void rooms.refetch()} />;
  }

  if (rooms.data && !rootNodeId) {
    return (
      <div className="rounded-xl border">
        <EmptyState
          icon={<FolderOpenIcon />}
          title="Data room not found"
          description="This room does not exist, or you do not have access to it."
        />
      </div>
    );
  }

  return <ViewSkeleton />;
}

function FolderView({ roomId, nodeId }: { roomId: string; nodeId: string }) {
  const node = useNode(nodeId);
  const children = useChildren(nodeId);
  const preview = useFilePreview();
  const items = children.data?.pages.flatMap((page) => page.items) ?? [];

  /** Held here rather than in the row: rename, move and delete all edit the cached
   * listing optimistically, and a dialog living inside the row they edit is unmounted
   * before the server has answered. */
  const [action, setAction] = useState<RowActionTarget | null>(null);

  if (node.isPending) return <ViewSkeleton />;

  if (node.isError) {
    return <ErrorState error={node.error} onRetry={() => void node.refetch()} />;
  }

  return (
    <PermissionProvider permission={node.data.permission}>
      <div className="space-y-5">
        <div className="flex min-h-9 items-center justify-between gap-4">
          <Breadcrumbs crumbs={node.data.breadcrumbs} roomId={roomId} />
          <Toolbar nodeId={nodeId} hasItems={items.length > 0} />
        </div>

        {/* The whole listing is the drop target, not just the empty state — dropping
            onto a folder that already has files is the common case. */}
        <DropZone folderId={nodeId} className="rounded-xl border">
          {children.isPending && <RowsSkeleton />}

          {children.isError && (
            <ErrorState
              error={children.error}
              onRetry={() => void children.refetch()}
            />
          )}

          {children.data &&
            (items.length > 0 ? (
              <>
                <NodeTable
                  items={items}
                  roomId={roomId}
                  onOpenFile={preview.open}
                  onAction={(kind, item) =>
                    setAction(openRowAction(kind, item))
                  }
                />
                {children.hasNextPage && (
                  <div className="border-t p-2 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={children.isFetchingNextPage}
                      onClick={() => void children.fetchNextPage()}
                    >
                      {children.isFetchingNextPage
                        ? "Loading…"
                        : "Load more"}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <EmptyFolder nodeId={nodeId} />
            ))}
        </DropZone>
      </div>

      <NodeActionDialogs
        target={action}
        parentId={nodeId}
        onClose={() => setAction(closeRowAction)}
      />

      <FilePreviewDialog
        fileId={preview.fileId}
        // The row is usually already on screen, so the header has its name and size at
        // once. A deep link into a file further down the listing has neither, and the
        // dialog fetches them itself.
        known={items.find((item) => item.id === preview.fileId) ?? null}
        onClose={preview.close}
      />
    </PermissionProvider>
  );
}

/**
 * The preview lives in the URL as `?file=<id>` so it is linkable and Back closes it,
 * but it is pushed with `history.pushState` rather than the router: a `push` would
 * re-run the route and refetch the folder underneath a dialog that sits on top of it.
 * Next syncs `useSearchParams` with these calls.
 */
function useFilePreview() {
  const params = useSearchParams();
  const fileId = params.get("file") ?? undefined;
  /** Whether this tab pushed the entry, so closing can go back rather than stack a
   * second one. A link opened straight into a preview has nothing to go back to. */
  const pushed = useRef(false);

  const open = useCallback((file: NodeSummary) => {
    const next = new URLSearchParams(window.location.search);
    next.set("file", file.id);
    window.history.pushState(null, "", `${window.location.pathname}?${next}`);
    pushed.current = true;
  }, []);

  const close = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
      return;
    }
    const next = new URLSearchParams(window.location.search);
    next.delete("file");
    const query = next.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (query ? `?${query}` : ""),
    );
  }, []);

  return { fileId: fileId ?? null, open, close };
}

function Toolbar({
  nodeId,
  hasItems,
}: {
  nodeId: string;
  hasItems: boolean;
}) {
  // The empty state carries its own calls to action, so repeating them above it would
  // be two ways to do the same thing on an otherwise bare screen.
  if (!hasItems) return null;

  return (
    <div className="flex items-center gap-2">
      <NewFolderButton nodeId={nodeId} />
      <UploadButton folderId={nodeId} />
    </div>
  );
}

/**
 * The empty state doubles as the drop zone, which `docs/ui.md` asks for: an empty
 * folder is exactly where someone needs to be told that dropping files works.
 */
function EmptyFolder({ nodeId }: { nodeId: string }) {
  const canUpload = useCanPerform("upload");
  const canCreate = useCanPerform("createFolder");

  if (!canUpload && !canCreate) {
    return (
      <EmptyState
        icon={<FolderOpenIcon />}
        title="This folder is empty"
        description="Nothing has been added here yet."
      />
    );
  }

  return (
    <div className="p-3">
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <UploadIcon className="size-5" />
        </div>
        <div className="space-y-1">
          <h2 className="text-sm font-medium">This folder is empty</h2>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            Drag PDFs anywhere on this panel to upload them, or add a folder to
            organise the room.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <UploadButton folderId={nodeId} />
          <NewFolderButton nodeId={nodeId} />
        </div>
      </div>
    </div>
  );
}

function NewFolderButton({ nodeId }: { nodeId: string }) {
  const canCreate = useCanPerform("createFolder");
  const createFolder = useCreateFolder(nodeId);
  const [open, setOpen] = useState(false);

  if (!canCreate) return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FolderPlusIcon />
        New folder
      </Button>
      <NamePromptDialog
        open={open}
        onOpenChange={setOpen}
        title="New folder"
        description="Folders and files share one namespace, so a name has to be unique inside this folder."
        label="Folder name"
        placeholder="Financials"
        submitLabel="Create folder"
        onSubmit={(name) => createFolder.mutateAsync(name)}
      />
    </>
  );
}

function ViewSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex min-h-9 items-center gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-4 rounded-sm" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="rounded-xl border">
        <RowsSkeleton />
      </div>
    </div>
  );
}
