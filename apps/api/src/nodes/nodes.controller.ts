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
  Query,
} from '@nestjs/common';
import {
  CurrentUser,
  requireUser,
  type AuthUser,
} from '../auth/current-user.decorator';
import { CreateFolderDto, ListChildrenQuery, UpdateNodeDto } from './nodes.dto';
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

  /** Real subtree totals for the delete dialog — see docs/ui.md. */
  @Get(':id/stats')
  stats(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.nodes.stats(id, user);
  }

  /** Rename, move, or both — plus the answer to a clash, on a second attempt. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNodeDto,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.nodes.update(id, dto, requireUser(user));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.nodes.remove(id, requireUser(user));
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
