"use client";

import {
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  InboxIcon,
  LinkIcon,
  MailIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Share2Icon,
  Trash2Icon,
  VaultIcon,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
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
  useIncomingShares,
  useOutgoingShares,
  useRenameRoom,
  useRevokeShare,
  useRooms,
  type IncomingShare,
  type OutgoingShare,
  type Room,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * Three lists, one page: the rooms this person owns, what they have shared out of them,
 * and what has been shared with them.
 *
 * The last two are not a sixth screen — `docs/ui.md` allows five and means it. They live
 * here because they answer questions about the same library: "who can see my documents"
 * and "what can I see". A share panel attached to an item can only answer the first one
 * item at a time, which is no use to an owner who has forgotten where they shared
 * something, and no use at all to a recipient.
 */
type Tab = "rooms" | "outgoing" | "incoming";

export default function RoomsPage() {
  return (
    <AuthGate
      fallback={
        <AppShell>
          <div className="space-y-6">
            <Heading title="Data rooms" description="Each room holds one deal's documents." />
            <ListSkeleton />
          </div>
        </AppShell>
      }
    >
      <AppShell>
        <Home />
      </AppShell>
    </AuthGate>
  );
}

function Home() {
  const [tab, setTab] = useState<Tab>("rooms");
  const outgoing = useOutgoingShares();
  const incoming = useIncomingShares();

  return (
    <div className="space-y-6">
      {/* Counts on the tabs rather than inside them: someone whose only access is a
          shared folder lands on an empty room list, and a bare tab label gives them no
          reason to look further. */}
      <Tabs
        current={tab}
        onChange={setTab}
        tabs={[
          { id: "rooms", label: "Data rooms" },
          { id: "outgoing", label: "Shared by me", count: outgoing.data?.length },
          { id: "incoming", label: "Shared with me", count: incoming.data?.length },
        ]}
      />

      <TabPanel tab="rooms" current={tab}>
        <Rooms />
      </TabPanel>
      <TabPanel tab="outgoing" current={tab}>
        <SharedByMe query={outgoing} />
      </TabPanel>
      <TabPanel tab="incoming" current={tab}>
        <SharedWithMe query={incoming} />
      </TabPanel>
    </div>
  );
}

/**
 * The roles the tab strip above was already claiming. A `tablist` whose panels are
 * anonymous `div`s tells a screen reader that three tabs exist and then never says what
 * any of them controls.
 *
 * Only the selected panel is mounted, and it is `tabIndex={0}` because of that: Tab out
 * of the strip has to land somewhere, and with the other two absent there is no
 * `aria-hidden` sleight of hand to get wrong.
 */
function TabPanel({
  tab,
  current,
  children,
}: {
  tab: Tab;
  current: Tab;
  children: ReactNode;
}) {
  if (tab !== current) return null;

  return (
    <div
      id={panelId(tab)}
      role="tabpanel"
      aria-labelledby={tabId(tab)}
      tabIndex={0}
      className="outline-none"
    >
      {children}
    </div>
  );
}

const tabId = (tab: Tab) => `tab-${tab}`;
const panelId = (tab: Tab) => `panel-${tab}`;

function Rooms() {
  const rooms = useRooms();
  const createRoom = useCreateRoom();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <Heading
          title="Data rooms"
          description="Each room holds one deal's documents."
        />
        {rooms.data && rooms.data.length > 0 && (
          <Button onClick={() => setCreating(true)}>
            <PlusIcon />
            New data room
          </Button>
        )}
      </div>

      {rooms.isPending && <ListSkeleton />}

      {rooms.isError && !rooms.data && (
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

/**
 * Every live grant across every room this person owns, with the one control that matters
 * next to it. A link that cannot be found again cannot be turned off, and a share panel
 * reachable only from the item it belongs to is exactly that.
 */
function SharedByMe({
  query,
}: {
  query: ReturnType<typeof useOutgoingShares>;
}) {
  const revoke = useRevokeShare();

  return (
    <div className="space-y-6">
      <Heading
        title="Shared by me"
        description="Everything other people can currently open. Revoking takes effect on their next request."
      />

      {query.isPending && <ListSkeleton />}

      {query.isError && !query.data && (
        <div className="rounded-xl border">
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </div>
      )}

      {query.data &&
        (query.data.length === 0 ? (
          <div className="rounded-xl border">
            <EmptyState
              icon={<Share2Icon />}
              title="Nothing shared yet"
              description="Open a data room, then use Share on a folder or a file to create a link or invite someone by email."
            />
          </div>
        ) : (
          <ul className="divide-y rounded-xl border">
            {query.data.map((share) => (
              <ShareRow
                key={share.id}
                share={share}
                onRevoke={() => revoke.mutate(share.id)}
              />
            ))}
          </ul>
        ))}
    </div>
  );
}

function ShareRow({
  share,
  onRevoke,
}: {
  share: OutgoingShare;
  onRevoke: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        {share.kind === "link" ? (
          <LinkIcon className="size-4" />
        ) : (
          <MailIcon className="size-4" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">
          <ItemIcon type={share.item.type} />
          <Link
            href={`/d/${share.item.roomId}/${share.item.id}`}
            className="rounded-sm font-medium hover:underline"
          >
            {share.item.name}
          </Link>
          <span className="text-muted-foreground"> · {share.item.roomName}</span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {share.kind === "link" ? "Anyone with the link" : share.email} ·{" "}
          {share.expiresAt
            ? `expires ${formatDate(share.expiresAt)}`
            : "no expiry"}
        </span>
      </span>

      <Button variant="ghost" size="sm" onClick={onRevoke}>
        Revoke
      </Button>
    </li>
  );
}

/**
 * The other direction. Shares grant access to nodes rather than to rooms, so an invited
 * document appears nowhere in the room list — without this, a recipient who loses the
 * link they were sent has no route back to it at all.
 */
function SharedWithMe({
  query,
}: {
  query: ReturnType<typeof useIncomingShares>;
}) {
  return (
    <div className="space-y-6">
      <Heading
        title="Shared with me"
        description="Items other people have given you access to. You can read and download them."
      />

      {query.isPending && <ListSkeleton />}

      {query.isError && !query.data && (
        <div className="rounded-xl border">
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </div>
      )}

      {query.data &&
        (query.data.length === 0 ? (
          <div className="rounded-xl border">
            <EmptyState
              icon={<InboxIcon />}
              title="Nothing shared with you yet"
              description="When someone shares a folder or a file with your email address, it appears here. A public link opens without signing in and is not listed."
            />
          </div>
        ) : (
          <ul className="divide-y rounded-xl border">
            {query.data.map((share) => (
              <IncomingRow key={share.id} share={share} />
            ))}
          </ul>
        ))}
    </div>
  );
}

function IncomingRow({ share }: { share: IncomingShare }) {
  return (
    <li className="group relative flex items-center gap-3 px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        {share.item.type === "folder" ? (
          <FolderIcon className="size-4" />
        ) : (
          <FileTextIcon className="size-4" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <Link
          href={`/d/${share.item.roomId}/${share.item.id}`}
          className="block truncate rounded-sm text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          {share.item.name}
        </Link>
        <span className="block truncate text-xs text-muted-foreground">
          Shared by {share.sharedBy} ·{" "}
          {share.expiresAt
            ? `expires ${formatDate(share.expiresAt)}`
            : "no expiry"}
        </span>
      </span>

      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </li>
  );
}

function ItemIcon({ type }: { type: "folder" | "file" }) {
  return type === "folder" ? (
    <FolderIcon className="mr-1.5 inline size-3.5 shrink-0 -translate-y-px fill-primary/15 text-primary" />
  ) : (
    <FileTextIcon className="mr-1.5 inline size-3.5 shrink-0 -translate-y-px text-muted-foreground" />
  );
}

/**
 * Three of them, so arrow keys are wired rather than assumed: a `tablist` that only
 * responds to Tab is a promise the markup makes and the page does not keep.
 */
function Tabs({
  current,
  onChange,
  tabs,
}: {
  current: Tab;
  onChange: (tab: Tab) => void;
  tabs: { id: Tab; label: string; count?: number }[];
}) {
  const refs = useRef(new Map<Tab, HTMLButtonElement>());

  function move(event: React.KeyboardEvent, index: number) {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  }

  return (
    <div role="tablist" className="flex items-center gap-1 border-b">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(element) => {
            if (element) refs.current.set(tab.id, element);
          }}
          id={tabId(tab.id)}
          role="tab"
          type="button"
          aria-selected={current === tab.id}
          aria-controls={panelId(tab.id)}
          tabIndex={current === tab.id ? 0 : -1}
          onKeyDown={(event) => move(event, index)}
          onClick={() => onChange(tab.id)}
          className={cn(
            "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            current === tab.id
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-xs text-accent-foreground tabular-nums">
              {tab.count}
            </span>
          )}
        </button>
      ))}
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

function Heading({
  title,
  description,
}: {
  title: string;
  description: string;
}): ReactNode {
  return (
    <div className="space-y-1">
      <h1 className="text-lg font-medium tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="rounded-xl border">
      <RowsSkeleton rows={4} />
    </div>
  );
}
