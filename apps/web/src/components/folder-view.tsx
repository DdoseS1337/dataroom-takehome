"use client";

import {
  DownloadIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  Share2Icon,
  UploadIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DropZone, UploadButton } from "@/components/drop-zone";
import {
  FilePreviewDialog,
  PreviewBody,
  usePdfPreview,
} from "@/components/file-preview-dialog";
import { NamePromptDialog } from "@/components/name-prompt-dialog";
import {
  closeRowAction,
  NodeActionDialogs,
  openRowAction,
  type RowAction,
  type RowActionTarget,
} from "@/components/node-actions";
import { NodeTable, type Paging } from "@/components/node-table";
import {
  SearchField,
  SearchResults,
  useSearchTerm,
} from "@/components/search";
import {
  EmptyState,
  ErrorState,
  RowsSkeleton,
  type BackRoute,
} from "@/components/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionProvider, useCanPerform } from "@/lib/permissions";
import {
  useChildren,
  useCreateFolder,
  useDownloadFile,
  useNode,
  useSearch,
  type ApiBase,
  type NodeDetail,
  type NodeResponse,
  type NodeSummary,
} from "@/lib/queries";

/**
 * One node, whatever it is — the product, and the one screen shared by both surfaces
 * that show it: the owner's data room at `/d/...`, and a recipient's link at `/s/:token`.
 *
 * Everything that differs between them is a parameter. `base` picks the API — the
 * private routes or the public mirror behind a token — and `folderHref` picks the
 * addresses the rows link to. The listing, the states, the preview and the read-only
 * gating are the same code either way, which is the point: a second copy of this screen
 * is a second place for a permission check to be missing.
 *
 * A file gets a page of its own rather than a modal, because a modal needs a list
 * behind it: `/d/:roomId/:fileId` is where someone lands when a single file was shared
 * with them, and there is no folder they are allowed to see underneath.
 */
export function NodeView({
  nodeId,
  base = "",
  folderHref,
  back,
  readOnly = false,
}: {
  nodeId: string;
  base?: ApiBase;
  folderHref: (nodeId: string) => string;
  back: BackRoute;
  /**
   * Shown as a recipient sees it, whoever is asking. An owner following their own link
   * is still the owner, but the mutations are not mirrored under `/s/:token` — the
   * cache they would edit is the private one — so the controls would act on a listing
   * that is not on screen. Owners manage the item from their data room.
   */
  readOnly?: boolean;
}) {
  const node = useNode(nodeId, base);

  if (node.isPending) return <ViewSkeleton />;

  if (node.isError) {
    return (
      <ErrorState
        error={node.error}
        onRetry={() => void node.refetch()}
        back={back}
      />
    );
  }

  return (
    <PermissionProvider permission={readOnly ? "viewer" : node.data.permission}>
      {node.data.node.type === "folder" ? (
        // Keyed, so opening another folder is a fresh screen rather than the same one
        // with new data. A destination already in the cache renders without ever going
        // through the pending state, so nothing else would unmount — and the search
        // panel, which belongs to the folder that was left, would stay up over the folder
        // that was opened. The click would appear to do nothing.
        <FolderContents
          key={node.data.node.id}
          data={node.data}
          base={base}
          folderHref={folderHref}
          back={back}
        />
      ) : (
        <FileContents data={node.data} base={base} folderHref={folderHref} />
      )}
    </PermissionProvider>
  );
}

function FolderContents({
  data,
  base,
  folderHref,
  back,
}: {
  data: NodeResponse;
  base: ApiBase;
  folderHref: (nodeId: string) => string;
  back: BackRoute;
}) {
  const nodeId = data.node.id;
  const children = useChildren(nodeId, base);
  const preview = useFilePreview();
  const items = children.data?.pages.flatMap((page) => page.items) ?? [];

  /** Stable, because the table asks for the next page from an effect and a fresh object
   * every render would re-run it on every render. */
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = children;
  const paging = useMemo<Paging>(
    () => ({
      hasMore: hasNextPage,
      loading: isFetchingNextPage,
      // With pages already in hand, the only thing that can have failed is the next one.
      failed: isError,
      load: () => void fetchNextPage(),
    }),
    [hasNextPage, isFetchingNextPage, isError, fetchNextPage],
  );

  /** Held here rather than in the row: rename, move and delete all edit the cached
   * listing optimistically, and a dialog living inside the row they edit is unmounted
   * before the server has answered. */
  const [action, setAction] = useState<RowActionTarget | null>(null);

  // The top of this requester's trail: their data room, or the folder they were given.
  // The API authorises it once and the search cannot leave it — see `components/search`.
  const scope = data.breadcrumbs[0] ?? { id: data.node.id, name: data.node.name };
  const search = useSearchTerm();
  const searching = useSearch(scope.id, search.query, base);

  return (
    <>
      <div className="space-y-4">
        <div className="flex min-h-9 items-center justify-between gap-4">
          <Breadcrumbs crumbs={data.breadcrumbs} href={folderHref} />
          <Toolbar
            node={data.node}
            hasItems={items.length > 0}
            onShare={(item) => setAction(openRowAction("share", item))}
          />
        </div>

        <SearchField
          term={search.term}
          scopeName={scope.name}
          busy={search.active && searching.isFetching}
          onChange={search.setTerm}
          onClear={search.clear}
        />

        {/* The whole listing is the drop target, not just the empty state — dropping
            onto a folder that already has files is the common case. */}
        <DropZone folderId={nodeId} className="rounded-xl border">
          {search.active ? (
            <SearchResults
              scopeId={scope.id}
              query={search.query}
              base={base}
              back={back}
              folderHref={folderHref}
              onOpenFile={preview.open}
            />
          ) : (
            <Listing
              nodeId={nodeId}
              items={items}
              query={children}
              paging={paging}
              base={base}
              folderHref={folderHref}
              back={back}
              onOpenFile={preview.open}
              onAction={(kind, item) => setAction(openRowAction(kind, item))}
            />
          )}
        </DropZone>
      </div>

      <NodeActionDialogs
        target={action}
        parentId={nodeId}
        onClose={() => setAction(closeRowAction)}
      />

      <FilePreviewDialog
        fileId={preview.fileId}
        base={base}
        // The row is usually already on screen, so the header has its name and size at
        // once. A deep link into a file further down the listing has neither, and the
        // dialog fetches them itself.
        known={items.find((item) => item.id === preview.fileId) ?? null}
        onClose={preview.close}
      />
    </>
  );
}

/** The folder's own contents, in the three states they arrive in. Split out only so the
 * search branch above reads as one alternative to one thing. */
function Listing({
  nodeId,
  items,
  query,
  paging,
  base,
  folderHref,
  back,
  onOpenFile,
  onAction,
}: {
  nodeId: string;
  items: NodeSummary[];
  query: ReturnType<typeof useChildren>;
  paging: Paging;
  base: ApiBase;
  folderHref: (nodeId: string) => string;
  back: BackRoute;
  onOpenFile: (file: NodeSummary) => void;
  onAction: (kind: RowAction, item: NodeSummary) => void;
}) {
  if (query.isPending) return <RowsSkeleton />;

  // Only when there is nothing to show. A page that fails after the first one has arrived
  // is the table's own business — it says so under the last row it did get, rather than
  // replacing a listing that is still perfectly readable.
  if (query.isError && !query.data) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        back={back}
      />
    );
  }

  if (!query.data) return null;
  if (items.length === 0) return <EmptyFolder nodeId={nodeId} />;

  return (
    <NodeTable
      items={items}
      folderHref={folderHref}
      base={base}
      paging={paging}
      onOpenFile={onOpenFile}
      onAction={onAction}
    />
  );
}

/**
 * A file addressed directly: shared on its own, or opened from a list rather than from
 * the folder it lives in. The trail above it is whatever the API says this requester may
 * see, which for a recipient of one file is the file itself.
 */
function FileContents({
  data,
  base,
  folderHref,
}: {
  data: NodeResponse;
  base: ApiBase;
  folderHref: (nodeId: string) => string;
}) {
  // Deduped with the query above it — same key, one request — so the preview knows the
  // name without being told and without asking twice.
  const preview = usePdfPreview(data.node.id, base, true);
  const download = useDownloadFile(base);

  return (
    <div className="space-y-5">
      <div className="flex min-h-9 items-center justify-between gap-4">
        <Breadcrumbs crumbs={data.breadcrumbs} href={folderHref} />
      </div>

      <div className="overflow-hidden rounded-xl border">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-medium">{data.node.name}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">PDF document</p>
          </div>
          {!preview.gone && (
            <Button
              variant="outline"
              size="sm"
              disabled={download.isPending}
              onClick={() => download.mutate(data.node.id)}
            >
              <DownloadIcon />
              {download.isPending ? "Preparing…" : "Download"}
            </Button>
          )}
        </div>

        <div className="max-h-[80vh] overflow-y-auto bg-muted/40">
          <PreviewBody
            preview={preview}
            downloading={download.isPending}
            onDownload={() => download.mutate(data.node.id)}
          />
        </div>
      </div>
    </div>
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
  node,
  hasItems,
  onShare,
}: {
  node: NodeDetail;
  hasItems: boolean;
  onShare: (item: NodeSummary) => void;
}) {
  const canShare = useCanPerform("share");

  return (
    <div className="flex items-center gap-2">
      {canShare && (
        <Button
          variant="outline"
          onClick={() =>
            // The dialogs act on a snapshot of a row; this folder is not one, so it is
            // described as one. Nothing downstream needs a size or a timestamp.
            onShare({
              id: node.id,
              type: node.type,
              name: node.name,
              updatedAt: node.updatedAt,
              sizeBytes: null,
            })
          }
        >
          <Share2Icon />
          Share
        </Button>
      )}
      {/* The empty state carries its own calls to action, so repeating them above it
          would be two ways to do the same thing on an otherwise bare screen. */}
      {hasItems && (
        <>
          <NewFolderButton nodeId={node.id} />
          <UploadButton folderId={node.id} />
        </>
      )}
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

export function ViewSkeleton() {
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
