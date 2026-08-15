"use client";

import { ChevronRightIcon, PlusIcon, VaultIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { NamePromptDialog } from "@/components/name-prompt-dialog";
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { AuthGate } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { useCreateRoom, useRooms, type Room } from "@/lib/queries";

export default function RoomsPage() {
  return (
    <AuthGate fallback={<AppShell><RoomsSkeleton /></AppShell>}>
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
        <div className="space-y-1">
          <h1 className="text-lg font-medium tracking-tight">Data rooms</h1>
          <p className="text-sm text-muted-foreground">
            Each room holds one deal&apos;s documents.
          </p>
        </div>
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
  return (
    <li>
      <Link
        href={`/d/${room.id}/${room.rootNodeId}`}
        className="group flex items-center gap-3 rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <VaultIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {room.name}
          </span>
          <span className="block text-xs text-muted-foreground">
            Created {formatDate(room.createdAt)}
          </span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

function RoomsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-medium tracking-tight">Data rooms</h1>
        <p className="text-sm text-muted-foreground">
          Each room holds one deal&apos;s documents.
        </p>
      </div>
      <div className="rounded-xl border">
        <RowsSkeleton rows={4} />
      </div>
    </div>
  );
}
