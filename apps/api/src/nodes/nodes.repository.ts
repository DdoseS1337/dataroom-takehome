import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Every query that touches `nodes` lives here. Two rules it exists to centralise:
 * `deleted_at IS NULL` on reads, and prefix-scan semantics on `path`. It is not a
 * generic data-access abstraction and should not grow into one — see
 * docs/architecture.md.
 */

export interface NodeWithRoom {
  id: string;
  dataRoomId: string;
  parentId: string | null;
  type: 'folder' | 'file';
  name: string;
  path: string;
  depth: number;
  status: 'uploading' | 'ready';
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  ownerId: string;
  roomName: string;
}

/** Just enough of the row that lost a `23505` race to decide what to do about it. */
export interface SiblingRow {
  id: string;
  type: 'folder' | 'file';
  name: string;
  status: 'uploading' | 'ready';
  createdAt: Date;
}

export interface InFlightVersion {
  id: string;
  storageKey: string;
}

export interface AbandonedVersion {
  id: string;
  storageKey: string;
}

export interface NewUpload {
  nodeId: string;
  name: string;
  versionId: string;
  storageKey: string;
}

export interface Crumb {
  id: string;
  name: string;
}

export interface ChildRow {
  id: string;
  type: 'folder' | 'file';
  name: string;
  /** `lower(name)` as Postgres computed it — the keyset cursor must carry this exact
   * value, because JS `toLowerCase()` and the database collation do not always agree. */
  sortName: string;
  sortRank: number;
  updatedAt: Date;
  sizeBytes: bigint | null;
}

export interface ListCursor {
  rank: number;
  name: string;
  id: string;
}

export const MAX_DEPTH = 32;

@Injectable()
export class NodesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns tombstoned nodes too, on purpose. Permission resolves before the deleted
   * check — reversing that order turns `410` into an oracle for which ids exist.
   * Callers must inspect `deletedAt` after resolving permission.
   */
  async findByIdIncludingDeleted(id: string): Promise<NodeWithRoom | null> {
    const rows = await this.prisma.$queryRaw<NodeWithRoom[]>`
      SELECT n.id,
             n.data_room_id AS "dataRoomId",
             n.parent_id    AS "parentId",
             n.type,
             n.name,
             n.path,
             n.depth,
             n.status,
             n.current_version_id AS "currentVersionId",
             n.created_at   AS "createdAt",
             n.updated_at   AS "updatedAt",
             n.deleted_at   AS "deletedAt",
             r.owner_id     AS "ownerId",
             r.name         AS "roomName"
      FROM nodes n
      JOIN data_rooms r ON r.id = n.data_room_id
      WHERE n.id = ${id}::uuid
    `;
    return rows[0] ?? null;
  }

  /**
   * The ancestor chain, root first, ending with the node itself. Read from the
   * materialised path, so it is one query at any depth rather than one per level.
   * The root node is renamed to the data room so the trail reads as a room, not as a
   * folder that happens to share its name.
   */
  async breadcrumbs(node: NodeWithRoom): Promise<Crumb[]> {
    const ids = node.path.split('/').filter(Boolean);
    if (ids.length === 0) return [];

    const rows = await this.prisma.$queryRaw<Crumb[]>`
      SELECT id, name FROM nodes
      WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        AND deleted_at IS NULL
    `;

    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids
      .map((id) => byId.get(id))
      .filter((crumb): crumb is Crumb => crumb !== undefined)
      .map((crumb, index) =>
        index === 0 ? { ...crumb, name: node.roomName } : crumb,
      );
  }

  /**
   * One page of a folder's direct children. Ordered by `(sort_rank, lower(name), id)`
   * to match `nodes_listing` exactly — change one and the other stops being used.
   * All three ascending, so a page boundary is a single tuple comparison and never an
   * OFFSET. Fetches `limit + 1` to learn whether another page exists without a COUNT.
   */
  async listChildren(
    parentId: string,
    limit: number,
    cursor: ListCursor | null,
  ): Promise<ChildRow[]> {
    const keyset = cursor
      ? Prisma.sql`AND (n.sort_rank, lower(n.name), n.id) > (${cursor.rank}::smallint, ${cursor.name}::text, ${cursor.id}::uuid)`
      : Prisma.empty;

    return this.prisma.$queryRaw<ChildRow[]>`
      SELECT n.id,
             n.type,
             n.name,
             lower(n.name)  AS "sortName",
             n.sort_rank    AS "sortRank",
             n.updated_at   AS "updatedAt",
             v.size_bytes   AS "sizeBytes"
      FROM nodes n
      LEFT JOIN file_versions v ON v.id = n.current_version_id
      WHERE n.parent_id = ${parentId}::uuid
        AND n.deleted_at IS NULL
        AND n.status = 'ready'
        ${keyset}
      ORDER BY n.sort_rank, lower(n.name), n.id
      LIMIT ${limit + 1}
    `;
  }

  /**
   * A room and its root node are created together: `docs/data-model.md` requires a
   * materialised root, so a room without one is a broken room. The insert order is
   * forced by the circular foreign key — the room goes in with a null `root_node_id`,
   * then the node, then the pointer.
   */
  async createRoomWithRoot(
    ownerId: string,
    name: string,
  ): Promise<{
    id: string;
    name: string;
    rootNodeId: string;
    createdAt: Date;
  }> {
    const rootId = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      const room = await tx.dataRoom.create({ data: { ownerId, name } });

      await tx.node.create({
        data: {
          id: rootId,
          dataRoomId: room.id,
          parentId: null,
          type: 'folder',
          name,
          path: `/${rootId}/`,
          depth: 0,
          // The column default is 'uploading', which listings filter out. Folders are
          // never uploaded, so they are born ready.
          status: 'ready',
          createdBy: ownerId,
        },
      });

      const updated = await tx.dataRoom.update({
        where: { id: room.id },
        data: { rootNodeId: rootId },
      });

      return {
        id: updated.id,
        name: updated.name,
        rootNodeId: rootId,
        createdAt: updated.createdAt,
      };
    });
  }

  /**
   * Throws Postgres `23505` (Prisma `P2002`) on a duplicate name — the caller catches
   * it. Never pre-check with a SELECT: that is a TOCTOU race under concurrency.
   */
  async createFolder(
    parent: NodeWithRoom,
    name: string,
    createdBy: string,
  ): Promise<ChildRow> {
    const id = randomUUID();

    const created = await this.prisma.node.create({
      data: {
        id,
        dataRoomId: parent.dataRoomId,
        parentId: parent.id,
        type: 'folder',
        name,
        path: `${parent.path}${id}/`,
        depth: parent.depth + 1,
        status: 'ready',
        createdBy,
      },
    });

    return {
      id: created.id,
      type: 'folder',
      name: created.name,
      sortName: created.name.toLowerCase(),
      sortRank: 0,
      updatedAt: created.updatedAt,
      sizeBytes: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Uploads. A file is two rows written together — the node that holds the name and
  // the version that holds the bytes — so they are created, completed and discarded
  // in one place rather than split across a second repository that would have to
  // share every transaction with this one.
  // ---------------------------------------------------------------------------

  /**
   * Both rows in one transaction: the node reserves the name, the version reserves the
   * storage key. `size_bytes = 0` marks the version as still in flight — see
   * `findInFlightVersion`.
   *
   * Raises `23505` on a duplicate name, which is the whole point of doing this before
   * any bytes move. The caller resolves it; nothing here pre-checks with a SELECT.
   */
  async createFileNode(
    parent: NodeWithRoom,
    name: string,
    createdBy: string,
  ): Promise<NewUpload> {
    const nodeId = randomUUID();
    const versionId = randomUUID();
    const storageKey = buildStorageKey(parent.dataRoomId, nodeId, versionId);

    await this.prisma.$transaction(async (tx) => {
      await tx.node.create({
        data: {
          id: nodeId,
          dataRoomId: parent.dataRoomId,
          parentId: parent.id,
          type: 'file',
          name,
          path: `${parent.path}${nodeId}/`,
          depth: parent.depth + 1,
          status: 'uploading',
          createdBy,
        },
      });

      await tx.fileVersion.create({
        data: {
          id: versionId,
          nodeId,
          storageKey,
          sizeBytes: 0n,
          mimeType: 'application/pdf',
          versionNo: 1,
        },
      });
    });

    return { nodeId, name, versionId, storageKey };
  }

  /**
   * Runs only after a `23505` has already fired, to explain a conflict that has
   * happened. It is not a pre-check, and moving it before the insert would reintroduce
   * exactly the TOCTOU race the unique index exists to close.
   *
   * `lower(name)` matches the index expression, so this is an index lookup.
   */
  async findSiblingByName(
    parentId: string,
    name: string,
  ): Promise<SiblingRow | null> {
    const rows = await this.prisma.$queryRaw<SiblingRow[]>`
      SELECT id, type, name, status, created_at AS "createdAt"
      FROM nodes
      WHERE parent_id = ${parentId}::uuid
        AND lower(name) = lower(${name})
        AND deleted_at IS NULL
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /**
   * A second version on an existing node — this is "Replace". The version number is
   * computed inside the INSERT rather than read first, so two replacements racing each
   * other collide on `(node_id, version_no)` instead of silently taking the same slot.
   */
  async addVersion(
    nodeId: string,
    versionId: string,
    storageKey: string,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO file_versions (id, node_id, storage_key, size_bytes, mime_type, version_no)
      SELECT ${versionId}::uuid, ${nodeId}::uuid, ${storageKey}, 0, 'application/pdf',
             coalesce(max(version_no), 0) + 1
      FROM file_versions
      WHERE node_id = ${nodeId}::uuid
    `;
  }

  /**
   * `size_bytes = 0` means the upload never completed. That reading is only sound
   * because a zero-byte file is rejected before it can reach `ready`, so no finished
   * version can hold 0 — the sweeper depends on the same invariant.
   *
   * `versionId` scopes the lookup to the version a particular request reserved. Two
   * replacements of the same file can be in flight at once, and without it each request
   * would verify — and on failure delete — whichever version happened to be newest.
   * It is optional only for the sweeper's sake; every request path passes it.
   */
  async findInFlightVersion(
    nodeId: string,
    versionId?: string,
  ): Promise<InFlightVersion | null> {
    const scoped = versionId
      ? Prisma.sql`AND id = ${versionId}::uuid`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<InFlightVersion[]>`
      SELECT id, storage_key AS "storageKey"
      FROM file_versions
      WHERE node_id = ${nodeId}::uuid AND size_bytes = 0
        ${scoped}
      ORDER BY version_no DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /** Records the verified bytes and makes the file visible: listings filter `ready`. */
  async completeUpload(
    node: NodeWithRoom,
    versionId: string,
    sizeBytes: number,
    checksum: string | null,
  ): Promise<ChildRow> {
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE file_versions
        SET size_bytes = ${sizeBytes}::bigint, checksum = ${checksum}::text
        WHERE id = ${versionId}::uuid
      `;

      // A raw UPDATE has to set updated_at itself — the column default only fires on
      // INSERT, and Prisma's @updatedAt is applied by the client, not the database.
      return tx.$queryRaw<{ updatedAt: Date }[]>`
        UPDATE nodes
        SET current_version_id = ${versionId}::uuid,
            status = 'ready',
            updated_at = now()
        WHERE id = ${node.id}::uuid
        RETURNING updated_at AS "updatedAt"
      `;
    });

    return {
      id: node.id,
      type: 'file',
      name: node.name,
      sortName: node.name.toLowerCase(),
      sortRank: 1,
      updatedAt: rows[0]?.updatedAt ?? new Date(),
      sizeBytes: BigInt(sizeBytes),
    };
  }

  /** One row in the shape a listing returns it, for a mutation's own response. */
  async findSummary(nodeId: string): Promise<ChildRow | null> {
    const rows = await this.prisma.$queryRaw<ChildRow[]>`
      SELECT n.id,
             n.type,
             n.name,
             lower(n.name)  AS "sortName",
             n.sort_rank    AS "sortRank",
             n.updated_at   AS "updatedAt",
             v.size_bytes   AS "sizeBytes"
      FROM nodes n
      LEFT JOIN file_versions v ON v.id = n.current_version_id
      WHERE n.id = ${nodeId}::uuid
        AND n.deleted_at IS NULL
    `;
    return rows[0] ?? null;
  }

  /** Guarded against removing the version a node is currently serving. */
  async deleteVersion(versionId: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM file_versions
      WHERE id = ${versionId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM nodes WHERE current_version_id = ${versionId}::uuid
        )
    `;
  }

  async softDeleteNode(id: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE nodes
      SET deleted_at = now(), updated_at = now()
      WHERE id = ${id}::uuid AND deleted_at IS NULL
    `;
  }

  /**
   * Uploads that never finished, oldest first. Ordering matters to the sweeper: these
   * carry the storage keys, so they are collected before the nodes are tombstoned.
   */
  async findAbandonedVersions(
    olderThan: Date,
    limit: number,
  ): Promise<AbandonedVersion[]> {
    return this.prisma.$queryRaw<AbandonedVersion[]>`
      SELECT v.id, v.storage_key AS "storageKey"
      FROM file_versions v
      WHERE v.size_bytes = 0
        AND v.created_at < ${olderThan}
        AND NOT EXISTS (SELECT 1 FROM nodes n WHERE n.current_version_id = v.id)
      ORDER BY v.created_at
      LIMIT ${limit}
    `;
  }

  async softDeleteAbandonedUploads(
    olderThan: Date,
    limit: number,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE nodes
      SET deleted_at = now(), updated_at = now()
      WHERE id IN (
        SELECT id FROM nodes
        WHERE status = 'uploading'
          AND deleted_at IS NULL
          AND created_at < ${olderThan}
        ORDER BY created_at
        LIMIT ${limit}
      )
      RETURNING id
    `;
    return rows.length;
  }
}

/**
 * Built from ids only, never from the name the user typed: a filename can carry path
 * separators, unicode that normalises differently in the object store than in Postgres,
 * or simply collide with a sibling. The version id is in the key because "Replace"
 * writes a new version — so two versions can never address the same object, and the
 * promise that bytes are never overwritten is structural rather than a convention.
 */
export function buildStorageKey(
  dataRoomId: string,
  nodeId: string,
  versionId: string,
): string {
  return `${dataRoomId}/${nodeId}/${versionId}.pdf`;
}

/**
 * Prisma maps `23505` to `P2002`, but the unique index here is a hand-written partial
 * expression index that the schema does not describe, so the driver error can arrive
 * unmapped. Checking both is two comparisons and removes the guesswork.
 */
export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'P2002' || code === '23505';
}
