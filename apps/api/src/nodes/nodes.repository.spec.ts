import { isUniqueViolation } from './nodes.repository';

/**
 * Every name conflict in the app is decided by this one predicate. When it says no, the
 * conflict stops being a `409` the user can act on and becomes a `500` that reads
 * "Something went wrong" — which is exactly what happened before the `P2010` shape was
 * handled, because rename and move go through `$executeRaw` and never produce `P2002`.
 *
 * The shapes below are copied from real driver output, not invented.
 */
describe('isUniqueViolation', () => {
  it('recognises a conflict raised through the query builder', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
  });

  it('recognises a bare Postgres code', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('recognises a conflict raised inside a raw statement', () => {
    // Prisma cannot attribute a constraint it did not write the SQL for, so the raw
    // statement fails as P2010 with the real code nested in the adapter's error.
    expect(
      isUniqueViolation({
        code: 'P2010',
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '23505',
              originalMessage:
                'duplicate key value violates unique constraint "nodes_name_uniq"',
              kind: 'UniqueConstraintViolation',
            },
          },
        },
      }),
    ).toBe(true);
  });

  it('recognises the adapter kind even without the Postgres code', () => {
    expect(
      isUniqueViolation({
        code: 'P2010',
        meta: {
          driverAdapterError: { cause: { kind: 'UniqueConstraintViolation' } },
        },
      }),
    ).toBe(true);
  });

  it('does not claim an unrelated raw failure', () => {
    expect(
      isUniqueViolation({
        code: 'P2010',
        meta: {
          driverAdapterError: {
            cause: { originalCode: '23514', kind: 'CheckConstraintViolation' },
          },
        },
      }),
    ).toBe(false);
  });

  it('does not claim anything that is not an error object', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation({ code: 'P2025' })).toBe(false);
  });
});
