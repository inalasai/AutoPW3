import { HealthResponseSchema } from '@autopw3/shared';
import { describe, expect, it } from 'vitest';
import type { Env } from './env';
import { handleRequest } from './index';

function makeEnv(): { env: Env; assetRequests: string[] } {
  const assetRequests: string[] = [];
  const env: Env = {
    ENVIRONMENT: 'test',
    ASSETS: {
      fetch: (input: RequestInfo | URL): Promise<Response> => {
        assetRequests.push(new Request(input).url);
        return Promise.resolve(new Response('<html></html>', { status: 200 }));
      },
      connect: () => {
        throw new Error('not used');
      },
    } as unknown as Fetcher,
  };
  return { env, assetRequests };
}

describe('GET /api/v1/health', () => {
  it('returns only { status: "ok" } with a request id', async () => {
    const { env } = makeEnv();
    const res = await handleRequest(new Request('http://localhost/api/v1/health'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBeTruthy();
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body: unknown = await res.json();
    expect(HealthResponseSchema.safeParse(body).success).toBe(true);
  });

  it('rejects non-GET methods without internals', async () => {
    const { env } = makeEnv();
    const res = await handleRequest(
      new Request('http://localhost/api/v1/health', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(405);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
    expect(body.error.requestId).toBe(res.headers.get('x-request-id'));
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404 for unknown /api paths and never hits static assets', async () => {
    const { env, assetRequests } = makeEnv();
    const res = await handleRequest(new Request('http://localhost/api/v1/nope'), env);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(assetRequests).toHaveLength(0);
  });

  it('serves non-API paths from static assets', async () => {
    const { env, assetRequests } = makeEnv();
    const res = await handleRequest(new Request('http://localhost/live'), env);
    expect(res.status).toBe(200);
    expect(assetRequests).toEqual(['http://localhost/live']);
  });
});
