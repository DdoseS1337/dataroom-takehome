"use client";

import { ContextMenu } from "@base-ui/react/context-menu";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  DownloadIcon,
  FileTextIcon,
  FolderIcon,
  FolderInputIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Share2Icon,
  SquareArrowOutUpRightIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { RowAction } from "@/components/node-actions";
import { RowsSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes, formatDateTime } from "@/lib/format";
import { useCanPerform } from "@/lib/permissions";
import { useDownloadFile, type ApiBase, type NodeSummary } from "@/lib/queries";

/**
 * A table, not a card grid: due diligence is about names and dates, not thumbnails.
 * Rows are 44px — dense enough to scan a long folder, tall enough to click.
 *
 * `folderHref` and `base` are what let the same table serve the owner's data room and a
 * shared link: one addresses `/d/...` and the private API, the other `/s/<token>` and
 * the public mirror, and nothing else about a listing differs between them.
 */

/** The first guess before a row has been measured. Rows are single-line and identical,
 * so the correction is sub-pixel — but it is still measured rather than assumed, because
 * an estimate wrong by a pixel is wrong by ten thousand of them over a folder this is
 * built for. */
const ESTIMATED_ROW = 45;

/** How far past the visible window rows are kept mounted. Generous enough that a held
 * arrow key or a flick of the wheel does not outrun it, small enough that the count stays
 * constant whatever the folder holds. */
const OVERSCAN = 12;

/** What is left to fetch, and how. The listing is keyset-paged, so a long folder arrives
 * fifty rows at a time — the table asks for the next page as the window reaches the end
 * of what it has, rather than parking a button below ten thousand rows where neither the
 * scroll nor the arrow keys can reach it. */
export interface Paging {
  hasMore: boolean;
  loading: boolean;
  /** The last page request failed. Retried on demand, never automatically: a loop that
   * re-asks a refusing server as fast as it answers is worse than the refusal. */
  failed: boolean;
  load: () => void;
}

export function NodeTable({
  items,
  folderHref,
  base = "",
  paging,
  onOpenFile,
  onAction,
}: {
  items: NodeSummary[];
  folderHref: (nodeId: string) => string;
  base?: ApiBase;
  paging: Paging;
  onOpenFile: (file: NodeSummary) => void;
  /** Rename, move and delete are owned above this table — see `NodeActionDialogs`. */
  onAction: (action: RowAction, item: NodeSummary) => void;
}) {
  const canRename = useCanPerform("rename");
  const canDelete = useCanPerform("delete");

  const bodyRef = useRef<HTMLTableSectionElement | null>(null);

  /**
   * Where the rows begin in the document. The page scrolls, not a panel inside it, so the
   * virtualiser measures against the window and has to be told how much of that scroll is
   * header, breadcrumbs and toolbar rather than list.
   *
   * Taken in a ref callback rather than an effect: it runs before paint, and it is a
   * measurement the render depends on, so it belongs in state rather than in a ref the
   * render would have to read.
   */
  const [listTop, setListTop] = useState(0);

  const measureTop = useCallback((element: HTMLTableSectionElement | null) => {
    if (!element) return;
    const top = element.getBoundingClientRect().top + window.scrollY;
    setListTop((current) => (current === top ? current : top));
  }, []);

  const attachBody = useCallback(
    (element: HTMLTableSectionElement | null) => {
      bodyRef.current = element;
      measureTop(element);
    },
    [measureTop],
  );

  // Mounting is not the only time this changes: the breadcrumbs and the toolbar above
  // wrap at narrow widths, which moves the rows down without unmounting them. Left
  // unmeasured, the virtualiser maps the scroll position to the wrong rows and leaves
  // blank bands where they should be.
  useEffect(() => {
    const onResize = () => measureTop(bodyRef.current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measureTop]);

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => ESTIMATED_ROW,
    overscan: OVERSCAN,
    scrollMargin: listTop,
  });

  const rows = virtualizer.getVirtualItems();

  // Asked for as the window reaches the last row it has. This also covers a folder whose
  // rows do not fill the viewport, where no scroll will ever happen to trigger it.
  const reachedEnd = rows.length > 0 && rows[rows.length - 1].index >= items.length - 1;
  useEffect(() => {
    if (reachedEnd && paging.hasMore && !paging.loading && !paging.failed) {
      paging.load();
    }
  }, [reachedEnd, paging]);

  /** A row asked for by the keyboard that is not mounted yet. The virtualiser is told to
   * scroll to it and the row claims the focus as it appears — going through state instead
   * would mean setting it from an effect, which this codebase cannot do. */
  const pendingFocusRef = useRef<number | null>(null);

  function focusRow(index: number) {
    const next = Math.max(0, Math.min(index, items.length - 1));
    const mounted = bodyRef.current?.querySelector<HTMLElement>(
      `tr[data-index="${next}"] [data-row-focus]`,
    );
    if (mounted) {
      mounted.focus();
      return;
    }
    pendingFocusRef.current = next;
    virtualizer.scrollToIndex(next);
  }

  /**
   * One handler for the whole listing rather than one per row: menus are portalled, so
   * nothing that opens on top of the table sends its keys through here, and the row the
   * event came from is whichever one holds the focus.
   *
   * Enter is deliberately absent. `docs/ui.md` assigns it to rename, but the row's name
   * is a real anchor for a folder and a button for a file — that is what makes
   * middle-click, ⌘-click and Space work — and Enter is how those are activated. Taking
   * it over would break the reason they are what they are, so rename is F2, as it is in
   * every desktop file manager this resembles.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLTableSectionElement>) {
    // The ⋯ button lives in a row and opens its menu on ArrowDown. Base UI has already
    // handled that key by the time it reaches here, and moving the focus out from under
    // a menu that is opening is the one way these two can fight.
    if (event.defaultPrevented) return;

    const row = (event.target as HTMLElement).closest<HTMLElement>("tr[data-index]");
    if (!row) return;
    const index = Number(row.dataset.index);
    const item = items[index];
    if (!item) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusRow(0);
        break;
      case "End":
        event.preventDefault();
        focusRow(items.length - 1);
        break;
      case "F2":
        if (!canRename) break;
        event.preventDefault();
        onAction("rename", item);
        break;
      // Both, because the key that means "delete this" is Delete on a keyboard with one
      // and Backspace on a keyboard without.
      case "Delete":
      case "Backspace":
        if (!canDelete) break;
        event.preventDefault();
        onAction("delete", item);
        break;
    }
  }

  // Only a window of rows is in the DOM, so the two spacers stand in for everything above
  // and below it — that is what keeps the scrollbar honest about how long the list is.
  const above = rows.length > 0 ? rows[0].start - virtualizer.options.scrollMargin : 0;
  const below =
    rows.length > 0
      ? virtualizer.getTotalSize() - (rows[rows.length - 1].end - virtualizer.options.scrollMargin)
      : 0;

  return (
    <>
      {/* Fixed layout, because the columns are otherwise measured from whichever rows
          happen to be mounted — and they would resize as the list scrolls. */}
      <Table
        className="table-fixed"
        // The default container is `overflow-x-auto`, and CSS forces the other axis to
        // match — which makes it a scrollport, and a sticky header inside a scrollport
        // that never scrolls never sticks. `table-fixed` is what makes the horizontal
        // scroll unnecessary in the first place: the columns are sized here, not by the
        // longest filename in the folder.
        containerClassName="overflow-x-visible"
        // The list is longer than the DOM, so the count and each row's place in it are
        // stated rather than counted. +1 for the header row.
        aria-rowcount={items.length + 1}
      >
        <TableHeader>
          {/* Stuck below the app bar, which is `h-14`: a folder that scrolls for a
              thousand rows should not lose the column it is being read against. The rule
              underneath it is an inset shadow rather than the row's border, because a
              collapsed table border does not travel with a sticky cell. */}
          <TableRow className="hover:bg-transparent [&>th]:sticky [&>th]:top-14 [&>th]:z-10 [&>th]:bg-background [&>th]:shadow-[inset_0_-1px_0_var(--border)]">
            <TableHead className="h-9 px-3 text-xs font-medium text-muted-foreground">
              Name
            </TableHead>
            <TableHead className="hidden h-9 w-24 px-3 text-right text-xs font-medium text-muted-foreground sm:table-cell">
              Size
            </TableHead>
            <TableHead className="h-9 w-44 px-3 text-xs font-medium text-muted-foreground">
              Modified
            </TableHead>
            <TableHead className="h-9 w-11 px-3">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody ref={attachBody} onKeyDown={onKeyDown}>
          {above > 0 && <Spacer height={above} />}

          {rows.map((row) => (
            <NodeRow
              key={items[row.index].id}
              index={row.index}
              item={items[row.index]}
              measure={virtualizer.measureElement}
              pendingFocusRef={pendingFocusRef}
              folderHref={folderHref}
              base={base}
              onOpenFile={onOpenFile}
              onAction={onAction}
            />
          ))}

          {below > 0 && <Spacer height={below} />}
        </TableBody>
      </Table>

      <ListEnd paging={paging} />
    </>
  );
}

/** The rows that are not in the DOM, as height. `aria-hidden` because it stands for
 * nothing a reader should hear — `aria-rowcount` already says how many rows there are. */
function Spacer({ height }: { height: number }) {
  return (
    <tr aria-hidden>
      <td colSpan={4} className="p-0" style={{ height }} />
    </tr>
  );
}

/**
 * What is below the last row: nothing, the next page arriving, or a page that did not.
 *
 * A skeleton rather than a spinner, and rows rather than a bar, so the list appears to be
 * growing by the thing it is made of.
 */
function ListEnd({ paging }: { paging: Paging }) {
  // `failed` is the query's state, which a failed background refetch also sets — but with
  // nothing left to page for, the rows on screen are complete and saying otherwise would
  // be reporting a problem the reader does not have.
  if (paging.failed && paging.hasMore) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-2 border-t px-3 py-3 text-sm text-muted-foreground">
        Could not load the rest of this folder.
        <Button variant="outline" size="sm" onClick={paging.load}>
          Try again
        </Button>
      </div>
    );
  }

  if (paging.loading) return <RowsSkeleton rows={2} className="border-t" />;

  return null;
}

function NodeRow({
  index,
  item,
  measure,
  pendingFocusRef,
  folderHref,
  base,
  onOpenFile,
  onAction,
}: {
  index: number;
  item: NodeSummary;
  measure: (element: HTMLElement | null) => void;
  pendingFocusRef: RefObject<number | null>;
  folderHref: (nodeId: string) => string;
  base: ApiBase;
  onOpenFile: (file: NodeSummary) => void;
  onAction: (action: RowAction, item: NodeSummary) => void;
}) {
  const router = useRouter();
  const download = useDownloadFile(base);

  /** Chosen from the menu, but held until the menu has finished closing: both a menu
   * and a dialog manage focus, and opening one while the other is still restoring it
   * leaves the focus ring in the wrong place. */
  const [queued, setQueued] = useState<RowAction | null>(null);

  function settle(open: boolean) {
    if (open || !queued) return;
    onAction(queued, item);
    setQueued(null);
  }

  function open() {
    if (item.type === "folder") router.push(folderHref(item.id));
    else onOpenFile(item);
  }

  /** Claims the focus if the arrow keys asked for this row while it was still outside
   * the rendered window. */
  function claimFocus(element: HTMLElement | null) {
    if (element && pendingFocusRef.current === index) {
      pendingFocusRef.current = null;
      element.focus();
    }
  }

  const menu = (
    <NodeMenuItems
      item={item}
      onOpen={open}
      onDownload={() => download.mutate(item.id)}
      onChoose={setQueued}
    />
  );

  return (
    <ContextMenu.Root onOpenChangeComplete={settle}>
      {/* Right-click is the accelerator, not the only way in: it is invisible, absent
          on touch, and unreachable from the keyboard. The ⋯ button is the real
          control, and both open the same items. */}
      <ContextMenu.Trigger
        // Measured rather than assumed — see `ESTIMATED_ROW`. `data-index` is how the
        // virtualiser knows which row it just measured, and how a keypress finds the
        // item it belongs to.
        ref={measure}
        data-index={index}
        aria-rowindex={index + 2}
        render={<TableRow className="relative" />}
      >
        <TableCell className="h-11 px-3">
          <span className="flex items-center gap-2.5">
            {item.type === "folder" ? (
              <FolderIcon className="size-4 shrink-0 fill-primary/15 text-primary" />
            ) : (
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
            )}
            {item.type === "folder" ? (
              // A real anchor, stretched over the row with ::after. A div with
              // onClick loses middle-click and cmd-click, does not activate on
              // Space, and reads as nothing to a screen reader.
              <Link
                ref={claimFocus}
                data-row-focus
                href={folderHref(item.id)}
                className="max-w-100 truncate rounded-sm font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
              >
                {item.name}
              </Link>
            ) : (
              // A button, not a link: the preview is a dialog over this list, so
              // there is no address to hand to middle-click. The URL still updates.
              <button
                ref={claimFocus}
                data-row-focus
                type="button"
                onClick={() => onOpenFile(item)}
                className="max-w-100 truncate rounded-sm text-left font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
              >
                {item.name}
              </button>
            )}
          </span>
        </TableCell>
        {/* A folder's size would be a subtree aggregate, which is a query per row.
            An em dash is the honest answer until the delete dialog needs the real
            number and asks the server for it. */}
        <TableCell className="hidden h-11 px-3 text-right text-muted-foreground tabular-nums sm:table-cell">
          {item.sizeBytes === null ? "—" : formatBytes(item.sizeBytes)}
        </TableCell>
        <TableCell className="h-11 px-3 text-muted-foreground tabular-nums">
          {formatDateTime(item.updatedAt)}
        </TableCell>
        <TableCell className="h-11 px-1">
          <DropdownMenu onOpenChangeComplete={settle}>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  // Above the stretched ::after overlay, which otherwise swallows
                  // the click and navigates instead.
                  className="relative z-10 text-muted-foreground"
                />
              }
            >
              <MoreHorizontalIcon />
              <span className="sr-only">Actions for {item.name}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {menu}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </ContextMenu.Trigger>

      {/* The width override matters: the shared popup is sized to its anchor, and a
          context menu's anchor is the cursor — a zero-width rect. */}
      <DropdownMenuContent className="w-48">{menu}</DropdownMenuContent>
    </ContextMenu.Root>
  );
}

/**
 * One list, rendered into both the ⋯ menu and the context menu. Base UI's ContextMenu
 * re-exports Menu's own parts, so the same items and the same popup serve both.
 *
 * Nothing here is disabled when it is not allowed — it is absent. A control that is
 * visible and does nothing is the thing `docs/ui.md` rules out.
 */
function NodeMenuItems({
  item,
  onOpen,
  onDownload,
  onChoose,
}: {
  item: NodeSummary;
  onOpen: () => void;
  onDownload: () => void;
  onChoose: (action: RowAction) => void;
}) {
  const canRename = useCanPerform("rename");
  const canMove = useCanPerform("move");
  const canDelete = useCanPerform("delete");
  const canShare = useCanPerform("share");
  const canSeeHistory = useCanPerform("history");
  const canEdit = canRename || canMove || canShare;

  return (
    <>
      <DropdownMenuItem onClick={onOpen}>
        <SquareArrowOutUpRightIcon />
        Open
      </DropdownMenuItem>

      {item.type === "file" && (
        <DropdownMenuItem onClick={onDownload}>
          <DownloadIcon />
          Download
        </DropdownMenuItem>
      )}

      {item.type === "file" && canSeeHistory && (
        <DropdownMenuItem onClick={() => onChoose("versions")}>
          <HistoryIcon />
          Versions…
        </DropdownMenuItem>
      )}

      {canEdit && <DropdownMenuSeparator />}

      {canShare && (
        <DropdownMenuItem onClick={() => onChoose("share")}>
          <Share2Icon />
          Share…
        </DropdownMenuItem>
      )}

      {canRename && (
        <DropdownMenuItem onClick={() => onChoose("rename")}>
          <PencilIcon />
          Rename…
          <span className="ml-auto text-xs text-muted-foreground">F2</span>
        </DropdownMenuItem>
      )}
      {canMove && (
        <DropdownMenuItem onClick={() => onChoose("move")}>
          <FolderInputIcon />
          Move to…
        </DropdownMenuItem>
      )}

      {canDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onChoose("delete")}
          >
            <Trash2Icon />
            Delete…
            <span className="ml-auto text-xs text-muted-foreground">Del</span>
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}
