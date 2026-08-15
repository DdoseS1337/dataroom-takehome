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
})
export class FilesModule {}
