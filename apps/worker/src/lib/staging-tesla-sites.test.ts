import { CompactSign, exportJWK } from 'jose';
import { ErrorResponseSchema } from '@autopw3/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import worker from '../index';
import { InMemoryRepository } from '../db/repository';
import { MockTeslaClient } from '../providers/tesla/mock-adapter';
import { InMemoryTokenStore, type DecryptedTokens } from '../services/tokens/store';
import { SupabaseTokenStore } from '../services/tokens/supabase-store';
import { getTestAuthKeys } from '../test/jwt-helpers';

const A = '11111111-aaaa-4111-8111-111111111111';
const B = '22222222-bbbb-4222-8222-222222222222';
const H1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const H2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const APP = 'https://stage.autopw3.app';
const EU = 'https://fleet-api.prd.eu.vn.cloud.tesla.com';
const service = `${btoa(JSON.stringify({ alg: 'HS256' }))}.${btoa(JSON.stringify({ role: 'service_role' }))}.fixture`;
const discovery = (hh = H1) => `/api/v1/households/${hh}/provider/tesla/discovered-sites`;
const linking = (hh = H1) => `/api/v1/households/${hh}/sites`;
type Row = Record<string, unknown>;
let project = 0;

describe('staging discovery and durable linking through the Worker entrypoint', () => {
  let env: Env;
  let jwt: string;
  let actor: string;
  let role: string | null;
  let activeSession: boolean;
  let key: Uint8Array;
  let tokens: DecryptedTokens;
  let saved: Map<string, Row>;
  let sites: Map<string, Row>;
  let requests: Map<string, { proof: string; id: string; result?: Row }>;
  let network: ReturnType<typeof vi.fn<typeof fetch>>;
  let providerStatus: number;
  let products: unknown;
  let failure: string | undefined;
  let stamp: string;
  let revokeDuringProvider: boolean;
  let rotateDuringProvider: boolean;
  let limited: boolean;
  let refreshAttempt:
    { id: string; owner: string; state: string; payload?: Row; result?: Row } | undefined;
  let refreshAttempts: Map<string, NonNullable<typeof refreshAttempt>>;
  let refreshCalls: number;
  let refreshMode: string;
  let rotatedTokens: DecryptedTokens;
  let loseStage: boolean;
  let loseCommit: boolean;
  async function sign(user = A, extra: Row = {}) {
    const keys = await getTestAuthKeys();
    return new CompactSign(
      new TextEncoder().encode(
        JSON.stringify({
          sub: user,
          role: 'authenticated',
          aud: 'authenticated',
          iss: `${env.SUPABASE_URL}/auth/v1`,
          exp: Math.floor(Date.now() / 1000) + 3600,
          session_id: SID,
          ...extra,
        }),
      ),
    )
      .setProtectedHeader({ alg: 'RS256', kid: 'site-test' })
      .sign(keys.privateKey);
  }
  const request = (path = discovery(), init: RequestInit = {}, token: string | null = jwt) => {
    const headers = new Headers(init.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    return worker.fetch(new Request(`${APP}${path}`, { ...init, headers }), env);
  };
  const link = (id = '123', idempotency = 'fixture-key-0001', hh = H1, extra: Row = {}) =>
    request(linking(hh), {
      method: 'POST',
      headers: { origin: APP, 'content-type': 'application/json', 'idempotency-key': idempotency },
      body: JSON.stringify({ provider: 'TESLA', providerSiteId: id, ...extra }),
    });
  const count = (suffix: string) =>
    network.mock.calls.filter(([url]) => String(url).endsWith(suffix)).length;
  async function seed(overrides: Partial<DecryptedTokens> = {}) {
    tokens = { ...tokens, ...overrides };
    await new SupabaseTokenStore(env.SUPABASE_URL!, service, key).saveTokens(H1, tokens);
    network.mockClear();
  }
  beforeEach(async () => {
    actor = A;
    role = 'ADMIN';
    activeSession = true;
    key = crypto.getRandomValues(new Uint8Array(32));
    env = {
      ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
      ENVIRONMENT: 'staging',
      STAGING_TESLA_SITES_ENABLED: 'true',
      LOCAL_MOCKS: 'false',
      PROVIDER_MODE: 'mock',
      SUPABASE_URL: `https://site-link-${++project}.supabase.co`,
      SUPABASE_ANON_KEY: 'sb_publishable_fixture',
      SUPABASE_SECRET_KEY: service,
      ALLOWED_ORIGINS: APP,
      APP_BASE_URL: APP,
      TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...key)),
    };
    jwt = await sign();
    saved = new Map();
    sites = new Map();
    requests = new Map();
    providerStatus = 200;
    products = {
      response: [{ energy_site_id: '123', site_name: 'Fixture' }, { vin: 'fixture-vehicle' }],
    };
    failure = undefined;
    stamp = 'a'.repeat(64);
    revokeDuringProvider = false;
    rotateDuringProvider = false;
    limited = false;
    refreshAttempt = undefined;
    refreshAttempts = new Map();
    refreshCalls = 0;
    refreshMode = 'ok';
    loseStage = false;
    loseCommit = false;
    env.TESLA_CLIENT_ID = 'fixture-client';
    env.TESLA_CLIENT_SECRET = 'fixture-client-secret';
    tokens = {
      accessToken: `access-${crypto.randomUUID()}`,
      refreshToken: `refresh-${crypto.randomUUID()}`,
      tokenType: 'Bearer',
      scope: 'openid offline_access energy_device_data',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      regionBaseUrl: EU,
    };
    rotatedTokens = {
      ...tokens,
      accessToken: 'fixture-rotated-access',
      refreshToken: 'fixture-rotated-refresh',
    };
    const keys = await getTestAuthKeys();
    const jwk = {
      ...(await exportJWK(keys.publicKey)),
      kid: 'site-test',
      alg: 'RS256',
      use: 'sig',
    };
    network = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/jwks.json')) return Response.json({ keys: [jwk] });
      expect(init?.redirect).toBe('manual');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url.origin === env.SUPABASE_URL) {
        const body = JSON.parse(String(init?.body)) as Row;
        const name = url.pathname.split('/').at(-1);
        const userRpc = [
          'tesla_site_link_context',
          'link_discovered_tesla_site',
          'tesla_discovery_refresh_context',
          'begin_tesla_discovery_refresh',
          'finish_tesla_discovery_refresh',
        ].includes(name!);
        const headers = new Headers(init?.headers);
        expect(headers.get('apikey')).toBe(userRpc ? env.SUPABASE_ANON_KEY : service);
        expect(headers.get('authorization')).toBe(`Bearer ${userRpc ? jwt : service}`);
        if (failure === name)
          return Response.json({ message: 'fixture-sensitive-database-body' }, { status: 503 });
        if (
          userRpc &&
          (actor !== A || body.p_household_id !== H1 || role !== 'ADMIN' || !activeSession)
        )
          return Response.json({ code: '42501', message: 'not_authorised' }, { status: 403 });
        switch (name) {
          case 'worker_check_rate_limit':
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
            return Response.json(saved.has(H1) ? [saved.get(H1)] : []);
          case 'tesla_discovery_refresh_context':
            if (saved.get(H1)?.status === 'NEEDS_REAUTH')
              return Response.json(
                { code: '55000', message: 'tesla_reauthorization_required' },
                { status: 500 },
              );
            if (!saved.has(H1) || saved.get(H1)!.status !== 'ACTIVE')
              return new Response('{}', { status: 500 });
            return Response.json({
              credentialRevision: stamp,
              needsRefresh: tokens.expiresAt <= Date.now() / 1000 + 30,
            });
          case 'begin_tesla_discovery_refresh':
            if (body.p_revision !== stamp) return new Response('{}', { status: 409 });
            refreshAttempt = refreshAttempts.get(stamp);
            if (refreshAttempt?.state === 'SENT')
              return Response.json(
                { code: '55000', message: 'refresh_recovery_required' },
                { status: 500 },
              );
            if (refreshAttempt?.state === 'READY') {
              refreshAttempt.owner = String(body.p_owner);
            } else
              refreshAttempt = {
                id: crypto.randomUUID(),
                owner: String(body.p_owner),
                state: 'SENT',
              };
            refreshAttempts.set(stamp, refreshAttempt);
            return Response.json({ attemptId: refreshAttempt.id, state: refreshAttempt.state });
          case 'worker_stage_tesla_discovery_refresh':
            expect(Object.keys(body).sort()).toEqual(['p_attempt_id', 'p_owner', 'p_payload']);
            if (!refreshAttempt || body.p_owner !== refreshAttempt.owner)
              return new Response('{}', { status: 409 });
            if (refreshMode === 'stage-failed') return new Response('{}', { status: 503 });
            refreshAttempt.payload = body.p_payload as Row;
            refreshAttempt.state = 'READY';
            if (loseStage) throw new Error('fixture-lost-stage-response');
            return Response.json(true);
          case 'finish_tesla_discovery_refresh': {
            expect(Object.keys(body).sort()).toEqual(['p_attempt_id', 'p_household_id', 'p_owner']);
            if (!refreshAttempt || body.p_owner !== refreshAttempt.owner)
              return new Response('{}', { status: 409 });
            if (refreshAttempt.result) return Response.json(refreshAttempt.result);
            if (refreshMode === 'commit-failed' || refreshMode === 'commit-after-lost-response')
              return new Response('{}', { status: 503 });
            if (refreshMode === 'replaced') return new Response('{}', { status: 409 });
            if (refreshAttempt.state !== 'READY') return new Response('{}', { status: 409 });
            const payload = refreshAttempt.payload!;
            const outcome =
              payload.outcome === 'TOKEN' &&
              Date.parse(String(payload.expiresAt)) <= Date.now() + 30_000
                ? 'REAUTH'
                : payload.outcome;
            if (outcome === 'TOKEN') {
              saved.set(H1, {
                nonce: payload.nonce,
                ciphertext: payload.ciphertext,
                version: payload.version,
                scopes: payload.scopes,
                fleet_api_base_url: payload.region,
                access_expires_at: payload.expiresAt,
                status: 'ACTIVE',
              });
              tokens = rotatedTokens;
            } else saved.get(H1)!.status = 'NEEDS_REAUTH';
            stamp = 'c'.repeat(64);
            refreshAttempt.state = 'COMMITTED';
            delete refreshAttempt.payload;
            refreshAttempt.result = { credentialRevision: stamp, outcome };
            if (loseCommit) {
              loseCommit = false;
              throw new Error('fixture-lost-commit-response');
            }
            return Response.json(refreshAttempt.result);
          }
          case 'worker_release_lock':
            return Response.json(true);
          case 'tesla_site_link_context':
            return Response.json({ credentialRevision: stamp });
          case 'worker_prepare_tesla_site_link': {
            expect(body.p_user_id).toBe(A);
            expect(body.p_session_id).toBe(SID);
            expect(body.p_household_id).toBe(H1);
            if (role !== 'ADMIN' || !activeSession) return new Response('false', { status: 403 });
            if (body.p_credential_revision !== stamp) return new Response('false', { status: 409 });
            const k = String(body.p_idempotency_key);
            const existing = requests.get(k);
            if (existing && existing.id !== body.p_provider_site_id)
              return new Response('false', { status: 409 });
            if (!existing)
              requests.set(k, { proof: crypto.randomUUID(), id: String(body.p_provider_site_id) });
            return Response.json(requests.get(k)!.proof);
          }
          case 'link_discovered_tesla_site': {
            const r = requests.get(String(body.p_idempotency_key));
            if (!r || r.proof !== body.p_proof_id) return new Response('false', { status: 403 });
            if (r.result) return Response.json(r.result);
            const existing = sites.get(r.id);
            if (existing && existing.householdId !== H1)
              return new Response('false', { status: 409 });
            const site = existing ?? {
              id: crypto.randomUUID(),
              householdId: H1,
              provider: 'TESLA',
              providerSiteId: r.id,
              name: 'Fixture',
              timezone: 'Europe/Dublin',
              connectionState: 'CONNECTING',
            };
            sites.set(r.id, site);
            r.result = { created: !existing, site };
            return Response.json(r.result);
          }
          default:
            throw new Error('Unexpected database request');
        }
      }
      if (url.hostname === 'fleet-auth.prd.vn.cloud.tesla.com') {
        expect(url.pathname).toBe('/oauth2/v3/token');
        expect(init?.method).toBe('POST');
        expect(new URLSearchParams(String(init?.body)).get('refresh_token')).toBe(
          tokens.refreshToken,
        );
        refreshCalls++;
        if (refreshMode === 'network') throw new Error('fixture-provider-private-body');
        if (refreshMode === 'revoked')
          return Response.json(
            { error: 'login_required', error_description: 'fixture-private-body' },
            { status: 401 },
          );
        if (refreshMode === 'demoted') role = 'READ_ONLY';
        if (refreshMode === 'replaced') stamp = 'b'.repeat(64);
        if (refreshMode === 'slow')
          return new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new Error('fixture-abort'))),
          );
        rotatedTokens = { ...rotatedTokens, expiresAt: Math.floor(Date.now() / 1000) + 3600 };
        return Response.json({
          access_token: rotatedTokens.accessToken,
          refresh_token: rotatedTokens.refreshToken,
          expires_in: 3600,
          token_type: 'Bearer',
          scope: rotatedTokens.scope,
        });
      }
      expect(url.origin).toBe(EU);
      expect(url.pathname).toBe('/api/1/products');
      expect(init?.method).toBe('GET');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${tokens.accessToken}`);
      if (revokeDuringProvider) role = null;
      if (rotateDuringProvider) stamp = 'b'.repeat(64);
      if (failure === 'network') throw new Error(tokens.accessToken);
      if (failure === 'timeout')
        return new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('fixture-timeout'))),
        );
      if (failure === 'json') return new Response('fixture-private-response');
      if (providerStatus >= 300 && providerStatus < 400)
        return new Response(null, {
          status: providerStatus,
          headers: { location: 'https://redirect.invalid/never' },
        });
      return Response.json(products, { status: providerStatus, headers: { 'retry-after': '42' } });
    });
    vi.stubGlobal('fetch', network);
    await seed();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('refreshes expired credentials once, encrypts rotation, and discovers with the committed revision', async () => {
    await seed({ expiresAt: Math.floor(Date.now() / 1000) - 3600 });
    const oldAccess = tokens.accessToken;
    const response = await request();
    expect(response.status).toBe(200);
    expect(refreshCalls).toBe(1);
    expect(count('/api/1/products')).toBe(1);
    expect(refreshAttempt?.state).toBe('COMMITTED');
    expect(JSON.stringify(saved.get(H1))).not.toContain(rotatedTokens.refreshToken);
    expect(JSON.stringify(saved.get(H1))).not.toContain(rotatedTokens.accessToken);
    const visible = await response.text();
    for (const secret of [oldAccess, rotatedTokens.accessToken, rotatedTokens.refreshToken])
      expect(visible).not.toContain(secret);
  });
  it('leaves valid credentials on discovery without an exchange or refresh write', async () => {
    expect((await request()).status).toBe(200);
    expect(refreshCalls).toBe(0);
    expect(refreshAttempt).toBeUndefined();
  });
  it.each(['REVOKED', 'NEEDS_REAUTH'])(
    'never refreshes %s database credentials',
    async (status) => {
      saved.get(H1)!.status = status;
      expect((await request()).status).toBe(status === 'NEEDS_REAUTH' ? 409 : 502);
      expect(refreshCalls).toBe(0);
      expect(count('/api/1/products')).toBe(0);
    },
  );
  it('records definitive refresh revocation without expiring the Supabase session', async () => {
    await seed({ expiresAt: 1 });
    refreshMode = 'revoked';
    const response = await request();
    expect(response.status).toBe(409);
    expect(saved.get(H1)!.status).toBe('NEEDS_REAUTH');
    expect(activeSession).toBe(true);
    expect(count('/api/1/products')).toBe(0);
    expect(await response.text()).not.toContain('fixture-private-body');
  });
  it.each(['network', 'stage-failed'])(
    'never blindly repeats a rotation after %s',
    async (mode) => {
      await seed({ expiresAt: 1 });
      refreshMode = mode;
      expect((await request()).status).toBeGreaterThanOrEqual(400);
      const repeated = await request();
      expect(repeated.status).toBe(409);
      expect(await repeated.text()).toContain('TESLA_RECOVERY_REQUIRED');
      expect(refreshCalls).toBe(1);
      expect(refreshAttempt?.state).toBe('SENT');
      expect(count('/api/1/products')).toBe(0);
    },
  );
  it.each(['stage', 'commit'])(
    'reconciles a lost %s response without repeating the exchange',
    async (phase) => {
      await seed({ expiresAt: 1 });
      loseStage = phase === 'stage';
      loseCommit = phase === 'commit';
      expect((await request()).status).toBe(200);
      expect(refreshCalls).toBe(1);
    },
  );
  it('recovers a durable READY result on a later request without contacting the token endpoint', async () => {
    await seed({ expiresAt: 1 });
    refreshMode = 'commit-failed';
    expect((await request()).status).toBe(502);
    expect(refreshAttempt?.state).toBe('READY');
    refreshMode = 'ok';
    expect((await request()).status).toBe(200);
    expect(refreshCalls).toBe(1);
  });
  it('terminalizes expired READY and repeatedly returns explicit reauthorization without exchanging its pair', async () => {
    await seed({ expiresAt: 1 });
    refreshMode = 'commit-failed';
    expect((await request()).status).toBe(502);
    refreshAttempt!.payload!.expiresAt = new Date(Date.now() - 1_000).toISOString();
    refreshMode = 'ok';
    for (let retry = 0; retry < 3; retry++) {
      const response = await request();
      expect(response.status).toBe(409);
      const body: unknown = await response.json();
      expect(ErrorResponseSchema.safeParse(body).success).toBe(true);
      expect(JSON.stringify(body)).toContain('TESLA_REAUTHORIZATION_REQUIRED');
    }
    expect(refreshCalls).toBe(1);
    expect(count('/api/1/products')).toBe(0);
    expect(saved.get(H1)!.status).toBe('NEEDS_REAUTH');
    expect(refreshAttempt?.state).toBe('COMMITTED');
    expect(refreshAttempt?.payload).toBeUndefined();
    expect(tokens.expiresAt).toBe(1);
  });
  it.each(['network', 'stage-failed'])(
    'fences an ambiguous %s exchange of the activated next generation independently',
    async (mode) => {
      await seed({ expiresAt: 1 });
      expect((await request()).status).toBe(200);
      const parent = refreshAttempt;
      await seed({ expiresAt: 1 });
      expect(tokens.refreshToken).toBe('fixture-rotated-refresh');
      rotatedTokens = {
        ...rotatedTokens,
        accessToken: 'fixture-second-access',
        refreshToken: 'fixture-second-rotated-refresh',
      };
      refreshMode = mode;
      expect((await request()).status).toBe(mode === 'network' ? 502 : 409);
      expect((await request()).status).toBe(409);
      expect(refreshCalls).toBe(2);
      expect(parent?.state).toBe('COMMITTED');
      expect(refreshAttempt?.state).toBe('SENT');
      expect(refreshAttempts.size).toBe(2);
      expect(count('/api/1/products')).toBe(0);
    },
  );
  it('terminalizes a revoked activated next generation without retry or Supabase logout', async () => {
    await seed({ expiresAt: 1 });
    expect((await request()).status).toBe(200);
    await seed({ expiresAt: 1 });
    refreshMode = 'revoked';
    expect((await request()).status).toBe(409);
    expect((await request()).status).toBe(409);
    expect(refreshCalls).toBe(2);
    expect(activeSession).toBe(true);
    expect(saved.get(H1)!.status).toBe('NEEDS_REAUTH');
  });
  it.each(['logout', 'demotion', 'replacement'])(
    'preserves expired READY and newer credentials after %s',
    async (change) => {
      await seed({ expiresAt: 1 });
      refreshMode = 'commit-failed';
      expect((await request()).status).toBe(502);
      refreshAttempt!.payload!.expiresAt = new Date(0).toISOString();
      if (change === 'logout') activeSession = false;
      else if (change === 'demotion') role = 'READ_ONLY';
      // Replacement must be detected at finish even if it occurs after begin.
      refreshMode = change === 'replacement' ? 'replaced' : 'ok';
      expect((await request()).status).toBe(change === 'replacement' ? 409 : 403);
      expect(saved.get(H1)!.status).toBe('ACTIVE');
      expect(refreshCalls).toBe(1);
    },
  );
  it.each(['demoted', 'replaced'])(
    'cannot activate or read products after credentials are %s',
    async (mode) => {
      await seed({ expiresAt: 1 });
      refreshMode = mode;
      expect((await request()).status).toBe(mode === 'demoted' ? 403 : 409);
      expect(count('/api/1/products')).toBe(0);
      expect(tokens.expiresAt).toBe(1);
    },
  );
  it('concurrent expired discovery never exchanges the same revision twice', async () => {
    await seed({ expiresAt: 1 });
    const responses = await Promise.all([request(), request()]);
    expect(responses.some((r) => r.status === 200)).toBe(true);
    expect(refreshCalls).toBe(1);
  });

  it('discovers only real energy IDs and safe names, without persistence or legacy mocks', async () => {
    const mocks = [
      vi.spyOn(InMemoryRepository.prototype, 'createSite'),
      vi.spyOn(MockTeslaClient.prototype, 'listProducts'),
      vi.spyOn(InMemoryTokenStore.prototype, 'getTokens'),
    ];
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [{ providerSiteId: '123', name: 'Fixture' }] });
    expect(sites.size).toBe(0);
    expect(requests.size).toBe(0);
    mocks.forEach((m) => expect(m).not.toHaveBeenCalled());
  });
  it('links through user JWT RPC and persists across fresh Worker requests with stable idempotent results', async () => {
    const first = await link();
    expect(first.status).toBe(201);
    const result = await first.json();
    expect(result).toMatchObject({
      created: true,
      site: { householdId: H1, providerSiteId: '123', connectionState: 'CONNECTING' },
    });
    const retry = await link();
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(result);
    expect(sites.size).toBe(1);
    expect(requests.size).toBe(1);
    expect(JSON.stringify(result)).not.toContain(tokens.accessToken);
    expect(JSON.stringify(result)).not.toContain(tokens.refreshToken);
    expect(JSON.stringify(result)).not.toContain('proof');
    expect(JSON.stringify(result)).not.toContain('capabilities');
  });
  it('concurrent requests share one durable result and different keys cannot duplicate a site', async () => {
    const both = await Promise.all([link(), link()]);
    expect(await both[0]!.json()).toEqual(await both[1]!.json());
    expect(sites.size).toBe(1);
    expect((await link('123', 'another-key-0002')).status).toBe(200);
    expect(sites.size).toBe(1);
  });
  it('rejects idempotency key reuse with a different selected site', async () => {
    products = { response: [{ energy_site_id: '123' }, { energy_site_id: '456' }] };
    expect((await link()).status).toBe(201);
    expect((await link('456')).status).toBe(409);
    expect(sites.size).toBe(1);
  });
  it('never moves a site linked to another household', async () => {
    sites.set('123', { householdId: H2 });
    expect((await link()).status).toBe(409);
    expect(sites.get('123')?.householdId).toBe(H2);
  });
  it.each(['READ_ONLY', 'READ_WRITE', null])(
    'denies %s before credential retrieval or Tesla calls',
    async (r) => {
      role = r;
      expect((await request()).status).toBe(403);
      expect((await link()).status).toBe(403);
      expect(count('/worker_get_tesla_credentials')).toBe(0);
      expect(count('/api/1/products')).toBe(0);
    },
  );
  it('denies cross-household requests and another actor', async () => {
    expect((await request(discovery(H2))).status).toBe(403);
    expect((await link('123', 'fixture-key-0001', H2)).status).toBe(403);
    actor = B;
    jwt = await sign(B);
    expect((await request()).status).toBe(403);
    expect(count('/worker_get_tesla_credentials')).toBe(0);
  });
  it('requires an active Supabase session, not merely an unexpired JWT', async () => {
    activeSession = false;
    expect((await link()).status).toBe(403);
    expect(count('/api/1/products')).toBe(0);
  });
  it.each([
    null,
    { exp: 1 },
    { session_id: null },
    { aud: 'wrong' },
    { aud: ['authenticated', 1] },
  ])('rejects invalid authentication %j before privileged requests', async (claims) => {
    const token = claims ? await sign(A, claims) : null;
    expect((await request(discovery(), {}, token)).status).toBe(401);
    expect(count('/worker_check_rate_limit')).toBe(0);
    expect(count('/worker_get_tesla_credentials')).toBe(0);
  });
  it.each(['../123', '0', '123?command=1', '01', '1e3', ''])(
    'rejects invalid site ID %j before provider calls',
    async (id) => {
      expect((await link(id)).status).toBe(422);
      expect(count('/api/1/products')).toBe(0);
    },
  );
  it('rejects unowned IDs without preparing or persisting a link', async () => {
    expect((await link('456')).status).toBe(404);
    expect(count('/worker_prepare_tesla_site_link')).toBe(0);
    expect(sites.size).toBe(0);
  });
  it.each([
    { householdId: H2 },
    { scopes: ['energy_cmds'] },
    { name: 'client-controlled' },
    { timezone: 'UTC' },
    { enableControls: true },
  ])('rejects extra mutation fields %j', async (body) => {
    expect((await link('123', 'fixture-key-0001', H1, body)).status).toBe(422);
    expect(count('/api/1/products')).toBe(0);
  });
  it.each([401, 403, 404, 429, 500, 503, 301, 302, 303, 307, 308])(
    'sanitizes Tesla HTTP %s and never writes',
    async (status) => {
      providerStatus = status;
      const response = await link();
      expect(response.status).toBe(status === 429 ? 429 : 502);
      expect(await response.text()).not.toContain(tokens.accessToken);
      expect(requests.size).toBe(0);
      expect(sites.size).toBe(0);
      expect(network.mock.calls.some(([url]) => String(url).includes('redirect.invalid'))).toBe(
        false,
      );
    },
  );
  it.each(['network', 'json'])('fails closed on provider %s failure', async (f) => {
    failure = f;
    expect((await link()).status).toBe(502);
    expect(sites.size).toBe(0);
  });
  it('times out product requests without retries or persistence', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    failure = 'timeout';
    const pending = link();
    await vi.waitFor(() => expect(count('/api/1/products')).toBe(1));
    expect(timeout).toHaveBeenCalledWith(10_000);
    controller.abort();
    expect((await pending).status).toBe(502);
    expect(count('/api/1/products')).toBe(1);
    expect(sites.size).toBe(0);
  });
  it.each([
    {},
    { response: {} },
    { response: [{ energy_site_id: 9007199254740992 }] },
    { response: [{ energy_site_id: 'bad' }] },
    { response: [{ energy_site_id: '123' }, { energy_site_id: '123' }] },
  ])('rejects malformed products %j', async (value) => {
    products = value;
    expect((await link()).status).toBe(502);
    expect(sites.size).toBe(0);
  });
  it('preserves long string IDs, converts safe numbers and refuses unsafe provider names', async () => {
    products = {
      response: [
        { energy_site_id: '9007199254740993', site_name: '<script>fixture</script>' },
        { energy_site_id: 456 },
      ],
    };
    const response = await request();
    expect(await response.json()).toEqual({
      items: [
        { providerSiteId: '9007199254740993', name: null },
        { providerSiteId: '456', name: null },
      ],
    });
  });
  it.each(['discovery', 'link'])(
    'rechecks revocation during %s provider I/O',
    async (operation) => {
      revokeDuringProvider = true;
      expect((await (operation === 'link' ? link() : request())).status).toBe(403);
      expect(sites.size).toBe(0);
    },
  );
  it.each(['discovery', 'link'])('rejects credential rotation during %s', async (operation) => {
    rotateDuringProvider = true;
    expect((await (operation === 'link' ? link() : request())).status).toBe(409);
    expect(sites.size).toBe(0);
  });
  it.each([
    'tesla_site_link_context',
    'worker_get_tesla_credentials',
    'worker_prepare_tesla_site_link',
    'link_discovered_tesla_site',
  ])('fails closed on database %s failure', async (f) => {
    failure = f;
    const response = await link();
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('fixture-sensitive-database-body');
    expect(sites.size).toBe(0);
  });
  it('replays a committed result after a lost final HTTP response', async () => {
    const gateway = network.getMockImplementation()!;
    let lost = false;
    network.mockImplementation(async (input, init) => {
      const response = await gateway(input, init);
      if (String(input).endsWith('/link_discovered_tesla_site') && !lost) {
        lost = true;
        return new Response('fixture-private', { status: 503 });
      }
      return response;
    });
    expect((await link()).status).toBe(502);
    const savedSite = sites.get('123');
    expect((await link()).status).toBe(201);
    expect(sites.get('123')).toBe(savedSite);
    expect(sites.size).toBe(1);
  });
  it.each([
    { scope: 'openid offline_access energy_device_data energy_cmds' },
    { scope: 'openid offline_access' },
    { expiresAt: 1 },
    { regionBaseUrl: 'https://attacker.invalid' },
  ])('denies unsafe credential metadata %j', async (changes) => {
    await seed(changes);
    expect((await link()).status).toBe(502);
    expect(count('/api/1/products')).toBe(0);
  });
  it('rechecks authorization between backend verification and the user mutation', async () => {
    const gateway = network.getMockImplementation()!;
    network.mockImplementation(async (input, init) => {
      const response = await gateway(input, init);
      if (String(input).endsWith('/worker_prepare_tesla_site_link')) activeSession = false;
      return response;
    });
    expect((await link()).status).toBe(403);
    expect(sites.size).toBe(0);
  });

  it.each(['household', 'providerId', 'name'])(
    'fails closed on unexpected database result %s',
    async (field) => {
      const gateway = network.getMockImplementation()!;
      network.mockImplementation(async (input, init) => {
        const response = await gateway(input, init);
        if (String(input).endsWith('/link_discovered_tesla_site') && response.ok) {
          const result = (await response.json()) as { created: boolean; site: Row };
          if (field === 'household') result.site.householdId = H2;
          if (field === 'providerId') result.site.providerSiteId = '456';
          if (field === 'name') result.site.name = '<script>fixture-private</script>';
          return Response.json(result);
        }
        return response;
      });
      const response = await link();
      expect(response.status).toBe(502);
      const visible = await response.text();
      expect(visible).not.toContain(H2);
      expect(visible).not.toContain('fixture-private');
    },
  );

  it('never exposes credentials, provider bodies or verification proofs in errors or logs', async () => {
    const logs = ['log', 'info', 'warn', 'error'].map((method) =>
      vi.spyOn(console, method as 'log' | 'info' | 'warn' | 'error'),
    );
    providerStatus = 500;
    products = { private: `${tokens.accessToken} ${tokens.refreshToken} fixture-sensitive-body` };
    const response = await link();
    const visible = (await response.text()) + JSON.stringify(logs.map((log) => log.mock.calls));
    for (const value of [
      tokens.accessToken,
      tokens.refreshToken,
      'fixture-sensitive-body',
      env.SUPABASE_SECRET_KEY!,
    ])
      expect(visible).not.toContain(value);
  });

  it('requires credentials and durable rate limiting', async () => {
    saved.clear();
    expect((await link()).status).toBe(502);
    limited = true;
    expect((await request()).status).toBe(429);
    expect(count('/api/1/products')).toBe(0);
  });
  it.each([
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SECRET_KEY',
    'TOKEN_ENCRYPTION_KEY',
    'APP_BASE_URL',
  ] as const)('fails closed without %s', async (name) => {
    env[name] = undefined;
    expect((await request()).status).toBe(502);
    expect(network).not.toHaveBeenCalled();
  });
  it.each(['production', 'local', 'staging'])(
    'keeps %s closed without an exact staging opt-in',
    async (environment) => {
      env.ENVIRONMENT = environment;
      env.STAGING_TESLA_SITES_ENABLED = environment === 'staging' ? 'TRUE' : 'true';
      expect((await request()).status).toBe(502);
      expect(network).not.toHaveBeenCalled();
    },
  );
  it.each([
    discovery() + '/',
    discovery().replace('discovered', '%64iscovered'),
    discovery() + '?host=evil',
    linking() + '/',
    '/api/v1/me',
    linking() + '/commands',
    `/api/v1/households/${H1}/sites/${SID}/provider/tesla/live-status`,
  ])('keeps other paths and query overrides closed: %s', async (path) => {
    expect((await request(path)).status).toBe(path.includes('?') ? 422 : 502);
    expect(count('/api/1/products')).toBe(0);
  });
  it('permits only route-specific preflights and leaves cron blocked', async () => {
    for (const [path, method] of [
      [discovery(), 'GET'],
      [linking(), 'POST'],
    ]) {
      const preflight = await request(path, {
        method: 'OPTIONS',
        headers: {
          origin: APP,
          'access-control-request-method': method!,
          'access-control-request-headers': 'authorization,content-type,idempotency-key',
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-methods')).toBe(method);
    }
    expect(network).not.toHaveBeenCalled();
    expect(() => worker.scheduled({} as ScheduledController, env, {} as ExecutionContext)).toThrow(
      'Scheduled jobs are disabled',
    );
  });
});
