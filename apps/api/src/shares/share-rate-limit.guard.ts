import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../common/api-error';

/**
 * A fixed window per client address on the public share routes. A 256-bit token is not
 * guessable, so this is not what makes the links safe — it is what keeps a scanner from
 * turning the token lookup into free load on the database, and what bounds the damage if
 * a token ever does leak into a crawler's queue.
 *
 * In-memory, like the upload sweeper: one process, one map, and both die together. A
 * shared store would be the right answer across replicas, and this app runs one — see
 * README, "Known limitations". `@nestjs/throttler` would bring the same fixed window
 * with a dependency attached, which Block 3 already declined for the same shape.
 *
 * The address comes from `request.ip`, which is only the real client because `main.ts`
 * trusts Railway's proxy hop. Without that every request would arrive from the proxy and
 * share one bucket — a rate limiter that locks out everyone at once.
 */

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 120;

interface Window {
  count: number;
  resetAt: number;
}

@Injectable()
export class ShareRateLimitGuard
  implements CanActivate, OnModuleInit, OnModuleDestroy
{
  private readonly windows = new Map<string, Window>();
  private timer: NodeJS.Timeout | null = null;

  onModuleInit(): void {
    // Without eviction the map grows with every distinct address seen. `unref` so it
    // does not hold the process open across a redeploy.
    this.timer = setInterval(() => this.evict(), WINDOW_MS).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const key = request.ip ?? 'unknown';
    const now = Date.now();

    const window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return true;
    }

    window.count += 1;
    if (window.count > MAX_REQUESTS) {
      throw new ApiError(
        'RATE_LIMITED',
        HttpStatus.TOO_MANY_REQUESTS,
        'Too many requests. Wait a moment and try again.',
      );
    }
    return true;
  }

  private evict(): void {
    const now = Date.now();
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
