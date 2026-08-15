import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CurrentUser,
  requireUser,
  type AuthUser,
} from '../auth/current-user.decorator';
import { CreateRoomDto, UpdateRoomDto } from '../nodes/nodes.dto';
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

  @Patch(':id')
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoomDto,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.rooms.rename(id, dto.name, requireUser(user));
  }

  /** Soft, and it takes the room's whole tree with it in one prefix update. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.rooms.remove(id, requireUser(user));
  }
}
