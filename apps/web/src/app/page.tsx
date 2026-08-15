"use client";

import {
  ChevronRightIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  VaultIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { DeleteDialog } from "@/components/delete-dialog";
import { NamePromptDialog } from "@/components/name-prompt-dialog";
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AuthGate } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import {
  useCreateRoom,
  useDeleteRoom,
  useRenameRoom,
  useRooms,
  type Room,
} from "@/lib/queries";

export default function RoomsPage() {
  return (
    <AuthGate
      fallback={
        <AppShell>
          <div className="space-y-6">
            <PageHeading />
            <RoomsSkeleton />
          </div>
        </AppShell>
      }
    >
      <AppShell>
        <Rooms />
      </AppShell>
    </AuthGate>
  );
}

function Rooms() {
  const rooms = useRooms();
  const createRoom = useCreateRoom();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeading />
        {rooms.data && rooms.data.length > 0 && (
          <Button onClick={() => setCreating(true)}>
            <PlusIcon />
            New data room
          </Button>
        )}
      </div>

      {rooms.isPending && <RoomsSkeleton />}

      {rooms.isError && (
        <div className="rounded-xl border">
          <ErrorState error={rooms.error} onRetry={() => void rooms.refetch()} />
        </div>
      )}

      {rooms.data &&
        (rooms.data.length === 0 ? (
          <div className="rounded-xl border">
            <EmptyState
              icon={<VaultIcon />}
              title="No data rooms yet"
              description="Create your first room to start organising documents into folders and sharing them for review."
              action={
                <Button onClick={() => setCreating(true)}>
                  <PlusIcon />
                  New data room
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {rooms.data.map((room) => (
              <RoomCard key={room.id} room={room} />
            ))}
          </ul>
        ))}

      <NamePromptDialog
        open={creating}
        onOpenChange={setCreating}
        title="New data room"
        description="Name it after the deal or the counterparty — you can share the whole room or any folder inside it."
        label="Room name"
        placeholder="Project Atlas"
        submitLabel="Create room"
        onSubmit={(name) => createRoom.mutateAsync(name)}
      />
    </div>
  );
}

function RoomCard({ room }: { room: Room }) {
  const rename = useRenameRoom();
  const remove = useDeleteRoom();
  const [action, setAction] = useState<"rename" | "delete" | null>(null);
  const [queued, setQueued] = useState<"rename" | "delete" | null>(null);

  function settle(open: boolean) {
    if (open || !queued) return;
    setAction(queued);
    setQueued(null);
  }

  return (
    <li className="group relative flex items-center gap-3 rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-accent/40 has-aria-expanded:border-primary/40 has-aria-expanded:bg-accent/40">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <VaultIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        {/* Stretched over the card with ::after, so the whole card is the link without
            nesting the menu button inside an anchor. */}
        <Link
          href={`/d/${room.id}/${room.rootNodeId}`}
          className="block truncate rounded-sm text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          {room.name}
        </Link>
        <span className="block text-xs text-muted-foreground">
          Created {formatDate(room.createdAt)}
        </span>
      </span>

      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />

      <DropdownMenu onOpenChangeComplete={settle}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="relative z-10 text-muted-foreground"
            />
          }
        >
          <MoreHorizontalIcon />
          <span className="sr-only">Actions for {room.name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => setQueued("rename")}>
            <PencilIcon />
            Rename…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setQueued("delete")}
          >
            <Trash2Icon />
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NamePromptDialog
        key={room.name}
        open={action === "rename"}
        onOpenChange={(next) => setAction(next ? "rename" : null)}
        title="Rename data room"
        description="The room's name is also the name of its top-level folder, so both change together."
        label="Room name"
        placeholder={room.name}
        submitLabel="Rename"
        initialName={room.name}
        onSubmit={(name) => rename.mutateAsync({ id: room.id, name })}
      />

      {/* The counts come from the room's root node, so they describe what is in the
          room without counting the room itself. */}
      <DeleteDialog
        open={action === "delete"}
        onOpenChange={(next) => setAction(next ? "delete" : null)}
        nodeId={room.rootNodeId}
        name={room.name}
        type="folder"
        onConfirm={() => remove.mutateAsync(room.id)}
      />
    </li>
  );
}

/**
 * One heading, rendered by whoever owns the page at the time. It used to live inside the
 * skeleton as well as in `Rooms`, which put it on screen twice for as long as the rooms
 * query was loading — invisible while that was instant, and very visible once the query
 * started retrying.
 */
function PageHeading() {
  return (
    <div className="space-y-1">
      <h1 className="text-lg font-medium tracking-tight">Data rooms</h1>
      <p className="text-sm text-muted-foreground">
        Each room holds one deal&apos;s documents.
      </p>
    </div>
  );
}

function RoomsSkeleton() {
  return (
    <div className="rounded-xl border">
      <RowsSkeleton rows={4} />
    </div>
  );
}
