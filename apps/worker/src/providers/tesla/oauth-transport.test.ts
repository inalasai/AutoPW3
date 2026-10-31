import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeslaClient } from './client';
import { exchangeAuthorizationCode, validateReadOnlyTeslaScopes } from './oauth';
import { teslaJson } from './http';

const EU = 'https://fleet-api.prd.eu.vn.cloud.tesla.com';
const options = {
  clientId: 'fixture-client',
  clientSecret: 'fixture-client-secret',
  redirectUri: 'https://stage.autopw3.app/api/v1/provider/tesla/callback',
  code: 'fixture-code',
  codeVerifier: 'fixture-pkce',
  audience: EU,
};
const scopes = 'openid offline_access energy_device_data';
const token = (claim: unknown) => `${btoa('{}')}.${btoa(JSON.stringify({ scp: claim }))}.fixture`;
const response = (access_token: string, scope?: string) =>
  Response.json({
    access_token,
    refresh_token: 'fixture-refresh',
    token_type: 'Bearer',
    expires_in: 3600,
    ...(scope ? { scope } : {}),
  });

describe('Tesla authorization transport and granted scopes', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
  });
  async function listen(server: Server) {
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it.each([301, 302, 303, 307, 308])(
    'never forwards OAuth credentials or region bearer tokens after HTTP %s',
    async (status) => {
      let destinationHits = 0;
      const destination = await listen(
        createServer((_request, res) => {
          destinationHits++;
          res.end('{}');
        }),
      );
      const source = await listen(
        createServer((_request, res) => {
          res.writeHead(status, { location: destination });
          res.end('sensitive-provider-body');
        }),
      );
      const logs = [
        vi.spyOn(console, 'log'),
        vi.spyOn(console, 'warn'),
        vi.spyOn(console, 'error'),
      ];
      // Fixed Tesla URLs are mapped to loopback solely by this test's injected fetcher.
      const localFetch: typeof fetch = (_input, init) => fetch(source, init);
      const errors = await Promise.all([
        exchangeAuthorizationCode(options, localFetch).catch((error: unknown) => error),
        new TeslaClient(localFetch)
          .getRegion('fixture-bearer', EU)
          .catch((error: unknown) => error),
      ]);
      expect(destinationHits).toBe(0);
      errors.forEach((error) => {
        expect(error).toBeInstanceOf(Error);
        for (const sensitive of [
          'fixture-client-secret',
          'fixture-code',
          'fixture-bearer',
          'sensitive-provider-body',
        ])
          expect(String(error)).not.toContain(sensitive);
      });
      logs.forEach((log) => expect(log).not.toHaveBeenCalled());
    },
  );

  it('aborts bounded authorization requests and strips transport errors', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      expect(milliseconds).toBe(10_000);
      return controller.signal;
    });
    const fetcher: typeof fetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('private transport message')),
        );
        controller.abort();
      });
    await expect(exchangeAuthorizationCode(options, fetcher)).rejects.toThrow(
      'authorization_exchange_failed',
    );
  });
  it('bounds provider response bodies', async () => {
    await expect(
      teslaJson('https://auth.tesla.com', {}, async () => new Response('x'.repeat(65537))),
    ).rejects.toThrow('Tesla authorization service unavailable');
  });
  it.each([scopes, scopes.split(' ')])(
    'uses documented access-token scp when scope is omitted: %j',
    async (claim) => {
      const result = await exchangeAuthorizationCode(options, async () => response(token(claim)));
      expect(result.scope).toBe(scopes);
      expect(() => validateReadOnlyTeslaScopes(result.scope)).not.toThrow();
    },
  );
  it.each([null, 3, [], ['energy_device_data', 3], ['energy_device_data offline_access'], {}])(
    'rejects malformed scp %j',
    async (claim) => {
      await expect(
        exchangeAuthorizationCode(options, async () => response(token(claim))),
      ).rejects.toThrow('authorization_exchange_failed');
    },
  );
  it('rejects contradictory scope response and token claims', async () => {
    await expect(
      exchangeAuthorizationCode(options, async () =>
        response(token(scopes), `${scopes} energy_cmds`),
      ),
    ).rejects.toThrow('authorization_exchange_failed');
  });
  it('rejects unapproved audiences before transmitting credentials', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      exchangeAuthorizationCode({ ...options, audience: 'https://attacker.invalid' }, fetcher),
    ).rejects.toThrow('Unsupported Tesla Fleet origin');
    await expect(
      new TeslaClient(fetcher).getRegion('fixture', 'http://fleet-api.prd.eu.vn.cloud.tesla.com'),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
