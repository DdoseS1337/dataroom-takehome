import type { AuthUser } from '../auth/current-user.decorator';
import { ApiError } from '../common/api-error';
import { SharesService } from './shares.service';

/**
 * The three-way answer at `/s/:token`, and the one exception to it.
 *
 * This is the branch `docs/architecture.md` calls the place where a wrong turn is a data
 * leak rather than a bug, and Block 6 relaxed it — an owner following their own named link
 * is let through instead of being told it belongs to somebody else. What must not have
 * come with that is a way for anyone who is *not* the owner to pass the same check, so
 * the refusals are pinned here alongside it.
 *
 * Everything below the token resolution is stubbed on purpose: `NodesService` has its own
 * tests, and what is under examination is which requester gets past this gate.
 */

const owner: AuthUser = { id: 'user-owner', email: 'owner@example.com' };
const grantee: AuthUser = { id: 'user-grantee', email: 'invited@example.com' };
const stranger: AuthUser = { id: 'user-stranger', email: 'other@example.com' };

/** Shaped like a real one — 43 base64url characters — so it survives `isShareTokenShaped`
 * before the (stubbed) lookup. */
const TOKEN = 'a'.repeat(43);

interface ShareOverrides {
  kind?: 'link' | 'user';
  granteeUserId?: string | null;
  granteeEmail?: string | null;
  expiresAt?: Date | null;
  revokedAt?: Date | null;
}

function shareRow(overrides: ShareOverrides = {}) {
  return {
    id: 'share-1',
    nodeId: 'node-1',
    kind: 'user',
    role: 'viewer',
    tokenHash: 'unused — the lookup is stubbed',
    granteeUserId: grantee.id,
    granteeEmail: grantee.email,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

/** The service with only the collaborators this path touches. `open()` is the thinnest
 * public route to `principal()`, which is what is actually under test. */
function serviceFor(
  share: ReturnType<typeof shareRow> | null,
  ownerId: string,
) {
  const prisma = {
    share: { findUnique: jest.fn().mockResolvedValue(share) },
  };
  const nodes = {
    get: jest.fn().mockResolvedValue({
      node: { id: 'node-1' },
      breadcrumbs: [],
      permission: 'viewer',
    }),
  };
  const repository = {
    findRoomOwner: jest.fn().mockResolvedValue(ownerId),
  };
  const files = {
    downloadUrl: jest
      .fn()
      .mockResolvedValue({ url: 'https://storage/x', expiresAt: '' }),
  };

  const service = new SharesService(
    prisma as never,
    nodes as never,
    repository as never,
    files as never,
  );

  return { service, prisma, nodes, repository, files };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'no error';
  } catch (error) {
    return error instanceof ApiError ? error.code : 'not an ApiError';
  }
}

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'no error';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('SharesService — who gets past a named link', () => {
  it('lets the grantee through', async () => {
    const { service } = serviceFor(shareRow(), owner.id);
    await expect(service.open(TOKEN, grantee)).resolves.toMatchObject({
      share: { id: 'share-1' },
    });
  });

  it('refuses a signed-in stranger with WRONG_ACCOUNT, not 404', async () => {
    const { service } = serviceFor(shareRow(), owner.id);
    await expect(codeOf(service.open(TOKEN, stranger))).resolves.toBe(
      'WRONG_ACCOUNT',
    );
  });

  it('builds the refusal from the requester’s own address, never the grantee’s', async () => {
    const { service } = serviceFor(shareRow(), owner.id);
    const message = await messageOf(service.open(TOKEN, stranger));

    expect(message).toContain(stranger.email);
    expect(message).not.toContain(grantee.email);
  });

  it('lets the owner of the item through their own invitation', async () => {
    const { service } = serviceFor(shareRow(), owner.id);
    await expect(service.open(TOKEN, owner)).resolves.toMatchObject({
      share: { id: 'share-1' },
    });
  });

  it('does not pay for the owner check on the grantee’s path', async () => {
    const { service, repository } = serviceFor(shareRow(), owner.id);
    await service.open(TOKEN, grantee);
    expect(repository.findRoomOwner).not.toHaveBeenCalled();
  });

  it('still refuses a stranger when the item’s room has no owner row to find', async () => {
    const { service, repository } = serviceFor(shareRow(), owner.id);
    repository.findRoomOwner.mockResolvedValue(null);
    await expect(codeOf(service.open(TOKEN, stranger))).resolves.toBe(
      'WRONG_ACCOUNT',
    );
  });

  it('answers an anonymous requester with UNAUTHENTICATED, not the token’s existence', async () => {
    const { service } = serviceFor(shareRow(), owner.id);
    await expect(codeOf(service.open(TOKEN, undefined))).resolves.toBe(
      'UNAUTHENTICATED',
    );
  });

  it('gives a guessed token the same answer as a named share to an anonymous requester', async () => {
    const { service } = serviceFor(null, owner.id);
    await expect(codeOf(service.open(TOKEN, undefined))).resolves.toBe(
      'UNAUTHENTICATED',
    );
  });

  it('gives a guessed token 404 for someone signed in — never 403', async () => {
    const { service } = serviceFor(null, owner.id);
    await expect(codeOf(service.open(TOKEN, stranger))).resolves.toBe(
      'NOT_FOUND',
    );
  });

  it('refuses a revoked link before it asks who is holding it', async () => {
    const { service } = serviceFor(
      shareRow({ revokedAt: new Date('2026-08-10T00:00:00Z') }),
      owner.id,
    );
    // The owner too: revocation is the owner's own act, and reporting it as anything
    // other than "turned off" would make their own link look broken instead of closed.
    await expect(codeOf(service.open(TOKEN, owner))).resolves.toBe(
      'SHARE_EXPIRED',
    );
  });

  it('refuses an expired link', async () => {
    const { service } = serviceFor(
      shareRow({ expiresAt: new Date('2026-08-10T00:00:00Z') }),
      owner.id,
    );
    await expect(codeOf(service.open(TOKEN, grantee))).resolves.toBe(
      'SHARE_EXPIRED',
    );
  });

  /**
   * The download DTO is shared by the private route and this mirror, so `versionId`
   * arrives here whether or not this route wants it. Dropping it would answer a request
   * for one version with a different one, and report that as success.
   */
  it('forwards versionId rather than quietly serving the current version', async () => {
    const { service, files } = serviceFor(
      shareRow({ kind: 'link', granteeUserId: null, granteeEmail: null }),
      owner.id,
    );

    await service.downloadUrl(
      TOKEN,
      'file-1',
      'attachment',
      owner,
      'version-7',
    );

    expect(files.downloadUrl).toHaveBeenCalledWith(
      'file-1',
      'attachment',
      owner,
      expect.objectContaining({ id: 'share-1' }),
      'version-7',
    );
  });

  it('opens a link share for an anonymous requester', async () => {
    const { service } = serviceFor(
      shareRow({ kind: 'link', granteeUserId: null, granteeEmail: null }),
      owner.id,
    );
    await expect(service.open(TOKEN, undefined)).resolves.toMatchObject({
      share: { kind: 'link' },
    });
  });
});
