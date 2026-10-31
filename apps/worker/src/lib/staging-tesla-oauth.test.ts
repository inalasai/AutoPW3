import { CompactSign, exportJWK } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import worker from '../index';
import { InMemoryRepository } from '../db/repository';
import { InMemoryOAuthStateStore, TESLA_TOKEN_URL } from '../providers/tesla/oauth';
import { InMemoryTokenStore } from '../services/tokens/store';
import { SupabaseTokenStore } from '../services/tokens/supabase-store';
import { getTestAuthKeys } from '../test/jwt-helpers';

const A = '11111111-aaaa-4111-8111-111111111111';
const B = '22222222-bbbb-4222-8222-222222222222';
const H1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const H2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const APP = 'https://stage.autopw3.app';
const EU = 'https://fleet-api.prd.eu.vn.cloud.tesla.com';
const CALLBACK = '/api/v1/provider/tesla/callback';
const connectPath = (household = H1) => `/api/v1/households/${household}/provider/tesla/connect`;
const serviceKey = `${btoa(JSON.stringify({ alg: 'HS256' }))}.${btoa(JSON.stringify({ role: 'service_role' }))}.fixture`;
type Row = Record<string, unknown>;
let project = 0;

describe('durable staging OAuth through Worker entrypoint', () => {
  let env: Env;
  let jwt: string;
  let network: ReturnType<typeof vi.fn<typeof fetch>>;
  let states: Map<string, Row>;
  let credentials: Map<string, Row>;
  let role: string | null;
  let granted: Row;
  let region: unknown;
  let failure: string | undefined;
  let denyFinalSave: boolean;
  let limited: boolean;
  let encryptionKey: Uint8Array;

  async function sign(actor = A, extra: Row = {}) {
    const keys = await getTestAuthKeys();
    return new CompactSign(
      new TextEncoder().encode(
        JSON.stringify({
          sub: actor,
          iss: `${env.SUPABASE_URL}/auth/v1`,
          aud: 'authenticated',
          role: 'authenticated',
          exp: Math.floor(Date.now() / 1000) + 3600,
          ...extra,
        }),
      ),
    )
      .setProtectedHeader({ alg: 'RS256', kid: 'oauth-test' })
      .sign(keys.privateKey);
  }
  const request = (path: string, init: RequestInit = {}) =>
    worker.fetch(new Request(`${APP}${path}`, init), env);
  const connect = (household = H1, token = jwt, body: unknown = {}) =>
    request(connectPath(household), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        origin: APP,
      },
      body: JSON.stringify(body),
    });
  async function start() {
    const response = await connect();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { authorizeUrl: string };
    return new URL(body.authorizeUrl);
  }
  const callback = (state: string, extra = 'code=fixture-code') =>
    request(`${CALLBACK}?state=${state}&${extra}`);
  const count = (suffix: string) =>
    network.mock.calls.filter(([url]) => String(url).endsWith(suffix)).length;

  beforeEach(async () => {
    encryptionKey = crypto.getRandomValues(new Uint8Array(32));
    env = {
      ENVIRONMENT: 'staging',
      STAGING_TESLA_OAUTH_ENABLED: 'true',
      LOCAL_MOCKS: 'false',
      SUPABASE_URL: `https://oauth-${++project}.supabase.co`,
      SUPABASE_ANON_KEY: 'sb_publishable_fixture',
      SUPABASE_SECRET_KEY: serviceKey,
      ALLOWED_ORIGINS: APP,
      APP_BASE_URL: APP,
      TESLA_CLIENT_ID: 'fixture-client',
      TESLA_CLIENT_SECRET: `fixture-${crypto.randomUUID()}`,
      TESLA_REDIRECT_URI: `${APP}${CALLBACK}`,
      TESLA_FLEET_API_BASE_URL: EU,
      TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...encryptionKey)),
      ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    };
    jwt = await sign();
    states = new Map();
    credentials = new Map();
    role = 'ADMIN';
    failure = undefined;
    denyFinalSave = false;
    limited = false;
    granted = {
      access_token: `access-${crypto.randomUUID()}`,
      refresh_token: `refresh-${crypto.randomUUID()}`,
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'openid offline_access energy_device_data',
    };
    region = { response: { region: 'eu', fleet_api_base_url: EU } };
    const keys = await getTestAuthKeys();
    const jwk = {
      ...(await exportJWK(keys.publicKey)),
      kid: 'oauth-test',
      alg: 'RS256',
      use: 'sig',
    };
    network = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      const json = (value: unknown, status = 200) => Response.json(value, { status });
      if (url.pathname.endsWith('/jwks.json')) return json({ keys: [jwk] });
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url.origin === env.SUPABASE_URL) {
        const headers = new Headers(init?.headers);
        if (!url.pathname.includes('/rpc/')) {
          expect(headers.get('apikey')).toBe(env.SUPABASE_ANON_KEY);
          expect(headers.get('authorization')).toBe(`Bearer ${jwt}`);
          if (url.pathname.endsWith('/household_members')) {
            const own =
              url.searchParams.get('household_id') === `eq.${H1}` &&
              url.searchParams.get('user_id') === `eq.${A}`;
            return json(
              own && role ? [{ user_id: A, role, created_at: new Date().toISOString() }] : [],
            );
          }
          if (url.pathname.endsWith('/user_profiles'))
            return json([{ user_id: A, display_name: null, locale: null }]);
          throw new Error('Unexpected user read');
        }
        expect(headers.get('apikey')).toBe(serviceKey);
        expect(headers.get('authorization')).toBe(`Bearer ${serviceKey}`);
        const body = JSON.parse(String(init?.body)) as Row;
        if (failure === url.pathname.split('/').at(-1))
          return json({ message: 'sensitive database failure' }, 503);
        switch (url.pathname.split('/').at(-1)) {
          case 'worker_check_rate_limit':
            return json([{ allowed: !limited, retry_after_seconds: 60 }]);
          case 'worker_save_oauth_state':
            expect(body.p_household_id).toBe(H1);
            expect(body.p_user_id).toBe(A);
            states.set(String(body.p_state), {
              household_id: body.p_household_id,
              user_id: body.p_user_id,
              pkce_verifier_ciphertext: body.p_pkce_verifier_ciphertext,
              pkce_nonce: body.p_pkce_nonce,
              expires_at: body.p_expires_at,
            });
            return json(true);
          case 'worker_consume_oauth_state': {
            const state = states.get(String(body.p_state));
            states.delete(String(body.p_state));
            return json(state && Date.parse(String(state.expires_at)) > Date.now() ? [state] : []);
          }
          case 'worker_validate_oauth_actor':
            return json(role === 'ADMIN' && body.p_household_id === H1 && body.p_user_id === A);
          case 'worker_save_tesla_credentials_for_oauth':
            if (role !== 'ADMIN' || denyFinalSave) return json({ message: 'not_authorised' }, 403);
            expect(body.p_user_id).toBe(A);
            expect(body.p_household_id).toBe(H1);
            credentials.set(String(body.p_household_id), {
              nonce: body.p_nonce,
              ciphertext: body.p_ciphertext,
              version: body.p_version,
              scopes: body.p_scopes,
              fleet_api_base_url: body.p_fleet_api_base_url,
              access_expires_at: body.p_access_expires_at,
              status: 'ACTIVE',
            });
            return json(true);
          case 'worker_get_tesla_credentials':
            return json(
              credentials.has(String(body.p_household_id))
                ? [credentials.get(String(body.p_household_id))]
                : [],
            );
          default:
            throw new Error('Unexpected privileged RPC');
        }
      }
      if (String(input) === TESLA_TOKEN_URL) {
        expect(new URLSearchParams(String(init?.body)).get('audience')).toBe(EU);
        if (failure === 'token')
          return json({ error_description: `${env.TESLA_CLIENT_SECRET} fixture-code` }, 400);
        return json(granted);
      }
      if (String(input) === `${EU}/api/1/users/region`) {
        expect(new Headers(init?.headers).get('authorization')).toBe(
          `Bearer ${granted.access_token}`,
        );
        if (failure === 'region') throw new Error(String(granted.access_token));
        return json(region);
      }
      throw new Error('Unexpected outbound request');
    });
    vi.stubGlobal('fetch', network);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('persists encrypted state and tokens across fresh request/store instances without legacy fallback', async () => {
    const legacy = [
      vi.spyOn(InMemoryRepository.prototype, 'getMembership'),
      vi.spyOn(InMemoryOAuthStateStore.prototype, 'saveState'),
      vi.spyOn(InMemoryTokenStore.prototype, 'saveTokens'),
    ];
    const authorization = await start();
    expect(authorization.origin).toBe('https://auth.tesla.com');
    expect(authorization.searchParams.get('scope')).toBe(
      'openid offline_access energy_device_data',
    );
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('require_requested_scopes')).toBe('true');
    const response = await callback(authorization.searchParams.get('state')!);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/settings?tesla=connected&hid=${H1}`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const fresh = new SupabaseTokenStore(env.SUPABASE_URL!, serviceKey, encryptionKey);
    const tokens = await fresh.getTokens(H1);
    expect(tokens?.accessToken).toBe(granted.access_token);
    expect(await fresh.getTokens(H2)).toBeNull();
    expect(JSON.stringify([...credentials.values()])).not.toContain(granted.access_token);
    expect(JSON.stringify([...credentials.values()])).not.toContain(granted.refresh_token);
    legacy.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  it('allows exactly one simultaneous callback and rejects replay', async () => {
    const state = (await start()).searchParams.get('state')!;
    const responses = await Promise.all([callback(state), callback(state)]);
    expect(responses.map((response) => response.status).sort()).toEqual([302, 422]);
    expect((await callback(state)).status).toBe(422);
    expect(count('/oauth2/v3/token')).toBe(1);
    expect(count('/worker_save_tesla_credentials_for_oauth')).toBe(1);
  });

  it.each(['READ_ONLY', 'READ_WRITE', null])('denies connect for role %s', async (value) => {
    role = value;
    expect((await connect()).status).toBe(403);
    expect(states.size).toBe(0);
  });
  it('denies cross-household connect', async () => {
    expect((await connect(H2)).status).toBe(403);
    expect(states.size).toBe(0);
  });
  it('does not use a different authenticated actor for the requested household', async () => {
    jwt = await sign(B);
    expect((await connect()).status).toBe(403);
    expect(states.size).toBe(0);
  });
  it.each([true, { enableControls: true }, { householdId: H2 }, { scopes: ['energy_cmds'] }])(
    'rejects non-read-only connect body %j',
    async (body) => {
      expect((await connect(H1, jwt, body)).status).toBe(422);
      expect(states.size).toBe(0);
    },
  );
  it('denies callback after membership revocation before contacting Tesla', async () => {
    const state = (await start()).searchParams.get('state')!;
    role = null;
    expect((await callback(state)).status).toBe(403);
    expect(count('/oauth2/v3/token')).toBe(0);
  });
  it('does not report success if final transactional authorization fails', async () => {
    const state = (await start()).searchParams.get('state')!;
    denyFinalSave = true;
    expect((await callback(state)).status).toBe(502);
    expect(credentials.size).toBe(0);
  });
  it.each([
    'token',
    'region',
    'worker_consume_oauth_state',
    'worker_save_tesla_credentials_for_oauth',
  ])('sanitizes %s failures and never persists credentials', async (value) => {
    const state = (await start()).searchParams.get('state')!;
    failure = value;
    const response = await callback(state);
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).not.toContain(env.TESLA_CLIENT_SECRET);
    expect(body).not.toContain(granted.access_token);
    expect(body).not.toContain('fixture-code');
    expect(credentials.size).toBe(0);
  });
  it.each([
    'openid energy_device_data',
    'openid offline_access',
    'openid offline_access energy_device_data energy_cmds',
    '',
    undefined,
  ])('rejects insufficient or excessive granted scope %s', async (scope) => {
    const state = (await start()).searchParams.get('state')!;
    granted.scope = scope;
    expect((await callback(state)).status).toBe(502);
    expect(count('/api/1/users/region')).toBe(0);
    expect(credentials.size).toBe(0);
  });
  it.each([
    {},
    {
      response: { region: 'na', fleet_api_base_url: 'https://fleet-api.prd.na.vn.cloud.tesla.com' },
    },
    { response: { region: 'eu', fleet_api_base_url: 'https://attacker.invalid' } },
  ])('fails closed on missing, different or unapproved regional discovery %j', async (value) => {
    const state = (await start()).searchParams.get('state')!;
    region = value;
    expect((await callback(state)).status).toBe(502);
    expect(credentials.size).toBe(0);
  });
  it('consumes denial and expired state without exchanging codes', async () => {
    const state = (await start()).searchParams.get('state')!;
    expect((await callback(state, 'error=access_denied&error_description=private')).status).toBe(
      422,
    );
    expect((await callback(state)).status).toBe(422);
    const expired = (await start()).searchParams.get('state')!;
    states.get(expired)!.expires_at = new Date(0).toISOString();
    expect((await callback(expired)).status).toBe(422);
    expect(count('/oauth2/v3/token')).toBe(0);
  });
  it('enforces durable rate limits', async () => {
    limited = true;
    expect((await connect()).status).toBe(429);
    expect(states.size).toBe(0);
  });
  it.each([
    { refresh_token: '' },
    { expires_in: -1 },
    { expires_in: '3600' },
    { token_type: 'Basic' },
  ])('rejects invalid token exchange response %j', async (fields) => {
    const state = (await start()).searchParams.get('state')!;
    Object.assign(granted, fields);
    expect((await callback(state)).status).toBe(502);
    expect(credentials.size).toBe(0);
  });
  it('fails closed on durable state write failure', async () => {
    failure = 'worker_save_oauth_state';
    expect((await connect()).status).toBe(502);
    expect(states.size).toBe(0);
    expect(count('/oauth2/v3/token')).toBe(0);
  });
  it('rejects ciphertext moved to another household before calling Tesla', async () => {
    const state = (await start()).searchParams.get('state')!;
    states.get(state)!.household_id = H2;
    expect((await callback(state)).status).toBe(422);
    expect(count('/oauth2/v3/token')).toBe(0);
  });
  it('keeps cron disabled with the OAuth flag enabled', () => {
    expect(() => worker.scheduled({} as ScheduledController, env, {} as ExecutionContext)).toThrow(
      'Scheduled jobs are disabled',
    );
  });
  it.each([
    { exp: null },
    { aud: null },
    { aud: ['authenticated', 1] },
    { aud: 'wrong' },
    { role: 'service_role' },
    { iss: 'https://other.supabase.co/auth/v1' },
  ])('rejects malformed user identity %j before privileged access', async (claims) => {
    jwt = await sign(A, claims);
    expect((await connect()).status).toBe(401);
    expect(count('/worker_check_rate_limit')).toBe(0);
    expect(states.size).toBe(0);
  });
  it.each([
    'SUPABASE_SECRET_KEY',
    'SUPABASE_ANON_KEY',
    'TOKEN_ENCRYPTION_KEY',
    'TESLA_CLIENT_ID',
    'TESLA_CLIENT_SECRET',
    'TESLA_REDIRECT_URI',
    'TESLA_FLEET_API_BASE_URL',
    'APP_BASE_URL',
  ] as const)('fails closed without %s', async (name) => {
    env[name] = undefined;
    expect((await connect()).status).toBe(502);
    expect(network).not.toHaveBeenCalled();
  });
  it.each(['http://fleet-api.prd.eu.vn.cloud.tesla.com', `${EU}/`, 'https://attacker.invalid'])(
    'rejects invalid audience %s without network access',
    async (value) => {
      env.TESLA_FLEET_API_BASE_URL = value;
      expect((await connect()).status).toBe(502);
      expect(network).not.toHaveBeenCalled();
    },
  );
  it('allows only narrow connect preflight without network access', async () => {
    const preflight = (method: string) =>
      request(connectPath(), {
        method: 'OPTIONS',
        headers: {
          origin: APP,
          'access-control-request-method': method,
          'access-control-request-headers': 'authorization,content-type',
        },
      });
    const allowed = await preflight('POST');
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-methods')).toBe('POST');
    expect((await preflight('GET')).status).toBe(403);
    expect(network).not.toHaveBeenCalled();
  });
  it.each([
    `${connectPath()}/`,
    connectPath().replace('/connect', '/%63onnect'),
    '/api/v1/households/' + H1 + '/provider/tesla/sites',
    '/api/v1/sites/' + H1 + '/telemetry/live',
    '/api/v1/me',
    CALLBACK + '/',
  ])('keeps other routes blocked: %s', async (path) => {
    expect((await request(path, { method: 'POST' })).status).toBe(502);
    expect(network).not.toHaveBeenCalled();
  });
  it.each(['production', 'staging'])(
    'keeps %s OAuth closed without the exact staging flag',
    async (environment) => {
      env.ENVIRONMENT = environment;
      env.STAGING_TESLA_OAUTH_ENABLED = environment === 'staging' ? 'TRUE' : 'true';
      expect((await connect()).status).toBe(502);
      expect(network).not.toHaveBeenCalled();
    },
  );
  it('rejects callback household/actor overrides and duplicate state', async () => {
    const state = (await start()).searchParams.get('state')!;
    expect((await callback(state, `code=fixture&householdId=${H2}`)).status).toBe(422);
    expect((await callback(state, `code=fixture&state=${state}`)).status).toBe(422);
    expect(count('/oauth2/v3/token')).toBe(0);
  });
});
