import type { AuthUser } from '../auth/current-user.decorator';
import { resolvePermission, type Permission } from './resolve-permission';

const owner: AuthUser = { id: 'user-owner', email: 'owner@example.com' };
const stranger: AuthUser = { id: 'user-stranger', email: 'other@example.com' };

// Table-driven so Block 5 adds rows for shares rather than rewriting the file. The
// grant cases are absent because grants are: a share does not exist yet, and a test
// asserting a rule the function does not implement would only pass by accident.
const cases: Array<{
  name: string;
  user: AuthUser | undefined;
  ownerId: string;
  expected: Permission;
}> = [
  {
    name: 'the room owner owns every node in it',
    user: owner,
    ownerId: owner.id,
    expected: 'owner',
  },
  {
    name: 'another signed-in user has nothing without a share',
    user: stranger,
    ownerId: owner.id,
    expected: 'none',
  },
  {
    name: 'an anonymous requester has nothing',
    user: undefined,
    ownerId: owner.id,
    expected: 'none',
  },
];

describe('resolvePermission', () => {
  it.each(cases)('$name', ({ user, ownerId, expected }) => {
    expect(resolvePermission(user, { ownerId })).toBe(expected);
  });

  // Identity is the user id, never the email: emails change, and a share matched on a
  // reused address would hand the new holder the old holder's access.
  it('does not treat a matching email as ownership', () => {
    const sameEmail: AuthUser = { id: 'someone-else', email: owner.email };
    expect(resolvePermission(sameEmail, { ownerId: owner.id })).toBe('none');
  });
});
