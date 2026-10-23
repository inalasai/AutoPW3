-- LOCAL DEVELOPMENT SEED. Never run against a real project. Safe to re-run.
--
-- Contains only clearly labelled, fictional example data:
--   * one household named "LOCAL SEED HOUSEHOLD (development only)"
--   * two tariffs whose names say ILLUSTRATIVE EXAMPLE; the numbers are made up and are not any supplier's rates
-- It contains no users, no credentials, no Tesla data and no telemetry. Demo telemetry is generated in memory
-- and is never stored (D-017). The bootstrap function (TASK-04) creates the real first household and admin, so
-- this seed refuses to run on a database that has already been bootstrapped.

do $$
begin
  if exists (select 1 from public.system_bootstrap) then
    raise exception 'seed.sql refused: this database has been bootstrapped. The seed is for local development only.';
  end if;
end
$$;

insert into public.households (id, name, timezone)
values ('00000000-0000-4000-8000-0000000000a1', 'LOCAL SEED HOUSEHOLD (development only)', 'Europe/Dublin')
on conflict (id) do nothing;

insert into public.household_settings (household_id)
values ('00000000-0000-4000-8000-0000000000a1')
on conflict (household_id) do nothing;

-- Import tariff: two time-of-use bands. ILLUSTRATIVE EXAMPLE values only.
insert into public.utility_tariffs
  (id, household_id, tariff_key, version, name, direction, price_mode, currency, timezone,
   effective_from, tax_mode, standing_charge_per_day)
values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-0000000000c1', 1,
   'ILLUSTRATIVE EXAMPLE import tariff (not a real tariff)', 'IMPORT', 'TIME_OF_USE', 'EUR', 'Europe/Dublin',
   date '2026-01-01', 'NONE', 0.500000)
on conflict (id) do nothing;

insert into public.tariff_slots (id, tariff_id, day_type, start_minute, end_minute, rate_per_kwh, label)
values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b1', 'ALL', 0, 480, 0.100000, 'ILLUSTRATIVE night'),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000b1', 'ALL', 480, 1440, 0.300000, 'ILLUSTRATIVE day')
on conflict (id) do nothing;

-- Export tariff: flat per-kWh payment. ILLUSTRATIVE EXAMPLE value only.
insert into public.utility_tariffs
  (id, household_id, tariff_key, version, name, direction, price_mode, currency, timezone,
   effective_from, tax_mode, flat_rate_per_kwh, export_payment_model)
values
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-0000000000c2', 1,
   'ILLUSTRATIVE EXAMPLE export tariff (not a real tariff)', 'EXPORT', 'FLAT', 'EUR', 'Europe/Dublin',
   date '2026-01-01', 'NONE', 0.050000, 'PER_KWH')
on conflict (id) do nothing;
