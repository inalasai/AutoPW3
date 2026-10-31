import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedPostgrestClient } from './postgrest';
import { createPrivilegedRpcClient } from './system-client';

describe('credential-bearing transports reject real HTTP redirects', () => {
  let origin: Server;
  let destination: Server;
  let baseUrl: string;
  let destinationHits: number;
  let originHits: number;
  let redirectStatus: number;
  let receivedHeaders: IncomingHttpHeaders;

  async function listen(server: Server) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return (server.address() as AddressInfo).port;
  }

  beforeEach(async () => {
    destinationHits = originHits = 0;
    redirectStatus = 307;
    receivedHeaders = {};
    destination = createServer((_request, response) => {
      destinationHits += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ unexpected: 'redirect was followed' }));
    });
    const destinationPort = await listen(destination);
    origin = createServer((request, response) => {
      originHits += 1;
      receivedHeaders = request.headers;
      response.writeHead(redirectStatus, {
        location: `http://localhost:${destinationPort}/private-target`,
      });
      response.end('must-not-leak-redirect-body');
    });
    baseUrl = `http://localhost:${await listen(origin)}`;
  });

  afterEach(async () => {
    await Promise.all(
      [origin, destination].filter(Boolean).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
    vi.restoreAllMocks();
  });

  it.each([301, 302, 303, 307, 308])(
    'rejects authenticated PostgREST HTTP %s without contacting the destination',
    async (status) => {
      redirectStatus = status;
      const logs = [
        vi.spyOn(console, 'log'),
        vi.spyOn(console, 'warn'),
        vi.spyOn(console, 'error'),
      ];
      const client = new AuthenticatedPostgrestClient(
        baseUrl,
        'synthetic-api-key',
        'synthetic-user-jwt',
      );
      const error: unknown = await client
        .select('user_profiles', new URLSearchParams({ limit: '1' }))
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({ name: 'SupabasePostgrestError', status: 0 });
      expect(originHits).toBe(1);
      expect(destinationHits).toBe(0);
      expect(receivedHeaders.apikey).toBe('synthetic-api-key');
      expect(receivedHeaders.authorization).toBe('Bearer synthetic-user-jwt');
      for (const sensitive of [
        'synthetic-api-key',
        'synthetic-user-jwt',
        'private-target',
        'must-not-leak',
      ]) {
        expect(String(error)).not.toContain(sensitive);
      }
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    },
  );

  it.each([301, 302, 303, 307, 308])(
    'rejects privileged RPC HTTP %s without contacting the destination',
    async (status) => {
      redirectStatus = status;
      const logs = [
        vi.spyOn(console, 'log'),
        vi.spyOn(console, 'warn'),
        vi.spyOn(console, 'error'),
      ];
      const client = createPrivilegedRpcClient(baseUrl, 'synthetic-api-key');
      const error: unknown = await client
        .call('worker_check_rate_limit', {})
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({ name: 'SupabaseRpcError', status: 0 });
      expect(originHits).toBe(1);
      expect(destinationHits).toBe(0);
      expect(receivedHeaders.apikey).toBe('synthetic-api-key');
      expect(receivedHeaders.authorization).toBe('Bearer synthetic-api-key');
      for (const sensitive of ['synthetic-api-key', 'private-target', 'must-not-leak']) {
        expect(String(error)).not.toContain(sensitive);
      }
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    },
  );
});
