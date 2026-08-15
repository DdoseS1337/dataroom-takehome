import { ApiError } from '../common/api-error';
import { nextCandidateName } from '../nodes/node-name';
import type {
  InFlightVersion,
  NewUpload,
  NodeWithRoom,
  NodesRepository,
  SiblingRow,
} from '../nodes/nodes.repository';
import type { NodesService } from '../nodes/nodes.service';
import type { StorageService } from '../storage/storage.service';
import { ABANDONED_AFTER_MS, FilesService } from './files.service';

/**
 * Name conflict resolution, which docs/architecture.md calls out for tests: it decides
 * whether a user's file is renamed, replaced or refused, and it is the one place where
 * a race between two uploads is resolved rather than avoided.
 *
 * The repository is a stub that raises `23505` for names already taken, so each case
 * exercises the real branch order rather than a mocked outcome of it.
 */

const PARENT: NodeWithRoom = {
  id: 'parent-id',
  dataRoomId: 'room-id',
  parentId: null,
  type: 'folder',
  name: 'Room',
  path: '/parent-id/',
  depth: 0,
  status: 'ready',
  currentVersionId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ownerId: 'owner-id',
  roomName: 'Room',
};

const USER = { id: 'owner-id', email: 'owner@example.com' };

class UniqueViolation extends Error {
  readonly code = '23505';
}

const FILE: NodeWithRoom = {
  ...PARENT,
  id: 'file-id',
  parentId: PARENT.id,
  type: 'file',
  name: 'MSA.pdf',
  path: '/parent-id/file-id/',
  depth: 1,
  status: 'uploading',
};

function storedPdf(sizeBytes: number) {
  return {
    kind: 'object' as const,
    firstBytes: Buffer.from('%PDF-1.7', 'latin1'),
    sizeBytes,
    contentType: 'application/pdf',
    etag: 'abc',
  };
}

function build(
  existing: SiblingRow[] = [],
  options: { node?: NodeWithRoom; inFlight?: InFlightVersion[] } = {},
) {
  const taken = new Map(
    existing.map((row) => [row.name.toLowerCase(), row] as const),
  );
  const inFlight = options.inFlight ?? [];

  const repository = {
    createFileNode: jest.fn(
      (parent: NodeWithRoom, name: string): Promise<NewUpload> => {
        if (taken.has(name.toLowerCase())) {
          return Promise.reject(new UniqueViolation());
        }
        taken.set(name.toLowerCase(), {
          id: `node-${taken.size}`,
          type: 'file',
          name,
          status: 'uploading',
          createdAt: new Date(),
        });
        return Promise.resolve({
          nodeId: `node-${name}`,
          name,
          versionId: 'version-id',
          storageKey: `${parent.dataRoomId}/node/version.pdf`,
        });
      },
    ),
    findSiblingByName: jest.fn(async (_parentId: string, name: string) =>
      Promise.resolve(taken.get(name.toLowerCase()) ?? null),
    ),
    softDeleteNode: jest.fn(async (id: string) => {
      for (const [key, row] of taken) if (row.id === id) taken.delete(key);
      return Promise.resolve();
    }),
    addVersion: jest.fn(async () => Promise.resolve()),
    deleteVersion: jest.fn(async () => Promise.resolve()),

    // Scoped by version id, the way the real query is — that scoping is the point of
    // several of the tests below.
    findInFlightVersion: jest.fn((nodeId: string, versionId?: string) =>
      Promise.resolve(
        inFlight.find((version) => !versionId || version.id === versionId) ??
          null,
      ),
    ),
    completeUpload: jest.fn(
      (node: NodeWithRoom, _versionId: string, sizeBytes: number) =>
        Promise.resolve({
          id: node.id,
          type: 'file' as const,
          name: node.name,
          sortName: node.name.toLowerCase(),
          sortRank: 1,
          updatedAt: new Date(),
          sizeBytes: BigInt(sizeBytes),
        }),
    ),
    findSummary: jest.fn(() =>
      Promise.resolve({
        id: FILE.id,
        type: 'file' as const,
        name: FILE.name,
        sortName: FILE.name.toLowerCase(),
        sortRank: 1,
        updatedAt: new Date(),
        sizeBytes: 4096n,
      }),
    ),
  };

  const nodes = {
    authorise: jest.fn(() =>
      Promise.resolve({
        node: options.node ?? PARENT,
        permission: 'owner' as const,
      }),
    ),
  };

  const storage = {
    signUploadUrl: jest.fn(async () => Promise.resolve('https://storage/put')),
    remove: jest.fn(async () => Promise.resolve()),
    probe: jest.fn(() => Promise.resolve(storedPdf(4096))),
  };

  const files = new FilesService(
    nodes as unknown as NodesService,
    repository as unknown as NodesRepository,
    storage as unknown as StorageService,
  );

  return { files, taken, repository, storage };
}

function sibling(overrides: Partial<SiblingRow> = {}): SiblingRow {
  return {
    id: 'existing-id',
    type: 'file',
    name: 'MSA.pdf',
    status: 'ready',
    createdAt: new Date(),
    ...overrides,
  };
}

function init(
  files: FilesService,
  over: Partial<Parameters<FilesService['init']>[0]> = {},
) {
  return files.init(
    { parentId: PARENT.id, name: 'MSA.pdf', sizeBytes: 1024, ...over },
    USER,
  );
}

describe('FilesService.init — name conflicts', () => {
  it('reserves the name when nothing holds it', async () => {
    const { files } = build();
    await expect(init(files)).resolves.toMatchObject({ name: 'MSA.pdf' });
  });

  it('refuses with NAME_CONFLICT when a ready file holds the name', async () => {
    const { files } = build([sibling()]);

    await expect(init(files)).rejects.toMatchObject({
      code: 'NAME_CONFLICT',
      details: { name: 'MSA.pdf', existingType: 'file' },
    });
  });

  it('reports a folder as the conflicting type, so Replace is not offered', async () => {
    const { files } = build([sibling({ type: 'folder', name: 'Contracts' })]);

    await expect(init(files, { name: 'Contracts' })).rejects.toMatchObject({
      details: { existingType: 'folder' },
    });
  });

  it('treats a case-only difference as the same name', async () => {
    const { files } = build([sibling({ name: 'msa.pdf' })]);

    await expect(init(files, { name: 'MSA.PDF' })).rejects.toMatchObject({
      code: 'NAME_CONFLICT',
    });
  });

  it('keeps both by numbering before the extension', async () => {
    const { files } = build([sibling()]);

    await expect(
      init(files, { onConflict: 'keepBoth' }),
    ).resolves.toMatchObject({ name: 'MSA (2).pdf' });
  });

  it('keeps counting past an already numbered sibling', async () => {
    const { files } = build([
      sibling(),
      sibling({ id: 'b', name: 'MSA (2).pdf' }),
    ]);

    await expect(
      init(files, { onConflict: 'keepBoth' }),
    ).resolves.toMatchObject({ name: 'MSA (3).pdf' });
  });

  it('replaces by adding a version to the existing node, never a second row', async () => {
    const { files, repository } = build([sibling()]);

    await expect(init(files, { onConflict: 'replace' })).resolves.toMatchObject(
      {
        nodeId: 'existing-id',
        name: 'MSA.pdf',
      },
    );
    expect(repository.addVersion).toHaveBeenCalledTimes(1);
  });

  it('refuses to replace a folder with a file', async () => {
    const { files } = build([sibling({ type: 'folder', name: 'Contracts' })]);

    await expect(
      init(files, { name: 'Contracts', onConflict: 'replace' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('FilesService.init — abandoned uploads', () => {
  const abandoned = () =>
    sibling({
      status: 'uploading',
      createdAt: new Date(Date.now() - ABANDONED_AFTER_MS - 1000),
    });

  it('clears an upload older than the window and takes the name', async () => {
    const { files, repository } = build([abandoned()]);

    await expect(init(files)).resolves.toMatchObject({ name: 'MSA.pdf' });
    expect(repository.softDeleteNode).toHaveBeenCalledWith('existing-id');
  });

  it('still conflicts with an upload that is only seconds old', async () => {
    const { files, repository } = build([
      sibling({ status: 'uploading', createdAt: new Date() }),
    ]);

    await expect(init(files)).rejects.toMatchObject({ code: 'NAME_CONFLICT' });
    expect(repository.softDeleteNode).not.toHaveBeenCalled();
  });

  it('retries exactly once — a name taken again in between is a plain conflict', async () => {
    const { files, taken, repository } = build([abandoned()]);

    // The retry finds the name taken again, which is what a live sibling looks like.
    repository.softDeleteNode.mockImplementation(async () => {
      taken.set('msa.pdf', sibling({ id: 'someone-else' }));
      return Promise.resolve();
    });

    await expect(init(files)).rejects.toMatchObject({ code: 'NAME_CONFLICT' });
    expect(repository.createFileNode).toHaveBeenCalledTimes(2);
  });
});

describe('FilesService.init — size', () => {
  it('rejects an empty file with its own message rather than "not a PDF"', async () => {
    const { files } = build();

    await expect(init(files, { sizeBytes: 0 })).rejects.toThrow(/empty/);
  });

  it('rejects an oversized file before minting an upload URL', async () => {
    const { files, repository } = build();

    await expect(
      init(files, { sizeBytes: 51 * 1024 * 1024 }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(repository.createFileNode).not.toHaveBeenCalled();
  });
});

/**
 * `complete` acts on the version the caller reserved, never on "whatever is newest on
 * this node". Two replacements of one file can overlap, and the difference decides
 * whose bytes are verified and whose are deleted.
 */
describe('FilesService.complete', () => {
  const mine: InFlightVersion = {
    id: 'version-mine',
    storageKey: 'room/file/mine.pdf',
  };
  const theirs: InFlightVersion = {
    id: 'version-theirs',
    storageKey: 'room/file/theirs.pdf',
  };

  it('verifies the reserved version, not the newest one on the node', async () => {
    const { files, storage } = build([], {
      node: FILE,
      inFlight: [theirs, mine],
    });

    await files.complete(FILE.id, mine.id, USER);
    expect(storage.probe).toHaveBeenCalledWith(mine.storageKey);
  });

  it('records the size read back from storage', async () => {
    const { files, storage } = build([], { node: FILE, inFlight: [mine] });
    storage.probe.mockResolvedValue(storedPdf(9000));

    await expect(files.complete(FILE.id, mine.id, USER)).resolves.toMatchObject(
      { sizeBytes: 9000 },
    );
  });

  it('rejects bytes that are not a PDF and clears the upload', async () => {
    const { files, storage, repository } = build([], {
      node: FILE,
      inFlight: [mine],
    });
    storage.probe.mockResolvedValue({
      ...storedPdf(100),
      firstBytes: Buffer.from('<html>', 'latin1'),
    });

    await expect(files.complete(FILE.id, mine.id, USER)).rejects.toThrow(
      /not a PDF/,
    );
    expect(storage.remove).toHaveBeenCalledWith(mine.storageKey);
    expect(repository.deleteVersion).toHaveBeenCalledWith(mine.id);
    expect(repository.softDeleteNode).toHaveBeenCalledWith(FILE.id);
  });

  it('does not destroy the upload when storage itself fails', async () => {
    const { files, storage, repository } = build([], {
      node: FILE,
      inFlight: [mine],
    });
    storage.probe.mockRejectedValue(new Error('Storage answered 503'));

    await expect(files.complete(FILE.id, mine.id, USER)).rejects.toThrow();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(repository.deleteVersion).not.toHaveBeenCalled();
  });

  it('answers a repeated request with the file it already finished', async () => {
    const ready = {
      ...FILE,
      status: 'ready' as const,
      currentVersionId: mine.id,
    };
    const { files } = build([], { node: ready, inFlight: [] });

    await expect(files.complete(FILE.id, mine.id, USER)).resolves.toMatchObject(
      { name: 'MSA.pdf' },
    );
  });

  it('refuses a replacement whose own version is gone, rather than claiming success', async () => {
    // The node is ready and serving the file this upload meant to replace. Reporting
    // that as success would show a green tick and the previous file's size.
    const ready = {
      ...FILE,
      status: 'ready' as const,
      currentVersionId: 'an-older-version',
    };
    const { files } = build([], { node: ready, inFlight: [] });

    await expect(files.complete(FILE.id, mine.id, USER)).rejects.toThrow(
      /no longer in progress/,
    );
  });
});

describe('nextCandidateName', () => {
  it.each([
    ['MSA.pdf', 'MSA (2).pdf'],
    ['MSA (2).pdf', 'MSA (3).pdf'],
    ['MSA (9).pdf', 'MSA (10).pdf'],
    ['Contracts', 'Contracts (2)'],
    ['.gitignore', '.gitignore (2)'],
    ['Q1 2024. Final', 'Q1 2024. Final (2)'],
    ['report.', 'report. (2)'],
  ])('%s -> %s', (input, expected) => {
    expect(nextCandidateName(input)).toBe(expected);
  });

  it('stays within the name length limit', () => {
    const long = `${'a'.repeat(199)}.pdf`;
    expect(nextCandidateName(long).length).toBeLessThanOrEqual(200);
  });
});
