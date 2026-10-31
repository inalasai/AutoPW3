import { describe, expect, it, vi } from 'vitest';
import type { DecryptedTokens } from './store';
import { SupabaseOAuthStateStore, SupabaseTokenStore } from './supabase-store';

function createEncryptionKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

function getRequestBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe('SupabaseTokenStore', () => {
  it('round-trips only an encrypted token envelope and uses the database lease functions', async () => {
    const householdId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const tokens: DecryptedTokens = {
      accessToken: `access-${crypto.randomUUID()}`,
      refreshToken: `refresh-${crypto.randomUUID()}`,
      expiresAt: now + 3600,
      tokenType: 'Bearer',
      scope: 'openid energy_device_data',
      regionBaseUrl: 'https://fleet-api.example.invalid',
    };
    let saved: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/worker_save_tesla_credentials')) {
        saved = getRequestBody(init);
        return new Response('true', { status: 200 });
      }
      if (url.endsWith('/worker_get_tesla_credentials')) {
        return new Response(
          JSON.stringify([
            {
              nonce: saved?.['p_nonce'],
              ciphertext: saved?.['p_ciphertext'],
              version: saved?.['p_version'],
              scopes: saved?.['p_scopes'],
              fleet_api_base_url: saved?.['p_fleet_api_base_url'],
              access_expires_at: new Date(tokens.expiresAt * 1000).toISOString(),
              status: 'ACTIVE',
            },
          ]),
          { status: 200 },
        );
      }
      return new Response('true', { status: 200 });
    });
    const store = new SupabaseTokenStore(
      'https://example.supabase.co',
      crypto.randomUUID(),
      createEncryptionKey(),
      7,
      fetcher,
    );

    await store.saveTokens(householdId, tokens);
    expect(saved?.['p_version']).toBe(7);
    expect(saved?.['p_ciphertext']).not.toContain(tokens.accessToken);
    expect(await store.getTokens(householdId)).toEqual(tokens);

    expect(await store.acquireRefreshLock(householdId, 30_000)).toBe(true);
    const lockCall = fetcher.mock.calls.find(([url]) =>
      String(url).endsWith('/worker_acquire_lock'),
    );
    expect(getRequestBody(lockCall?.[1])).toMatchObject({
      p_key: `token:${householdId}`,
      p_lease_seconds: 30,
    });
    await store.releaseRefreshLock(householdId);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/worker_release_lock'))).toBe(
      true,
    );
  });

  it('rejects a decrypted credential envelope bound to a different household', async () => {
    const requestedHousehold = crypto.randomUUID();
    const foreignHousehold = crypto.randomUUID();
    const encryptionKey = createEncryptionKey();
    const saved: Record<string, unknown> = {};
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/worker_save_tesla_credentials')) {
        Object.assign(saved, getRequestBody(init));
        return new Response('true', { status: 200 });
      }
      if (url.endsWith('/worker_get_tesla_credentials')) {
        return new Response(
          JSON.stringify([
            {
              nonce: saved['p_nonce'],
              ciphertext: saved['p_ciphertext'],
              version: saved['p_version'],
              scopes: [],
              fleet_api_base_url: 'https://fleet-api.example.invalid',
              access_expires_at: new Date(Date.now() + 60_000).toISOString(),
              status: 'ACTIVE',
            },
          ]),
          { status: 200 },
        );
      }
      return new Response('true', { status: 200 });
    });
    const store = new SupabaseTokenStore(
      'https://example.supabase.co',
      crypto.randomUUID(),
      encryptionKey,
      1,
      fetcher,
    );
    await store.saveTokens(foreignHousehold, {
      accessToken: `access-${crypto.randomUUID()}`,
      refreshToken: `refresh-${crypto.randomUUID()}`,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      tokenType: 'Bearer',
      scope: '',
      regionBaseUrl: 'https://fleet-api.example.invalid',
    });

    await expect(store.getTokens(requestedHousehold)).rejects.toThrow(
      'Encrypted Tesla credential record is invalid',
    );
  });
});

describe('SupabaseOAuthStateStore', () => {
  it('encrypts the verifier and consumes durable state with its tenant binding', async () => {
    const payload = {
      state: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      householdId: crypto.randomUUID(),
      codeVerifier: `verifier-${crypto.randomUUID()}-${crypto.randomUUID()}`,
      expiresAt: Date.now() + 5 * 60 * 1000,
    };
    let saved: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/worker_save_oauth_state')) {
        saved = getRequestBody(init);
        return new Response('true', { status: 200 });
      }
      return new Response(
        JSON.stringify([
          {
            household_id: payload.householdId,
            user_id: payload.userId,
            pkce_verifier_ciphertext: saved?.['p_pkce_verifier_ciphertext'],
            pkce_nonce: saved?.['p_pkce_nonce'],
            expires_at: new Date(payload.expiresAt).toISOString(),
          },
        ]),
        { status: 200 },
      );
    });
    const store = new SupabaseOAuthStateStore(
      'https://example.supabase.co',
      crypto.randomUUID(),
      { 1: createEncryptionKey(), 2: createEncryptionKey() },
      2,
      fetcher,
    );

    await store.saveState(payload);
    expect(saved?.['p_state']).toBe(payload.state);
    expect(saved?.['p_pkce_verifier_ciphertext']).not.toContain(payload.codeVerifier);
    await expect(store.consumeState(payload.state)).resolves.toEqual(payload);
  });
});
