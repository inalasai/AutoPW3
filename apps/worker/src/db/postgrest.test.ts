import { describe, expect, it, vi } from 'vitest';
import { AuthenticatedPostgrestClient } from './postgrest';
import { createPrivilegedRpcClient } from './system-client';

describe('request-scoped PostgREST transport', () => {
  it('forwards the anon key and exactly the request JWT, and bounds the request', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('apikey')).toBe('test-public-value');
      expect(headers.get('authorization')).toBe('Bearer user-jwt-a');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json([{ user_id: 'actor-a' }]);
    });
    const client = new AuthenticatedPostgrestClient(
      'https://project.supabase.co',
      'test-public-value',
      'user-jwt-a',
      fetcher,
    );
    await expect(
      client.select('user_profiles', new URLSearchParams({ select: 'user_id' })),
    ).resolves.toEqual([{ user_id: 'actor-a' }]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not expose PostgREST response bodies in errors', async () => {
    const client = new AuthenticatedPostgrestClient(
      'https://project.supabase.co',
      'test-public-value',
      'user-jwt',
      async () =>
        new Response(
          JSON.stringify({ code: '42501', message: 'not_authorised', secret: 'must-not-leak' }),
          { status: 403 },
        ),
    );
    const error = await client.rpc('private_operation', {}).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      operation: 'rpc/private_operation',
      status: 403,
      code: '42501',
      tag: 'not_authorised',
    });
    expect(String(error)).not.toContain('must-not-leak');
  });

  it('uses a separate service-role transport constructor', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-system-value');
      return Response.json({ ok: true });
    });
    const system = createPrivilegedRpcClient(
      'https://project.supabase.co',
      'test-system-value',
      fetcher,
    );
    await expect(system.call('worker_claim_jobs', {})).resolves.toEqual({ ok: true });
    expect(() => system.call('unapproved_rpc' as never, {})).toThrow('not allowlisted');
  });

  it('rejects unsafe origins and missing request credentials', () => {
    expect(
      () => new AuthenticatedPostgrestClient('http://project.supabase.co', 'test-key', 'jwt'),
    ).toThrow();
    expect(
      () => new AuthenticatedPostgrestClient('https://project.supabase.co', '', 'jwt'),
    ).toThrow();
  });
});
