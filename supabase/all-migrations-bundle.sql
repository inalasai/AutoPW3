-- AutoPW3 Consolidated Database Migrations
-- Generated for easy single-query execution in Supabase Dashboard SQL Editor

-- ==========================================
-- Migration: 20261023120000_create_extensions_and_helpers.sql
-- ==========================================

-- TASK-03 migration 1/7: extensions, schemas, role type and shared helper functions.
-- Design: docs/DATABASE_DESIGN.md. Safe to re-run (idempotent).
--
-- Rollback notes (manual, development only; never run on a database holding real data):
--   drop function if exists private.lock_down_public_tables(), private.validate_timezone(),
--     private.reject_modification(), private.reject_audit_modification(), private.touch_updated_at();
--   drop type if exists public.role_enum;
--   drop schema if exists private;   -- extensions are left installed

set search_path = public, extensions;

create schema if not exists extensions;
create extension if not exists citext with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Server-only schema for helper and (later) SECURITY DEFINER functions. Not exposed through the API.
create schema if not exists private;
revoke all on schema private from public;
alter default privileges in schema private revoke execute on functions from public;

-- Household roles (D-004, docs/SECURITY_MODEL.md section 2). There is intentionally no default role here:
-- the column using this type never defaults to ADMIN, and new memberships are READ_ONLY by policy (TASK-04).
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'role_enum'
  ) then
    create type public.role_enum as enum ('READ_ONLY', 'READ_WRITE', 'ADMIN');
  end if;
end
$$;

comment on type public.role_enum is
  'Household role. READ_ONLY < READ_WRITE < ADMIN. Authoritative definition: docs/SECURITY_MODEL.md section 2.';

-- IANA timezone validation. A CHECK constraint cannot read pg_timezone_names, so a trigger does it.
-- Accepts names present in pg_timezone_names except the posix/ and right/ aliases.
create or replace function private.validate_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.timezone is not null and (
    new.timezone ~ '^(posix|right)/'
    or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone)
  ) then
    raise exception 'invalid IANA timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end
$$;

-- Append-only guard for event tables. UPDATE is always rejected. DELETE is rejected unless it is part of a
-- foreign-key cascade (trigger depth > 1), so deleting a household, site or command still works while a user
-- or the Worker cannot delete rows directly. Retention deletes are added by TASK-16 through a reviewed function.
create or replace function private.reject_modification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '% is append-only (% rejected)', tg_table_name, tg_op using errcode = '55000';
end
$$;

-- audit_log variant: additionally allows the foreign-key action ON DELETE SET NULL on actor_user_id
-- (so deleting a user keeps the log but removes the link to the person; docs/PRIVACY.md).
create or replace function private.reject_audit_modification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if tg_op = 'UPDATE'
     and pg_trigger_depth() > 1
     and new.actor_user_id is null
     and (to_jsonb(new) - 'actor_user_id') = (to_jsonb(old) - 'actor_user_id') then
    return new;
  end if;
  raise exception 'audit_log is append-only (% rejected)', tg_op using errcode = '55000';
end
$$;

-- Keeps updated_at truthful without relying on every writer to set it.
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

-- Safe default for every table in schema public: row level security enabled and no access for PUBLIC,
-- anon or authenticated. Policies and explicit grants are TASK-04. Called at the end of each migration;
-- service_role is intentionally untouched (it bypasses RLS and is used only by the Worker, D-006).
create or replace function private.lock_down_public_tables()
returns void
language plpgsql
set search_path = ''
as $$
declare
  r record;
  role_name text;
begin
  for r in
    select c.oid::pg_catalog.regclass as obj, c.relkind
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'S')
  loop
    if r.relkind in ('r', 'p') then
      execute pg_catalog.format('alter table %s enable row level security', r.obj);
      execute pg_catalog.format('revoke all on table %s from public', r.obj);
    else
      execute pg_catalog.format('revoke all on sequence %s from public', r.obj);
    end if;
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_catalog.pg_roles where rolname = role_name) then
        if r.relkind in ('r', 'p') then
          execute pg_catalog.format('revoke all on table %s from %I', r.obj, role_name);
        else
          execute pg_catalog.format('revoke all on sequence %s from %I', r.obj, role_name);
        end if;
      end if;
    end loop;
  end loop;
end
$$;

revoke all on function private.lock_down_public_tables() from public;

-- Supabase grants new public tables to anon/authenticated by default. Remove that default for the role running
-- migrations so a forgotten table is not exposed. (Skipped on plain PostgreSQL where these roles do not exist.)
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
     and exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    alter default privileges in schema public revoke all on tables from anon, authenticated;
    alter default privileges in schema public revoke all on sequences from anon, authenticated;
  end if;
end
$$;


-- ==========================================
-- Migration: 20261023120100_create_identity_tenancy_tables.sql
-- ==========================================

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


-- ==========================================
-- Migration: 20261023120200_create_sites_and_credentials_tables.sql
-- ==========================================

-- TASK-03 migration 3/7: energy sites, Tesla credentials, OAuth state.
-- Design: docs/DATABASE_DESIGN.md section 2.2. Safe to re-run (idempotent).
-- tesla_credentials and oauth_states must never be readable by anon or authenticated (docs/SECURITY_MODEL.md S1, S8).
--
-- Rollback notes (development only):
--   drop table if exists public.oauth_states, public.tesla_credentials, public.energy_sites cascade;

set search_path = public, extensions;

create table if not exists public.energy_sites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- Only real provider data is stored. There is no DEMO provider in the database (D-017).
  provider text not null check (provider = 'TESLA'),
  provider_site_id text not null check (char_length(provider_site_id) between 1 and 100),
  name text check (name is null or char_length(name) between 1 and 100),
  timezone text not null,
  connection_state text not null default 'CONNECTING'
    check (connection_state in ('CONNECTING', 'LIVE', 'STALE', 'ERROR', 'DISCONNECTED')),
  capabilities_snapshot jsonb check (capabilities_snapshot is null or jsonb_typeof(capabilities_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (provider, provider_site_id),
  -- Lets child tables prove (site_id, household_id) belong together with a composite foreign key.
  unique (id, household_id)
);
comment on column public.energy_sites.timezone is 'IANA timezone of the site. Defines the local calendar day for rollups and tariffs.';
comment on column public.energy_sites.provider is 'Always TESLA. The Tesla mock adapter shares this value in local/test; it can never write DEMO data here (D-017).';
create index if not exists energy_sites_household_id_idx on public.energy_sites (household_id);

drop trigger if exists energy_sites_validate_timezone on public.energy_sites;
create trigger energy_sites_validate_timezone
  before insert or update of timezone on public.energy_sites
  for each row execute function private.validate_timezone();

-- Encrypted Tesla tokens (docs/SYSTEM_ARCHITECTURE.md section 8). Ciphertext only: AES-256-GCM with a
-- 96-bit nonce; the key lives in Cloudflare secrets, never here. AAD = household_id | provider | id | key_id.
create table if not exists public.tesla_credentials (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null unique references public.households (id) on delete cascade,
  key_id text not null check (char_length(key_id) between 1 and 64),
  nonce bytea not null check (octet_length(nonce) = 12),
  ciphertext bytea not null check (octet_length(ciphertext) > 16),
  version integer not null default 1 check (version >= 1),
  scopes text[],
  fleet_api_base_url text not null check (fleet_api_base_url ~ '^https://'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'NEEDS_REAUTH', 'REVOKED')),
  access_expires_at timestamptz,
  refresh_issued_at timestamptz,
  last_refresh_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table public.tesla_credentials is
  'Encrypted Tesla OAuth tokens. No access for anon or authenticated; only the Worker secret key reads it (docs/SECURITY_MODEL.md S1).';
comment on column public.tesla_credentials.ciphertext is 'AES-256-GCM ciphertext of {access_token, refresh_token}. Plaintext tokens are never stored.';
comment on column public.tesla_credentials.fleet_api_base_url is 'Regional Fleet API base URL discovered per user. The EU value is UNVERIFIED (Q-02).';

drop trigger if exists tesla_credentials_touch_updated_at on public.tesla_credentials;
create trigger tesla_credentials_touch_updated_at
  before update on public.tesla_credentials
  for each row execute function private.touch_updated_at();

-- Pending Tesla OAuth authorisations. Single use; the state value is stored only as a hash.
create table if not exists public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash bytea not null unique check (octet_length(state_hash) = 32),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  pkce_verifier_ciphertext bytea not null,
  pkce_nonce bytea not null check (octet_length(pkce_nonce) = 12),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index if not exists oauth_states_expires_at_idx on public.oauth_states (expires_at);
create index if not exists oauth_states_household_id_idx on public.oauth_states (household_id);

select private.lock_down_public_tables();


-- ==========================================
-- Migration: 20261023120300_create_telemetry_tables.sql
-- ==========================================

-- TASK-03 migration 4/7: telemetry (raw snapshots, provider energy intervals, rollups, sync state, usage counters).
-- Design: docs/DATABASE_DESIGN.md section 2.3 and 4; units and signs: docs/ENERGY_ACCOUNTING.md section 2.
-- Safe to re-run (idempotent). No partitioning in v1 (D-011).
--
-- Sign convention (every power column): solar >= 0; battery > 0 discharging, < 0 charging;
-- grid > 0 importing, < 0 exporting; load >= 0. Energy columns are directional and >= 0.
-- Native Tesla signs are UNVERIFIED: the Worker normalises to this convention before inserting (TASK-15).
--
-- Rollback notes (development only):
--   drop table if exists public.provider_usage_daily, public.telemetry_sync_state, public.telemetry_rollups_daily,
--     public.telemetry_rollups_hourly, public.energy_intervals, public.powerwall_metrics_log cascade;

set search_path = public, extensions;

-- Raw power snapshots. The unique key doubles as the (site_id, sampled_at) range index (btree scans both ways).
create table if not exists public.powerwall_metrics_log (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.energy_sites (id) on delete cascade,
  sampled_at timestamptz not null,
  received_at timestamptz not null default now(),
  timestamp_origin text not null check (timestamp_origin in ('PROVIDER', 'RECEIVED')),
  solar_power_w numeric(12, 2) check (solar_power_w >= 0),
  battery_power_w numeric(12, 2),
  grid_power_w numeric(12, 2),
  load_power_w numeric(12, 2) check (load_power_w >= 0),
  battery_soc_percent numeric(5, 2) check (battery_soc_percent between 0 and 100),
  grid_status text check (grid_status is null or char_length(grid_status) <= 64),
  -- DEMO data can never be stored here (D-017). The mock adapter in tests produces TESLA-shaped rows only locally.
  source text not null check (source = 'TESLA'),
  quality text not null default 'OK' check (quality in ('OK', 'PARTIAL', 'SUSPECT')),
  unique (site_id, sampled_at)
);
comment on table public.powerwall_metrics_log is 'Raw power snapshots, normalised to the project sign convention. No raw provider payload is stored.';
comment on column public.powerwall_metrics_log.sampled_at is 'UTC instant of the sample: provider timestamp if given, else received_at (see timestamp_origin).';
comment on column public.powerwall_metrics_log.solar_power_w is 'Solar generation in W. >= 0.';
comment on column public.powerwall_metrics_log.battery_power_w is 'Battery power in W. > 0 discharging (supplying the site), < 0 charging.';
comment on column public.powerwall_metrics_log.grid_power_w is 'Grid power in W. > 0 importing from the grid, < 0 exporting to the grid.';
comment on column public.powerwall_metrics_log.load_power_w is 'Site load in W. >= 0.';
comment on column public.powerwall_metrics_log.battery_soc_percent is 'Battery state of charge, percent, 0 to 100.';
comment on column public.powerwall_metrics_log.source is 'Always TESLA. DEMO is rejected by CHECK (D-017).';
comment on column public.powerwall_metrics_log.quality is 'OK, PARTIAL (a field missing) or SUSPECT (energy balance check failed; excluded from accounting).';

-- Provider-reported energy per interval: the primary accounting source (D-022). Intervals are half-open [start, end).
-- Which fields and resolutions Tesla returns is UNVERIFIED (TASK-00 Q6), so every energy column is nullable:
-- an unavailable field is NULL, never zero.
create table if not exists public.energy_intervals (
  site_id uuid not null references public.energy_sites (id) on delete cascade,
  interval_start timestamptz not null,
  interval_end timestamptz not null,
  resolution_seconds integer not null check (resolution_seconds > 0),
  solar_generated_wh numeric(14, 3) check (solar_generated_wh >= 0),
  home_consumed_wh numeric(14, 3) check (home_consumed_wh >= 0),
  grid_import_wh numeric(14, 3) check (grid_import_wh >= 0),
  grid_export_wh numeric(14, 3) check (grid_export_wh >= 0),
  battery_charged_wh numeric(14, 3) check (battery_charged_wh >= 0),
  battery_discharged_wh numeric(14, 3) check (battery_discharged_wh >= 0),
  source text not null check (source = 'TESLA'),
  quality text not null default 'OK' check (quality in ('OK', 'PARTIAL', 'SUSPECT', 'DERIVED')),
  ingested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, interval_start, resolution_seconds),
  check (interval_end > interval_start)
);
comment on table public.energy_intervals is 'Provider energy per interval [interval_start, interval_end), Wh. NULL means the provider did not supply the field.';
comment on column public.energy_intervals.solar_generated_wh is 'Solar energy generated, Wh, >= 0.';
comment on column public.energy_intervals.home_consumed_wh is 'Energy consumed by the site load, Wh, >= 0.';
comment on column public.energy_intervals.grid_import_wh is 'Energy imported from the grid, Wh, >= 0.';
comment on column public.energy_intervals.grid_export_wh is 'Energy exported to the grid, Wh, >= 0.';
comment on column public.energy_intervals.battery_charged_wh is 'Energy into the battery, Wh, >= 0.';
comment on column public.energy_intervals.battery_discharged_wh is 'Energy out of the battery, Wh, >= 0.';
comment on column public.energy_intervals.quality is 'DERIVED = integrated from power snapshots (lower confidence than provider energy).';

drop trigger if exists energy_intervals_touch_updated_at on public.energy_intervals;
create trigger energy_intervals_touch_updated_at
  before update on public.energy_intervals
  for each row execute function private.touch_updated_at();

-- Rollups are rebuilt from source data for each touched bucket, never incremented (docs/DATABASE_DESIGN.md section 4).
create table if not exists public.telemetry_rollups_hourly (
  site_id uuid not null references public.energy_sites (id) on delete cascade,
  bucket_start timestamptz not null,
  solar_generated_wh numeric(14, 3) check (solar_generated_wh >= 0),
  home_consumed_wh numeric(14, 3) check (home_consumed_wh >= 0),
  grid_import_wh numeric(14, 3) check (grid_import_wh >= 0),
  grid_export_wh numeric(14, 3) check (grid_export_wh >= 0),
  battery_charged_wh numeric(14, 3) check (battery_charged_wh >= 0),
  battery_discharged_wh numeric(14, 3) check (battery_discharged_wh >= 0),
  sample_count integer not null default 0 check (sample_count >= 0),
  covered_seconds integer not null default 0 check (covered_seconds between 0 and 3600),
  completeness numeric(5, 4) not null check (completeness between 0 and 1),
  resolution_seconds_min integer check (resolution_seconds_min > 0),
  resolution_seconds_max integer check (resolution_seconds_max > 0),
  computed_at timestamptz not null default now(),
  primary key (site_id, bucket_start),
  -- bucket is a whole UTC hour
  check ((bucket_start at time zone 'UTC') = date_trunc('hour', bucket_start at time zone 'UTC')),
  check (resolution_seconds_min is null or resolution_seconds_max is null or resolution_seconds_min <= resolution_seconds_max)
);
comment on table public.telemetry_rollups_hourly is 'Energy per UTC hour in Wh. completeness is covered time / bucket time; real min/max resolution is recorded.';
comment on column public.telemetry_rollups_hourly.completeness is 'Fraction of the bucket covered by data, 0 to 1. Never rounded up to hide gaps.';

create table if not exists public.telemetry_rollups_daily (
  site_id uuid not null references public.energy_sites (id) on delete cascade,
  local_date date not null,
  timezone text not null,
  day_start_utc timestamptz not null,
  day_end_utc timestamptz not null,
  solar_generated_wh numeric(14, 3) check (solar_generated_wh >= 0),
  home_consumed_wh numeric(14, 3) check (home_consumed_wh >= 0),
  grid_import_wh numeric(14, 3) check (grid_import_wh >= 0),
  grid_export_wh numeric(14, 3) check (grid_export_wh >= 0),
  battery_charged_wh numeric(14, 3) check (battery_charged_wh >= 0),
  battery_discharged_wh numeric(14, 3) check (battery_discharged_wh >= 0),
  completeness numeric(5, 4) not null check (completeness between 0 and 1),
  resolution_seconds_min integer check (resolution_seconds_min > 0),
  resolution_seconds_max integer check (resolution_seconds_max > 0),
  computed_at timestamptz not null default now(),
  primary key (site_id, local_date),
  -- A site-local day is 23, 24 or 25 hours on DST changes (24 +/- 1 h); half-hour DST zones give 23.5 or 24.5 h.
  check (day_end_utc > day_start_utc),
  check (day_end_utc - day_start_utc between interval '23 hours' and interval '25 hours'),
  check (resolution_seconds_min is null or resolution_seconds_max is null or resolution_seconds_min <= resolution_seconds_max)
);
comment on table public.telemetry_rollups_daily is 'Energy per site-local calendar day in Wh. day_end_utc - day_start_utc stores the real day length (DST).';
comment on column public.telemetry_rollups_daily.local_date is 'Calendar date in the site timezone.';

drop trigger if exists telemetry_rollups_daily_validate_timezone on public.telemetry_rollups_daily;
create trigger telemetry_rollups_daily_validate_timezone
  before insert or update of timezone on public.telemetry_rollups_daily
  for each row execute function private.validate_timezone();

-- Column comments for the rollup energy columns (units and meaning), shared by the hourly and daily tables.
do $$
declare
  t text;
  c record;
begin
  foreach t in array array['telemetry_rollups_hourly', 'telemetry_rollups_daily'] loop
    for c in
      select * from (values
        ('solar_generated_wh', 'Solar energy generated in the bucket, Wh, >= 0.'),
        ('home_consumed_wh', 'Energy consumed by the site load in the bucket, Wh, >= 0.'),
        ('grid_import_wh', 'Energy imported from the grid in the bucket, Wh, >= 0.'),
        ('grid_export_wh', 'Energy exported to the grid in the bucket, Wh, >= 0.'),
        ('battery_charged_wh', 'Energy into the battery in the bucket, Wh, >= 0.'),
        ('battery_discharged_wh', 'Energy out of the battery in the bucket, Wh, >= 0.')
      ) as v(col, descr)
    loop
      execute format('comment on column public.%I.%I is %L', t, c.col, c.descr || ' NULL = not available from the provider, never zero.');
    end loop;
  end loop;
end
$$;

create table if not exists public.telemetry_sync_state (
  site_id uuid not null references public.energy_sites (id) on delete cascade,
  stream text not null check (stream in ('LIVE', 'HISTORY')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_status text check (last_status in ('SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED')),
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 64),
  cursor jsonb check (cursor is null or jsonb_typeof(cursor) = 'object'),
  latest_sample_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  primary key (site_id, stream)
);
comment on table public.telemetry_sync_state is 'Per-site ingestion cursors and health. HISTORY cursor = last completed interval end.';

-- Counters used by the Tesla budget guard (D-023). Written only by a server function added in TASK-16.
create table if not exists public.provider_usage_daily (
  household_id uuid not null references public.households (id) on delete cascade,
  usage_day date not null,
  category text not null check (category in ('DATA', 'COMMAND', 'WAKE', 'STREAM', 'AUTH')),
  request_count integer not null default 0 check (request_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  primary key (household_id, usage_day, category),
  check (error_count <= request_count)
);
comment on column public.provider_usage_daily.usage_day is 'UTC date. The billing category of each endpoint is UNVERIFIED (D-023).';

select private.lock_down_public_tables();


-- ==========================================
-- Migration: 20261023120400_create_tariff_tables.sql
-- ==========================================

-- TASK-03 migration 5/7: tariffs (versioned, effective-dated, directional) and the cost cache.
-- Design: docs/DATABASE_DESIGN.md section 2.4; arithmetic and precedence: docs/ENERGY_ACCOUNTING.md sections 5 to 7.
-- Safe to re-run (idempotent). All rate and money columns are numeric with explicit scale; never float (D-014).
-- Irish or any other real-world rates are NOT stored here. Local seed values are labelled ILLUSTRATIVE EXAMPLE.
--
-- Overlap prevention done in the database (exclusion constraints, btree_gist):
--   * utility_tariffs: no overlapping effective dates for the same household, site (or household default) and direction
--   * tariff_slots: no overlapping minute ranges inside one (tariff, season, override, day_type) scope
--   * tariff_overrides: no overlapping date ranges with equal priority for one tariff
--   * tariff_price_points: no overlapping intervals per dynamic tariff
-- Left to the tariff engine (TASK-10) because they cannot be expressed simply as constraints:
--   * full 24-hour coverage of each scope (gaps are an error, never a zero price, rule 8)
--   * overlap between day_type ALL and WEEKDAY/WEEKEND slots
--   * season ranges that wrap the year-end, and valid day-of-month for each season month
--   * versions sharing a tariff_key having the same household, site and direction
--   * dynamic price points existing only for price_mode DYNAMIC tariffs
--
-- Rollback notes (development only):
--   drop table if exists public.cost_rollups_daily, public.tariff_price_points, public.tariff_levies,
--     public.tariff_slots, public.tariff_overrides, public.tariff_seasons, public.utility_tariffs cascade;

set search_path = public, extensions;

create table if not exists public.utility_tariffs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  site_id uuid,
  -- Groups the versions of one logical tariff. Editing a tariff creates a new row (version + 1); see design 2.4.
  tariff_key uuid not null default gen_random_uuid(),
  version integer not null default 1 check (version >= 1),
  name text not null check (char_length(name) between 1 and 100),
  direction text not null check (direction in ('IMPORT', 'EXPORT')),
  price_mode text not null check (price_mode in ('FLAT', 'TIME_OF_USE', 'DYNAMIC')),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  timezone text not null,
  effective_from date not null,
  effective_to date,
  tax_mode text not null default 'NONE' check (tax_mode in ('INCLUSIVE', 'EXCLUSIVE', 'NONE')),
  vat_rate numeric(7, 4) check (vat_rate between 0 and 100),
  flat_rate_per_kwh numeric(12, 6) check (flat_rate_per_kwh >= 0),
  standing_charge_per_day numeric(12, 6) check (standing_charge_per_day >= 0),
  export_payment_model text check (export_payment_model in ('PER_KWH', 'NONE')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tariff_key, version),
  unique (id, household_id),
  foreign key (site_id, household_id) references public.energy_sites (id, household_id) on delete cascade,
  check (effective_to is null or effective_to > effective_from),
  -- FLAT tariffs carry one rate; TIME_OF_USE and DYNAMIC take rates from slots or price points.
  check ((price_mode = 'FLAT') = (flat_rate_per_kwh is not null)),
  -- A VAT rate is required exactly when the tariff is taxed.
  check ((tax_mode = 'NONE') = (vat_rate is null)),
  -- Direction-specific columns.
  check (direction = 'IMPORT' or standing_charge_per_day is null),
  check (direction = 'EXPORT' or export_payment_model is null),
  constraint utility_tariffs_no_overlap exclude using gist (
    household_id with =,
    (coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    direction with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);
comment on table public.utility_tariffs is 'One row per tariff version per direction. Effective dates are site-local calendar dates in `timezone`, half-open [effective_from, effective_to).';
comment on column public.utility_tariffs.site_id is 'NULL = household default tariff; otherwise applies to that site only.';
comment on column public.utility_tariffs.currency is 'ISO 4217 code. Every money value derived from this tariff carries this currency.';
comment on column public.utility_tariffs.vat_rate is 'VAT/tax rate in percent (for example 23.0000 means 23 percent), 0 to 100.';
comment on column public.utility_tariffs.flat_rate_per_kwh is 'Rate per kWh in the tariff currency, scale 6. Money is never a float (D-014).';
comment on column public.utility_tariffs.standing_charge_per_day is 'Fixed charge per local day in the tariff currency. IMPORT tariffs only.';
comment on column public.utility_tariffs.export_payment_model is 'EXPORT tariffs only: PER_KWH pays for exported energy, NONE pays nothing.';
create index if not exists utility_tariffs_household_direction_idx on public.utility_tariffs (household_id, direction, effective_from);
create index if not exists utility_tariffs_site_id_idx on public.utility_tariffs (site_id) where site_id is not null;

drop trigger if exists utility_tariffs_validate_timezone on public.utility_tariffs;
create trigger utility_tariffs_validate_timezone
  before insert or update of timezone on public.utility_tariffs
  for each row execute function private.validate_timezone();

create table if not exists public.tariff_seasons (
  id uuid primary key default gen_random_uuid(),
  tariff_id uuid not null references public.utility_tariffs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  start_month smallint not null check (start_month between 1 and 12),
  start_day smallint not null check (start_day between 1 and 31),
  end_month smallint not null check (end_month between 1 and 12),
  end_day smallint not null check (end_day between 1 and 31),
  unique (id, tariff_id)
);
comment on table public.tariff_seasons is 'Inclusive month/day ranges within a tariff; may wrap the year-end. Absence of seasons means all year. Overlap and gaps are validated by the tariff engine.';
create index if not exists tariff_seasons_tariff_id_idx on public.tariff_seasons (tariff_id);

create table if not exists public.tariff_overrides (
  id uuid primary key default gen_random_uuid(),
  tariff_id uuid not null references public.utility_tariffs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  date_from date not null,
  date_to date not null,
  priority smallint not null default 0,
  unique (id, tariff_id),
  check (date_to > date_from),
  constraint tariff_overrides_no_equal_priority_overlap exclude using gist (
    tariff_id with =,
    priority with =,
    daterange(date_from, date_to, '[)') with &&
  )
);
comment on table public.tariff_overrides is 'Date-range replacement of the normal schedule [date_from, date_to), site-local dates. Higher priority wins; equal-priority overlaps are rejected.';
create index if not exists tariff_overrides_tariff_id_idx on public.tariff_overrides (tariff_id);

create table if not exists public.tariff_slots (
  id uuid primary key default gen_random_uuid(),
  tariff_id uuid not null references public.utility_tariffs (id) on delete cascade,
  season_id uuid,
  override_id uuid,
  day_type text not null default 'ALL' check (day_type in ('ALL', 'WEEKDAY', 'WEEKEND')),
  start_minute smallint not null check (start_minute between 0 and 1439),
  end_minute smallint not null check (end_minute between 1 and 1440),
  rate_per_kwh numeric(12, 6) not null check (rate_per_kwh >= 0),
  label text check (label is null or char_length(label) <= 100),
  check (end_minute > start_minute),
  -- A slot belongs to a season or an override, not both.
  check (num_nonnulls(season_id, override_id) <= 1),
  -- Composite keys prove the season/override belongs to the same tariff as the slot.
  foreign key (season_id, tariff_id) references public.tariff_seasons (id, tariff_id) on delete cascade,
  foreign key (override_id, tariff_id) references public.tariff_overrides (id, tariff_id) on delete cascade,
  constraint tariff_slots_no_overlap exclude using gist (
    tariff_id with =,
    (coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(override_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    day_type with =,
    int4range(start_minute::integer, end_minute::integer, '[)') with &&
  )
);
comment on table public.tariff_slots is 'Rate per local wall-clock time window. Local minutes, never UTC offsets, so schedules stay correct across DST (rule 7).';
comment on column public.tariff_slots.start_minute is 'Minutes after local midnight, 0 to 1439, inclusive start.';
comment on column public.tariff_slots.end_minute is 'Minutes after local midnight, 1 to 1440, exclusive end (1440 = end of day).';
comment on column public.tariff_slots.rate_per_kwh is 'Rate per kWh in the tariff currency, scale 6.';
create index if not exists tariff_slots_tariff_id_idx on public.tariff_slots (tariff_id);

create table if not exists public.tariff_levies (
  id uuid primary key default gen_random_uuid(),
  tariff_id uuid not null references public.utility_tariffs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  kind text not null check (kind in ('PER_KWH', 'PER_DAY')),
  amount numeric(12, 6) not null check (amount >= 0),
  taxable boolean not null
);
comment on column public.tariff_levies.amount is 'Per kWh or per local day (see kind) in the tariff currency, scale 6.';
create index if not exists tariff_levies_tariff_id_idx on public.tariff_levies (tariff_id);

-- Dynamic prices at any resolution. Missing coverage is an error in the engine, never a zero price (rule 8).
create table if not exists public.tariff_price_points (
  tariff_id uuid not null references public.utility_tariffs (id) on delete cascade,
  interval_start timestamptz not null,
  interval_end timestamptz not null,
  rate_per_kwh numeric(12, 6) not null check (rate_per_kwh >= 0),
  primary key (tariff_id, interval_start),
  check (interval_end > interval_start),
  constraint tariff_price_points_no_overlap exclude using gist (
    tariff_id with =,
    tstzrange(interval_start, interval_end, '[)') with &&
  )
);

-- Recomputable cache of priced results (design 2.3). Deleted and rebuilt when a covering tariff version changes.
-- Money columns are nullable: a component that could not be priced is NULL, never silently zero (rules 8 and 9).
create table if not exists public.cost_rollups_daily (
  site_id uuid not null references public.energy_sites (id) on delete cascade,
  local_date date not null,
  import_tariff_id uuid references public.utility_tariffs (id) on delete set null,
  export_tariff_id uuid references public.utility_tariffs (id) on delete set null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  import_energy_cost numeric(18, 8),
  export_credit numeric(18, 8),
  standing_charge numeric(18, 8),
  levies numeric(18, 8),
  tax numeric(18, 8),
  net_cost numeric(18, 8),
  completeness numeric(5, 4) not null check (completeness between 0 and 1),
  computed_at timestamptz not null default now(),
  primary key (site_id, local_date)
);
comment on table public.cost_rollups_daily is 'Derived cache, unrounded (scale 8); rounding happens once per displayed line in the money formatter (D-014). Safe to delete and rebuild.';
comment on column public.cost_rollups_daily.net_cost is 'Positive = cost to the household, negative = net credit. NULL when not fully priceable.';

select private.lock_down_public_tables();


-- ==========================================
-- Migration: 20261023120500_create_command_and_automation_tables.sql
-- ==========================================

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


-- ==========================================
-- Migration: 20261023120600_create_jobs_and_audit_tables.sql
-- ==========================================

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


-- ==========================================
-- Migration: 20261023130000_security_helpers.sql
-- ==========================================

-- TASK-04 migration 1/4: security helpers.
-- Membership helpers used by RLS policies, the allowlisted audit writer, trigger helpers and the revised
-- lock-down function. Safe to re-run (idempotent). Policies and grants are in migration 4/4.
--
-- Every SECURITY DEFINER function here has: SET search_path = '', schema-qualified references,
-- EXECUTE revoked from PUBLIC and anon, and an explicit grant only to the roles that need it.
-- Definer functions run as the migration owner, which bypasses RLS because FORCE ROW LEVEL SECURITY is NOT used
-- (decision D-031). The owner role is not reachable through the API.
--
-- Rollback notes (development only; never run on a database holding real data):
--   drop function if exists private.is_member(uuid), private.has_role_at_least(uuid, public.role_enum),
--     private.touch_audit(uuid, text, text, text, jsonb), private.stamp_actor(), private.reject_truncate();
--   -- private.lock_down_public_tables() is redefined here; migration 1/7 restores the original on re-apply.

set search_path = public, extensions;

create extension if not exists pgcrypto with schema extensions;

-- Schema usage: authenticated needs it to evaluate policy expressions that call the two helpers below;
-- service_role needs it to call server-only functions such as private.bootstrap_first_admin.
-- anon gets nothing. Functions in private stay unusable unless granted individually.
grant usage on schema private to authenticated, service_role;

-- Functions created before this migration (the TASK-03 trigger helpers) still carry PostgreSQL's default
-- EXECUTE-for-PUBLIC. Now that authenticated may use schema private, close that: no role gets EXECUTE on a private
-- function unless granted below or in a later migration.
revoke all on all functions in schema private from public, anon, authenticated;

-- Future functions are not executable by PUBLIC unless granted. (Existing functions are fixed explicitly below.)
alter default privileges revoke execute on functions from public;
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
     and exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    alter default privileges in schema public revoke execute on functions from anon, authenticated;
  end if;
end
$$;

-- Is the signed-in user a member of the household? False when there is no signed-in user (anon).
create or replace function private.is_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = p_household_id
      and m.user_id = (select auth.uid())
  );
$$;

-- Does the signed-in user hold at least the given role in the household? Enum order is
-- READ_ONLY < READ_WRITE < ADMIN, so a plain comparison is correct.
create or replace function private.has_role_at_least(p_household_id uuid, p_min_role public.role_enum)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = p_household_id
      and m.user_id = (select auth.uid())
      and m.role >= p_min_role
  );
$$;

revoke all on function private.is_member(uuid) from public, anon;
revoke all on function private.has_role_at_least(uuid, public.role_enum) from public, anon;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_role_at_least(uuid, public.role_enum) to authenticated;

-- Allowlisted audit writer. Callers pass a metadata object; only the keys listed for the action survive, so a
-- careless caller cannot put a token, JWT or telemetry value into the log. Unknown actions are rejected.
-- The actor is whoever holds the JWT in this transaction; no JWT means SYSTEM.
create or replace function private.touch_audit(
  p_household_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_allowed text[];
  v_clean jsonb;
begin
  v_allowed := case p_action
    when 'member.added' then array['user_id', 'role']
    when 'member.role_changed' then array['user_id', 'old_role', 'new_role']
    when 'member.removed' then array['user_id', 'role']
    when 'invitation.created' then array['invitation_id', 'role', 'email_bound', 'expires_at']
    when 'invitation.accepted' then array['invitation_id', 'role']
    when 'invitation.revoked' then array['invitation_id']
    when 'bootstrap.completed' then array['household_id']
    when 'rule.mode_changed' then array['rule_id', 'old_mode', 'new_mode']
    when 'automation.paused' then array[]::text[]
    when 'automation.resumed' then array[]::text[]
    when 'settings.changed' then array['changed']
    when 'command.requested' then array['command_id', 'kind', 'origin', 'provider_mode']
    when 'tariff.version_created' then array['tariff_id', 'tariff_key', 'version']
    when 'tariff.deleted' then array['tariff_id', 'tariff_key', 'version']
    else null
  end;
  if v_allowed is null then
    raise exception 'unknown audit action: %', p_action using errcode = '22023';
  end if;

  select coalesce(pg_catalog.jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into v_clean
  from pg_catalog.jsonb_each(coalesce(p_metadata, '{}'::jsonb)) as e
  where e.key = any (v_allowed);

  insert into public.audit_log (household_id, actor_type, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_household_id,
    case when v_uid is null then 'SYSTEM' else 'USER' end,
    v_uid,
    p_action,
    p_target_type,
    p_target_id,
    v_clean
  );
end
$$;

revoke all on function private.touch_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Stamps the acting user into the named columns (trigger arguments) when a JWT is present, so created_by,
-- updated_by and requested_by cannot be spoofed by the caller. Without a JWT (Worker secret key, migrations)
-- the values supplied by the caller are kept.
create or replace function private.stamp_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row jsonb;
  v_col text;
begin
  if v_uid is null then
    return new;
  end if;
  v_row := pg_catalog.to_jsonb(new);
  foreach v_col in array tg_argv loop
    v_row := pg_catalog.jsonb_set(v_row, array[v_col], pg_catalog.to_jsonb(v_uid));
  end loop;
  new := pg_catalog.jsonb_populate_record(new, v_row);
  return new;
end
$$;

-- TRUNCATE does not fire row triggers, so append-only tables get a statement trigger as well.
create or replace function private.reject_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only (TRUNCATE rejected)', tg_table_name using errcode = '55000';
end
$$;

-- Revised lock-down (replaces the TASK-03 version). Called at the end of every migration that creates tables.
-- Always: row level security on, nothing for PUBLIC or anon. For authenticated: revoke everything on tables that
-- have NO policy yet, so a new table is closed until its migration adds policies and explicit grants, while the
-- deliberate exposures made by migration 4/4 are kept when a later migration calls this function again.
create or replace function private.lock_down_public_tables()
returns void
language plpgsql
set search_path = ''
as $$
declare
  r record;
  role_name text;
begin
  for r in
    select c.oid as oid, c.oid::pg_catalog.regclass as obj, c.relkind
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'S')
  loop
    if r.relkind in ('r', 'p') then
      execute pg_catalog.format('alter table %s enable row level security', r.obj);
      execute pg_catalog.format('revoke all on table %s from public', r.obj);
    else
      execute pg_catalog.format('revoke all on sequence %s from public', r.obj);
    end if;
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_catalog.pg_roles where rolname = role_name) then
        if r.relkind in ('r', 'p') then
          if role_name = 'anon'
             or not exists (select 1 from pg_catalog.pg_policy p where p.polrelid = r.oid) then
            execute pg_catalog.format('revoke all on table %s from %I', r.obj, role_name);
          end if;
        else
          execute pg_catalog.format('revoke all on sequence %s from %I', r.obj, role_name);
        end if;
      end if;
    end loop;
  end loop;
end
$$;

revoke all on function private.lock_down_public_tables() from public, anon, authenticated;


-- ==========================================
-- Migration: 20261023130100_membership_integrity_and_audit_triggers.sql
-- ==========================================

-- TASK-04 migration 2/4: integrity triggers and audit triggers.
-- Membership guard (last-admin protection, no self role change, immutable keys), tariff version immutability,
-- append-only TRUNCATE guards, actor stamping, and audit triggers for privileged actions.
-- These triggers apply to EVERY writer, including the Worker's secret key and definer functions, because the
-- database is authoritative (docs/SECURITY_MODEL.md). Safe to re-run (idempotent).
--
-- Not enforced here: session_replication_role = replica (superuser only) disables triggers; that is a platform
-- operator capability and is recorded in docs/KNOWN_LIMITATIONS.md.
--
-- Rollback notes (development only):
--   drop trigger if exists household_members_guard on public.household_members;  (and the other triggers named below)
--   drop function if exists private.guard_membership(), private.audit_membership(), private.guard_tariff_version(),
--     private.audit_tariff_version(), private.audit_settings_changed(), private.audit_command_requested();

set search_path = public, extensions;

-- ---------------------------------------------------------------------------------------------------------------
-- household_members: last-admin protection, no self role change, immutable keys.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.guard_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.household_id <> old.household_id or new.user_id <> old.user_id then
      raise exception 'immutable_key' using errcode = 'P0001';
    end if;
    if new.role = old.role then
      return new;
    end if;
    -- Nobody changes their own role, whatever path they use (defence in depth: the functions check this too).
    if v_uid is not null and old.user_id = v_uid then
      raise exception 'self_change_not_allowed' using errcode = 'P0001';
    end if;
  end if;

  -- Demoting or removing an ADMIN: another ADMIN must remain. The advisory lock serialises membership changes
  -- per household, so two admins demoting each other at the same moment cannot both succeed.
  if old.role = 'ADMIN' and (tg_op = 'DELETE' or new.role <> 'ADMIN') then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('household_members:' || old.household_id::text, 0)
    );
    -- Deleting the household itself cascades to its members; that must not be blocked.
    if tg_op = 'DELETE'
       and not exists (select 1 from public.households h where h.id = old.household_id) then
      return old;
    end if;
    if not exists (
      select 1
      from public.household_members m
      where m.household_id = old.household_id
        and m.role = 'ADMIN'
        and m.user_id <> old.user_id
    ) then
      raise exception 'last_admin_protected' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

revoke all on function private.guard_membership() from public, anon, authenticated;

drop trigger if exists household_members_guard on public.household_members;
create trigger household_members_guard
  before insert or update or delete on public.household_members
  for each row execute function private.guard_membership();

-- Audit membership changes (all writers): member.added, member.role_changed, member.removed.
create or replace function private.audit_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.touch_audit(
      new.household_id, 'member.added', 'user', new.user_id::text,
      pg_catalog.jsonb_build_object('user_id', new.user_id, 'role', new.role)
    );
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      perform private.touch_audit(
        new.household_id, 'member.role_changed', 'user', new.user_id::text,
        pg_catalog.jsonb_build_object('user_id', new.user_id, 'old_role', old.role, 'new_role', new.role)
      );
    end if;
  elsif tg_op = 'DELETE' then
    -- No audit row when the whole household is being deleted (its audit rows are removed with it).
    if exists (select 1 from public.households h where h.id = old.household_id) then
      perform private.touch_audit(
        old.household_id, 'member.removed', 'user', old.user_id::text,
        pg_catalog.jsonb_build_object('user_id', old.user_id, 'role', old.role)
      );
    end if;
  end if;
  return null;
end
$$;

revoke all on function private.audit_membership() from public, anon, authenticated;

drop trigger if exists household_members_audit on public.household_members;
create trigger household_members_audit
  after insert or update or delete on public.household_members
  for each row execute function private.audit_membership();

-- ---------------------------------------------------------------------------------------------------------------
-- utility_tariffs: a version is immutable except its name and the date it stops applying (docs/DATABASE_DESIGN.md
-- 2.4: editing a tariff creates a new row). Audited on creation and deletion.
-- Child rows (slots, levies, price points) are not versioned in the schema; see KNOWN_LIMITATIONS L-031.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.guard_tariff_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (pg_catalog.to_jsonb(new) - 'name' - 'effective_to') is distinct from (pg_catalog.to_jsonb(old) - 'name' - 'effective_to') then
    raise exception 'tariff_version_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

drop trigger if exists utility_tariffs_guard_version on public.utility_tariffs;
create trigger utility_tariffs_guard_version
  before update on public.utility_tariffs
  for each row execute function private.guard_tariff_version();

create or replace function private.audit_tariff_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.touch_audit(
      new.household_id, 'tariff.version_created', 'utility_tariff', new.id::text,
      pg_catalog.jsonb_build_object('tariff_id', new.id, 'tariff_key', new.tariff_key, 'version', new.version)
    );
  elsif exists (select 1 from public.households h where h.id = old.household_id) then
    perform private.touch_audit(
      old.household_id, 'tariff.deleted', 'utility_tariff', old.id::text,
      pg_catalog.jsonb_build_object('tariff_id', old.id, 'tariff_key', old.tariff_key, 'version', old.version)
    );
  end if;
  return null;
end
$$;

revoke all on function private.audit_tariff_version() from public, anon, authenticated;

drop trigger if exists utility_tariffs_audit on public.utility_tariffs;
create trigger utility_tariffs_audit
  after insert or delete on public.utility_tariffs
  for each row execute function private.audit_tariff_version();

-- ---------------------------------------------------------------------------------------------------------------
-- Settings changes and command requests are audited; actor columns are stamped from the JWT.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.audit_settings_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cols constant text[] := array[
    'monthly_spend_cap_usd', 'live_background_interval_minutes', 'live_on_demand_min_interval_seconds',
    'on_demand_monthly_allowance', 'raw_retention_days', 'stale_after_seconds', 'controls_enabled'
  ];
  v_changed text[];
begin
  select coalesce(pg_catalog.array_agg(n.key order by n.key), array[]::text[])
    into v_changed
  from pg_catalog.jsonb_each(pg_catalog.to_jsonb(new)) as n
  where n.key = any (v_cols)
    and (pg_catalog.to_jsonb(old) -> n.key) is distinct from n.value;
  if pg_catalog.cardinality(v_changed) > 0 then
    perform private.touch_audit(
      new.household_id, 'settings.changed', 'household_settings', new.household_id::text,
      pg_catalog.jsonb_build_object('changed', pg_catalog.to_jsonb(v_changed))
    );
  end if;
  return null;
end
$$;

revoke all on function private.audit_settings_changed() from public, anon, authenticated;

drop trigger if exists household_settings_audit on public.household_settings;
create trigger household_settings_audit
  after update on public.household_settings
  for each row execute function private.audit_settings_changed();

drop trigger if exists household_settings_stamp_actor on public.household_settings;
create trigger household_settings_stamp_actor
  before update on public.household_settings
  for each row execute function private.stamp_actor('updated_by');

drop trigger if exists utility_tariffs_stamp_actor on public.utility_tariffs;
create trigger utility_tariffs_stamp_actor
  before insert on public.utility_tariffs
  for each row execute function private.stamp_actor('created_by');

drop trigger if exists automation_rules_stamp_actor_insert on public.automation_rules;
create trigger automation_rules_stamp_actor_insert
  before insert on public.automation_rules
  for each row execute function private.stamp_actor('created_by', 'updated_by');

drop trigger if exists automation_rules_stamp_actor_update on public.automation_rules;
create trigger automation_rules_stamp_actor_update
  before update on public.automation_rules
  for each row execute function private.stamp_actor('updated_by');

drop trigger if exists device_command_log_stamp_actor on public.device_command_log;
create trigger device_command_log_stamp_actor
  before insert on public.device_command_log
  for each row execute function private.stamp_actor('requested_by');

create or replace function private.audit_command_requested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.touch_audit(
    new.household_id, 'command.requested', 'device_command', new.id::text,
    pg_catalog.jsonb_build_object(
      'command_id', new.id, 'kind', new.kind, 'origin', new.origin, 'provider_mode', new.provider_mode
    )
  );
  return null;
end
$$;

revoke all on function private.audit_command_requested() from public, anon, authenticated;

drop trigger if exists device_command_log_audit on public.device_command_log;
create trigger device_command_log_audit
  after insert on public.device_command_log
  for each row execute function private.audit_command_requested();

-- ---------------------------------------------------------------------------------------------------------------
-- Append-only tables: TRUNCATE is rejected too, and the server role loses UPDATE, DELETE and TRUNCATE on them.
-- (Foreign-key cascades run as the table owner and are unaffected; see private.reject_modification.)
-- ---------------------------------------------------------------------------------------------------------------
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.reject_truncate();

drop trigger if exists device_command_events_no_truncate on public.device_command_events;
create trigger device_command_events_no_truncate
  before truncate on public.device_command_events
  for each statement execute function private.reject_truncate();

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    revoke update, delete, truncate on public.audit_log from service_role;
    revoke update, delete, truncate on public.device_command_events from service_role;
  end if;
end
$$;


-- ==========================================
-- Migration: 20261023130200_identity_and_membership_functions.sql
-- ==========================================

-- TASK-04 migration 3/4: auth trigger, invitation lifecycle, membership management, automation controls and the
-- one-time admin bootstrap. Safe to re-run (idempotent).
--
-- Rules for every function in this file:
--   * SECURITY DEFINER with SET search_path = '' and schema-qualified references;
--   * EXECUTE revoked from PUBLIC and anon and granted explicitly (authenticated for the public.* RPCs,
--     service_role for the bootstrap);
--   * authorisation is checked inside the function from the JWT (auth.uid()), never from a parameter;
--   * a caller who is not allowed gets SQLSTATE 42501 with the message 'not_authorised'; business-rule
--     failures use SQLSTATE P0001 with a short fixed message.
--
-- Rollback notes (development only):
--   drop trigger if exists on_auth_user_created on auth.users;
--   drop function if exists private.handle_new_user(), private.bootstrap_first_admin(text, text, text),
--     public.create_invitation(uuid, text, public.role_enum, interval), public.accept_invitation(text),
--     public.revoke_invitation(uuid), public.change_member_role(uuid, uuid, public.role_enum),
--     public.remove_member(uuid, uuid), public.leave_household(uuid), public.set_automation_paused(uuid, boolean),
--     public.set_rule_mode(uuid, text);

set search_path = public, extensions;

-- ---------------------------------------------------------------------------------------------------------------
-- New users: profile only. Never a household and never a role (docs/SECURITY_MODEL.md invariant 1).
-- This function must never raise, or sign-up would fail.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Users that existed before this migration get a profile too.
insert into public.user_profiles (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------------------------------------------
-- Invitations. The token is 256 random bits, returned once to the ADMIN who creates it, stored only as SHA-256.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.create_invitation(
  p_household_id uuid,
  p_email text default null,
  p_role public.role_enum default 'READ_ONLY',
  -- 168 hours, not '7 days': an interval of days follows the session time zone across a DST change,
  -- so the lifetime would be 167 or 169 hours. Hours are exact.
  p_expires_in interval default interval '168 hours'
)
returns table (invitation_id uuid, invitation_token text, invitation_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, ''))), '');
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if v_uid is null or not private.has_role_at_least(p_household_id, 'ADMIN') then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_role is null then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$') then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;
  if p_expires_in is null or p_expires_in < interval '1 minute' or p_expires_in > interval '30 days' then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;

  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := pg_catalog.now() + p_expires_in;

  insert into public.household_invitations (household_id, email, role, token_hash, expires_at, created_by)
  values (
    p_household_id, v_email, p_role,
    pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8')),
    v_expires, v_uid
  )
  returning id into v_id;

  perform private.touch_audit(
    p_household_id, 'invitation.created', 'invitation', v_id::text,
    pg_catalog.jsonb_build_object(
      'invitation_id', v_id, 'role', p_role, 'email_bound', v_email is not null, 'expires_at', v_expires
    )
  );

  return query select v_id, v_token, v_expires;
end
$$;

revoke all on function public.create_invitation(uuid, text, public.role_enum, interval) from public, anon;
grant execute on function public.create_invitation(uuid, text, public.role_enum, interval) to authenticated;

-- Acceptance: signed-in user, valid single-use unexpired token. When the invitation names an email, the user's
-- CONFIRMED email must match. A role above READ_ONLY is honoured only while the inviter is still an ADMIN of that
-- household. Every failure of the token itself returns the same error so the token cannot be probed.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv public.household_invitations%rowtype;
  v_user_email text;
  v_user_confirmed timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_invitation' using errcode = 'P0001';
  end if;

  select * into v_inv
  from public.household_invitations i
  where i.token_hash = pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'))
  for update;

  if not found
     or v_inv.accepted_at is not null
     or v_inv.revoked_at is not null
     or v_inv.expires_at <= pg_catalog.now() then
    raise exception 'invalid_invitation' using errcode = 'P0001';
  end if;

  if v_inv.email is not null then
    select u.email, u.email_confirmed_at into v_user_email, v_user_confirmed
    from auth.users u where u.id = v_uid;
    if v_user_confirmed is null
       or v_user_email is null
       or pg_catalog.lower(v_user_email) <> pg_catalog.lower(v_inv.email::text) then
      raise exception 'invalid_invitation' using errcode = 'P0001';
    end if;
  end if;

  if v_inv.role <> 'READ_ONLY' and not exists (
    select 1 from public.household_members m
    where m.household_id = v_inv.household_id
      and m.user_id = v_inv.created_by
      and m.role = 'ADMIN'
  ) then
    raise exception 'invalid_invitation' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.household_members m
    where m.household_id = v_inv.household_id and m.user_id = v_uid
  ) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  insert into public.household_members (household_id, user_id, role, created_by)
  values (v_inv.household_id, v_uid, v_inv.role, v_inv.created_by);

  update public.household_invitations
  set accepted_at = pg_catalog.now(), accepted_by = v_uid
  where id = v_inv.id;

  perform private.touch_audit(
    v_inv.household_id, 'invitation.accepted', 'invitation', v_inv.id::text,
    pg_catalog.jsonb_build_object('invitation_id', v_inv.id, 'role', v_inv.role)
  );

  return v_inv.household_id;
end
$$;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_household uuid;
begin
  select i.household_id into v_household
  from public.household_invitations i where i.id = p_invitation_id;
  -- Same error for "does not exist" and "not yours": existence is not revealed.
  if v_uid is null or v_household is null or not private.has_role_at_least(v_household, 'ADMIN') then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  update public.household_invitations
  set revoked_at = pg_catalog.now()
  where id = p_invitation_id and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'invalid_invitation' using errcode = 'P0001';
  end if;

  perform private.touch_audit(
    v_household, 'invitation.revoked', 'invitation', p_invitation_id::text,
    pg_catalog.jsonb_build_object('invitation_id', p_invitation_id)
  );
end
$$;

revoke all on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Membership management. Audit rows are written by the household_members triggers, so these functions and any
-- other writer produce the same trail.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.change_member_role(
  p_household_id uuid,
  p_user_id uuid,
  p_role public.role_enum
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.has_role_at_least(p_household_id, 'ADMIN') then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_user_id is null or p_role is null then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;
  if p_user_id = v_uid then
    raise exception 'self_change_not_allowed' using errcode = 'P0001';
  end if;

  update public.household_members
  set role = p_role
  where household_id = p_household_id and user_id = p_user_id;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
end
$$;

revoke all on function public.change_member_role(uuid, uuid, public.role_enum) from public, anon;
grant execute on function public.change_member_role(uuid, uuid, public.role_enum) to authenticated;

create or replace function public.remove_member(p_household_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.has_role_at_least(p_household_id, 'ADMIN') then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;
  if p_user_id = v_uid then
    raise exception 'self_change_not_allowed' using errcode = 'P0001';
  end if;

  delete from public.household_members
  where household_id = p_household_id and user_id = p_user_id;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
end
$$;

revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- "Leave household" is the one allowed removal of oneself; the last-admin guard still applies.
create or replace function public.leave_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  delete from public.household_members
  where household_id = p_household_id and user_id = v_uid;
  if not found then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
end
$$;

revoke all on function public.leave_household(uuid) from public, anon;
grant execute on function public.leave_household(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Automation controls. Pause: READ_WRITE or ADMIN. Resume: ADMIN only (docs/SECURITY_MODEL.md invariant 6).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.set_automation_paused(p_household_id uuid, p_paused boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_changed boolean;
begin
  if p_paused is null then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;
  if v_uid is null
     or not private.has_role_at_least(p_household_id, case when p_paused then 'READ_WRITE' else 'ADMIN' end::public.role_enum) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  update public.household_settings s
  set automation_paused = p_paused,
      paused_by = case when p_paused then v_uid else null end,
      paused_at = case when p_paused then pg_catalog.now() else null end
  where s.household_id = p_household_id and s.automation_paused is distinct from p_paused;
  v_changed := found;

  if v_changed then
    perform private.touch_audit(
      p_household_id,
      case when p_paused then 'automation.paused' else 'automation.resumed' end,
      'household_settings', p_household_id::text, '{}'::jsonb
    );
  elsif not exists (select 1 from public.household_settings s where s.household_id = p_household_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end
$$;

revoke all on function public.set_automation_paused(uuid, boolean) from public, anon;
grant execute on function public.set_automation_paused(uuid, boolean) to authenticated;

-- Rule mode. DISABLED or DRY_RUN: READ_WRITE or ADMIN. ACTIVE: ADMIN only. The mode column is not writable
-- directly by authenticated, so this is the only path. Unknown and foreign rules give the same error.
create or replace function public.set_rule_mode(p_rule_id uuid, p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_rule public.automation_rules%rowtype;
begin
  if p_mode is null or p_mode not in ('DISABLED', 'DRY_RUN', 'ACTIVE') then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;

  select * into v_rule from public.automation_rules r where r.id = p_rule_id for update;
  if v_uid is null
     or not found
     or not private.has_role_at_least(v_rule.household_id, case when p_mode = 'ACTIVE' then 'ADMIN' else 'READ_WRITE' end::public.role_enum) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  -- Demoting an ACTIVE rule is always allowed to READ_WRITE (safety direction); only ADMIN can move into ACTIVE.
  if v_rule.mode = p_mode then
    return;
  end if;

  update public.automation_rules
  set mode = p_mode, version = version + 1
  where id = p_rule_id;

  perform private.touch_audit(
    v_rule.household_id, 'rule.mode_changed', 'automation_rule', p_rule_id::text,
    pg_catalog.jsonb_build_object('rule_id', p_rule_id, 'old_mode', v_rule.mode, 'new_mode', p_mode)
  );
end
$$;

revoke all on function public.set_rule_mode(uuid, text) from public, anon;
grant execute on function public.set_rule_mode(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- One-time admin bootstrap (D-005). Server-only: executable by the owner role and service_role; not exposed through
-- the API because schema private is not exposed. Runs once: the system_bootstrap row is permanent, so it can
-- never run again even if the household is later deleted. See docs/ADMIN_BOOTSTRAP.md.
-- The user must already have signed up and confirmed their email; no password or token passes through here.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.bootstrap_first_admin(
  p_email text,
  p_household_name text,
  p_timezone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_name text := pg_catalog.btrim(coalesce(p_household_name, ''));
  v_user uuid;
  v_household uuid;
begin
  -- Serialise concurrent callers; the checks below then see each other's committed work.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('autopw3:bootstrap', 0));

  if exists (select 1 from public.system_bootstrap) then
    raise exception 'bootstrap_already_completed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.household_members m where m.role = 'ADMIN') then
    raise exception 'bootstrap_not_allowed' using errcode = 'P0001';
  end if;
  if v_email = '' or char_length(v_name) not between 1 and 100 then
    raise exception 'invalid_argument' using errcode = 'P0001';
  end if;

  select u.id into v_user
  from auth.users u
  where pg_catalog.lower(u.email) = v_email and u.email_confirmed_at is not null;
  if v_user is null then
    raise exception 'bootstrap_user_not_found' using errcode = 'P0002';
  end if;

  -- The timezone is validated by the households trigger (invalid names raise 22023).
  insert into public.households (name, timezone, created_by)
  values (v_name, p_timezone, v_user)
  returning id into v_household;

  insert into public.household_settings (household_id) values (v_household);

  insert into public.household_members (household_id, user_id, role, created_by)
  values (v_household, v_user, 'ADMIN', v_user);

  insert into public.system_bootstrap (id, household_id, bootstrap_by_email_hash)
  values (true, v_household, pg_catalog.sha256(pg_catalog.convert_to(v_email, 'UTF8')));

  perform private.touch_audit(
    v_household, 'bootstrap.completed', 'household', v_household::text,
    pg_catalog.jsonb_build_object('household_id', v_household)
  );

  return v_household;
end
$$;

revoke all on function private.bootstrap_first_admin(text, text, text) from public, anon, authenticated;
grant execute on function private.bootstrap_first_admin(text, text, text) to service_role;


-- ==========================================
-- Migration: 20261023130300_rls_policies_and_grants.sql
-- ==========================================

-- TASK-04 migration 4/4: row level security policies and explicit grants.
-- This file implements docs/RLS_POLICY_MATRIX.md exactly; the manifest at the end of that document is compared with
-- pg_policies by `npm run db:test`. Safe to re-run (idempotent: policies are dropped and recreated, grants repeat).
--
-- Model:
--   * anon: nothing on any table (anon has no policy and no grant anywhere).
--   * authenticated: SELECT where the user is a member (RLS filters rows); writes only where the role allows and
--     only on the columns granted here. Everything privileged (role changes, invitations, rule activation, pause,
--     bootstrap) goes through the SECURITY DEFINER functions from migration 3/4, never through table writes.
--   * service_role (Worker secret key): bypasses RLS and keeps its default table privileges, except UPDATE, DELETE and
--     TRUNCATE on the append-only tables (migration 2/4). Used only for the cases S1-S9 in docs/SECURITY_MODEL.md.
--   * Server-only tables have RLS on, NO policy and NO grant for authenticated or anon:
--     tesla_credentials, oauth_states, system_bootstrap, job_locks, scheduled_jobs.
--
-- Rollback notes (development only): drop every policy named in docs/RLS_POLICY_MATRIX.md and
--   `revoke all on <table> from authenticated`; migration 1/7 .. 7/7 plus private.lock_down_public_tables()
--   return the schema to deny-all.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------------------------------------------
-- Identity and tenancy
-- ---------------------------------------------------------------------------------------------------------------
-- user_profiles: own row; an ADMIN also sees profiles of the people in their household (visible through the
-- household_members policy below). No insert or delete: the auth trigger creates the row, cascade deletes it.
grant select on public.user_profiles to authenticated;
grant update (display_name, locale) on public.user_profiles to authenticated;

drop policy if exists user_profiles_select_self_or_household_admin on public.user_profiles;
create policy user_profiles_select_self_or_household_admin on public.user_profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.household_members m where m.user_id = user_profiles.user_id)
  );

drop policy if exists user_profiles_update_self on public.user_profiles;
create policy user_profiles_update_self on public.user_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- households: members read; ADMIN edits name and timezone. Households are created only by the bootstrap
-- function in v1, and deleted only by a future audited function (L-032).
grant select on public.households to authenticated;
grant update (name, timezone) on public.households to authenticated;

drop policy if exists households_select_member on public.households;
create policy households_select_member on public.households
  for select to authenticated
  using (private.is_member(id));

drop policy if exists households_update_admin on public.households;
create policy households_update_admin on public.households
  for update to authenticated
  using (private.has_role_at_least(id, 'ADMIN'))
  with check (private.has_role_at_least(id, 'ADMIN'));

-- household_members: read-only for the API. A member sees their own row (their role); an ADMIN sees the household.
-- There is no write grant: changes go through change_member_role, remove_member, leave_household,
-- accept_invitation and the bootstrap, all of which pass the guard trigger.
grant select on public.household_members to authenticated;

drop policy if exists household_members_select_self_or_admin on public.household_members;
create policy household_members_select_self_or_admin on public.household_members
  for select to authenticated
  using (user_id = (select auth.uid()) or private.has_role_at_least(household_id, 'ADMIN'));

-- household_invitations: ADMIN reads the list, never the token hash (column grant). Writes only via functions.
grant select (id, household_id, email, role, expires_at, accepted_at, accepted_by, revoked_at, created_by, created_at)
  on public.household_invitations to authenticated;

drop policy if exists household_invitations_select_admin on public.household_invitations;
create policy household_invitations_select_admin on public.household_invitations
  for select to authenticated
  using (private.has_role_at_least(household_id, 'ADMIN'));

-- household_settings: members read; ADMIN edits budget, retention, polling and the controls switch.
-- automation_paused, paused_by and paused_at change only through set_automation_paused.
grant select on public.household_settings to authenticated;
grant update (
  monthly_spend_cap_usd, live_background_interval_minutes, live_on_demand_min_interval_seconds,
  on_demand_monthly_allowance, raw_retention_days, stale_after_seconds, controls_enabled
) on public.household_settings to authenticated;

drop policy if exists household_settings_select_member on public.household_settings;
create policy household_settings_select_member on public.household_settings
  for select to authenticated
  using (private.is_member(household_id));

drop policy if exists household_settings_update_admin on public.household_settings;
create policy household_settings_update_admin on public.household_settings
  for update to authenticated
  using (private.has_role_at_least(household_id, 'ADMIN'))
  with check (private.has_role_at_least(household_id, 'ADMIN'));

-- ---------------------------------------------------------------------------------------------------------------
-- Sites and usage
-- ---------------------------------------------------------------------------------------------------------------
-- energy_sites: members read; ADMIN connects, renames and disconnects. connection_state and capabilities_snapshot
-- are written by the Worker only (not in the column grants).
grant select on public.energy_sites to authenticated;
grant insert (household_id, provider, provider_site_id, name, timezone) on public.energy_sites to authenticated;
grant update (name, timezone) on public.energy_sites to authenticated;
grant delete on public.energy_sites to authenticated;

drop policy if exists energy_sites_select_member on public.energy_sites;
create policy energy_sites_select_member on public.energy_sites
  for select to authenticated
  using (private.is_member(household_id));

drop policy if exists energy_sites_insert_admin on public.energy_sites;
create policy energy_sites_insert_admin on public.energy_sites
  for insert to authenticated
  with check (private.has_role_at_least(household_id, 'ADMIN'));

drop policy if exists energy_sites_update_admin on public.energy_sites;
create policy energy_sites_update_admin on public.energy_sites
  for update to authenticated
  using (private.has_role_at_least(household_id, 'ADMIN'))
  with check (private.has_role_at_least(household_id, 'ADMIN'));

drop policy if exists energy_sites_delete_admin on public.energy_sites;
create policy energy_sites_delete_admin on public.energy_sites
  for delete to authenticated
  using (private.has_role_at_least(household_id, 'ADMIN'));

-- provider_usage_daily: members read (the stale/budget banner needs it); only the Worker writes.
grant select on public.provider_usage_daily to authenticated;

drop policy if exists provider_usage_daily_select_member on public.provider_usage_daily;
create policy provider_usage_daily_select_member on public.provider_usage_daily
  for select to authenticated
  using (private.is_member(household_id));

-- ---------------------------------------------------------------------------------------------------------------
-- Telemetry and cost cache: members read through the site's household; ingestion is service-role only.
-- No INSERT, UPDATE or DELETE grant exists for authenticated, so demo or user-written telemetry cannot enter.
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'powerwall_metrics_log', 'energy_intervals', 'telemetry_rollups_hourly', 'telemetry_rollups_daily',
    'telemetry_sync_state', 'cost_rollups_daily', 'automation_executions'
  ] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         exists (select 1 from public.energy_sites s where s.id = %I.site_id and private.is_member(s.household_id)))',
      t || '_select_member', t, t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Tariffs: members read; READ_WRITE and ADMIN create, edit and delete. A tariff version is immutable except
-- name and effective_to (trigger in migration 2/4).
-- ---------------------------------------------------------------------------------------------------------------
grant select, insert, update, delete on public.utility_tariffs to authenticated;

drop policy if exists utility_tariffs_select_member on public.utility_tariffs;
create policy utility_tariffs_select_member on public.utility_tariffs
  for select to authenticated
  using (private.is_member(household_id));

drop policy if exists utility_tariffs_insert_writer on public.utility_tariffs;
create policy utility_tariffs_insert_writer on public.utility_tariffs
  for insert to authenticated
  with check (private.has_role_at_least(household_id, 'READ_WRITE'));

drop policy if exists utility_tariffs_update_writer on public.utility_tariffs;
create policy utility_tariffs_update_writer on public.utility_tariffs
  for update to authenticated
  using (private.has_role_at_least(household_id, 'READ_WRITE'))
  with check (private.has_role_at_least(household_id, 'READ_WRITE'));

drop policy if exists utility_tariffs_delete_writer on public.utility_tariffs;
create policy utility_tariffs_delete_writer on public.utility_tariffs
  for delete to authenticated
  using (private.has_role_at_least(household_id, 'READ_WRITE'));

do $$
declare
  t text;
begin
  foreach t in array array[
    'tariff_seasons', 'tariff_overrides', 'tariff_slots', 'tariff_levies', 'tariff_price_points'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         exists (select 1 from public.utility_tariffs u where u.id = %I.tariff_id and private.is_member(u.household_id)))',
      t || '_select_member', t, t
    );

    execute format('drop policy if exists %I on public.%I', t || '_insert_writer', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (
         exists (select 1 from public.utility_tariffs u where u.id = %I.tariff_id and private.has_role_at_least(u.household_id, ''READ_WRITE'')))',
      t || '_insert_writer', t, t
    );

    execute format('drop policy if exists %I on public.%I', t || '_update_writer', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (
         exists (select 1 from public.utility_tariffs u where u.id = %I.tariff_id and private.has_role_at_least(u.household_id, ''READ_WRITE'')))
       with check (
         exists (select 1 from public.utility_tariffs u where u.id = %I.tariff_id and private.has_role_at_least(u.household_id, ''READ_WRITE'')))',
      t || '_update_writer', t, t, t
    );

    execute format('drop policy if exists %I on public.%I', t || '_delete_writer', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (
         exists (select 1 from public.utility_tariffs u where u.id = %I.tariff_id and private.has_role_at_least(u.household_id, ''READ_WRITE'')))',
      t || '_delete_writer', t, t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Automation rules: members read; READ_WRITE and ADMIN create and edit rules that are DISABLED or DRY_RUN.
-- The mode column is not writable directly: set_rule_mode is the only path, and only an ADMIN can reach ACTIVE.
-- An ACTIVE rule cannot be edited or deleted directly; move it out of ACTIVE first (audited).
-- ---------------------------------------------------------------------------------------------------------------
grant select on public.automation_rules to authenticated;
grant insert (household_id, site_id, name, mode, priority, definition, definition_version)
  on public.automation_rules to authenticated;
grant update (name, priority, definition, definition_version, version) on public.automation_rules to authenticated;
grant delete on public.automation_rules to authenticated;

drop policy if exists automation_rules_select_member on public.automation_rules;
create policy automation_rules_select_member on public.automation_rules
  for select to authenticated
  using (private.is_member(household_id));

drop policy if exists automation_rules_insert_writer on public.automation_rules;
create policy automation_rules_insert_writer on public.automation_rules
  for insert to authenticated
  with check (private.has_role_at_least(household_id, 'READ_WRITE') and mode in ('DISABLED', 'DRY_RUN'));

drop policy if exists automation_rules_update_writer on public.automation_rules;
create policy automation_rules_update_writer on public.automation_rules
  for update to authenticated
  using (private.has_role_at_least(household_id, 'READ_WRITE') and mode <> 'ACTIVE')
  with check (private.has_role_at_least(household_id, 'READ_WRITE') and mode <> 'ACTIVE');

drop policy if exists automation_rules_delete_writer on public.automation_rules;
create policy automation_rules_delete_writer on public.automation_rules
  for delete to authenticated
  using (private.has_role_at_least(household_id, 'READ_WRITE') and mode <> 'ACTIVE');

-- ---------------------------------------------------------------------------------------------------------------
-- Device commands: READ_WRITE and ADMIN insert the intent row (user-scoped, D-015) in its initial state only.
-- The lifecycle (state, phase, result) is written by the Worker with the secret key (S5). A command in TESLA mode
-- needs controls_enabled; MOCK mode does not.
-- ---------------------------------------------------------------------------------------------------------------
grant select on public.device_command_log to authenticated;
grant insert (household_id, site_id, origin, kind, params, params_hash, idempotency_key, provider_mode)
  on public.device_command_log to authenticated;

drop policy if exists device_command_log_select_member on public.device_command_log;
create policy device_command_log_select_member on public.device_command_log
  for select to authenticated
  using (private.is_member(household_id));

drop policy if exists device_command_log_insert_writer on public.device_command_log;
create policy device_command_log_insert_writer on public.device_command_log
  for insert to authenticated
  with check (
    private.has_role_at_least(household_id, 'READ_WRITE')
    and origin = 'USER'
    and state = 'PENDING'
    and phase = 'RECORDED'
    and automation_execution_id is null
    and dispatched_at is null
    and finished_at is null
    and error_code is null
    and provider_http_status is null
    and result is null
    and (
      provider_mode = 'MOCK'
      or exists (
        select 1 from public.household_settings s
        where s.household_id = device_command_log.household_id and s.controls_enabled
      )
    )
  );

grant select on public.device_command_events to authenticated;

drop policy if exists device_command_events_select_member on public.device_command_events;
create policy device_command_events_select_member on public.device_command_events
  for select to authenticated
  using (
    exists (
      select 1 from public.device_command_log c
      where c.id = device_command_events.command_id and private.is_member(c.household_id)
    )
  );

-- ---------------------------------------------------------------------------------------------------------------
-- Audit log: ADMIN reads their household's trail. Nobody writes through the API.
-- ---------------------------------------------------------------------------------------------------------------
grant select on public.audit_log to authenticated;

drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using (household_id is not null and private.has_role_at_least(household_id, 'ADMIN'));

-- ---------------------------------------------------------------------------------------------------------------
-- Server-only tables: nothing for authenticated or anon, and no policy. Stated explicitly so a later change that
-- adds a grant or policy here is a visible diff (and fails the tests).
-- ---------------------------------------------------------------------------------------------------------------
revoke all on public.tesla_credentials, public.oauth_states, public.system_bootstrap,
  public.job_locks, public.scheduled_jobs from public, anon, authenticated;


-- ==========================================
-- Migration: 20261026120000_create_job_and_usage_functions.sql
-- ==========================================

-- TASK-16 migration: job claiming, lease lock management, and provider usage tracking functions.
-- Design: docs/DATABASE_DESIGN.md section 3 & 4.
-- Server-only functions: callable by service_role, revoked from public, anon, and authenticated.
-- Safe to re-run (idempotent).

set search_path = public, extensions;

-- 1. claim_jobs: atomic job claiming with FOR UPDATE SKIP LOCKED
create or replace function private.claim_jobs(
  p_worker_id text,
  p_max integer,
  p_lease_seconds integer default 60
)
returns setof public.scheduled_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with to_claim as (
    select id
    from public.scheduled_jobs
    where (state = 'QUEUED' and run_at <= now())
       or (state = 'RUNNING' and lease_expires_at < now())
    order by run_at asc
    limit p_max
    for update skip locked
  )
  update public.scheduled_jobs j
  set state = 'RUNNING',
      attempts = j.attempts + 1,
      locked_by = p_worker_id,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval
  from to_claim c
  where j.id = c.id
  returning j.*;
end;
$$;

-- 2. acquire_lock: atomic short lease lock
create or replace function private.acquire_lock(
  p_key text,
  p_owner text,
  p_lease_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz := now() + (p_lease_seconds || ' seconds')::interval;
begin
  insert into public.job_locks (key, owner, lease_expires_at)
  values (p_key, p_owner, v_expires)
  on conflict (key) do update
    set owner = p_owner,
        lease_expires_at = v_expires
    where public.job_locks.lease_expires_at < now();

  return found;
end;
$$;

-- 3. release_lock: release named lock if owned
create or replace function private.release_lock(
  p_key text,
  p_owner text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.job_locks
  where key = p_key and owner = p_owner;

  return found;
end;
$$;

-- 4. record_provider_call: atomic counter for provider usage
create or replace function private.record_provider_call(
  p_household_id uuid,
  p_category text,
  p_ok boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.provider_usage_daily (household_id, usage_day, category, request_count, error_count)
  values (p_household_id, (now() at time zone 'UTC')::date, p_category, 1, case when p_ok then 0 else 1 end)
  on conflict (household_id, usage_day, category) do update
    set request_count = public.provider_usage_daily.request_count + 1,
        error_count = public.provider_usage_daily.error_count + case when p_ok then 0 else 1 end;

  return true;
end;
$$;

-- Revoke execute from public/anon/authenticated and grant to service_role
revoke all on function private.claim_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function private.acquire_lock(text, text, integer) from public, anon, authenticated;
revoke all on function private.release_lock(text, text) from public, anon, authenticated;
revoke all on function private.record_provider_call(uuid, text, boolean) from public, anon, authenticated;

grant execute on function private.claim_jobs(text, integer, integer) to service_role;
grant execute on function private.acquire_lock(text, text, integer) to service_role;
grant execute on function private.release_lock(text, text) to service_role;
grant execute on function private.record_provider_call(uuid, text, boolean) to service_role;


