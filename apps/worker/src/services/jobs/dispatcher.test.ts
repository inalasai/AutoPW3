import { describe, expect, it, vi } from 'vitest';
import { dispatchDurableCronJobs, dispatchPersistedCronCycle } from '../ingestion/dispatcher';
import type { DurableJob, DurableJobStore } from './store';

const id = crypto.randomUUID();
const claimed: DurableJob = {
  id,
  kind: 'token_maintenance',
  household_id: crypto.randomUUID(),
  site_id: null,
  dedupe_key: 'token_maintenance:household:slot',
  run_at: '2026-10-31T12:00:00Z',
  state: 'RUNNING',
  attempts: 1,
  max_attempts: 5,
  locked_by: 'worker-a',
  lease_expires_at: '2026-10-31T12:05:00Z',
  payload: {},
};

describe('dispatchDurableCronJobs', () => {
  it('persists deterministic work before claiming and executing it', async () => {
    const calls: string[] = [];
    const store: DurableJobStore = {
      scheduleDueJobs: vi.fn(),
      enqueue: vi.fn(async () => {
        calls.push('enqueue');
        return 'job-id';
      }),
      claim: vi.fn(async () => {
        calls.push('claim');
        return [claimed];
      }),
      complete: vi.fn(async () => {
        calls.push('complete');
        return true;
      }),
      fail: vi.fn(),
      acquireLock: vi.fn(),
      releaseLock: vi.fn(),
      recordProviderCall: vi.fn(),
    };

    const report = await dispatchDurableCronJobs({
      store,
      workerId: 'worker-a',
      dueJobs: [
        {
          kind: 'token_maintenance',
          householdId: claimed.household_id!,
          dedupeKey: claimed.dedupe_key,
          runAt: claimed.run_at,
        },
      ],
      handlers: { token_maintenance: async () => undefined },
      validateOwnership: async () => true,
    });

    expect(calls).toEqual(['enqueue', 'claim', 'complete']);
    expect(report).toMatchObject({ scheduled: 1, deduplicated: 0, claimed: 1, completed: 1 });
  });

  it('continues to claim after a duplicate cron delivery is deduplicated', async () => {
    const store: DurableJobStore = {
      scheduleDueJobs: vi.fn(),
      enqueue: vi.fn().mockResolvedValue(null),
      claim: vi.fn().mockResolvedValue([]),
      complete: vi.fn(),
      fail: vi.fn(),
      acquireLock: vi.fn(),
      releaseLock: vi.fn(),
      recordProviderCall: vi.fn(),
    };

    const report = await dispatchDurableCronJobs({
      store,
      workerId: 'worker-a',
      dueJobs: [
        {
          kind: 'token_maintenance',
          householdId: claimed.household_id!,
          dedupeKey: claimed.dedupe_key,
          runAt: claimed.run_at,
        },
      ],
      handlers: {},
      validateOwnership: async () => true,
    });

    expect(report.deduplicated).toBe(1);
    expect(store.claim).toHaveBeenCalledTimes(1);
  });
});

describe('dispatchPersistedCronCycle', () => {
  it('schedules in PostgreSQL before atomically claiming and executing the batch', async () => {
    const calls: string[] = [];
    const store: DurableJobStore = {
      scheduleDueJobs: vi.fn(async () => {
        calls.push('schedule');
        return 1;
      }),
      enqueue: vi.fn(),
      claim: vi.fn(async () => {
        calls.push('claim');
        return [claimed];
      }),
      complete: vi.fn(async () => {
        calls.push('complete');
        return true;
      }),
      fail: vi.fn(),
      acquireLock: vi.fn(),
      releaseLock: vi.fn(),
      recordProviderCall: vi.fn(),
    };

    const report = await dispatchPersistedCronCycle({
      store,
      workerId: 'worker-a',
      now: '2026-10-31T12:00:00Z',
      handlers: { token_maintenance: async () => undefined },
      validateOwnership: async () => true,
    });

    expect(calls).toEqual(['schedule', 'claim', 'complete']);
    expect(store.scheduleDueJobs).toHaveBeenCalledWith('2026-10-31T12:00:00Z', 100, 100);
    expect(report).toMatchObject({ scheduled: 1, claimed: 1, completed: 1 });
  });
});
