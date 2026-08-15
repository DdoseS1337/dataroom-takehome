import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { FilesModule } from './files/files.module';
import { HealthController } from './health.controller';
import { NodesModule } from './nodes/nodes.module';
import { PrismaModule } from './prisma/prisma.module';
import { RoomsModule } from './rooms/rooms.module';
import { SharesModule } from './shares/shares.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    NodesModule,
    RoomsModule,
    FilesModule,
    SharesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
