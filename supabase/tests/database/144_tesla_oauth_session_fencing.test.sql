begin;
select plan(36);
select tests.clear();
select tests.world();
insert into auth.sessions(id,user_id) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',tests.id('alice')),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',tests.id('bob'));

create function tests.begin_fenced_oauth(p_owner uuid, p_restart boolean default false)
returns boolean language sql as $$
  select public.worker_begin_tesla_oauth(tests.id('h1'),tests.id('alice'),
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',now()+interval '1 hour',p_owner,p_restart)
$$;
create function tests.save_fenced_oauth(p_owner uuid, p_scopes text[] default array['openid','offline_access','energy_device_data'])
returns boolean language sql as $$
  select public.worker_save_tesla_credentials_fenced_for_oauth(tests.id('h1'),tests.id('alice'),
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',now()+interval '1 hour',p_owner,'v1',
    decode(repeat('00',12),'hex'),decode(repeat('bb',17),'hex'),1,p_scopes,
    'https://fleet-api.prd.eu.vn.cloud.tesla.com',now()+interval '1 hour')
$$;
grant execute on function tests.begin_fenced_oauth(uuid,boolean), tests.save_fenced_oauth(uuid,text[]) to service_role;

select ok(not has_function_privilege('anon','public.worker_begin_tesla_oauth(uuid,uuid,uuid,timestamptz,uuid,boolean)','EXECUTE'),'anon cannot acquire or supersede an OAuth fence');
select ok(not has_function_privilege('authenticated','public.worker_begin_tesla_oauth(uuid,uuid,uuid,timestamptz,uuid,boolean)','EXECUTE'),'user cannot impersonate another actor/session');
select ok(not has_function_privilege('anon','public.worker_validate_tesla_oauth_session(uuid,uuid,uuid,timestamptz,uuid)','EXECUTE'),'anon cannot inspect sessions');
select ok(not has_function_privilege('authenticated','public.worker_validate_tesla_oauth_session(uuid,uuid,uuid,timestamptz,uuid)','EXECUTE'),'user cannot inspect sessions');
select ok(not has_function_privilege('anon','public.worker_save_tesla_credentials_fenced_for_oauth(uuid,uuid,uuid,timestamptz,uuid,text,bytea,bytea,integer,text[],text,timestamptz)','EXECUTE'),'anon cannot persist credentials');
select ok(not has_function_privilege('authenticated','public.worker_save_tesla_credentials_fenced_for_oauth(uuid,uuid,uuid,timestamptz,uuid,text,bytea,bytea,integer,text[],text,timestamptz)','EXECUTE'),'user cannot invoke privileged save');
select ok(has_function_privilege('service_role','public.worker_save_tesla_credentials_fenced_for_oauth(uuid,uuid,uuid,timestamptz,uuid,text,bytea,bytea,integer,text[],text,timestamptz)','EXECUTE'),'only backend can invoke fenced save');
select tests.as_service();
select is(tests.begin_fenced_oauth('11111111-1111-4111-8111-111111111111'),true,'live ADMIN session acquires both leases');
select is(tests.begin_fenced_oauth('22222222-2222-4222-8222-222222222222'),false,'overlap cannot steal active leases');
select is(public.worker_validate_tesla_oauth_session(tests.id('h1'),tests.id('alice'),'cccccccc-cccc-4ccc-8ccc-cccccccccccc',now()+interval '1 hour','11111111-1111-4111-8111-111111111111'),true,'correct session and owner authorized');
select is(public.worker_validate_tesla_oauth_session(tests.id('h1'),tests.id('alice'),'dddddddd-dddd-4ddd-8ddd-dddddddddddd',now()+interval '1 hour','11111111-1111-4111-8111-111111111111'),false,'another account session denied');
select is(public.worker_validate_tesla_oauth_session(tests.id('h2'),tests.id('alice'),'cccccccc-cccc-4ccc-8ccc-cccccccccccc',now()+interval '1 hour','11111111-1111-4111-8111-111111111111'),false,'cross-household access denied');
select is(public.worker_validate_tesla_oauth_session(tests.id('h1'),tests.id('alice'),'cccccccc-cccc-4ccc-8ccc-cccccccccccc',now()-interval '1 second','11111111-1111-4111-8111-111111111111'),false,'expired access token denied');
select is(tests.save_fenced_oauth('11111111-1111-4111-8111-111111111111'),true,'current owner saves encrypted credentials');
select is((select actor_user_id::text from public.audit_log where action='tesla.connected'),tests.id('alice')::text,'audit attributed to initiating ADMIN');
select throws_ok($q$select tests.save_fenced_oauth('11111111-1111-4111-8111-111111111111',array['openid','offline_access','energy_device_data','energy_cmds'])$q$,'22023',null,'control scope still denied');
select is(tests.begin_fenced_oauth('22222222-2222-4222-8222-222222222222',true),true,'explicit authorized restart replaces abandoned ownership');
select is(public.worker_release_lock('staging:tesla:oauth:household:'||tests.id('h1')::text,'11111111-1111-4111-8111-111111111111'),false,'stale owner cannot release replacement household lease');
select throws_ok($q$select tests.save_fenced_oauth('11111111-1111-4111-8111-111111111111')$q$,'42501',null,'old owner cannot persist after restart');
select is(tests.save_fenced_oauth('22222222-2222-4222-8222-222222222222'),true,'new owner can persist');

reset role;
update auth.sessions set not_after=now()-interval '1 second' where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select tests.as_service();
select is(public.worker_validate_tesla_oauth_session(tests.id('h1'),tests.id('alice'),'cccccccc-cccc-4ccc-8ccc-cccccccccccc',now()+interval '1 hour','22222222-2222-4222-8222-222222222222'),false,'server-side session expiry denied');
select throws_ok($q$select tests.save_fenced_oauth('22222222-2222-4222-8222-222222222222')$q$,'42501',null,'expired session cannot save');
reset role;
delete from auth.sessions where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select tests.as_service();
select is(public.worker_validate_tesla_oauth_session(tests.id('h1'),tests.id('alice'),'cccccccc-cccc-4ccc-8ccc-cccccccccccc',now()+interval '1 hour','22222222-2222-4222-8222-222222222222'),false,'logout invalidates still-signed JWT session');
select throws_ok($q$select tests.save_fenced_oauth('22222222-2222-4222-8222-222222222222')$q$,'42501',null,'logout cannot persist');
select throws_ok($q$select tests.begin_fenced_oauth('33333333-3333-4333-8333-333333333333',true)$q$,'42501',null,'logout cannot restart');
reset role;
insert into auth.sessions(id,user_id) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc',tests.id('alice'));
insert into public.household_members(household_id,user_id,role) values(tests.id('h1'),tests.id('carol'),'ADMIN');
update public.household_members set role='READ_ONLY' where household_id=tests.id('h1') and user_id=tests.id('alice');
select tests.as_service();
select throws_ok($q$select tests.save_fenced_oauth('22222222-2222-4222-8222-222222222222')$q$,'42501',null,'demoted ADMIN cannot save');
reset role;
update public.household_members set role='ADMIN' where household_id=tests.id('h1') and user_id=tests.id('alice');
update public.job_locks set lease_expires_at=now()-interval '1 second' where key like 'staging:tesla:oauth:%';
select tests.as_service();
select throws_ok($q$select tests.save_fenced_oauth('22222222-2222-4222-8222-222222222222')$q$,'42501',null,'expired fence cannot save');
select is(tests.begin_fenced_oauth('33333333-3333-4333-8333-333333333333'),true,'lease expiry recovers abandoned attempt');
select throws_ok($q$select tests.save_fenced_oauth('22222222-2222-4222-8222-222222222222')$q$,'42501',null,'recovered attempt excludes old owner');
select is(tests.save_fenced_oauth('33333333-3333-4333-8333-333333333333'),true,'recovered attempt saves');
reset role;
insert into auth.sessions(id,user_id) values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',tests.id('carol'));
select tests.as_service();
select is(public.worker_begin_tesla_oauth(tests.id('h1'),tests.id('carol'),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',now()+interval '1 hour','44444444-4444-4444-8444-444444444444',false),false,'another ADMIN cannot overlap a household connection');
select is(public.worker_begin_tesla_oauth(tests.id('h1'),tests.id('carol'),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',now()+interval '1 hour','44444444-4444-4444-8444-444444444444',true),true,'current household ADMIN may explicitly restart');
select throws_ok($q$select tests.save_fenced_oauth('33333333-3333-4333-8333-333333333333')$q$,'42501',null,'previous ADMIN owner fenced by household ownership');
select is(public.worker_save_tesla_credentials_fenced_for_oauth(tests.id('h1'),tests.id('carol'),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',now()+interval '1 hour','44444444-4444-4444-8444-444444444444','v1',decode(repeat('00',12),'hex'),decode(repeat('cc',17),'hex'),1,array['openid','offline_access','energy_device_data'],'https://fleet-api.prd.eu.vn.cloud.tesla.com',now()+interval '1 hour'),true,'new ADMIN saves with their own active session');
select is((select count(*)::int from public.tesla_credentials where household_id=tests.id('h2')),0,'other household credentials unchanged');
select is((select count(*)::int from public.audit_log where action='tesla.connected'),4,'only authorized fenced saves audited');
select * from finish();
rollback;
