import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
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
import {
  CancelUploadQuery,
  CompleteUploadDto,
  InitUploadDto,
} from './files.dto';
import { FilesService } from './files.service';

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('init')
  init(@Body() dto: InitUploadDto, @CurrentUser() user: AuthUser | undefined) {
    return this.files.init(dto, requireUser(user));
  }

  @Post(':id/complete')
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteUploadDto,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.files.complete(id, dto.versionId, requireUser(user));
  }

  /** Cancels an upload in flight. A finished file is deleted through `/nodes/:id`. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CancelUploadQuery,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.files.cancel(id, query.versionId, requireUser(user));
  }
}
