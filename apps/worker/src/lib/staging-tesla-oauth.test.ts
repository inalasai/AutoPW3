import { CompactSign, exportJWK } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import worker from '../index';
import { InMemoryRepository } from '../db/repository';
import { InMemoryOAuthStateStore, TESLA_TOKEN_URL } from '../providers/tesla/oauth';
import { InMemoryTokenStore } from '../services/tokens/store';
import { SupabaseTokenStore } from '../services/tokens/supabase-store';
import { getTestAuthKeys } from '../test/jwt-helpers';
import {
  oauthBrowserLeaseKey,
  readOAuthBrowserCookie,
  TESLA_OAUTH_COOKIE,
} from './staging-tesla-oauth-cookie';

const A = '11111111-aaaa-4111-8111-111111111111';
const B = '22222222-bbbb-4222-8222-222222222222';
const H1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const H2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
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
  let browserCookie: string | undefined;
  let leases: Map<string, { owner: string; expiresAt: number }>;
  let sessionActive: boolean;

  async function sign(actor = A, extra: Row = {}) {
    const keys = await getTestAuthKeys();
    return new CompactSign(
      new TextEncoder().encode(
        JSON.stringify({
          sub: actor,
          iss: `${env.SUPABASE_URL}/auth/v1`,
          aud: 'authenticated',
          role: 'authenticated',
          session_id: SESSION,
          exp: Math.floor(Date.now() / 1000) + 3600,
          ...extra,
        }),
      ),
    )
      .setProtectedHeader({ alg: 'RS256', kid: 'oauth-test' })
      .sign(keys.privateKey);
  }
  const request = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (browserCookie && !headers.has('cookie')) headers.set('cookie', browserCookie);
    const response = await worker.fetch(new Request(`${APP}${path}`, { ...init, headers }), env);
    const cookie = response.headers.get('set-cookie');
    if (cookie) browserCookie = cookie.includes('Max-Age=0') ? undefined : cookie.split(';')[0];
    return response;
  };
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
  const callback = (state: string, extra = 'code=fixture-code') => {
    const params = new URLSearchParams(extra);
    return request(CALLBACK, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, origin: APP, 'content-type': 'application/json' },
      body: JSON.stringify({
        state,
        ...(params.has('code') ? { code: params.get('code') } : { error: 'authorization_denied' }),
      }),
    });
  };
  const callbackFromBrowser = (state: string, cookie?: string) =>
    worker.fetch(
      new Request(`${APP}${CALLBACK}`, {
        method: 'POST',
        headers: {
          ...(cookie ? { cookie } : {}),
          authorization: `Bearer ${jwt}`,
          origin: APP,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ state, code: 'fixture-code' }),
      }),
      env,
    );
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
    leases = new Map();
    sessionActive = true;
    browserCookie = undefined;
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
      expect(init?.redirect).toBe('manual');
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
          case 'worker_begin_tesla_oauth': {
            if (!sessionActive || body.p_session_id !== SESSION || role !== 'ADMIN')
              return json(false);
            const keys = [
              `staging:tesla:oauth:household:${body.p_household_id}`,
              await oauthBrowserLeaseKey(String(body.p_user_id)),
            ];
            if (
              !body.p_restart &&
              keys.some((key) => (leases.get(key)?.expiresAt ?? 0) > Date.now())
            )
              return json(false);
            for (const key of keys)
              leases.set(key, { owner: String(body.p_owner), expiresAt: Date.now() + 720_000 });
            return json(true);
          }
          case 'worker_release_lock': {
            const key = String(body.p_key);
            if (leases.get(key)?.owner !== body.p_owner) return json(false);
            leases.delete(key);
            return json(true);
          }
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
            if (!state || Date.parse(String(state.expires_at)) <= Date.now()) return json([]);
            states.delete(String(body.p_state));
            return json([state]);
          }
          case 'worker_validate_tesla_oauth_session': {
            const keys = [
              `staging:tesla:oauth:household:${body.p_household_id}`,
              await oauthBrowserLeaseKey(String(body.p_user_id)),
            ];
            return json(
              sessionActive &&
                body.p_session_id === SESSION &&
                Date.parse(String(body.p_session_expires_at)) > Date.now() &&
                role === 'ADMIN' &&
                body.p_household_id === H1 &&
                body.p_user_id === A &&
                keys.every(
                  (key) =>
                    leases.get(key)?.owner === body.p_owner &&
                    leases.get(key)!.expiresAt > Date.now(),
                ),
            );
          }
          case 'worker_save_tesla_credentials_fenced_for_oauth':
            if (
              role !== 'ADMIN' ||
              !sessionActive ||
              body.p_session_id !== SESSION ||
              denyFinalSave ||
              leases.get(`staging:tesla:oauth:household:${body.p_household_id}`)?.owner !==
                body.p_owner ||
              leases.get(await oauthBrowserLeaseKey(String(body.p_user_id)))?.owner !== body.p_owner
            )
              return json({ message: 'not_authorised' }, 403);
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
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ connected: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(leases.size).toBe(0);
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
    expect(responses.map((response) => response.status).sort()).toEqual([200, 422]);
    expect((await callback(state)).status).toBe(403);
    expect(count('/oauth2/v3/token')).toBe(1);
    expect(count('/worker_save_tesla_credentials_fenced_for_oauth')).toBe(1);
  });

  it('requires a same-browser cookie before any state consumption or other privileged I/O', async () => {
    const state = (await start()).searchParams.get('state')!;
    const validCookie = browserCookie!;
    expect(validCookie.startsWith(`${TESLA_OAUTH_COOKIE}=`)).toBe(true);
    const [payload, signature] = validCookie.slice(TESLA_OAUTH_COOKIE.length + 1).split('.');
    const incorrect = `${TESLA_OAUTH_COOKIE}=${payload}.${signature![0] === 'A' ? 'B' : 'A'}${signature!.slice(1)}`;
    for (const cookie of [
      undefined,
      `${TESLA_OAUTH_COOKIE}=incorrect`,
      incorrect,
      `${validCookie}; ${validCookie}`,
    ]) {
      network.mockClear();
      const response = await callbackFromBrowser(state, cookie);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(network).not.toHaveBeenCalled();
      expect(states.has(state)).toBe(true);
      expect(credentials.size).toBe(0);
      expect(leases.size).toBe(2);
    }
    expect((await callback(state)).status).toBe(200);
  });

  it('rejects another browser/transaction cookie without canceling the current pending transaction', async () => {
    const stateA = (await start()).searchParams.get('state')!;
    const cookieA = browserCookie!;
    expect((await callback(stateA)).status).toBe(200);
    const stateB = (await start()).searchParams.get('state')!;
    const cookieB = browserCookie!;
    const saved = credentials.get(H1);
    expect(cookieA).not.toBe(cookieB);
    network.mockClear();
    const wrongBrowser = await callbackFromBrowser(stateB, cookieA);
    expect(wrongBrowser.status).toBe(422);
    expect(wrongBrowser.headers.has('set-cookie')).toBe(false);
    expect(network).not.toHaveBeenCalled();
    expect(states.has(stateB)).toBe(true);
    expect(credentials.get(H1)).toBe(saved);
    const staleCallback = await callbackFromBrowser(stateA, cookieB);
    expect(staleCallback.status).toBe(422);
    expect(staleCallback.headers.has('set-cookie')).toBe(false);
    expect(network).not.toHaveBeenCalled();
    expect((await callback(stateB)).status).toBe(200);
  });

  it('rejects an expired correlation cookie before consuming even a still-present state', async () => {
    const state = (await start()).searchParams.get('state')!;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600_001);
    network.mockClear();
    const response = await callback(state);
    expect(response.status).toBe(422);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(network).not.toHaveBeenCalled();
    expect(states.has(state)).toBe(true);
    expect(credentials.size).toBe(0);
  });

  it('serializes simultaneous initial attempts without cookies and rejects a second pending attempt', async () => {
    const responses = await Promise.all([connect(), connect()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(states.size).toBe(1);
    expect(leases.size).toBe(2);
    const cookie = browserCookie;
    const creates = count('/worker_save_oauth_state');
    const acquires = count('/worker_begin_tesla_oauth');
    expect((await connect()).status).toBe(409);
    expect(browserCookie).toBe(cookie);
    expect(count('/worker_save_oauth_state')).toBe(creates);
    expect(count('/worker_begin_tesla_oauth')).toBe(acquires + 1);
    expect(count('/oauth2/v3/token')).toBe(0);
    expect((await callback([...states.keys()][0]!)).status).toBe(200);
    expect(leases.size).toBe(0);
    expect((await connect()).status).toBe(200);
  });

  it('does not let a concurrent replay release the winning callback lease', async () => {
    const state = (await start()).searchParams.get('state')!;
    const cookie = browserCookie!;
    let unblock!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gateway = network.getMockImplementation()!;
    network.mockImplementation(async (input, init) => {
      if (String(input) === TESLA_TOKEN_URL) {
        started();
        await gate;
      }
      return gateway(input, init);
    });
    const winning = callback(state);
    await entered;
    try {
      expect((await callbackFromBrowser(state, cookie)).status).toBe(422);
      expect(count('/worker_release_lock')).toBe(0);
      expect(leases.size).toBe(2);
      const freshBrowser = await request(connectPath(), {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', cookie: '' },
        body: '{}',
      });
      expect(freshBrowser.status).toBe(409);
    } finally {
      unblock();
      // Finish provider I/O under the mock even if an assertion above fails.
      await winning;
    }
    expect((await winning).status).toBe(200);
    expect(count('/oauth2/v3/token')).toBe(1);
    expect(count('/worker_save_tesla_credentials_fenced_for_oauth')).toBe(1);
    expect(leases.size).toBe(0);
  });

  it('recovers an abandoned attempt after the bounded lease without accepting its old cookie', async () => {
    const old = (await start()).searchParams.get('state')!;
    const cookie = browserCookie!;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 720_001);
    const fresh = (await start()).searchParams.get('state')!;
    expect(fresh).not.toBe(old);
    expect((await callbackFromBrowser(old, cookie)).status).toBe(422);
    expect(count('/oauth2/v3/token')).toBe(0);
    expect((await callback(fresh)).status).toBe(200);
  });

  it('never exposes correlation, PKCE or Tesla secrets through JSON, errors or logs', async () => {
    const logs = ['log', 'warn', 'error', 'info'].map((method) =>
      vi.spyOn(console, method as 'log' | 'warn' | 'error' | 'info'),
    );
    const response = await connect(H1, jwt, { enableControls: false });
    const initiation = await response.text();
    const state = new URL(
      (JSON.parse(initiation) as { authorizeUrl: string }).authorizeUrl,
    ).searchParams.get('state')!;
    const binding = await readOAuthBrowserCookie(
      new Request(APP, { headers: { cookie: browserCookie! } }),
      encryptionKey,
    );
    const cookie = browserCookie!;
    failure = 'token';
    const terminal = await callback(state);
    const error = await terminal.text();
    const exchange = network.mock.calls.find(([url]) => String(url) === TESLA_TOKEN_URL)!;
    const verifier = new URLSearchParams(String(exchange[1]?.body)).get('code_verifier')!;
    const visible = `${initiation}${error}${JSON.stringify(logs.map((spy) => spy.mock.calls))}`;
    for (const secret of [
      binding!.secret,
      cookie,
      verifier,
      String(granted.access_token),
      String(granted.refresh_token),
      env.TESLA_CLIENT_SECRET!,
    ]) {
      expect(visible).not.toContain(secret);
    }
    expect(terminal.status).toBe(502);
    expect(terminal.headers.get('set-cookie')).toBeNull();
    expect(leases.size).toBe(0);
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
    'worker_save_tesla_credentials_fenced_for_oauth',
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
    expect((await callback(state)).status).toBe(403);
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
    expect(leases.size).toBe(0);
    expect(browserCookie).toBeUndefined();
  });

  it('fails closed when the pending-attempt lease cannot be acquired', async () => {
    failure = 'worker_begin_tesla_oauth';
    expect((await connect()).status).toBe(502);
    expect(states.size).toBe(0);
    expect(browserCookie).toBeUndefined();
    expect(count('/oauth2/v3/token')).toBe(0);
  });

  it('keeps completed credentials safe if owner-matched lease cleanup fails', async () => {
    const state = (await start()).searchParams.get('state')!;
    failure = 'worker_release_lock';
    const response = await callback(state);
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(credentials.size).toBe(1);
    expect(leases.size).toBe(2);
    expect(browserCookie).toBeDefined();
    expect((await connect()).status).toBe(409);
    expect((await connect(H1, jwt, { restart: true })).status).toBe(200);
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
    expect(
      (await request(`${CALLBACK}?state=${state}&code=fixture&householdId=${H2}`)).status,
    ).toBe(422);
    expect((await request(`${CALLBACK}?state=${state}&code=fixture&state=${state}`)).status).toBe(
      422,
    );
    expect(count('/oauth2/v3/token')).toBe(0);
  });

  it('uses the GET callback only as a same-origin fragment bridge, with no privileged or Tesla I/O', async () => {
    const state = (await start()).searchParams.get('state')!;
    network.mockClear();
    const response = await request(`${CALLBACK}?state=${state}&code=fixture-code`);
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe(APP);
    expect(location.pathname).toBe('/auth/tesla/callback');
    expect(location.search).toBe('');
    const fragment = new URLSearchParams(location.hash.slice(1));
    expect(fragment.get('tesla_state')).toBe(state);
    expect(fragment.get('tesla_code')).toBe('fixture-code');
    for (const reserved of ['state', 'code', 'error', 'error_description'])
      expect(fragment.has(reserved)).toBe(false);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(network).not.toHaveBeenCalled();
    expect(states.has(state)).toBe(true);
    expect((await callback(state)).status).toBe(200);
  });

  it('accepts the exact Tesla issuer without using it to select provider endpoints', async () => {
    const state = (await start()).searchParams.get('state')!;
    const params = new URLSearchParams({
      code: 'fixture-code',
      issuer: 'https://auth.tesla.com/oauth2/v3',
      state,
    });
    network.mockClear();
    const response = await request(`${CALLBACK}?${params}`);
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe(APP);
    const fragment = new URLSearchParams(location.hash.slice(1));
    expect(fragment.get('tesla_state')).toBe(state);
    expect(fragment.get('tesla_code')).toBe('fixture-code');
    expect(fragment.has('issuer')).toBe(false);
    expect(network).not.toHaveBeenCalled();
    expect(states.has(state)).toBe(true);
    expect((await callback(state)).status).toBe(200);
    expect(count('/oauth2/v3/token')).toBe(1);
    expect(network.mock.calls.some(([url]) => String(url) === TESLA_TOKEN_URL)).toBe(true);
    expect(count('/api/1/users/region')).toBe(1);
  });

  it.each([
    'https://attacker.invalid/oauth2/v3',
    'https://auth.tesla.com/oauth2/v3/',
    'http://auth.tesla.com/oauth2/v3',
    '',
  ])('rejects a mismatched Tesla issuer %j before privileged or provider I/O', async (issuer) => {
    const state = (await start()).searchParams.get('state')!;
    const params = new URLSearchParams({ code: 'fixture-code', state, issuer });
    network.mockClear();
    const response = await request(`${CALLBACK}?${params}`);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', message: 'Invalid Tesla callback' },
    });
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(network).not.toHaveBeenCalled();
    expect(states.has(state)).toBe(true);
    expect(credentials.size).toBe(0);
  });

  it('rejects duplicate issuer parameters even when both match Tesla', async () => {
    const state = (await start()).searchParams.get('state')!;
    const params = new URLSearchParams({
      code: 'fixture-code',
      state,
      issuer: 'https://auth.tesla.com/oauth2/v3',
    });
    params.append('issuer', 'https://auth.tesla.com/oauth2/v3');
    network.mockClear();
    const response = await request(`${CALLBACK}?${params}`);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', message: 'Invalid Tesla callback' },
    });
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(network).not.toHaveBeenCalled();
    expect(states.has(state)).toBe(true);
    expect(credentials.size).toBe(0);
  });

  it('does not expose Tesla denial as a Supabase Auth error callback', async () => {
    const state = (await start()).searchParams.get('state')!;
    network.mockClear();
    const response = await request(
      `${CALLBACK}?state=${state}&error=access_denied&error_description=fixture-private-description`,
    );
    const destination = new URL(response.headers.get('location')!);
    const fragment = new URLSearchParams(destination.hash.slice(1));
    expect(response.status).toBe(303);
    expect(fragment.get('tesla_error')).toBe('authorization_denied');
    expect(fragment.has('error')).toBe(false);
    expect(destination.href).not.toContain('fixture-private-description');
    expect(network).not.toHaveBeenCalled();
    expect(states.has(state)).toBe(true);
  });

  it.each(['logout', 'other_account', 'other_session', 'expired', 'missing_session'])(
    'rejects %s completion before consuming the transaction or contacting Tesla',
    async (kind) => {
      const state = (await start()).searchParams.get('state')!;
      let token: string | undefined = jwt;
      if (kind === 'logout') token = undefined;
      if (kind === 'other_account') token = await sign(B);
      if (kind === 'other_session') token = await sign(A, { session_id: crypto.randomUUID() });
      if (kind === 'expired') token = await sign(A, { exp: 1 });
      if (kind === 'missing_session') token = await sign(A, { session_id: null });
      const response = await request(CALLBACK, {
        method: 'POST',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          origin: APP,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ state, code: 'fixture-code' }),
      });
      expect(response.status).toBe(401);
      expect(response.headers.has('set-cookie')).toBe(false);
      expect(count('/worker_consume_oauth_state')).toBe(0);
      expect(count('/oauth2/v3/token')).toBe(0);
      expect(states.has(state)).toBe(true);
      expect(credentials.size).toBe(0);
    },
  );

  it('rejects a still-unexpired JWT after its Auth session was revoked', async () => {
    const state = (await start()).searchParams.get('state')!;
    sessionActive = false;
    expect((await callback(state)).status).toBe(403);
    expect(count('/worker_consume_oauth_state')).toBe(0);
    expect(count('/oauth2/v3/token')).toBe(0);
    expect(credentials.size).toBe(0);
  });

  it('accepts token refresh only within the same initiating Auth session', async () => {
    const state = (await start()).searchParams.get('state')!;
    jwt = await sign(A, { exp: Math.floor(Date.now() / 1000) + 1800 });
    expect((await callback(state)).status).toBe(200);
  });

  it('fences credential persistence if logout happens during the provider request', async () => {
    const state = (await start()).searchParams.get('state')!;
    const gateway = network.getMockImplementation()!;
    network.mockImplementation(async (input, init) => {
      if (String(input) === TESLA_TOKEN_URL) sessionActive = false;
      return gateway(input, init);
    });
    expect((await callback(state)).status).toBe(502);
    expect(credentials.size).toBe(0);
  });

  it('delivers old success, invalid-correlation and replay responses after B without deleting B cookie', async () => {
    const stateA = (await start()).searchParams.get('state')!;
    const cookieA = browserCookie!;
    const invalid = await callbackFromBrowser(stateA);
    const success = await callback(stateA);
    const replay = await callbackFromBrowser(stateA, cookieA);
    const stateB = (await start()).searchParams.get('state')!;
    const cookieB = browserCookie!;
    // Model the browser applying delayed response headers after B's initiation Set-Cookie.
    for (const delayed of [replay, invalid, success]) {
      const header = delayed.headers.get('set-cookie');
      if (header) browserCookie = header.includes('Max-Age=0') ? undefined : header.split(';')[0];
      expect(header).toBeNull();
      expect(browserCookie).toBe(cookieB);
    }
    expect((await callback(stateB)).status).toBe(200);
  });

  it('explicitly restarts a stale pending attempt without accepting or releasing its old owner', async () => {
    const stateA = (await start()).searchParams.get('state')!;
    const cookieA = browserCookie!;
    expect((await connect()).status).toBe(409);
    const restarted = await connect(H1, jwt, { restart: true });
    expect(restarted.status).toBe(200);
    const stateB = new URL(
      ((await restarted.json()) as { authorizeUrl: string }).authorizeUrl,
    ).searchParams.get('state')!;
    expect((await callbackFromBrowser(stateA, cookieA)).status).toBe(403);
    expect(leases.size).toBe(2);
    expect(count('/oauth2/v3/token')).toBe(0);
    expect((await callback(stateB)).status).toBe(200);
  });

  it('rejects A delayed persistence after an HTTP failure and successful newer B completion', async () => {
    const stateA = (await start()).searchParams.get('state')!;
    const gateway = network.getMockImplementation()!;
    let late: [RequestInfo | URL, RequestInit | undefined] | undefined;
    network.mockImplementationOnce(async (input, init) => gateway(input, init));
    network.mockImplementation(async (input, init) => {
      if (!late && String(input).endsWith('/worker_save_tesla_credentials_fenced_for_oauth')) {
        late = [input, init];
        return Response.json(
          { message: 'fixture failed response before delayed save' },
          { status: 503 },
        );
      }
      return gateway(input, init);
    });
    expect((await callback(stateA)).status).toBe(502);
    const stateB = (await start()).searchParams.get('state')!;
    expect((await callback(stateB)).status).toBe(200);
    const savedB = credentials.get(H1);
    expect(late).toBeDefined();
    expect((await gateway(...late!)).status).toBe(403);
    expect(credentials.get(H1)).toBe(savedB);
  });
});
