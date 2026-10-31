import { MeResponseSchema, ROUTES } from '@autopw3/shared';
import { CompactSign, decodeJwt, exportJWK } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRepository } from '../db/repository';
import type { Env } from '../env';
import worker from '../index';
import { defaultIdempotencyStore } from './idempotency';
import { defaultRateLimiter } from './rate-limiter';
import { createHs256Jwt, getTestAuthKeys } from '../test/jwt-helpers';

const USER_A = '11111111-aaaa-4111-8111-111111111111';
const USER_B = '22222222-bbbb-4222-8222-222222222222';
const HOUSEHOLD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HOUSEHOLD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PUBLIC_KEY = 'sb_publishable_staging_test';
// Syntactic API-key fixture only. The mocked gateway does not authenticate this value.
const SERVICE_KEY = `${btoa(JSON.stringify({ alg: 'HS256' })).replaceAll('=', '')}.${btoa(JSON.stringify({ role: 'service_role' })).replaceAll('=', '')}.fixture-signature`;
let projectNumber = 0;

describe('staging identity through the Worker fetch entrypoint', () => {
  let env: Env;
  let tokenA: string;
  let tokenB: string;
  let network: ReturnType<typeof vi.fn<typeof fetch>>;
  let profileResponse: Response | undefined;
  let membershipResponse: Response | undefined;
  let rateResponse: Response | undefined;
  let beforeProfile: ((actor: string, signal: AbortSignal) => Promise<void>) | undefined;

  async function sign(
    actor = USER_A,
    claims: { exp?: number | null; issuer?: string; role?: string; audience?: unknown } = {},
  ) {
    const keys = await getTestAuthKeys();
    // Sign raw claims so malformed audience fixtures are not rejected by the JWT producer.
    const payload = {
      role: claims.role ?? 'authenticated',
      sub: actor,
      iss: claims.issuer ?? `${env.SUPABASE_URL}/auth/v1`,
      aud: Object.hasOwn(claims, 'audience') ? claims.audience : 'authenticated',
      ...(claims.exp === null ? {} : { exp: claims.exp ?? Math.floor(Date.now() / 1000) + 3600 }),
    };
    return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
      .setProtectedHeader({ alg: 'RS256', kid: 'staging-test' })
      .sign(keys.privateKey);
  }

  const request = (path = '/api/v1/me', init: RequestInit = {}, token = tokenA) => {
    const headers = new Headers(init.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    return worker.fetch(new Request(`https://stage.autopw3.app${path}`, { ...init, headers }), env);
  };

  beforeEach(async () => {
    env = {
      ENVIRONMENT: 'staging',
      STAGING_IDENTITY_READ_ENABLED: 'true',
      LOCAL_MOCKS: 'false',
      SUPABASE_URL: `https://stage-${++projectNumber}.supabase.co`,
      SUPABASE_ANON_KEY: PUBLIC_KEY,
      SUPABASE_SECRET_KEY: SERVICE_KEY,
      ALLOWED_ORIGINS: 'https://stage.autopw3.app',
      ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    };
    profileResponse = membershipResponse = rateResponse = undefined;
    beforeProfile = undefined;
    tokenA = await sign(USER_A);
    tokenB = await sign(USER_B);
    const jwk = await exportJWK((await getTestAuthKeys()).publicKey);
    network = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe(env.SUPABASE_URL);
      if (url.pathname === '/auth/v1/.well-known/jwks.json') {
        return Response.json({ keys: [{ ...jwk, kid: 'staging-test', alg: 'RS256' }] });
      }
      const headers = new Headers(init?.headers);
      expect(init?.redirect).toBe('error');
      if (url.pathname === '/rest/v1/rpc/worker_check_rate_limit') {
        expect(init?.method).toBe('POST');
        expect(headers.get('authorization')).toBe(`Bearer ${env.SUPABASE_SECRET_KEY}`);
        expect(headers.get('apikey')).toBe(env.SUPABASE_SECRET_KEY);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({ p_limit: 120, p_window_seconds: 60 });
        expect(body.p_key_hash).toMatch(/^\\x[0-9a-f]{64}$/);
        return rateResponse?.clone() ?? Response.json([{ allowed: true, retry_after_seconds: 60 }]);
      }
      expect(init?.method).toBe('GET');
      expect(headers.get('apikey')).toBe(env.SUPABASE_ANON_KEY);
      expect([`Bearer ${tokenA}`, `Bearer ${tokenB}`]).toContain(headers.get('authorization'));
      const actor = decodeJwt(headers.get('authorization')!.slice(7)).sub!;
      expect(url.searchParams.get('user_id')).toBe(`eq.${actor}`);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url.pathname === '/rest/v1/user_profiles') {
        expect(url.searchParams.get('limit')).toBe('1');
        await beforeProfile?.(actor, init!.signal!);
        return (
          profileResponse?.clone() ??
          Response.json([{ user_id: actor, display_name: 'Stored profile', locale: null }])
        );
      }
      if (url.pathname === '/rest/v1/household_members') {
        expect(url.searchParams.get('select')).toBe('household_id,role,households!inner(name)');
        expect(url.searchParams.get('limit')).toBe('201');
        return (
          membershipResponse?.clone() ??
          Response.json([
            {
              household_id: actor === USER_A ? HOUSEHOLD_A : HOUSEHOLD_B,
              role: 'READ_ONLY',
              households: { name: 'Stored household' },
            },
          ])
        );
      }
      throw new Error('Unexpected outgoing request');
    });
    vi.stubGlobal('fetch', network);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reads persisted identity without legacy dependencies, provider configuration or idempotency caching', async () => {
    const spies = [
      vi.spyOn(InMemoryRepository.prototype, 'getProfile'),
      vi.spyOn(InMemoryRepository.prototype, 'getHouseholdMemberships'),
      vi.spyOn(defaultIdempotencyStore, 'get'),
      vi.spyOn(defaultIdempotencyStore, 'set'),
      vi.spyOn(defaultRateLimiter, 'check'),
    ];
    for (const spy of spies)
      spy.mockImplementation(() => {
        throw new Error('Legacy dependency selected');
      });
    const response = await request(`/api/v1/me?userId=${USER_B}&householdId=${HOUSEHOLD_B}`, {
      headers: {
        origin: 'https://stage.autopw3.app',
        'idempotency-key': 'shared-read-key',
        'cf-connecting-ip': '192.0.2.1',
      },
    });
    expect(response.status).toBe(200);
    const body = MeResponseSchema.parse(await response.json());
    expect(body.profile).toEqual({ userId: USER_A, displayName: 'Stored profile', locale: null });
    expect(body.memberships.map((m) => m.householdId)).toEqual([HOUSEHOLD_A]);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(response.headers.get('access-control-allow-origin')).toBe('https://stage.autopw3.app');
    expect(response.headers.get('idempotent-replay')).toBeNull();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(network).toHaveBeenCalledTimes(4);
  });

  it('keeps interleaved actors, JWTs and hashed rate-limit scopes independent', async () => {
    let releaseA!: () => void;
    let startedA!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const started = new Promise<void>((resolve) => {
      startedA = resolve;
    });
    beforeProfile = async (actor) => {
      if (actor === USER_A) {
        startedA();
        await blocked;
      }
    };
    const a = request('/api/v1/me', { headers: { 'idempotency-key': 'same-key' } });
    await started;
    const b = await request('/api/v1/me', { headers: { 'idempotency-key': 'same-key' } }, tokenB);
    releaseA();
    const bodyA = MeResponseSchema.parse(await (await a).json());
    const bodyB = MeResponseSchema.parse(await b.json());
    expect(bodyA.profile.userId).toBe(USER_A);
    expect(bodyB.profile.userId).toBe(USER_B);
    expect(bodyA.memberships[0]?.householdId).toBe(HOUSEHOLD_A);
    expect(bodyB.memberships[0]?.householdId).toBe(HOUSEHOLD_B);
    const hashes = network.mock.calls
      .filter(([url]) => String(url).endsWith('/worker_check_rate_limit'))
      .map(([, init]) => (JSON.parse(String(init?.body)) as { p_key_hash: string }).p_key_hash);
    expect(new Set(hashes).size).toBe(2);
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`staging:getMe:${USER_A}\u0000120\u000060`),
    );
    expect(hashes).toContain(
      `\\x${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`,
    );
  });

  it('returns NOT_FOUND for a missing persisted profile', async () => {
    profileResponse = Response.json([]);
    const response = await request();
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(network.mock.calls.some(([url]) => String(url).includes('/household_members'))).toBe(
      false,
    );
  });

  it('permits a persisted user with no household memberships', async () => {
    membershipResponse = Response.json([]);
    const response = await request();
    expect(response.status).toBe(200);
    expect(MeResponseSchema.parse(await response.json()).memberships).toEqual([]);
  });

  it('also accepts a syntactically classified legacy anon key for authenticated reads', async () => {
    env.SUPABASE_ANON_KEY = `${btoa(JSON.stringify({ alg: 'HS256' })).replaceAll('=', '')}.${btoa(JSON.stringify({ role: 'anon' })).replaceAll('=', '')}.fixture-signature`;
    expect((await request()).status).toBe(200);
  });

  it.each(['foreign-profile', 'invalid-membership'])(
    'rejects malformed or mismatched identity data: %s',
    async (scenario) => {
      if (scenario === 'foreign-profile')
        profileResponse = Response.json([
          { user_id: USER_B, display_name: 'Wrong actor', locale: null },
        ]);
      else
        membershipResponse = Response.json([
          { household_id: HOUSEHOLD_A, role: 'INVALID', households: { name: 'Home' } },
        ]);
      expect((await request()).status).toBe(502);
    },
  );

  it.each([undefined, 'false', 'TRUE'])('keeps the slice disabled for flag %s', async (flag) => {
    env.STAGING_IDENTITY_READ_ENABLED = flag;
    expect((await request()).status).toBe(502);
    expect(network).not.toHaveBeenCalled();
  });

  it('keeps every other API route, method, path variant and production request blocked', async () => {
    for (const [name, spec] of Object.entries(ROUTES)) {
      if (name === 'getMe') continue;
      const path = spec.path.replace(/\{[A-Za-z]+\}/g, HOUSEHOLD_A);
      expect((await request(`/api/v1${path}`, { method: spec.method })).status, name).toBe(502);
    }
    for (const path of ['/api/v1/me/', '/api/v1/%6de', '/api/v1/me/export', '/api/v1/unknown']) {
      expect((await request(path)).status).toBe(502);
    }
    expect((await request('/api/v1/me', { method: 'HEAD' })).status).toBe(502);
    env.ENVIRONMENT = 'production';
    expect((await request()).status).toBe(502);
    expect((await request('/api/v1/me', { method: 'OPTIONS' })).status).toBe(502);
    env.ENVIRONMENT = 'staging';
    expect(() =>
      worker.scheduled({} as ScheduledController, env, {
        waitUntil: vi.fn(),
      } as unknown as ExecutionContext),
    ).toThrow('Scheduled jobs are disabled');
    expect(network).not.toHaveBeenCalled();
  });

  it('answers only the permitted GET preflight without database or auth calls', async () => {
    const response = await request(
      '/api/v1/me',
      {
        method: 'OPTIONS',
        headers: {
          origin: 'https://stage.autopw3.app',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'Authorization, X-Request-Id',
        },
      },
      '',
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toBe('GET');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://stage.autopw3.app');
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    { origin: 'https://unrelated.app', 'access-control-request-method': 'GET' },
    { origin: 'https://stage.autopw3.app', 'access-control-request-method': 'DELETE' },
    { origin: 'https://stage.autopw3.app' },
    { 'access-control-request-method': 'GET' },
    {
      origin: 'https://stage.autopw3.app',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'X-Actor-Id',
    },
  ])('rejects unsupported preflight %j', async (headers) => {
    expect(
      (
        await request(
          '/api/v1/me',
          { method: 'OPTIONS', headers: headers as Record<string, string> },
          '',
        )
      ).status,
    ).toBe(403);
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    { SUPABASE_URL: undefined },
    { SUPABASE_ANON_KEY: undefined },
    { SUPABASE_SECRET_KEY: undefined },
    { ALLOWED_ORIGINS: undefined },
    { SUPABASE_URL: 'http://localhost:54321' },
    { SUPABASE_URL: 'https://project.supabase.co/rest/v1' },
    { ALLOWED_ORIGINS: 'https://staging.example.com' },
    { ALLOWED_ORIGINS: '*' },
    { ALLOWED_ORIGINS: 'http://stage.autopw3.app' },
    { SUPABASE_ANON_KEY: SERVICE_KEY },
    { SUPABASE_SECRET_KEY: PUBLIC_KEY },
    { SUPABASE_SECRET_KEY: 'sb_secret_staging_test' },
    { SUPABASE_SECRET_KEY: 'YOUR_VALUE_HERE' },
    { SUPABASE_ANON_KEY: ' ' },
    { JWT_ISSUER: 'https://another.supabase.co/auth/v1' },
    { JWT_JWKS_URL: 'https://another.app/keys' },
    { LOCAL_MOCKS: 'true' },
  ] satisfies Partial<Env>[])(
    'fails closed without usable isolated configuration: %j',
    async (overrides) => {
      Object.assign(env, overrides);
      expect((await request()).status).toBe(502);
      expect(network).not.toHaveBeenCalled();
    },
  );

  it('rejects a disallowed GET origin before authentication', async () => {
    expect(
      (await request('/api/v1/me', { headers: { origin: 'https://unrelated.app' } })).status,
    ).toBe(403);
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    'missing',
    'malformed',
    'expired',
    'no-exp',
    'wrong-issuer',
    'wrong-role',
    'invalid-subject',
    'wrong-signature',
    'symmetric',
  ])('rejects %s authentication before any database call', async (scenario) => {
    const token =
      scenario === 'missing'
        ? ''
        : scenario === 'malformed'
          ? 'invalid.jwt'
          : scenario === 'wrong-signature'
            ? `${tokenA.slice(0, tokenA.lastIndexOf('.') + 1)}${tokenA.at(tokenA.lastIndexOf('.') + 1) === 'A' ? 'B' : 'A'}${tokenA.slice(tokenA.lastIndexOf('.') + 2)}`
            : scenario === 'symmetric'
              ? await createHs256Jwt()
              : await sign(scenario === 'invalid-subject' ? 'not-a-uuid' : USER_A, {
                  ...(scenario === 'expired' ? { exp: 1 } : {}),
                  ...(scenario === 'no-exp' ? { exp: null } : {}),
                  ...(scenario === 'wrong-issuer'
                    ? { issuer: 'https://other.supabase.co/auth/v1' }
                    : {}),
                  ...(scenario === 'wrong-role' ? { role: 'service_role' } : {}),
                });
    expect((await request('/api/v1/me', {}, token)).status).toBe(401);
    expect(
      network.mock.calls.every(([url]) => String(url).includes('/auth/v1/.well-known/jwks.json')),
    ).toBe(true);
  });

  it.each(
    [
      undefined,
      null,
      '',
      'another-service',
      123,
      [],
      [''],
      ['another-service'],
      ['authenticated', 123],
      [null, 'authenticated'],
      ['authenticated', {}],
      ['authenticated', ['authenticated']],
      ['authenticated', ''],
    ].map((audience) => ({ audience })),
  )(
    'rejects missing, wrong or malformed audience $audience before all database access',
    async ({ audience }) => {
      const token = await sign(USER_A, { audience });
      const response = await request('/api/v1/me', {}, token);
      expect(response.status).toBe(401);
      expect(
        network.mock.calls.every(([url]) => String(url).includes('/auth/v1/.well-known/jwks.json')),
      ).toBe(true);
    },
  );

  it.each(
    [['authenticated'], ['another-service', 'authenticated']].map((audience) => ({ audience })),
  )('accepts a valid string audience array $audience', async ({ audience }) => {
    tokenA = await sign(USER_A, { audience });
    expect((await request()).status).toBe(200);
  });

  it.each(['rate', 'profile'])(
    'sanitizes a %s redirect failure without logging credentials',
    async (operation) => {
      const logs = [
        vi.spyOn(console, 'log'),
        vi.spyOn(console, 'warn'),
        vi.spyOn(console, 'error'),
      ];
      const redirect = new Response('must-not-leak-redirect-body', {
        status: 307,
        headers: { location: 'https://redirected.invalid/private-target' },
      });
      if (operation === 'rate') rateResponse = redirect;
      else profileResponse = redirect;
      const response = await request();
      expect(response.status).toBe(502);
      const body = await response.text();
      for (const sensitive of [
        PUBLIC_KEY,
        SERVICE_KEY,
        tokenA,
        'redirected.invalid',
        'must-not-leak',
      ]) {
        expect(body).not.toContain(sensitive);
      }
      for (const log of logs) expect(log).not.toHaveBeenCalled();
      expect(
        network.mock.calls.every(([url]) => new URL(String(url)).origin === env.SUPABASE_URL),
      ).toBe(true);
    },
  );

  it('rejects over-limit requests before reading identity', async () => {
    rateResponse = Response.json([{ allowed: false, retry_after_seconds: 17 }]);
    const response = await request();
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('17');
    expect(network.mock.calls.some(([url]) => String(url).includes('/user_profiles'))).toBe(false);
  });

  it.each([401, 403, 500])(
    'does not fall back when privileged rate limiting fails with %s',
    async (status) => {
      rateResponse = Response.json({ message: 'must-not-leak' }, { status });
      const response = await request();
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain('must-not-leak');
      expect(network.mock.calls.some(([url]) => String(url).includes('/user_profiles'))).toBe(
        false,
      );
    },
  );

  it.each([401, 403, 500])('translates user database errors safely: %s', async (status) => {
    profileResponse = Response.json({ message: 'must-not-leak', code: '42501' }, { status });
    const response = await request();
    expect(response.status).toBe(status === 500 ? 502 : status);
    expect(await response.text()).not.toContain('must-not-leak');
  });

  it('handles an aborted database request without fallback or sensitive diagnostics', async () => {
    await request(); // Warm the real JWKS verifier before enabling fake timers.
    vi.useFakeTimers();
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    beforeProfile = (_actor, signal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('must-not-leak')), { once: true });
        started();
      });
    const result = request();
    await pending;
    await vi.advanceTimersByTimeAsync(8_001);
    const response = await result;
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('must-not-leak');
  });
});
