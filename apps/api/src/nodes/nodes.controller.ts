import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  CurrentUser,
  requireUser,
  type AuthUser,
} from '../auth/current-user.decorator';
import { CreateFolderDto, ListChildrenQuery } from './nodes.dto';
import { NodesService } from './nodes.service';

@Controller('nodes')
export class NodesController {
  constructor(private readonly nodes: NodesService) {}

  /**
   * Node, breadcrumbs and permission in one response. Three round trips per
   * navigation makes the folder view flicker through three different layouts.
   */
  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.nodes.get(id, user);
  }

  @Get(':id/children')
  children(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListChildrenQuery,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.nodes.children(id, user, query.cursor, query.limit);
  }
}

@Controller('folders')
export class FoldersController {
  constructor(private readonly nodes: NodesService) {}

  @Post()
  create(
    @Body() dto: CreateFolderDto,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.nodes.createFolder(dto.parentId, dto.name, requireUser(user));
  }
}
