import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../common/api-error';

export interface AuthUser {
  id: string;
  email: string;
}

/**
 * On a guarded route the guard has already rejected anonymous requests, so this never
 * throws in practice. It exists so the narrowing is done by a check rather than by a
 * non-null assertion that would silently become wrong if a route were made `@Public()`.
 */
export function requireUser(user: AuthUser | undefined): AuthUser {
  if (!user) throw ApiError.unauthenticated();
  return user;
}

/**
 * On a `@Public()` route there may be no user, so this is `AuthUser | undefined`
 * by design — `/s/:token` has to serve anonymous and signed-in requesters
 * differently, and a non-optional type there would hide the case that matters.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return (request as Request & { user?: AuthUser }).user;
  },
);
