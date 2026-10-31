import { describe, expect, it } from 'vitest';
import { InMemoryRepository } from './db/repository';
import type { Env } from './env';
import worker from './index';
import { handleApiRequest } from './lib/app';
import { InMemoryIdempotencyStore } from './lib/idempotency';
import { InMemoryRateLimiter } from './lib/rate-limiter';
import { createHs256Jwt, createTestJwt, getTestAuthKeys } from './test/jwt-helpers';

function makeTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    LOCAL_MOCKS: 'true',
    SUPABASE_URL: 'https://project.supabase.co',
    TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    ALLOWED_ORIGINS: 'http://localhost:5173,https://app.autopw3.com',
    APP_BASE_URL: 'http://localhost:5173',
    ASSETS: {
      fetch: (_input: RequestInfo | URL): Promise<Response> => {
        return Promise.resolve(new Response('<html>SPA</html>', { status: 200 }));
      },
      connect: () => {
        throw new Error('not used');
      },
    } as unknown as Fetcher,
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonOf<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function makeTestContext() {
  const keys = await getTestAuthKeys();
  const repo = new InMemoryRepository();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const rateLimiter = new InMemoryRateLimiter();
  const env = makeTestEnv();
  const jwtConfig = {
    supabaseUrl: env.SUPABASE_URL,
    testKeySet: keys.publicKey,
  };

  const adminToken = await createTestJwt({ userId: '44444444-4444-4444-8444-444444444444' }, keys);
  const rwToken = await createTestJwt({ userId: '55555555-5555-4555-8555-555555555555' }, keys);
  const roToken = await createTestJwt({ userId: '66666666-6666-4666-8666-666666666666' }, keys);
  const outsiderToken = await createTestJwt(
    { userId: '77777777-7777-4777-8777-777777777777' },
    keys,
  );

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
    });
  };

  return {
    env,
    repo,
    idempotencyStore,
    rateLimiter,
    keys,
    adminToken,
    rwToken,
    roToken,
    outsiderToken,
    request,
    householdId: '11111111-1111-4111-8111-111111111111',
    siteId: '22222222-2222-4222-8222-222222222222',
    ruleId: '33333333-3333-4333-8333-333333333333',
  };
}

describe('Cloudflare Worker API Core', () => {
  it('constructs authenticated repository clients per request and preserves each verified actor JWT', async () => {
    const keys = await getTestAuthKeys();
    const userA = '11111111-aaaa-4111-8111-111111111111';
    const userB = '22222222-bbbb-4222-8222-222222222222';
    const tokenA = await createTestJwt({ userId: userA }, keys);
    const tokenB = await createTestJwt({ userId: userB }, keys);
    const seen: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push(headers.get('authorization') ?? '');
      expect(headers.get('apikey')).toBe('public-anon-key');
      const url = new URL(String(input));
      if (url.pathname.endsWith('/user_profiles')) {
        const actor = decodeURIComponent(url.searchParams.get('user_id') ?? '').replace('eq.', '');
        return Response.json([{ user_id: actor, display_name: `profile-${actor}`, locale: null }]);
      }
      if (url.pathname.endsWith('/household_members')) {
        return Response.json([]);
      }
      throw new Error('unexpected database endpoint');
    };
    const env = makeTestEnv({ SUPABASE_ANON_KEY: 'public-anon-key' });
    const request = (token: string) =>
      handleApiRequest(
        new Request('http://localhost/api/v1/me', {
          headers: { authorization: `Bearer ${token}` },
        }),
        env,
        { jwtConfig: { supabaseUrl: env.SUPABASE_URL, testKeySet: keys.publicKey }, fetcher },
      );

    const responseA = await request(tokenA);
    const responseB = await request(tokenB);
    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    expect((await jsonOf<{ profile: { userId: string } }>(responseA)).profile.userId).toBe(userA);
    expect((await jsonOf<{ profile: { userId: string } }>(responseB)).profile.userId).toBe(userB);
    expect(seen).toEqual([
      `Bearer ${tokenA}`,
      `Bearer ${tokenA}`,
      `Bearer ${tokenB}`,
      `Bearer ${tokenB}`,
    ]);
  });

  describe('deployment fail-closed behavior', () => {
    it.each(['staging', 'production'])(
      '%s does not serve API requests from in-memory defaults',
      async (environment) => {
        const env = makeTestEnv({
          ENVIRONMENT: environment,
          SUPABASE_ANON_KEY: 'test-public-value',
          ALLOWED_ORIGINS: 'https://app.autopw3.com',
        });

        const response = await handleApiRequest(
          new Request('https://app.autopw3.com/api/v1/health'),
          env,
        );

        expect(response.status).toBe(502);
        const body = await jsonOf(response);
        expect(body.error.code).toBe('PROVIDER_UNAVAILABLE');
        expect(body.error.message).toContain('durable storage');
      },
    );

    it.each(['preview', 'local'])(
      '%s does not silently select process-local stores without explicit local mock configuration',
      async (environment) => {
        const env = makeTestEnv({
          ENVIRONMENT: environment,
          LOCAL_MOCKS: undefined,
          ALLOWED_ORIGINS: 'https://app.autopw3.com',
        });

        const response = await handleApiRequest(
          new Request('https://app.autopw3.com/api/v1/health'),
          env,
        );

        expect(response.status).toBe(502);
        expect((await jsonOf(response)).error.code).toBe('PROVIDER_UNAVAILABLE');
      },
    );

    it('allows local API mocks only with LOCAL_MOCKS=true', async () => {
      const env = makeTestEnv({ ENVIRONMENT: 'local', LOCAL_MOCKS: 'true' });
      const response = await handleApiRequest(new Request('http://localhost/api/v1/health'), env);

      expect(response.status).toBe(200);
    });
  });

  describe('scheduled job safety', () => {
    it('refuses production cron execution until durable storage is configured', () => {
      const env = makeTestEnv({ ENVIRONMENT: 'production' });
      const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;

      expect(() => worker.scheduled({} as ScheduledController, env, ctx)).toThrow(
        'Scheduled jobs are disabled until durable storage is configured',
      );
    });

    it('refuses local cron execution unless local mocks are explicitly enabled', () => {
      const env = makeTestEnv({ ENVIRONMENT: 'local', LOCAL_MOCKS: undefined });
      const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;

      expect(() => worker.scheduled({} as ScheduledController, env, ctx)).toThrow(
        'Scheduled local mocks require LOCAL_MOCKS=true',
      );
    });

    it('refuses local cron execution when the encryption key is absent', () => {
      const env = makeTestEnv({
        ENVIRONMENT: 'local',
        LOCAL_MOCKS: 'true',
        TOKEN_ENCRYPTION_KEY: undefined,
      });
      const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;

      expect(() => worker.scheduled({} as ScheduledController, env, ctx)).toThrow(
        'Scheduled jobs require TOKEN_ENCRYPTION_KEY',
      );
    });
  });

  describe('Health and Public Endpoints', () => {
    it('GET /api/v1/health returns { status: "ok" } without auth', async () => {
      const { request } = await makeTestContext();
      const res = await request('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.headers.get('x-request-id')).toBeTruthy();
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = await jsonOf(res);
      expect(body).toEqual({ status: 'ok' });
    });

    it('rejects unsupported HTTP methods on /health with 405', async () => {
      const { request } = await makeTestContext();
      const res = await request('/api/v1/health', { method: 'POST' });
      expect(res.status).toBe(405);
      const body = await jsonOf(res);
      expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
    });

    it('returns 404 for unknown /api/v1 paths', async () => {
      const { request } = await makeTestContext();
      const res = await request('/api/v1/non-existent-endpoint');
      expect(res.status).toBe(404);
      const body = await jsonOf(res);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('delegates non-API paths to static assets', async () => {
      const { request } = await makeTestContext();
      const res = await request('/live');
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('<html>SPA</html>');
    });
  });

  describe('CORS Enforcement', () => {
    it('handles OPTIONS preflight for allowlisted origin', async () => {
      const { request } = await makeTestContext();
      const res = await request('/api/v1/me', {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:5173' },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
      expect(res.headers.get('access-control-allow-methods')).toContain('GET');
      expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
    });

    it('rejects OPTIONS preflight for non-allowlisted origin with 403', async () => {
      const { request } = await makeTestContext();
      const res = await request('/api/v1/me', {
        method: 'OPTIONS',
        headers: { origin: 'https://malicious-site.com' },
      });
      expect(res.status).toBe(403);
      const body = await jsonOf(res);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('attaches Access-Control-Allow-Origin header to valid cross-origin responses', async () => {
      const { request } = await makeTestContext();
      const res = await request('/api/v1/health', {
        headers: { origin: 'http://localhost:5173' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    });
  });

  describe('Request Size Limit Guard', () => {
    it('rejects request body exceeding 64 KiB with 413 PAYLOAD_TOO_LARGE', async () => {
      const { request, adminToken, householdId } = await makeTestContext();
      const hugeBody = JSON.stringify({
        name: 'Huge Tariff',
        data: 'a'.repeat(70_000),
      });

      const res = await request(
        `/api/v1/households/${householdId}/tariffs`,
        {
          method: 'POST',
          body: hugeBody,
          headers: {
            'content-type': 'application/json',
            'content-length': String(new TextEncoder().encode(hugeBody).length),
          },
        },
        adminToken,
      );
      expect(res.status).toBe(413);
      const body = await jsonOf(res);
      expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('JWT Verification & Algorithm Guards (D-009)', () => {
    it('returns 401 UNAUTHENTICATED when Authorization header is missing', async () => {
      const { request } = await makeTestContext();
      const res = await request('/api/v1/me');
      expect(res.status).toBe(401);
      const body = await jsonOf(res);
      expect(body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 401 UNAUTHENTICATED when Authorization format is not Bearer', async () => {
      const { request } = await makeTestContext();
      const res = await request('/api/v1/me', {
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });
      expect(res.status).toBe(401);
      const body = await jsonOf(res);
      expect(body.error.code).toBe('UNAUTHENTICATED');
    });

    it('strictly refuses HS256 tokens per D-009 with 401', async () => {
      const { request } = await makeTestContext();
      const hsToken = await createHs256Jwt();
      const res = await request('/api/v1/me', {}, hsToken);
      expect(res.status).toBe(401);
      const body = await jsonOf(res);
      expect(body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects expired JWTs with 401', async () => {
      const { request, keys } = await makeTestContext();
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      const expiredToken = await createTestJwt({ exp: pastTime }, keys);
      const res = await request('/api/v1/me', {}, expiredToken);
      expect(res.status).toBe(401);
      const body = await jsonOf(res);
      expect(body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('Identity & Households Routes', () => {
    it('GET /api/v1/me returns user profile and memberships', async () => {
      const { request, adminToken, householdId } = await makeTestContext();
      const res = await request('/api/v1/me', {}, adminToken);
      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.profile.userId).toBe('44444444-4444-4444-8444-444444444444');
      expect(body.memberships).toHaveLength(1);
      expect(body.memberships[0].householdId).toBe(householdId);
      expect(body.memberships[0].role).toBe('ADMIN');
    });

    it('GET /api/v1/households/{hid} returns household details for member', async () => {
      const { request, roToken, householdId } = await makeTestContext();
      const res = await request(`/api/v1/households/${householdId}`, {}, roToken);
      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.id).toBe(householdId);
      expect(body.name).toBe('Demo Household');
      expect(body.timezone).toBe('Europe/Dublin');
    });

    it('GET /api/v1/households/{hid}/members allows ADMIN and returns member list', async () => {
      const { request, adminToken, householdId } = await makeTestContext();
      const res = await request(`/api/v1/households/${householdId}/members`, {}, adminToken);
      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.items.length).toBeGreaterThanOrEqual(3);
    });

    it('GET /api/v1/households/{hid}/members rejects READ_ONLY and READ_WRITE with 403', async () => {
      const { request, roToken, rwToken, householdId } = await makeTestContext();
      const resRo = await request(`/api/v1/households/${householdId}/members`, {}, roToken);
      expect(resRo.status).toBe(403);

      const resRw = await request(`/api/v1/households/${householdId}/members`, {}, rwToken);
      expect(resRw.status).toBe(403);
    });

    it('PATCH /api/v1/households/{hid}/members/{userId} updates role when requested by ADMIN', async () => {
      const { request, adminToken, householdId } = await makeTestContext();
      const res = await request(
        `/api/v1/households/${householdId}/members/55555555-5555-4555-8555-555555555555`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'ADMIN' }),
        },
        adminToken,
      );
      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.role).toBe('ADMIN');
    });

    it('PATCH /api/v1/households/{hid}/members/{userId} rejects self-modification with 403', async () => {
      const { request, adminToken, householdId } = await makeTestContext();
      const res = await request(
        `/api/v1/households/${householdId}/members/44444444-4444-4444-8444-444444444444`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'READ_ONLY' }),
        },
        adminToken,
      );
      expect(res.status).toBe(403);
      const body = await jsonOf(res);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('POST /api/v1/households/{hid}/invitations creates invitation with single-use token', async () => {
      const { request, adminToken, householdId } = await makeTestContext();
      const res = await request(
        `/api/v1/households/${householdId}/invitations`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': 'invitation-test-key-001',
          },
          body: JSON.stringify({
            email: 'newuser@example.com',
            role: 'READ_WRITE',
            expiresInDays: 7,
          }),
        },
        adminToken,
      );
      expect(res.status).toBe(201);
      const body = await jsonOf(res);
      expect(body.token).toBeTruthy();
      expect(body.link).toContain(body.token);
      expect(body.invitation.email).toBe('newuser@example.com');
      expect(body.invitation.role).toBe('READ_WRITE');
    });

    it('POST /api/v1/invitations/accept accepts invitation and establishes membership', async () => {
      const { request, adminToken, outsiderToken, householdId } = await makeTestContext();
      // First create invitation
      const createRes = await request(
        `/api/v1/households/${householdId}/invitations`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': 'invitation-accept-key-01',
          },
          body: JSON.stringify({
            role: 'READ_ONLY',
            expiresInDays: 7,
          }),
        },
        adminToken,
      );
      const { token } = await jsonOf(createRes);

      // Accept with outsider user
      const acceptRes = await request(
        '/api/v1/invitations/accept',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        },
        outsiderToken,
      );
      expect(acceptRes.status).toBe(200);
      const acceptBody = await jsonOf(acceptRes);
      expect(acceptBody.householdId).toBe(householdId);
      expect(acceptBody.role).toBe('READ_ONLY');

      // Now outsider can view household
      const hhRes = await request(`/api/v1/households/${householdId}`, {}, outsiderToken);
      expect(hhRes.status).toBe(200);
    });
  });

  describe('Cross-Household Isolation (404 Not Found)', () => {
    it('returns 404 NOT_FOUND when querying a household the user does not belong to', async () => {
      const { request, outsiderToken, householdId } = await makeTestContext();
      const res = await request(`/api/v1/households/${householdId}`, {}, outsiderToken);
      expect(res.status).toBe(404);
      const body = await jsonOf(res);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 NOT_FOUND when querying a site of an inaccessible household', async () => {
      const { request, outsiderToken, siteId } = await makeTestContext();
      const res = await request(`/api/v1/sites/${siteId}`, {}, outsiderToken);
      expect(res.status).toBe(404);
      const body = await jsonOf(res);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('READ_ONLY Bypassing Frontend Mutation Block Matrix', () => {
    it('READ_ONLY fails on EVERY mutating route with 403 FORBIDDEN', async () => {
      const { request, roToken, householdId, siteId, ruleId } = await makeTestContext();

      const mutatingEndpoints = [
        {
          method: 'POST',
          path: `/api/v1/households/${householdId}/tariffs`,
          body: {
            name: 'Test Tariff',
            direction: 'IMPORT',
            priceMode: 'FLAT',
            currency: 'EUR',
            timezone: 'Europe/Dublin',
            effectiveFrom: '2026-06-01',
            flatRatePerKwh: '0.250000',
          },
        },
        {
          method: 'POST',
          path: `/api/v1/households/${householdId}/invitations`,
          headers: { 'idempotency-key': 'ro-invitation-key-01' },
          body: { role: 'READ_ONLY' },
        },
        {
          method: 'PATCH',
          path: `/api/v1/households/${householdId}/members/55555555-5555-4555-8555-555555555555`,
          body: { role: 'ADMIN' },
        },
        {
          method: 'POST',
          path: `/api/v1/sites/${siteId}/commands`,
          headers: { 'idempotency-key': 'ro-command-key-01' },
          body: { kind: 'SET_BACKUP_RESERVE', params: { backupReservePercent: 50 } },
        },
        {
          method: 'POST',
          path: `/api/v1/sites/${siteId}/automation/rules`,
          body: {
            name: 'RO Rule',
            mode: 'DRY_RUN',
            definition: {
              conditions: [{ type: 'BATTERY_SOC', comparator: 'LT', valuePercent: 20 }],
              actions: [{ kind: 'SET_BACKUP_RESERVE', params: { backupReservePercent: 80 } }],
            },
          },
        },
        {
          method: 'PATCH',
          path: `/api/v1/automation/rules/${ruleId}`,
          body: { version: 1, name: 'Renamed Rule' },
        },
      ];

      for (const ep of mutatingEndpoints) {
        const res = await request(
          ep.path,
          {
            method: ep.method,
            headers: {
              'content-type': 'application/json',
              ...(ep.headers ?? {}),
            },
            body: JSON.stringify(ep.body),
          },
          roToken,
        );

        expect(
          res.status,
          `Expected READ_ONLY to get 403 on ${ep.method} ${ep.path}, got ${res.status}`,
        ).toBe(403);
        const err = await jsonOf(res);
        expect(err.error.code).toBe('FORBIDDEN');
      }
    });
  });

  describe('Idempotency Key Handling & Replay', () => {
    it('requires Idempotency-Key header on command creation', async () => {
      const { request, rwToken, siteId } = await makeTestContext();
      const res = await request(
        `/api/v1/sites/${siteId}/commands`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'SET_BACKUP_RESERVE',
            params: { backupReservePercent: 50 },
          }),
        },
        rwToken,
      );
      expect(res.status).toBe(422);
      const body = await jsonOf(res);
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.details[0].path).toBe('idempotency-key');
    });

    it('replays identical responses when same idempotency key and body are provided', async () => {
      const { request, adminToken, householdId } = await makeTestContext();
      const idemKey = 'idempotent-invitation-001';
      const bodyObj = { email: 'replayed@example.com', role: 'READ_ONLY' };

      // Call 1
      const res1 = await request(
        `/api/v1/households/${householdId}/invitations`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': idemKey,
          },
          body: JSON.stringify(bodyObj),
        },
        adminToken,
      );
      expect(res1.status).toBe(201);
      const data1 = await jsonOf(res1);
      expect(data1.token).toBeTruthy();

      // Call 2 (Replay)
      const res2 = await request(
        `/api/v1/households/${householdId}/invitations`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': idemKey,
          },
          body: JSON.stringify(bodyObj),
        },
        adminToken,
      );
      expect(res2.status).toBe(201);
      expect(res2.headers.get('idempotent-replay')).toBe('true');
      const data2 = await jsonOf(res2);
      expect(data2.invitation.id).toBe(data1.invitation.id);
      // D-036 exception: token and link are redacted to null on replay
      expect(data2.token).toBeNull();
      expect(data2.link).toBeNull();
    });

    it('rejects same idempotency key with different body with 409 CONFLICT', async () => {
      const { request, adminToken, householdId } = await makeTestContext();
      const idemKey = 'conflict-key-000123';

      await request(
        `/api/v1/households/${householdId}/invitations`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': idemKey,
          },
          body: JSON.stringify({ email: 'first@example.com' }),
        },
        adminToken,
      );

      const resConflict = await request(
        `/api/v1/households/${householdId}/invitations`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': idemKey,
          },
          body: JSON.stringify({ email: 'different@example.com' }),
        },
        adminToken,
      );
      expect(resConflict.status).toBe(409);
      const body = await jsonOf(resConflict);
      expect(body.error.code).toBe('CONFLICT');
    });
  });

  describe('Sites, Capabilities, and Telemetry', () => {
    it('GET /api/v1/households/{hid}/sites returns energy sites', async () => {
      const { request, roToken, householdId } = await makeTestContext();
      const res = await request(`/api/v1/households/${householdId}/sites`, {}, roToken);
      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.items[0].provider).toBe('TESLA');
    });

    it('GET /api/v1/sites/{siteId}/capabilities returns capability registry', async () => {
      const { request, roToken, siteId } = await makeTestContext();
      const res = await request(`/api/v1/sites/${siteId}/capabilities`, {}, roToken);
      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBeGreaterThanOrEqual(4);
    });

    it('GET /api/v1/sites/{siteId}/live returns live reading', async () => {
      const { request, roToken, siteId } = await makeTestContext();
      const res = await request(`/api/v1/sites/${siteId}/live`, {}, roToken);
      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.source).toBe('DEMO');
      expect(body.loadPowerW).toBeGreaterThanOrEqual(0);
      expect(body.freshness).toBe('FRESH');
    });

    it('GET /api/v1/households/{hid}/demo/live returns demo live reading', async () => {
      const { request, roToken, householdId } = await makeTestContext();
      const res = await request(`/api/v1/households/${householdId}/demo/live`, {}, roToken);
      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.source).toBe('DEMO');
    });

    it('GET /api/v1/households/{hid}/demo/energy returns synthetic intervals', async () => {
      const { request, roToken, householdId } = await makeTestContext();
      const res = await request(
        `/api/v1/households/${householdId}/demo/energy?from=2026-06-01T00:00:00Z&to=2026-06-02T00:00:00Z&resolution=hourly`,
        {},
        roToken,
      );
      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.resolution).toBe('hourly');
      expect(body.items.length).toBeGreaterThan(0);
    });
  });

  describe('Tariffs and Validation', () => {
    it('creates a valid flat tariff when called by READ_WRITE', async () => {
      const { request, rwToken, householdId } = await makeTestContext();
      const res = await request(
        `/api/v1/households/${householdId}/tariffs`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Standard Summer Flat',
            direction: 'IMPORT',
            priceMode: 'FLAT',
            currency: 'EUR',
            timezone: 'Europe/Dublin',
            effectiveFrom: '2026-06-01',
            flatRatePerKwh: '0.280000',
          }),
        },
        rwToken,
      );
      expect(res.status).toBe(201);
      const body = await jsonOf(res);
      expect(body.name).toBe('Standard Summer Flat');
      expect(body.flatRatePerKwh).toBe('0.280000');
    });

    it('rejects an invalid tariff definition with domain validation problems', async () => {
      const { request, rwToken, householdId } = await makeTestContext();
      const res = await request(
        `/api/v1/households/${householdId}/tariffs`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Invalid TOU with no slots',
            direction: 'IMPORT',
            priceMode: 'TIME_OF_USE',
            currency: 'EUR',
            timezone: 'Europe/Dublin',
            effectiveFrom: '2026-06-01',
            slots: [],
          }),
        },
        rwToken,
      );
      expect(res.status).toBe(422);
      const body = await jsonOf(res);
      expect(body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('Automation Rules & Commands', () => {
    it('creates an automation rule in DRY_RUN mode', async () => {
      const { request, rwToken, siteId } = await makeTestContext();
      const res = await request(
        `/api/v1/sites/${siteId}/automation/rules`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Pre-charge battery on low cost',
            mode: 'DRY_RUN',
            definition: {
              conditions: [{ type: 'BATTERY_SOC', comparator: 'LT', valuePercent: 30 }],
              actions: [{ kind: 'SET_BACKUP_RESERVE', params: { backupReservePercent: 70 } }],
            },
          }),
        },
        rwToken,
      );
      expect(res.status).toBe(201);
      const body = await jsonOf(res);
      expect(body.name).toBe('Pre-charge battery on low cost');
      expect(body.mode).toBe('DRY_RUN');
    });

    it('dispatches command submission with 202 Accepted in Task 17', async () => {
      const { request, rwToken, siteId } = await makeTestContext();
      const res = await request(
        `/api/v1/sites/${siteId}/commands`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': 'cmd-dispatch-key-001',
          },
          body: JSON.stringify({
            kind: 'SET_BACKUP_RESERVE',
            params: { backupReservePercent: 80 },
          }),
        },
        rwToken,
      );
      expect(res.status).toBe(202);
      const body = await jsonOf(res);
      expect(body.state).toBe('PENDING');
      expect(body.id).toBeDefined();
    });
  });

  describe('Rate Limiter', () => {
    it('returns 429 RATE_LIMITED when threshold is exceeded', async () => {
      const { request, rateLimiter, roToken, householdId } = await makeTestContext();
      // Set limiter to already have exhausted bucket
      for (let i = 0; i < 120; i++) {
        rateLimiter.check('66666666-6666-4666-8666-666666666666', 120, 60);
      }

      // Next request exceeds
      const res = await request(`/api/v1/households/${householdId}`, {}, roToken);
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBeTruthy();
      const body = await jsonOf(res);
      expect(body.error.code).toBe('RATE_LIMITED');
    });
  });
});
