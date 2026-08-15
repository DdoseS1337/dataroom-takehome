import type { AuthUser } from '../auth/current-user.decorator';
import { ApiError } from '../common/api-error';
import { NodesService } from './nodes.service';
import type { NodeWithRoom, SearchRow } from './nodes.repository';

/**
 * Search, and the one property that makes it safe to expose at all: it never runs against
 * anything the requester has not already been authorised for.
 *
 * The bound itself is SQL — a prefix scan on the materialised path — and no unit test can
 * check what Postgres does with it. What is checkable here is the part that decides *what
 * gets bounded*: the query is handed the node `authorise()` returned, and it does not run
 * when `authorise()` refuses. Those are the two ways this endpoint could leak, and both
 * are one line away from being wrong.
 */

const owner: AuthUser = { id: 'user-owner', email: 'owner@example.com' };

const scopeNode: NodeWithRoom = {
  id: 'node-scope',
  dataRoomId: 'room-1',
  parentId: null,
  type: 'folder',
  name: 'Project Atlas',
  path: '/node-scope/',
  depth: 0,
  status: 'ready',
  currentVersionId: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
  deletedAt: null,
  ownerId: owner.id,
  roomName: 'Project Atlas',
};

function hit(name: string): SearchRow {
  return {
    id: `node-${name}`,
    type: 'file',
    name,
    updatedAt: new Date('2026-08-02T00:00:00Z'),
    sizeBytes: 1024n,
    parentName: 'Financials',
  };
}

function serviceFor(rows: SearchRow[], authorise?: () => never) {
  const repository = {
    searchByName: jest.fn().mockResolvedValue(rows),
  };
  const service = new NodesService(repository as never);

  jest.spyOn(service, 'authorise').mockImplementation(
    authorise ??
      (() =>
        Promise.resolve({
          node: scopeNode,
          permission: 'owner' as const,
          grants: [],
        })),
  );

  return { service, repository };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'no error';
  } catch (error) {
    return error instanceof ApiError ? error.code : 'not an ApiError';
  }
}

describe('NodesService.search', () => {
  it('searches the node authorise returned, never the id it was handed', async () => {
    const { service, repository } = serviceFor([hit('NDA.pdf')]);

    await service.search('node-scope', 'nda', owner);

    expect(repository.searchByName).toHaveBeenCalledWith(
      scopeNode,
      'nda',
      expect.any(Number),
    );
  });

  it('does not query at all when the scope is refused', async () => {
    const { service, repository } = serviceFor([hit('NDA.pdf')], () => {
      throw ApiError.notFound();
    });

    await expect(
      codeOf(service.search('node-scope', 'nda', owner)),
    ).resolves.toBe('NOT_FOUND');
    expect(repository.searchByName).not.toHaveBeenCalled();
  });

  it('refuses a term too short for the index to answer', async () => {
    const { service, repository } = serviceFor([]);

    await expect(
      codeOf(service.search('node-scope', 'a', owner)),
    ).resolves.toBe('VALIDATION_FAILED');
    expect(repository.searchByName).not.toHaveBeenCalled();
  });

  it('counts the term after trimming, so spaces do not buy their way past the floor', async () => {
    const { service } = serviceFor([]);

    await expect(
      codeOf(service.search('node-scope', '  a  ', owner)),
    ).resolves.toBe('VALIDATION_FAILED');
  });

  it('reports the cap instead of quietly returning a prefix of the matches', async () => {
    // One more than the limit is exactly what the repository is asked for, so the extra
    // row is the marker — it must not ship as a result.
    const rows = Array.from({ length: 51 }, (_, index) =>
      hit(`Deed ${index}.pdf`),
    );
    const { service } = serviceFor(rows);

    const result = await service.search('node-scope', 'deed', owner);

    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(50);
  });

  it('says nothing about a cap when the results fit under it', async () => {
    const { service } = serviceFor([hit('NDA.pdf'), hit('Lease.pdf')]);

    const result = await service.search('node-scope', 'pdf', owner);

    expect(result.truncated).toBe(false);
    expect(result.items).toHaveLength(2);
  });

  it('carries the parent folder back, because a bare filename is not an answer', async () => {
    const { service } = serviceFor([hit('NDA.pdf')]);

    const result = await service.search('node-scope', 'nda', owner);

    expect(result.items[0]).toMatchObject({
      name: 'NDA.pdf',
      parentName: 'Financials',
      // bigint does not survive JSON.stringify — see `toSummary`.
      sizeBytes: 1024,
    });
  });
});
