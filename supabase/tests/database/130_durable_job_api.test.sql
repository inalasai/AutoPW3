-- PostgREST-facing durable queue API: service role only, tenant-scoped enqueue, owner-bound lifecycle.
begin;
select plan(30);
select tests.clear();
select tests.world();

select ok(not has_function_privilege('anon', 'public.worker_claim_jobs(text,integer,integer)', 'EXECUTE'), 'anon cannot claim jobs');
select ok(not has_function_privilege('authenticated', 'public.worker_claim_jobs(text,integer,integer)', 'EXECUTE'), 'authenticated cannot claim jobs');
select ok(has_function_privilege('service_role', 'public.worker_claim_jobs(text,integer,integer)', 'EXECUTE'), 'service role can claim jobs');
select ok(not has_function_privilege('anon', 'public.worker_schedule_due_jobs(timestamptz,integer,integer)', 'EXECUTE'), 'anon cannot schedule jobs');
select ok(not has_function_privilege('authenticated', 'public.worker_enqueue_job(text,uuid,uuid,text,timestamptz,jsonb,integer)', 'EXECUTE'), 'authenticated cannot enqueue jobs');
select ok(not has_function_privilege('authenticated', 'public.worker_finish_job(uuid,text)', 'EXECUTE'), 'authenticated cannot finish jobs');
select ok(not has_function_privilege('authenticated', 'public.worker_fail_job(uuid,text,text,integer,boolean)', 'EXECUTE'), 'authenticated cannot fail jobs');
select ok(not has_function_privilege('anon', 'public.worker_acquire_lock(text,text,integer)', 'EXECUTE'), 'anon cannot acquire service locks');
select ok(not has_function_privilege('authenticated', 'public.worker_release_lock(text,text)', 'EXECUTE'), 'authenticated cannot release service locks');
select ok(not has_function_privilege('authenticated', 'public.worker_record_provider_call(uuid,text,boolean)', 'EXECUTE'), 'authenticated cannot write usage counters');
select ok(has_function_privilege('service_role', 'public.worker_record_provider_call(uuid,text,boolean)', 'EXECUTE'), 'service role can record usage');

select tests.as_service();
select is(public.worker_enqueue_job(
  'sync_live', tests.id('h1'), tests.id('s1'), 'durable-live-1', now() - interval '1 second', '{}'::jsonb, 2
) is not null, true, 'enqueues a household-owned site job');
select throws_ok($q$select public.worker_enqueue_job('sync_live', tests.id('h2'), tests.id('s1'), 'durable-cross-tenant', now(), '{}'::jsonb, 2)$q$,
  '22023', null, 'rejects a site from another household');
select throws_ok($q$select public.worker_enqueue_job('not_a_job', tests.id('h1'), null, 'bad-kind', now(), '{}'::jsonb, 2)$q$,
  '22023', null, 'rejects unsupported job kind');
select throws_ok($q$select public.worker_enqueue_job('token_maintenance', tests.id('h1'), tests.id('s1'), 'bad-scope', now(), '{}'::jsonb, 2)$q$,
  '22023', null, 'rejects site scope for household-only job');
select throws_ok($q$select public.worker_enqueue_job('sync_live', tests.id('h1'), tests.id('s1'), 'bad-payload', now(), '[]'::jsonb, 2)$q$,
  '22023', null, 'rejects non-object payload');
select throws_ok($q$select public.worker_enqueue_job('sync_live', tests.id('h1'), tests.id('s1'), 'nonempty-payload', now(), '{"cursor":"unsafe"}'::jsonb, 2)$q$,
  '22023', null, 'rejects unregistered payload fields');

select is((select count(*)::int from public.worker_claim_jobs('worker-a', 10, 60)), 1, 'atomically claims due work');
select is(public.worker_finish_job((select id from public.scheduled_jobs where dedupe_key = 'durable-live-1'), 'worker-b'), false,
  'rejects completion by a worker that does not own the lease');
select is(public.worker_fail_job((select id from public.scheduled_jobs where dedupe_key = 'durable-live-1'), 'worker-b', 'NETWORK_ERROR', 1, false), null::text,
  'rejects failure update by a worker that does not own the lease');
select is(public.worker_fail_job((select id from public.scheduled_jobs where dedupe_key = 'durable-live-1'), 'worker-a', 'NETWORK_ERROR', 1, false), 'QUEUED',
  'requeues retryable work with a persisted diagnostic code');
select is((select last_error from public.scheduled_jobs where dedupe_key = 'durable-live-1'), 'NETWORK_ERROR', 'stores only a bounded error code');
select is((select count(*)::int from public.worker_claim_jobs('worker-b', 10, 60)), 0, 'does not claim before retry delay expires');
update public.scheduled_jobs set run_at = now() - interval '1 second' where dedupe_key = 'durable-live-1';
select is((select count(*)::int from public.worker_claim_jobs('worker-b', 10, 60)), 1, 'reclaims queued retry on a later attempt');
select is(public.worker_fail_job((select id from public.scheduled_jobs where dedupe_key = 'durable-live-1'), 'worker-b', 'PERMANENT_FAILURE', 1, true), 'DEAD',
  'moves permanent failures directly to DEAD');
select ok(public.worker_acquire_lock('worker-test-lock', 'worker-a', 30), 'service wrapper acquires a distributed lease');
select is(public.worker_acquire_lock('worker-test-lock', 'worker-b', 30), false, 'active lock cannot be stolen');
select is(public.worker_release_lock('worker-test-lock', 'worker-b'), false, 'non-owner cannot release distributed lease');
select is(public.worker_release_lock('worker-test-lock', 'worker-a'), true, 'owner releases distributed lease');
select is(public.worker_record_provider_call(tests.id('h1'), 'DATA', true), true, 'service wrapper records known provider usage');

select * from finish();
rollback;
