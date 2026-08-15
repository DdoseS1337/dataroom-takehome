"use client";

import { LogOutIcon, VaultIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, type ReactNode } from "react";
import { NodeView, ViewSkeleton } from "@/components/folder-view";
import { ErrorState, Explanation } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError } from "@/lib/api";
import { signOut, useAuth } from "@/lib/auth";
import { useShareEntry, type ApiBase } from "@/lib/queries";

/**
 * The fifth route: what a shared link opens.
 *
 * It is deliberately the same view the owner sees, read-only and reading through
 * `/s/<token>` instead of the private routes. A separate, thinner "public viewer" would
 * be a second implementation of the listing, the preview and the states — and the place
 * a missing permission check would hide.
 *
 * Which of the three answers a requester gets is decided by the API, not here; this
 * screen's job is to make each of them make sense. See docs/architecture.md.
 */
export default function SharePage() {
  return (
    // `useSearchParams` opts its subtree out of prerendering; the boundary keeps that
    // to the part that reads the query rather than the whole route.
    <Suspense
      fallback={
        <ShareShell>
          <ViewSkeleton />
        </ShareShell>
      }
    >
      <SharedItem />
    </Suspense>
  );
}

function SharedItem() {
  const { token } = useParams<{ token: string }>();
  const params = useSearchParams();
  const entry = useShareEntry(token);

  const base = `/s/${token}` as ApiBase;
  const root = entry.data?.share.rootNodeId;

  // The item stays in the query string rather than the path, so `/s/:token` remains one
  // route and the link someone was given keeps working as the address of the whole
  // share. Back through the folders is browser Back.
  const folderHref = useCallback(
    (nodeId: string) =>
      nodeId === root ? `/s/${token}` : `/s/${token}?node=${nodeId}`,
    [token, root],
  );

  return (
    <ShareShell owned={entry.data?.permission === "owner"}>
      {entry.isPending && <ViewSkeleton />}

      {entry.isError && (
        <ShareGate
          error={entry.error}
          token={token}
          onRetry={() => void entry.refetch()}
        />
      )}

      {entry.data && (
        <NodeView
          nodeId={params.get("node") ?? entry.data.share.rootNodeId}
          base={base}
          folderHref={folderHref}
          readOnly
          back={{ href: `/s/${token}`, label: "Back to the shared item" }}
        />
      )}
    </ShareShell>
  );
}

/**
 * Why this link did not open. Two of these are the reason the route exists at all:
 * an invitation opened by someone not signed in, and one opened by the wrong account —
 * neither of which is a `403` with nothing to do about it.
 */
function ShareGate({
  error,
  token,
  onRetry,
}: {
  error: unknown;
  token: string;
  onRetry: () => void;
}) {
  const router = useRouter();
  const state = useAuth();
  const code = error instanceof ApiError ? error.code : "INTERNAL";
  const target = encodeURIComponent(`/s/${token}`);

  if (code === "UNAUTHENTICATED") {
    return (
      <Explanation
        title="Sign in to view this item"
        body="This link was shared with a specific person. Sign in to continue — if it was meant for you, it will open."
        back={null}
        action={
          <Button render={<Link href={`/login?next=${target}`} />}>
            Sign in
          </Button>
        }
      />
    );
  }

  if (code === "WRONG_ACCOUNT") {
    return (
      <Explanation
        title="This link is for a different account"
        // The API builds this from the requester's own address and never from the
        // grantee's — whoever holds a forwarded link is not entitled to learn who it
        // was meant for. See docs/architecture.md.
        body={error instanceof ApiError ? error.message : ""}
        back={{ href: "/", label: "Go to my data rooms" }}
        action={
          <Button
            onClick={() =>
              void signOut().then(() =>
                // `switch` makes Google offer the account chooser rather than silently
                // signing back in as the account that was just refused.
                router.replace(`/login?next=${target}&switch=1`),
              )
            }
          >
            Switch account
          </Button>
        }
      />
    );
  }

  // Revoked, expired, deleted, or simply not a link this app ever issued. Someone who
  // is signed in has somewhere to go; a visitor who followed a link has not.
  return (
    <ErrorState
      error={error}
      onRetry={onRetry}
      back={
        state.status === "signedIn"
          ? { href: "/", label: "Go to my data rooms" }
          : null
      }
    />
  );
}

/**
 * A frame of its own rather than `AppShell`: a recipient is here for one item, not for a
 * library, and may have no account at all.
 *
 * What it must not be is a dead end. Someone who is signed in gets their own way back to
 * their data rooms and their own way out; someone who is not gets an invitation to sign
 * in, which is the only thing that could be useful to them.
 */
function ShareShell({
  owned = false,
  children,
}: {
  /** The owner following one of their own links, which the API now lets through rather
   * than refusing as the wrong account. The page is still read-only — the mutations are
   * not mirrored here — so the badge says which of the two things this is. */
  owned?: boolean;
  children: ReactNode;
}) {
  const state = useAuth();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
          {state.status === "signedIn" ? (
            <Link
              href="/"
              className="flex items-center gap-2 text-sm font-medium tracking-tight"
            >
              <VaultIcon className="size-4 text-primary" />
              Data Room
            </Link>
          ) : (
            <span className="flex items-center gap-2 text-sm font-medium tracking-tight">
              <VaultIcon className="size-4 text-primary" />
              Data Room
            </span>
          )}

          {/* Two different true things. The owner is not shown a recipient's view — they
              resolve as the owner, so their breadcrumb trail is whole and their search
              covers the room — they are simply on a page that offers no controls. Saying
              "as recipients see it" would promise the one thing this does not do. */}
          <span className="hidden rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground sm:inline">
            {owned ? "Your own link · read only" : "Shared with you · read only"}
          </span>

          <div className="ml-auto">
            {state.status === "signedIn" ? (
              <ShareUserMenu email={state.user.email} />
            ) : (
              <Button variant="outline" size="sm" render={<Link href="/login" />}>
                Sign in
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}

function ShareUserMenu({ email }: { email: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="max-w-56 truncate">
            {email}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        {/* Base UI throws if a GroupLabel has no Group ancestor — see `app-shell`. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
            {email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link href="/" />}>
            <VaultIcon />
            My data rooms
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void signOut()}>
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
