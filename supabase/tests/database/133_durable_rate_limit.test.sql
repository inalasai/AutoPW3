-- Server-only atomic rate limiting: caller identities are already hashed by the Worker.
begin;
select plan(9);
select tests.clear();
select tests.world();

select ok(not has_function_privilege('anon', 'public.worker_check_rate_limit(bytea,integer,integer)', 'EXECUTE'), 'anon cannot spend service rate-limit counters');
select ok(not has_function_privilege('authenticated', 'public.worker_check_rate_limit(bytea,integer,integer)', 'EXECUTE'), 'authenticated cannot spend service rate-limit counters');
select ok(has_function_privilege('service_role', 'public.worker_check_rate_limit(bytea,integer,integer)', 'EXECUTE'), 'service role can check rate limits');
select ok(not has_table_privilege('authenticated', 'public.worker_rate_limit_buckets', 'SELECT'), 'authenticated cannot read hashed rate-limit buckets');

select tests.as_service();
select is((select allowed from public.worker_check_rate_limit(decode(repeat('01', 32), 'hex'), 1, 60)), true,
  'first request in a fixed window is allowed');
select is((select allowed from public.worker_check_rate_limit(decode(repeat('01', 32), 'hex'), 1, 60)), false,
  'concurrent-safe counter rejects a request over the configured limit');
select ok((select retry_after_seconds >= 1 from public.worker_check_rate_limit(decode(repeat('01', 32), 'hex'), 1, 60)),
  'rejected request receives a positive retry-after duration');
select is((select allowed from public.worker_check_rate_limit(decode(repeat('02', 32), 'hex'), 1, 60)), true,
  'a separate hashed caller scope has an independent bucket');
select throws_ok($q$select * from public.worker_check_rate_limit(decode(repeat('00',32),'hex'), 0, 60)$q$,
  '22023', null, 'rejects a non-positive request limit');

select * from finish();
rollback;
