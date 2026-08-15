import { Module } from '@nestjs/common';
import { NodesModule } from '../nodes/nodes.module';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [NodesModule],
  controllers: [RoomsController],
  providers: [RoomsService],
})
export class RoomsModule {}
