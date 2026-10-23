-- Cross-household read and write denial, and the anonymous role. Standard world: see 000_test_helpers.test.sql.

begin;

select plan(29);

select tests.world();

-- ---- reads: a member sees their own household and nothing else -------------------------------------------------
select tests.as_user('alice');
select is((select count(*)::int from public.households), 1, 'alice (ADMIN h1) sees one household');
select is((select id from public.households), tests.id('h1'), 'alice sees h1');
select is((select count(*)::int from public.energy_sites where id = tests.id('s2')), 0, 'alice cannot see site s2 of h2');
select is((select count(*)::int from public.utility_tariffs where id = tests.id('t2')), 0, 'alice cannot see the h2 tariff');
select is((select count(*)::int from public.automation_rules where id = tests.id('r2')), 0, 'alice cannot see the h2 rule');
select is(
  (select count(*)::int from public.powerwall_metrics_log where site_id = tests.id('s2')), 0,
  'alice cannot see h2 telemetry'
);
select is(
  (select count(*)::int from public.household_settings where household_id = tests.id('h2')), 0,
  'alice cannot see h2 settings'
);
select is(
  (select count(*)::int from public.household_members where household_id = tests.id('h2')), 0,
  'alice cannot list h2 members'
);
select is(
  (select count(*)::int from public.audit_log where household_id = tests.id('h2')), 0,
  'alice cannot read the h2 audit log'
);

select tests.as_user('bob');
select is((select count(*)::int from public.energy_sites where id = tests.id('s1')), 0, 'bob (ADMIN h2) cannot see site s1');
select is((select count(*)::int from public.powerwall_metrics_log where site_id = tests.id('s1')), 0, 'bob cannot see h1 telemetry');
select is((select count(*)::int from public.household_members where household_id = tests.id('h1')), 0, 'bob cannot list h1 members');

select tests.as_user('carol');
select is(
  (select count(*)::int from public.households)
    + (select count(*)::int from public.household_members)
    + (select count(*)::int from public.energy_sites)
    + (select count(*)::int from public.utility_tariffs)
    + (select count(*)::int from public.powerwall_metrics_log)
    + (select count(*)::int from public.automation_rules),
  0,
  'a signed-in user with no membership sees nothing'
);

select tests.as_user('ro1');
select is(
  (select count(*)::int from public.household_members), 1,
  'a READ_ONLY member sees only their own membership row, not the member list'
);
select is((select role::text from public.household_members), 'READ_ONLY', 'a member can read their own role');

-- ---- writes across households ----------------------------------------------------------------------------------
select tests.as_user('alice');
select throws_ok(
  $q$insert into public.energy_sites (household_id, provider, provider_site_id, timezone)
     values (tests.id('h2'), 'TESLA', 'site-intruder', 'Europe/Dublin')$q$,
  '42501', null,
  'an ADMIN of h1 cannot create a site in h2'
);
select throws_ok(
  $q$insert into public.utility_tariffs (household_id, name, direction, price_mode, currency, timezone, effective_from, flat_rate_per_kwh)
     values (tests.id('h2'), 'intruder', 'EXPORT', 'FLAT', 'EUR', 'Europe/Dublin', date '2020-01-01', 0.01)$q$,
  '42501', null,
  'an ADMIN of h1 cannot create a tariff in h2'
);
select throws_ok(
  $q$insert into public.automation_rules (household_id, site_id, name, definition)
     values (tests.id('h2'), tests.id('s2'), 'intruder', '{}'::jsonb)$q$,
  '42501', null,
  'an ADMIN of h1 cannot create a rule in h2'
);
select throws_ok(
  $q$insert into public.device_command_log (household_id, site_id, origin, kind, params, params_hash, idempotency_key, provider_mode)
     values (tests.id('h2'), tests.id('s2'), 'USER', 'SET_BACKUP_RESERVE', '{}'::jsonb, decode(repeat('ab', 32), 'hex'), 'key-intruder-1', 'MOCK')$q$,
  '42501', null,
  'an ADMIN of h1 cannot record a command in h2'
);
select lives_ok(
  $q$update public.utility_tariffs set name = 'hijacked' where id = tests.id('t2')$q$,
  'updating another household''s tariff is silently a no-op (row not visible)'
);
select lives_ok(
  $q$update public.household_settings set monthly_spend_cap_usd = 99 where household_id = tests.id('h2')$q$,
  'updating another household''s settings is silently a no-op'
);
select lives_ok(
  $q$delete from public.energy_sites where id = tests.id('s2')$q$,
  'deleting another household''s site is silently a no-op'
);
select throws_ok(
  $q$insert into public.household_members (household_id, user_id, role) values (tests.id('h2'), tests.id('alice'), 'ADMIN')$q$,
  '42501', null,
  'nobody can add themselves to another household'
);

select tests.clear();
select is((select name from public.utility_tariffs where id = tests.id('t2')), 'tariff h2', 'the h2 tariff is unchanged');
select is(
  (select monthly_spend_cap_usd::text from public.household_settings where household_id = tests.id('h2')), '9.00',
  'the h2 settings are unchanged'
);
select is((select count(*)::int from public.energy_sites where id = tests.id('s2')), 1, 'the h2 site still exists');

-- ---- anon: nothing ---------------------------------------------------------------------------------------------
select tests.as_anon();
select throws_ok('select 1 from public.households', '42501', null, 'anon cannot read households');
select throws_ok('select 1 from public.powerwall_metrics_log', '42501', null, 'anon cannot read telemetry');
select throws_ok('select 1 from public.household_members', '42501', null, 'anon cannot read memberships');

select * from finish();

rollback;
