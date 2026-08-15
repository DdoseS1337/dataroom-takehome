import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  CurrentUser,
  requireUser,
  type AuthUser,
} from '../auth/current-user.decorator';
import { CreateRoomDto } from '../nodes/nodes.dto';
import { RoomsService } from './rooms.service';

@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser | undefined) {
    return this.rooms.list(requireUser(user));
  }

  @Post()
  create(
    @Body() dto: CreateRoomDto,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.rooms.create(dto.name, requireUser(user));
  }
}
