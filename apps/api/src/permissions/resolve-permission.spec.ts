import type { AuthUser } from '../auth/current-user.decorator';
import {
  firstReadableAncestor,
  resolvePermission,
  type Grant,
  type Permission,
  type PermissionContext,
} from './resolve-permission';

const owner: AuthUser = { id: 'user-owner', email: 'owner@example.com' };
const grantee: AuthUser = { id: 'user-grantee', email: 'invited@example.com' };
const stranger: AuthUser = { id: 'user-stranger', email: 'other@example.com' };

const NOW = new Date('2026-08-15T12:00:00Z');
const EARLIER = new Date('2026-08-15T11:00:00Z');
const LATER = new Date('2026-08-15T13:00:00Z');

function grant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: 'share-1',
    nodeId: 'node',
    kind: 'link',
    role: 'viewer',
    granteeUserId: null,
    granteeEmail: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

/** A named share, in the two shapes it takes: bound to an account, or still pending on
 * an address nobody has signed up with yet. */
function namedGrant(overrides: Partial<Grant> = {}): Grant {
  return grant({
    kind: 'user',
    granteeUserId: grantee.id,
    granteeEmail: grantee.email,
    ...overrides,
  });
}

// Table-driven because this function is the gatekeeper on every read in the app: each
// row is a way someone could get access they should not have, or be refused access they
// should. A case that is missing here is a case nothing else in the codebase checks.
const cases: Array<{
  name: string;
  user: AuthUser | undefined;
  context: Omit<PermissionContext, 'now'>;
  expected: Permission;
}> = [
  {
    name: 'the room owner owns every node in it',
    user: owner,
    context: { ownerId: owner.id },
    expected: 'owner',
  },
  {
    name: 'another signed-in user has nothing without a share',
    user: stranger,
    context: { ownerId: owner.id },
    expected: 'none',
  },
  {
    name: 'an anonymous requester has nothing',
    user: undefined,
    context: { ownerId: owner.id },
    expected: 'none',
  },

  // --- link shares: the token is the whole credential -----------------------
  {
    name: 'a public link admits an anonymous holder of its token',
    user: undefined,
    context: {
      ownerId: owner.id,
      grants: [grant()],
      presentedShareId: 'share-1',
    },
    expected: 'viewer',
  },
  {
    name: 'a public link admits nobody who did not present it, id or no id',
    user: stranger,
    context: { ownerId: owner.id, grants: [grant()], presentedShareId: null },
    expected: 'none',
  },
  {
    name: 'presenting one token does not activate a different share',
    user: undefined,
    context: {
      ownerId: owner.id,
      grants: [grant({ id: 'share-1' })],
      presentedShareId: 'share-2',
    },
    expected: 'none',
  },

  // --- named shares: the identity is the credential -------------------------
  {
    name: 'a named grant admits its grantee without a token',
    user: grantee,
    context: { ownerId: owner.id, grants: [namedGrant()] },
    expected: 'viewer',
  },
  {
    name: 'a pending grant admits the address that has just signed up',
    user: grantee,
    context: {
      ownerId: owner.id,
      grants: [namedGrant({ granteeUserId: null })],
      presentedShareId: 'share-1',
    },
    expected: 'viewer',
  },
  {
    name: 'a named grant admits nobody else, even holding the token',
    user: stranger,
    context: {
      ownerId: owner.id,
      grants: [namedGrant()],
      presentedShareId: 'share-1',
    },
    expected: 'none',
  },
  {
    name: 'a named grant admits no anonymous requester holding the token',
    user: undefined,
    context: {
      ownerId: owner.id,
      grants: [namedGrant()],
      presentedShareId: 'share-1',
    },
    expected: 'none',
  },
  {
    name: 'once bound to an account, the address alone no longer admits',
    user: { id: 'someone-new', email: grantee.email },
    context: { ownerId: owner.id, grants: [namedGrant()] },
    expected: 'none',
  },
  {
    name: 'a pending grant matches the address case-insensitively',
    user: { id: grantee.id, email: 'Invited@Example.com' },
    context: {
      ownerId: owner.id,
      grants: [namedGrant({ granteeUserId: null })],
    },
    expected: 'viewer',
  },

  // --- revoked and expired --------------------------------------------------
  {
    name: 'a revoked link admits nobody',
    user: undefined,
    context: {
      ownerId: owner.id,
      grants: [grant({ revokedAt: EARLIER })],
      presentedShareId: 'share-1',
    },
    expected: 'none',
  },
  {
    name: 'a revoked named grant admits nobody',
    user: grantee,
    context: {
      ownerId: owner.id,
      grants: [namedGrant({ revokedAt: EARLIER })],
    },
    expected: 'none',
  },
  {
    name: 'an expired link admits nobody',
    user: undefined,
    context: {
      ownerId: owner.id,
      grants: [grant({ expiresAt: EARLIER })],
      presentedShareId: 'share-1',
    },
    expected: 'none',
  },
  {
    name: 'expiry still ahead admits normally',
    user: undefined,
    context: {
      ownerId: owner.id,
      grants: [grant({ expiresAt: LATER })],
      presentedShareId: 'share-1',
    },
    expected: 'viewer',
  },
  {
    name: 'expiry is exclusive at the boundary',
    user: undefined,
    context: {
      ownerId: owner.id,
      grants: [grant({ expiresAt: NOW })],
      presentedShareId: 'share-1',
    },
    expected: 'none',
  },

  // --- inheritance and the maximum rule -------------------------------------
  {
    name: 'a grant on an ancestor reaches this node',
    user: grantee,
    // The caller loads the ancestors' shares along with the node's own; nothing here
    // distinguishes them, which is what makes a share on a folder cover its subtree.
    context: { ownerId: owner.id, grants: [namedGrant()] },
    expected: 'viewer',
  },
  {
    name: 'the strongest grant in the chain wins, not the nearest',
    user: grantee,
    context: {
      ownerId: owner.id,
      grants: [
        namedGrant({ id: 'ancestor', role: 'editor' }),
        namedGrant({ id: 'node', role: 'viewer' }),
      ],
    },
    expected: 'editor',
  },
  {
    name: 'the strongest grant wins in the other order too',
    user: grantee,
    context: {
      ownerId: owner.id,
      grants: [
        namedGrant({ id: 'ancestor', role: 'viewer' }),
        namedGrant({ id: 'node', role: 'editor' }),
      ],
    },
    expected: 'editor',
  },
  {
    name: 'a dead grant does not shadow a live one',
    user: grantee,
    context: {
      ownerId: owner.id,
      grants: [
        namedGrant({ id: 'dead', role: 'editor', revokedAt: EARLIER }),
        namedGrant({ id: 'live', role: 'viewer' }),
      ],
    },
    expected: 'viewer',
  },
  {
    name: 'no grants in the chain is no access — a share moved out of scope',
    user: grantee,
    // A node moved out of a shared folder loses its grants by construction: the chain
    // is read from `path`, so the share is no longer among the rows loaded at all.
    context: { ownerId: owner.id, grants: [], presentedShareId: 'share-1' },
    expected: 'none',
  },
  {
    name: 'the owner still owns a node someone else was granted',
    user: owner,
    context: { ownerId: owner.id, grants: [namedGrant({ role: 'editor' })] },
    expected: 'owner',
  },
];

describe('resolvePermission', () => {
  it.each(cases)('$name', ({ user, context, expected }) => {
    expect(resolvePermission(user, { ...context, now: NOW })).toBe(expected);
  });

  // Identity is the user id, never the email: emails change, and a share matched on a
  // reused address would hand the new holder the old holder's access.
  it('does not treat a matching email as ownership', () => {
    const sameEmail: AuthUser = { id: 'someone-else', email: owner.email };
    expect(resolvePermission(sameEmail, { ownerId: owner.id })).toBe('none');
  });
});

/**
 * The breadcrumb trail is derived from the same rule, and it has to be: a recipient who
 * is shown the folders above the one they were given learns the shape and the names of a
 * deal they have no access to — which in this domain is the interesting part.
 */
describe('firstReadableAncestor', () => {
  const chain = ['room', 'deal', 'shared', 'inside'];

  it('starts an owner at the room', () => {
    expect(firstReadableAncestor(owner, chain, { ownerId: owner.id })).toBe(0);
  });

  it('starts a recipient at the folder they were given', () => {
    const grants = [namedGrant({ nodeId: 'shared' })];
    expect(
      firstReadableAncestor(grantee, chain, { ownerId: owner.id, grants }),
    ).toBe(2);
  });

  it('starts a link holder at the shared folder, not above it', () => {
    const grants = [grant({ nodeId: 'shared' })];
    expect(
      firstReadableAncestor(undefined, chain, {
        ownerId: owner.id,
        grants,
        presentedShareId: 'share-1',
      }),
    ).toBe(2);
  });

  it('starts at the room when the whole room was shared', () => {
    const grants = [namedGrant({ nodeId: 'room' })];
    expect(
      firstReadableAncestor(grantee, chain, { ownerId: owner.id, grants }),
    ).toBe(0);
  });

  it('takes the highest of several grants down the chain', () => {
    const grants = [
      namedGrant({ id: 'deep', nodeId: 'inside' }),
      namedGrant({ id: 'high', nodeId: 'deal' }),
    ];
    expect(
      firstReadableAncestor(grantee, chain, { ownerId: owner.id, grants }),
    ).toBe(1);
  });

  it('ignores a revoked grant when deciding where the trail starts', () => {
    const grants = [
      namedGrant({ id: 'dead', nodeId: 'deal', revokedAt: EARLIER }),
      namedGrant({ id: 'live', nodeId: 'shared' }),
    ];
    expect(
      firstReadableAncestor(grantee, chain, { ownerId: owner.id, grants }),
    ).toBe(2);
  });

  it('gives a requester with nothing no trail at all', () => {
    expect(firstReadableAncestor(stranger, chain, { ownerId: owner.id })).toBe(
      -1,
    );
  });
});
