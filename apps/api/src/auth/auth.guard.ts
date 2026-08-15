import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './current-user.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

type KeyResolver = Parameters<typeof jwtVerify>[1];

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private readonly key: KeyResolver;

  // Which users this process has already written to the local `users` table, and
  // with which email. Upserting on every request would be a write per request;
  // keying on email means a change in Supabase still propagates on the next
  // request rather than waiting for a restart. Share matching is by email, so a
  // stale copy here would be a correctness bug, not just a cosmetic one.
  private readonly synced = new Map<string, string>();

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    const jwksUrl = process.env.SUPABASE_JWKS_URL;
    const secret = process.env.SUPABASE_JWT_SECRET;

    // Supabase issues either asymmetric keys (ES256/RS256, verified against JWKS)
    // or a legacy shared HS256 secret, depending on when the project was created.
    // Supporting both costs three lines and removes a deploy-time footgun.
    if (jwksUrl) {
      this.key = createRemoteJWKSet(new URL(jwksUrl));
    } else if (secret) {
      this.key = new TextEncoder().encode(secret);
    } else {
      throw new Error(
        'Set SUPABASE_JWKS_URL (asymmetric keys) or SUPABASE_JWT_SECRET (legacy HS256).',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // A public route still identifies the requester when it can. `/s/:token` needs
    // to tell "anonymous" from "signed in as the wrong account" to answer usefully.
    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.key, {
        audience: 'authenticated',
      }));
    } catch (error) {
      if (isPublic) return true;
      this.logger.debug(`Token rejected: ${(error as Error).message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.syncUser(payload);
    if (!user) {
      if (isPublic) return true;
      throw new UnauthorizedException('Token carries no subject or email');
    }

    (request as Request & { user?: AuthUser }).user = user;
    return true;
  }

  /**
   * The local `users` row is a mirror of the Supabase identity, created on first
   * sight. There is no foreign key to `auth.users`: that schema is vendor-owned and
   * Prisma does not manage it. `users.id` equals the Supabase `sub`.
   */
  private async syncUser(payload: JWTPayload): Promise<AuthUser | null> {
    const id = payload.sub;
    const email = typeof payload.email === 'string' ? payload.email : null;
    if (!id || !email) return null;

    if (this.synced.get(id) === email) return { id, email };

    const metadata = (payload.user_metadata ?? {}) as Record<string, unknown>;
    const name = pickString(metadata, 'full_name', 'name');
    const avatarUrl = pickString(metadata, 'avatar_url', 'picture');

    await this.prisma.user.upsert({
      where: { id },
      create: { id, email, name, avatarUrl },
      update: { email, name, avatarUrl },
    });

    this.synced.set(id, email);
    return { id, email };
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function pickString(
  source: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}
