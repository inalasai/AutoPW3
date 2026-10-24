import { describe, expect, it } from 'vitest';
import { AuthFailure } from '../types';
import {
  MOCK_INVITE_TOKEN,
  MOCK_PASSWORD,
  MOCK_SESSION_STORAGE_KEY,
  createMockAuthClient,
} from './mock-client';

/** A small in-memory stand-in for `localStorage`. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

async function failureKind(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AuthFailure ? error.kind : 'other';
  }
  return 'resolved';
}

describe('mock auth client', () => {
  it('signs in a known account and loads the role the "server" holds', async () => {
    const client = createMockAuthClient({ storage: null });
    await client.signIn('Admin@Example.test', MOCK_PASSWORD);
    const user = await client.getUser();
    expect(user?.email).toBe('admin@example.test');
    const account = await client.loadAccount(user!);
    expect(account.memberships.map((m) => m.role)).toEqual(['ADMIN']);
  });

  it('gives the same failure for a wrong password and an unknown address', async () => {
    const client = createMockAuthClient({ storage: null });
    expect(await failureKind(client.signIn('admin@example.test', 'wrong-password-1'))).toBe(
      'invalid_credentials',
    );
    expect(await failureKind(client.signIn('nobody@example.test', MOCK_PASSWORD))).toBe(
      'invalid_credentials',
    );
  });

  it('registers an existing address without any visible difference', async () => {
    const client = createMockAuthClient({ storage: null });
    await expect(
      client.signUp('admin@example.test', 'another-long-password'),
    ).resolves.toBeUndefined();
    // The existing account is untouched: the old password still works, the new one does not.
    expect(await failureKind(client.signIn('admin@example.test', 'another-long-password'))).toBe(
      'invalid_credentials',
    );
    await expect(client.signIn('admin@example.test', MOCK_PASSWORD)).resolves.toBeUndefined();
  });

  it('can require email confirmation before sign-in', async () => {
    const client = createMockAuthClient({ storage: null, requireConfirmation: true });
    await client.signUp('new@example.test', 'a-long-password-1');
    expect(await client.getUser()).toBeNull();
    expect(await failureKind(client.signIn('new@example.test', 'a-long-password-1'))).toBe(
      'email_not_confirmed',
    );
    client.confirmEmail('new@example.test');
    await expect(client.signIn('new@example.test', 'a-long-password-1')).resolves.toBeUndefined();
  });

  it('enforces the password length', async () => {
    const client = createMockAuthClient({ storage: null });
    expect(await failureKind(client.signUp('x@example.test', 'short'))).toBe('weak_password');
  });

  it('holds a role in memory only: the browser stores a signed user id and nothing else', async () => {
    const storage = memoryStorage();
    const client = createMockAuthClient({ storage });
    await client.signIn('readonly@example.test', MOCK_PASSWORD);
    expect(storage.length).toBe(1);
    const stored = storage.getItem(MOCK_SESSION_STORAGE_KEY) ?? '';
    expect(stored).toMatch(/^mock\.[0-9a-f-]{36}\.[0-9a-f]{8}$/);
    expect(stored).not.toMatch(/READ_|ADMIN/);
  });

  it('restores a session from storage', async () => {
    const storage = memoryStorage();
    await createMockAuthClient({ storage }).signIn('readwrite@example.test', MOCK_PASSWORD);
    const again = createMockAuthClient({ storage });
    expect((await again.getUser())?.email).toBe('readwrite@example.test');
  });

  it('rejects a stored token whose user id was edited (as a forged JWT would be)', async () => {
    const storage = memoryStorage();
    await createMockAuthClient({ storage }).signIn('readonly@example.test', MOCK_PASSWORD);
    const admin = createMockAuthClient({ storage: null });
    await admin.signIn('admin@example.test', MOCK_PASSWORD);
    const adminId = (await admin.getUser())?.id ?? '';
    const stored = storage.getItem(MOCK_SESSION_STORAGE_KEY) ?? '';
    const forged = stored.replace(/mock\.[0-9a-f-]{36}/, `mock.${adminId}`);
    expect(forged).not.toBe(stored);
    storage.setItem(MOCK_SESSION_STORAGE_KEY, forged);
    expect(await createMockAuthClient({ storage }).getUser()).toBeNull();
  });

  it('ignores an unsigned or malformed token', async () => {
    for (const token of ['ADMIN', 'mock.x', 'mock.a.b.c', '{"role":"ADMIN"}']) {
      const storage = memoryStorage({ [MOCK_SESSION_STORAGE_KEY]: token });
      expect(await createMockAuthClient({ storage }).getUser()).toBeNull();
    }
  });

  it('ends the session on expiry: the next request fails as expired', async () => {
    const client = createMockAuthClient({ storage: null, signedInAs: 'admin@example.test' });
    const user = (await client.getUser())!;
    const events: string[] = [];
    client.subscribe((event) => events.push(event.type));
    client.expireSession();
    expect(events).toEqual(['expired']);
    expect(await client.getUser()).toBeNull();
    expect(await failureKind(client.loadAccount(user))).toBe('expired_session');
  });

  it('accepts an invitation once, then refuses it', async () => {
    const client = createMockAuthClient({ storage: null, signedInAs: 'nohome@example.test' });
    const user = (await client.getUser())!;
    await client.acceptInvitation(MOCK_INVITE_TOKEN);
    expect((await client.loadAccount(user)).memberships.map((m) => m.role)).toEqual(['READ_ONLY']);
    expect(await failureKind(client.acceptInvitation(MOCK_INVITE_TOKEN))).toBe(
      'invalid_invitation',
    );
  });

  it('refuses a malformed or unknown invitation with the same failure', async () => {
    const client = createMockAuthClient({ storage: null, signedInAs: 'nohome@example.test' });
    expect(await failureKind(client.acceptInvitation('nope'))).toBe('invalid_invitation');
    expect(await failureKind(client.acceptInvitation('cd'.repeat(32)))).toBe('invalid_invitation');
  });

  it('needs a session to accept an invitation', async () => {
    const client = createMockAuthClient({ storage: null });
    expect(await failureKind(client.acceptInvitation(MOCK_INVITE_TOKEN))).toBe('expired_session');
  });

  it('keeps a password reset request without revealing whether the address exists', async () => {
    const client = createMockAuthClient({ storage: null });
    await client.requestPasswordReset('admin@example.test');
    await client.requestPasswordReset('nobody@example.test');
    expect(client.resetRequests).toEqual(['admin@example.test', 'nobody@example.test']);
  });
});
