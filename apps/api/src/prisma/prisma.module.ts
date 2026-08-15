import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global so the guard and every service can inject it without re-importing a module
// in each feature. One database, one client, one process.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
