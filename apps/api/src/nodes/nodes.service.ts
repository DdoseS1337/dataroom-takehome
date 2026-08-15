import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator';
import { ApiError } from '../common/api-error';
import {
  canRead,
  canWrite,
  resolvePermission,
  type Permission,
} from '../permissions/resolve-permission';
import { decodeCursor, encodeCursor } from './cursor';
import {
  isUniqueViolation,
  MAX_DEPTH,
  NodesRepository,
  type ChildRow,
  type Crumb,
  type NodeWithRoom,
} from './nodes.repository';

export const DEFAULT_PAGE_SIZE = 50;

export interface NodeSummary {
  id: string;
  type: 'folder' | 'file';
  name: string;
  updatedAt: string;
  /** Null for folders, and for files until Block 3 records a version. */
  sizeBytes: number | null;
}

export interface NodeDetail {
  id: string;
  dataRoomId: string;
  parentId: string | null;
  type: 'folder' | 'file';
  name: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class NodesService {
  constructor(private readonly repository: NodesRepository) {}

  async get(
    id: string,
    user: AuthUser | undefined,
  ): Promise<{
    node: NodeDetail;
    breadcrumbs: Crumb[];
    permission: Permission;
  }> {
    const { node, permission } = await this.authorise(id, user);
    const breadcrumbs = await this.repository.breadcrumbs(node);
    return { node: toDetail(node), breadcrumbs, permission };
  }

  async children(
    id: string,
    user: AuthUser | undefined,
    rawCursor: string | undefined,
    limit = DEFAULT_PAGE_SIZE,
  ): Promise<{ items: NodeSummary[]; nextCursor: string | null }> {
    const { node } = await this.authorise(id, user);
    if (node.type !== 'folder') {
      throw ApiError.invalid('Only a folder has children.');
    }

    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    const rows = await this.repository.listChildren(node.id, limit, cursor);

    // The repository asked for one row beyond the page purely to answer "is there
    // more" — it is the marker, not content, so it never ships.
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map(toSummary),
      nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
    };
  }

  async createFolder(
    parentId: string,
    name: string,
    user: AuthUser,
  ): Promise<NodeSummary> {
    const { node: parent, permission } = await this.authorise(parentId, user);

    // A read-only recipient already knows this node exists, so 403 discloses nothing
    // that 404 would have hidden — and it is the honest answer to "may I write here".
    if (!canWrite(permission)) throw ApiError.forbidden();
    if (parent.type !== 'folder') {
      throw ApiError.invalid('A folder can only be created inside a folder.');
    }
    if (parent.depth + 1 > MAX_DEPTH) {
      throw ApiError.invalid(
        `Folders can be nested up to ${MAX_DEPTH} levels deep.`,
      );
    }

    try {
      return toSummary(
        await this.repository.createFolder(parent, name, user.id),
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw ApiError.nameConflict(name);
      throw error;
    }
  }

  /**
   * The order here is the invariant, not an implementation detail: permission is
   * resolved against the node including tombstones, and only then is `deletedAt`
   * inspected. Checking deletion first would answer `410` for ids that exist and
   * `404` for ids that do not, handing anyone probing ids an existence oracle.
   *
   * Public because `FilesService` needs the same three steps in the same order.
   * Duplicating them there would be a second place for the order to drift.
   */
  async authorise(
    id: string,
    user: AuthUser | undefined,
  ): Promise<{ node: NodeWithRoom; permission: Permission }> {
    const node = await this.repository.findByIdIncludingDeleted(id);
    if (!node) throw ApiError.notFound();

    const permission = resolvePermission(user, { ownerId: node.ownerId });
    if (!canRead(permission)) throw ApiError.notFound();
    if (node.deletedAt) throw ApiError.gone();

    return { node, permission };
  }
}

export function toSummary(row: ChildRow): NodeSummary {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    updatedAt: row.updatedAt.toISOString(),
    // bigint does not survive JSON.stringify; sizes here are far below 2^53.
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
  };
}

function toDetail(node: NodeWithRoom): NodeDetail {
  return {
    id: node.id,
    dataRoomId: node.dataRoomId,
    parentId: node.parentId,
    type: node.type,
    name: node.name,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
  };
}
