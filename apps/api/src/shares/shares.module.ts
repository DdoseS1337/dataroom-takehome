import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { NodesModule } from '../nodes/nodes.module';
import { ShareRateLimitGuard } from './share-rate-limit.guard';
import {
  NodeSharesController,
  ShareLinkController,
  SharesController,
} from './shares.controller';
import { SharesService } from './shares.service';

@Module({
  imports: [NodesModule, FilesModule],
  controllers: [NodeSharesController, SharesController, ShareLinkController],
  providers: [SharesService, ShareRateLimitGuard],
})
export class SharesModule {}
