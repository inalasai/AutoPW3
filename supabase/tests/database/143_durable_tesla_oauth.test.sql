begin;
select plan(22);
select tests.clear();
select tests.world();

select ok(not has_function_privilege('anon', 'public.worker_validate_oauth_actor(uuid,uuid)', 'EXECUTE'), 'anonymous cannot check privileged OAuth authority');
select ok(not has_function_privilege('authenticated', 'public.worker_validate_oauth_actor(uuid,uuid)', 'EXECUTE'), 'users cannot impersonate OAuth actors');
select ok(not has_function_privilege('anon', 'public.worker_save_tesla_credentials_for_oauth(uuid,uuid,text,bytea,bytea,integer,text[],text,timestamptz)', 'EXECUTE'), 'anonymous cannot persist OAuth credentials');
select ok(not has_function_privilege('authenticated', 'public.worker_save_tesla_credentials_for_oauth(uuid,uuid,text,bytea,bytea,integer,text[],text,timestamptz)', 'EXECUTE'), 'authenticated cannot invoke privileged credential persistence');

select tests.as_service();
select is(public.worker_validate_oauth_actor(tests.id('h1'), tests.id('alice')), true, 'current administrator can connect');
select is(public.worker_validate_oauth_actor(tests.id('h1'), tests.id('rw1')), false, 'read-write cannot connect');
select is(public.worker_validate_oauth_actor(tests.id('h1'), tests.id('ro1')), false, 'read-only cannot connect');
select is(public.worker_validate_oauth_actor(tests.id('h1'), tests.id('bob')), false, 'another household administrator cannot connect');
select is(public.worker_validate_oauth_actor(null, tests.id('alice')), false, 'null household fails closed');
select is(public.worker_validate_oauth_actor(tests.id('h1'), null), false, 'null actor fails closed');

-- Test helper invokes the real RPC, with deliberately opaque ciphertext bytes.
reset role;
create function tests.save_oauth(p_actor uuid, p_household uuid, p_scopes text[] default array['openid','offline_access','energy_device_data'], p_base text default 'https://fleet-api.prd.eu.vn.cloud.tesla.com') returns boolean
language sql as $$
  select public.worker_save_tesla_credentials_for_oauth(p_household, p_actor, 'v1',
    decode(repeat('00',12),'hex'), decode(repeat('aa',17),'hex'), 1, p_scopes, p_base, now()+interval '1 hour')
$$;
grant execute on function tests.save_oauth(uuid,uuid,text[],text) to service_role;
select tests.as_service();
select is(tests.save_oauth(tests.id('alice'), tests.id('h1')), true, 'authorized save commits encrypted credentials');
select is((select count(*)::int from public.tesla_credentials where household_id=tests.id('h1')), 1, 'one household credential persisted');
select is((select count(*)::int from public.tesla_credentials where household_id=tests.id('h2')), 0, 'other household remains unchanged');
select is((select actor_user_id::text from public.audit_log where action='tesla.connected' and household_id=tests.id('h1')), tests.id('alice')::text, 'audit preserves the consumed state actor');
select is((select metadata::text from public.audit_log where action='tesla.connected' and household_id=tests.id('h1')), '{}', 'audit has no token material');
select throws_ok($q$ select tests.save_oauth(tests.id('bob'),tests.id('h1')) $q$, '42501', null, 'cross-household persistence denied');
select throws_ok($q$ select tests.save_oauth(tests.id('rw1'),tests.id('h1')) $q$, '42501', null, 'read-write persistence denied');
select throws_ok($q$ select tests.save_oauth(tests.id('alice'),tests.id('h1'),array['energy_device_data']) $q$, '22023', null, 'missing offline scope denied');
select throws_ok($q$ select tests.save_oauth(tests.id('alice'),tests.id('h1'),array['openid','offline_access','energy_device_data','energy_cmds']) $q$, '22023', null, 'command grant denied');
select throws_ok($q$ select tests.save_oauth(tests.id('alice'),tests.id('h1'),array['openid','offline_access','energy_device_data'],'https://attacker.invalid') $q$, '22023', null, 'unapproved host denied');

-- Simulate revocation after the initial callback check and before final persistence.
reset role;
insert into public.household_members(household_id,user_id,role) values(tests.id('h1'),tests.id('carol'),'ADMIN');
update public.household_members set role='READ_ONLY' where household_id=tests.id('h1') and user_id=tests.id('alice');
select tests.as_service();
select is(public.worker_validate_oauth_actor(tests.id('h1'),tests.id('alice')), false, 'demoted actor loses OAuth authority');
select throws_ok($q$ select tests.save_oauth(tests.id('alice'),tests.id('h1')) $q$, '42501', null, 'final save revalidates role rather than trusting prior check');

select * from finish();
rollback;
