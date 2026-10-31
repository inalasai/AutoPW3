import { z } from 'zod';
import type { DurableJob, DurableJobStore, ScheduledJobKind } from './store';

const uuidSchema = z.string().uuid();
const claimedJobSchema = z.object({
  id: uuidSchema,
  kind: z.enum([
    'token_maintenance',
    'sync_live',
    'sync_history',
    'rollup',
    'retention',
    'evaluate_rules',
    'reconcile_command',
    'reencrypt_credentials',
  ]),
  household_id: uuidSchema.nullable(),
  site_id: uuidSchema.nullable(),
  dedupe_key: z.string().min(1).max(200),
  run_at: z.string().datetime({ offset: true }),
  state: z.literal('RUNNING'),
  attempts: z.number().int().min(1),
  max_attempts: z.number().int().min(1).max(20),
  locked_by: z.string().min(1).max(100),
  lease_expires_at: z.string().datetime({ offset: true }),
  payload: z.object({}).strict(),
});

const siteScopedKinds = new Set<ScheduledJobKind>([
  'sync_live',
  'sync_history',
  'rollup',
  'evaluate_rules',
  'reconcile_command',
]);

export class JobExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'JobExecutionError';
  }
}

export function createWorkerId(): string {
  return `worker-${crypto.randomUUID()}`;
}

export type DurableJobHandlers = Partial<Record<ScheduledJobKind, DurableJobHandler>>;
export interface DurableJobExecutionContext {
  readonly signal: AbortSignal;
  readonly deadlineAtMonotonicMs: number;
}
export type DurableJobHandler = (
  job: DurableJob,
  context: DurableJobExecutionContext,
) => Promise<void>;
export type DurableJobOwnershipValidator = (
  job: DurableJob,
  context: DurableJobExecutionContext,
) => Promise<boolean>;

export interface DurableBatchReport {
  readonly claimed: number;
  readonly completed: number;
  readonly retried: number;
  readonly dead: number;
  readonly leaseLost: number;
  readonly stateWriteFailed: number;
  readonly deferred: number;
}

/** Executes a bounded claimed batch sequentially, isolating each handler failure. */
export async function executeDurableJobBatch(options: {
  readonly store: DurableJobStore;
  readonly workerId: string;
  readonly handlers: DurableJobHandlers;
  readonly validateOwnership: DurableJobOwnershipValidator;
  readonly batchSize?: number | undefined;
  readonly leaseSeconds?: number | undefined;
  readonly maxExecutionMs?: number | undefined;
  readonly monotonicNow?: (() => number) | undefined;
}): Promise<DurableBatchReport> {
  const batchSize = options.batchSize ?? 20;
  const leaseSeconds = options.leaseSeconds ?? 300;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error('Invalid durable job batch size');
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) {
    throw new Error('Invalid durable job lease duration');
  }
  const maxExecutionMs =
    options.maxExecutionMs ?? Math.min(240_000, Math.max(1, leaseSeconds * 1000 - 1000));
  if (
    !Number.isInteger(maxExecutionMs) ||
    maxExecutionMs < 1 ||
    maxExecutionMs > leaseSeconds * 1000 - 250
  ) {
    throw new Error(
      'Job execution deadline must leave time to persist outcomes before lease expiry',
    );
  }
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const deadlineAtMonotonicMs = monotonicNow() + maxExecutionMs;
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), maxExecutionMs);
  const context: DurableJobExecutionContext = {
    signal: controller.signal,
    deadlineAtMonotonicMs,
  };

  let claimed: readonly DurableJob[];
  try {
    claimed = await options.store.claim(options.workerId, batchSize, leaseSeconds);
  } catch (error) {
    clearTimeout(abortTimer);
    throw error;
  }
  let completed = 0;
  let retried = 0;
  let dead = 0;
  let leaseLost = 0;
  let stateWriteFailed = 0;
  let deferred = 0;

  const failOwnedJob = async (
    jobId: string,
    code: string,
    delaySeconds: number,
    permanent = false,
  ): Promise<void> => {
    try {
      const result = await options.store.fail(
        jobId,
        options.workerId,
        code,
        delaySeconds,
        permanent,
      );
      if (result === 'QUEUED') retried++;
      else if (result === 'DEAD') dead++;
      else leaseLost++;
    } catch {
      // Let the lease expire for recovery and continue with unrelated jobs.
      stateWriteFailed++;
    }
  };

  try {
    for (let jobIndex = 0; jobIndex < claimed.length; jobIndex++) {
      if (controller.signal.aborted || monotonicNow() >= deadlineAtMonotonicMs) {
        deferred = claimed.length - jobIndex;
        break;
      }
      const rawJob = claimed[jobIndex]!;
      if (!rawJob || typeof rawJob.id !== 'string' || rawJob.id.length === 0) {
        leaseLost++;
        continue;
      }
      const parsed = claimedJobSchema.safeParse(rawJob);
      if (!parsed.success || !hasValidScope(parsed.data)) {
        await failOwnedJob(rawJob.id, 'INVALID_JOB', 60, true);
        continue;
      }

      const job = parsed.data as DurableJob;
      if (job.locked_by !== options.workerId) {
        leaseLost++;
        continue;
      }
      let ownershipValid: boolean;
      try {
        ownershipValid = await options.validateOwnership(job, context);
      } catch {
        await failOwnedJob(job.id, 'SCOPE_CHECK_FAILED', 60);
        continue;
      }
      if (!ownershipValid) {
        await failOwnedJob(job.id, 'TENANT_SCOPE_INVALID', 60, true);
        continue;
      }

      const handler = options.handlers[job.kind];
      if (!handler) {
        await failOwnedJob(job.id, 'NO_HANDLER', 60, true);
        continue;
      }

      try {
        await handler(job, context);
        try {
          if (await options.store.complete(job.id, options.workerId)) completed++;
          else leaseLost++;
        } catch {
          // Handler side effects may have completed. Leave the lease to expire instead of replaying now.
          stateWriteFailed++;
        }
      } catch (error) {
        const candidateCode = error instanceof JobExecutionError ? error.code : 'HANDLER_FAILED';
        const code = /^[A-Z0-9_]{1,64}$/.test(candidateCode) ? candidateCode : 'HANDLER_FAILED';
        const retryable = error instanceof JobExecutionError ? error.retryable : true;
        const retryDelaySeconds = retryable
          ? Math.min(3600, 30 * 2 ** Math.min(job.attempts - 1, 7))
          : 86400;
        await failOwnedJob(job.id, code, retryDelaySeconds, !retryable);
      }
    }
  } finally {
    clearTimeout(abortTimer);
  }

  return {
    claimed: claimed.length,
    completed,
    retried,
    dead,
    leaseLost,
    stateWriteFailed,
    deferred,
  };
}

function hasValidScope(job: {
  kind: ScheduledJobKind;
  household_id: string | null;
  site_id: string | null;
}): boolean {
  if (siteScopedKinds.has(job.kind)) return job.household_id !== null && job.site_id !== null;
  return job.household_id !== null && job.site_id === null;
}
