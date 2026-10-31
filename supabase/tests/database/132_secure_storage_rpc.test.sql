-- Service-role token/OAuth storage RPCs retain encryption and single-use state invariants.
begin;
select plan(15);
select tests.clear();
select tests.world();

select ok(not has_function_privilege('authenticated', 'public.worker_save_tesla_credentials(uuid,text,bytea,bytea,integer,text[],text,timestamptz)', 'EXECUTE'), 'authenticated cannot write encrypted credentials');
select ok(not has_function_privilege('authenticated', 'public.worker_get_tesla_credentials(uuid)', 'EXECUTE'), 'authenticated cannot read encrypted credentials');
select ok(not has_function_privilege('authenticated', 'public.worker_save_oauth_state(text,uuid,uuid,bytea,bytea,timestamptz)', 'EXECUTE'), 'authenticated cannot write service OAuth state');
select ok(not has_function_privilege('authenticated', 'public.worker_consume_oauth_state(text)', 'EXECUTE'), 'authenticated cannot consume service OAuth state');

select tests.as_service();
select is(public.worker_save_tesla_credentials(
  tests.id('h1'), 'key-v1', decode(repeat('00', 12), 'hex'), decode(repeat('aa', 17), 'hex'), 1,
  array['energy_device_data'], 'https://fleet-api.example.invalid', now() + interval '1 hour'
), true, 'saves encrypted Tesla credentials for one household');
select is((select status from public.worker_get_tesla_credentials(tests.id('h1'))), 'ACTIVE', 'reads the encrypted credential envelope');
select is((select octet_length(ciphertext)::int from public.worker_get_tesla_credentials(tests.id('h1'))), 17, 'returns ciphertext bytes without decrypting in SQL');
select throws_ok($q$select public.worker_save_tesla_credentials(tests.id('h1'), 'key-v1', decode('00','hex'), decode(repeat('aa',17),'hex'), 1, array[]::text[], 'https://fleet-api.example.invalid', now())$q$,
  '22023', null, 'rejects malformed encryption nonce');
select is(public.worker_delete_tesla_credentials(tests.id('h1')), true, 'deletes encrypted credentials on disconnect');
select is(public.worker_delete_tesla_credentials(tests.id('h1')), false, 'reports when no credential row existed');

select is(public.worker_save_oauth_state(
  repeat('s', 40), tests.id('h1'), tests.id('alice'), decode(repeat('bb', 17), 'hex'),
  decode(repeat('00', 12), 'hex'), now() + interval '5 minutes'
), true, 'saves state only for a current household member');
select is((select count(*)::int from public.worker_consume_oauth_state(repeat('s', 40))), 1, 'consumes valid OAuth state once');
select is((select count(*)::int from public.worker_consume_oauth_state(repeat('s', 40))), 0, 'second OAuth state consume returns no row');
select throws_ok($q$select public.worker_save_oauth_state(repeat('x',40), tests.id('h1'), tests.id('bob'), decode(repeat('bb',17),'hex'), decode(repeat('00',12),'hex'), now()+interval '5 minutes')$q$,
  '22023', null, 'rejects state for a user outside the household');
select is((select count(*)::int from public.oauth_states), 0, 'consumed state is removed from durable storage');

select * from finish();
rollback;
