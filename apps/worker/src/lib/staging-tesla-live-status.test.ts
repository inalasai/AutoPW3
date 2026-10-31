import { ProviderLiveStatusSchema } from '@autopw3/shared';
import { CompactSign, exportJWK } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRepository } from '../db/repository';
import type { Env } from '../env';
import worker from '../index';
import { defaultDemoProvider } from '../providers/demo';
import { TeslaClient } from '../providers/tesla/client';
import { MockTeslaClient } from '../providers/tesla/mock-adapter';
import { InMemoryTokenStore, type DecryptedTokens } from '../services/tokens/store';
import { SupabaseTokenStore } from '../services/tokens/supabase-store';
import { getTestAuthKeys } from '../test/jwt-helpers';

const A = '11111111-aaaa-4111-8111-111111111111';
const B = '22222222-bbbb-4222-8222-222222222222';
const H1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const H2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const S2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const APP = 'https://stage.autopw3.app';
const EU = 'https://fleet-api.prd.eu.vn.cloud.tesla.com';
const NA = 'https://fleet-api.prd.na.vn.cloud.tesla.com';
const serviceKey = `${btoa(JSON.stringify({ alg: 'HS256' }))}.${btoa(JSON.stringify({ role: 'service_role' }))}.fixture`;
const path = (household = H1, site = S1) =>
  `/api/v1/households/${household}/sites/${site}/provider/tesla/live-status`;
type Row = Record<string, unknown>;
let project = 0;

describe('manually triggered durable staging Tesla live status', () => {
  let env: Env;
  let jwt: string;
  let actor: string;
  let key: Uint8Array;
  let tokens: DecryptedTokens;
  let site: Row | null;
  let role: string | null;
  let saved: Map<string, Row>;
  let network: ReturnType<typeof vi.fn<typeof fetch>>;
  let limited: boolean;
  let providerStatus: number;
  let providerValue: unknown;
  let invalidJson: boolean;
  let failure: string | undefined;
  let revokeAfterCredentials: boolean;
  let revokeDuringProvider: boolean;
  let databaseStatus: number;

  async function sign(user = A, claims: Row = {}) {
    const keys = await getTestAuthKeys();
    return new CompactSign(
      new TextEncoder().encode(
        JSON.stringify({
          sub: user,
          role: 'authenticated',
          aud: 'authenticated',
          iss: `${env.SUPABASE_URL}/auth/v1`,
          exp: Math.floor(Date.now() / 1000) + 3600,
          ...claims,
        }),
      ),
    )
      .setProtectedHeader({ alg: 'RS256', kid: 'live-test' })
      .sign(keys.privateKey);
  }
  const request = (route = path(), init: RequestInit = {}, token: string | null = jwt) => {
    const headers = new Headers(init.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    return worker.fetch(new Request(`${APP}${route}`, { ...init, headers }), env);
  };
  const providerCalls = () =>
    network.mock.calls.filter(([url]) => new URL(String(url)).hostname.includes('fleet-api'));
  const rpcCalls = (name: string) =>
    network.mock.calls.filter(([url]) => String(url).endsWith(`/rpc/${name}`));
  async function seed(changes: Partial<DecryptedTokens> = {}, household = H1) {
    tokens = { ...tokens, ...changes };
    await new SupabaseTokenStore(env.SUPABASE_URL!, serviceKey, key).saveTokens(household, tokens);
    network.mockClear();
  }
  async function issue(response: Response) {
    return ((await response.json()) as { error: { details?: { issue: string }[] } }).error
      .details?.[0]?.issue;
  }

  beforeEach(async () => {
    actor = A;
    key = crypto.getRandomValues(new Uint8Array(32));
    env = {
      ENVIRONMENT: 'staging',
      STAGING_TESLA_LIVE_STATUS_ENABLED: 'true',
      LOCAL_MOCKS: 'false',
      SUPABASE_URL: `https://live-${++project}.supabase.co`,
      SUPABASE_ANON_KEY: 'sb_publishable_fixture',
      SUPABASE_SECRET_KEY: serviceKey,
      ALLOWED_ORIGINS: APP,
      APP_BASE_URL: APP,
      TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...key)),
      ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    };
    jwt = await sign();
    tokens = {
      accessToken: `access-${crypto.randomUUID()}`,
      refreshToken: `refresh-${crypto.randomUUID()}`,
      tokenType: 'Bearer',
      scope: 'openid offline_access energy_device_data',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      regionBaseUrl: EU,
    };
    site = {
      id: S1,
      household_id: H1,
      provider: 'TESLA',
      provider_site_id: '1234567890',
      name: 'Fixture Powerwall',
      timezone: 'Europe/Dublin',
      connection_state: 'LIVE',
    };
    role = 'READ_ONLY';
    saved = new Map();
    limited = false;
    providerStatus = 200;
    providerValue = {
      response: {
        percentage_charged: 84.5,
        solar_power: 4500,
        battery_power: -1800,
        grid_power: -900,
        load_power: 1800,
        timestamp: '2026-10-31T12:00:00+01:00',
        private_field: 'omit-this-field',
      },
    };
    invalidJson = false;
    failure = undefined;
    revokeAfterCredentials = false;
    revokeDuringProvider = false;
    databaseStatus = 200;
    const keys = await getTestAuthKeys();
    const jwk = {
      ...(await exportJWK(keys.publicKey)),
      kid: 'live-test',
      alg: 'RS256',
      use: 'sig',
    };
    network = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/jwks.json')) return Response.json({ keys: [jwk] });
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url.origin === env.SUPABASE_URL) {
        if (failure === 'database') throw new Error('private database diagnostic');
        const headers = new Headers(init?.headers);
        if (!url.pathname.includes('/rpc/')) {
          expect(init?.method).toBe('GET');
          expect(headers.get('authorization')).toBe(`Bearer ${jwt}`);
          expect(headers.get('apikey')).toBe(env.SUPABASE_ANON_KEY);
          if (databaseStatus !== 200)
            return Response.json(
              { message: 'private database detail' },
              { status: databaseStatus },
            );
          if (url.pathname.endsWith('/energy_sites')) {
            expect(url.searchParams.get('provider')).toBe('eq.TESLA');
            const readable =
              role !== null &&
              actor === A &&
              site?.household_id === H1 &&
              site.id === url.searchParams.get('id')?.slice(3);
            return Response.json(readable ? [site] : []);
          }
          if (url.pathname.endsWith('/household_members')) {
            const member =
              role !== null && actor === A && url.searchParams.get('household_id') === `eq.${H1}`;
            return Response.json(member ? [{ household_id: H1, user_id: actor }] : []);
          }
          throw new Error('Unexpected user read');
        }
        expect(headers.get('apikey')).toBe(serviceKey);
        expect(headers.get('authorization')).toBe(`Bearer ${serviceKey}`);
        const body = JSON.parse(String(init?.body)) as Row;
        switch (url.pathname.split('/').at(-1)) {
          case 'worker_check_rate_limit':
            expect(body.p_limit).toBe(10);
            expect(body.p_window_seconds).toBe(60);
            return Response.json([{ allowed: !limited, retry_after_seconds: 60 }]);
          case 'worker_save_tesla_credentials':
            saved.set(String(body.p_household_id), {
              nonce: body.p_nonce,
              ciphertext: body.p_ciphertext,
              version: body.p_version,
              scopes: body.p_scopes,
              fleet_api_base_url: body.p_fleet_api_base_url,
              access_expires_at: body.p_access_expires_at,
              status: 'ACTIVE',
            });
            return Response.json(true);
          case 'worker_get_tesla_credentials':
            expect(body.p_household_id).toBe(H1);
            if (revokeAfterCredentials) role = null;
            return Response.json(saved.has(H1) ? [saved.get(H1)] : []);
          default:
            throw new Error('Unexpected privileged RPC');
        }
      }
      expect(url.origin).toBe(tokens.regionBaseUrl);
      expect(url.pathname).toBe('/api/1/energy_sites/1234567890/live_status');
      expect(url.search).toBe('');
      expect(init?.method).toBe('GET');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${tokens.accessToken}`);
      if (failure === 'provider') throw new Error(tokens.accessToken);
      if (failure === 'timeout') {
        return new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('private timeout'))),
        );
      }
      if (revokeDuringProvider) role = null;
      if (invalidJson) return new Response('private invalid response', { status: providerStatus });
      return Response.json(providerValue, {
        status: providerStatus,
        headers: { 'retry-after': '45' },
      });
    });
    vi.stubGlobal('fetch', network);
    await seed();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['READ_ONLY', 'READ_WRITE', 'ADMIN'])(
    'allows %s reads with persisted site and encrypted household credentials',
    async (value) => {
      role = value;
      const response = await request();
      expect(response.status).toBe(200);
      const body = ProviderLiveStatusSchema.parse(await response.json());
      expect(body).toEqual({
        siteId: S1,
        source: 'TESLA',
        signConvention: 'TESLA_NATIVE',
        batterySocPercent: 84.5,
        solarPowerW: 4500,
        batteryPowerW: -1800,
        gridPowerW: -900,
        loadPowerW: 1800,
        providerTimestamp: '2026-10-31T12:00:00+01:00',
      });
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(providerCalls()).toHaveLength(1);
    },
  );
  it.each([undefined, 'false', 'TRUE'])('keeps flag %s disabled', async (flag) => {
    env.STAGING_TESLA_LIVE_STATUS_ENABLED = flag;
    expect((await request()).status).toBe(502);
    expect(network).not.toHaveBeenCalled();
  });
  it.each(['production', 'local', 'test', 'preview'])(
    'never opens the staging slice in %s',
    async (environment) => {
      env.ENVIRONMENT = environment;
      const response = await request();
      expect(response.status).not.toBe(200);
      expect(providerCalls()).toHaveLength(0);
    },
  );
  it('requires authentication before privileged calls', async () => {
    expect((await request(path(), {}, null)).status).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });
  it.each([
    { exp: null },
    { aud: null },
    { aud: ['authenticated', 3] },
    { aud: 'wrong' },
    { role: 'service_role' },
    { iss: 'https://other.supabase.co/auth/v1' },
  ])('rejects malformed JWT %j before privileged calls', async (claims) => {
    jwt = await sign(A, claims);
    expect((await request()).status).toBe(401);
    expect(rpcCalls('worker_check_rate_limit')).toHaveLength(0);
    expect(providerCalls()).toHaveLength(0);
  });
  it('denies another household path and never retrieves its credentials', async () => {
    expect((await request(path(H2))).status).toBe(404);
    expect(rpcCalls('worker_get_tesla_credentials')).toHaveLength(0);
    expect(providerCalls()).toHaveLength(0);
  });
  it('denies an unrelated actor even with a valid Supabase JWT', async () => {
    actor = B;
    jwt = await sign(B);
    expect((await request()).status).toBe(404);
    expect(rpcCalls('worker_get_tesla_credentials')).toHaveLength(0);
  });
  it.each(['initial', 'after-credentials', 'during-provider'])(
    'denies revoked membership %s',
    async (when) => {
      if (when === 'initial') role = null;
      if (when === 'after-credentials') revokeAfterCredentials = true;
      if (when === 'during-provider') revokeDuringProvider = true;
      expect((await request()).status).toBe(404);
      expect(providerCalls()).toHaveLength(when === 'during-provider' ? 1 : 0);
    },
  );
  it('rejects missing site', async () => {
    expect((await request(path(H1, S2))).status).toBe(404);
    expect(providerCalls()).toHaveLength(0);
  });
  it('rejects disconnected site', async () => {
    site!.connection_state = 'DISCONNECTED';
    expect((await request()).status).toBe(404);
    expect(rpcCalls('worker_get_tesla_credentials')).toHaveLength(0);
  });
  it('permits a persisted connecting site to obtain its first real response without changing it', async () => {
    site!.connection_state = 'CONNECTING';
    expect((await request()).status).toBe(200);
    expect(site!.connection_state).toBe('CONNECTING');
  });
  it('fails explicitly without credentials', async () => {
    saved.clear();
    const response = await request();
    expect(response.status).toBe(502);
    expect(await issue(response)).toBe('tesla_credentials_missing');
    expect(providerCalls()).toHaveLength(0);
  });
  it('rejects encrypted credentials copied from a different household', async () => {
    await seed({}, H2);
    saved.set(H1, saved.get(H2)!);
    expect((await request()).status).toBe(502);
    expect(providerCalls()).toHaveLength(0);
  });
  it.each([-1, 0, 29])(
    'rejects expired/expiring credentials (%s seconds) without refresh',
    async (seconds) => {
      await seed({ expiresAt: Math.floor(Date.now() / 1000) + seconds });
      const response = await request();
      expect(response.status).toBe(502);
      expect(await issue(response)).toBe('tesla_credentials_expired');
      expect(providerCalls()).toHaveLength(0);
    },
  );
  it.each(['', 'openid offline_access', 'energy_device_data_extra', 'energy_cmds'])(
    'rejects missing/wrong read scope %s',
    async (scope) => {
      await seed({ scope });
      const response = await request();
      expect(response.status).toBe(502);
      expect(await issue(response)).toBe('tesla_read_scope_missing');
      expect(providerCalls()).toHaveLength(0);
    },
  );
  it.each([EU, NA])('uses only the stored approved region %s', async (regionBaseUrl) => {
    await seed({ regionBaseUrl });
    expect((await request()).status).toBe(200);
    expect(providerCalls()).toHaveLength(1);
  });
  it.each([
    'https://attacker.invalid',
    `${EU}/`,
    `${EU}@attacker.invalid`,
    `${EU}/path`,
    'http://fleet-api.prd.eu.vn.cloud.tesla.com',
  ])('rejects stored unapproved region %s', async (regionBaseUrl) => {
    await seed({ regionBaseUrl });
    expect((await request()).status).toBe(502);
    expect(providerCalls()).toHaveLength(0);
  });
  it.each([
    '../123',
    '123?url=evil',
    'https://attacker.invalid',
    '0',
    '-1',
    '1.2',
    '00012',
    '1'.repeat(21),
  ])('rejects stored provider ID %s', async (providerSiteId) => {
    site!.provider_site_id = providerSiteId;
    const response = await request();
    expect(response.status).toBe(502);
    expect(await issue(response)).toBe('tesla_site_id_invalid');
    expect(providerCalls()).toHaveLength(0);
  });
  it.each([
    [401, 'tesla_unauthorized'],
    [403, 'tesla_forbidden'],
    [404, 'tesla_site_not_found'],
    [500, 'tesla_service_unavailable'],
    [503, 'tesla_service_unavailable'],
  ] as const)('handles Tesla HTTP %s explicitly', async (status, expected) => {
    providerStatus = status;
    providerValue = { error: tokens.accessToken };
    const response = await request();
    expect(response.status).toBe(502);
    expect(await issue(response)).toBe(expected);
    expect(providerCalls()).toHaveLength(1);
  });
  it('propagates a bounded Tesla 429 retry interval without retrying', async () => {
    providerStatus = 429;
    const response = await request();
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('45');
    expect(providerCalls()).toHaveLength(1);
  });
  it('fails closed when durable rate limiting denies the read', async () => {
    limited = true;
    expect((await request()).status).toBe(429);
    expect(rpcCalls('worker_get_tesla_credentials')).toHaveLength(0);
    expect(providerCalls()).toHaveLength(0);
  });
  it('handles network failure without region retries', async () => {
    failure = 'provider';
    const response = await request();
    expect(response.status).toBe(502);
    expect(await issue(response)).toBe('tesla_network_failure');
    expect(providerCalls()).toHaveLength(1);
  });
  it('bounds provider timeout', async () => {
    const controller = new AbortController();
    failure = 'timeout';
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const pending = request();
    // Wait until the injected provider starts, then abort only its bounded request.
    await vi.waitFor(() => expect(providerCalls()).toHaveLength(1));
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(502);
    expect(await issue(response)).toBe('tesla_timeout');
  });
  it.each([
    null,
    {},
    { response: null },
    { response: [] },
    { response: {} },
    { response: { timestamp: '2026-10-31T12:00:00Z' } },
    { response: { battery_power: '100' } },
    { response: { percentage_charged: 101 } },
    { response: { solar_power: 100, timestamp: 'bad' } },
  ])('rejects malformed or measurement-free Tesla data %j', async (value) => {
    providerValue = value;
    const response = await request();
    expect(response.status).toBe(502);
    expect(await issue(response)).toBe('tesla_invalid_response');
  });
  it('rejects malformed JSON', async () => {
    invalidJson = true;
    const response = await request();
    expect(response.status).toBe(502);
    expect(await issue(response)).toBe('tesla_invalid_response');
  });
  it('returns partial readings and real zeroes without invented timestamps, signs or missing measurements', async () => {
    providerValue = {
      response: { solar_power: -0.25, battery_power: 0, private_field: tokens.accessToken },
    };
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      siteId: S1,
      source: 'TESLA',
      signConvention: 'TESLA_NATIVE',
      batterySocPercent: null,
      solarPowerW: -0.25,
      batteryPowerW: 0,
      gridPowerW: null,
      loadPowerW: null,
      providerTimestamp: null,
    });
  });
  it('never uses normalization, demo, in-memory tokens/repository, refresh, persistence or commands', async () => {
    const forbidden = [
      vi.spyOn(InMemoryRepository.prototype, 'getSite'),
      vi.spyOn(InMemoryTokenStore.prototype, 'getTokens'),
      vi.spyOn(defaultDemoProvider, 'getLiveSnapshot'),
      vi.spyOn(TeslaClient.prototype, 'normaliseLiveStatus'),
      vi.spyOn(MockTeslaClient.prototype, 'getLiveStatus'),
      vi.spyOn(SupabaseTokenStore.prototype, 'acquireRefreshLock'),
    ];
    expect((await request()).status).toBe(200);
    forbidden.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    expect(rpcCalls('worker_save_tesla_credentials')).toHaveLength(0);
    expect(providerCalls()).toHaveLength(1);
    expect(() => worker.scheduled({} as ScheduledController, env, {} as ExecutionContext)).toThrow(
      'Scheduled jobs are disabled',
    );
  });
  it('does not expose credentials or raw provider diagnostics in responses or logs', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    for (const status of [200, 401, 500]) {
      providerStatus = status;
      const response = await request();
      const body = await response.text();
      for (const sensitive of [
        jwt,
        serviceKey,
        tokens.accessToken,
        tokens.refreshToken,
        env.TOKEN_ENCRYPTION_KEY!,
        'omit-this-field',
      ])
        expect(body).not.toContain(sensitive);
    }
    logs.forEach((log) => expect(log).not.toHaveBeenCalled());
  });
  it.each([
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SECRET_KEY',
    'APP_BASE_URL',
    'ALLOWED_ORIGINS',
    'TOKEN_ENCRYPTION_KEY',
  ] as const)('fails closed without %s', async (name) => {
    env[name] = undefined;
    expect((await request()).status).toBe(502);
    expect(network).not.toHaveBeenCalled();
  });
  it.each([401, 403, 503])('fails closed on database HTTP %s', async (status) => {
    databaseStatus = status;
    const response = await request();
    expect(response.status).toBe(status === 503 ? 502 : status);
    expect(providerCalls()).toHaveLength(0);
  });
  it('fails closed on database network failure', async () => {
    failure = 'database';
    expect((await request()).status).toBe(502);
    expect(providerCalls()).toHaveLength(0);
  });
  it('permits only GET preflight without privileged I/O', async () => {
    const preflight = (method: string) =>
      request(
        path(),
        {
          method: 'OPTIONS',
          headers: {
            origin: APP,
            'access-control-request-method': method,
            'access-control-request-headers': 'authorization',
          },
        },
        null,
      );
    const response = await preflight('GET');
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toBe('GET');
    expect((await preflight('POST')).status).toBe(403);
    expect(network).not.toHaveBeenCalled();
  });
  it.each(['POST', 'PUT', 'DELETE', 'HEAD'])('never enables %s operations', async (method) => {
    expect((await request(path(), { method })).status).toBe(502);
    expect(network).not.toHaveBeenCalled();
  });
  it.each([
    `${path()}/`,
    path().replace('live-status', '%6cive-status'),
    '/api/v1/sites/' + S1 + '/live',
    '/api/v1/sites/' + S1 + '/commands',
    '/api/v1/households/' + H1 + '/provider/tesla/connect',
  ])('does not open other paths: %s', async (route) => {
    expect((await request(route)).status).toBe(502);
    expect(network).not.toHaveBeenCalled();
  });
  it.each(['?providerSiteId=123', '?baseUrl=https://attacker.invalid', '?householdId=' + H2])(
    'rejects query overrides %s',
    async (query) => {
      expect((await request(path() + query)).status).toBe(422);
      expect(network).not.toHaveBeenCalled();
    },
  );
});
