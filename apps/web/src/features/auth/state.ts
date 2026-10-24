import type { MembershipSummary, Role } from '@autopw3/shared';
import { roleAtLeast } from '@autopw3/shared';
import { isAuthFailure } from './types';
import type { Account, AuthState, AuthUser } from './types';

/**
 * Pick the household in use. v1 has one household per person; if there are several the order is by name, then
 * id, so the choice is stable and never depends on anything the browser stores.
 */
export function pickMembership(
  memberships: ReadonlyArray<MembershipSummary>,
): MembershipSummary | null {
  const sorted = [...memberships].sort(
    (a, b) => a.name.localeCompare(b.name) || a.householdId.localeCompare(b.householdId),
  );
  return sorted[0] ?? null;
}

/** The state for a signed-in person once the account is known. */
export function stateFromAccount(user: AuthUser, account: Account): AuthState {
  const membership = pickMembership(account.memberships);
  if (membership === null) {
    return { status: 'no-household', user, profile: account.profile };
  }
  return {
    status: 'authorised',
    user,
    profile: account.profile,
    memberships: account.memberships,
    membership,
  };
}

const LOAD_FAILED = 'We could not load your account. Check your connection and try again.';

/** The state for a failure while restoring the session or loading the account. */
export function stateFromFailure(error: unknown): AuthState {
  if (isAuthFailure(error)) {
    if (error.kind === 'expired_session' || error.kind === 'not_authorised') {
      return { status: 'expired' };
    }
    if (error.kind === 'network') {
      return { status: 'error', message: LOAD_FAILED };
    }
  }
  return {
    status: 'error',
    message: 'Something went wrong while loading your account. Try again.',
  };
}

/** The role the database gave this person, or `null` when signed out, expired, loading or without a household. */
export function roleOf(state: AuthState): Role | null {
  return state.status === 'authorised' ? state.membership.role : null;
}

export interface Permissions {
  /** What the server said. `null` when there is no household access. */
  role: Role | null;
  /** READ_WRITE or ADMIN: may use editing controls. A UI hint: the Worker and database decide. */
  canWrite: boolean;
  /** ADMIN: may see the admin area. A UI hint: the Worker and database decide. */
  canAdmin: boolean;
}

export function permissionsOf(state: AuthState): Permissions {
  const role = roleOf(state);
  return {
    role,
    canWrite: role !== null && roleAtLeast(role, 'READ_WRITE'),
    canAdmin: role !== null && roleAtLeast(role, 'ADMIN'),
  };
}
