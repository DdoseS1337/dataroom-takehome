"use client";

import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Crumb } from "@/lib/queries";

// Root, an overflow menu, the parent, and the current folder. Past this the trail
// wraps onto a second line and stops being a single glanceable path.
const VISIBLE_TAIL = 2;

export function Breadcrumbs({
  crumbs,
  href,
}: {
  crumbs: Crumb[];
  /** Addresses differ per surface — `/d/:roomId/:nodeId` for the owner, `/s/:token`
   * for a recipient — and the trail itself does not. */
  href: (nodeId: string) => string;
}) {
  if (crumbs.length === 0) return null;

  const [root, ...rest] = crumbs;
  const overflowing = rest.length > VISIBLE_TAIL + 1;
  const collapsed = overflowing ? rest.slice(0, -VISIBLE_TAIL) : [];
  const tail = overflowing ? rest.slice(-VISIBLE_TAIL) : rest;

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-1 text-sm">
        <CrumbLink href={href(root.id)} isCurrent={crumbs.length === 1}>
          {root.name}
        </CrumbLink>

        {collapsed.length > 0 && (
          <>
            <Separator />
            <li>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Show ${collapsed.length} more folders`}
                    >
                      <MoreHorizontalIcon />
                    </Button>
                  }
                />
                <DropdownMenuContent align="start">
                  {collapsed.map((crumb) => (
                    <DropdownMenuItem
                      key={crumb.id}
                      render={<Link href={href(crumb.id)} />}
                    >
                      {crumb.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          </>
        )}

        {tail.map((crumb, index) => (
          <Fragment key={crumb.id}>
            <Separator />
            <CrumbLink href={href(crumb.id)} isCurrent={index === tail.length - 1}>
              {crumb.name}
            </CrumbLink>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

function CrumbLink({
  href,
  isCurrent,
  children,
}: {
  href: string;
  isCurrent: boolean;
  children: string;
}) {
  return (
    <li className="min-w-0">
      {isCurrent ? (
        <span
          aria-current="page"
          className="block max-w-56 truncate px-1.5 py-1 font-medium"
        >
          {children}
        </span>
      ) : (
        <Link
          href={href}
          className="block max-w-40 truncate rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {children}
        </Link>
      )}
    </li>
  );
}

function Separator() {
  return (
    <li aria-hidden className="text-muted-foreground/50">
      <ChevronRightIcon className="size-3.5" />
    </li>
  );
}
