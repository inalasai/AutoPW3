import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseAuthClient } from './supabase-client';
import { TeslaSiteFailure } from './tesla-sites';

const actor = {
  userId: '11111111-1111-4111-8111-000000000001',
  householdId: '99999999-9999-4999-8999-999999999999',
};
const providerSiteId = '12345678901234567890';
const key = 'fixture-stable-idempotency-key';
const credential = 'fixture-private-browser-session';
const session = {
  user: { id: actor.userId },
  access_token: credential,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
};
const discovery = { items: [{ providerSiteId, name: 'Provider site' }] };
const linked = {
  created: true,
  site: {
    id: '22222222-2222-4222-8222-222222222222',
    householdId: actor.householdId,
    provider: 'TESLA',
    providerSiteId,
    name: 'Persisted name',
    timezone: 'Europe/Dublin',
    connectionState: 'CONNECTING',
  },
};
function adapter(current: unknown = session, enabled = true) {
  const getSession = vi.fn().mockResolvedValue({ data: { session: current }, error: null });
  const auth = createSupabaseAuthClient(
    { url: 'https://fixture.supabase.co', anonKey: 'sb_publishable_fixture' },
    {
      stagingTeslaSites: enabled,
      origin: 'https://staging.example',
      client: { auth: { getSession } } as unknown as SupabaseClient,
    },
  );
  return { auth, sites: auth.teslaSites!, getSession };
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('private staging Tesla site API adapter', () => {
  function authorizationUrl(overrides: Record<string, string> = {}) {
    const query = new URLSearchParams({
      client_id: 'fixture-client',
      response_type: 'code',
      redirect_uri: 'https://staging.example/api/v1/provider/tesla/callback',
      scope: 'openid offline_access energy_device_data',
      code_challenge_method: 'S256',
      state: 'fixture-state',
      code_challenge: 'fixture-challenge',
      ...overrides,
    });
    return `https://auth.tesla.com/oauth2/v3/authorize?${query}`;
  }

  it('starts OAuth only on an explicit call with the current private session and read-only restart', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ authorizeUrl: authorizationUrl() }));
    vi.stubGlobal('fetch', fetcher);
    const { sites } = adapter();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(sites.connect!(actor)).resolves.toEqual({ authorizeUrl: authorizationUrl() });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://staging.example/api/v1/households/${actor.householdId}/provider/tesla/connect`,
    );
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ enableControls: false, restart: true }),
      headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    });
  });

  it.each([
    'https://unapproved.invalid/authorize',
    authorizationUrl({ scope: 'openid offline_access energy_device_data energy_cmds' }),
    authorizationUrl({ redirect_uri: 'https://unapproved.invalid/callback' }),
    authorizationUrl({ code_challenge_method: 'plain' }),
  ])('rejects an unsafe OAuth redirect (%#)', async (authorizeUrl) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ authorizeUrl })));
    await expect(adapter().sites.connect!(actor)).rejects.toEqual(
      new TeslaSiteFailure('invalid_response'),
    );
  });
  it.each([
    ['TESLA_REAUTHORIZATION_REQUIRED', 'reauthorization_required'],
    ['TESLA_RECOVERY_REQUIRED', 'recovery_required'],
  ] as const)('recognizes only fixed discovery recovery issue %s', async (issue, kind) => {
    const fetcher = vi.fn().mockResolvedValue(
      json(
        {
          error: {
            code: 'CONFLICT',
            message: credential,
            requestId: 'fixture',
            details: [{ path: 'provider.tesla', issue }],
          },
        },
        409,
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    const error = await adapter()
      .sites.discover(actor)
      .catch((value: unknown) => value);
    expect(error).toEqual(new TeslaSiteFailure(kind));
    expect(JSON.stringify(error)).not.toContain(credential);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    {
      error: {
        code: 'CONFLICT',
        details: [{ path: 'other', issue: 'TESLA_REAUTHORIZATION_REQUIRED' }],
      },
    },
    {
      error: {
        code: 'INTERNAL',
        details: [{ path: 'provider.tesla', issue: 'TESLA_REAUTHORIZATION_REQUIRED' }],
      },
    },
    { error: { code: 'CONFLICT', details: [{ path: 'provider.tesla', issue: credential }] } },
    {
      error: {
        code: 'CONFLICT',
        message: 'x'.repeat(5000),
        details: [{ path: 'provider.tesla', issue: 'TESLA_REAUTHORIZATION_REQUIRED' }],
      },
    },
  ])('discards unknown or oversized conflict bodies (%#)', async (body) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json({ error: { message: 'Conflict', requestId: 'fixture', ...body.error } }, 409),
        ),
    );
    await expect(adapter().sites.discover(actor)).rejects.toEqual(new TeslaSiteFailure('conflict'));
  });

  it('does not reinterpret linking conflicts as provider recovery', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: 'CONFLICT',
              details: [{ path: 'provider.tesla', issue: 'TESLA_REAUTHORIZATION_REQUIRED' }],
            },
          },
          409,
        ),
      ),
    );
    await expect(adapter().sites.link(actor, providerSiteId, key)).rejects.toEqual(
      new TeslaSiteFailure('conflict'),
    );
  });

  it('is absent unless explicitly configured for staging', () => {
    expect(adapter(session, false).auth.teslaSites).toBeUndefined();
    const api = adapter().auth;
    expect(api).not.toHaveProperty('supabase');
    expect(api).not.toHaveProperty('access_token');
    expect(window).not.toHaveProperty('supabase');
  });

  it('discovers using only the current private session and same-origin authenticated GET', async () => {
    const fetcher = vi.fn().mockResolvedValue(json(discovery));
    vi.stubGlobal('fetch', fetcher);
    const result = await adapter().sites.discover(actor);
    expect(result).toEqual(discovery);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://staging.example/api/v1/households/${actor.householdId}/provider/tesla/discovered-sites`,
    );
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(init).not.toHaveProperty('body');
    expect(JSON.stringify(result)).not.toContain(credential);
  });

  it('reuses the caller key across ambiguous failures and validates persisted metadata', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ sensitive: credential }, 502))
      .mockResolvedValueOnce(json(linked, 201));
    vi.stubGlobal('fetch', fetcher);
    const { sites } = adapter();
    await expect(sites.link(actor, providerSiteId, key)).rejects.toMatchObject({
      kind: 'unavailable',
    });
    await expect(sites.link(actor, providerSiteId, key)).resolves.toEqual(linked);
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).toBe(
        `https://staging.example/api/v1/households/${actor.householdId}/sites`,
      );
      expect(init).toMatchObject({
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${credential}`,
          'Idempotency-Key': key,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ providerSiteId }),
      });
    }
  });

  it('accepts the authoritative duplicate result without fabricating a new site', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...linked, created: false })));
    await expect(adapter().sites.link(actor, providerSiteId, key)).resolves.toEqual({
      ...linked,
      created: false,
    });
  });

  it.each([
    null,
    { ...session, expires_at: Math.floor(Date.now() / 1000) - 1 },
    { ...session, user: { id: 'different-current-account' } },
    { ...session, access_token: '' },
  ])('fails before HTTP when the session is absent, expired or changed (%#)', async (current) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { sites } = adapter(current);
    await expect(sites.discover(actor)).rejects.toMatchObject({ kind: 'expired_session' });
    await expect(sites.link(actor, providerSiteId, key)).rejects.toMatchObject({
      kind: 'expired_session',
    });
    await expect(sites.connect!(actor)).rejects.toMatchObject({ kind: 'expired_session' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sanitizes session lookup failures', async () => {
    const { sites, getSession } = adapter();
    getSession.mockRejectedValue(new Error(credential));
    await expect(sites.discover(actor)).rejects.toEqual(new TeslaSiteFailure('unavailable'));
  });

  it.each([
    [401, 'expired_session'],
    [403, 'forbidden'],
    [409, 'conflict'],
    [422, 'invalid_request'],
    [429, 'rate_limited'],
    [502, 'unavailable'],
    [301, 'unavailable'],
    [302, 'unavailable'],
    [303, 'unavailable'],
    [307, 'unavailable'],
    [308, 'unavailable'],
  ])('maps HTTP %s to a fixed category without reading its body', async (status, kind) => {
    const response = json({ credential, message: credential }, status as number);
    const read = vi.spyOn(response, 'json');
    const fetcher = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetcher);
    await expect(adapter().sites.discover(actor)).rejects.toEqual(
      new TeslaSiteFailure(kind as TeslaSiteFailure['kind']),
    );
    expect(read).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...linked, site: { ...linked.site, householdId: actor.userId } },
    { ...linked, site: { ...linked.site, providerSiteId: '999' } },
    { ...linked, access_token: credential },
  ])('rejects mismatched/unsafe persisted results (%#)', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body)));
    await expect(adapter().sites.link(actor, providerSiteId, key)).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it.each([
    { items: [{ providerSiteId: 'not-numeric', name: null }] },
    { items: [...discovery.items, ...discovery.items] },
    { items: [], access_token: credential },
  ])('rejects malformed or duplicate discovery metadata (%#)', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body)));
    await expect(adapter().sites.discover(actor)).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('reports empty results honestly and sanitizes malformed JSON without logging', async () => {
    const logs = ['log', 'info', 'warn', 'error', 'debug'].map((method) =>
      vi.spyOn(console, method as 'log').mockImplementation(() => undefined),
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(new Response(credential));
    vi.stubGlobal('fetch', fetcher);
    const { sites } = adapter();
    await expect(sites.discover(actor)).resolves.toEqual({ items: [] });
    await expect(sites.discover(actor)).rejects.toEqual(new TeslaSiteFailure('invalid_response'));
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it('validates UUIDs, numeric provider IDs and keys before any request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { sites } = adapter();
    await expect(sites.discover({ ...actor, householdId: '../other' })).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    await expect(sites.link(actor, '1e7', key)).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(sites.link(actor, providerSiteId, 'bad\nkey')).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds fetch time and sanitizes redirect/network rejections', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error(credential)));
          }),
      ),
    );
    const pending = expect(adapter().sites.discover(actor)).rejects.toEqual(
      new TeslaSiteFailure('unavailable'),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(credential)));
    await expect(adapter().sites.discover(actor)).rejects.toEqual(
      new TeslaSiteFailure('unavailable'),
    );
  });

  it('does not send a request after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(adapter().sites.discover(actor, controller.signal)).rejects.toMatchObject({
      kind: 'cancelled',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
