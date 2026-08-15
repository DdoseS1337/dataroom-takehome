"use client";

import { FileTextIcon, FolderIcon } from "lucide-react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { NodeSummary } from "@/lib/queries";

/**
 * A table, not a card grid: due diligence is about names and dates, not thumbnails.
 * Rows are 44px — dense enough to scan a long folder, tall enough to click.
 */
export function NodeTable({
  items,
  roomId,
}: {
  items: NodeSummary[];
  roomId: string;
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
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id} className="relative">
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
                  <span className="max-w-100 truncate font-medium">
                    {item.name}
                  </span>
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
