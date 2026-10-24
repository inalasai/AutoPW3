import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSupabaseAuthClient,
  kindFromAuthError,
  kindFromDatabaseError,
} from './supabase-client';
import { AuthFailure } from './types';

const USER = { id: '11111111-1111-4111-8111-000000000001', email: 'a@example.test' };
const HOUSEHOLD = '99999999-9999-4999-8999-999999999999';
const TOKEN = 'cd'.repeat(32);

interface QueryResult {
  data: unknown;
  error: unknown;
}

/** A thenable stand-in for a PostgREST query builder. */
function query(result: QueryResult) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

interface FakeOptions {
  profile?: QueryResult;
  memberships?: QueryResult;
  signUp?: unknown;
  signIn?: unknown;
  signOut?: unknown;
  reset?: unknown;
  update?: unknown;
  rpc?: unknown;
  session?: unknown;
}

function fake(options: FakeOptions = {}) {
  const profile = query(options.profile ?? { data: null, error: null });
  const memberships = query(options.memberships ?? { data: [], error: null });
  let authListener: ((event: string) => void) | null = null;
  const auth = {
    getSession: vi.fn(() =>
      Promise.resolve({
        data: { session: options.session === undefined ? { user: USER } : options.session },
        error: null,
      }),
    ),
    signUp: vi.fn(() => Promise.resolve({ data: {}, error: options.signUp ?? null })),
    signInWithPassword: vi.fn(() => Promise.resolve({ data: {}, error: options.signIn ?? null })),
    signOut: vi.fn(() => Promise.resolve({ error: options.signOut ?? null })),
    resetPasswordForEmail: vi.fn(() => Promise.resolve({ data: {}, error: options.reset ?? null })),
    updateUser: vi.fn(() => Promise.resolve({ data: {}, error: options.update ?? null })),
    onAuthStateChange: vi.fn((listener: (event: string) => void) => {
      authListener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
  };
  const from = vi.fn((table: string) => (table === 'user_profiles' ? profile : memberships));
  const rpc = vi.fn(() => Promise.resolve({ data: null, error: options.rpc ?? null }));
  const client = { auth, from, rpc } as unknown as SupabaseClient;
  return {
    client,
    auth,
    from,
    rpc,
    profile,
    memberships,
    emit: (event: string) => authListener?.(event),
  };
}

function adapter(options: FakeOptions = {}) {
  const f = fake(options);
  return {
    ...f,
    api: createSupabaseAuthClient(
      { url: 'https://example-project.supabase.co', anonKey: 'sb_publishable_test' },
      { client: f.client, origin: 'https://app.example' },
    ),
  };
}

function apiError(code: string, status = 400) {
  return new AuthApiError(`server says ${code} for someone@example.test`, status, code);
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AuthFailure ? error.kind : 'not-an-auth-failure';
  }
  return 'resolved';
}

afterEach(() => {
  vi.useRealTimers();
});

describe('error mapping', () => {
  it('maps auth errors to kinds', () => {
    expect(kindFromAuthError(apiError('invalid_credentials', 400))).toBe('invalid_credentials');
    expect(kindFromAuthError(apiError('email_not_confirmed'))).toBe('email_not_confirmed');
    expect(kindFromAuthError(apiError('weak_password', 422))).toBe('weak_password');
    expect(kindFromAuthError(apiError('same_password', 422))).toBe('same_password');
    expect(kindFromAuthError(apiError('email_address_invalid'))).toBe('invalid_input');
    expect(kindFromAuthError(apiError('over_request_rate_limit', 429))).toBe('rate_limited');
    expect(kindFromAuthError(apiError('anything', 429))).toBe('rate_limited');
    expect(kindFromAuthError(apiError('refresh_token_not_found', 400))).toBe('expired_session');
    expect(kindFromAuthError(apiError('mystery'))).toBe('unknown');
    expect(kindFromAuthError(new AuthRetryableFetchError('offline', 0))).toBe('network');
    expect(kindFromAuthError('not an object')).toBe('unknown');
  });

  it('maps database errors to kinds', () => {
    expect(kindFromDatabaseError({ message: 'JWT expired', code: 'PGRST301', status: 401 })).toBe(
      'expired_session',
    );
    expect(kindFromDatabaseError({ message: 'x', status: 401 })).toBe('expired_session');
    expect(kindFromDatabaseError({ message: 'not_authorised', code: '42501' })).toBe(
      'not_authorised',
    );
    expect(kindFromDatabaseError({ message: 'invalid_invitation', code: 'P0001' })).toBe(
      'invalid_invitation',
    );
    expect(kindFromDatabaseError({ message: 'TypeError: Failed to fetch', status: 0 })).toBe(
      'network',
    );
    expect(kindFromDatabaseError({ message: 'weird' })).toBe('unknown');
  });
});

describe('sign in, sign up, sign out', () => {
  it('signs in with the email and password and nothing else', async () => {
    const { api, auth } = adapter();
    await api.signIn('a@example.test', 'pw');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@example.test',
      password: 'pw',
    });
  });

  it('turns a sign-in error into a kind and never carries the server text', async () => {
    const { api } = adapter({ signIn: apiError('invalid_credentials') });
    try {
      await api.signIn('a@example.test', 'bad');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AuthFailure);
      expect((error as AuthFailure).kind).toBe('invalid_credentials');
      expect((error as AuthFailure).message).not.toContain('someone@example.test');
    }
  });

  it('sends the confirmation link back to this site', async () => {
    const { api, auth } = adapter();
    await api.signUp('a@example.test', 'a-long-password');
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'a@example.test',
      password: 'a-long-password',
      options: { emailRedirectTo: 'https://app.example/auth/callback' },
    });
  });

  it('reports an existing address like a new one (no account enumeration)', async () => {
    const { api } = adapter({ signUp: apiError('user_already_exists', 422) });
    await expect(api.signUp('taken@example.test', 'a-long-password')).resolves.toBeUndefined();
  });

  it('still reports weak passwords and rate limits on sign-up', async () => {
    expect(
      await kindOf(adapter({ signUp: apiError('weak_password', 422) }).api.signUp('a@b.co', 'x')),
    ).toBe('weak_password');
    expect(await kindOf(adapter({ signUp: apiError('x', 429) }).api.signUp('a@b.co', 'x'))).toBe(
      'rate_limited',
    );
  });

  it('signs out of this device only', async () => {
    const { api, auth } = adapter();
    await api.signOut();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('password reset', () => {
  it('sends the reset link back to this site', async () => {
    const { api, auth } = adapter();
    await api.requestPasswordReset('a@example.test');
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@example.test', {
      redirectTo: 'https://app.example/reset-password',
    });
  });

  it('shows no difference between a known and an unknown address', async () => {
    const { api } = adapter({ reset: apiError('user_not_found', 400) });
    await expect(api.requestPasswordReset('nobody@example.test')).resolves.toBeUndefined();
  });

  it('does report a network failure or a rate limit, which say nothing about the address', async () => {
    expect(
      await kindOf(
        adapter({ reset: new AuthRetryableFetchError('offline', 0) }).api.requestPasswordReset(
          'a@b.co',
        ),
      ),
    ).toBe('network');
    expect(
      await kindOf(adapter({ reset: apiError('x', 429) }).api.requestPasswordReset('a@b.co')),
    ).toBe('rate_limited');
  });

  it('changes the password for the signed-in (recovery) session', async () => {
    const { api, auth } = adapter();
    await api.updatePassword('a-new-long-password');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'a-new-long-password' });
    expect(
      await kindOf(adapter({ update: apiError('same_password', 422) }).api.updatePassword('x')),
    ).toBe('same_password');
  });
});

describe('session and account', () => {
  it('restores the signed-in user from the library, with no role', async () => {
    const { api } = adapter();
    expect(await api.getUser()).toEqual({ id: USER.id, email: USER.email });
  });

  it('returns null when there is no session', async () => {
    const { api } = adapter({ session: null });
    expect(await api.getUser()).toBeNull();
  });

  it('loads the profile and memberships for the person, through the user-scoped client', async () => {
    const { api, from, profile, memberships } = adapter({
      profile: { data: { user_id: USER.id, display_name: 'Ada', locale: 'en-IE' }, error: null },
      memberships: {
        data: [
          {
            household_id: HOUSEHOLD,
            role: 'READ_ONLY',
            households: { id: HOUSEHOLD, name: 'Home' },
          },
        ],
        error: null,
      },
    });
    const account = await api.loadAccount(USER);
    expect(account).toEqual({
      profile: { userId: USER.id, displayName: 'Ada', locale: 'en-IE' },
      memberships: [{ householdId: HOUSEHOLD, name: 'Home', role: 'READ_ONLY' }],
    });
    expect(from).toHaveBeenCalledWith('user_profiles');
    expect(from).toHaveBeenCalledWith('household_members');
    expect(profile.eq).toHaveBeenCalledWith('user_id', USER.id);
    expect(memberships.eq).toHaveBeenCalledWith('user_id', USER.id);
  });

  it('accepts the household as a one-item array and a missing profile row', async () => {
    const { api } = adapter({
      profile: { data: null, error: null },
      memberships: {
        data: [
          { household_id: HOUSEHOLD, role: 'ADMIN', households: [{ id: HOUSEHOLD, name: 'Home' }] },
        ],
        error: null,
      },
    });
    const account = await api.loadAccount(USER);
    expect(account.profile).toEqual({ userId: USER.id, displayName: null, locale: null });
    expect(account.memberships[0]?.role).toBe('ADMIN');
  });

  it('has no memberships for a new person (the "waiting for an invitation" state)', async () => {
    const { api } = adapter();
    expect((await api.loadAccount(USER)).memberships).toEqual([]);
  });

  it('refuses a role the app does not know instead of trusting it', async () => {
    const { api } = adapter({
      memberships: {
        data: [
          {
            household_id: HOUSEHOLD,
            role: 'SUPERUSER',
            households: { id: HOUSEHOLD, name: 'Home' },
          },
        ],
        error: null,
      },
    });
    expect(await kindOf(api.loadAccount(USER))).toBe('unknown');
  });

  it('refuses a malformed row', async () => {
    const { api } = adapter({ memberships: { data: [{ role: 'ADMIN' }], error: null } });
    expect(await kindOf(api.loadAccount(USER))).toBe('unknown');
  });

  it('reports an expired token as an expired session', async () => {
    const { api } = adapter({
      profile: { data: null, error: { message: 'JWT expired', code: 'PGRST301', status: 401 } },
    });
    expect(await kindOf(api.loadAccount(USER))).toBe('expired_session');
  });
});

describe('invitations', () => {
  it('calls the database function with the token as the signed-in user', async () => {
    const { api, rpc } = adapter();
    await api.acceptInvitation(TOKEN);
    expect(rpc).toHaveBeenCalledWith('accept_invitation', { p_token: TOKEN });
  });

  it('does not call the database for a token of the wrong shape', async () => {
    const { api, rpc } = adapter();
    expect(await kindOf(api.acceptInvitation('not-a-token'))).toBe('invalid_invitation');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('gives one kind for every refusal of the database function', async () => {
    const { api } = adapter({ rpc: { message: 'invalid_invitation', code: 'P0001' } });
    expect(await kindOf(api.acceptInvitation(TOKEN))).toBe('invalid_invitation');
    const denied = adapter({ rpc: { message: 'not_authorised', code: '42501' } });
    expect(await kindOf(denied.api.acceptInvitation(TOKEN))).toBe('not_authorised');
  });
});

describe('session events', () => {
  async function events(f: ReturnType<typeof adapter>, send: string[]) {
    vi.useFakeTimers();
    const received: string[] = [];
    f.api.subscribe((event) => received.push(event.type));
    for (const name of send) f.emit(name);
    await vi.runAllTimersAsync();
    return received;
  }

  it('reports sign-in and recovery as signed in', async () => {
    expect(await events(adapter(), ['SIGNED_IN', 'PASSWORD_RECOVERY'])).toEqual([
      'signed_in',
      'signed_in',
    ]);
  });

  it('ignores the startup and refresh events', async () => {
    expect(await events(adapter(), ['INITIAL_SESSION', 'TOKEN_REFRESHED', 'USER_UPDATED'])).toEqual(
      [],
    );
  });

  it('treats a sign-out the person did not ask for as an expired session', async () => {
    expect(await events(adapter(), ['SIGNED_OUT'])).toEqual(['expired']);
  });

  it('treats a sign-out the person asked for as a plain sign-out', async () => {
    const f = adapter();
    vi.useFakeTimers();
    const received: string[] = [];
    f.api.subscribe((event) => received.push(event.type));
    f.auth.signOut.mockImplementationOnce(() => {
      f.emit('SIGNED_OUT');
      return Promise.resolve({ error: null });
    });
    await f.api.signOut();
    await vi.runAllTimersAsync();
    expect(received).toEqual(['signed_out']);
  });

  it('stops listening when unsubscribed', () => {
    const f = adapter();
    const off = f.api.subscribe(() => undefined);
    off();
    expect(f.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
  });
});
