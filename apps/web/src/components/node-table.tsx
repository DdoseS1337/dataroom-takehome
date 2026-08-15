"use client";

import { ContextMenu } from "@base-ui/react/context-menu";
import {
  DownloadIcon,
  FileTextIcon,
  FolderIcon,
  FolderInputIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SquareArrowOutUpRightIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RowAction } from "@/components/node-actions";
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
import { useDownloadFile, type NodeSummary } from "@/lib/queries";

/**
 * A table, not a card grid: due diligence is about names and dates, not thumbnails.
 * Rows are 44px — dense enough to scan a long folder, tall enough to click.
 */
export function NodeTable({
  items,
  roomId,
  onOpenFile,
  onAction,
}: {
  items: NodeSummary[];
  roomId: string;
  onOpenFile: (file: NodeSummary) => void;
  /** Rename, move and delete are owned above this table — see `NodeActionDialogs`. */
  onAction: (action: RowAction, item: NodeSummary) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
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
      <TableBody>
        {items.map((item) => (
          <NodeRow
            key={item.id}
            item={item}
            roomId={roomId}
            onOpenFile={onOpenFile}
            onAction={onAction}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function NodeRow({
  item,
  roomId,
  onOpenFile,
  onAction,
}: {
  item: NodeSummary;
  roomId: string;
  onOpenFile: (file: NodeSummary) => void;
  onAction: (action: RowAction, item: NodeSummary) => void;
}) {
  const router = useRouter();
  const download = useDownloadFile();

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
    if (item.type === "folder") router.push(`/d/${roomId}/${item.id}`);
    else onOpenFile(item);
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
    <>
      <ContextMenu.Root onOpenChangeComplete={settle}>
        {/* Right-click is the accelerator, not the only way in: it is invisible, absent
            on touch, and unreachable from the keyboard. The ⋯ button is the real
            control, and both open the same items. */}
        <ContextMenu.Trigger render={<TableRow className="relative" />}>
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
                  href={`/d/${roomId}/${item.id}`}
                  className="max-w-100 truncate rounded-sm font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
                >
                  {item.name}
                </Link>
              ) : (
                // A button, not a link: the preview is a dialog over this list, so
                // there is no address to hand to middle-click. The URL still updates.
                <button
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
    </>
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
  const canEdit = canRename || canMove;

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

      {canEdit && <DropdownMenuSeparator />}

      {canRename && (
        <DropdownMenuItem onClick={() => onChoose("rename")}>
          <PencilIcon />
          Rename…
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
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}
