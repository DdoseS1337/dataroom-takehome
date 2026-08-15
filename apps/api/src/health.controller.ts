import { Controller, Get, HttpStatus, Logger, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from './auth/public.decorator';
import { PrismaService } from './prisma/prisma.service';

type Health = { status: 'ok'; db: 'up' | 'down'; time: string };

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness. Always 200, reporting the database separately in the body, because the
   * UI wants to render "database unreachable" rather than a failed request.
   */
  @Public()
  @Get()
  async check(): Promise<Health> {
    return {
      status: 'ok',
      db: (await this.isDbUp()) ? 'up' : 'down',
      time: new Date().toISOString(),
    };
  }

  /**
   * Readiness — the deploy gate. A release that cannot reach its database must not
   * take traffic, so this one does fail. Kept separate from liveness so a monitor
   * polling `/health` still gets a body it can describe instead of a bare 503.
   */
  @Public()
  @Get('ready')
  async ready(@Res() response: Response): Promise<void> {
    const up = await this.isDbUp();
    response
      .status(up ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json({ status: up ? 'ready' : 'not-ready', db: up ? 'up' : 'down' });
  }

  private async isDbUp(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error(`Database check failed: ${(error as Error).message}`);
      return false;
    }
  }
}
