/*
  In-memory identity adapter for tests and the Playwright smoke test.

  DEVELOPMENT ONLY. It is loaded only behind `import.meta.env.DEV` (see create-client.ts), so a production build
  does not contain it, and `readConfig` refuses VITE_AUTH_MODE=mock outside a development build. The accounts
  and passwords below are fake and mean nothing anywhere else.

  It behaves like the real service where it matters for the interface:
    - the "server" (accounts, passwords, memberships) lives in this module's memory, never in browser storage;
    - the only thing stored in the browser is a signed session token holding a user id, so editing storage
      (including adding a role) cannot create access;
    - an existing address is registered without any visible difference (no account enumeration).
*/
import { InvitationTokenSchema, ROLES } from '@autopw3/shared';
import type { MembershipSummary, Role } from '@autopw3/shared';
import { AuthFailure, PASSWORD_MIN_LENGTH } from '../types';
import type { Account, AuthClient, AuthEvent, AuthUser } from '../types';

export const MOCK_SESSION_STORAGE_KEY = 'autopw3.mock-session';
export const MOCK_PASSWORD = 'mock-password-12';
export const MOCK_HOUSEHOLD_ID = '99999999-9999-4999-8999-999999999999';
export const MOCK_HOUSEHOLD_NAME = 'Test household';
/** 64 lowercase hex characters: the shape of a real invitation token. Fake. */
export const MOCK_INVITE_TOKEN = 'ab'.repeat(32);

export interface MockMembershipSeed {
  householdId?: string;
  name?: string;
  role: Role;
}

export interface MockUserSeed {
  email: string;
  password?: string;
  confirmed?: boolean;
  displayName?: string | null;
  memberships?: MockMembershipSeed[];
}

export interface MockInvitationSeed {
  token: string;
  role?: Role;
  /** When set, only this address may accept (mirrors the real rule). */
  email?: string;
}

export interface MockAuthOptions {
  users?: MockUserSeed[];
  invitations?: MockInvitationSeed[];
  /** When true, new accounts must be confirmed (`confirmEmail`) before they can sign in. */
  requireConfirmation?: boolean;
  /** Where the signed session token is kept. `null` keeps it in memory only. Defaults to `localStorage`. */
  storage?: Storage | null;
  /** Start signed in as this address. */
  signedInAs?: string;
}

/** Test and smoke-test controls. They are not part of `AuthClient`: the app never calls them. */
export interface MockAuthClient extends AuthClient {
  /** Make the server end the session: the next request fails as expired. */
  expireSession(): void;
  /** Change what the "server" says about a person's role. */
  setRole(email: string, role: Role): void;
  confirmEmail(email: string): void;
  /** Addresses a reset link was requested for. */
  readonly resetRequests: readonly string[];
}

interface MockUser {
  id: string;
  email: string;
  password: string;
  confirmed: boolean;
  displayName: string | null;
  memberships: MembershipSummary[];
}

/** The default accounts for development and the smoke test, one per role plus one with no household. */
export const DEV_MOCK_USERS: ReadonlyArray<MockUserSeed> = [
  { email: 'readonly@example.test', memberships: [{ role: 'READ_ONLY' }] },
  { email: 'readwrite@example.test', memberships: [{ role: 'READ_WRITE' }] },
  { email: 'admin@example.test', memberships: [{ role: 'ADMIN' }] },
  { email: 'nohome@example.test', memberships: [] },
];

/** A fixed, dev-only checksum so a token with an edited user id is rejected, as a forged JWT would be. */
function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of `autopw3-mock:${text}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function tokenFor(userId: string): string {
  return `mock.${userId}.${checksum(userId)}`;
}

function userIdFromToken(token: string): string | null {
  const [prefix, id, sum, extra] = token.split('.');
  if (prefix !== 'mock' || id === undefined || sum === undefined || extra !== undefined)
    return null;
  return sum === checksum(id) ? id : null;
}

function normalise(email: string): string {
  return email.trim().toLowerCase();
}

function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function createMockAuthClient(options: MockAuthOptions = {}): MockAuthClient {
  const storage = options.storage === undefined ? safeLocalStorage() : options.storage;
  const users = new Map<string, MockUser>();
  const invitations = new Map<string, MockInvitationSeed & { used: boolean }>();
  const listeners = new Set<(event: AuthEvent) => void>();
  const resetRequests: string[] = [];
  let sessionUserId: string | null = null;
  let serial = 0;

  function emit(event: AuthEvent): void {
    for (const listener of [...listeners]) listener(event);
  }

  function seed(user: MockUserSeed): MockUser {
    serial += 1;
    const created: MockUser = {
      id: `11111111-1111-4111-8111-${String(serial).padStart(12, '0')}`,
      email: normalise(user.email),
      password: user.password ?? MOCK_PASSWORD,
      confirmed: user.confirmed ?? true,
      displayName: user.displayName ?? null,
      memberships: (user.memberships ?? []).map((m) => ({
        householdId: m.householdId ?? MOCK_HOUSEHOLD_ID,
        name: m.name ?? MOCK_HOUSEHOLD_NAME,
        role: m.role,
      })),
    };
    users.set(created.email, created);
    return created;
  }

  for (const user of options.users ?? DEV_MOCK_USERS) seed(user);
  for (const invitation of options.invitations ?? [{ token: MOCK_INVITE_TOKEN }]) {
    invitations.set(invitation.token, { ...invitation, used: false });
  }

  function byId(id: string): MockUser | undefined {
    return [...users.values()].find((u) => u.id === id);
  }

  function startSession(user: MockUser): void {
    sessionUserId = user.id;
    storage?.setItem(MOCK_SESSION_STORAGE_KEY, tokenFor(user.id));
  }

  function endSession(): void {
    sessionUserId = null;
    storage?.removeItem(MOCK_SESSION_STORAGE_KEY);
  }

  // Restore from storage. A forged or stale token is ignored.
  const restoredToken = storage?.getItem(MOCK_SESSION_STORAGE_KEY) ?? null;
  const restoredId = restoredToken === null ? null : userIdFromToken(restoredToken);
  const restoredUser = restoredId === null ? undefined : byId(restoredId);
  if (restoredUser !== undefined) sessionUserId = restoredUser.id;
  if (options.signedInAs !== undefined) {
    const user = users.get(normalise(options.signedInAs));
    if (user !== undefined) startSession(user);
  }

  function requireSession(): MockUser {
    const user = sessionUserId === null ? undefined : byId(sessionUserId);
    if (user === undefined) throw new AuthFailure('expired_session');
    return user;
  }

  return {
    resetRequests,

    getUser() {
      const user = sessionUserId === null ? undefined : byId(sessionUserId);
      return Promise.resolve(user === undefined ? null : { id: user.id, email: user.email });
    },

    loadAccount(user: AuthUser): Promise<Account> {
      try {
        const current = requireSession();
        if (current.id !== user.id) throw new AuthFailure('expired_session');
        return Promise.resolve({
          profile: { userId: current.id, displayName: current.displayName, locale: null },
          memberships: current.memberships.map((m) => ({ ...m })),
        });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new AuthFailure('unknown'));
      }
    },

    signUp(email, password) {
      const address = normalise(email);
      if (!looksLikeEmail(address)) return Promise.reject(new AuthFailure('invalid_input'));
      if (password.length < PASSWORD_MIN_LENGTH)
        return Promise.reject(new AuthFailure('weak_password'));
      // An existing address looks exactly like a new one.
      if (users.has(address)) return Promise.resolve();
      const created = seed({
        email: address,
        password,
        confirmed: options.requireConfirmation !== true,
        memberships: [],
      });
      if (created.confirmed) {
        startSession(created);
        emit({ type: 'signed_in' });
      }
      return Promise.resolve();
    },

    signIn(email, password) {
      const user = users.get(normalise(email));
      if (user === undefined || user.password !== password) {
        return Promise.reject(new AuthFailure('invalid_credentials'));
      }
      if (!user.confirmed) return Promise.reject(new AuthFailure('email_not_confirmed'));
      startSession(user);
      emit({ type: 'signed_in' });
      return Promise.resolve();
    },

    signOut() {
      endSession();
      emit({ type: 'signed_out' });
      return Promise.resolve();
    },

    requestPasswordReset(email) {
      resetRequests.push(normalise(email));
      return Promise.resolve();
    },

    updatePassword(newPassword) {
      try {
        const user = requireSession();
        if (newPassword.length < PASSWORD_MIN_LENGTH) throw new AuthFailure('weak_password');
        if (newPassword === user.password) throw new AuthFailure('same_password');
        user.password = newPassword;
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new AuthFailure('unknown'));
      }
    },

    acceptInvitation(token) {
      try {
        const user = requireSession();
        if (!InvitationTokenSchema.safeParse(token).success)
          throw new AuthFailure('invalid_invitation');
        const invitation = invitations.get(token);
        if (
          invitation === undefined ||
          invitation.used ||
          (invitation.email !== undefined && normalise(invitation.email) !== user.email)
        ) {
          throw new AuthFailure('invalid_invitation');
        }
        invitation.used = true;
        user.memberships = [
          ...user.memberships.filter((m) => m.householdId !== MOCK_HOUSEHOLD_ID),
          {
            householdId: MOCK_HOUSEHOLD_ID,
            name: MOCK_HOUSEHOLD_NAME,
            role: invitation.role ?? 'READ_ONLY',
          },
        ];
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new AuthFailure('unknown'));
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    expireSession() {
      endSession();
      emit({ type: 'expired' });
    },

    setRole(email, role) {
      if (!ROLES.includes(role)) throw new Error('unknown role');
      const user = users.get(normalise(email));
      if (user === undefined) throw new Error('unknown mock user');
      user.memberships = user.memberships.map((m) => ({ ...m, role }));
    },

    confirmEmail(email) {
      const user = users.get(normalise(email));
      if (user !== undefined) user.confirmed = true;
    },
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Window hook used only by the Playwright smoke test to end the session from outside the page. */
export const MOCK_WINDOW_HOOK = '__AUTOPW3_MOCK_AUTH__';

/** The client used by `npm run dev` with VITE_AUTH_MODE=mock. One instance for the page's life. */
export function createDevMockAuthClient(): MockAuthClient {
  const client = createMockAuthClient();
  (window as unknown as Record<string, unknown>)[MOCK_WINDOW_HOOK] = {
    expireSession: () => {
      client.expireSession();
    },
  };
  return client;
}
