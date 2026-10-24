import type { MembershipSummary, UserProfile } from '@autopw3/shared';

/** Who is signed in, as the identity provider reports it. Holds no role: roles come from the database. */
export interface AuthUser {
  id: string;
  email: string | null;
}

/** The signed-in person's profile and household memberships, read through RLS-protected queries. */
export interface Account {
  profile: UserProfile;
  memberships: MembershipSummary[];
}

/**
 * The auth state machine (TASK-07 plan).
 *
 *   loading ──► unauthenticated ──(sign in)──► loading ──► no-household | authorised
 *      │                ▲                                       │
 *      │                └──────(sign out)───────────────────────┤
 *      ├──► expired  (the session ended or the server rejected the token)
 *      └──► error    (the account could not be loaded; retry is offered)
 *
 * `authorised` is the only state that carries a role, and that role is the one the database returned.
 */
export type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'expired' }
  | { status: 'error'; message: string }
  | { status: 'no-household'; user: AuthUser; profile: UserProfile }
  | {
      status: 'authorised';
      user: AuthUser;
      profile: UserProfile;
      /** Every household the person belongs to (v1 uses one). */
      memberships: MembershipSummary[];
      /** The household in use. v1 has one household per person. */
      membership: MembershipSummary;
    };

export type AuthStatus = AuthState['status'];

/** Why an auth operation failed, in terms the interface can explain without leaking account existence. */
export type AuthFailureKind =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'weak_password'
  | 'same_password'
  | 'invalid_input'
  | 'rate_limited'
  | 'network'
  | 'expired_session'
  | 'invalid_invitation'
  | 'not_authorised'
  | 'unknown';

/** Thrown by an `AuthClient`. Carries a kind only: never the server's message, a token, or a stack of details. */
export class AuthFailure extends Error {
  readonly kind: AuthFailureKind;

  constructor(kind: AuthFailureKind) {
    super(kind);
    this.name = 'AuthFailure';
    this.kind = kind;
  }
}

export function isAuthFailure(value: unknown): value is AuthFailure {
  return value instanceof AuthFailure;
}

/** Things the client reports without being asked. */
export type AuthEvent =
  /** Someone signed in (possibly in another tab, or by following an emailed link). */
  | { type: 'signed_in' }
  /** The person signed out here or in another tab. */
  | { type: 'signed_out' }
  /** The session ended without the person asking: refresh failed or the token was revoked. */
  | { type: 'expired' };

/**
 * Everything the app needs from an identity provider. Two adapters implement it: Supabase (live) and an
 * in-memory one for tests and the Playwright smoke test (development builds only).
 */
export interface AuthClient {
  /** The signed-in user restored from storage, or `null`. No role. */
  getUser(): Promise<AuthUser | null>;
  /** Profile and memberships from the database, under the person's own token and RLS. Roles come from here only. */
  loadAccount(user: AuthUser): Promise<Account>;
  signUp(email: string, password: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Always resolves the same way for known and unknown addresses. */
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(newPassword: string): Promise<void>;
  /** The database function `accept_invitation`, run as the signed-in user. The database enforces every rule. */
  acceptInvitation(token: string): Promise<void>;
  subscribe(listener: (event: AuthEvent) => void): () => void;
}

/** Must match the password length set in Supabase Auth (docs/AUTHENTICATION_SETUP.md). The server is authoritative. */
export const PASSWORD_MIN_LENGTH = 12;
