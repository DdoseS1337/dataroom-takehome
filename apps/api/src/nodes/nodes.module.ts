import { Module } from '@nestjs/common';
import { FoldersController, NodesController } from './nodes.controller';
import { NodesRepository } from './nodes.repository';
import { NodesService } from './nodes.service';

@Module({
  controllers: [NodesController, FoldersController],
  providers: [NodesRepository, NodesService],
  exports: [NodesRepository, NodesService],
})
export class NodesModule {}
