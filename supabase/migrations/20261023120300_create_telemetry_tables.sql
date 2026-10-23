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
