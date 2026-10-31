import { describe, expect, it, vi } from 'vitest';
import { executeDurableJobBatch, JobExecutionError } from './executor';
import type { DurableJob, DurableJobStore } from './store';

const workerId = crypto.randomUUID();
const job: DurableJob = {
  id: crypto.randomUUID(),
  kind: 'sync_live',
  household_id: crypto.randomUUID(),
  site_id: crypto.randomUUID(),
  dedupe_key: 'sync_live:site:slot',
  run_at: '2026-10-31T12:00:00Z',
  state: 'RUNNING',
  attempts: 1,
  max_attempts: 5,
  locked_by: workerId,
  lease_expires_at: '2026-10-31T12:05:00Z',
  payload: {},
};

function makeStore(claimed: readonly DurableJob[]): DurableJobStore & {
  complete: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
} {
  return {
    scheduleDueJobs: vi.fn(),
    enqueue: vi.fn(),
    claim: vi.fn().mockResolvedValue(claimed),
    complete: vi.fn().mockResolvedValue(true),
    fail: vi.fn(async (_jobId, _workerId, _errorCode, _retryDelaySeconds, permanent = false) =>
      permanent ? 'DEAD' : 'QUEUED',
    ),
    acquireLock: vi.fn(),
    releaseLock: vi.fn(),
    recordProviderCall: vi.fn(),
  };
}

describe('executeDurableJobBatch', () => {
  it('completes successful work and isolates a recoverable failure', async () => {
    const second = { ...job, id: crypto.randomUUID() };
    const store = makeStore([job, second]);
    const handler = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new JobExecutionError('PROVIDER_UNAVAILABLE', true));

    const report = await executeDurableJobBatch({
      store,
      workerId,
      handlers: { sync_live: handler },
      validateOwnership: async () => true,
    });

    expect(report).toEqual({
      claimed: 2,
      completed: 1,
      retried: 1,
      dead: 0,
      leaseLost: 0,
      stateWriteFailed: 0,
      deferred: 0,
    });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(store.complete).toHaveBeenCalledWith(job.id, workerId);
    expect(store.fail).toHaveBeenCalledWith(second.id, workerId, 'PROVIDER_UNAVAILABLE', 30, false);
  });

  it('marks non-retryable errors for terminal transition', async () => {
    const store = makeStore([job]);
    const handler = vi.fn().mockRejectedValue(new JobExecutionError('INVALID_INPUT', false));
    store.fail.mockResolvedValue('DEAD');

    const report = await executeDurableJobBatch({
      store,
      workerId,
      handlers: { sync_live: handler },
      validateOwnership: async () => true,
    });

    expect(report.dead).toBe(1);
    expect(store.fail).toHaveBeenCalledWith(job.id, workerId, 'INVALID_INPUT', 86400, true);
  });

  it('fails closed on an unhandled job kind and continues the batch', async () => {
    const second = { ...job, id: crypto.randomUUID() };
    const store = makeStore([job, second]);
    const handler = vi.fn().mockResolvedValue(undefined);

    const report = await executeDurableJobBatch({
      store,
      workerId,
      handlers: { token_maintenance: handler },
      validateOwnership: async () => true,
    });

    expect(report.dead).toBe(2);
    expect(handler).not.toHaveBeenCalled();
    expect(store.fail).toHaveBeenNthCalledWith(1, job.id, workerId, 'NO_HANDLER', 60, true);
  });

  it('rejects invalid tenant scope before invoking a handler', async () => {
    const invalid = { ...job, household_id: crypto.randomUUID() };
    const store = makeStore([invalid]);
    const handler = vi.fn();

    const report = await executeDurableJobBatch({
      store,
      workerId,
      handlers: { sync_live: handler },
      validateOwnership: async () => false,
    });

    expect(report.dead).toBe(1);
    expect(store.fail).toHaveBeenCalledWith(invalid.id, workerId, 'TENANT_SCOPE_INVALID', 60, true);
    expect(handler).not.toHaveBeenCalled();
  });

  it('records lease loss and does not try to reassign completion', async () => {
    const store = makeStore([job]);
    store.complete.mockResolvedValue(false);

    const report = await executeDurableJobBatch({
      store,
      workerId,
      handlers: { sync_live: vi.fn().mockResolvedValue(undefined) },
      validateOwnership: async () => true,
    });

    expect(report.leaseLost).toBe(1);
    expect(store.fail).not.toHaveBeenCalled();
  });

  it('never executes a claimed row owned by another worker', async () => {
    const foreignOwned = { ...job, locked_by: crypto.randomUUID() };
    const store = makeStore([foreignOwned]);
    const validateOwnership = vi.fn(async () => true);
    const handler = vi.fn();

    const report = await executeDurableJobBatch({
      store,
      workerId,
      handlers: { sync_live: handler },
      validateOwnership,
    });

    expect(report.leaseLost).toBe(1);
    expect(validateOwnership).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(store.fail).not.toHaveBeenCalled();
  });

  it('rejects a job carrying unregistered payload fields before handler execution', async () => {
    const malformed = { ...job, payload: { token: crypto.randomUUID() } };
    const store = makeStore([malformed]);
    const handler = vi.fn();

    const report = await executeDurableJobBatch({
      store,
      workerId,
      handlers: { sync_live: handler },
      validateOwnership: async () => true,
    });

    expect(report.dead).toBe(1);
    expect(store.fail).toHaveBeenCalledWith(job.id, workerId, 'INVALID_JOB', 60, true);
    expect(handler).not.toHaveBeenCalled();
  });

  it('stores only a stable code when an unknown exception contains sensitive text', async () => {
    const store = makeStore([job]);
    const handler = vi.fn().mockRejectedValue(new Error('refresh token must never be persisted'));

    await executeDurableJobBatch({
      store,
      workerId,
      handlers: { sync_live: handler },
      validateOwnership: async () => true,
    });

    expect(store.fail).toHaveBeenCalledWith(job.id, workerId, 'HANDLER_FAILED', 30, false);
  });

  it('continues unrelated work when persisting one failed job outcome fails', async () => {
    const second = { ...job, id: crypto.randomUUID() };
    const store = makeStore([job, second]);
    store.fail.mockRejectedValue(new Error('database unavailable'));

    const handler = vi
      .fn()
      .mockRejectedValueOnce(new JobExecutionError('TEMPORARY', true))
      .mockResolvedValueOnce(undefined);
    const report = await executeDurableJobBatch({
      store,
      workerId,
      handlers: { sync_live: handler },
      validateOwnership: async () => true,
    });

    expect(report.stateWriteFailed).toBe(1);
    expect(report.completed).toBe(1);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('defers the rest of the claimed batch when the execution deadline is reached', async () => {
    const second = { ...job, id: crypto.randomUUID() };
    const store = makeStore([job, second]);
    let monotonic = 0;
    const handler = vi.fn(async () => {
      monotonic = 1000;
    });

    const report = await executeDurableJobBatch({
      store,
      workerId,
      handlers: { sync_live: handler },
      validateOwnership: async () => true,
      leaseSeconds: 3,
      maxExecutionMs: 1000,
      monotonicNow: () => monotonic,
    });

    expect(report.deferred).toBe(1);
    expect(report.completed).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
