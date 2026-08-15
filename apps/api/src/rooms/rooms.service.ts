import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator';
import { NodesRepository } from '../nodes/nodes.repository';
import { PrismaService } from '../prisma/prisma.service';

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
      where: { ownerId: user.id },
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
    const room = await this.nodes.createRoomWithRoot(user.id, name);
    return { ...room, createdAt: room.createdAt.toISOString() };
  }
}
