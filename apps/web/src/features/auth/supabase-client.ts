import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InvitationTokenSchema, MembershipSummarySchema, UserProfileSchema } from '@autopw3/shared';
import type { MembershipSummary, UserProfile } from '@autopw3/shared';
import { AuthFailure } from './types';
import type { Account, AuthClient, AuthEvent, AuthFailureKind, AuthUser } from './types';

/** What the browser needs to reach the project. Both values are public by design (RLS protects the data). */
export interface SupabaseAuthConfig {
  url: string;
  anonKey: string;
}

export interface SupabaseAuthOptions {
  /** Page origin used to build the links in emails. Defaults to `window.location.origin`. */
  origin?: string;
  /** Supply a client (tests). Defaults to a real one. */
  client?: SupabaseClient;
}

/** The pieces of an error object this adapter reads. Supabase errors carry `code`, `status` and `name`. */
interface ErrorLike {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  message?: unknown;
}

function errorLike(error: unknown): ErrorLike {
  return typeof error === 'object' && error !== null ? (error as ErrorLike) : {};
}

function codeOf(error: unknown): string {
  const { code } = errorLike(error);
  return typeof code === 'string' ? code : '';
}

function statusOf(error: unknown): number | null {
  const { status } = errorLike(error);
  return typeof status === 'number' ? status : null;
}

function messageOf(error: unknown): string {
  const { message } = errorLike(error);
  return typeof message === 'string' ? message : '';
}

function isNetworkError(error: unknown): boolean {
  const { name } = errorLike(error);
  return (
    name === 'AuthRetryableFetchError' ||
    statusOf(error) === 0 ||
    /failed to fetch|networkerror|network request failed|load failed/i.test(messageOf(error))
  );
}

/**
 * Map a Supabase Auth error to a failure kind. Only the kind leaves this function: the server's wording is not
 * shown, so messages cannot reveal whether an address has an account.
 */
export function kindFromAuthError(error: unknown): AuthFailureKind {
  const code = codeOf(error);
  const status = statusOf(error);
  if (isNetworkError(error)) return 'network';
  if (
    status === 429 ||
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit'
  ) {
    return 'rate_limited';
  }
  switch (code) {
    case 'invalid_credentials':
      return 'invalid_credentials';
    case 'email_not_confirmed':
      return 'email_not_confirmed';
    case 'weak_password':
      return 'weak_password';
    case 'same_password':
      return 'same_password';
    case 'email_address_invalid':
    case 'validation_failed':
    case 'bad_json':
      return 'invalid_input';
    case 'session_expired':
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
    case 'bad_jwt':
      return 'expired_session';
    default:
      return 'unknown';
  }
}

/** Map a PostgREST error (table queries and `rpc`) to a failure kind. */
export function kindFromDatabaseError(error: unknown): AuthFailureKind {
  const code = codeOf(error);
  const status = statusOf(error);
  const message = messageOf(error);
  if (isNetworkError(error)) return 'network';
  if (
    status === 401 ||
    code === 'PGRST301' ||
    code === 'PGRST303' ||
    /jwt expired/i.test(message)
  ) {
    return 'expired_session';
  }
  if (status === 429) return 'rate_limited';
  if (code === '42501' || status === 403) return 'not_authorised';
  if (/invalid_invitation/.test(message)) return 'invalid_invitation';
  return 'unknown';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A `user_profiles` row as a validated profile, or `null` for a row that is not valid. */
function parseProfile(userId: string, row: unknown): UserProfile | null {
  const record = asRecord(row);
  if (record === null) return null;
  const parsed = UserProfileSchema.safeParse({
    userId,
    displayName: record['display_name'] ?? null,
    locale: record['locale'] ?? null,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * A `household_members` row with its embedded household as a validated membership, or `null`. The role is
 * checked against the shared enum, so an unknown value is refused instead of being trusted.
 */
function parseMembership(row: unknown): MembershipSummary | null {
  const record = asRecord(row);
  if (record === null) return null;
  // PostgREST embeds a many-to-one relation as an object; accept a one-item array too.
  const embedded = record['households'];
  const household = asRecord(Array.isArray(embedded) ? embedded[0] : embedded);
  if (household === null) return null;
  const parsed = MembershipSummarySchema.safeParse({
    householdId: record['household_id'],
    name: household['name'],
    role: record['role'],
  });
  return parsed.success ? parsed.data : null;
}

/**
 * The live identity adapter. Sessions are kept by the Supabase library in browser storage; this code adds
 * nothing to storage and never stores a role. Profile and memberships are read with the person's own token,
 * so the database decides what is returned (RLS). No service-role key is used or accepted here.
 */
export function createSupabaseAuthClient(
  config: SupabaseAuthConfig,
  options: SupabaseAuthOptions = {},
): AuthClient {
  const supabase: SupabaseClient =
    options.client ??
    createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    });
  const origin = (): string => options.origin ?? window.location.origin;
  let signingOut = false;

  return {
    async getUser(): Promise<AuthUser | null> {
      const { data, error } = await supabase.auth.getSession();
      if (error !== null) throw new AuthFailure(kindFromAuthError(error));
      const session = data.session;
      return session === null ? null : { id: session.user.id, email: session.user.email ?? null };
    },

    async loadAccount(user: AuthUser): Promise<Account> {
      const profileResult = await supabase
        .from('user_profiles')
        .select('user_id, display_name, locale')
        .eq('user_id', user.id)
        .maybeSingle();
      if (profileResult.error !== null)
        throw new AuthFailure(kindFromDatabaseError(profileResult.error));

      const membershipResult = await supabase
        .from('household_members')
        .select('household_id, role, households ( id, name )')
        .eq('user_id', user.id);
      if (membershipResult.error !== null) {
        throw new AuthFailure(kindFromDatabaseError(membershipResult.error));
      }

      // A missing profile row is shown as an empty profile; a malformed one is a server fault.
      const profile =
        profileResult.data === null
          ? { userId: user.id, displayName: null, locale: null }
          : parseProfile(user.id, profileResult.data);
      if (profile === null) throw new AuthFailure('unknown');

      const rows: unknown = membershipResult.data;
      if (!Array.isArray(rows)) throw new AuthFailure('unknown');
      const memberships: MembershipSummary[] = [];
      for (const row of rows as unknown[]) {
        const membership = parseMembership(row);
        // An unknown role or a malformed row is a server fault. Fail closed: no access is shown.
        if (membership === null) throw new AuthFailure('unknown');
        memberships.push(membership);
      }
      return { profile, memberships };
    },

    async signUp(email, password) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${origin()}/auth/callback` },
      });
      // An existing address is reported like a new one, so the form cannot be used to find accounts.
      if (error !== null && codeOf(error) !== 'user_already_exists') {
        throw new AuthFailure(kindFromAuthError(error));
      }
    },

    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error !== null) throw new AuthFailure(kindFromAuthError(error));
    },

    async signOut() {
      signingOut = true;
      try {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error !== null && !isNetworkError(error))
          throw new AuthFailure(kindFromAuthError(error));
      } finally {
        signingOut = false;
      }
    },

    async requestPasswordReset(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin()}/reset-password`,
      });
      if (error !== null) {
        const kind = kindFromAuthError(error);
        // Only failures that say nothing about the address are shown.
        if (kind === 'network' || kind === 'rate_limited') throw new AuthFailure(kind);
      }
    },

    async updatePassword(newPassword) {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error !== null) throw new AuthFailure(kindFromAuthError(error));
    },

    async acceptInvitation(token) {
      if (!InvitationTokenSchema.safeParse(token).success)
        throw new AuthFailure('invalid_invitation');
      const { error } = await supabase.rpc('accept_invitation', { p_token: token });
      if (error !== null) throw new AuthFailure(kindFromDatabaseError(error));
    },

    subscribe(listener) {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        // Do not call the Supabase client inside this callback (it can deadlock); hand the event on later.
        let mapped: AuthEvent | null = null;
        if (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') mapped = { type: 'signed_in' };
        else if (event === 'SIGNED_OUT')
          mapped = signingOut ? { type: 'signed_out' } : { type: 'expired' };
        if (mapped !== null) {
          const toSend = mapped;
          setTimeout(() => {
            listener(toSend);
          }, 0);
        }
      });
      return () => {
        data.subscription.unsubscribe();
      };
    },
  };
}
