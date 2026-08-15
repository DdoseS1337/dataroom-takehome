"use client";

import { FileTextIcon, FolderIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
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
  const router = useRouter();

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-9 px-3 text-xs font-medium text-muted-foreground">
            Name
          </TableHead>
          <TableHead className="h-9 w-44 px-3 text-xs font-medium text-muted-foreground">
            Modified
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => {
          const open =
            item.type === "folder"
              ? () => router.push(`/d/${roomId}/${item.id}`)
              : undefined;

          return (
            <TableRow
              key={item.id}
              tabIndex={open ? 0 : undefined}
              onClick={open}
              onKeyDown={(event) => {
                if (open && event.key === "Enter") open();
              }}
              className={open ? "cursor-pointer" : undefined}
            >
              <TableCell className="h-11 px-3">
                <span className="flex items-center gap-2.5">
                  {item.type === "folder" ? (
                    <FolderIcon className="size-4 shrink-0 fill-primary/15 text-primary" />
                  ) : (
                    <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="max-w-100 truncate font-medium">
                    {item.name}
                  </span>
                </span>
              </TableCell>
              <TableCell className="h-11 px-3 text-muted-foreground tabular-nums">
                {formatDateTime(item.updatedAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
