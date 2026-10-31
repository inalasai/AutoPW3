import { describe, expect, it } from 'vitest';
import { InMemoryRepository } from '../db/repository';
import type { Env } from '../env';
import { handleApiRequest } from '../lib/app';
import { InMemoryIdempotencyStore } from '../lib/idempotency';
import { InMemoryRateLimiter } from '../lib/rate-limiter';
import { MockTeslaClient } from '../providers/tesla/mock-adapter';
import { InMemoryOAuthStateStore } from '../providers/tesla/oauth';
import { InMemoryTokenStore } from '../services/tokens/store';
import { createTestJwt, getTestAuthKeys } from '../test/jwt-helpers';

// Helper for strictly typed responses in tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonOf<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function makeTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    SUPABASE_URL: 'https://project.supabase.co',
    ALLOWED_ORIGINS: 'http://localhost:5173,https://app.autopw3.com',
    APP_BASE_URL: 'http://localhost:5173',
    TESLA_CLIENT_ID: 'mock-tesla-client-id',
    TESLA_CLIENT_SECRET: 'mock-tesla-client-secret',
    TESLA_REDIRECT_URI: 'https://app.autopw3.com/provider/tesla/callback',
    TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    ASSETS: {
      fetch: (): Promise<Response> => Promise.resolve(new Response('OK')),
      connect: () => {
        throw new Error('not used');
      },
    } as unknown as Fetcher,
    ...overrides,
  };
}

async function makeTestContext(envOverrides: Partial<Env> = {}) {
  const keys = await getTestAuthKeys();
  const repo = new InMemoryRepository();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const rateLimiter = new InMemoryRateLimiter();
  const tokenStore = new InMemoryTokenStore(
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  );
  const oauthStateStore = new InMemoryOAuthStateStore();
  const teslaClient = new MockTeslaClient();
  const env = makeTestEnv(envOverrides);
  const jwtConfig = {
    supabaseUrl: env.SUPABASE_URL,
    testKeySet: keys.publicKey,
  };

  const adminToken = await createTestJwt({ userId: '44444444-4444-4444-8444-444444444444' }, keys);
  const rwToken = await createTestJwt({ userId: '55555555-5555-4555-8555-555555555555' }, keys);
  const roToken = await createTestJwt({ userId: '66666666-6666-4666-8666-666666666666' }, keys);

  const mockFetch: typeof fetch = async (url) => {
    if (String(url).includes('oauth2/v3/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'mock-tesla-access-token',
          refresh_token: 'mock-tesla-refresh-token',
          expires_in: 28800,
          token_type: 'Bearer',
          scope: 'openid offline_access energy_device_data',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return fetch(url);
  };

  const request = (path: string, init: RequestInit = {}, token?: string) => {
    const headers = new Headers(init.headers);
    if (token) {
      headers.set('authorization', `Bearer ${token}`);
    }
    return handleApiRequest(new Request(`http://localhost${path}`, { ...init, headers }), env, {
      repo,
      idempotencyStore,
      rateLimiter,
      jwtConfig,
      teslaClient,
      tokenStore,
      oauthStateStore,
      fetcher: mockFetch,
    });
  };

  return {
    env,
    repo,
    tokenStore,
    oauthStateStore,
    teslaClient,
    adminToken,
    rwToken,
    roToken,
    request,
    householdId: '11111111-1111-4111-8111-111111111111',
    siteId: '22222222-2222-4222-8222-222222222222',
  };
}

describe('Tesla Routes & OAuth Flow Integration', () => {
  describe('POST /households/{hid}/provider/tesla/connect', () => {
    it('allows ADMIN and returns authorizeUrl containing state and PKCE challenge', async () => {
      const { request, adminToken, householdId } = await makeTestContext();
      const res = await request(
        `/api/v1/households/${householdId}/provider/tesla/connect`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enableControls: true }),
        },
        adminToken,
      );

      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.authorizeUrl).toBeTruthy();
      expect(body.authorizeUrl).toContain('https://auth.tesla.com/oauth2/v3/authorize');
      expect(body.authorizeUrl).toContain('client_id=mock-tesla-client-id');
      expect(body.authorizeUrl).toContain('code_challenge_method=S256');
      expect(body.authorizeUrl).toContain('energy_cmds');
    });

    it('rejects READ_ONLY and READ_WRITE with 403 FORBIDDEN', async () => {
      const { request, roToken, rwToken, householdId } = await makeTestContext();

      const resRo = await request(
        `/api/v1/households/${householdId}/provider/tesla/connect`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enableControls: false }),
        },
        roToken,
      );
      expect(resRo.status).toBe(403);

      const resRw = await request(
        `/api/v1/households/${householdId}/provider/tesla/connect`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enableControls: false }),
        },
        rwToken,
      );
      expect(resRw.status).toBe(403);
    });
  });

  describe('GET /provider/tesla/callback', () => {
    it('consumes state, saves encrypted tokens, and redirects with 302', async () => {
      const { request, oauthStateStore, tokenStore, repo, householdId } = await makeTestContext();
      const state = 'test-oauth-state-123';
      await oauthStateStore.saveState({
        state,
        userId: '44444444-4444-4444-8444-444444444444',
        householdId,
        codeVerifier: 'mock-code-verifier-string',
        expiresAt: Date.now() + 600_000,
      });

      const res = await request(
        `/api/v1/provider/tesla/callback?code=mock-tesla-auth-code&state=${state}`,
      );

      // Verify 302 redirect
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain(`/settings?tesla=connected&hid=${householdId}`);

      // Verify tokens were encrypted and saved in store
      const tokens = await tokenStore.getTokens(householdId);
      expect(tokens).not.toBeNull();
      expect(tokens?.accessToken).toBeTruthy();

      // Verify repo link status updated to ACTIVE
      const linkStatus = await repo.getTeslaLink(householdId);
      expect(linkStatus.state).toBe('ACTIVE');
    });

    it('rejects reused or invalid state with 422 VALIDATION_FAILED', async () => {
      const { request } = await makeTestContext();
      const res = await request(
        '/api/v1/provider/tesla/callback?code=mock-code&state=non-existent-state',
      );
      expect(res.status).toBe(422);
      const body = await jsonOf(res);
      expect(body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('GET /households/{hid}/provider/tesla (Status)', () => {
    it('returns status and NEVER exposes any token material', async () => {
      const { request, roToken, householdId, repo } = await makeTestContext();
      await repo.setTeslaLink(householdId, {
        state: 'ACTIVE',
        scopes: ['openid', 'offline_access', 'energy_device_data'],
        lastRefreshAt: '2026-06-15T10:00:00Z',
      });

      const res = await request(`/api/v1/households/${householdId}/provider/tesla`, {}, roToken);
      expect(res.status).toBe(200);
      const body = await jsonOf(res);

      expect(body.state).toBe('ACTIVE');
      expect(body.scopes).toContain('energy_device_data');
      expect(body.lastRefreshAt).toBe('2026-06-15T10:00:00Z');

      // Zero token material check (acceptance criterion)
      expect(body.accessToken).toBeUndefined();
      expect(body.access_token).toBeUndefined();
      expect(body.refreshToken).toBeUndefined();
      expect(body.refresh_token).toBeUndefined();
      expect(body.token).toBeUndefined();
      expect(body.secret).toBeUndefined();
    });
  });

  describe('GET /households/{hid}/provider/tesla/discovered-sites', () => {
    it('allows ADMIN to query discovered sites when active tokens exist', async () => {
      const { request, adminToken, householdId, tokenStore } = await makeTestContext();
      await tokenStore.saveTokens(householdId, {
        accessToken: 'active-mock-token',
        refreshToken: 'active-refresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 28800,
        tokenType: 'Bearer',
        scope: 'openid energy_device_data',
        regionBaseUrl: 'https://fleet-api.prd.eu.vn.cloud.tesla.com',
      });

      const res = await request(
        `/api/v1/households/${householdId}/provider/tesla/discovered-sites`,
        {},
        adminToken,
      );

      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.items[0].providerSiteId).toBeTruthy();
    });

    it('rejects READ_ONLY with 403 FORBIDDEN', async () => {
      const { request, roToken, householdId } = await makeTestContext();
      const res = await request(
        `/api/v1/households/${householdId}/provider/tesla/discovered-sites`,
        {},
        roToken,
      );
      expect(res.status).toBe(403);
    });
  });

  describe('POST /households/{hid}/sites', () => {
    it('allows ADMIN to create and link a Tesla site to the household', async () => {
      const { request, adminToken, householdId } = await makeTestContext();
      const res = await request(
        `/api/v1/households/${householdId}/sites`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            provider: 'TESLA',
            providerSiteId: '9876543210',
            name: 'Holiday Home Powerwall',
            timezone: 'Europe/Dublin',
          }),
        },
        adminToken,
      );

      expect(res.status).toBe(201);
      const body = await jsonOf(res);
      expect(body.provider).toBe('TESLA');
      expect(body.name).toBe('Holiday Home Powerwall');
      expect(body.timezone).toBe('Europe/Dublin');
      expect(body.connectionState).toBe('LIVE');
    });
  });

  describe('DELETE /households/{hid}/provider/tesla', () => {
    it('allows ADMIN to disconnect Tesla, deletes credentials, and marks sites DISCONNECTED', async () => {
      const { request, adminToken, householdId, tokenStore, repo, siteId } =
        await makeTestContext();

      // Seed active connection and site
      await tokenStore.saveTokens(householdId, {
        accessToken: 'active-mock-token',
        refreshToken: 'active-refresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 28800,
        tokenType: 'Bearer',
        scope: 'openid energy_device_data',
        regionBaseUrl: 'https://fleet-api.prd.eu.vn.cloud.tesla.com',
      });
      await repo.setTeslaLink(householdId, {
        state: 'ACTIVE',
        scopes: ['openid', 'energy_device_data'],
        lastRefreshAt: new Date().toISOString(),
      });

      const res = await request(
        `/api/v1/households/${householdId}/provider/tesla`,
        { method: 'DELETE' },
        adminToken,
      );
      expect(res.status).toBe(204);

      // Verify tokens deleted
      expect(await tokenStore.getTokens(householdId)).toBeNull();

      // Verify link status is NOT_CONNECTED
      const link = await repo.getTeslaLink(householdId);
      expect(link.state).toBe('NOT_CONNECTED');

      // Verify site connectionState is now DISCONNECTED
      const site = await repo.getSite(siteId);
      expect(site?.connectionState).toBe('DISCONNECTED');
    });
  });
});
