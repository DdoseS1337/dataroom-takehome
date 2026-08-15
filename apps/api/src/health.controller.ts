import { Controller, Get, Logger } from '@nestjs/common';
import { Public } from './auth/public.decorator';
import { PrismaService } from './prisma/prisma.service';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  // Returns 200 even when the database is unreachable, reporting `db: 'down'`
  // instead. A 503 here would make the host restart a process whose only problem
  // is a database blip, and the frontend can show the real state either way.
  @Public()
  @Get()
  async check(): Promise<{ status: 'ok'; db: 'up' | 'down'; time: string }> {
    let db: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      db = 'down';
      this.logger.error(`Database check failed: ${(error as Error).message}`);
    }
    return { status: 'ok', db, time: new Date().toISOString() };
  }
}
