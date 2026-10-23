-- TASK-03 migration 6/7: device commands and automation.
-- Design: docs/DATABASE_DESIGN.md sections 2.5 and 2.6. Safe to re-run (idempotent).
--
-- Command kinds are limited to the Tesla endpoints TASK-00 marked DOCUMENTED
-- (docs/research/TESLA_CAPABILITY_MATRIX_DRAFT.md). DOCUMENTED means documented, not tested: payloads are UNVERIFIED
-- and every kind stays mock-only until verified. NOT_SUPPORTED operations (forced charge, forced export,
-- solar bypass, islanding) are deliberately not representable. Adding a kind needs a new migration and a DECISIONS.md entry.
--
-- Rollback notes (development only):
--   alter table public.automation_executions drop constraint if exists automation_executions_command_id_fkey;
--   drop table if exists public.device_command_events, public.device_command_log,
--     public.automation_executions, public.automation_rules cascade;

set search_path = public, extensions;

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  site_id uuid not null,
  name text not null check (char_length(name) between 1 and 100),
  -- Rules default to DISABLED. DRY_RUN never calls control endpoints; only ADMIN sets ACTIVE (function in TASK-18).
  mode text not null default 'DISABLED' check (mode in ('DISABLED', 'DRY_RUN', 'ACTIVE')),
  priority integer not null default 100,
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  definition_version integer not null default 1 check (definition_version >= 1),
  version bigint not null default 1 check (version >= 1),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, site_id),
  foreign key (site_id, household_id) references public.energy_sites (id, household_id) on delete cascade
);
comment on column public.automation_rules.version is 'Optimistic-concurrency counter, incremented by the API on every change.';
create index if not exists automation_rules_site_id_idx on public.automation_rules (site_id);
create index if not exists automation_rules_active_idx on public.automation_rules (site_id, priority) where mode <> 'DISABLED';

drop trigger if exists automation_rules_touch_updated_at on public.automation_rules;
create trigger automation_rules_touch_updated_at
  before update on public.automation_rules
  for each row execute function private.touch_updated_at();

create table if not exists public.automation_executions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null,
  site_id uuid not null,
  scheduled_slot timestamptz not null,
  evaluated_at timestamptz not null default now(),
  mode_at_evaluation text not null check (mode_at_evaluation in ('DISABLED', 'DRY_RUN', 'ACTIVE')),
  decision text not null check (decision in (
    'WOULD_ACT', 'ACTED', 'NO_ACTION', 'SKIPPED_STALE', 'SKIPPED_PAUSED',
    'SKIPPED_CAPABILITY', 'SKIPPED_CONFLICT', 'SKIPPED_MISSED', 'ERROR'
  )),
  reason text check (reason is null or char_length(reason) <= 500),
  command_id uuid,
  -- Duplicate cron delivery is harmless: one execution per rule per slot.
  unique (rule_id, scheduled_slot),
  foreign key (rule_id, site_id) references public.automation_rules (id, site_id) on delete cascade,
  -- Safety: a dry run can never act and never links a command.
  check (mode_at_evaluation = 'ACTIVE' or decision <> 'ACTED'),
  check (mode_at_evaluation = 'ACTIVE' or command_id is null)
);
comment on column public.automation_executions.scheduled_slot is 'UTC slot this evaluation is for. With rule_id it is the idempotency key.';
create index if not exists automation_executions_site_slot_idx on public.automation_executions (site_id, scheduled_slot desc);

create table if not exists public.device_command_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  site_id uuid not null,
  requested_by uuid references auth.users (id) on delete set null,
  origin text not null check (origin in ('USER', 'AUTOMATION')),
  automation_execution_id uuid references public.automation_executions (id) on delete set null,
  kind text not null check (kind in (
    'SET_BACKUP_RESERVE',
    'SET_OPERATION_MODE',
    'SET_GRID_IMPORT_EXPORT',
    'SET_STORM_MODE',
    'SET_OFF_GRID_VEHICLE_CHARGING_RESERVE',
    'SET_TIME_OF_USE_SETTINGS'
  )),
  params jsonb not null check (jsonb_typeof(params) = 'object'),
  params_hash bytea not null check (octet_length(params_hash) = 32),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  provider_mode text not null check (provider_mode in ('MOCK', 'TESLA')),
  state text not null default 'PENDING' check (state in ('PENDING', 'CONFIRMED', 'FAILED', 'UNKNOWN')),
  phase text not null default 'RECORDED' check (phase in ('RECORDED', 'DISPATCHING', 'DISPATCHED', 'RECONCILING', 'DONE')),
  requested_at timestamptz not null default now(),
  dispatched_at timestamptz,
  finished_at timestamptz,
  error_code text check (error_code is null or char_length(error_code) <= 64),
  provider_http_status integer check (provider_http_status between 100 and 599),
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  unique (site_id, idempotency_key),
  foreign key (site_id, household_id) references public.energy_sites (id, household_id) on delete cascade
);
comment on table public.device_command_log is
  'Intent row inserted user-scoped BEFORE any dispatch (D-015). HTTP 200 is never trusted: CONFIRMED requires read-back reconciliation.';
comment on column public.device_command_log.params_hash is 'SHA-256 of the canonical params. Same key with a different hash is a conflict (409).';
comment on column public.device_command_log.state is 'PENDING, CONFIRMED, FAILED or UNKNOWN. UNKNOWN is retried by reconciliation, never reported as success.';
create index if not exists device_command_log_site_requested_idx on public.device_command_log (site_id, requested_at desc);
create index if not exists device_command_log_open_idx on public.device_command_log (state, requested_at) where state in ('PENDING', 'UNKNOWN');
create index if not exists device_command_log_automation_idx on public.device_command_log (automation_execution_id) where automation_execution_id is not null;

-- Circular reference: an execution may create a command and a command may come from an execution.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'automation_executions_command_id_fkey' and conrelid = 'public.automation_executions'::regclass
  ) then
    alter table public.automation_executions
      add constraint automation_executions_command_id_fkey
      foreign key (command_id) references public.device_command_log (id) on delete set null;
  end if;
end
$$;

create table if not exists public.device_command_events (
  id bigint generated always as identity primary key,
  command_id uuid not null references public.device_command_log (id) on delete cascade,
  at timestamptz not null default now(),
  from_state text check (from_state in ('PENDING', 'CONFIRMED', 'FAILED', 'UNKNOWN')),
  to_state text not null check (to_state in ('PENDING', 'CONFIRMED', 'FAILED', 'UNKNOWN')),
  phase text check (phase in ('RECORDED', 'DISPATCHING', 'DISPATCHED', 'RECONCILING', 'DONE')),
  detail jsonb check (detail is null or jsonb_typeof(detail) = 'object')
);
comment on table public.device_command_events is 'Append-only history of command state changes. UPDATE and direct DELETE are rejected by trigger.';
create index if not exists device_command_events_command_idx on public.device_command_events (command_id, at);

drop trigger if exists device_command_events_append_only on public.device_command_events;
create trigger device_command_events_append_only
  before update or delete on public.device_command_events
  for each row execute function private.reject_modification();

select private.lock_down_public_tables();
