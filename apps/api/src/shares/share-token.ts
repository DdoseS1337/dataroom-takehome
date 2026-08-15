import { createHash, randomBytes } from 'node:crypto';

/**
 * 256 bits of CSPRNG output, base64url so it survives a URL untouched. Only the SHA-256
 * hash is ever stored, so a database dump — or a backup, or a leaked query log — yields
 * no working links. The plaintext exists once, in the response that created it.
 *
 * No salt and no work factor, deliberately: this is a 256-bit random secret, not a
 * password. There is nothing to brute-force and nothing to precompute, and a slow KDF
 * here would only make every page load of a shared folder slower.
 */
const TOKEN_BYTES = 32;

/** 32 bytes of base64url, unpadded. Anything else was not issued here. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function createShareToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashShareToken(token) };
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Rejects anything that cannot be one of our tokens before it reaches the database.
 * Saves a query per probe, and keeps a hand-typed URL from being answered as though it
 * were a real guess.
 */
export function isShareTokenShaped(token: string): boolean {
  return TOKEN_SHAPE.test(token);
}
