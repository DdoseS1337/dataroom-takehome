import { Module } from '@nestjs/common';
import { NodesModule } from '../nodes/nodes.module';
import { StorageModule } from '../storage/storage.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { UploadSweeper } from './upload-sweeper.service';

@Module({
  imports: [NodesModule, StorageModule],
  controllers: [FilesController],
  providers: [FilesService, UploadSweeper],
  // `/s/:token/files/:id/download-url` is the same service behind a token — a recipient
  // reads bytes exactly the way an owner does.
  exports: [FilesService],
})
export class FilesModule {}
