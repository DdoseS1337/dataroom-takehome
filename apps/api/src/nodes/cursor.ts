import { ApiError } from '../common/api-error';
import type { ChildRow, ListCursor } from './nodes.repository';

/**
 * The cursor is the last row's sort key, opaque to the client. Encoded rather than
 * exposed as three query parameters so the sort key can change without breaking a
 * bookmarked URL, and so nobody is tempted to hand-craft one.
 *
 * `sortName` is Postgres' own `lower(name)`, carried verbatim: recomputing it in JS
 * would drift from the database collation and silently skip or repeat rows.
 */
export function encodeCursor(row: ChildRow): string {
  const payload: [number, string, string] = [
    row.sortRank,
    row.sortName,
    row.id,
  ];
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): ListCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw ApiError.invalid('That page cursor is not valid.');
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length !== 3 ||
    typeof parsed[0] !== 'number' ||
    !Number.isInteger(parsed[0]) ||
    typeof parsed[1] !== 'string' ||
    typeof parsed[2] !== 'string' ||
    !UUID.test(parsed[2])
  ) {
    throw ApiError.invalid('That page cursor is not valid.');
  }

  return { rank: parsed[0], name: parsed[1], id: parsed[2] };
}

// The id goes into the query with a ::uuid cast, so a malformed one would surface as a
// Postgres syntax error rather than a 400.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
