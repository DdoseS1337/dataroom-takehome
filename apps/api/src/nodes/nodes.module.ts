import { Module } from '@nestjs/common';
import {
  FoldersController,
  NodesController,
  SearchController,
} from './nodes.controller';
import { NodesRepository } from './nodes.repository';
import { NodesService } from './nodes.service';

@Module({
  controllers: [NodesController, FoldersController, SearchController],
  providers: [NodesRepository, NodesService],
  exports: [NodesRepository, NodesService],
})
export class NodesModule {}
