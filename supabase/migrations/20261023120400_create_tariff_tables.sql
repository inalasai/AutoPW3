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
