"use client";

import {
  CheckIcon,
  CopyIcon,
  CornerLeftUpIcon,
  LinkIcon,
  MailIcon,
  Share2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, RowsSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  useCreateShare,
  useRevokeShare,
  useShares,
  type CreatedShare,
  type ExpiryPreset,
  type Share,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * Who can open this item, and the two acts that change it. Both modes share one table
 * and one panel: a link anyone can follow, and named people who have to be signed in as
 * themselves.
 *
 * The token is shown exactly once, in the response that creates it — only its hash is
 * stored, so nothing here can show it again later. That is why a freshly created share
 * keeps its URL in component state and says so on screen: an owner who closes the panel
 * without copying has to revoke and make a new one, and being told that up front is
 * better than discovering it.
 */

export function ShareDialog({
  open,
  onOpenChange,
  nodeId,
  name,
  type,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string;
  name: string;
  type: "folder" | "file";
}) {
  const shares = useShares(nodeId, open);
  const create = useCreateShare(nodeId);
  const revoke = useRevokeShare(nodeId);

  /** Shares minted in this panel, in the order they were made. Their tokens exist
   * nowhere else — not in the cache, not on the server — so they live and die with the
   * component. */
  const [minted, setMinted] = useState<CreatedShare[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Closing the panel is the moment the tokens stop being available, which is exactly
  // what the copy hint promises — so they are dropped here rather than in an effect
  // watching `open`, which would be a cascading render and a lint error besides.
  function change(next: boolean) {
    if (!next) {
      setMinted([]);
      setError(null);
    }
    onOpenChange(next);
  }

  async function add(body: {
    kind: "link" | "user";
    email?: string;
    expiresIn?: ExpiryPreset;
  }): Promise<boolean> {
    setError(null);
    try {
      const share = await create.mutateAsync(body);
      setMinted((current) => [...current, share]);
      return true;
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Something went wrong. Please try again.",
      );
      return false;
    }
  }

  const listed = shares.data?.shares ?? [];
  const links = listed.filter((s) => s.kind === "link");
  const people = listed.filter((s) => s.kind === "user");
  const tokens = Object.fromEntries(minted.map((s) => [s.id, s.token]));

  /**
   * Shares that were created here but are not in the list — the refetch after creating
   * one can fail, and the row it would have appeared in is where the token is shown.
   * Only the hash is stored, so a token that never reaches the screen is gone for good;
   * these are rendered on their own so that cannot happen.
   */
  const unlisted = minted.filter(
    (share) => !listed.some((row) => row.id === share.id),
  );

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">Share “{name}”</DialogTitle>
          <DialogDescription>
            {type === "folder"
              ? "Everyone below can read this folder and everything inside it. Nobody can change anything."
              : "Everyone below can read and download this file. Nobody can change it."}
          </DialogDescription>
        </DialogHeader>

        {/* Above everything, and outside the list: whatever else failed, the link that
            was just created has to be copyable. */}
        {unlisted.length > 0 && (
          <ul className="space-y-2">
            {unlisted.map((share) => (
              <ShareRow
                key={share.id}
                share={share}
                token={share.token}
                icon={
                  share.kind === "link" ? (
                    <LinkIcon className="size-4" />
                  ) : (
                    <MailIcon className="size-4" />
                  )
                }
                title={share.email ?? "Anyone with the link"}
                onRevoke={() => revoke.mutate(share.id)}
              />
            ))}
          </ul>
        )}

        {shares.isPending && <RowsSkeleton rows={3} className="rounded-lg border" />}

        {/* Only when there is nothing to fall back on. A refetch that fails behind a
            list already on screen should leave the list, not replace it with a box. */}
        {shares.isError && !shares.data && (
          <div className="rounded-lg border">
            <EmptyState
              icon={<Share2Icon />}
              title="Could not load who has access"
              description={
                shares.error instanceof ApiError
                  ? shares.error.message
                  : "Something went wrong."
              }
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void shares.refetch()}
                >
                  Try again
                </Button>
              }
            />
          </div>
        )}

        {shares.data && (
          <div className="space-y-5">
            {shares.data.inherited && (
              <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                <CornerLeftUpIcon className="mt-0.5 size-4 shrink-0" />
                A folder above this one is already shared, so anyone with that
                link can reach this too.
              </p>
            )}

            {shares.data.shares.length === 0 && !shares.data.inherited && (
              <p className="text-sm text-muted-foreground">
                Not shared yet — nobody but you can open this.
              </p>
            )}

            <LinkSection
              links={links}
              tokens={tokens}
              pending={create.isPending}
              onCreate={(expiresIn) => add({ kind: "link", expiresIn })}
              onRevoke={(id) => revoke.mutate(id)}
            />

            <PeopleSection
              people={people}
              tokens={tokens}
              pending={create.isPending}
              onInvite={(email, expiresIn) =>
                add({ kind: "user", email, expiresIn })
              }
              onRevoke={(id) => revoke.mutate(id)}
            />

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LinkSection({
  links,
  tokens,
  pending,
  onCreate,
  onRevoke,
}: {
  links: Share[];
  tokens: Record<string, string>;
  pending: boolean;
  onCreate: (expiresIn: ExpiryPreset) => Promise<boolean>;
  onRevoke: (id: string) => void;
}) {
  const [expiresIn, setExpiresIn] = useState<ExpiryPreset>("never");

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Anyone with the link</h3>

      {links.length === 0 ? (
        <div className="flex items-center gap-2">
          <ExpirySelect
            id="link-expiry"
            value={expiresIn}
            onChange={setExpiresIn}
          />
          <Button
            size="sm"
            disabled={pending}
            onClick={() => void onCreate(expiresIn)}
          >
            <LinkIcon />
            Create link
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {links.map((share) => (
            <ShareRow
              key={share.id}
              share={share}
              token={tokens[share.id]}
              icon={<LinkIcon className="size-4" />}
              title="Anyone with the link"
              onRevoke={() => onRevoke(share.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PeopleSection({
  people,
  tokens,
  pending,
  onInvite,
  onRevoke,
}: {
  people: Share[];
  tokens: Record<string, string>;
  pending: boolean;
  onInvite: (email: string, expiresIn: ExpiryPreset) => Promise<boolean>;
  onRevoke: (id: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [expiresIn, setExpiresIn] = useState<ExpiryPreset>("never");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (email.trim().length === 0) return;
    if (await onInvite(email.trim(), expiresIn)) setEmail("");
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Specific people</h3>

      <form onSubmit={(event) => void submit(event)} className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="share-email" className="sr-only">
            Email address
          </Label>
          <Input
            id="share-email"
            type="email"
            autoComplete="off"
            placeholder="name@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <ExpirySelect
            id="person-expiry"
            value={expiresIn}
            onChange={setExpiresIn}
          />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            Invite
          </Button>
        </div>
        {/* No mail is sent from this app, so saying so is the difference between an
            owner handing the link over and an owner waiting for a delivery. */}
        <p className="text-xs text-muted-foreground">
          They will need to sign in with this address. Send them the link
          yourself — no email is sent from here.
        </p>
      </form>

      {people.length > 0 && (
        <ul className="space-y-2">
          {people.map((share) => (
            <ShareRow
              key={share.id}
              share={share}
              token={tokens[share.id]}
              icon={<MailIcon className="size-4" />}
              title={share.email ?? "Invited person"}
              onRevoke={() => onRevoke(share.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ShareRow({
  share,
  token,
  icon,
  title,
  onRevoke,
}: {
  share: Share;
  /** Present only while this panel is the one that created it. */
  token: string | undefined;
  icon: React.ReactNode;
  title: string;
  onRevoke: () => void;
}) {
  return (
    <li className="rounded-lg border px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">
            Viewer · {expiryLabel(share)}
          </span>
        </span>
        <Button variant="ghost" size="sm" onClick={onRevoke}>
          Revoke
        </Button>
      </div>

      {token && <CopyableLink token={token} />}
    </li>
  );
}

/**
 * The only place this URL ever appears. It is rendered in a field rather than as text so
 * it can be selected by hand when the clipboard API is unavailable — an insecure origin,
 * or a browser that refuses the permission.
 */
function CopyableLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/s/${token}`;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Nothing to report: the field beside the button holds the same text, already
      // selected, and telling someone their clipboard is blocked helps nobody.
    }
  }

  return (
    <div className="mt-2.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={url}
          aria-label="Share link"
          className="font-mono text-xs"
          onFocus={(event) => event.target.select()}
        />
        <Button
          size="sm"
          variant={copied ? "outline" : "default"}
          onClick={() => void copy()}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Copy it now — for security this link is not shown again.
      </p>
    </div>
  );
}

function ExpirySelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ExpiryPreset;
  onChange: (value: ExpiryPreset) => void;
}) {
  return (
    <>
      <Label htmlFor={id} className="sr-only">
        Expiry
      </Label>
      {/* A native select: three options, no popup to trap focus in, and it is the one
          control every platform already renders correctly on touch. */}
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as ExpiryPreset)}
        className={cn(
          "h-8 shrink-0 rounded-lg border border-input bg-transparent px-2 text-sm outline-none",
          "transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        )}
      >
        <option value="never">No expiry</option>
        <option value="24h">24 hours</option>
        <option value="7d">7 days</option>
        <option value="30d">30 days</option>
      </select>
    </>
  );
}

function expiryLabel(share: Share): string {
  return share.expiresAt
    ? `Expires ${formatDate(share.expiresAt)}`
    : "No expiry";
}
