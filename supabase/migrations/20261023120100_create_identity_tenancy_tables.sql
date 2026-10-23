-- TASK-03 migration 2/7: identity and tenancy.
-- Tables: user_profiles, households, household_members, household_invitations, household_settings, system_bootstrap.
-- Design: docs/DATABASE_DESIGN.md section 2.1. Safe to re-run (idempotent).
-- RLS is enabled with no policies (default deny). Policies, grants and role-protection triggers are TASK-04.
--
-- Rollback notes (development only):
--   drop table if exists public.system_bootstrap, public.household_settings, public.household_invitations,
--     public.household_members, public.households, public.user_profiles cascade;

set search_path = public, extensions;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 100),
  locale text check (locale is null or locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  created_at timestamptz not null default now()
);
comment on table public.user_profiles is 'One row per auth user. Holds no role: roles live only in household_members (D-004).';

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  timezone text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
comment on column public.households.timezone is 'IANA timezone name, validated by trigger against pg_timezone_names.';

drop trigger if exists households_validate_timezone on public.households;
create trigger households_validate_timezone
  before insert or update of timezone on public.households
  for each row execute function private.validate_timezone();

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.role_enum not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  primary key (household_id, user_id)
);
comment on column public.household_members.role is
  'The only place a role is stored. No default: new members are READ_ONLY by policy (TASK-04), never ADMIN by default.';
create index if not exists household_members_user_id_idx on public.household_members (user_id);

create table if not exists public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email extensions.citext,
  role public.role_enum not null default 'READ_ONLY',
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (not (accepted_at is not null and revoked_at is not null))
);
comment on column public.household_invitations.token_hash is 'SHA-256 (32 bytes) of the invitation token. The token itself is never stored.';
create index if not exists household_invitations_household_id_idx on public.household_invitations (household_id);
create index if not exists household_invitations_open_idx
  on public.household_invitations (household_id, expires_at)
  where accepted_at is null and revoked_at is null;

create table if not exists public.household_settings (
  household_id uuid primary key references public.households (id) on delete cascade,
  monthly_spend_cap_usd numeric(8, 2) not null default 9.00 check (monthly_spend_cap_usd >= 0),
  live_background_interval_minutes integer not null default 30 check (live_background_interval_minutes >= 5),
  live_on_demand_min_interval_seconds integer not null default 30 check (live_on_demand_min_interval_seconds >= 30),
  on_demand_monthly_allowance integer not null default 2000 check (on_demand_monthly_allowance >= 0),
  raw_retention_days integer not null default 90 check (raw_retention_days >= 7),
  stale_after_seconds integer not null default 3600 check (stale_after_seconds > 0),
  automation_paused boolean not null default false,
  paused_by uuid references auth.users (id) on delete set null,
  paused_at timestamptz,
  controls_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  -- Staleness must exceed the background polling interval or the site would be permanently STALE (design 2.1).
  check (stale_after_seconds > live_background_interval_minutes * 60)
);
comment on column public.household_settings.monthly_spend_cap_usd is 'Estimated monthly Tesla spend cap in USD (D-023). Not a household tariff currency.';
comment on column public.household_settings.controls_enabled is 'Device controls are off until an ADMIN enables them (D-006, D-015).';

drop trigger if exists household_settings_touch_updated_at on public.household_settings;
create trigger household_settings_touch_updated_at
  before update on public.household_settings
  for each row execute function private.touch_updated_at();

-- Single-row marker proving the one-time bootstrap ran (D-005). Server-only.
create table if not exists public.system_bootstrap (
  id boolean primary key default true check (id),
  completed_at timestamptz not null default now(),
  household_id uuid references public.households (id) on delete set null,
  bootstrap_by_email_hash bytea
);
comment on table public.system_bootstrap is 'At most one row (id is always true). Written once by the bootstrap function (TASK-04).';

select private.lock_down_public_tables();
