import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
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
