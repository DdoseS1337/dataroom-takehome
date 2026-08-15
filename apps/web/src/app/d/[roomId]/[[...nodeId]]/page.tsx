"use client";

import { FolderOpenIcon, FolderPlusIcon, UploadIcon } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DropZone, UploadButton } from "@/components/drop-zone";
import { NamePromptDialog } from "@/components/name-prompt-dialog";
import { NodeTable } from "@/components/node-table";
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthGate } from "@/lib/auth";
import { PermissionProvider, useCanPerform } from "@/lib/permissions";
import { useChildren, useCreateFolder, useNode, useRooms } from "@/lib/queries";

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

  if (node.isPending) return <ViewSkeleton />;

  if (node.isError) {
    return <ErrorState error={node.error} onRetry={() => void node.refetch()} />;
  }

  return (
    <PermissionProvider permission={node.data.permission}>
      <div className="space-y-5">
        <div className="flex min-h-9 items-center justify-between gap-4">
          <Breadcrumbs crumbs={node.data.breadcrumbs} roomId={roomId} />
          <Toolbar nodeId={nodeId} hasItems={hasItems(children.data)} />
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
            (hasItems(children.data) ? (
              <>
                <NodeTable
                  items={children.data.pages.flatMap((page) => page.items)}
                  roomId={roomId}
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
    </PermissionProvider>
  );
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

function hasItems(data: { pages: { items: unknown[] }[] } | undefined): boolean {
  return Boolean(data?.pages.some((page) => page.items.length > 0));
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
