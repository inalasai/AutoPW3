import { SupabaseRpcError } from '../../db/supabase-rpc';
import {
  createPrivilegedRpcClient,
  type PrivilegedRpcClient,
  type PrivilegedRpcName,
} from '../../db/system-client';

export type ScheduledJobKind =
  | 'token_maintenance'
  | 'sync_live'
  | 'sync_history'
  | 'rollup'
  | 'retention'
  | 'evaluate_rules'
  | 'reconcile_command'
  | 'reencrypt_credentials';

export interface DurableJob {
  readonly id: string;
  readonly kind: ScheduledJobKind;
  readonly household_id: string | null;
  readonly site_id: string | null;
  readonly dedupe_key: string;
  readonly run_at: string;
  readonly state: 'RUNNING';
  readonly attempts: number;
  readonly max_attempts: number;
  readonly locked_by: string;
  readonly lease_expires_at: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EnqueueJob {
  readonly kind: ScheduledJobKind;
  readonly householdId: string;
  readonly siteId?: string | undefined;
  readonly dedupeKey: string;
  readonly runAt: string;
  readonly payload?: Readonly<Record<string, unknown>> | undefined;
  readonly maxAttempts?: number | undefined;
}

export interface DurableJobStore {
  scheduleDueJobs(now: string, maxSites: number, maxHouseholds: number): Promise<number>;
  enqueue(input: EnqueueJob): Promise<string | null>;
  claim(workerId: string, max: number, leaseSeconds: number): Promise<readonly DurableJob[]>;
  complete(jobId: string, workerId: string): Promise<boolean>;
  fail(
    jobId: string,
    workerId: string,
    errorCode: string,
    retryDelaySeconds: number,
    permanent?: boolean,
  ): Promise<'QUEUED' | 'DEAD' | null>;
  acquireLock(key: string, owner: string, leaseSeconds: number): Promise<boolean>;
  releaseLock(key: string, owner: string): Promise<boolean>;
  recordProviderCall(
    householdId: string,
    category: 'DATA' | 'COMMAND' | 'WAKE' | 'STREAM' | 'AUTH',
    succeeded: boolean,
  ): Promise<boolean>;
}

export class DurableJobStoreError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
  ) {
    super(`Durable job ${operation} failed (HTTP ${status})`);
    this.name = 'DurableJobStoreError';
  }
}

/** PostgREST adapter for the service-role-only public.worker_* RPCs. */
export class SupabaseDurableJobStore implements DurableJobStore {
  private readonly rpcClient: PrivilegedRpcClient;

  constructor(supabaseUrl: string, serviceRoleKey: string, fetcher: typeof fetch = fetch) {
    this.rpcClient = createPrivilegedRpcClient(supabaseUrl, serviceRoleKey, fetcher);
  }

  async enqueue(input: EnqueueJob): Promise<string | null> {
    if (input.payload && Object.keys(input.payload).length > 0) {
      throw new Error('Durable job payload schemas are not yet registered');
    }
    return this.rpc<string | null>('worker_enqueue_job', {
      p_kind: input.kind,
      p_household_id: input.householdId,
      p_site_id: input.siteId ?? null,
      p_dedupe_key: input.dedupeKey,
      p_run_at: input.runAt,
      p_payload: input.payload ?? {},
      p_max_attempts: input.maxAttempts ?? 5,
    });
  }

  async scheduleDueJobs(now: string, maxSites = 100, maxHouseholds = 100): Promise<number> {
    if (!Number.isInteger(maxSites) || maxSites < 1 || maxSites > 100) {
      throw new Error('Invalid scheduling site bound');
    }
    if (!Number.isInteger(maxHouseholds) || maxHouseholds < 1 || maxHouseholds > 100) {
      throw new Error('Invalid scheduling household bound');
    }
    return this.rpc<number>('worker_schedule_due_jobs', {
      p_now: now,
      p_max_sites: maxSites,
      p_max_households: maxHouseholds,
    });
  }

  async claim(workerId: string, max: number, leaseSeconds: number): Promise<readonly DurableJob[]> {
    if (!workerId.trim() || workerId.length > 100) throw new Error('Invalid worker identity');
    if (!Number.isInteger(max) || max < 1 || max > 100) throw new Error('Invalid job batch size');
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) {
      throw new Error('Invalid job lease duration');
    }
    const result = await this.rpc<unknown>('worker_claim_jobs', {
      p_worker_id: workerId,
      p_max: max,
      p_lease_seconds: leaseSeconds,
    });
    if (!Array.isArray(result) || result.length > max) {
      throw new DurableJobStoreError('worker_claim_jobs', 502);
    }
    return result as readonly DurableJob[];
  }

  async complete(jobId: string, workerId: string): Promise<boolean> {
    return this.rpc<boolean>('worker_finish_job', { p_job_id: jobId, p_worker_id: workerId });
  }

  async fail(
    jobId: string,
    workerId: string,
    errorCode: string,
    retryDelaySeconds: number,
    permanent = false,
  ): Promise<'QUEUED' | 'DEAD' | null> {
    return this.rpc<'QUEUED' | 'DEAD' | null>('worker_fail_job', {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_error_code: errorCode,
      p_retry_delay_seconds: retryDelaySeconds,
      p_permanent: permanent,
    });
  }

  async acquireLock(key: string, owner: string, leaseSeconds: number): Promise<boolean> {
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) {
      throw new Error('Invalid lock lease duration');
    }
    return this.rpc<boolean>('worker_acquire_lock', {
      p_key: key,
      p_owner: owner,
      p_lease_seconds: leaseSeconds,
    });
  }

  async releaseLock(key: string, owner: string): Promise<boolean> {
    return this.rpc<boolean>('worker_release_lock', { p_key: key, p_owner: owner });
  }

  async recordProviderCall(
    householdId: string,
    category: 'DATA' | 'COMMAND' | 'WAKE' | 'STREAM' | 'AUTH',
    succeeded: boolean,
  ): Promise<boolean> {
    return this.rpc<boolean>('worker_record_provider_call', {
      p_household_id: householdId,
      p_category: category,
      p_ok: succeeded,
    });
  }

  private async rpc<T>(name: PrivilegedRpcName, body: Record<string, unknown>): Promise<T> {
    try {
      return await this.rpcClient.call<T>(name, body);
    } catch (error) {
      if (error instanceof SupabaseRpcError) {
        throw new DurableJobStoreError(error.operation, error.status);
      }
      throw new DurableJobStoreError(name, 0);
    }
  }
}
