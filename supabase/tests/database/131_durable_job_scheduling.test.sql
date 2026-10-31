-- Deterministic, tenant-scoped recurring scheduling and bounded page rotation.
begin;
select plan(6);
select tests.clear();
select tests.world();
update public.energy_sites set connection_state = 'LIVE' where id = tests.id('s1');

select tests.as_service();
select is(public.worker_schedule_due_jobs('2026-10-31T12:00:00Z'::timestamptz, 100, 100), 6,
  'schedules site work and one retention job per household');
select is(public.worker_schedule_due_jobs('2026-10-31T12:00:00Z'::timestamptz, 100, 100), 0,
  'overlapping cron delivery deduplicates every scheduled slot');
select is((select count(*)::int from public.scheduled_jobs), 6, 'creates no duplicate jobs');
select is((select count(*)::int from public.scheduled_jobs j join public.energy_sites s on s.id = j.site_id
  where j.household_id <> s.household_id), 0, 'all scheduled site jobs retain their owning household');
select throws_ok($q$select public.worker_schedule_due_jobs(now(), 101, 100)$q$, '22023', null,
  'rejects a site page above the hard bound');
select ok(not has_function_privilege('authenticated', 'public.worker_schedule_due_jobs(timestamptz,integer,integer)', 'EXECUTE'),
  'authenticated role cannot schedule service jobs');

select * from finish();
rollback;
