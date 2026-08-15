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
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  ownerId: string;
  roomName: string;
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
