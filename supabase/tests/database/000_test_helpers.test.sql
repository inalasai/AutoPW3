-- Test helpers for the TASK-04 security tests. Installs schema `tests` and COMMITS it (every other test file runs
-- in a transaction that is rolled back). Runs under pgTAP (`supabase test db`) or scripts/db-test.mjs.
--
-- All helpers reset the role first, so they can be called whether the test is currently the owner, anon,
-- authenticated or service_role. Fixture rows are named; tests refer to them with tests.id('alice').
-- No real credentials: users are example.invalid addresses created directly in auth.users.

begin;

select plan(2);

create schema if not exists tests;
grant usage on schema tests to public;

create table if not exists tests.fx (
  name text primary key,
  id uuid not null
);
grant all on tests.fx to public;

create or replace function tests.id(p_name text)
returns uuid
language sql
stable
as $$
  select f.id from tests.fx f where f.name = p_name
$$;

create or replace function tests.clear()
returns void
language plpgsql
as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

-- Sign in as a fixture user: authenticated role plus a JWT whose subject is the user.
create or replace function tests.as_user(p_name text)
returns void
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform tests.clear();
  select f.id into v_id from tests.fx f where f.name = p_name;
  if v_id is null then
    raise exception 'unknown fixture user %', p_name;
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_id::text, true);
  set local role authenticated;
end
$$;

create or replace function tests.as_anon()
returns void
language plpgsql
as $$
begin
  perform tests.clear();
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end
$$;

-- The Worker's secret key: service_role, no user subject.
create or replace function tests.as_service()
returns void
language plpgsql
as $$
begin
  perform tests.clear();
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
end
$$;

create or replace function tests.new_user(p_name text, p_confirmed boolean default true)
returns void
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform tests.clear();
  insert into auth.users (id, email, email_confirmed_at)
  values (v_id, p_name || '@example.invalid', case when p_confirmed then now() end);
  insert into tests.fx (name, id) values (p_name, v_id);
end
$$;

create or replace function tests.new_household(p_name text)
returns void
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform tests.clear();
  insert into public.households (name, timezone) values (upper(p_name), 'Europe/Dublin') returning id into v_id;
  insert into public.household_settings (household_id) values (v_id);
  insert into tests.fx (name, id) values (p_name, v_id);
end
$$;

create or replace function tests.new_member(p_household text, p_user text, p_role public.role_enum)
returns void
language plpgsql
as $$
begin
  perform tests.clear();
  insert into public.household_members (household_id, user_id, role)
  values (tests.id(p_household), tests.id(p_user), p_role);
end
$$;

create or replace function tests.new_site(p_name text, p_household text)
returns void
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform tests.clear();
  insert into public.energy_sites (household_id, provider, provider_site_id, timezone)
  values (tests.id(p_household), 'TESLA', 'site-' || p_name, 'Europe/Dublin') returning id into v_id;
  insert into tests.fx (name, id) values (p_name, v_id);
end
$$;

-- The standard world used by most tests:
--   households h1, h2; sites s1 (h1), s2 (h2)
--   alice ADMIN of h1, rw1 READ_WRITE of h1, ro1 READ_ONLY of h1, bob ADMIN of h2, carol has no membership
--   one tariff, one DRY_RUN rule, one telemetry row per household, settings rows.
create or replace function tests.world()
returns void
language plpgsql
as $$
declare
  v_t1 uuid;
  v_t2 uuid;
  v_r1 uuid;
  v_r2 uuid;
begin
  perform tests.clear();
  delete from tests.fx;
  perform tests.new_user('alice');
  perform tests.new_user('rw1');
  perform tests.new_user('ro1');
  perform tests.new_user('bob');
  perform tests.new_user('carol');
  perform tests.new_household('h1');
  perform tests.new_household('h2');
  perform tests.new_member('h1', 'alice', 'ADMIN');
  perform tests.new_member('h1', 'rw1', 'READ_WRITE');
  perform tests.new_member('h1', 'ro1', 'READ_ONLY');
  perform tests.new_member('h2', 'bob', 'ADMIN');
  perform tests.new_site('s1', 'h1');
  perform tests.new_site('s2', 'h2');

  insert into public.utility_tariffs (household_id, name, direction, price_mode, currency, timezone, effective_from, flat_rate_per_kwh)
  values (tests.id('h1'), 'tariff h1', 'IMPORT', 'FLAT', 'EUR', 'Europe/Dublin', date '2026-01-01', 0.100000)
  returning id into v_t1;
  insert into public.utility_tariffs (household_id, name, direction, price_mode, currency, timezone, effective_from, flat_rate_per_kwh)
  values (tests.id('h2'), 'tariff h2', 'IMPORT', 'FLAT', 'EUR', 'Europe/Dublin', date '2026-01-01', 0.200000)
  returning id into v_t2;
  insert into tests.fx (name, id) values ('t1', v_t1), ('t2', v_t2);

  insert into public.automation_rules (household_id, site_id, name, mode, definition)
  values (tests.id('h1'), tests.id('s1'), 'rule h1', 'DRY_RUN', '{}'::jsonb) returning id into v_r1;
  insert into public.automation_rules (household_id, site_id, name, mode, definition)
  values (tests.id('h2'), tests.id('s2'), 'rule h2', 'DRY_RUN', '{}'::jsonb) returning id into v_r2;
  insert into tests.fx (name, id) values ('r1', v_r1), ('r2', v_r2);

  insert into public.powerwall_metrics_log (site_id, sampled_at, timestamp_origin, solar_power_w, source)
  values (tests.id('s1'), now(), 'PROVIDER', 100, 'TESLA'), (tests.id('s2'), now(), 'PROVIDER', 200, 'TESLA');
end
$$;

grant execute on all functions in schema tests to public;

select ok(true, 'schema tests is installed');
select ok(tests.id('nobody') is null, 'tests.id returns null for an unknown name');

select * from finish();

commit;
