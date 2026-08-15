import type { AuthUser } from '../auth/current-user.decorator';

export type Permission = 'owner' | 'editor' | 'viewer' | 'none';

/**
 * A `shares` row reduced to what the rule is allowed to look at. Rows arrive whatever
 * their state — revoked and expired included — because deciding that is this function's
 * job, and a caller that filtered first would be a second place the rule lives.
 */
export interface Grant {
  id: string;
  /** The node the share was made on — this one, or one of its ancestors. */
  nodeId: string;
  kind: 'link' | 'user';
  role: 'viewer' | 'editor';
  granteeUserId: string | null;
  /** Stored lowercased, so the comparison here can be exact. */
  granteeEmail: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface PermissionContext {
  /** Owner of the data room the node belongs to. */
  ownerId: string;
  /**
   * Every share on the node itself or on any of its ancestors. The caller loads them —
   * out of that set, everything else follows from the grants themselves, which is why a
   * share on a node outside the chain can never leak in: it is simply never loaded.
   */
  grants?: Grant[];
  /**
   * The share whose token this request presented, if any. A link share is a capability:
   * knowing the node id is not holding the link, so a link grant applies to the holder
   * of its token and to nobody else. A named grant is an identity and needs no token.
   */
  presentedShareId?: string | null;
  /** Injectable so expiry is testable without waiting for it. */
  now?: Date;
}

const RANK: Record<Permission, number> = {
  none: 0,
  viewer: 1,
  editor: 2,
  owner: 3,
};

/**
 * The only place a permission is derived. Pure, no I/O — callers load the context and
 * pass it in, so the rule stays testable and there is one answer per node rather than
 * one per call site.
 *
 * The answer is the **maximum** grant across the whole ancestor chain, never the first
 * one found walking up: a viewer grant on a subfolder must not shadow an editor grant on
 * the room above it, and stopping at the nearest match would do exactly that.
 *
 * `user` is optional because `/s/:token` is public and has to distinguish anonymous
 * from signed-in-as-the-wrong-account.
 */
export function resolvePermission(
  user: AuthUser | undefined,
  context: PermissionContext,
): Permission {
  if (user && user.id === context.ownerId) return 'owner';

  const now = context.now ?? new Date();
  const presented = context.presentedShareId ?? null;

  let best: Permission = 'none';
  for (const grant of context.grants ?? []) {
    if (!applies(grant, user, presented, now)) continue;
    if (RANK[grant.role] > RANK[best]) best = grant.role;
  }
  return best;
}

/**
 * How much of an ancestor trail this requester is allowed to see, as the index of the
 * highest node they can actually read. Everything above it is someone else's structure —
 * the names of the folders the shared one sits in, and the name of the data room itself.
 *
 * The rule is the same one that grants access, applied to each ancestor in turn rather
 * than only to the node at the end: a grant reaches a node from anywhere at or above it,
 * so the first ancestor whose own chain carries a grant is where the trail starts. An
 * owner matches at the root and sees the whole path; a recipient matches at the folder
 * they were given.
 *
 * `-1` when nothing in the chain is readable, which the caller should treat as "the node
 * itself and nothing more" — it cannot happen for a requester who has already been
 * authorised, and answering with the whole trail would be the wrong way to be wrong.
 */
export function firstReadableAncestor(
  user: AuthUser | undefined,
  ancestorIds: string[],
  context: PermissionContext,
): number {
  const reaching: Grant[] = [];

  for (const [index, id] of ancestorIds.entries()) {
    for (const grant of context.grants ?? []) {
      if (grant.nodeId === id) reaching.push(grant);
    }
    if (resolvePermission(user, { ...context, grants: reaching }) !== 'none') {
      return index;
    }
  }
  return -1;
}

function applies(
  grant: Grant,
  user: AuthUser | undefined,
  presentedShareId: string | null,
  now: Date,
): boolean {
  if (grant.revokedAt !== null) return false;
  if (grant.expiresAt !== null && grant.expiresAt.getTime() <= now.getTime()) {
    return false;
  }

  if (grant.kind === 'link') return grant.id === presentedShareId;
  return grantNamesUser(grant, user);
}

/**
 * Whether a named grant is addressed to this requester.
 *
 * Exported because `/s/:token` has to answer the same question for a different purpose:
 * a token holder the share does not name gets "you are signed in as the wrong account"
 * rather than a bare `404`. Asking it in two places is how those two answers drift apart
 * — one of them into a leak.
 *
 * Identity is the user id once there is one to bind to. Emails get reassigned, and a
 * grant that kept matching on the address would hand the next holder of it the access
 * that was meant for the person who had it before.
 */
export function grantNamesUser(
  grant: Grant,
  user: AuthUser | undefined,
): boolean {
  if (!user) return false;
  if (grant.granteeUserId !== null) return grant.granteeUserId === user.id;
  return (
    grant.granteeEmail !== null &&
    grant.granteeEmail === user.email.trim().toLowerCase()
  );
}

export function canRead(permission: Permission): boolean {
  return permission !== 'none';
}

export function canWrite(permission: Permission): boolean {
  return permission === 'owner' || permission === 'editor';
}
