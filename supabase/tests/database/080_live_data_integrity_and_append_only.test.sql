-- Demo data cannot enter live tables; telemetry is written only by the server role; audit and command-event logs are
-- append-only for every role.

begin;

select plan(29);

select tests.world();

-- ---- demo / user-written telemetry ------------------------------------------------------------------------------
select tests.as_user('alice');
select throws_ok(
  $q$insert into public.powerwall_metrics_log (site_id, sampled_at, timestamp_origin, solar_power_w, source)
     values (tests.id('s1'), now() + interval '2 minutes', 'PROVIDER', 1, 'DEMO')$q$,
  '42501', null, 'an ADMIN cannot insert telemetry at all'
);
select throws_ok(
  $q$insert into public.energy_sites (household_id, provider, provider_site_id, timezone)
     values (tests.id('h1'), 'DEMO', 'demo-site', 'Europe/Dublin')$q$,
  '23514', null, 'a DEMO provider cannot be stored as a site'
);
select throws_ok($q$update public.powerwall_metrics_log set solar_power_w = 0$q$, '42501', null, 'authenticated cannot update telemetry');
select throws_ok($q$delete from public.powerwall_metrics_log$q$, '42501', null, 'authenticated cannot delete telemetry');
select throws_ok(
  $q$insert into public.energy_intervals (site_id, interval_start, interval_end, resolution_seconds, source)
     values (tests.id('s1'), now() - interval '1 hour', now(), 3600, 'TESLA')$q$,
  '42501', null, 'authenticated cannot insert energy intervals'
);
select throws_ok(
  $q$insert into public.cost_rollups_daily (site_id) values (tests.id('s1'))$q$,
  '42501', null, 'authenticated cannot write the cost cache'
);

select tests.as_service();
select throws_ok(
  $q$insert into public.powerwall_metrics_log (site_id, sampled_at, timestamp_origin, solar_power_w, source)
     values (tests.id('s1'), now() + interval '2 minutes', 'PROVIDER', 1, 'DEMO')$q$,
  '23514', null, 'even the server role cannot store DEMO telemetry (CHECK source = TESLA)'
);
select throws_ok(
  $q$insert into public.energy_intervals (site_id, interval_start, interval_end, resolution_seconds, source)
     values (tests.id('s1'), now() - interval '1 hour', now(), 3600, 'DEMO')$q$,
  '23514', null, 'even the server role cannot store DEMO energy intervals'
);
select lives_ok(
  $q$insert into public.powerwall_metrics_log (site_id, sampled_at, timestamp_origin, solar_power_w, battery_soc_percent, source)
     values (tests.id('s1'), now() + interval '3 minutes', 'PROVIDER', 1, 50, 'TESLA')$q$,
  'the server role can store TESLA telemetry'
);
select throws_ok(
  $q$insert into public.powerwall_metrics_log (site_id, sampled_at, timestamp_origin, source, battery_soc_percent)
     values (tests.id('s1'), now() + interval '4 minutes', 'PROVIDER', 'TESLA', 101)$q$,
  '23514', null, 'a battery percentage above 100 is rejected'
);
select throws_ok(
  $q$insert into public.powerwall_metrics_log (site_id, sampled_at, timestamp_origin, source)
     select site_id, sampled_at, 'PROVIDER', 'TESLA' from public.powerwall_metrics_log limit 1$q$,
  '23505', null, 'a duplicate sample for a site and timestamp is rejected'
);

-- ---- audit_log is append-only for everyone ---------------------------------------------------------------------
select tests.as_user('alice');
select throws_ok(
  $q$insert into public.audit_log (household_id, actor_type, action) values (tests.id('h1'), 'USER', 'settings.changed')$q$,
  '42501', null, 'an ADMIN cannot write audit rows'
);
select throws_ok($q$update public.audit_log set action = 'x'$q$, '42501', null, 'an ADMIN cannot update audit rows');
select throws_ok($q$delete from public.audit_log$q$, '42501', null, 'an ADMIN cannot delete audit rows');

select tests.as_service();
select lives_ok(
  $q$insert into public.audit_log (household_id, actor_type, action) values (tests.id('h1'), 'SYSTEM', 'tesla.connected')$q$,
  'the server role can append audit rows (S7)'
);
select throws_ok($q$update public.audit_log set action = 'x'$q$, '42501', null, 'the server role cannot update audit rows');
select throws_ok($q$delete from public.audit_log$q$, '42501', null, 'the server role cannot delete audit rows');
select throws_ok($q$truncate public.audit_log$q$, '42501', null, 'the server role cannot truncate the audit log');

select tests.clear();
select throws_ok($q$update public.audit_log set action = 'x'$q$, '55000', null, 'even the table owner cannot update audit rows');
select throws_ok($q$delete from public.audit_log$q$, '55000', null, 'even the table owner cannot delete audit rows');
select throws_ok($q$truncate public.audit_log$q$, '55000', null, 'even the table owner cannot truncate the audit log');

-- ---- device_command_events is append-only -------------------------------------------------------------------------
select tests.as_service();
select lives_ok(
  $q$insert into public.device_command_log (household_id, site_id, origin, kind, params, params_hash, idempotency_key, provider_mode)
     values (tests.id('h1'), tests.id('s1'), 'USER', 'SET_BACKUP_RESERVE', '{}'::jsonb, decode(repeat('ab', 32), 'hex'), 'key-evt-0001', 'MOCK')$q$,
  'the server role can record a command'
);
select lives_ok(
  $q$insert into public.device_command_events (command_id, from_state, to_state)
     select id, 'PENDING', 'UNKNOWN' from public.device_command_log where idempotency_key = 'key-evt-0001'$q$,
  'the server role can append a command event'
);
select throws_ok($q$update public.device_command_events set to_state = 'CONFIRMED'$q$, '42501', null, 'the server role cannot update command events');
select throws_ok($q$delete from public.device_command_events$q$, '42501', null, 'the server role cannot delete command events');
select tests.clear();
select throws_ok($q$update public.device_command_events set to_state = 'CONFIRMED'$q$, '55000', null, 'even the owner cannot update command events');
select throws_ok($q$truncate public.device_command_events$q$, '55000', null, 'even the owner cannot truncate command events');

select tests.as_user('rw1');
select throws_ok(
  $q$insert into public.device_command_events (command_id, to_state) select id, 'CONFIRMED' from public.device_command_log limit 1$q$,
  '42501', null, 'a READ_WRITE user cannot write command events (no fake confirmations)'
);
select is(
  (select count(*)::int from public.device_command_events), 1,
  'a member can read the events of their household''s commands'
);

select * from finish();

rollback;
