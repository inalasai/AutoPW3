import { describe, expect, it, vi } from 'vitest';
import { SupabaseDurableJobStore } from './store';

describe('SupabaseDurableJobStore', () => {
  it('posts bounded enqueue and lifecycle calls to the service-only RPC surface', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('"job-id"', { status: 200 }));
    const serviceRoleKey = crypto.randomUUID();
    const store = new SupabaseDurableJobStore(
      'https://example.supabase.co',
      serviceRoleKey,
      fetcher,
    );

    await store.enqueue({
      kind: 'sync_live',
      householdId: crypto.randomUUID(),
      siteId: crypto.randomUUID(),
      dedupeKey: 'sync_live:site:slot',
      runAt: '2026-10-31T12:00:00Z',
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/rpc/worker_enqueue_job',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, request] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      p_kind: 'sync_live',
      p_dedupe_key: 'sync_live:site:slot',
    });
    expect(new Headers(request.headers).get('authorization')).toBe(`Bearer ${serviceRoleKey}`);
  });

  it('bounds claims before issuing any database request', async () => {
    const fetcher = vi.fn();
    const store = new SupabaseDurableJobStore(
      'https://example.supabase.co',
      crypto.randomUUID(),
      fetcher,
    );

    await expect(store.claim('worker', 101, 60)).rejects.toThrow('Invalid job batch size');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects unregistered payload fields before the database call', async () => {
    const fetcher = vi.fn();
    const store = new SupabaseDurableJobStore(
      'https://example.supabase.co',
      crypto.randomUUID(),
      fetcher,
    );

    await expect(
      store.enqueue({
        kind: 'sync_live',
        householdId: crypto.randomUUID(),
        siteId: crypto.randomUUID(),
        dedupeKey: 'sync-live-test-slot',
        runAt: '2026-10-31T12:00:00Z',
        payload: { token: crypto.randomUUID() },
      }),
    ).rejects.toThrow('Durable job payload schemas are not yet registered');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds recurring scheduler fan-out before invoking the database', async () => {
    const fetcher = vi.fn();
    const store = new SupabaseDurableJobStore(
      'https://example.supabase.co',
      crypto.randomUUID(),
      fetcher,
    );

    await expect(store.scheduleDueJobs('2026-10-31T12:00:00Z', 101, 100)).rejects.toThrow(
      'Invalid scheduling site bound',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses narrow server RPCs for locks and known provider usage categories', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response('true', { status: 200 }));
    const store = new SupabaseDurableJobStore(
      'https://example.supabase.co',
      crypto.randomUUID(),
      fetcher,
    );

    await store.acquireLock('token:household', 'worker-a', 60);
    await store.releaseLock('token:household', 'worker-a');
    await store.recordProviderCall(crypto.randomUUID(), 'DATA', false);

    const endpoints = fetcher.mock.calls.map(([url]) => url);
    expect(endpoints).toEqual([
      'https://example.supabase.co/rest/v1/rpc/worker_acquire_lock',
      'https://example.supabase.co/rest/v1/rpc/worker_release_lock',
      'https://example.supabase.co/rest/v1/rpc/worker_record_provider_call',
    ]);
  });

  it('rejects non-HTTPS remote database endpoints', () => {
    expect(() => new SupabaseDurableJobStore('http://db.example.com', crypto.randomUUID())).toThrow(
      'Supabase URL must use HTTPS',
    );
  });

  it('does not include response bodies or credentials in database errors', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('sensitive response body', { status: 500 }));
    const store = new SupabaseDurableJobStore(
      'https://example.supabase.co',
      crypto.randomUUID(),
      fetcher,
    );

    await expect(store.claim('worker', 1, 60)).rejects.toEqual(
      expect.objectContaining({
        name: 'DurableJobStoreError',
        operation: 'worker_claim_jobs',
        status: 500,
      }),
    );
  });
});
