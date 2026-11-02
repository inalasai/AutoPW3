import { SupabaseRpcClient } from './supabase-rpc';

export type PrivilegedRpcName =
  | 'worker_stage_tesla_discovery_refresh'
  | 'worker_prepare_tesla_site_link'
  | 'worker_begin_tesla_oauth'
  | 'worker_validate_tesla_oauth_session'
  | 'worker_save_tesla_credentials_fenced_for_oauth'
  | 'worker_acquire_lock'
  | 'worker_check_rate_limit'
  | 'worker_claim_jobs'
  | 'worker_consume_oauth_state'
  | 'worker_delete_tesla_credentials'
  | 'worker_enqueue_job'
  | 'worker_fail_job'
  | 'worker_finish_job'
  | 'worker_get_tesla_credentials'
  | 'worker_record_provider_call'
  | 'worker_release_lock'
  | 'worker_save_oauth_state'
  | 'worker_save_tesla_credentials'
  | 'worker_save_tesla_credentials_for_oauth'
  | 'worker_validate_oauth_actor'
  | 'worker_schedule_due_jobs';

export interface PrivilegedRpcClient {
  call<T>(name: PrivilegedRpcName, body: Record<string, unknown>): Promise<T>;
}

const PRIVILEGED_RPC_NAMES: ReadonlySet<string> = new Set([
  'worker_stage_tesla_discovery_refresh',
  'worker_prepare_tesla_site_link',
  'worker_begin_tesla_oauth',
  'worker_validate_tesla_oauth_session',
  'worker_save_tesla_credentials_fenced_for_oauth',
  'worker_acquire_lock',
  'worker_check_rate_limit',
  'worker_claim_jobs',
  'worker_consume_oauth_state',
  'worker_delete_tesla_credentials',
  'worker_enqueue_job',
  'worker_fail_job',
  'worker_finish_job',
  'worker_get_tesla_credentials',
  'worker_record_provider_call',
  'worker_release_lock',
  'worker_save_oauth_state',
  'worker_save_tesla_credentials',
  'worker_save_tesla_credentials_for_oauth',
  'worker_validate_oauth_actor',
  'worker_schedule_due_jobs',
]);

/** Narrow server-only constructor. Never import this module from route or user repository code. */
export function createPrivilegedRpcClient(
  supabaseUrl: string,
  serviceRoleKey: string,
  fetcher: typeof fetch = fetch,
): PrivilegedRpcClient {
  const client = new SupabaseRpcClient(supabaseUrl, serviceRoleKey, fetcher);
  return {
    call<T>(name: PrivilegedRpcName, body: Record<string, unknown>): Promise<T> {
      if (!PRIVILEGED_RPC_NAMES.has(name)) throw new Error('Privileged RPC is not allowlisted');
      return client.call<T>(name, body);
    },
  };
}
