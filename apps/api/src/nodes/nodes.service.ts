import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator';
import { ApiError } from '../common/api-error';
import type { ConflictPolicy } from '../files/files.dto';
import {
  canRead,
  canWrite,
  firstReadableAncestor,
  resolvePermission,
  type Permission,
} from '../permissions/resolve-permission';
import { decodeCursor, encodeCursor } from './cursor';
import { candidateNames, firstFree, nextCandidateName } from './node-name';
import {
  isUniqueViolation,
  MAX_DEPTH,
  NodesRepository,
  type ChildRow,
  type Crumb,
  type NodeWithRoom,
  type ShareRow,
  type SubtreeStats,
} from './nodes.repository';

export const DEFAULT_PAGE_SIZE = 50;

const IS_A_ROOM =
  'This is the data room itself. Rename or delete the room instead.';
const NOT_A_FOLDER = 'An item can only be moved into a folder.';
const ANOTHER_ROOM = 'An item cannot be moved to a different data room.';
const INTO_ITSELF =
  'A folder cannot be moved into itself or into one of its own subfolders.';
const NOTHING_TO_DO = 'Provide a new name, a new parent folder, or both.';

/** Matches the upload queue's own ceiling: twenty "(n)" attempts, then give up and ask. */
const KEEP_BOTH_ATTEMPTS = 20;

/** How far to look for a free name to suggest. Past this the folder is pathological and
 * the plain next number is a fine thing to offer. */
const SUGGESTION_CANDIDATES = 30;

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
    share?: ShareRow | null,
  ): Promise<{
    node: NodeDetail;
    breadcrumbs: Crumb[];
    permission: Permission;
  }> {
    const { node, permission, grants } = await this.authorise(id, user, share);
    const crumbs = await this.repository.breadcrumbs(node);

    // The trail is cut to what this requester may actually read. Without it a recipient
    // of one folder is handed the names of every folder above it and of the data room
    // itself — which, in a deal, is the part worth knowing.
    const start = firstReadableAncestor(
      user,
      crumbs.map((crumb) => crumb.id),
      {
        ownerId: node.ownerId,
        grants,
        presentedShareId: share?.id ?? null,
      },
    );

    return {
      node: toDetail(node),
      // `-1` cannot happen for a requester `authorise` has already let through, and if it
      // ever did, the node alone is the safe answer rather than the whole path.
      breadcrumbs: crumbs.slice(start === -1 ? -1 : start),
      permission,
    };
  }

  async children(
    id: string,
    user: AuthUser | undefined,
    rawCursor: string | undefined,
    limit = DEFAULT_PAGE_SIZE,
    share?: ShareRow | null,
  ): Promise<{ items: NodeSummary[]; nextCursor: string | null }> {
    const { node } = await this.authorise(id, user, share);
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
      if (isUniqueViolation(error)) throw await this.conflict(parent.id, name);
      throw error;
    }
  }

  /** Real numbers for the delete dialog, aggregated server-side over the whole
   * subtree. Never counts derived from whatever the client has paged in — that figure
   * is wrong the moment the folder is bigger than one page. */
  async stats(id: string, user: AuthUser | undefined): Promise<SubtreeStats> {
    const { node } = await this.authorise(id, user);
    return this.repository.subtreeStats(node);
  }

  /**
   * Rename, move, or both — one endpoint, because they are one UPDATE on one row plus,
   * for a move, the prefix rewrite that has to share its transaction.
   */
  async update(
    id: string,
    changes: { name?: string; parentId?: string; onConflict?: ConflictPolicy },
    user: AuthUser,
  ): Promise<NodeSummary> {
    if (changes.name === undefined && changes.parentId === undefined) {
      throw ApiError.invalid(NOTHING_TO_DO);
    }

    const { node, permission } = await this.authorise(id, user);
    if (!canWrite(permission)) throw ApiError.forbidden();
    // A root node is the data room. Renaming it here would leave `data_rooms.name`
    // disagreeing with it, and moving it would leave the room without a root.
    if (node.parentId === null) throw ApiError.invalid(IS_A_ROOM);

    const name = changes.name ?? node.name;
    const target =
      changes.parentId === undefined || changes.parentId === node.parentId
        ? null
        : await this.resolveMoveTarget(node, changes.parentId, user);

    // A rename always blocks on a clash — see `UpdateNodeDto.onConflict`.
    const policy = target ? (changes.onConflict ?? 'error') : 'error';
    await this.write(node, target, name, policy);

    const summary = await this.repository.findSummary(node.id);
    // Deleted between the update and the read — rare, but the alternative is answering
    // with a row that no longer exists.
    if (!summary) throw ApiError.gone();
    return toSummary(summary);
  }

  /**
   * The write, plus the user's answer to a clash if they have already given one. Nothing
   * here checks for a free name first: the unique index is the only reliable arbiter
   * under concurrency, so every branch either writes or reacts to a `23505`.
   */
  private async write(
    node: NodeWithRoom,
    target: NodeWithRoom | null,
    name: string,
    policy: ConflictPolicy,
  ): Promise<void> {
    const destination = target ? 'the destination folder' : 'this folder';
    const parentId = target?.id ?? node.parentId!;

    if (policy === 'keepBoth') {
      // The suffix comes from retrying, not from reading the folder and picking the next
      // free number — two clients doing that would compute the same "(2)".
      let candidate = name;
      for (let attempt = 0; attempt < KEEP_BOTH_ATTEMPTS; attempt++) {
        try {
          return await this.repository.moveOrRename(node, target, candidate);
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          candidate = nextCandidateName(candidate);
        }
      }
      throw await this.conflict(parentId, name, destination);
    }

    try {
      return await this.repository.moveOrRename(node, target, name);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    if (policy === 'replace') {
      await this.clearTheWay(node, parentId, name, destination);
    }

    // One retry, whether the blocker was just removed or had already gone on its own. A
    // second collision means someone else took the name in between, which is an ordinary
    // conflict and the user's to answer.
    try {
      return await this.repository.moveOrRename(node, target, name);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      throw await this.conflict(parentId, name, destination);
    }
  }

  /**
   * "Replace" on a move, which is not the same act as "Replace" on an upload. An upload
   * adds a version to the file already there and keeps its history; a move brings a
   * different node with a history of its own, and there is no honest way to merge two.
   * So the one in the way is tombstoned and the moved item takes the name.
   *
   * Only file-over-file. A folder holds a subtree, and quietly deleting one behind a
   * button labelled "Replace" is not a trade this app makes.
   */
  private async clearTheWay(
    node: NodeWithRoom,
    parentId: string,
    name: string,
    destination: string,
  ): Promise<void> {
    const blocker = await this.repository.findSiblingByName(parentId, name);
    if (!blocker) return;

    // Two different refusals, and naming the wrong side of the collision makes both
    // read as nonsense — "replacing a file would delete everything in it" is not true
    // of a file, and is not what is being refused.
    if (blocker.type === 'folder') {
      throw ApiError.invalid(
        `A folder named “${name}” is already in ${destination}, and replacing it would delete everything inside it. Rename one of them instead.`,
      );
    }
    if (node.type !== 'file') {
      throw ApiError.invalid(
        `A file named “${name}” is already in ${destination}, and a folder cannot replace a file. Rename one of them instead.`,
      );
    }
    // Its bytes are not there yet, so replacing it would leave the folder holding
    // neither file if the upload then completes into a tombstone.
    if (blocker.status !== 'ready') {
      throw await this.conflict(parentId, name, destination);
    }

    await this.repository.softDeleteNode(blocker.id);
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const { node, permission } = await this.authorise(id, user);
    if (!canWrite(permission)) throw ApiError.forbidden();
    if (node.parentId === null) throw ApiError.invalid(IS_A_ROOM);

    await this.repository.softDeleteSubtree(node);
  }

  private async resolveMoveTarget(
    node: NodeWithRoom,
    parentId: string,
    user: AuthUser,
  ): Promise<NodeWithRoom> {
    const { node: target, permission } = await this.authorise(parentId, user);
    if (!canWrite(permission)) throw ApiError.forbidden();
    if (target.type !== 'folder') throw ApiError.invalid(NOT_A_FOLDER);
    // Crossing rooms would mean rewriting `data_room_id` for the whole subtree and
    // re-deriving permission against a different owner. Out of scope, and the folder
    // picker never offers it.
    if (target.dataRoomId !== node.dataRoomId) {
      throw ApiError.invalid(ANOTHER_ROOM);
    }
    // Prefix comparison, not a walk up the parents — and it catches the move-into-self
    // case for free, because a node's path is a prefix of itself.
    if (target.path.startsWith(node.path)) {
      throw ApiError.cycleDetected(INTO_ITSELF);
    }

    // `nodes_depth_max` is a CHECK constraint, so a branch that would land too deep has
    // to be refused before the transaction rather than partway through it.
    const deepest = await this.repository.maxSubtreeDepth(node);
    const shift = target.depth + 1 - node.depth;
    if (deepest + shift > MAX_DEPTH) {
      throw ApiError.invalid(
        `That destination is too deep — folders can be nested up to ${MAX_DEPTH} levels.`,
      );
    }

    return target;
  }

  /**
   * Runs only once a `23505` has already fired, and its whole job is to turn that into a
   * sentence the person reading it can act on. It looks up what is in the way so the
   * message can name it — "a file" reads very differently from "an item" when you are
   * about to overwrite a document — and because `nodes_name_uniq` covers `uploading`
   * rows, the blocker can be a file being uploaded right now that the listing does not
   * show. Without saying so, that conflict points at nothing.
   *
   * The suggestion is the first name that is actually free, not merely the next number
   * up. Offering `Report (2)` when that is taken too costs a click and a second refusal,
   * and reads as an app that is guessing.
   */
  private async conflict(
    parentId: string,
    name: string,
    destination = 'this folder',
  ): Promise<ApiError> {
    const candidates = candidateNames(name, SUGGESTION_CANDIDATES);
    const [sibling, taken] = await Promise.all([
      this.repository.findSiblingByName(parentId, name),
      this.repository.takenSiblingNames(parentId, candidates),
    ]);

    const details = {
      name,
      suggestion: firstFree(candidates, taken) ?? nextCandidateName(name),
      existingType: sibling?.type ?? null,
    };

    if (sibling?.status === 'uploading') {
      return new ApiError(
        'NAME_CONFLICT',
        HttpStatus.CONFLICT,
        `A file named “${name}” is being uploaded to ${destination} right now, so the name is taken. It appears in the listing once it finishes.`,
        details,
      );
    }

    // The row is gone already — deleted between the failed write and this lookup — so
    // there is nothing to name. Rare, and retrying now succeeds.
    const what = sibling ? sibling.type : 'item';

    return new ApiError(
      'NAME_CONFLICT',
      HttpStatus.CONFLICT,
      `A ${what} named “${name}” already exists in ${destination}. Choose a different name.`,
      details,
    );
  }

  /**
   * The order here is the invariant, not an implementation detail: permission is
   * resolved against the node including tombstones, and only then is `deletedAt`
   * inspected. Checking deletion first would answer `410` for ids that exist and
   * `404` for ids that do not, handing anyone probing ids an existence oracle.
   *
   * Public because `FilesService` needs the same three steps in the same order.
   * Duplicating them there would be a second place for the order to drift.
   *
   * `share` is the one this request presented a token for, on `/s/:token`. It widens
   * what the rule can see — a link grant admits its holder and nobody else — without
   * moving where the rule runs.
   */
  async authorise(
    id: string,
    user: AuthUser | undefined,
    share?: ShareRow | null,
  ): Promise<{
    node: NodeWithRoom;
    permission: Permission;
    /** Handed back so a caller that also needs to know how much of the ancestor trail
     * is readable does not load them a second time. */
    grants: ShareRow[];
  }> {
    const node = await this.repository.findByIdIncludingDeleted(id);
    if (!node) throw ApiError.notFound();

    const grants = await this.repository.grantsForAncestors(node);
    const permission = resolvePermission(user, {
      ownerId: node.ownerId,
      grants,
      presentedShareId: share?.id ?? null,
    });
    if (!canRead(permission)) throw ApiError.notFound();
    if (node.deletedAt) throw ApiError.gone();

    return { node, permission, grants };
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
