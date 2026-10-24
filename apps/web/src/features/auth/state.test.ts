import type { MembershipSummary } from '@autopw3/shared';
import { describe, expect, it } from 'vitest';
import { permissionsOf, pickMembership, roleOf, stateFromAccount, stateFromFailure } from './state';
import { AuthFailure } from './types';
import type { Account, AuthState, AuthUser } from './types';

const USER: AuthUser = { id: '11111111-1111-4111-8111-000000000001', email: 'a@example.test' };
const PROFILE = { userId: USER.id, displayName: null, locale: null };

function membership(name: string, role: MembershipSummary['role'], id: string): MembershipSummary {
  return { householdId: id, name, role };
}

const H1 = '99999999-9999-4999-8999-000000000001';
const H2 = '99999999-9999-4999-8999-000000000002';

describe('stateFromAccount', () => {
  it('is no-household when the database returned no membership', () => {
    const account: Account = { profile: PROFILE, memberships: [] };
    expect(stateFromAccount(USER, account)).toEqual({
      status: 'no-household',
      user: USER,
      profile: PROFILE,
    });
  });

  it('is authorised with the role the database returned', () => {
    const account: Account = { profile: PROFILE, memberships: [membership('Home', 'ADMIN', H1)] };
    const state = stateFromAccount(USER, account);
    expect(state.status).toBe('authorised');
    expect(roleOf(state)).toBe('ADMIN');
  });
});

describe('pickMembership', () => {
  it('returns null for no memberships', () => {
    expect(pickMembership([])).toBeNull();
  });

  it('chooses by name then id, never by role or by anything the browser holds', () => {
    const a = membership('Alpha', 'READ_ONLY', H2);
    const b = membership('Beta', 'ADMIN', H1);
    expect(pickMembership([b, a])).toEqual(a);
    const same1 = membership('Same', 'READ_ONLY', H2);
    const same2 = membership('Same', 'ADMIN', H1);
    expect(pickMembership([same1, same2])).toEqual(same2);
  });
});

describe('roleOf and permissionsOf', () => {
  const authorised = (role: MembershipSummary['role']): AuthState => {
    const m = membership('Home', role, H1);
    return { status: 'authorised', user: USER, profile: PROFILE, memberships: [m], membership: m };
  };

  it('gives no role unless authorised', () => {
    const others: AuthState[] = [
      { status: 'loading' },
      { status: 'unauthenticated' },
      { status: 'expired' },
      { status: 'error', message: 'x' },
      { status: 'no-household', user: USER, profile: PROFILE },
    ];
    for (const state of others) {
      expect(roleOf(state)).toBeNull();
      expect(permissionsOf(state)).toEqual({ role: null, canWrite: false, canAdmin: false });
    }
  });

  it('READ_ONLY cannot write or administer', () => {
    expect(permissionsOf(authorised('READ_ONLY'))).toEqual({
      role: 'READ_ONLY',
      canWrite: false,
      canAdmin: false,
    });
  });

  it('READ_WRITE can write but not administer', () => {
    expect(permissionsOf(authorised('READ_WRITE'))).toEqual({
      role: 'READ_WRITE',
      canWrite: true,
      canAdmin: false,
    });
  });

  it('ADMIN can do both', () => {
    expect(permissionsOf(authorised('ADMIN'))).toEqual({
      role: 'ADMIN',
      canWrite: true,
      canAdmin: true,
    });
  });
});

describe('stateFromFailure', () => {
  it('treats an ended session or a refused token as expired', () => {
    expect(stateFromFailure(new AuthFailure('expired_session')).status).toBe('expired');
    expect(stateFromFailure(new AuthFailure('not_authorised')).status).toBe('expired');
  });

  it('shows a retryable error for a network failure and for anything unexpected', () => {
    for (const error of [
      new AuthFailure('network'),
      new AuthFailure('unknown'),
      new Error('boom'),
    ]) {
      const state = stateFromFailure(error);
      expect(state.status).toBe('error');
    }
  });

  it('never copies the underlying error text into the message', () => {
    const state = stateFromFailure(new Error('secret-token-123 leaked'));
    expect(state.status === 'error' && state.message).not.toContain('secret-token-123');
  });
});
