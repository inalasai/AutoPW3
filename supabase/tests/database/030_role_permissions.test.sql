-- Role permissions: READ_ONLY reads; READ_WRITE edits tariffs and rules and records commands; ADMIN manages the
-- household. Implements the permission matrix in docs/SECURITY_MODEL.md section 2.1 (see docs/RLS_POLICY_MATRIX.md).

begin;

select plan(65);

select tests.world();

-- =================================================================================================================
-- READ_ONLY (ro1)
-- =================================================================================================================
select tests.as_user('ro1');
select is(
  (select count(*)::int from public.energy_sites)
    + (select count(*)::int from public.utility_tariffs)
    + (select count(*)::int from public.automation_rules)
    + (select count(*)::int from public.powerwall_metrics_log)
    + (select count(*)::int from public.household_settings),
  5,
  'READ_ONLY can read sites, tariffs, rules, telemetry and settings of their household'
);
select throws_ok(
  $q$insert into public.utility_tariffs (household_id, name, direction, price_mode, currency, timezone, effective_from, flat_rate_per_kwh)
     values (tests.id('h1'), 'ro tariff', 'EXPORT', 'FLAT', 'EUR', 'Europe/Dublin', date '2025-01-01', 0.01)$q$,
  '42501', null, 'READ_ONLY cannot create a tariff'
);
select lives_ok($q$update public.utility_tariffs set name = 'ro edit' where id = tests.id('t1')$q$, 'READ_ONLY tariff update is a no-op');
select lives_ok($q$delete from public.utility_tariffs where id = tests.id('t1')$q$, 'READ_ONLY tariff delete is a no-op');
select throws_ok(
  $q$insert into public.automation_rules (household_id, site_id, name, definition) values (tests.id('h1'), tests.id('s1'), 'ro rule', '{}'::jsonb)$q$,
  '42501', null, 'READ_ONLY cannot create a rule'
);
select throws_ok(
  $q$insert into public.device_command_log (household_id, site_id, origin, kind, params, params_hash, idempotency_key, provider_mode)
     values (tests.id('h1'), tests.id('s1'), 'USER', 'SET_BACKUP_RESERVE', '{}'::jsonb, decode(repeat('ab', 32), 'hex'), 'key-ro-0001', 'MOCK')$q$,
  '42501', null, 'READ_ONLY cannot submit a device command'
);
select throws_ok(
  $q$insert into public.energy_sites (household_id, provider, provider_site_id, timezone) values (tests.id('h1'), 'TESLA', 'site-ro', 'Europe/Dublin')$q$,
  '42501', null, 'READ_ONLY cannot connect a site'
);
select lives_ok(
  $q$update public.household_settings set monthly_spend_cap_usd = 1 where household_id = tests.id('h1')$q$,
  'READ_ONLY settings update is a no-op'
);
select throws_ok($q$select public.create_invitation(tests.id('h1'), 'x@example.invalid')$q$, '42501', 'not_authorised', 'READ_ONLY cannot invite');
select throws_ok($q$select public.set_automation_paused(tests.id('h1'), true)$q$, '42501', 'not_authorised', 'READ_ONLY cannot pause automation');
select throws_ok($q$select public.set_rule_mode(tests.id('r1'), 'DISABLED')$q$, '42501', 'not_authorised', 'READ_ONLY cannot change a rule mode');
select throws_ok(
  $q$select public.change_member_role(tests.id('h1'), tests.id('rw1'), 'READ_ONLY')$q$,
  '42501', 'not_authorised', 'READ_ONLY cannot change roles'
);
select is((select count(*)::int from public.audit_log), 0, 'READ_ONLY cannot read the audit log');
select is((select count(*)::int from public.household_invitations), 0, 'READ_ONLY cannot list invitations');

select tests.clear();
select is((select name from public.utility_tariffs where id = tests.id('t1')), 'tariff h1', 'tariff unchanged after READ_ONLY attempts');
select is(
  (select monthly_spend_cap_usd::text from public.household_settings where household_id = tests.id('h1')), '9.00',
  'settings unchanged after READ_ONLY attempts'
);
select is((select mode from public.automation_rules where id = tests.id('r1')), 'DRY_RUN', 'rule mode unchanged after READ_ONLY attempts');

-- =================================================================================================================
-- READ_WRITE (rw1)
-- =================================================================================================================
select tests.as_user('rw1');
select lives_ok(
  $q$insert into public.utility_tariffs (household_id, name, direction, price_mode, currency, timezone, effective_from, flat_rate_per_kwh)
     values (tests.id('h1'), 'rw tariff', 'EXPORT', 'FLAT', 'EUR', 'Europe/Dublin', date '2025-01-01', 0.01)$q$,
  'READ_WRITE can create a tariff'
);
select lives_ok($q$update public.utility_tariffs set name = 'renamed' where id = tests.id('t1')$q$, 'READ_WRITE can rename a tariff version');
select throws_ok(
  $q$update public.utility_tariffs set flat_rate_per_kwh = 0.5 where id = tests.id('t1')$q$,
  'P0001', 'tariff_version_immutable', 'READ_WRITE cannot change the rate of an existing tariff version'
);
select lives_ok(
  $q$insert into public.tariff_slots (tariff_id, day_type, start_minute, end_minute, rate_per_kwh, label)
     select id, 'ALL', 0, 1440, 0.1, 'rw slot' from public.utility_tariffs where name = 'rw tariff'$q$,
  'READ_WRITE can add a tariff slot to a tariff of their household'
);
select throws_ok(
  $q$insert into public.tariff_slots (tariff_id, day_type, start_minute, end_minute, rate_per_kwh, label)
     values (tests.id('t2'), 'ALL', 0, 1440, 0.1, 'intruder slot')$q$,
  '42501', null, 'READ_WRITE cannot add a slot to another household''s tariff'
);
select lives_ok(
  $q$insert into public.automation_rules (household_id, site_id, name, mode, definition)
     values (tests.id('h1'), tests.id('s1'), 'rw rule', 'DRY_RUN', '{}'::jsonb)$q$,
  'READ_WRITE can create a DRY_RUN rule'
);
select lives_ok(
  $q$insert into public.automation_rules (household_id, site_id, name, definition)
     values (tests.id('h1'), tests.id('s1'), 'rw default rule', '{}'::jsonb)$q$,
  'a rule created without a mode is DISABLED'
);
select throws_ok(
  $q$insert into public.automation_rules (household_id, site_id, name, mode, definition)
     values (tests.id('h1'), tests.id('s1'), 'rw active rule', 'ACTIVE', '{}'::jsonb)$q$,
  '42501', null, 'READ_WRITE cannot create an ACTIVE rule'
);
select throws_ok(
  $q$update public.automation_rules set mode = 'ACTIVE' where id = tests.id('r1')$q$,
  '42501', null, 'the rule mode column cannot be updated directly'
);
select lives_ok($q$select public.set_rule_mode(tests.id('r1'), 'DISABLED')$q$, 'READ_WRITE can set a rule to DISABLED');
select throws_ok(
  $q$select public.set_rule_mode(tests.id('r1'), 'ACTIVE')$q$,
  '42501', 'not_authorised', 'READ_WRITE cannot set a rule to ACTIVE'
);
select lives_ok($q$select public.set_automation_paused(tests.id('h1'), true)$q$, 'READ_WRITE can pause automation');
select throws_ok(
  $q$select public.set_automation_paused(tests.id('h1'), false)$q$,
  '42501', 'not_authorised', 'READ_WRITE cannot resume automation'
);
select lives_ok(
  $q$insert into public.device_command_log (household_id, site_id, origin, kind, params, params_hash, idempotency_key, provider_mode)
     values (tests.id('h1'), tests.id('s1'), 'USER', 'SET_BACKUP_RESERVE', '{}'::jsonb, decode(repeat('ab', 32), 'hex'), 'key-rw-0001', 'MOCK')$q$,
  'READ_WRITE can record a MOCK device command'
);
select throws_ok(
  $q$insert into public.device_command_log (household_id, site_id, origin, kind, params, params_hash, idempotency_key, provider_mode)
     values (tests.id('h1'), tests.id('s1'), 'USER', 'SET_BACKUP_RESERVE', '{}'::jsonb, decode(repeat('ab', 32), 'hex'), 'key-rw-0002', 'TESLA')$q$,
  '42501', null, 'a TESLA-mode command needs controls to be enabled by an ADMIN'
);
select throws_ok(
  $q$insert into public.device_command_log (household_id, site_id, origin, kind, params, params_hash, idempotency_key, provider_mode)
     values (tests.id('h1'), tests.id('s1'), 'AUTOMATION', 'SET_BACKUP_RESERVE', '{}'::jsonb, decode(repeat('ab', 32), 'hex'), 'key-rw-0003', 'MOCK')$q$,
  '42501', null, 'a user cannot record a command with origin AUTOMATION'
);
select throws_ok(
  $q$insert into public.device_command_log (household_id, site_id, origin, kind, params, params_hash, idempotency_key, provider_mode, state)
     values (tests.id('h1'), tests.id('s1'), 'USER', 'SET_BACKUP_RESERVE', '{}'::jsonb, decode(repeat('ab', 32), 'hex'), 'key-rw-0004', 'MOCK', 'CONFIRMED')$q$,
  '42501', null, 'a user cannot write a command state (lifecycle is server-owned)'
);
select throws_ok(
  $q$update public.device_command_log set state = 'CONFIRMED'$q$,
  '42501', null, 'a user cannot update a command'
);
select throws_ok($q$select public.create_invitation(tests.id('h1'), 'x@example.invalid')$q$, '42501', 'not_authorised', 'READ_WRITE cannot invite');
select throws_ok(
  $q$select public.change_member_role(tests.id('h1'), tests.id('ro1'), 'ADMIN')$q$,
  '42501', 'not_authorised', 'READ_WRITE cannot change roles'
);
select lives_ok(
  $q$update public.household_settings set controls_enabled = true where household_id = tests.id('h1')$q$,
  'READ_WRITE settings update is a no-op'
);
select throws_ok(
  $q$insert into public.energy_sites (household_id, provider, provider_site_id, timezone) values (tests.id('h1'), 'TESLA', 'site-rw', 'Europe/Dublin')$q$,
  '42501', null, 'READ_WRITE cannot connect a site'
);
select is((select count(*)::int from public.audit_log), 0, 'READ_WRITE cannot read the audit log');

select tests.clear();
select is((select name from public.utility_tariffs where id = tests.id('t1')), 'renamed', 'the tariff rename was applied');
select is((select mode from public.automation_rules where id = tests.id('r1')), 'DISABLED', 'the rule mode change was applied');
select is(
  (select automation_paused from public.household_settings where household_id = tests.id('h1')), true,
  'automation is paused'
);
select is(
  (select controls_enabled from public.household_settings where household_id = tests.id('h1')), false,
  'controls are still disabled after the READ_WRITE attempt'
);
select is(
  (select requested_by from public.device_command_log where idempotency_key = 'key-rw-0001'), tests.id('rw1'),
  'requested_by is stamped from the JWT'
);
select is(
  (select state || '/' || phase from public.device_command_log where idempotency_key = 'key-rw-0001'), 'PENDING/RECORDED',
  'a new command starts PENDING/RECORDED'
);

-- =================================================================================================================
-- ADMIN (alice)
-- =================================================================================================================
select tests.as_user('alice');
select lives_ok(
  $q$insert into public.energy_sites (household_id, provider, provider_site_id, name, timezone)
     values (tests.id('h1'), 'TESLA', 'site-admin-added', 'Second site', 'Europe/Dublin')$q$,
  'ADMIN can connect a site'
);
select lives_ok($q$update public.energy_sites set name = 'Renamed site' where provider_site_id = 'site-admin-added'$q$, 'ADMIN can rename a site');
select throws_ok(
  $q$update public.energy_sites set household_id = tests.id('h1') where id = tests.id('s1')$q$,
  '42501', null, 'the household of a site cannot be updated'
);
select throws_ok(
  $q$update public.energy_sites set connection_state = 'LIVE' where id = tests.id('s1')$q$,
  '42501', null, 'connection_state is written by the Worker only'
);
select lives_ok(
  $q$update public.household_settings set monthly_spend_cap_usd = 5, controls_enabled = true where household_id = tests.id('h1')$q$,
  'ADMIN can change the budget and enable controls'
);
select throws_ok(
  $q$update public.household_settings set automation_paused = false where household_id = tests.id('h1')$q$,
  '42501', null, 'the pause flag cannot be written directly, even by an ADMIN'
);
select lives_ok($q$select public.set_automation_paused(tests.id('h1'), false)$q$, 'ADMIN can resume automation');
select lives_ok($q$select public.set_rule_mode(tests.id('r1'), 'ACTIVE')$q$, 'ADMIN can set a rule to ACTIVE');
select lives_ok($q$update public.automation_rules set name = 'tampered' where id = tests.id('r1')$q$, 'editing an ACTIVE rule directly is a no-op');
select lives_ok(
  $q$insert into public.device_command_log (household_id, site_id, origin, kind, params, params_hash, idempotency_key, provider_mode)
     values (tests.id('h1'), tests.id('s1'), 'USER', 'SET_BACKUP_RESERVE', '{}'::jsonb, decode(repeat('ab', 32), 'hex'), 'key-admin-0001', 'TESLA')$q$,
  'with controls enabled, a TESLA-mode command intent can be recorded'
);
select lives_ok($q$select public.create_invitation(tests.id('h1'), 'invitee@example.invalid')$q$, 'ADMIN can invite');
select throws_ok(
  $q$update public.household_members set role = 'READ_ONLY' where user_id = tests.id('ro1')$q$,
  '42501', null, 'even an ADMIN cannot write household_members directly'
);
select throws_ok(
  $q$insert into public.powerwall_metrics_log (site_id, sampled_at, timestamp_origin, solar_power_w, source)
     values (tests.id('s1'), now() + interval '1 minute', 'PROVIDER', 1, 'TESLA')$q$,
  '42501', null, 'even an ADMIN cannot write telemetry'
);
select throws_ok('select 1 from public.tesla_credentials', '42501', null, 'even an ADMIN cannot read Tesla credentials');
select ok((select count(*) from public.audit_log) > 0, 'ADMIN can read the audit log of their household');

select tests.clear();
select is(
  (select monthly_spend_cap_usd::text from public.household_settings where household_id = tests.id('h1')), '5.00',
  'the budget change was applied'
);
select is(
  (select automation_paused from public.household_settings where household_id = tests.id('h1')), false,
  'automation was resumed'
);
select is((select mode from public.automation_rules where id = tests.id('r1')), 'ACTIVE', 'the rule is ACTIVE');
select is((select name from public.automation_rules where id = tests.id('r1')), 'rule h1', 'an ACTIVE rule was not edited');

select * from finish();

rollback;
