import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route out of the global AuthGuard. Used by `GET /health` and, later, by
 * `/s/:token` — the brief requires a public link to work without signing in.
 * A public route still authorises: it just does so from the token, not a session.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
