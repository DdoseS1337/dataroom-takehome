import type { AuthUser } from '../auth/current-user.decorator';

export type Permission = 'owner' | 'editor' | 'viewer' | 'none';

/**
 * Everything the permission rule is allowed to look at. Block 5 adds the grants that
 * apply to the node — every share on it or on any ancestor — and the rule becomes the
 * maximum across them. Until those exist, adding the field would be dead weight the
 * function ignores.
 */
export interface PermissionContext {
  /** Owner of the data room the node belongs to. */
  ownerId: string;
}

/**
 * The only place a permission is derived. Pure, no I/O — callers load the context and
 * pass it in, so the rule stays testable and there is one answer per node rather than
 * one per call site.
 *
 * `user` is optional because `/s/:token` is public and has to distinguish anonymous
 * from signed-in-as-the-wrong-account.
 */
export function resolvePermission(
  user: AuthUser | undefined,
  context: PermissionContext,
): Permission {
  if (user && user.id === context.ownerId) return 'owner';
  return 'none';
}

export function canRead(permission: Permission): boolean {
  return permission !== 'none';
}

export function canWrite(permission: Permission): boolean {
  return permission === 'owner' || permission === 'editor';
}
