-- TASK-03 migration 7/7: scheduled jobs, named locks, audit log.
-- Design: docs/DATABASE_DESIGN.md section 2.7 and docs/SYSTEM_ARCHITECTURE.md section 7 (D-007).
-- Tables only. The claim/lock/usage functions (claim_jobs, acquire_lock, release_lock, record_provider_call)
-- are created in TASK-16 and are callable by the server role only. Safe to re-run (idempotent).
--
-- Rollback notes (development only):
--   drop table if exists public.audit_log, public.job_locks, public.scheduled_jobs cascade;

set search_path = public, extensions;

create table if not exists public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'token_maintenance', 'sync_live', 'sync_history', 'rollup', 'retention',
    'evaluate_rules', 'reconcile_command', 'reencrypt_credentials'
  )),
  -- household_id is an addition to the design (flagged in the TASK-03 handoff): household-level jobs such as
  -- token_maintenance have no site, and deleting a household must remove its jobs.
  household_id uuid references public.households (id) on delete cascade,
  site_id uuid references public.energy_sites (id) on delete cascade,
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 200),
  run_at timestamptz not null,
  state text not null default 'QUEUED' check (state in ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'DEAD')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts >= 1),
  lease_expires_at timestamptz,
  locked_by text check (locked_by is null or char_length(locked_by) <= 100),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (attempts <= max_attempts)
);
comment on column public.scheduled_jobs.payload is 'Job parameters. Never contains secrets, tokens or telemetry.';
comment on column public.scheduled_jobs.last_error is 'Sanitised error text only (no tokens, no provider payloads).';
comment on column public.scheduled_jobs.dedupe_key is 'kind + scope + slot. Makes duplicate cron delivery enqueue one job.';
create index if not exists scheduled_jobs_state_run_at_idx on public.scheduled_jobs (state, run_at);
create index if not exists scheduled_jobs_queued_idx on public.scheduled_jobs (run_at) where state = 'QUEUED';
create index if not exists scheduled_jobs_household_idx on public.scheduled_jobs (household_id) where household_id is not null;
create index if not exists scheduled_jobs_site_idx on public.scheduled_jobs (site_id) where site_id is not null;

create table if not exists public.job_locks (
  key text primary key check (char_length(key) between 1 and 200),
  owner text not null check (char_length(owner) between 1 and 100),
  lease_expires_at timestamptz not null
);
comment on table public.job_locks is 'Named short leases (for example token:<household>, fetch:live:<site>). Server-only.';

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  household_id uuid references public.households (id) on delete cascade,
  actor_type text not null check (actor_type in ('USER', 'SYSTEM')),
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 1 and 100),
  target_type text check (target_type is null or char_length(target_type) <= 64),
  target_id text check (target_id is null or char_length(target_id) <= 200),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  request_id text check (request_id is null or char_length(request_id) <= 100),
  created_at timestamptz not null default now()
);
comment on table public.audit_log is
  'Append-only. metadata is written through a per-action allowlist and never contains tokens, JWTs or telemetry. Deleting a user nulls actor_user_id; the row stays.';
create index if not exists audit_log_household_created_idx on public.audit_log (household_id, created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_user_id) where actor_user_id is not null;

drop trigger if exists audit_log_append_only on public.audit_log;
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function private.reject_audit_modification();

select private.lock_down_public_tables();
