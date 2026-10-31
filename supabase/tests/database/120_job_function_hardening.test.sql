-- Adversarial regression tests for server-only job, lock, and provider usage functions.
begin;
select plan(44);

select tests.clear();
select tests.world();
select tests.as_service();

-- Normal claim and expired lease reclamation.
insert into public.scheduled_jobs (kind, dedupe_key, run_at)
values ('sync_live', 'job-normal', now() - interval '1 minute');
select is((select count(*)::int from private.claim_jobs('worker-a', 1, 60)), 1, 'claims a due queued job');
select ok((select state = 'RUNNING' and attempts = 1 and locked_by = 'worker-a'
                 and lease_expires_at > now() and finished_at is null
            from public.scheduled_jobs where dedupe_key = 'job-normal'), 'sets claim state, attempt, owner and lease');

insert into public.scheduled_jobs (kind, dedupe_key, run_at)
values ('sync_live', 'job-expired', now() - interval '2 minutes');
select is((select count(*)::int from private.claim_jobs('worker-a', 1, 60)), 1, 'initially claims job for lease expiry test');
update public.scheduled_jobs set lease_expires_at = now() - interval '1 second'
where dedupe_key = 'job-expired';
select is((select count(*)::int from private.claim_jobs('worker-b', 1, 60)), 1, 'reclaims an expired running lease');
select ok((select attempts = 2 and locked_by = 'worker-b' and lease_expires_at > now()
            from public.scheduled_jobs where dedupe_key = 'job-expired'), 'reclaim increments attempts and replaces expired owner');

-- Exhausted jobs become terminal and lose stale lease ownership.
insert into public.scheduled_jobs (kind, dedupe_key, run_at, attempts, max_attempts)
values ('sync_live', 'job-exhausted-queued', now() - interval '1 minute', 2, 2);
select is((select count(*)::int from private.claim_jobs('worker-c', 10, 60)), 0, 'does not claim an exhausted queued job');
select ok((select state = 'DEAD' and finished_at is not null and locked_by is null and lease_expires_at is null
            from public.scheduled_jobs where dedupe_key = 'job-exhausted-queued'), 'marks exhausted queued job DEAD and finalizes it');

insert into public.scheduled_jobs (kind, dedupe_key, run_at, state, attempts, max_attempts, locked_by, lease_expires_at)
values ('sync_live', 'job-exhausted-running', now() - interval '2 minutes', 'RUNNING', 2, 2, 'stale-worker', now() - interval '1 second');
select is((select count(*)::int from private.claim_jobs('worker-c', 10, 60)), 0, 'does not reclaim exhausted running job');
select ok((select state = 'DEAD' and finished_at is not null and locked_by is null and lease_expires_at is null
            from public.scheduled_jobs where dedupe_key = 'job-exhausted-running'), 'marks exhausted expired job DEAD and clears its lease');
insert into public.scheduled_jobs (kind, dedupe_key, run_at, attempts, max_attempts)
values ('sync_live', 'job-no-extra-attempt', now() - interval '1 minute', 1, 1);
select is((select count(*)::int from private.claim_jobs('worker-c', 10, 60)), 0, 'never claims a job at max_attempts');
select is((select state from public.scheduled_jobs where dedupe_key = 'job-no-extra-attempt'), 'DEAD', 'terminally marks the max-attempt job');

-- Strict argument validation and explicit limits.
select throws_ok($q$select count(*) from private.claim_jobs('  ', 1, 60)$q$, '22023', null, 'rejects blank worker id');
select throws_ok($q$select count(*) from private.claim_jobs(null, 1, 60)$q$, '22023', null, 'rejects null worker id');
select throws_ok($q$select count(*) from private.claim_jobs(repeat('w', 101), 1, 60)$q$, '22023', null, 'rejects oversized worker id');
select throws_ok($q$select count(*) from private.claim_jobs('worker', 0, 60)$q$, '22023', null, 'rejects batch size below minimum');
select throws_ok($q$select count(*) from private.claim_jobs('worker', 101, 60)$q$, '22023', null, 'rejects batch size above maximum');
select throws_ok($q$select count(*) from private.claim_jobs('worker', null, 60)$q$, '22023', null, 'rejects null batch size');
select throws_ok($q$select count(*) from private.claim_jobs('worker', 1, 0)$q$, '22023', null, 'rejects lease below minimum');
select throws_ok($q$select count(*) from private.claim_jobs('worker', 1, 3601)$q$, '22023', null, 'rejects lease above maximum');
select throws_ok($q$select count(*) from private.claim_jobs('worker', 1, null)$q$, '22023', null, 'rejects null lease duration');

-- Active ownership is immutable until lease expiry; release is owner-bound.
select ok(private.acquire_lock('lock-active', 'owner-a', 60), 'acquires a new lock');
select is(private.acquire_lock('lock-active', 'owner-b', 60), false, 'active lock cannot be overwritten by another owner');
select is(private.acquire_lock('lock-active', 'owner-a', 60), false, 'active lock is not silently renewed');
select is((select owner from public.job_locks where key = 'lock-active'), 'owner-a', 'active lock owner remains unchanged');
insert into public.job_locks (key, owner, lease_expires_at) values ('lock-expired', 'old-owner', now() - interval '1 second');
select ok(private.acquire_lock('lock-expired', 'new-owner', 60), 'acquires an expired lock');
select is((select owner from public.job_locks where key = 'lock-expired'), 'new-owner', 'expired lock ownership is replaced');
select is(private.release_lock('lock-active', 'owner-b'), false, 'wrong owner cannot release lock');
select ok(exists (select 1 from public.job_locks where key = 'lock-active' and owner = 'owner-a'), 'wrong-owner release preserves lock');
select is(private.release_lock('lock-active', 'owner-a'), true, 'current owner can release lock');
select ok(not exists (select 1 from public.job_locks where key = 'lock-active'), 'owned lock is deleted on release');

select throws_ok($q$select private.acquire_lock(' ', 'owner', 60)$q$, '22023', null, 'rejects blank lock key');
select throws_ok($q$select private.acquire_lock(null, 'owner', 60)$q$, '22023', null, 'rejects null lock key');
select throws_ok($q$select private.acquire_lock(repeat('k', 201), 'owner', 60)$q$, '22023', null, 'rejects oversized lock key');
select throws_ok($q$select private.acquire_lock('key', ' ', 60)$q$, '22023', null, 'rejects blank lock owner');
select throws_ok($q$select private.acquire_lock('key', null, 60)$q$, '22023', null, 'rejects null lock owner');
select throws_ok($q$select private.acquire_lock('key', repeat('o', 101), 60)$q$, '22023', null, 'rejects oversized lock owner');
select throws_ok($q$select private.acquire_lock('key', 'owner', 0)$q$, '22023', null, 'rejects lock lease below minimum');
select throws_ok($q$select private.acquire_lock('key', 'owner', 3601)$q$, '22023', null, 'rejects lock lease above maximum');
select throws_ok($q$select private.acquire_lock('key', 'owner', null)$q$, '22023', null, 'rejects null lock lease');

-- Usage records both successful and failed calls; categories are validated by the function.
select is(private.record_provider_call(tests.id('h1'), 'DATA', true), true, 'reports successful counter write');
select is(private.record_provider_call(tests.id('h1'), 'DATA', false), true, 'reports failed-call counter write');
select is((select request_count || ':' || error_count from public.provider_usage_daily
           where household_id = tests.id('h1') and usage_day = (now() at time zone 'UTC')::date and category = 'DATA'),
          '2:1', 'counts successful and failed provider calls atomically');
select throws_ok($q$select private.record_provider_call(tests.id('h1'), 'telemetry', true)$q$, '22023', null, 'rejects unsupported provider category');
select throws_ok($q$select private.record_provider_call(tests.id('h1'), null, true)$q$, '22023', null, 'rejects null provider category');

select tests.clear();
select * from finish();
rollback;
