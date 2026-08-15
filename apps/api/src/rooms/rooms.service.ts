import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator';
import { ApiError } from '../common/api-error';
import {
  candidateNames,
  firstFree,
  nextCandidateName,
} from '../nodes/node-name';
import { isUniqueViolation, NodesRepository } from '../nodes/nodes.repository';
import { PrismaService } from '../prisma/prisma.service';

/** Matches the node-side ceiling; see `NodesService`. */
const SUGGESTION_CANDIDATES = 30;

export interface RoomSummary {
  id: string;
  name: string;
  /** The room's materialised root folder — where the UI navigates on open. */
  rootNodeId: string;
  createdAt: string;
}

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nodes: NodesRepository,
  ) {}

  async list(user: AuthUser): Promise<RoomSummary[]> {
    const rooms = await this.prisma.dataRoom.findMany({
      where: { ownerId: user.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    // A room whose root is missing cannot be opened, and the only way to have one is a
    // transaction that half-committed. Hiding it beats a list row that dead-ends.
    return rooms
      .filter((room) => room.rootNodeId !== null)
      .map((room) => ({
        id: room.id,
        name: room.name,
        rootNodeId: room.rootNodeId!,
        createdAt: room.createdAt.toISOString(),
      }));
  }

  async create(name: string, user: AuthUser): Promise<RoomSummary> {
    try {
      const room = await this.nodes.createRoomWithRoot(user.id, name);
      return { ...room, createdAt: room.createdAt.toISOString() };
    } catch (error) {
      if (isUniqueViolation(error)) throw await this.conflict(name, user.id);
      throw error;
    }
  }

  async rename(id: string, name: string, user: AuthUser): Promise<RoomSummary> {
    const room = await this.owned(id, user);

    try {
      await this.nodes.renameRoom(room.id, room.rootNodeId, name);
    } catch (error) {
      if (isUniqueViolation(error)) throw await this.conflict(name, user.id);
      throw error;
    }

    return { ...room, name };
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const room = await this.owned(id, user);

    // Including tombstoned ones: the room's own delete may have half-applied, and a
    // retry has to be able to finish it rather than answer 404 on an id that is listed.
    const root = await this.nodes.findByIdIncludingDeleted(room.rootNodeId);
    if (!root) throw ApiError.notFound();

    await this.nodes.softDeleteRoom(room.id, root);
  }

  /**
   * Not `ApiError.nameConflict`, whose wording is "already exists here" — that reads as
   * "in this folder", and a room is not inside anything. Same code, so the client
   * branches identically and shows the suggestion.
   *
   * The suggestion is the first name the owner does not already hold. It runs only after
   * a `23505`, so it does not pre-empt the unique index — it just spares the user a click
   * on a name that was never going to be accepted either.
   */
  private async conflict(name: string, ownerId: string): Promise<ApiError> {
    const candidates = candidateNames(name, SUGGESTION_CANDIDATES);
    const taken = await this.nodes.takenRoomNames(ownerId, candidates);

    return new ApiError(
      'NAME_CONFLICT',
      HttpStatus.CONFLICT,
      `You already have a data room named “${name}”.`,
      {
        name,
        suggestion: firstFree(candidates, taken) ?? nextCandidateName(name),
      },
    );
  }

  /**
   * Rooms are not nodes, so `NodesService.authorise` does not apply — but the rule it
   * enforces does: unauthorised and nonexistent are the same `404`, because a `403`
   * would confirm the room exists.
   *
   * There is no `410` here. A deleted room is gone from the owner's list, and nobody
   * else ever had a route to it: sharing grants access to nodes, not to rooms.
   */
  private async owned(
    id: string,
    user: AuthUser,
  ): Promise<RoomSummary & { rootNodeId: string }> {
    const room = await this.prisma.dataRoom.findFirst({
      where: { id, ownerId: user.id, deletedAt: null },
    });

    if (!room?.rootNodeId) throw ApiError.notFound();

    return {
      id: room.id,
      name: room.name,
      rootNodeId: room.rootNodeId,
      createdAt: room.createdAt.toISOString(),
    };
  }
}
