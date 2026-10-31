import { describe, expect, it, vi } from 'vitest';
import { SupabaseRateLimiter } from './rate-limiter';

describe('SupabaseRateLimiter', () => {
  it('hashes the caller scope before using the atomic database counter', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ allowed: false, retry_after_seconds: 17 }]), {
        status: 200,
      }),
    );
    const limiter = new SupabaseRateLimiter(
      'https://example.supabase.co',
      crypto.randomUUID(),
      fetcher,
    );
    const privateScope = crypto.randomUUID();

    await expect(limiter.check(privateScope, 10, 60)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 17,
    });

    const [, request] = fetcher.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body['p_key_hash']).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(JSON.stringify(body)).not.toContain(privateScope);
  });

  it('rejects invalid limit bounds before contacting PostgreSQL', async () => {
    const fetcher = vi.fn();
    const limiter = new SupabaseRateLimiter(
      'https://example.supabase.co',
      crypto.randomUUID(),
      fetcher,
    );

    await expect(limiter.check(crypto.randomUUID(), 0, 60)).rejects.toThrow('Invalid rate limit');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
